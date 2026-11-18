// Smoke de una MESA DE PLATA del 1v1 en testnet (Base Sepolia) contra el
// árbitro publicado: el paso 4 de docs/REDEPLOY-escrow1v1-preauditoria.md, con
// dos wallets descartables en vez de dos wallets a mano en la web. Es el
// equivalente 1v1 de scripts/aleph-money-smoke.mjs.
//
// Qué hace:
//   1. Crea dos wallets descartables (p1 y p2). Sus claves no se guardan.
//   2. La wallet de deploy de testnet (PRIVATE_KEY de packages/contracts/.env,
//      que nunca se imprime) les pasa ETH para el gas y les acuña 1 USDC de
//      prueba a cada una (el TestUSDC tiene mint abierto).
//   3. p1 pide asiento en la mesa de 1 USDC de 2048 y ABRE en el escrow; p2 pide
//      asiento (el árbitro lo sienta con p1 porque p1 ya abrió) y se UNE.
//   4. Juegan con dos estrategias distintas (para no empatar) y presentan.
//   5. Espera a que el árbitro liquide solo y revisa los saldos: el ganador
//      termina con 1,70 USDC (2 menos el 15 %) y la plataforma cobra 0,30.
//
// Solo testnet: cuesta unos 0,00005 ETH de Base Sepolia y tarda 1-2 minutos.
// Correr desde la raíz del repo (después de `npm ci`):
//   node --import tsx scripts/smoke-1v1-mesa-paga.mts
// Otro escrow o árbitro: ESCROW_ADDRESS=0x… ARBITER_URL=https://… delante.
// Sale con código 0 si todo cuadra y 1 si no.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseEther,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { baseSepolia } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createAgent } from "../packages/agent-sdk/src/index.ts";
import { signMatchmake, signScore } from "../packages/agent-sdk/src/sign.ts";
import { runStrategy } from "../packages/strategies/src/index.ts";

const ARBITRO = process.env.ARBITER_URL ?? "https://arcade1v1.onrender.com";
const RPC = process.env.RPC_URL ?? "https://sepolia.base.org";
// El Escrow1v1 revisado (pre-auditoría), desplegado el 2026-11-18.
const ESCROW = (process.env.ESCROW_ADDRESS ?? "0x8968dfcf16d9542320B6Fd7c857F9f2c5eE19938") as Hex;
const USDC = "0xBE3A57a90548b336F5EBF997E6DA6d3DC64EE137" as const; // TestUSDC
const UN_USDC = 1_000_000n;
const JUEGO = "2048";

const usdcAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const escrowAbi = parseAbi([
  "function open(bytes32 id, uint256 stake, uint64 fundDeadline, uint64 playDeadline, bytes seatSig)",
  "function join(bytes32 id, bytes seatSig)",
  "function platformWallet() view returns (address)",
]);

const envFile = fileURLToPath(new URL("../packages/contracts/.env", import.meta.url));
const env = parse(readFileSync(envFile));
if (!env.PRIVATE_KEY) throw new Error(`falta PRIVATE_KEY en ${envFile}`);
const deployer = privateKeyToAccount(env.PRIVATE_KEY as Hex);

const publico = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const billetera = (cuenta: PrivateKeyAccount) =>
  createWalletClient({ account: cuenta, chain: baseSepolia, transport: http(RPC) });

const usdc = (n: bigint) => (Number(n) / 1e6).toFixed(2);
const corto = (s: string) => `${s.slice(0, 10)}…`;
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
const saldo = (a: Hex) =>
  publico.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [a] });

async function esperar(hash: Hex, que: string) {
  const r = await publico.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${que}: la transacción ${hash} falló`);
  console.log(`  ✓ ${que} (${corto(hash)})`);
}

const p1Key = generatePrivateKey();
const p2Key = generatePrivateKey();
const p1 = privateKeyToAccount(p1Key);
const p2 = privateKeyToAccount(p2Key);
const plataforma = await publico.readContract({
  address: ESCROW,
  abi: escrowAbi,
  functionName: "platformWallet",
});
console.log(
  `escrow ${corto(ESCROW)} · deployer ${corto(deployer.address)} · p1 ${corto(p1.address)} · p2 ${corto(p2.address)}`,
);

// 2. Gas y USDC de prueba para los dos.
const dep = billetera(deployer);
for (const p of [p1, p2]) {
  await esperar(
    await dep.sendTransaction({ to: p.address, value: parseEther("0.00002") }),
    `ETH para ${corto(p.address)}`,
  );
  await esperar(
    await dep.writeContract({
      address: USDC,
      abi: usdcAbi,
      functionName: "mint",
      args: [p.address, UN_USDC],
    }),
    `1 USDC de prueba para ${corto(p.address)}`,
  );
}
const plataformaAntes = await saldo(plataforma);

// 3. Asientos y depósitos. El agente del SDK se niega a pedir asiento en una
// mesa de plata (no deposita, y no quiere dejar partidas fantasma): acá sí se
// deposita, así que se pide con el cliente de bajo nivel y la firma a mano.
const a1 = createAgent({ arbiterUrl: ARBITRO, privateKey: p1Key });
const a2 = createAgent({ arbiterUrl: ARBITRO, privateKey: p2Key });
async function pedirAsiento(agente: typeof a1, key: Hex) {
  const address = agente.address;
  const auth = await signMatchmake({ game: JUEGO, stake: 1, address, privateKey: key });
  return agente.client.matchmake(JUEGO, 1, address, auth);
}

const m1 = await pedirAsiento(a1, p1Key);
console.log(`p1: partida ${corto(m1.matchId)} · rol ${m1.role} · estado ${m1.status}`);
if (m1.role !== "p1" || !m1.seatSig || !m1.fundDeadline || !m1.playDeadline) {
  throw new Error(`p1 no recibió un asiento de apertura: ${JSON.stringify(m1).slice(0, 300)}`);
}
const w1 = billetera(p1);
await esperar(
  await w1.writeContract({
    address: USDC,
    abi: usdcAbi,
    functionName: "approve",
    args: [ESCROW, UN_USDC],
  }),
  "p1 aprueba 1 USDC",
);
await esperar(
  await w1.writeContract({
    address: ESCROW,
    abi: escrowAbi,
    functionName: "open",
    args: [
      m1.matchId as Hex,
      UN_USDC,
      BigInt(m1.fundDeadline),
      BigInt(m1.playDeadline),
      m1.seatSig as Hex,
    ],
  }),
  "p1 abre la partida en el escrow",
);

// p2 pide asiento: el árbitro lee la cadena y lo sienta con p1, que ya abrió.
let m2 = await pedirAsiento(a2, p2Key);
for (let i = 0; m2.matchId !== m1.matchId && i < 6; i++) {
  console.log(`  p2 cayó en otra partida (${corto(m2.matchId)}); reintento…`);
  await pausa(5_000);
  m2 = await pedirAsiento(a2, p2Key);
}
console.log(`p2: partida ${corto(m2.matchId)} · rol ${m2.role} · estado ${m2.status}`);
if (m2.matchId !== m1.matchId || m2.role !== "p2" || !m2.seatSig) {
  throw new Error("p2 no quedó sentado con p1");
}
const w2 = billetera(p2);
await esperar(
  await w2.writeContract({
    address: USDC,
    abi: usdcAbi,
    functionName: "approve",
    args: [ESCROW, UN_USDC],
  }),
  "p2 aprueba 1 USDC",
);
await esperar(
  await w2.writeContract({
    address: ESCROW,
    abi: escrowAbi,
    functionName: "join",
    args: [m1.matchId as Hex, m2.seatSig as Hex],
  }),
  "p2 se une a la partida en el escrow",
);

// 4. Juegan (estrategias distintas) y presentan.
if (m1.seed === undefined) throw new Error("la partida no trajo semilla");
const jugadas = [
  { agente: a1, cuenta: p1, key: p1Key, estrategia: "2048.corner" },
  { agente: a2, cuenta: p2, key: p2Key, estrategia: "2048.priority" },
];
for (const j of jugadas) {
  const { score, replay } = runStrategy(
    { game: JUEGO, strategyId: j.estrategia, params: {} },
    m1.seed,
  );
  const firma = await signScore({
    matchId: m1.matchId,
    address: j.cuenta.address,
    score,
    privateKey: j.key,
  });
  let presentado = false;
  for (let i = 0; !presentado && i < 6; i++) {
    try {
      await j.agente.client.submitScore(m1.matchId, j.cuenta.address, score, replay, firma);
      presentado = true;
    } catch (e) {
      console.log(`  presentación rechazada (${(e as Error).message}); reintento…`);
      await pausa(5_000);
    }
  }
  if (!presentado) throw new Error(`no se pudo presentar el puntaje de ${j.cuenta.address}`);
  console.log(`  ✓ ${corto(j.cuenta.address)} presentó ${score} puntos (${j.estrategia})`);
}

// 5. El árbitro liquida solo.
let v = await a1.client.getMatch(m1.matchId, p1.address);
for (let i = 0; !v.settleTx && !v.settleOutcome && i < 40; i++) {
  await pausa(5_000);
  v = await a1.client.getMatch(m1.matchId, p1.address);
}
console.log(
  `resultado: ${v.status} · ganador ${v.winner ? corto(v.winner) : "—"} · settleTx ${v.settleTx ?? "—"}`,
);
const [s1, s2, sp] = await Promise.all([saldo(p1.address), saldo(p2.address), saldo(plataforma)]);
console.log(
  `saldos: p1 ${usdc(s1)} USDC · p2 ${usdc(s2)} USDC · plataforma +${usdc(sp - plataformaAntes)} USDC`,
);
const ok =
  v.settleTx !== undefined &&
  (s1 === 1_700_000n || s2 === 1_700_000n) &&
  sp - plataformaAntes === 300_000n;
console.log(
  ok
    ? "SMOKE OK: el árbitro pagó 1,70 al ganador y 0,30 de comisión"
    : "SMOKE CON DIFERENCIAS: revisar arriba",
);
process.exit(ok ? 0 : 1);
