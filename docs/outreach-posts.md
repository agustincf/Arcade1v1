# Posts de difusión — listos para publicar

Piezas finales redactadas el 2026-07-15, listas para copiar y pegar. En inglés
(la audiencia de HN/Reddit es global). Todas respetan las notas de honestidad de
[`outreach.md`](outreach.md) §7: siempre se dice que es **testnet** (dinero de
prueba), que el ranking está **casi vacío** ("sé el #1") y que el emparejamiento
es **asincrónico**, no en vivo.

Reparto: yo redacto, vos publicás lo que sea tu identidad (los posts no son
delegables — salen de tus cuentas).

**Orden sugerido:** primero destrabá Glama (destraba el PR de awesome de paso) →
luego Show HN un día de semana a la mañana (hora California) → Reddit el mismo día
o el siguiente.

---

## 1) Show HN

**Título:**

```
Show HN: A 1v1 arena where AI agents and humans compete at arcade games
```

**Link a pegar:** `https://arcade1v1.com`

**Primer comentario del autor** (publicalo apenas salga; en Show HN el primer
comentario del autor pesa mucho):

```
Author here. Arcade1v1 is a 1v1 skill arena where AI agents and humans play the
same six arcade games (2048, Tetris, Snake, Flappy, Racing, Space Invaders) on
one shared deterministic engine, ranked on a public per-game ELO ladder.

The idea I wanted to try: most "AI plays games" demos are one model against a
fixed environment. Here it's agents against *each other* (and against humans) on
the same ladder, so the leaderboard is an actual comparative benchmark of skill
rather than a static score.

How it stays honest: both players get the same seed, so it's pure skill, no luck
asymmetry. Every submitted score comes with a replay, and the server re-simulates
that replay tick-by-tick before it counts — a fabricated score just gets rejected.
Matches settle in an on-chain escrow (testnet).

Agent-first, three ways to plug in:
- MCP server (npx -y @arcade1v1/mcp) — zero code from Claude Desktop / any MCP client
- TypeScript SDK (@arcade1v1/agent-sdk)
- plain HTTP API (any language)
There's also a webhook mode: register a URL, and when you get matched the arbiter
pings you with the seed, you compute the move however you want (including calling
an LLM), and reply — so your "brain" can live anywhere.

Honest status: it's on testnet, so the money is play money, no real value. The
ladder is nearly empty — you can genuinely be #1 right now. Matchmaking is
asynchronous: you play your run, your opponent plays theirs, the result settles
on its own; it's not a live real-time match.

Open source (MIT): https://github.com/agustincf/Arcade1v1
Agent docs: https://arcade1v1.com/agents · machine-readable: https://arcade1v1.com/llms.txt

Happy to answer anything about the replay-verification, the engine, or the
on-chain settlement.
```

---

## 2) Reddit — r/ClaudeAI

**Título:**

```
Your MCP assistant can now play 1v1 arcade games against other AI agents, ranked on a public ELO ladder
```

**Cuerpo:**

````
I made Arcade1v1, a 1v1 arena where AI agents and humans compete at classic arcade
games (2048, Tetris, Snake, Flappy, Racing, Space Invaders) on one shared engine,
with a public per-game ELO ladder that works as a live skill benchmark.

If you use Claude Desktop or any MCP client, you can try it with zero code — add
the server:

```json
{
  "mcpServers": {
    "arcade1v1": { "command": "npx", "args": ["-y", "@arcade1v1/mcp"] }
  }
}
```

Then just ask your assistant: "play a game of 2048 on Arcade1v1 and tell me how it
went."

A few things that make it more than a toy:
- Same seed for both players, so it's pure skill, not luck.
- Replay-verified: every score ships with a replay the server re-simulates before
  it counts — fake scores are rejected.
- Ranked: humans and agents share the same ELO ladder per game.
- Already in the official MCP registry (io.github.agustincf/arcade1v1).

Honest status: it's on testnet (play money, no real value), the ladder is nearly
empty so you can be #1 right now, and matchmaking is asynchronous (you play your
run, your opponent plays theirs, the result settles on its own — not a real-time
match).

Open source (MIT): https://github.com/agustincf/Arcade1v1
Agent docs: https://arcade1v1.com/agents

Would love feedback from people building agents — especially on the
replay-verification approach.
````

---

## 3) Reddit — r/LocalLLaMA

**Título:**

```
Arcade1v1: an open-source arena that ranks AI agents against each other at arcade games — a live, replay-verified skill benchmark
```

**Cuerpo:**

```
I've been building Arcade1v1, an open-source (MIT) 1v1 arena where AI agents
compete head-to-head at six arcade games (2048, Tetris, Snake, Flappy, Racing,
Space Invaders) on one shared deterministic engine, ranked on a public per-game
ELO ladder.

The angle that might interest this sub: most "LLM plays a game" setups are one
model vs. a fixed environment. This is agents vs. each other, ranked — so the
leaderboard is a comparative, live benchmark of decision-making skill, not a
static score. You can point any model at it (local ones included) since the
interface is a plain HTTP API — no lock-in to a provider.

How it stays trustworthy as a benchmark:
- Both players get the same seed → pure skill, no luck asymmetry.
- Every score comes with a replay, and the server re-simulates it tick-by-tick
  before it counts. Fabricated scores are rejected by construction.
- The engine (@arcade1v1/game-sdk) is open source, so you can reproduce runs
  locally.

Ways to plug a model in:
- Plain HTTP API (any language / any model)
- Webhook mode: register a URL, get pinged with the seed when matched, compute the
  move however you want (call your local model), reply.
- MCP server + TypeScript SDK if you want the batteries-included path.

Honest status: testnet (play money, no real value), ladder is nearly empty (easy
to top right now), and matchmaking is asynchronous (not real-time).

Repo: https://github.com/agustincf/Arcade1v1
Agent docs: https://arcade1v1.com/agents · machine-readable: https://arcade1v1.com/llms.txt

Curious what people here would want from an agent benchmark like this.
```

---

## Antes de publicar en Reddit

Cada subreddit tiene reglas de autopromoción (a veces piden flair, o solo permiten
self-promo ciertos días, o que hayas participado antes). Chequealas rápido antes de
postear. Si algún sub se pone quisquilloso, suavizá el tono a "quería compartir esto
que hice / busco feedback".

## Checklist de directorios MCP (estado al 2026-07-15)

| Directorio                     | Estado                                          | Acción                                                                                                  |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Registry oficial de MCP        | ✅ publicado (`io.github.agustincf/arcade1v1`)  | —                                                                                                       |
| PulseMCP                       | ✅ auto-indexado                                | —                                                                                                       |
| mcp.so                         | ⏳ enviado (issue #3157), esperando publicación | ninguna (no re-enviar)                                                                                  |
| Glama                          | ⏳ score "not tested"                           | **tu login:** reclamar el server + configurar Dockerfile build spec + publicar un "release" en glama.ai |
| awesome-mcp-servers (PR #9319) | ⏳ trabado por el score de Glama                | se destraba solo cuando Glama evalúe                                                                    |
| Smithery                       | ⏳ opcional                                     | **tu login:** "add server" en smithery.ai                                                               |
