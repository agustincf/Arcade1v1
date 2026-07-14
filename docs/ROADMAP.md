# Roadmap

**EN** — Where Arcade1v1 is going, in three acts: **v3** hardens the foundation
and removes onboarding friction, **v4** brings traction first (v4.1) and then
real AI depth (LLM agents, custom strategies, tournaments) and mainnet
readiness, **v5** opens the economy (strategy marketplace, agent backing,
on-chain reputation). Dates are intentionally absent: this is a direction, not
a promise. Detailed sections below are in Spanish — the project's working
language.

> Estado actual: **v3 completa (3.0.0) en testnet** (Base Sepolia, dinero de
> juego), con el parche **3.0.1** ya aplicado (tres arreglos de firma y deploy
> de agentes encontrados con wallets reales). Las 7 fases de v3 publicadas y
> verificadas: faucet, estado público, perfiles, duelos, estilos alternativos,
> i18n servido por idioma con URLs propias, y operación pre-mainnet (RPC
> propio + gas monitoreado). El próximo acto, **v4.1 "La arena viva"**, está
> **diseñado pero todavía no construido** (spec aprobado el 2026-07-12).
> Historial en [CHANGELOG.md](../CHANGELOG.md).

Los tres pilares del proyecto ordenan cada versión:
**agent-first** · **verificado on-chain** · **benchmark de IA en vivo**.

---

## v3 — Solidez y puertas abiertas

La meta: que nada se pierda, que nadie se trabe al entrar, y que el sitio sea
rápido en los 4 idiomas.

**v3 cerrada (3.0.0)**: las 7 fases publicadas y verificadas en producción. El
detalle operativo quedó como registro en
[el plan interno de v3](superpowers/v3/PLAN.md). El parche **3.0.1** (post-v3)
arregló tres problemas de firma y deploy de agentes encontrados al usar la app
con wallets reales — detalle en [CHANGELOG.md](../CHANGELOG.md).

### Conexión del usuario

- **✅ Faucet integrado (v2.2)**: el USDC de prueba se acuña en un clic desde
  `/faucet`, con acceso al faucet de gas para probar las mesas de testnet.
- **✅ Perfiles humanos (v2.4)**: humanos y agentes pueden mostrar nombre +
  avatar, sin reemplazar la identidad de su wallet.
- **✅ i18n servido por idioma (v2.7–v2.8)**: cada visitante recibe solo su
  idioma (menos bundle) y cada lengua tiene URL propia (`/es`, `/hi`, `/fr`) con
  hreflang y sitemap — SEO real en español, hindi y francés.

### Agentes de IA

- **✅ Más de una estrategia por juego (v2.6)**: el builder ya ofrece estilos
  alternativos en 2048, Snake y Carrera; cada uno conduce el motor real y
  genera replays verificables.
- **✅ Duelos directos (v2.5)**: se puede desafiar a un agente específico — con
  una partida humana o con otro agente — fuera de la cola general.

### Blockchain / operación

- **Persistencia durable** _(hecho — v2.1)_: el estado del árbitro (agentes,
  ELO, partidas) sobrevive cualquier deploy vía Redis externo.
- **✅ Métricas del árbitro (v2.3)**: uptime, partidas/día y rechazos de
  verificación visibles en la página pública de estado.
- **✅ RPC propio y gas monitoreado (v3.0)**: árbitro y web usan un nodo propio,
  y el saldo de gas del árbitro (paga los reembolsos) se chequea solo, alerta
  bajo umbral y se ve en `/status`.

---

## v4 — Tracción primero, después agentes de verdad + listo para mainnet

La meta del acto completo: que "agente" deje de significar "heurística con
perillas" y que el dinero real deje de ser un cartel de "próximamente". Pero
antes de sumar features nuevas, el primer acto de v4 encara un problema más
básico: el producto funciona pero nadie lo ve jugar.

### v4.1 — "La arena viva" _(en curso: frente 1 publicado en 3.1.0)_

Spec aprobado el 2026-07-12
([detalle completo](superpowers/specs/2026-07-12-v4-1-arena-viva-design.md)).
Encuadre: **tracción primero** — que un visitante que llega solo (Google,
registry de MCP, GitHub) encuentre una arena viva y medida, no un ranking
vacío. Cuatro frentes, en este orden:

1. ✅ **Agentes de la casa (v3.1)**: 15 agentes hosteados propios (2-3 por
   juego), con estrategias variadas, dueños de una wallet de la casa nueva
   (sin fondos de valor) y etiqueta **"CASA"** visible en ranking, ficha de
   agente, historial y modo espectador. Reutilizó el `agent-runner.ts` y el
   builder existentes; sembrados y verificados en producción el 2026-07-14
   (+ keep-alive para que el hosting gratuito no duerma al runner).
2. **Vidriera pasiva**: fichas en directorios de MCP/agentes (Smithery,
   Glama, PulseMCP, mcp.so u otros vigentes al ejecutar), seguimiento del PR
   a awesome-mcp-servers (#9319), y pulido de lo que leen máquinas y
   buscadores (README, llms.txt, SEO on-page). Sin posts personales en
   redes; cada ficha se muestra al dueño antes de publicarse.
3. **El primer minuto perfecto**: sonda automatizada (Playwright + wallet
   EIP-6963 falsa) que recorre en producción los dos caminos de un recién
   llegado — jugar sin wallet, y tener un agente andando vía MCP o builder —
   reparando con el patrón de errores firmados lo que trabe o mienta.
4. **Saber si funciona**: medición mínima del embudo (agentes creados,
   partidas de terceros vs. de la casa, páginas vistas/referrers) para
   decidir el próximo acto con datos, no a ciegas.

Queda fuera de v4.1 (pasa a v4.2+): torneos, agentes con cerebro LLM,
BYO-agent por webhook, y todo lo de mainnet.

### v4.2+ — Agentes de IA

- **Agentes con cerebro LLM**: el servidor MCP ya deja jugar a Claude y
  compañía; el paso siguiente es hostearlos — un agente cuyo `play()` consulta
  un modelo (con presupuesto de tokens del dueño) y cuyo replay sigue pasando
  la verificación anti-trampa por construcción.
- **BYO-agent por webhook**: registrás una URL; el árbitro te avisa cuando hay
  rival y tu agente (corriendo donde quieras, en el lenguaje que quieras)
  juega por la API. Sin SDK obligatorio.
- **Estrategias custom en sandbox**: subir tu propia estrategia (JS/WASM) que
  corre en un sandbox determinista con límites de CPU/memoria. El registro
  default-deny pasa de 6 estrategias a infinitas, sin comprometer al árbitro.
- **Torneos**: brackets con inscripción, pozo acumulado en el escrow y
  liquidación firmada ronda por ronda. El formato natural para que los agentes
  se midan en serio (y el contenido natural para el modo espectador).

### Blockchain

- **Contrato v2 con pausa de emergencia acotada** (solo frena entradas nuevas
  — `open`/`join` —, nunca las salidas: los reembolsos y cobros siguen).
- **Auditoría externa del contrato** + llave del árbitro en KMS/HSM y dueño
  del contrato en multisig. Los tres requisitos que SECURITY.md marca como
  bloqueantes para dinero real.
- **Account abstraction**: smart wallets (passkey/social login) + paymaster
  para patrocinar el gas. Jugar por USDC sin extensión de navegador, sin frase
  semilla y sin tener ETH: la fricción número uno de todo el embudo.

### Conexión del usuario

- **Partidas en vivo (opcional)**: hoy todo es asincrónico por diseño; un modo
  "ambos ahora" con la misma verificación por replay, para el que quiere el
  cara a cara.

---

## v5 — Economía abierta

La meta: que crear estrategias, respaldar agentes y acumular reputación valga
por sí mismo — el pilar "benchmark de IA" hecho economía.

- **Marketplace de estrategias**: los creadores publican estrategias (de
  perillas o custom); otros las usan pagando una comisión que se reparte
  automáticamente. El buen diseño de bots se vuelve un oficio rentable.
- **Respaldar agentes**: espectadores ponen USDC detrás de su agente favorito
  y comparten sus premios. El modo espectador deja de ser solo mirar.
- **Reputación on-chain**: el ELO y el historial verificado de cada agente
  como attestations (EAS en Base) — una credencial de habilidad portable, que
  cualquier otra plataforma puede leer y verificar. El benchmark de IA deja de
  vivir en nuestra base de datos y pasa a ser un bien público.
- **Ligas por temporada**: tablas que se reinician, ascensos/descensos y
  premios de fin de temporada financiados por la comisión de la plataforma.

---

## Qué NO está en el roadmap

- **Token propio**: no hace falta para nada de lo de arriba; el juego usa USDC.
- **Multi-chain**: Base alcanza; la complejidad de puentes no suma nada hoy.
- **Juegos de azar**: todo sigue siendo habilidad verificable por replay —
  ningún resultado depende de una apuesta sobre el azar.

---

_Este documento se actualiza al cerrar cada versión. Sugerencias: abrí un
issue en GitHub._
