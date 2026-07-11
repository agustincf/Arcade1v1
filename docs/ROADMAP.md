# Roadmap

**EN** — Where Arcade1v1 is going, in three acts: **v3** hardens the foundation
and removes onboarding friction, **v4** brings real AI depth (LLM agents,
custom strategies, tournaments) and mainnet readiness, **v5** opens the economy
(strategy marketplace, agent backing, on-chain reputation). Dates are
intentionally absent: this is a direction, not a promise. Detailed sections
below are in Spanish — the project's working language.

> Estado actual: **v2.6.0 en testnet** (Base Sepolia, dinero de juego). La v3
> está en curso: sus primeras **5 de 7 fases** ya están publicadas — builder
> no-code, agentes hosteados, espectador, ranking ELO, faucet, estado público,
> perfiles, duelos y estilos alternativos. Historial en
> [CHANGELOG.md](../CHANGELOG.md).

Los tres pilares del proyecto ordenan cada versión:
**agent-first** · **verificado on-chain** · **benchmark de IA en vivo**.

---

## v3 — Solidez y puertas abiertas

La meta: que nada se pierda, que nadie se trabe al entrar, y que el sitio sea
rápido en los 4 idiomas.

Las fases ya entregadas se conservan acá como parte del roadmap; quedan i18n
servido por idioma y la operación pre-mainnet. El detalle operativo está en
[el plan interno de v3](superpowers/v3/PLAN.md).

### Conexión del usuario

- **✅ Faucet integrado (v2.2)**: el USDC de prueba se acuña en un clic desde
  `/faucet`, con acceso al faucet de gas para probar las mesas de testnet.
- **✅ Perfiles humanos (v2.4)**: humanos y agentes pueden mostrar nombre +
  avatar, sin reemplazar la identidad de su wallet.
- **Pendiente — i18n servido por idioma**: hoy las 4 lenguas completas viajan al navegador
  en cada página y el primer render es siempre en inglés. Separar el
  diccionario por idioma y renderizar del lado del servidor: menos bundle,
  SEO real en español, hindi y francés.

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
  verificación ya son visibles en la página pública de estado. Queda sumar la
  alerta operativa de gas.
- **Pendiente — RPC propio y gas del árbitro monitoreado** antes de cualquier paso a
  mainnet (el árbitro paga el gas de los reembolsos).

---

## v4 — Agentes de verdad + listo para mainnet

La meta: que "agente" deje de significar "heurística con perillas" y que el
dinero real deje de ser un cartel de "próximamente".

### Agentes de IA

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
