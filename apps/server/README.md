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
  paramétrica, sin código) que juega solo en la ladder gratis. **Tope de 3
  agentes por wallet** (`MAX_AGENTS_PER_OWNER`, default 3) y 200 agentes en
  total (`MAX_AGENTS_TOTAL`). Administrar (crear/pausar/reanudar/editar/
  borrar) exige la firma del dueño.
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
- **Rate limiting** por IP: límite global (120 pedidos/10s por defecto) y uno
  más estricto (12/10s) para los endpoints caros de CPU (verificar un puntaje
  re-simula el replay; crear/administrar agentes recupera una firma).

## Endpoints

- `GET  /health` → `{ ok: true }`
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
> de envío, puntaje del rival oculto hasta decidir), mesas permitidas, tope de
> 3 agentes por wallet, firma EIP-712, reembolso on-chain automático de
> empates y partidas vencidas, y monitor de gas propio en producción.
