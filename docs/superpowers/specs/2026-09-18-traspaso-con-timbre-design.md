# Traspaso con timbre: que un deploy no rebobine ni duplique el árbitro

Fecha: 2026-09-18. Reemplaza la espera del PR #33 (`db01865`). Conserva de él la guarda de escritura, la carga después de escuchar y los logs `Traspaso:`.

## 1. El problema que queda después del #33

Render hace así un deploy sin cortes:

1. arranca la instancia nueva;
2. cuando pasa el health check, le manda **todo** el tráfico;
3. recién **60 s después** le manda SIGTERM a la vieja ("Once the health check passes and Render switches traffic to the new instance, the old instance keeps running for 60 seconds before Render sends it a `SIGTERM` signal", en [render.com/articles/how-render-handles-zero-downtime-deploys](https://render.com/articles/how-render-handles-zero-downtime-deploys); igual en [render.com/docs/deploys](https://render.com/docs/deploys), paso 4);
4. da 30 s de gracia y después manda SIGKILL.

El #33 hace que la nueva espere a que la vieja suelte la posta, con un tope de 60 s contados desde que la nueva arranca. La vieja suelta la posta en su SIGTERM, que llega en `s + 60` (`s` es lo que tarda Render en dar sana a la nueva). Así que **el tope siempre vence primero**: cada deploy termina en `Traspaso: timeout`. Consecuencias:

- **Unos 60 − s segundos de 503** para todo, en cada deploy. El SDK publicado no reintenta los 503, y las fases de Aleph duran 2 min.
- **Durante s segundos hay dos árbitros vivos.** La vieja sigue corriendo el barrido de partidas, el ticker de Aleph y la casa de Aleph. Además sigue escribiendo hasta su próximo latido (hasta 60 s después), y su flush final del SIGTERM puede pisar los blobs de la nueva. En una mesa de plata de Aleph que se liquida en ese rato, las dos instancias pueden firmar tablas distintas, y cobra la primera que llega a la cadena.
- **La posta se lee y después se escribe, sin atomicidad** (latido y liberación). Si la nueva la toma en medio, la vieja la reescribe con su id. En el latido siguiente, la nueva cree que la perdió y **deja de guardar para siempre, sin avisar**, mientras sigue atendiendo.
- **Perder la posta es silencioso.** `flush()` resuelve sin escribir, y `settleOnchain` en `aleph.ts` publica después de `persistNow()`. Por lo mismo, `flush()` también resuelve si Upstash rechaza la escritura (el error se loguea y se traga), así que se puede publicar una tabla que no quedó guardada.
- **En el SIGTERM la vieja no frena sus relojes** antes de sacar la foto final.
- **`/health` da 200 antes de probar Redis.** Un Upstash caído en pleno deploy deja el servicio caído, cuando antes era un deploy fallido con la vieja atendiendo.

Otro dato que condiciona el diseño: **leer también cambia el estado.** `GET /aleph/lobbies` y `GET /aleph/:id` corren `settleDue`, que avanza fases, disuelve salas y llama a `persist()`. Una instancia que está entregando no puede seguir atendiendo lecturas.

## 2. Objetivo

- Nunca hay **dos instancias que decidan o escriban a la vez**: en todo momento hay un solo dueño de la posta, y solo el dueño corre relojes, atiende o guarda.
- La nueva carga **exactamente** lo que la vieja guardó al entregar.
- La pausa por deploy es de **segundos**, no de un minuto.
- Sin costo nuevo: sin disco, sin plan pago y sin escrituras extra del blob entero.

Fuera de alcance, cada uno con su propio PR:

- que el SDK y el MCP reintenten los 503 (necesita publicar en npm, con el OK del dueño);
- correr los plazos de Aleph por lo que duró la pausa;
- más de una instancia a la vez (el plan gratuito tiene una sola).

## 3. Diseño

### 3.1 La idea en una línea

La nueva **no se declara sana hasta tener el estado**. Mientras tanto, Render le sigue mandando todo el tráfico a la vieja. Entonces la nueva le toca el timbre a la vieja: hace un pedido a la URL pública del propio servicio (`RENDER_EXTERNAL_URL`, que Render define en tiempo de ejecución), y **ese pedido solo puede llegarle a la vieja**. La vieja frena, guarda y suelta la posta; la nueva la toma, carga y recién ahí se declara sana. Render pasa el tráfico y, 60 s después, apaga a una vieja que ya no tiene nada que guardar.

### 3.2 La posta, por épocas (atómica sin Lua)

Claves en Upstash (todas chicas):

| Clave                           | Quién la escribe                    | Contenido                                             |
| ------------------------------- | ----------------------------------- | ----------------------------------------------------- |
| `arcade:lease:epoch`            | `INCR` de quien toma la posta       | un número; **el dueño es quien sacó el valor actual** |
| `arcade:lease:e:<E>`            | solo el dueño de la época `E`       | `{ id, instance, at, state: "active" \| "released" }` |
| `arcade:lease:handover`         | la instancia que pide la posta      | `{ by, forEpoch, at }`                                |
| `arcade:lease` (vieja, del #33) | nadie, salvo en la transición (3.7) | `{ id, at, released }`                                |

- **Tomar la posta** es `INCR arcade:lease:epoch`, que es atómico. Si dos instancias la toman a la vez, cada una recibe un número distinto y gana la más alta. Nadie puede pisar la marca de otro, porque cada época tiene su propia clave.
- **Ser dueño** es que `GET arcade:lease:epoch` coincida con la época propia.
- **Latido** (cada 60 s, igual que hoy): se chequea `epoch` y se escribe `at` en la clave de la época propia, dos comandos juntos en un `/pipeline`. Si la época cambió, la instancia **se cerca** (3.6).
- **Antes de subir un blob** se chequea que la época siga siendo la propia: una lectura chica por escritura con debounce. Si no lo es, no se escribe y la instancia se cerca.
- **Posta vencida:** si `at` tiene más de 3 min (3 latidos), la dueña se considera muerta.

Se elimina el **tope ciego** del #33: la posta de una dueña viva no se toma nunca. Solo se toma si no existe, si fue soltada o si está vencida.

### 3.3 Qué responde cada instancia según su modo

| Modo                                                | `/health` | `GET /` | `POST /internal/handover`              | Todo lo demás        |
| --------------------------------------------------- | --------- | ------- | -------------------------------------- | -------------------- |
| `starting` (esperando la posta)                     | **503**   | 200     | 409                                    | 503 `Retry-After: 5` |
| `fallback` (espera el SIGTERM de la vieja)          | 200       | 200     | 409                                    | 503 `Retry-After: 5` |
| `ready`                                             | 200       | 200     | 202 si el pedido es válido; si no, 409 | normal               |
| `draining` / `released` (entregando o ya entregada) | 200       | 200     | 202 si ya está entregando              | 503 `Retry-After: 5` |
| `fenced` (perdió la posta sin entregarla)           | **503**   | 200     | 409                                    | 503                  |

- En `starting` el health da 503 **a propósito**: así Render no manda tráfico a la nueva y el timbre le llega a la vieja.
- En `draining` y `released` el health sigue en 200, para que Render no saque a la vieja antes de tiempo (a los 15 s de fallas deja de mandarle tráfico).
- En `fenced` el health da 503 para que Render reinicie la instancia (lo hace después de 60 s de fallas).

### 3.4 Arranque de la nueva

1. **Probar Redis antes de escuchar**: leer la posta. Si Upstash no responde, el proceso termina sin escuchar; el deploy falla y la vieja sigue atendiendo, como antes del #33.
2. Escuchar en modo `starting`.
3. Según la posta:
   - **no existe, está soltada o está vencida:** tomarla (`INCR`) → `Traspaso: none | released | stale`.
   - **tiene una dueña viva con formato de épocas:**
     1. escribir `arcade:lease:handover = { by: yo, forEpoch: E }`;
     2. tocar el timbre (`POST ${RENDER_EXTERNAL_URL}/internal/handover`, con 5 s de tope por intento);
     3. repetir cada 5 s hasta que la vieja responda 202;
     4. esperar a que `e:<E>` diga `released` (sondeo cada 500 ms), tomar la posta → `Traspaso: doorbell`.
     - Si no hay 202 a los 30 s, o no hay `released` a los 30 s del 202, pasar a **respaldo** (3.4.1).
   - **la dueña viva es del #33** (no hay `epoch`, hay `arcade:lease` sin soltar y fresca): pasar directo a respaldo.
4. Con la posta tomada: cargar los 7 stores y **reconfirmar la época**. Si otra instancia la tomó mientras tanto, cercarse sin atender.
5. Arrancar los relojes (barrido de partidas, runner de agentes, ticker y casa de Aleph, monitor de gas) y el latido, y pasar a `ready`: `Árbitro listo: estado cargado`.

Los errores pasajeros de Upstash durante la espera **se reintentan y no tiran el proceso**. Si Upstash sigue caído, la nueva nunca se declara sana; Render cancela el deploy a los 15 min y la vieja sigue.

#### 3.4.1 Respaldo: esperar el SIGTERM

`/health` pasa a 200 (modo `fallback`). Render pasa el tráfico, que recibe 503, y 60 s después apaga a la vieja, que en el SIGTERM hace la misma entrega de 3.5. La nueva espera `released`, o que la posta venza (la vieja se colgó y le llegó el SIGKILL). **No hay tope ciego.** Así se comporta el primer deploy (3.7), o uno en el que el timbre no llega. Cuesta el minuto de 503 de hoy, pero nunca con dos dueñas.

### 3.5 Entrega de la vieja (por el timbre o por SIGTERM)

Hace lo mismo sin importar cómo empezó:

1. **Solo si vino por el timbre, validarlo:** leer `arcade:lease:handover`. Tiene que ser para mi época, de otra instancia y de menos de 60 s. Si no lo es, 409 y no pasa nada. El timbre no lleva secreto: la autoridad está en Redis, donde solo escriben nuestras instancias. Tiene un límite de un toque cada 2 s. El SIGTERM no se valida: lo manda Render.
2. **Responder 202** y seguir en segundo plano; el pedido del timbre no espera la entrega.
3. Pasar a `draining`: desde ya, 503 a todo salvo `/health` y `GET /`.
4. **Frenar los relojes** y esperar la vuelta que estaba en curso de cada uno (tope de 10 s):
   - el barrido de partidas y el runner de agentes, que hoy arrancan al importar su módulo y pasan a arrancar desde `index.ts` después de cargar;
   - el ticker de Aleph, incluida su vuelta on-chain;
   - la casa de Aleph y el monitor de gas.
5. **Esperar los pedidos HTTP en curso**, que se cuentan con un middleware (mismo tope de 10 s). Después de ese tope se sigue igual: lo que se firma on-chain ya se guarda antes de publicar (`persistNow`).
6. **Guardar todo** con `flush()`, que ahora **falla** si la escritura falla. Se reintenta hasta 3 veces; si igual falla, la entrega se aborta: la instancia vuelve a `ready`, rearranca los relojes y no suelta la posta. La nueva sigue esperando (o pasa a respaldo). Soltar sin haber guardado haría que la nueva cargue un estado viejo.
7. **Soltar la posta:** `e:<E>.state = "released"`; pasar a `released`; dejar de escribir.
8. Después de soltar:
   - **si vino por SIGTERM**, `exit(0)`;
   - **si vino por el timbre**, esperar el SIGTERM de Render, respondiendo 503.
   - **Retomar (3.5.1)** si en 90 s nadie tomó la posta.

Log: `Entregué la posta (época E): relojes frenados, guardado en N ms`.

**Qué hace un SIGTERM según el modo:**

| Modo                                                                           | Qué hace                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `ready`                                                                        | la entrega completa y después `exit(0)`                       |
| `draining`                                                                     | termina la entrega que ya estaba en curso y después `exit(0)` |
| `released`                                                                     | `exit(0)` enseguida                                           |
| `starting` / `fallback` (nunca tuvo la posta, por ejemplo un deploy cancelado) | `exit(0)` sin tocar Redis                                     |
| `fenced`                                                                       | `exit(0)` sin tocar Redis                                     |

#### 3.5.1 Retomar si la nueva no aparece

Si la nueva se cayó después del timbre y antes de tomar la posta, Render no le pasó el tráfico, y la vieja entregada dejaría el servicio en 503. Por eso, mientras está `released`, la vieja sondea `epoch` cada 2 s. Si pasan 90 s y sigue en `E`, la toma de nuevo (`INCR`). Su memoria es la última versión y nadie escribió después, así que no recarga: vuelve a `ready` y rearranca los relojes. Si justo la nueva sacó otra época en ese instante, gana la más alta y la otra se cerca (3.6). Es raro y se arregla solo: Render reinicia a la cercada, que vuelve a tocar el timbre.

### 3.6 Guarda de escritura y cerco

- `writable` pasa a significar "soy la dueña de la época actual".
- Sin la posta, `save()` no escribe y `flush()` **rechaza** con `persist: sin la posta`. En `settleOnchain` ese rechazo ya cae en el `catch`, que difiere el intento con backoff. Así, **ninguna tabla firmada se publica sin quedar guardada.**
- Si una instancia descubre que perdió la posta sin haberla entregado (por el latido, el chequeo antes de escribir o la reconfirmación de 3.4), se **cerca**:
  - frena sus relojes;
  - pasa a `fenced`: 503 a todo, `/health` incluido, así Render la reinicia;
  - lo registra con un error bien visible en el log.

### 3.7 El primer deploy (desde el #33)

La vieja corre el código del #33: no conoce el timbre ni las épocas, y usa `arcade:lease`. La nueva ve que no hay `epoch` y que `arcade:lease` tiene una dueña fresca sin soltar, así que pasa a **respaldo** (3.4.1). La vieja suelta la posta en su SIGTERM, 60 s después del cambio de tráfico, y la nueva la toma. Al tomar la época 1, la nueva también escribe `arcade:lease = { id: yo }`, para que una vieja del #33 que siguiera viva deje de escribir en su próximo latido. Ese deploy tiene el minuto de 503 de hoy, **sin dos dueñas**. Desde el siguiente, funciona con el timbre.

### 3.8 Caídas y cuelgues

| Caso                                                    | Qué pasa                                                                                                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy normal                                           | Timbre → la vieja entrega en unos segundos → la nueva carga → Render pasa el tráfico. Pausa: entrega + carga + lo que tarde Render en ver el health (a medir).                               |
| Primer deploy desde el #33                              | Respaldo: ~1 min de 503, con una sola dueña.                                                                                                                                                 |
| La vieja se cayó sin avisar (crash u OOM)               | La posta vence a los ≤ 3 min; la nueva espera hasta entonces sin declararse sana, en un servicio que ya estaba caído. Se pierden hasta 20 s de cambios, como antes (debounce).               |
| La vieja está colgada (event loop bloqueado)            | No contesta el timbre ni late. La posta vence y la nueva la toma. Si la vieja revive, su chequeo antes de escribir y su latido la cercan, y Render la reinicia o la termina.                 |
| La nueva se cae después del timbre                      | La vieja retoma a los 90 s (3.5.1). Unos 90 s de 503, y el deploy falla.                                                                                                                     |
| La nueva se cae después de cargar y antes de estar sana | Render la reinicia; la posta es de ella y está fresca. La reiniciada toca el timbre y nadie contesta (ya no hay vieja con la posta), así que pasa a respaldo y espera a que venza (≤ 3 min). |
| Upstash caído al arrancar                               | La nueva no escucha, el deploy falla y la vieja sigue.                                                                                                                                       |
| Upstash caído al entregar                               | El `flush` falla y la vieja aborta la entrega y sigue atendiendo.                                                                                                                            |
| Alguien toca el timbre desde afuera                     | Sin un pedido válido en Redis, 409. Una lectura chica por toque, con límite.                                                                                                                 |
| El servicio dormido (plan gratuito)                     | Si Render manda SIGTERM al dormirlo, la posta queda soltada. Si no lo manda, queda vencida (se duerme tras 15 min sin tráfico). En los dos casos la nueva no espera.                         |

## 4. Costos

- **Upstash:**
  - el latido sigue en 2 comandos por minuto, en un solo pedido (~86 mil por mes, lo mismo que hoy);
  - el chequeo antes de escribir suma una lectura por escritura con debounce (pocas miles por mes);
  - la entrega usa unas decenas de comandos por deploy.
- **Ancho de banda de Render:** un pedido HTTP chico por deploy más las lecturas chicas. **Ninguna escritura nueva del blob entero.**
- **Pausa por deploy:** segundos, en vez de ~1 min. Durante la pausa, todo (lecturas incluidas) responde 503 "reiniciando". El número real sale del primer deploy con timbre: el tiempo entre `Entregué la posta` en la vieja y el primer pedido atendido en la nueva.

## 5. Cómo se confirma en los logs de Render

- **Primer deploy** (desde el #33), en la nueva: `Traspaso: respaldo (esperando el SIGTERM de la vieja)`, ~1 min después `Traspaso: fallback`, y después `Árbitro listo`.
- **Deploys siguientes:**
  - en la vieja: `Entregué la posta (época E) …`;
  - en la nueva: `Traspaso: doorbell` y `Árbitro listo`, pocos segundos después de `Arbitro escuchando`.
- **Señales de alarma:** `Instancia cercada`, `Entrega abortada`, `Traspaso: stale` en un deploy normal, o `Traspaso: respaldo` en un deploy que no sea el primero.

## 6. Pruebas

- **Unitarias**, contra el Upstash falso de `persist-handover.test.ts`, que suma `INCR`, `POST /` con un comando en JSON y `/pipeline`:
  - tomar la posta y épocas;
  - el latido detecta la pérdida;
  - chequeo antes de escribir;
  - `flush` rechaza sin la posta y cuando falla la escritura;
  - entrega (orden: relojes → en curso → guardar → soltar) y entrega abortada si falla el guardado;
  - retomar a los 90 s;
  - transición desde `arcade:lease`;
  - validación del timbre.
- **Modos de `readiness`:** la tabla de 3.3, fila por fila.
- **Simulación de deploy de punta a punta** (la que faltó en el #33): dos árbitros reales como procesos hijos, el Upstash falso y un **Render falso** que enruta la URL pública a la vieja hasta que `/health` de la nueva da 200, y 60 s (comprimidos por variable) después le manda SIGTERM a la vieja. Casos:
  1. deploy normal: una partida creada en la vieja justo antes del timbre existe en la nueva y no hay dos dueñas;
  2. primer deploy desde una vieja con la posta del #33;
  3. la nueva muere tras el timbre y la vieja retoma.

  Con el #33 tal como está, el caso 1 tiene que fallar.

- `npm run check` en verde. No toca el pago, pero conviene correr `bash packages/contracts/check-payment-e2e.sh` porque cambia el arranque (chequear antes `pgrep -fl anvil`).

## 7. Archivos

- `apps/server/src/lease.ts` (nuevo): posta por épocas, latido, chequeo, pedido de traspaso, transición. Sale de `persist.ts`.
- `apps/server/src/persist.ts`: guarda por época, `flush()` que rechaza, el chequeo antes de escribir y los comandos chicos por `POST /`.
- `apps/server/src/handover.ts` (nuevo): el arranque de la nueva (3.4) y la entrega y el retomar de la vieja (3.5).
- `apps/server/src/readiness.ts`: los modos de 3.3 y el contador de pedidos en curso.
- `apps/server/src/index.ts`: probar Redis antes de escuchar, la ruta del timbre, el orden de arranque y el registro de relojes.
- `apps/server/src/matchmaking.ts` y `agent-runner.ts`: sus relojes pasan de arrancar al importar a `start…`/`stop…`, desde `index.ts`.
- `apps/server/src/aleph.ts` y `gas-monitor.ts`: agregar `stopAlephTicker()` (que espera la vuelta en curso) y `stopGasMonitor()`.
- Tests en `apps/server/test/`, más `CHANGELOG.md` y `DEPLOY.md` (qué buscar en los logs).
