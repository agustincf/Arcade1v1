# Roadmap

**EN** — Where Arcade1v1 is going, in three acts: **v3** hardens the foundation
and removes onboarding friction, **v4** brings real AI depth (LLM agents,
custom strategies, tournaments) and mainnet readiness, **v5** opens the economy
(strategy marketplace, agent backing, on-chain reputation). Dates are
intentionally absent: this is a direction, not a promise. Detailed sections
below are in Spanish — the project's working language.

> Estado actual: **v2.0 en testnet** (Base Sepolia, dinero de juego). Builder de
> agentes no-code, agentes hosteados, modo espectador y ranking ELO compartido
> entre humanos y agentes. Historial en [CHANGELOG.md](../CHANGELOG.md).

Los tres pilares del proyecto ordenan cada versión:
**agent-first** · **verificado on-chain** · **benchmark de IA en vivo**.

---

## v3 — Solidez y puertas abiertas

La meta: que nada se pierda, que nadie se trabe al entrar, y que el sitio sea
rápido en los 4 idiomas.

### Conexión del usuario

- **Faucet integrado**: el USDC de prueba ya tiene `mint` abierto — falta el
  botón. Una página "conseguí fichas" que acuña USDC de testnet en un clic y
  linkea un faucet de gas, para que probar las mesas pagas no requiera saber
  qué es un faucet.
- **Perfiles humanos**: hoy solo los agentes tienen nombre y avatar; los
  humanos son un `0x1234...abcd`. Nombre + avatar elegibles (misma allowlist
  default-deny que los agentes) para que el ranking se sienta vivo.
- **i18n servido por idioma**: hoy las 4 lenguas completas viajan al navegador
  en cada página y el primer render es siempre en inglés. Separar el
  diccionario por idioma y renderizar del lado del servidor: menos bundle,
  SEO real en español, hindi y francés.

### Agentes de IA

- **Más de una estrategia por juego**: el registro ya lo soporta; el builder
  ganaría un paso de elección real (hoy hay exactamente una por juego).
- **Duelos directos**: desafiar a un agente específico (o al tuyo contra el de
  un amigo) en lugar de solo la cola por orden de llegada.

### Blockchain / operación

- **Persistencia durable** _(hecho — v2.1)_: el estado del árbitro (agentes,
  ELO, partidas) sobrevive cualquier deploy vía Redis externo.
- **Métricas y monitoreo del árbitro**: uptime, partidas/día, errores de
  verificación — visibles también como página pública de estado.
- **RPC propio y gas del árbitro monitoreado** antes de cualquier paso a
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
