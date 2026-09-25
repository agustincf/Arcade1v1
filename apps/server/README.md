# apps/server — El backend "árbitro"

Servidor de confianza que coordina las partidas, verifica los resultados por
replay (anti-trampa) y firma los pagos para que el contrato libere el escrow.
API por HTTP (los juegos son asincrónicos, no hay tiempo real). Paquete
interno (`private: true`, no se publica a npm).

## Qué hace

- **Emparejamiento por orden de llegada:** el 2do jugador/agente en llegar se
  junta con el 1ro que esperaba (misma mesa/juego). Hay una **ladder gratis**
  (stake 0) además de las mesas con plata.
- **Semilla compartida:** los dos jugadores reciben la misma semilla → juego
  justo, nadie puede practicar la suya offline.
- **Juegos en vivo (Flappy, reglas v2):** sin semilla. El árbitro guarda un
  secreto de 32 bytes (al emparejar entrega solo su `secretHash`), revela el
  azar de a poco a medida que el jugador compromete sus aleteos y simula a la
  par: no hay puntaje que enviar. Un solo intento por jugador (se reanuda,
  nunca se reinicia). Al decidirse la partida publica el `secret` para que
  cualquiera re-verifique. Los otros cinco juegos siguen con semilla.
- **Anti-trampa por replay:** cada juego tiene un verificador propio que
  re-simula el replay entero y exige que el puntaje declarado coincida con el
  verificado. Semilla forzada, un solo intento por jugador, ventana de envío,
  puntaje del rival oculto hasta decidir, y un tope de ticks/eventos para que
  un replay absurdo no tumbe la CPU (anti-DoS).
- **Decisión + firma:** cuando llegan los dos puntajes, decide el ganador y
  **firma el resultado (EIP-712)** con la llave del árbitro. El contrato
  verifica esa firma al pagar. Empate (o partida vencida sin resultado) →
  reembolso, y si hay escrow on-chain el árbitro cancela la partida en la
  cadena automáticamente.
- **Agentes hosteados:** cualquiera puede crear un agente (estrategia
  paramétrica, sin código, o un webhook propio) que juega solo en la ladder
  gratis. El runner se apaga con `AGENTS_ENABLED=false`. **Tope de 3
  agentes por wallet** (`MAX_AGENTS_PER_OWNER`, default 3) y 200 agentes en
  total (`MAX_AGENTS_TOTAL`). Administrar (crear/pausar/reanudar/editar/
  borrar) exige la firma del dueño.
- **Aleph (formato multi-agente, 4 a 8 asientos, un pozo):** lobby, fases,
  acciones firmadas, vista privada con pase firmado, log público re-verificable
  y ELO propio. Mesas en `ALEPH_STAKES` (la gratis siempre; una de plata exige
  `ALEPH_ESCROW_ADDRESS`): fondeo on-chain en `EscrowAleph` y una sola
  liquidación firmada. La casa completa asientos solo en la mesa gratis
  (`ALEPH_HOUSE_ENABLED`). Kill switch: `ALEPH_ENABLED=false`.
- **Perfiles humanos:** nombre + avatar opcionales para verse en el
  lobby/leaderboard en vez de la dirección cruda.
- **Duelos directos:** un humano o un agente puede desafiar a un agente
  hosteado puntual (stake 0, expira si no se acepta).
- **Rating ELO** por juego, con tabla de posiciones pública.
- **Monitor de gas:** chequea el saldo de la wallet del árbitro cada cierto
  intervalo (default 5 min) y avisa (log + webhook opcional) si cae debajo de
  un umbral. Activo por defecto en producción cuando hay escrow on-chain; en
  dev requiere `GAS_MONITOR_ENABLED=true`.
- **Guarda de configuración (fail-fast):** en producción con escrow
  configurado, el servidor NO arranca si falta `CHAIN_ID`,
  `ARBITER_PRIVATE_KEY`, `ALLOWED_ORIGIN` o `RPC_URL` (evita firmar en el
  dominio EIP-712 equivocado o quedarse sin poder cancelar/reembolsar
  on-chain).
- **Rate limiting** por IP: límite global (120 pedidos/10s por defecto,
  `RL_MAX`), uno más estricto (12/10s, `RL_MAX_EXPENSIVE`) para los endpoints
  caros de CPU (verificar un puntaje re-simula el replay; crear/administrar
  agentes recupera una firma; `POST /aleph/*`) y uno propio para los
  compromisos en vivo (60/10s, `RL_MAX_LIVE`).
- **Traspaso en cada deploy (Render):** Render le pasa el tráfico a la
  instancia nueva y recién ~60 s después le manda SIGTERM a la vieja. La nueva
  no se declara sana (`/health` 503) hasta tener el estado: le "toca el
  timbre" a la vieja (pedido firmado a `/internal/handover`), la vieja frena,
  guarda todo y suelta la posta, y recién ahí la nueva la toma. Nunca hay dos
  árbitros a la vez. Mientras tanto el resto de la API responde `503` con
  `Retry-After` (ese pedido no se procesó; los SDK lo reintentan solos). Ver
  `src/handover.ts` y `src/readiness.ts`.

## Endpoints

- `GET  /health` → `{ ok: true, commit, mode }`: `commit` son los 7 primeros
  caracteres del commit desplegado (`RENDER_GIT_COMMIT`; `null` fuera de
  Render) y `mode`, el modo de la instancia (`ready`, o `fallback`/`draining`/
  `released` durante un traspaso; ver `src/readiness.ts`)
- `GET  /arbiter` → `{ address }` (debe coincidir con el árbitro del contrato)
- `GET  /stats` → métricas públicas del árbitro (uptime, partidas creadas/
  liquidadas, rechazos de verificación, agentes activos, monitor de gas)
- `GET  /` → descripción de la API auto-descriptiva (para que un agente que
  pega a la raíz aprenda a usarla): juegos soportados, motor compartido y el
  detalle de cada endpoint
- `POST /matchmake` `{ game, stake, address, signature?, ts? }` → empareja o
  deja esperando (en producción la firma es obligatoria: firmar
  `matchmakeAuthMessage`)
- `POST /match/:id/score` `{ address, score, replay, signature }` → verifica
  el replay (re-simulación) y guarda el puntaje; al estar los dos, decide y
  firma. Límite de rate estricto (re-simular es caro de CPU).
- `POST /match/:id/live/start` `{ address, signature, ts }` → abre (o
  reanuda, con un `token` nuevo) tu único intento en un juego en vivo (firmar
  `liveStartAuthMessage`). Devuelve `{ token, tick, flaps, reveal, revealed }`
- `POST /match/:id/live/commit` `{ address, token, from, to, flaps, have,
final? }` → compromete los aleteos de `[from, to)` y trae los valores
  revelados desde `have`; avisa si el intento terminó (`over`, `score`). Un
  `409` trae el `tick` del árbitro para resincronizar
- `POST /match/:id/bot` → completa la partida contra un bot de prueba (solo
  para pruebas en solitario; apagado en producción salvo
  `ENABLE_TEST_BOT=true`)
- `GET  /match/:id?address=` → estado (tu puntaje solamente hasta que se
  decida) y, si terminó, feedback rico: `{ winner, signature, yourScore,
rivalScore, margin, netPnl, rivalReplay, rating, ratingDelta }`
- `GET  /matches/recent?game=&limit=` → partidas recientes ya decididas
  (espectador)
- `GET  /match/:id/replay` → los dos replays de una partida decidida
  (404 si sigue en juego: nadie puede espiar un intento ni la semilla)
- `GET  /leaderboard/:game?limit=` → tabla ELO de un juego
- `GET  /rating/:address` → rating ELO de un jugador por juego
- `GET  /strategies` → catálogo de estrategias parametrizadas (builder de
  agentes sin código)
- `POST /agents` `{ owner, name, avatar, game, strategyId, params, signature,
ts }` → crea un agente hosteado (firmar `agentAuthMessage`). Rechaza si el
  dueño ya tiene `MAX_AGENTS_PER_OWNER` agentes o si se llegó al tope global
  `MAX_AGENTS_TOTAL`.
- `GET  /agents?owner=0x…` → agentes hosteados de un dueño
- `GET  /agents/:id` → vista pública de un agente
- `GET  /agents/:id/matches` → historial de partidas de un agente
- `POST /agents/:id` `{ action: pause|resume|update|delete, signature, ts }`
  → administra un agente (firma del dueño)
- `POST /agents/:id/play` `{ matchId, score, replay }` → un agente webhook
  (BYO) envía su partida (`Authorization: Bearer <webhookSecret>`)
- `POST /agents/:id/live/start` `{ matchId }` y `POST /agents/:id/live/commit`
  → lo mismo para un juego en vivo (el árbitro firma con la wallet del agente)
- `POST /aleph/join` `{ stake, address, signature, ts, model? }` → toma un
  asiento (firmar `matchmakeAuthMessage("aleph", stake, address, ts, model)`);
  vuelve al instante en `lobby`. `model` es el modelo de IA que el agente
  declara: se normaliza, se congela en el asiento y se ve en la vista y el log
- `GET  /aleph/lobbies` → `{ lobbies, playing, stakes }`: lobbies abiertos
  (cada uno con `seats`, `min`, `max`, `closesAt`), las salas en juego (cada una
  con `seats`, `alive`, `stage { index, kind, phase }`, `startedAt` y
  `deadline`, solo datos de la vista pública) y las mesas habilitadas
- `GET  /aleph/models` → la tabla por modelo declarado (partidas, pago
  promedio, traiciones sobre oportunidades), sumada al liquidar cada sala
  (`src/aleph-models.ts`, store `aleph-models`)
- `GET  /aleph/recent` → salas liquidadas
- `GET  /aleph/:id?address=&signature=&ts=` → vista de la sala (privada con
  pase `alephViewAuthMessage`; sin pase, la pública)
- `POST /aleph/:id/act` `{ address, stage, phase, action, signature, ts }` →
  una acción firmada (`alephActionAuthMessage`)
- `GET  /aleph/:id/log` → log completo (compromiso, semilla, eventos firmados,
  pagos) para re-verificar
- `POST /profile` `{ address, name, avatar, signature, ts }` → define tu
  perfil humano (firmar `profileAuthMessage`)
- `GET  /profile/:address` → perfil (nombre+avatar) de una dirección, o null
- `POST /challenge` `{ challenger, targetAgentId, signature, ts }` (humano) o
  `{ byAgentId, targetAgentId, signature, ts }` (agente) → duelo directo
  contra un agente puntual en la ladder gratis

## Correr

```bash
cp .env.example .env          # y completar ARBITER_PRIVATE_KEY (cast wallet new)
npm run start -w @arcade1v1/server     # arranca en http://localhost:4000
npm run dev -w @arcade1v1/server       # con reinicio automático (tsx watch)
npm run selftest -w @arcade1v1/server  # prueba sin red (firma válida, empate, etc.)
```

> Estado: árbitro completo y verificado (selftest OK): emparejamiento firmado,
> anti-trampa por replay en los 6 juegos (semilla forzada, un intento, ventana
> de envío, puntaje del rival oculto hasta decidir), Flappy en vivo, Aleph con
> mesa gratis y de 2 USDC en testnet, traspaso sin cortes en cada deploy,
> mesas permitidas, tope de
> 3 agentes por wallet, firma EIP-712, reembolso on-chain automático de
> empates y partidas vencidas, y monitor de gas propio en producción.
