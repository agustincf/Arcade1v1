# v3 — Estructura del milestone

> Desglose operativo de la sección **v3 — Solidez y puertas abiertas** del
> [roadmap público](../../ROADMAP.md). Este documento es interno: define fases,
> orden, criterios de aceptación y estado. El protocolo de trabajo por sesión
> está en [OPERATIVA.md](OPERATIVA.md).

**Meta de v3** (del roadmap): que nada se pierda, que nadie se trabe al entrar,
y que el sitio sea rápido en los 4 idiomas.

**Orden elegido**: de menor a mayor riesgo — victorias rápidas primero (faucet,
estado), después las features de producto, el refactor grande de i18n al final
con todo lo demás estable, y la operación pre-mainnet como cierre.

Ya hecho en v2.1 (no es fase): **Persistencia durable** — el estado del árbitro
sobrevive deploys vía Redis externo o archivo
([apps/server/src/persist.ts](../../../apps/server/src/persist.ts)).

---

## Estado

- [ ] Fase 1 — Faucet integrado
- [ ] Fase 2 — Métricas y página de estado
- [ ] Fase 3 — Perfiles humanos
- [ ] Fase 4 — Duelos directos
- [ ] Fase 5 — Más de una estrategia por juego
- [ ] Fase 6 — i18n servido por idioma
- [ ] Fase 7 — Operación pre-mainnet (RPC propio + gas monitoreado)

_Se marca cada fase al publicarla (release + verificación en producción)._

---

## Fase 1 — Faucet integrado

**Objetivo**: probar las mesas pagas sin saber qué es un faucet — una página
"conseguí fichas" que acuña USDC de testnet en un clic.

**Tamaño**: chico.

**Alcance**:

- Página nueva en la web (p. ej. `/faucet`) con: botón que llama a `mint` del
  TestUSDC desde el navegador (wallet conectada), saldo USDC visible, y link a
  un faucet de gas de Base Sepolia con explicación en simple.
- Agregar `mint` al `erc20Abi` de la web — hoy solo lo tiene el ABI del
  servidor ([apps/server/src/abi.ts](../../../apps/server/src/abi.ts)).
- CTA hacia el faucet desde el flujo de mesas pagas cuando el saldo no alcanza.
- Textos en los 4 idiomas.

**Archivos clave**:

- [packages/contracts/src/TestUSDC.sol](../../../packages/contracts/src/TestUSDC.sol) —
  `mint(address,uint256)` abierto, 6 decimales (ya existe, no se toca).
- [apps/web/app/lib/escrow.ts](../../../apps/web/app/lib/escrow.ts) —
  `USDC_ADDRESS`, `erc20Abi` (agregar `mint`).
- [apps/web/app/lib/wagmi.ts](../../../apps/web/app/lib/wagmi.ts) y
  [apps/web/app/lib/wallet.tsx](../../../apps/web/app/lib/wallet.tsx) —
  conexión de wallet ya montada (reusar).

**Criterios de aceptación**:

- Un usuario nuevo con wallet vacía (pero con gas) consigue USDC de prueba sin
  salir del sitio y sin instrucciones externas.
- El saldo se actualiza en pantalla tras acuñar.
- En mainnet (`IS_MAINNET`) la página no ofrece mint (guardia explícita).

---

## Fase 2 — Métricas y página de estado

**Objetivo**: uptime, partidas/día y errores de verificación visibles — también
como página pública de estado.

**Tamaño**: chico-mediano.

**Alcance**:

- Contadores acumulados en el árbitro: uptime del proceso, partidas creadas y
  liquidadas (totales y por día), envíos rechazados por verificación de replay,
  agentes hosteados activos. Persistidos con el mismo `jsonStore` para
  sobrevivir deploys.
- Endpoint público `GET /stats` (con el rate limit existente).
- Página `/status` en la web que lo consume, honesta y sin contadores
  sintéticos (regla de la casa).

**Archivos clave**:

- [apps/server/src/index.ts](../../../apps/server/src/index.ts) — hoy solo
  `GET /health`; agregar `GET /stats`.
- [apps/server/src/matchmaking.ts](../../../apps/server/src/matchmaking.ts) y
  [apps/server/src/agents.ts](../../../apps/server/src/agents.ts) — puntos
  donde incrementar contadores.
- [apps/server/src/persist.ts](../../../apps/server/src/persist.ts) —
  `jsonStore("stats")`.

**Criterios de aceptación**:

- `/status` en producción muestra datos reales del árbitro en Render.
- Los contadores sobreviven un redeploy del árbitro.
- Un rechazo de verificación provocado a propósito aparece reflejado.

---

## Fase 3 — Perfiles humanos

**Objetivo**: que los humanos dejen de ser `0x1234...abcd` — nombre + avatar
elegibles, con la misma allowlist default-deny que los agentes.

**Tamaño**: mediano.

**Alcance**:

- Store nuevo `jsonStore("profiles")` keyed por address (lowercase).
- Endpoint firmado para crear/editar el perfil (mismo patrón de
  `agentAuthMessage` con `ts` anti-replay).
- Reusar `sanitizeName` y `AGENT_AVATARS` (no duplicar validación).
- Resolución de nombre/avatar en leaderboard, watch, detalle de partida y
  lobby. Fallback al address corto si no hay perfil.
- UI mínima para elegir nombre y avatar (dónde exactamente se decide en el
  diseño de la fase; una sola CTA primaria por zona).

**Archivos clave**:

- [apps/server/src/agents.ts](../../../apps/server/src/agents.ts) —
  `sanitizeName`, validación de avatar (reusar).
- [packages/strategies/src/avatars.ts](../../../packages/strategies/src/avatars.ts) —
  `AGENT_AVATARS`.
- [packages/game-sdk/src/auth.ts](../../../packages/game-sdk/src/auth.ts) —
  patrón de mensajes firmados.
- [apps/web/app/leaderboard/page.tsx](../../../apps/web/app/leaderboard/page.tsx),
  [apps/web/app/watch/](../../../apps/web/app/watch/),
  [apps/web/app/game/[gameId]/match/page.tsx](../../../apps/web/app/game/%5BgameId%5D/match/page.tsx) —
  donde hoy se muestra el address crudo.

**Criterios de aceptación**:

- Un humano elige nombre + avatar firmando con su wallet y se ve así en el
  ranking y en las partidas.
- Nadie puede editar el perfil de otro (firma verificada, address normalizado).
- Nombres pasan por la misma sanitización que los agentes; avatares solo de la
  allowlist.

---

## Fase 4 — Duelos directos

**Objetivo**: desafiar a un agente específico (o tu agente contra el de un
amigo) en lugar de solo la cola por orden de llegada.

**Tamaño**: mediano.

**Alcance**:

- Noción de "rival objetivo" en el matchmaking: partida-desafío que solo el
  desafiado puede tomar (por address o agentId), con expiración.
- Exposición en `POST /matchmake` (o ruta nueva de desafío) manteniendo la
  firma en producción.
- UI "desafiar" donde ya se listan rivales (leaderboard, detalle de agente,
  watch).
- Opcional (si el costo es bajo): exponerlo en el MCP
  ([apps/mcp/src/tools.ts](../../../apps/mcp/src/tools.ts)).

**Archivos clave**:

- [apps/server/src/matchmaking.ts](../../../apps/server/src/matchmaking.ts) —
  hoy cola FIFO por `game:stake`; `peekWaiterAddress()` ya mira al que espera
  (anti-farming).
- [apps/web/app/lib/arbiter.ts](../../../apps/web/app/lib/arbiter.ts) —
  cliente del árbitro en la web.
- [packages/agent-sdk/src/client.ts](../../../packages/agent-sdk/src/client.ts) —
  `ArbiterClient` (si se expone a agentes).

**Criterios de aceptación**:

- Puedo desafiar a un agente concreto y la partida se crea contra ese rival,
  no contra el próximo de la cola.
- Un tercero no puede "robar" el desafío.
- Un desafío no aceptado expira y libera los fondos según las reglas
  existentes de reembolso.

---

## Fase 5 — Más de una estrategia por juego

**Objetivo**: que el builder tenga un paso de elección real de estrategia (hoy
hay exactamente una por juego).

**Tamaño**: mediano (el grueso es diseñar estrategias que jueguen distinto de
verdad, no el plumbing).

**Alcance**:

- Al menos una segunda estrategia para varios juegos (empezar por los motores
  donde una segunda política tiene sentido claro y estilo distinguible).
- Paso de elección en el builder cuando `strategiesFor(game).length > 1`, con
  descripción en simple de cada estilo.
- Los agentes hosteados existentes no se ven afectados (sus `strategyId`
  siguen válidos).

**Archivos clave**:

- [packages/strategies/src/registry.ts](../../../packages/strategies/src/registry.ts) —
  `strategiesFor()` ya filtra N por juego (no requiere cambios de diseño).
- [packages/strategies/src/](../../../packages/strategies/src/) — una estrategia
  por archivo; agregar las nuevas acá.
- [apps/web/app/build/page.tsx](../../../apps/web/app/build/page.tsx) —
  `pickGame()` hoy toma `strategiesFor(id)[0]`; agregar el paso de elección.

**Criterios de aceptación**:

- `/build` ofrece elección real de estrategia en al menos 2 juegos.
- Cada estrategia nueva pasa la verificación anti-trampa por construcción
  (maneja el motor real tick a tick) y tiene test propio.
- Dos estrategias del mismo juego producen partidas visiblemente distintas en
  el sandbox del builder.

---

## Fase 6 — i18n servido por idioma

**Objetivo**: que cada visitante reciba solo su idioma y el primer render ya
llegue traducido — menos bundle y SEO real en español, hindi y francés.

**Tamaño**: grande (el refactor de mayor riesgo de v3 — por eso va al final).

**Alcance**:

- Partir el diccionario monolítico en un archivo por idioma con carga por
  locale (import dinámico), manteniendo `translate()` puro.
- Traducción en Server Components usando `getLang()` (ya existe) para que el
  primer render llegue en el idioma del usuario, no en inglés.
- Decidir en el diseño de la fase: rutas por locale (`/es/...`) vs. cookie +
  SSR como hoy — con hreflang/sitemap por idioma para el SEO en cualquiera de
  los dos caminos.
- Verificar peso de bundle antes/después (el criterio es medible).

**Archivos clave**:

- [apps/web/app/lib/i18n-dict.ts](../../../apps/web/app/lib/i18n-dict.ts) —
  1408 líneas, los 4 idiomas inline (partir).
- [apps/web/app/lib/i18n.tsx](../../../apps/web/app/lib/i18n.tsx) — provider
  cliente que hoy importa el diccionario completo.
- [apps/web/app/lib/serverLang.ts](../../../apps/web/app/lib/serverLang.ts) —
  `getLang()` cookie → `Accept-Language` → `"en"` (ya resuelve el idioma en el
  servidor; aprovechar).
- [apps/web/app/layout.tsx](../../../apps/web/app/layout.tsx) — ya pasa
  `initialLang`.

**Criterios de aceptación**:

- El bundle del cliente ya no incluye los 4 idiomas (medido, no estimado).
- Con cookie/Accept-Language en español, el HTML del primer render llega en
  español (verificable con `curl`).
- Ninguna página pierde traducciones (los 4 idiomas siguen completos).
- SEO: las páginas indexables declaran idioma/alternates correctamente.

---

## Fase 7 — Operación pre-mainnet

**Objetivo**: RPC propio y gas del árbitro monitoreado — los dos requisitos
operativos del roadmap antes de cualquier paso a mainnet.

**Tamaño**: chico (ops; requiere una cuenta externa gratuita que se crea junto
con el usuario).

**Alcance**:

- Cuenta de RPC dedicado (Alchemy/QuickNode, plan gratis) y `RPC_URL` propio en
  Render y Vercel — dejar de depender del RPC público.
- Monitoreo del saldo de gas del árbitro (paga el gas de los reembolsos):
  chequeo periódico + alerta bajo umbral. Natural integrarlo con la página
  `/status` de la Fase 2 (el saldo de gas como dato visible) y/o una alerta
  operativa.
- Documentar el runbook en `DEPLOY.md` (qué mirar, cómo recargar gas).

**Criterios de aceptación**:

- El árbitro y la web usan el RPC propio en producción.
- Con el saldo de gas bajo el umbral, la alerta se dispara (probado bajando el
  umbral, no vaciando la wallet).
- `DEPLOY.md` explica la operación en simple.

---

## Cierre del milestone

v3 se declara cerrada cuando las 7 fases están publicadas y verificadas en
producción. La fase que completa el milestone se publica como **3.0.0**; en ese
momento se actualiza [docs/ROADMAP.md](../../ROADMAP.md) (v3 pasa a estado
actual) y este directorio queda como registro histórico. El detalle del
protocolo está en [OPERATIVA.md](OPERATIVA.md).
