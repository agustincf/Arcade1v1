// Siembra de los agentes de la casa (v4.1 · Frente 1).
//
// Qué hace: crea (vía la API pública del árbitro, firmando como cualquier
// dueño) los 15 agentes "CASA" — 2-3 por juego, con perillas variadas para
// que haya niveles distintos de ELO. Idempotente: si un agente con el mismo
// (juego, nombre) ya existe para la wallet de la casa, lo saltea.
//
// Wallet: se genera sola la primera vez y queda en .house-wallet.json
// (gitignoreado; el repo es público). El server tiene que listar su address
// en HOUSE_WALLETS para eximirla del tope por owner (si no, el 4to agente
// rebota con "max 3 agents per owner").
//
// Uso:
//   node --import tsx scripts/seed-house-agents.ts                  # contra localhost:4000
//   node --import tsx scripts/seed-house-agents.ts --url https://arcade1v1.onrender.com
//   node --import tsx scripts/seed-house-agents.ts --dry-run        # solo muestra el plan

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { agentAuthMessage } from "@arcade1v1/game-sdk/auth";

const WALLET_FILE = resolve(import.meta.dirname, "..", ".house-wallet.json");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const urlIdx = args.indexOf("--url");
const BASE = urlIdx >= 0 ? args[urlIdx + 1] : "http://localhost:4000";

// Los 15 de la casa: nombres con personalidad (nada de "Bot 1"), perillas
// variadas a propósito (validateParams del server acota a los rangos del
// registro; valores fuera de rango caen al borde, no fallan).
interface Seed {
  name: string;
  avatar: string;
  game: string;
  strategyId: string;
  params: Record<string, unknown>;
}
const SEEDS: Seed[] = [
  // 2048
  { name: "Doña Cuadritos", avatar: "🧠", game: "2048", strategyId: "2048.priority", params: { priority: ["down", "left", "right", "up"], greed: 0.85 } },
  { name: "Rincón Zen", avatar: "🌵", game: "2048", strategyId: "2048.corner", params: { corner: "down-left", patience: 0.9 } },
  { name: "Turbina", avatar: "⚡", game: "2048", strategyId: "2048.priority", params: { priority: ["left", "down", "right", "up"], greed: 0.1 } },
  // snake
  { name: "Culebra Golosa", avatar: "🐍", game: "snake", strategyId: "snake.greedy", params: { caution: 0.15 } },
  { name: "La Paciente", avatar: "🦖", game: "snake", strategyId: "snake.survivor", params: { foodPull: 0.25 } },
  // flappy
  { name: "Aleteo Fino", avatar: "🚀", game: "flappy", strategyId: "flappy.threshold", params: { riskOffset: 10, reaction: 1 } },
  { name: "Kamikaze del Caño", avatar: "🔥", game: "flappy", strategyId: "flappy.threshold", params: { riskOffset: -35, reaction: 4 } },
  { name: "Capitán Planeo", avatar: "🛸", game: "flappy", strategyId: "flappy.threshold", params: { riskOffset: 25, reaction: 2 } },
  // racing
  { name: "El Esquivador", avatar: "🎯", game: "racing", strategyId: "racing.dodger", params: { lookahead: 220, preferredLane: "center" } },
  { name: "Zigzag Salvaje", avatar: "🎲", game: "racing", strategyId: "racing.weaver", params: { boldness: 0.85 } },
  { name: "Abuelo Prudente", avatar: "🐙", game: "racing", strategyId: "racing.dodger", params: { lookahead: 100, preferredLane: "right" } },
  // invaders
  { name: "Cazadora Alfa", avatar: "👾", game: "invaders", strategyId: "invaders.hunter", params: { aggression: 1, dodge: 0.4 } },
  { name: "Muro Tímido", avatar: "🍄", game: "invaders", strategyId: "invaders.hunter", params: { aggression: 0.2, dodge: 1 } },
  // tetris
  { name: "Don Bloques", avatar: "🕹️", game: "tetris", strategyId: "tetris.heuristic", params: { holes: 9, height: 5, bumpiness: 2, lines: 9 } },
  { name: "Apilador Caótico", avatar: "🎮", game: "tetris", strategyId: "tetris.heuristic", params: { holes: 1, height: 0, bumpiness: 0, lines: 10 } },
];

function loadOrCreateWallet(): { address: string; privateKey: Hex } {
  if (existsSync(WALLET_FILE)) {
    const w = JSON.parse(readFileSync(WALLET_FILE, "utf8"));
    return { address: String(w.address).toLowerCase(), privateKey: w.privateKey as Hex };
  }
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address.toLowerCase();
  writeFileSync(WALLET_FILE, JSON.stringify({ address, privateKey }, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(`Wallet de la casa NUEVA generada y guardada en ${WALLET_FILE}`);
  console.log(`>>> Agregá esta address a HOUSE_WALLETS en el server: ${address}\n`);
  return { address, privateKey };
}

async function main() {
  const { address: owner, privateKey } = loadOrCreateWallet();
  const account = privateKeyToAccount(privateKey);
  console.log(`Árbitro: ${BASE}\nCasa:    ${owner}\n`);

  const r = await fetch(`${BASE}/agents?owner=${owner}`);
  if (!r.ok) throw new Error(`GET /agents -> ${r.status}`);
  const existing = (await r.json()) as { agents: { name: string; game: string }[] };
  const have = new Set(existing.agents.map((a) => `${a.game}:${a.name}`));

  let created = 0;
  let skipped = 0;
  for (const s of SEEDS) {
    if (have.has(`${s.game}:${s.name}`)) {
      skipped++;
      console.log(`= ya existe: [${s.game}] ${s.name}`);
      continue;
    }
    if (dryRun) {
      console.log(`~ crearía:   [${s.game}] ${s.avatar} ${s.name} (${s.strategyId})`);
      continue;
    }
    const ts = Date.now();
    const signature = await account.signMessage({
      message: agentAuthMessage("create", `${s.game}:${s.strategyId}:${s.name}`, owner, ts),
    });
    const res = await fetch(`${BASE}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner, ...s, signature, ts }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; id?: string };
    if (!res.ok) throw new Error(`[${s.game}] ${s.name}: ${body.error ?? res.status}`);
    created++;
    console.log(`+ creado:    [${s.game}] ${s.avatar} ${s.name} -> ${body.id}`);
  }
  console.log(`\nListo: ${created} creados, ${skipped} ya existían, ${SEEDS.length} en total.`);
}

main().catch((e) => {
  console.error(`\nERROR: ${(e as Error).message}`);
  process.exit(1);
});
