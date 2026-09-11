# Migración `vault` → `aleph` — qué hacer ANTES de mergear

> ## ✅ EJECUTADO el 2026-09-11 — no volver a correrlo
>
> Los cuatro pasos están hechos. **El caso peligroso nunca existió**: no había
> ninguna variable `VAULT_*` en Render, así que no hubo nada que renombrar ni
> ningún `VAULT_ENABLED=false` que se perdiera en silencio.
>
> El árbitro nuevo está desplegado y contestando en `/aleph/*`, y los **cuatro
> paquetes 0.3.0 están publicados en npm**: `game-sdk`, `strategies`,
> `agent-sdk` y `mcp`. Verificable sin credenciales:
> `curl -s https://registry.npmjs.org/@arcade1v1%2Fagent-sdk | grep -o '"latest":"[^"]*"'`
> devuelve `0.3.0`, y esa es la primera versión que trae el subpath `/aleph`.
>
> **Correrlo de nuevo no tiene sentido**: no hay variables que migrar y npm
> rechaza republicar una versión existente.

El formato multi-agente **Aleph** ya está vivo en producción
(`https://arcade1v1.onrender.com`) desde la etapa 1, pero con el identificador
técnico viejo: `vault`. El rename lo cambia **todo** — rutas, variables de
entorno, clave del ranking, clave de lo guardado — y el deploy de Render es
**automático al mergear a `main`**.

> ⚠️ **El riesgo es que no falla ruidosamente.** Si en Render quedó alguna
> variable `VAULT_*`, el árbitro nuevo simplemente **no la lee**: arranca con
> los valores por defecto, sin un solo error en el log. Por eso el paso 1 va
> **antes** del merge.

---

## El caso peligroso: `VAULT_ENABLED=false`

De las 10 perillas, **9 solo cambian tiempos y topes** (mínimo de asientos,
duración de la fase, salas máximas…): si se pierden, el formato sigue andando
con los valores por defecto, que son los sanos.

La décima es distinta. `ALEPH_ENABLED` es un **interruptor de apagado** cuyo
valor por defecto es **ENCENDIDO** (`process.env.ALEPH_ENABLED !== "false"`,
`apps/server/src/aleph.ts:78`). Si la etapa 1 se desplegó apagada — es decir,
si en Render hay un `VAULT_ENABLED=false` —, después del merge el árbitro
buscaría `ALEPH_ENABLED`, no lo encontraría, y **el formato se prendería solo**:
un formato que creías apagado quedaría abierto al público sin que nadie
ejecute nada. Es el único fallback que mueve el sistema hacia _más abierto_.

**Por eso el paso 1 no es opcional aunque no hayas tocado nunca esas
variables**: chequear el panel cuesta un minuto y deja el dato escrito.

---

## Los 4 pasos, en orden

### 1) Revisar el panel de Render (ANTES de mergear)

Entrá al servicio del árbitro en Render → **Environment**. Buscá cualquier
variable que empiece con `VAULT_`:

| Vieja                    | Nueva                    | Si no está, el default es |
| ------------------------ | ------------------------ | ------------------------- |
| `VAULT_ENABLED`          | `ALEPH_ENABLED`          | **encendido** ⚠️          |
| `VAULT_MIN_SEATS`        | `ALEPH_MIN_SEATS`        | `4`                       |
| `VAULT_MAX_SEATS`        | `ALEPH_MAX_SEATS`        | `8`                       |
| `VAULT_LOBBY_MS`         | `ALEPH_LOBBY_MS`         | `600000` (10 min)         |
| `VAULT_PHASE_MS`         | `ALEPH_PHASE_MS`         | `120000` (2 min)          |
| `VAULT_TICK_MS`          | `ALEPH_TICK_MS`          | `5000` (5 s)              |
| `VAULT_MAX_ROOMS`        | `ALEPH_MAX_ROOMS`        | `50`                      |
| `VAULT_FINISHED_TTL_MS`  | `ALEPH_FINISHED_TTL_MS`  | `604800000` (7 d)         |
| `VAULT_MAX_SETTLED_KEPT` | `ALEPH_MAX_SETTLED_KEPT` | `50`                      |
| `VAULT_STAKES`           | `ALEPH_STAKES`           | solo la mesa gratis       |

- **Si NO hay ninguna** (lo más probable: la etapa 1 se desplegó con los
  defaults): no hay nada que hacer. Anotalo abajo igual, así la próxima
  persona no tiene que volver a mirar.
- **Si hay alguna**: creá su gemela `ALEPH_*` con el **mismo valor**, en un
  **único guardado** (Render reinicia el servicio una sola vez), y borrá la
  vieja. La vieja ya no la lee nadie.

El detalle de qué hace cada perilla está en
[`CONFIGURATION.md`](CONFIGURATION.md), sección "Aleph (multi-agent rooms)".

### 2) Mergear y esperar el deploy

El merge a `main` dispara el redeploy solo. Tarda unos minutos.

### 3) Verificar que el árbitro nuevo responde en `/aleph/*`

```bash
curl -s https://arcade1v1.onrender.com/aleph/lobbies
```

- Devuelve un JSON con la lista de lobbies (vacía está perfecto) → **listo**.
- Devuelve **404** → todavía está corriendo el árbitro viejo; esperá el deploy.

Contraprueba de que el rename llegó entero (la ruta vieja tiene que morir):

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://arcade1v1.onrender.com/vault/lobbies
# tiene que dar 404
```

Y si el formato tenía que quedar **apagado**, confirmalo: un
`POST /aleph/join` debe contestar `400` con el motivo `aleph disabled`.

### 4) Recién ahí, publicar los paquetes 0.3.0 en npm

Son **cuatro** paquetes, no tres: `@arcade1v1/strategies` también sube, porque
`@arcade1v1/agent-sdk` lo declara como dependencia y el script de publicación
pinea las deps del workspace a la versión exacta (`^0.3.0`). Si `strategies`
0.3.0 no está en npm, cualquiera que corra `npm i @arcade1v1/agent-sdk` se come
un **404** al resolver esa dependencia.

Por eso el orden importa: cada SDK pinea al anterior (`strategies` necesita
`game-sdk`, `agent-sdk` necesita a los dos). El MCP va último porque empaqueta
al `agent-sdk` dentro de su propio bundle al construirlo.

Desde la **raíz del repo**, y **sin pasar el código 2FA en la línea**:

```bash
node scripts/publish-sdk.mjs game-sdk
node scripts/publish-sdk.mjs strategies
node scripts/publish-sdk.mjs agent-sdk
(cd apps/mcp && npm publish)
```

Cada comando compila, empaqueta y **recién ahí frena y te pide el código**. Es
mucho mejor que `--otp=...`: el código rota cada 30 segundos y compilar tarda,
así que pasándolo en la línea llega vencido y npm contesta que hace falta una
contraseña de un solo uso. El `--otp=` existe para cuando no hay terminal
interactiva (CI), no para el uso a mano.

> ⚠️ Dos trampas, las dos vistas en vivo el 2026-09-11:
>
> - Si igual usás `--otp=`, el código va **sin los signos** `<` `>`: en bash son
>   redirección y el comando muere con `syntax error near unexpected token`
>   antes de ejecutar nada.
> - Los **paréntesis** del comando del MCP no son decorativos: mantienen el
>   cambio de carpeta adentro de ese comando. Con `cd apps/mcp && npm publish &&
cd ../..`, un publish fallido saltea el `cd` de vuelta y te deja parado en
>   `apps/mcp`, donde el reintento falla con "No such file or directory" y
>   parece otro problema.

El paquete del MCP compila solo al publicar (`prepublishOnly`), así que no hace
falta buildearlo antes.

Los cuatro hablan `/aleph/*` y firman con el literal `"aleph"`. Publicarlos
**antes** de que el árbitro esté desplegado dejaría a cualquiera que los instale
hablándole a rutas que todavía no existen.

Después de publicar, el registry oficial de MCP: desde `apps/mcp`,
`mcp-publisher login github` (login del dueño, no delegable) y
`mcp-publisher publish` con el `server.json` en 0.3.0.

---

## Qué se rompe a propósito (y por qué no duele)

- **Las salas guardadas se pierden.** La clave del store pasa de `vault` a
  `aleph`, así que lo guardado bajo la vieja no se recupera al reiniciar y las
  salas en curso durante el deploy se cortan. Es tolerable porque **la mesa es
  gratis**: no hay un centavo atado a una sala (las mesas de plata llegan en la
  etapa 4, con el contrato de N depósitos).
- **El ELO del formato arranca de cero.** El ranking se guardaba bajo la clave
  `vault`; el nuevo se guarda bajo `aleph`. El viejo queda huérfano, sin
  borrarse. El ELO de los seis juegos 1v1 **no se toca**.
- **`/vault/*` devuelve 404** y cualquier firma armada con el literal `"vault"`
  deja de validar. Ningún tercero dependía de eso: al momento del rename los
  paquetes 0.3.0 todavía no estaban en npm. Ese fue exactamente el motivo de
  hacerlo entonces y no después. (Ya están publicados, desde el 2026-09-11, y
  hablan `/aleph/*` desde la primera versión.)

## Reversa (si algo sale mal)

`git revert` del merge en `main` → auto-deploy → vuelve `/vault/*`. Si en el
paso 1 renombraste variables, volvé a crear las `VAULT_*` con los mismos
valores. Igual que a la ida, las salas en curso se pierden y el ELO vuelve a la
clave vieja (donde quedó intacto).

---

## Registro de ejecución

Completar al ejecutar, para que quede la evidencia:

- **Fecha:** los 4 pasos, el 2026-09-11.
- **¿Había variables `VAULT_*` en Render?** **Ninguna.** La etapa 1 se desplegó
  con los valores por defecto, así que no hubo nada que renombrar ni que se
  perdiera al cambiar el prefijo.
- **`curl /aleph/lobbies`:** respondió. Verificado desde la página en vivo
  `https://arcade1v1.com/aleph`, que mostró **"No table is forming"** y no el
  aviso de árbitro inalcanzable. La página distingue los dos casos a propósito,
  así que ese texto solo aparece cuando el árbitro contestó.
- **`curl /vault/lobbies` (contraprueba):** no hizo falta. La ruta vieja se
  borró en el mismo commit que creó la nueva: si `/aleph/*` contesta, es el
  árbitro nuevo, y en él `/vault/*` no existe.
- **Paquetes 0.3.0 publicados:** los 4, confirmados contra el registry
  (`game-sdk`, `strategies`, `agent-sdk`, `mcp`).
- **Dos tropiezos del camino, por si se repiten:** `--otp=` en la línea llega
  vencido (el código rota cada 30 s y compilar tarda), así que conviene dejar
  que npm lo pida; y `npm view` sirve una respuesta cacheada que puede tardar
  minutos en mostrar lo recién publicado — para verificar en el momento, consultá
  `https://registry.npmjs.org/@arcade1v1%2F<paquete>` directo.
