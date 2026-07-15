# v4.1 — La arena viva (diseño)

> Primer acto de v4, aprobado por el dueño el 2026-07-12. Decisiones de
> encuadre: **tracción primero** (antes que features nuevas o mainnet),
> **sin posts personales en redes** (solo canales pasivos) y **agentes de la
> casa etiquetados** (sí a poblar la ladder, con identidad clara).

## Objetivo

Que un visitante que llega solo (por Google, por el registry de MCP, por
GitHub) encuentre una arena **viva, jugable y medida** — y que existan más
caminos pasivos por los que llegar. El problema que ataca: el producto
funciona pero el ranking de producción está vacío; nadie llega y el que
llegue hoy ve un desierto.

**Criterio de éxito del acto:** ranking con actividad real 24/7 en los 6
juegos, fichas enviadas a los directorios acordados, embudo de llegada sin
trabas verificado por sonda, y un tablero mínimo que diga cuántos llegan y
dónde abandonan. El éxito de _tracción_ (que aparezcan terceros) se mide,
pero no depende solo de nosotros: por eso el criterio es dejar la mesa
servida y medida.

## Los cuatro frentes (en orden)

### Frente 1 — Agentes de la casa

12-18 agentes hosteados propios, repartidos en los 6 juegos (2-3 por juego),
con estrategias y perillas variadas para que haya niveles distintos de ELO.

- **Infra existente que se reutiliza:** el `agent-runner.ts` del árbitro ya
  hace jugar solos a los agentes hosteados en la ladder gratis (stake 0), y
  el builder ya crea agentes firmados. No se construye un sistema nuevo.
- **Lo nuevo:**
  - Una wallet de la casa (nueva, sin fondos de valor — la ladder es gratis)
    que es dueña de los agentes. El server exime a las wallets listadas en
    `HOUSE_WALLETS` (env) del tope por owner — NO se sube el tope global,
    que sigue protegiendo contra abuso de terceros.
  - **Etiqueta "CASA" visible** donde aparezca el agente: ranking, página del
    agente, historial de partidas y modo espectador. Server: un campo
    `house: true` en la vista pública del agente (derivado de la lista de
    wallets de la casa en config, no editable por terceros). Web: chip
    "CASA" en los 4 idiomas.
  - Nombres y avatares con personalidad (no "Bot 1"…"Bot 18"), para que el
    ranking invite en vez de parecer relleno.
- **Honestidad:** partidas reales, ELO real, identidad clara. Nada de
  contadores sintéticos ni actividad simulada (consistente con el lobby
  honesto del rediseño de julio).

### Frente 2 — Vidriera pasiva

Que el proyecto aparezca donde los desarrolladores de agentes ya buscan,
sin publicar posts personales.

- Fichas en directorios de MCP/agentes: Smithery, Glama, PulseMCP, mcp.so
  (y los equivalentes que estén vivos al momento de ejecutar; la lista exacta
  se valida entonces — el ecosistema cambia rápido).
- Seguimiento del PR abierto a awesome-mcp-servers (#9319) y PRs a 1-2
  listas awesome más si aplican.
- Pulido de lo que leen máquinas y buscadores: README del repo (primera
  pantalla vendedora, topics de GitHub), llms.txt, metadatos/SEO on-page de
  las páginas clave (`/agents`, `/build`, portada).
- **Regla de publicación:** cada ficha/PR se muestra al dueño antes de
  enviarse. Nada sale a internet sin OK explícito, pieza por pieza.

### Frente 3 — El primer minuto perfecto

Recorrer con sonda automatizada (Playwright + wallet EIP-6963 falsa, el
patrón que ya usamos para reparar el deploy) los dos caminos de un recién
llegado, en producción:

1. Portada → jugar sin wallet → terminar una partida.
2. Portada → `/agents` o `/build` → tener un agente andando (MCP y builder).

Todo lo que trabe, confunda o mienta se repara con el patrón de errores
firmados ya establecido (`app/lib/errors.ts`: motivo visible, nunca genérico
falso). Salida: lista de hallazgos + reparaciones commiteadas.

### Frente 4 — Saber si funciona

Medición mínima y honesta, sin invadir:

- **Del lado del árbitro ya hay** contadores públicos (/stats: partidas,
  agentes activos). Se agrega lo que falte para el embudo de agentes
  (p. ej. agentes creados por semana, partidas de terceros vs. de la casa —
  la etiqueta CASA permite separar señal de ruido).
- **Del lado web:** analytics de páginas vistas/referrers (Vercel Analytics
  o equivalente liviano y sin cookies invasivas — decisión técnica al
  ejecutar). Lo mínimo para responder: ¿cuántos llegan?, ¿de dónde?, ¿hasta
  dónde avanzan?
- Un resumen legible en un lugar (puede ser /status ampliado o un doc) para
  decidir el acto siguiente con datos.

## Qué NO entra en este acto

- Torneos, agentes con cerebro LLM, BYO-agent por webhook (quedan en v4.2+).
- Todo lo de mainnet (auditoría, contrato v2, KMS).
- Posts en redes personales (decisión del dueño; los textos de
  docs/outreach.md quedan listos por si cambia de idea).

## Orden y dependencias

Frente 1 primero (desbloquea el valor de los demás: sin arena viva, la
vidriera lleva a un desierto). Después 3 (que nada trabe), 2 (recién ahí
invitar gente) y 4 transversal (se instala temprano, se lee al final).

## Riesgos

- **Render gratuito duerme:** el runner de agentes solo corre con el server
  despierto; las partidas de la casa se concentran en las horas con tráfico
  o pings. Mitigación barata: el cron de UptimeRobot/keep-alive existente
  (si no existe, agregarlo es parte del Frente 1).
- **Directorios cambian requisitos:** la lista del Frente 2 se revalida al
  ejecutar; no se prometen directorios específicos.
- **Sesgo de la casa en el ELO:** los agentes de la casa juegan entre sí;
  cuando entren terceros, el anti-farming existente (detección de agentes
  hosteados) y la etiqueta CASA mantienen el ranking interpretable.
