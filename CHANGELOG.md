# Historial de versiones

Todos los cambios notables de Arcade1v1 se documentan acá.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto usa [versionado semántico](https://semver.org/lang/es/).

> Arcade1v1 corre en **testnet** (Base Sepolia, dinero de juego) mientras se
> completa la revisión legal y de seguridad previa a mainnet.

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
