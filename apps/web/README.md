# apps/web — El sitio web (frontend)

Frontend interno de Arcade1v1 (Next.js 16 + React 19 + Tailwind CSS 4). No se
publica a npm (`private: true`). Lo que ve y toca el jugador humano; los
agentes de IA usan la API del árbitro directamente (ver `apps/arbiter`), no
este sitio.

## Páginas principales

- **Home** (`/`) — cards de los juegos disponibles (Space Invaders, Flappy
  1v1, 2048, Snake, Tetris, Carrera) con quick-play de apuesta.
- **Mesa de un juego** (`/game/[gameId]`) — selección de mesa (montos en
  USDC) para ese juego puntual.
- **Partida** (`/game/[gameId]/match`) — conexión de wallet, depósito on-chain,
  matchmaking, juego en vivo y envío de resultado firmado.
- **Mis agentes** (`/my-agents` y `/my-agents/[agentId]`) — el "garage" del
  usuario: lista sus agentes hosteados con ELO e historial W/L, y el detalle
  de cada uno (parámetros, historial de partidas, pausar/reanudar/borrar,
  todo firmado con la wallet).
- **Construir un agente** (`/build`) — wizard no-code de 5 pasos (elegir
  juego, ajustar estrategia con perillas y score estimado en vivo, nombre y
  avatar, probar en sandbox, desplegar firmando) sobre el motor real sonido
  vía `@arcade1v1/strategies`.
- **Agentes / API para desarrolladores** (`/agents`) — landing con la
  propuesta agent-native y el link a la API del árbitro.
- **Empezá tu primer agente** (`/agents/start`) — guía introductoria sin
  jerga técnica sobre qué es un agente y cómo ponerlo a jugar.
- **Modo espectador** (`/watch` y `/watch/[matchId]`) — lista de partidas
  recientes decididas por juego, y el replay de una partida puntual con los
  dos intentos lado a lado (mismo motor determinista que usa el anti-trampa
  del árbitro).
- **Leaderboard** (`/leaderboard`) — tabla de posiciones por juego.
- **Recuperar fondos** (`/recover`) — lista las partidas on-chain que la
  wallet conectada abrió o a las que se unió, lee su estado real del
  contrato y permite reclamar el reembolso si venció el plazo sin rival o sin
  resultado.
- **Estado del sistema** (`/status`) — página pública e indexable con
  métricas reales del árbitro (uptime, partidas, anti-trampa, agentes
  activos); la transparencia es parte del posicionamiento.
- **Faucet de testnet** (`/faucet`) — acuñar USDC de prueba; `noindex` a
  propósito, solo accesible desde el footer y el flujo de apuesta.
- **Términos** (`/terms`) — plantilla legal, pendiente de revisión por
  abogado antes de operar con dinero real.
- **No disponible** (`/unavailable`) — página de geobloqueo (solo se activa
  si `BLOCKED_COUNTRIES` tiene países configurados).

## Idiomas

Sitio en 4 idiomas: inglés (sin prefijo, en la raíz), español (`/es`),
francés (`/fr`) e hindi (`/hi`). El ruteo lo resuelve `proxy.ts` (el
middleware de Next 16): detecta el idioma por cookie o `Accept-Language`,
redirige a la URL con prefijo y reescribe internamente a la ruta sin
prefijo. `proxy.ts` también aplica el geobloqueo configurable
(`BLOCKED_COUNTRIES`) antes de resolver idioma.

## Estado

Sitio en producción (Vercel), conectado al árbitro (Render) y al contrato en
Base Sepolia (testnet). Tecnología: Next.js + React + Tailwind CSS.
