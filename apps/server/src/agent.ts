// Agente autonomo de ejemplo: juega 2048 solo y compite contra otro agente
// usando la MISMA API HTTP que usaria un humano. Demuestra que la plataforma
// sirve como "arena" para agentes de IA (que compiten entre si).
//
// Correr (con el servidor arbitro prendido):  npm run agent -w @arcade1v1/server

import { Game2048, type Dir } from "@arcade1v1/game-sdk/g2048";

const BASE = process.env.ARBITER_URL || "http://localhost:4000";

async function api(path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

/** "Cerebro" del agente: juega 2048 con una estrategia de prioridades.
 *  Devuelve los movimientos (replay) y el puntaje, listos para enviar. */
function playAgent(seed: number, priority: Dir[]) {
  const g = new Game2048(seed);
  const moves: Dir[] = [];
  let guard = 0;
  while (!g.over && guard < 5000) {
    let moved = false;
    for (const d of priority) {
      if (g.move(d)) {
        moves.push(d);
        moved = true;
        break;
      }
    }
    if (!moved) break;
    guard++;
  }
  return { moves, score: g.score };
}

async function main() {
  // Dos agentes con distinta "personalidad" (orden de prioridades).
  const A = "0x" + "a".repeat(40);
  const B = "0x" + "b".repeat(40);
  const stratA: Dir[] = ["down", "left", "right", "up"];
  const stratB: Dir[] = ["left", "down", "up", "right"];

  console.log("🤖 Dos agentes de IA compiten en 2048 por una mesa de 5 USDC...\n");

  // 1) Cada agente entra a la cola (el 2do se empareja con el 1ro).
  const mA = await api("/matchmake", { game: "2048", stake: 5, address: A });
  const mB = await api("/matchmake", { game: "2048", stake: 5, address: B });
  console.log("emparejados:", mA.matchId === mB.matchId);
  console.log("misma semilla (juego justo):", mA.seed, "\n");

  // 2) Cada agente juega su intento solo (sin pantalla).
  const pA = playAgent(mA.seed, stratA);
  const pB = playAgent(mB.seed, stratB);
  console.log(`Agente A → ${pA.score} pts (${pA.moves.length} movimientos)`);
  console.log(`Agente B → ${pB.score} pts (${pB.moves.length} movimientos)\n`);

  // 3) Cada agente envia su puntaje + replay (el arbitro lo verifica).
  await api(`/match/${mA.matchId}/score`, {
    address: A,
    score: pA.score,
    replay: { seed: mA.seed, moves: pA.moves },
  });
  const res = await api(`/match/${mB.matchId}/score`, {
    address: B,
    score: pB.score,
    replay: { seed: mB.seed, moves: pB.moves },
  });

  // 4) El arbitro decidio y firmo el resultado.
  const winner =
    res.outcome === "p1" ? "Agente A" : res.outcome === "p2" ? "Agente B" : "Empate";
  console.log("🏆 Resultado:", res.status, "· ganador:", winner);
  console.log(
    "✍️  Firma del arbitro:",
    res.signature ? res.signature.slice(0, 22) + "..." : "(empate, sin firma)",
  );
  console.log("\nDos agentes compitieron de forma justa y verificable ✅");
}

main().catch((e) => {
  console.error("Error:", e.message);
  console.error("¿Esta prendido el arbitro? -> npm run server -w @arcade1v1/server");
  process.exit(1);
});
