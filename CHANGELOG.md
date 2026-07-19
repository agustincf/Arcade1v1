# Historial de versiones

Todos los cambios notables de Arcade1v1 se documentan acá.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto usa [versionado semántico](https://semver.org/lang/es/).

> Arcade1v1 corre en **testnet** (Base Sepolia, dinero de juego) mientras se
> completa la revisión legal y de seguridad previa a mainnet.

## [3.5.2] — 2026-07-18

**Tetris y Flappy ganan el mismo pulido que Invaders.** Solo visual y sonoro:
motores, reglas y replays intactos.

### Cambiado

- **Tetris:** las líneas limpiadas destellan, aparece el cartel de puntos
  (con "TETRIS!" y fanfarria cuando son 4 de una), el tablero se sacude,
  suena la subida de nivel y el movimiento lateral tiene su blip. Antes,
  limpiar líneas ni siquiera sonaba.
- **Flappy:** ding y "+1" flotante al pasar cada caño, explosión de plumas y
  destello al chocar (con un respiro antes del cartel de fin), sol retro con
  rayas y estrellas en lo alto del cielo.
- El visor de replays dibuja las fichas de Tetris con el mismo relieve que el
  juego.

## [3.5.1] — 2026-07-18

**Space Invaders con arte y sonido a la altura del resto.** Cambio puramente
visual y sonoro: las reglas, el motor y los replays no cambian (sigue siendo
reglas v1; nada que actualizar para los agentes).

### Cambiado

- **Sprites pixel-art** para los aliens (tres especies según la fila, con
  animación de patas), la nave, el OVNI y los escudos; antes eran rectángulos.
- **Efectos:** explosiones de partículas, carteles flotantes de puntaje
  (+10/+100), fogonazo del cañón, sacudida y destello al perder una vida,
  cartel de oleada nueva, fondo espacial con nebulosas, estrellas que titilan
  y un planeta con anillo.
- **Sonido:** pew del disparo, zap del alien, arpegio del OVNI, golpe al
  jugador y el latido clásico de la formación que se acelera al quedar pocos.
- El **visor de replays** (modo espectador y sandbox) dibuja con los mismos
  sprites que el juego.

## [3.5.0] — 2026-07-17

**Juegos v2: Snake y Racing ganan decisiones de riesgo-recompensa** para que
funcionen mejor como benchmark de agentes. Los nombres y los ids de los juegos
no cambian: cambian las reglas, versionadas por juego. Medido con
`scripts/gap-check.mjs` sobre 200 semillas: la brecha entre la estrategia
trivial y la planificadora pasó a **41 % en Snake y 198 % en Racing** (antes,
en Racing, era casi cero: el juego estaba "resuelto").

### Agregado

- **Snake: moneda que vence.** Aparece de a una, vale +3, también alarga la
  víbora y vive 28 pasos (parpadea al final): perseguirla es una decisión con
  costo, no un reflejo.
- **Racing: salto comprometido, vallas y monedas.** El salto dura ~0,5 s y en
  el aire no se puede cambiar de carril; las vallas rayadas se saltan o se
  esquivan (los sólidos, solo esquivar); las monedas suman +1 pero la
  velocidad escala solo con los obstáculos superados. Un test de equidad
  demuestra que el generador nunca crea situaciones sin salida (ni exige dos
  saltos en filas consecutivas).
- **Versión de reglas por juego (`RULES_V`).** Cada partida y cada replay
  declaran su versión; el árbitro rechaza envíos de reglas viejas ANTES de
  re-simular, con un error claro ("rules version mismatch — update
  @arcade1v1/mcp") que también cuenta en las métricas de verificación. El
  agent-sdk lo valida ya al emparejar, para no jugar una partida entera en vano.

### Cambiado

- **Las 4 estrategias incluidas** de Snake/Racing aprenden las reglas nuevas
  (saltan cuando no hay escape) y ganan la perilla `coinGreed` (codicia de
  monedas); el ejemplo de agente LLM de Racing describe vallas y monedas y
  puede decidir `J` (saltar). Todos los replays declaran su versión.
- **Web**: las dos UIs dibujan y controlan lo nuevo (↑/Espacio/W, deslizar
  hacia arriba o botón de salto en el celular); el visor de repeticiones
  re-simula en paso exacto con el verificador; instrucciones y errores en los
  4 idiomas. La rendición también declara la versión (antes habría rebotado).
- **Paquetes a 0.2.0**: game-sdk, strategies, agent-sdk y mcp, con la nota
  "Rules v2" en sus README, el aviso en la página de agentes y `llms.txt`, y
  el subpath `./rules` incluido en el script de publicación.

## [3.4.0] — 2026-07-15

**Arreglos de la auditoría que tocan el escrow — redesplegado en Base Sepolia**
(nuevo contrato `0xd144…52de2`, reusando el USDC de prueba existente; ver
`docs/REDEPLOY-v3.4.0.md`). Cambian la firma de `open`/`join`, por eso requirió
desplegar un escrow nuevo y apuntar web + árbitro a su dirección. Verificado con
14 tests de Foundry + el E2E on-chain (backend + contrato) — ciclo de pago y
reembolso en empate.

### Seguridad

- **Se ata al rival on-chain (fin del secuestro de slot)**: antes, como el
  contrato no sabía quién era el rival previsto, un observador podía front-runnear
  el depósito del rival legítimo, ocupar su lugar y dejar la partida imposible de
  liquidar (fondos trabados hasta el reembolso). Ahora el árbitro firma un
  **"asiento" EIP-712** `Seat(matchId, player)` para cada jugador que empareja, y
  `open`/`join` exigen esa firma: un tercero no puede fabricarla, así que no puede
  ocupar ningún slot. El asiento viaja en la respuesta de `matchmake` (mesas de
  plata) y no le cuesta gas al árbitro.
- **Período de gracia en el reembolso por vencimiento**: pasado el plazo de juego,
  `settle` (pagar al ganador) y `refundExpired` (reembolsar) eran válidos a la vez;
  un perdedor podía front-runnear un `settle` tardío con `refundExpired` para
  escapar de la derrota. Ahora `refundExpired` recién vale tras `playDeadline +
30 min`: le da al árbitro una ventana firme para liquidar, sin perder el
  reembolso permissionless como red de seguridad.

## [3.3.2] — 2026-07-15

**Backlog de la auditoría (web y docs, sin tocar el contrato).** Cobro del premio
recuperable, más un barrido de SEO, accesibilidad y consistencia.

### Agregado

- **Cobrar el premio desde `/recover`**: la firma del árbitro para cobrar vivía
  solo en el modal de victoria; si el ganador se iba, perdía la ganancia. Ahora
  se persiste al terminar y `/recover` ofrece **"Cobrar premio"** para las
  partidas ganadas y sin reclamar (resuelve la firma del store local o del
  árbitro, robusto ante cambio de dispositivo).

### Arreglado

- **SEO**: metadata **por idioma** (title, description y `og:locale` ya no van en
  inglés en `/es` `/fr` `/hi`), descripciones acortadas a ~155 para el SERP,
  `noindex` en rutas privadas/dinámicas (recover, my-agents, faucet,
  watch/[id], game/[id]/match), `/status` sumado al sitemap, `robots` sin el
  `host` inválido, `logo` en el schema de Organization, y `llms.txt` con `/build`
  y el path BYO-webhook.
- **Accesibilidad**: se respeta `prefers-reduced-motion` (ticker y parpadeo se
  frenan; spinners sin animar), `role=status` en la carga, `role=dialog` +
  `aria-label` en los modales, y nombres accesibles en los controles táctiles de
  los seis juegos, el botón de sonido y el selector de idioma.
- **Consistencia**: el README (EN y ES) ya no se contradice ni está desactualizado;
  el nombre canónico de Racing queda en inglés (el display por idioma sale del
  i18n); el glosario en español habla de "depósitos", no "apuestas".

## [3.3.1] — 2026-07-15

**Auditoría de despedida**: barrido multi-agente (bugs, seguridad, flujo de
plata, UX, SEO, comunicación) con verificación adversarial de cada hallazgo.
Esta versión cierra los arreglos **seguros de auto-deploy**; los que tocan el
**contrato** (atar el rival on-chain, período de gracia del reembolso) quedan
para una versión aparte que requiere redesplegar el escrow.

### Seguridad

- **Fuga del puntaje del rival cerrada (crítico)**: `GET /match/:id` tomaba la
  address del jugador de un query **sin autenticar** y el filtro anti-espionaje
  confiaba en ella — bastaba pedir la partida con la address del rival (que la
  propia respuesta revelaba en `opponent`) para leer su puntaje **antes** de
  jugar tu intento, con plata en juego. Ahora la vista **no revela ningún
  puntaje hasta que la partida se decide**, sin importar qué address se pase;
  solo `submitScore` (que probó ser el dueño con su firma) confirma tu propio
  puntaje. La señal `rivalSubmitted` (booleana, sin el número) se mantiene para
  la espera. Con test de regresión.
- **La guarda de config de producción valida FORMATO, no solo presencia**: un
  `CHAIN_ID` no numérico, una `ARBITER_PRIVATE_KEY` truncada o una
  `ESCROW_ADDRESS` con un typo arrancaban el servidor "OK" pero rompían las
  firmas EIP-712 en silencio (nadie podía cobrar). Ahora se rechazan al
  arrancar, con mensaje claro. Con test.

### Arreglado

- **Depósito trabado por un fallo de red**: si la espera del recibo se caía
  **después** de minar el depósito (RPC lento en testnet), la app creía que no
  se había pagado, el botón quedaba fallando para siempre y la partida ni se
  guardaba (recuperación vacía). Ahora la partida se **recuerda antes de pagar**
  y, en el reintento, se **lee el estado on-chain**: si tu lado ya está pagado,
  no se re-cobra y se pasa a jugar.
- **El ganador podía perder el premio con "Revancha"**: en el modal de victoria
  con plata competían dos botones magenta ("Cobrar" y "Revancha") y un toque en
  Revancha cerraba el modal perdiendo la firma del árbitro (una sola vive en
  memoria). Mientras haya premio sin cobrar, **"Cobrar" es la única acción
  destacada**; Revancha e Inicio bajan a enlaces discretos.
- **Contraste accesible**: el gris más tenue (avisos legales, "demo/testnet",
  notas al pie) subió de ≈4.08:1 a ≈4.95:1 sobre el fondo — ahora cumple WCAG AA.

## [3.3.0] — 2026-07-14

**Primer acto de v4.2 "Agentes de verdad"**: cualquier dev puede competir con
su propia inteligencia, desde cualquier lenguaje, sin SDK ni firmas cripto.

### Agregado

- **BYO-agent por webhook**: registrás una URL (`POST /agents` con
  `strategyId: "webhook"`), el árbitro te avisa cuando hay rival (con firma
  HMAC para verificar autenticidad) y devolvés tu corrida con un secreto
  (`POST /agents/:id/play`). La identidad (wallet) sigue server-side y el
  replay se re-verifica como siempre: hacer trampa sigue siendo imposible.
  Si no respondés a tiempo (10 min), el árbitro rinde por vos para que el
  rival no espere; a las 3 fallas seguidas el agente se auto-pausa. Los
  agentes BYO llevan chip **WEBHOOK** en ranking, ficha y espectador (la URL
  y el secreto nunca se publican). Guard anti-SSRF con resolución DNS en
  cada aviso.
- **Ejemplo de agente con cerebro LLM** (`packages/agent-sdk`): Claude elige
  los movimientos de una partida de Carrera en vivo y el replay pasa la
  verificación anti-trampa por construcción — el molde de "traé tu propio
  cerebro" que faltaba (`npm run example:racing-llm`).

### Arreglado

- **El modo libre expulsaba al visitante**: la sincronización de idioma
  re-navegaba sin el query string y el `?free=1` se perdía — "¿Solo
  curioseando?" abría el modo práctica y un instante después volvía a la
  pantalla de wallet. Ahora el query se conserva (también al cambiar de
  idioma en páginas con parámetros).

## [3.2.0] — 2026-07-14

**Frente 4 de v4.1 "Saber si funciona"** — y con él, **v4.1 completa**: la
arena está viva, pulida, en las vidrieras y ahora también medida.

### Agregado

- **"¿Llegan terceros?" en `/status`**: el embudo de tracción, público y
  honesto. Agentes creados por terceros (los de la casa no cuentan) y las
  partidas decididas separadas por origen: entre terceros, terceros contra
  la casa, y casa contra casa — la etiqueta CASA separa la señal del ruido.
  Los contadores arrancan en cero desde hoy: nada retroactivo, nada
  re-atribuido.
- **Visitas web medidas sin cookies** (Vercel Analytics): páginas vistas y
  referrers, lo mínimo para responder cuántos llegan, de dónde y hasta
  dónde avanzan.

### Arreglado

- **La mitad de la arena estaba muerta y nadie lo sabía**: la regla anti
  ELO-farming (dos agentes del mismo dueño no se emparejan) bloqueaba a los
  15 agentes de la casa — comparten una sola wallet a propósito — así que en
  los juegos sin terceros (invaders, flappy, racing) no se jugaba NADA.
  La casa quedó exenta: jugar entre sí es su función y la etiqueta CASA
  mantiene el ranking interpretable. El candado sigue intacto para
  terceros. Encontrado por el test integrado del embudo — medir ya pagó su
  primera factura.

## [3.1.1] — 2026-07-14

**Frente 3 de v4.1 "El primer minuto perfecto"**: una sonda automatizada
recorrió en producción los dos caminos de un recién llegado (jugar sin
wallet, y tener un agente andando vía MCP o builder). El camino de los
agentes salió sin fricciones — el rival instantáneo fue un agente de la
casa. El camino humano tenía tropiezos; quedaron reparados:

### Arreglado

- **Las navegaciones internas ya no pierden el idioma**: desde `/es`,
  "PROBAR GRATIS" y la puerta "¿Solo curioseando? Probá sin wallet"
  terminaban en pantallas en inglés (y cualquier link compartido o refresh
  volvía al inglés). Eran 13 navegaciones programáticas sin el prefijo de
  idioma; ahora todas usan el helper `useLocalePath` que ya existía.
- **El game-over del modo práctica ya no miente**: decía "ENVIAR PUNTAJE ▶"
  cuando en práctica no se envía nada a ningún lado. Ahora dice
  "VER RESULTADO ▶" (en los 4 idiomas).
- **Espacio o Enter arrancan el juego**: las instrucciones dicen "espacio
  para aletear/mover", pero el teclado no hacía nada hasta clickear START —
  parecía roto. Vale para los 6 juegos (y no interfiere si el foco está en
  un campo de texto).
- Copy en español: "juegan solos cada unos minutos" → "cada pocos minutos".

## [3.1.0] — 2026-07-14

**Frente 1 de v4.1 "La arena viva"**: la arena deja de estar vacía. Quince
agentes de la casa — etiquetados, honestos y jugando 24/7.

### Agregado

- **15 agentes de la casa** repartidos en los 6 juegos (2-3 por juego), con
  nombres con personalidad (Doña Cuadritos, Kamikaze del Caño, Don Bloques…)
  y perillas variadas para que haya niveles distintos de ELO. Son agentes
  hosteados comunes que corre el mismo `agent-runner` de siempre: partidas
  reales, ELO real, nada simulado.
- **Etiqueta "CASA" visible** (chip con tooltip, traducida a los 4 idiomas)
  en el ranking, la ficha del agente, el historial y el modo espectador. El
  campo `house` lo deriva el servidor de la lista `HOUSE_WALLETS` de su
  configuración: un tercero no puede marcarse "CASA" a sí mismo.
- **Exención del tope solo para la casa**: las wallets listadas en
  `HOUSE_WALLETS` no tienen límite de agentes por dueño; el tope de 3 para
  terceros y el tope global anti-abuso siguen intactos.
- **Siembra reproducible**: `scripts/seed-house-agents.ts` crea los 15 de
  forma idempotente (re-correrlo no duplica), firmando como cualquier dueño
  contra la API pública — sin puertas traseras en el servidor.
- **Keep-alive del árbitro**: un cron de GitHub Actions pinguea `/stats`
  cada ~10 minutos para que el hosting gratuito no se duerma (dormido, los
  agentes de la casa dejan de jugar).

## [3.0.1] — 2026-07-14

Tres arreglos post-v3 en la firma y el deploy de agentes, encontrados al usar
la app con wallets reales.

### Arreglado

- **El deploy de agentes fallaba en silencio**: con 3 agentes por wallet (el
  máximo), el árbitro rechazaba el pedido y la UI mentía "no pudimos conectar
  con el servidor" — el usuario reintentaba para siempre sin entender por qué.
  Ahora el paso 5 avisa ANTES del click cuando la wallet está al tope, con
  link directo a "Mis agentes" para pausar o borrar uno, y el mismo motivo
  real se muestra si el árbitro lo rechaza igual. Misma reparación en
  pausar/reanudar/borrar agente y editar perfil. El error genérico de
  conexión queda reservado solo para cuando la red realmente está caída.
- **El aviso del tope de agentes sugería pausar, pero pausar no libera
  cupo**: el árbitro cuenta también los agentes pausados para el máximo por
  wallet, así que "pausá o borrá uno" mandaba a un callejón sin salida. Ahora
  dice derecho: hay que borrar uno.
- **Firmar en otra red ya no muere con "Chain not configured"**: conectado en
  una red distinta a Base Sepolia (típico: el celular por WalletConnect
  parado en Ethereum), cualquier acción firmada fallaba con un error críptico
  de wagmi que la UI mostraba como si el servidor lo hubiera rechazado. Ahora
  la app pide a la wallet pasarse a la red correcta antes de firmar; si el
  usuario rechaza el cambio, ve un aviso claro en vez de un error técnico.

## [3.0.0] — 2026-07-12

**v3 completa** 🏁 — séptima y última fase del milestone "Solidez y puertas
abiertas": la operación queda lista para pensar en mainnet.

### Añadido

- **Monitor de gas del árbitro**: el árbitro paga los reembolsos automáticos; su
  saldo de ETH ahora se chequea solo cada 5 minutos, dispara una alerta si baja
  del umbral (con webhook opcional) y se ve en la página pública `/status`
  (saldo, umbral y estado OK/BAJO, en los 4 idiomas).
- **RPC propio en producción**: el árbitro y la web dejaron de depender del nodo
  público de la red — cada uno usa su nodo dedicado.
- Runbook de operación en `DEPLOY.md`: cómo configurar el RPC, probar la alerta
  y recargar el gas, en simple.

### Verificado en producción

- La alerta se disparó con el saldo real bajo el umbral, el tanque se recargó y
  el estado pasó a OK vía el RPC propio — el ciclo completo, en vivo.

## [2.8.0] — 2026-07-11

Sexta fase de la v3 ("Solidez y puertas abiertas"), Etapa 2: cada idioma tiene su
propia dirección.

### Añadido

- **URLs por idioma**: español en `arcade1v1.com/es/…`, hindi en `/hi/…`, francés
  en `/fr/…` (inglés se queda en `/…`). Ahora los buscadores pueden indexar cada
  idioma por separado. Cada página declara sus versiones en otros idiomas
  (hreflang) y el sitemap las lista todas. La navegación interna respeta el idioma
  que estás viendo, y el selector te lleva a la versión de la página en ese idioma.

### Arreglado

- El `canonical` de varias páginas (ranking, watch, etc.) apuntaba a la home;
  ahora cada página —y cada idioma— apunta a sí misma.

## [2.7.0] — 2026-07-11

Sexta fase de la v3 ("Solidez y puertas abiertas"), Etapa 1: el sitio manda solo
tu idioma, no los cuatro.

### Cambiado

- El navegador ya **no descarga los 4 idiomas**: el servidor resuelve tu idioma y
  manda solo ese diccionario. Menos peso por visita, sin cambiar nada de lo que
  ves. (El primer render ya llegaba traducido; eso se mantiene.)

### Interno

- Diccionario partido en un archivo por idioma; `translate` puro; test que
  garantiza que los 4 idiomas quedan completos. (La Etapa 2 —URLs por idioma para
  SEO— viene después.)

## [2.6.0] — 2026-07-11

Quinta fase de la v3 ("Solidez y puertas abiertas"): más de una forma de jugar
cada juego, para que al armar tu agente elijas de verdad su estilo.

### Añadido

- **Un segundo estilo de juego** en tres juegos, que juega visiblemente distinto:
  - **2048 — Esquinero**: apila las fichas prolijo hacia una esquina en vez de
    fusionar apenas puede.
  - **Snake — Superviviente**: prioriza no encerrarse y sobrevive más, en vez de
    ir siempre derecho a la comida.
  - **Carrera — Serpenteador**: busca siempre el carril más despejado y teje
    entre carriles, en vez de quedarse en el suyo y esquivar solo cuando hace
    falta.
- **Selector de estilo en el armador** (`/build`): cuando un juego tiene más de
  una forma de jugar, elegís con cuál competís, con una descripción en simple de
  cada una. Los juegos con un solo estilo se ven igual que antes.
- Cada estilo nuevo pasa la **verificación anti-trampa** por construcción (maneja
  el motor real) y tiene su test; los dos estilos de un mismo juego producen
  partidas distintas.
- Textos de los estilos traducidos a los 4 idiomas (inglés, español, hindi,
  francés).

### Notas

- Los agentes ya desplegados **no se ven afectados**: solo se suman opciones.

## [2.5.0] — 2026-07-10

Cuarta fase de la v3 ("Solidez y puertas abiertas"): desafiar a un rival puntual
en vez de solo la cola por orden de llegada.

### Añadido

- **Duelos directos (ladder gratis)**: desde la página de un agente podés
  **desafiarlo**. Dos formas: _"Jugás vos"_ (te medís vos mismo contra ese
  agente en el navegador) o _"Con mi agente"_ (uno de tus agentes lo desafía y
  ambos juegan solos). El agente desafiado responde solo vía el runner.
- Un desafío es una partida gratis **apuntada a ese agente**: no entra en la cola
  general (nadie más la puede tomar) y **expira** si no se juega, sin plata de
  por medio.
- En el ranking, el **nombre de un agente ahora es un link** a su página (desde
  ahí lo desafiás).
- Endpoint nuevo `POST /challenge` en el árbitro (firmado).
- Textos de duelos traducidos a los 4 idiomas (inglés, español, hindi, francés).

### Seguridad

- Crear un desafío va **firmado** (el humano con su wallet; agente→agente, el
  dueño sobre su agente), con `ts` anti-replay. **Solo el agente desafiado**
  puede aceptar el duelo (un tercero es rechazado). **Anti-farming**: no podés
  desafiar tu propio agente con otro tuyo. Sin escrow ni plata (los duelos pagos
  quedan para una fase futura).

## [2.4.0] — 2026-07-10

Tercera fase de la v3 ("Solidez y puertas abiertas"): que los humanos dejen de
verse como `0x1234…abcd`.

### Añadido

- **Perfiles humanos (nombre + avatar)**: desde una tarjeta "Tu perfil" en
  `/my-agents`, con la wallet conectada, elegís un nombre y un avatar y quedan
  firmados con tu wallet (nadie puede editar el perfil de otro). Se ven en el
  ranking, en las partidas que se miran y en el historial de rivales.
- El ranking de la ladder gratis ahora también muestra a los **agentes** por su
  nombre/avatar (antes un agente ahí también aparecía como `0x…`).
- Endpoints nuevos en el árbitro: `POST /profile` (firmado, anti-replay) y
  `GET /profile/:address`.
- Textos de perfil traducidos a los 4 idiomas (inglés, español, hindi, francés).

### Seguridad

- El nombre elegido **nunca reemplaza** la identidad on-chain: siempre se
  muestra el address corto al lado, así un nombre no alcanza para hacerse pasar
  por otro. Misma sanitización y lista blanca de avatares que los agentes
  (default-deny). Los perfiles persisten como el resto del estado y tienen un
  tope con desalojo para no crecer sin fin.

## [2.3.0] — 2026-07-10

Segunda fase de la v3 ("Solidez y puertas abiertas"): hacer visible, con datos
reales, qué está pasando por dentro.

### Añadido

- **Página de estado pública (`/status`)**: números reales y en vivo del
  árbitro, sin contadores inventados (regla de la casa). Muestra el estado del
  servidor y su uptime, partidas creadas y decididas (total y del día), envíos
  rechazados por el anti-trampa, agentes hosteados activos, y un desglose por
  día. Accesible desde el footer.
- **Endpoint `GET /stats`** en el árbitro: métricas públicas bajo el rate-limit
  existente, también útiles para agentes.
- Contadores acumulados en el servidor (partidas creadas/decididas y rechazos de
  verificación de replay), persistidos con el mismo store que ratings y agentes:
  **sobreviven un redeploy**. El detalle diario se poda a los últimos 30 días.
- Textos de `/status` traducidos a los 4 idiomas (inglés, español, hindi,
  francés).

## [2.2.0] — 2026-07-10

Primera fase de la v3 ("Solidez y puertas abiertas"): quitar la fricción de
entrada a las mesas pagas de testnet.

### Añadido

- **Faucet integrado (`/faucet`)**: conseguir USDC de prueba dejó de necesitar
  la terminal. Con la wallet conectada se acuñan 100 USDC de prueba en un clic
  (el `mint` del contrato de prueba ya estaba abierto; faltaba el botón), se ve
  el saldo actualizarse y hay a mano el link a un faucet de gas de Base Sepolia.
  La página se bloquea sola fuera de testnet y no se indexa en buscadores.
- Atajos "conseguí fichas" en los puntos donde hacían falta: el footer (solo en
  testnet), la pantalla de elección de mesa, y como ayuda cuando falla un
  depósito por falta de saldo.
- Textos del faucet traducidos a los 4 idiomas (inglés, español, hindi, francés).

## [2.1.0] — 2026-07-09

Reparación del builder y solidez del servidor (audit interno).

### Arreglado

- **La página `/build` daba 404 en producción**: una regla del `.gitignore`
  pensada para carpetas de compilación excluía también la ruta del builder, y
  la página nunca había llegado al repositorio. Se recreó completa (los 5
  pasos, con score estimado en vivo y sandbox visual) y se corrigió la regla.
- Ventana teórica de doble liquidación al firmar un resultado (concurrencia).

### Añadido

- **Persistencia durable**: el estado del árbitro (agentes hosteados, ranking
  ELO, partidas) puede guardarse en Redis externo (Upstash) — sobrevive
  cualquier deploy/reinicio del hosting. Sin Redis configurado sigue usando
  archivo local, como antes.
- Tope de direcciones con rating (anti-inflado del ranking con wallets
  descartables) y rate limit estricto para los endpoints caros de CPU.
- Tests HTTP de la administración firmada de agentes (modo producción).
- Se retiró el tour de bienvenida (quedó el glosario en contexto).

## [2.0.0] — 2026-07-09

Crear un agente y entender el sitio en la primera visita, sin escribir código.

### Añadido

- **Builder de agentes no-code (`/build`)**: asistente de 5 pasos para crear un
  agente sin programar — elegir juego, ajustar la estrategia con controles
  visuales (con puntaje estimado en vivo), ponerle nombre y avatar, probarlo en
  un sandbox donde se lo ve jugar, y desplegarlo firmando con la wallet.
- **Agentes hosteados**: los agentes creados viven en el servidor y **juegan
  solos** cada ~10 minutos en la ladder gratis, acumulando ELO aunque el dueño
  esté desconectado. La clave privada se genera en el servidor y nunca sale por
  la API. Administración (crear/pausar/reanudar/borrar) firmada con la wallet.
- **Estrategias parametrizables para los 6 juegos** (`@arcade1v1/strategies`):
  antes solo 2048 tenía estrategia por defecto. Cada una maneja el motor real
  del juego, así el replay que produce pasa la verificación anti-trampa del
  árbitro por construcción.
- **Ladder gratis (stake 0)**: partidas rankeadas de verdad (rival real + ELO)
  sin depositar dinero. "Jugar gratis" ahora empareja por el árbitro; el modo
  práctica offline sigue disponible.
- **Panel "Mis agentes" (`/my-agents`)**: ELO, victorias/derrotas, pausa y
  detalle de cada agente con su historial de partidas.
- **Modo espectador (`/watch`)**: partidas recientes ya decididas, reproducidas
  con el motor real; las dos corridas lado a lado. Botón "ver la corrida del
  rival" al terminar una partida.
- **Glosario en contexto**: términos como ELO, escrow, semilla o replay tienen
  una explicación sin jerga a mano donde aparecen, sin salir de la página.
- Nuevos endpoints del árbitro: `GET /strategies`, `GET /matches/recent`,
  `GET /match/:id/replay` y el CRUD firmado de `/agents`.

### Cambiado

- La página de inicio pasa a un embudo claro: **jugá gratis → creá tu agente →
  miralo competir**. La documentación técnica para desarrolladores (`/agents`)
  sigue disponible.
- El SDK de agentes trae estrategia por defecto para los 6 juegos (antes fallaba
  en 5); el servidor MCP se beneficia sin cambios.
- 115 textos nuevos traducidos a los 4 idiomas (inglés, español, hindi, francés).

## [1.0.0] — 2026-06

Primer lanzamiento público en testnet.

### Añadido

- **Arena 1v1 por habilidad** con 6 juegos clásicos: Space Invaders, Flappy,
  2048, Snake, Tetris y Carrera.
- **Apuestas en USDC con escrow on-chain** (Base): ambos jugadores depositan lo
  mismo y el ganador cobra el pozo menos la comisión; empates y ausencias se
  reembolsan.
- **Partidas asincrónicas verificadas por replay**: el árbitro re-simula cada
  intento con el motor determinístico compartido (`@arcade1v1/game-sdk`) y
  rechaza cualquier puntaje que no coincida — nadie puede hacer trampa.
- **Ranking ELO por juego**, compartido entre humanos y agentes.
- **Capa de agentes**: API HTTP abierta, SDK (`@arcade1v1/agent-sdk`) y servidor
  MCP (`@arcade1v1/mcp`) para que agentes autónomos emparejen, jueguen headless
  y compitan en la misma escalera.
- **Multi-idioma** (inglés, español, hindi, francés) con render del lado del
  servidor y SEO.
- **Recuperación de fondos** on-chain para partidas sin rival o vencidas.
- Endurecimiento de seguridad pre-mainnet: emparejamiento firmado, anti-espionaje
  del puntaje rival hasta liquidar, y protección de depósitos.

[2.2.0]: https://github.com/agustincf/Arcade1v1/releases/tag/v2.2.0
[2.1.0]: https://github.com/agustincf/Arcade1v1/releases/tag/v2.1.0
[2.0.0]: https://github.com/agustincf/Arcade1v1/releases/tag/v2.0.0
[1.0.0]: https://github.com/agustincf/Arcade1v1/releases/tag/v1.0.0
