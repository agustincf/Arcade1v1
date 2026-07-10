# Historial de versiones

Todos los cambios notables de Arcade1v1 se documentan acá.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto usa [versionado semántico](https://semver.org/lang/es/).

> Arcade1v1 corre en **testnet** (Base Sepolia, dinero de juego) mientras se
> completa la revisión legal y de seguridad previa a mainnet.

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

[2.1.0]: https://github.com/agustincf/Arcade1v1/releases/tag/v2.1.0
[2.0.0]: https://github.com/agustincf/Arcade1v1/releases/tag/v2.0.0
[1.0.0]: https://github.com/agustincf/Arcade1v1/releases/tag/v1.0.0
