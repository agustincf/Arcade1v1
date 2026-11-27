// Smoke de una MESA DE PLATA del 1v1 en testnet (Base Sepolia) contra el
// árbitro publicado, jugada por DOS AGENTES DEL SDK solos, sin una persona:
// cada uno hace `playAndSubmit({ game: "racing", stake: 1 })` con `paid1v1`, y
// el SDK revisa, se sienta, aprueba, deposita, juega en vivo y el árbitro paga.
// Es también el paso 4 de docs/REDEPLOY-escrow1v1-preauditoria.md (después de
// un redeploy de Escrow1v1) y el equivalente 1v1 de scripts/aleph-money-smoke.mjs.
//
// Qué hace:
//   1. Crea dos wallets descartables (p1 y p2). Sus claves no se guardan.
//   2. La wallet de deploy de testnet (PRIVATE_KEY de packages/contracts/.env,
//      que nunca se imprime) les pasa ETH para el gas. El USDC de prueba se lo
//      acuña cada agente con `mintTestUsdc` (el TestUSDC tiene mint abierto).
//   3. p1 juega Carrera en la mesa de 1 USDC con la estrategia por defecto: abre
//      en el escrow y juega. p2 juega con una estrategia que no se mueve (para
//      no empatar): el árbitro lo sienta con p1 y se une.
//   4. Espera a que el árbitro liquide solo y revisa los saldos: el ganador
//      termina con 1,70 USDC (2 menos el 15 %) y la plataforma cobra 0,30.
//
// Solo testnet: cuesta unos 0,0001 ETH de Base Sepolia y tarda 1-3 minutos.
// Correr desde la raíz del repo (después de `npm ci`):
//   node --import tsx scripts/smoke-1v1-mesa-paga.mts
// Otro escrow o árbitro: ESCROW_ADDRESS=0x… ARBITER_URL=https://… delante.
// Sale con código 0 si todo cuadra y 1 si no.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { createPublicClient, createWalletClient, http, parseAbi, parseEther, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createAgent, type LiveStrategy } from "../packages/agent-sdk/src/index.ts";

const ARBITRO = process.env.ARBITER_URL ?? "https://arcade1v1.onrender.com";
const RPC = process.env.RPC_URL ?? "https://sepolia.base.org";
// El Escrow1v1 revisado (pre-auditoría), desplegado el 2026-11-18.
const ESCROW = (process.env.ESCROW_ADDRESS ?? "0x8968dfcf16d9542320B6Fd7c857F9f2c5eE19938") as Hex;
const USDC = "0xBE3A57a90548b336F5EBF997E6DA6d3DC64EE137" as const; // TestUSDC

const usdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const escrowAbi = parseAbi(["function platformWallet() view returns (address)"]);

const envFile = fileURLToPath(new URL("../packages/contracts/.env", import.meta.url));
const env = parse(readFileSync(envFile));
if (!env.PRIVATE_KEY) throw new Error(`falta PRIVATE_KEY en ${envFile}`);
const deployer = privateKeyToAccount(env.PRIVATE_KEY as Hex);

const publico = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const usdc = (n: bigint) => (Number(n) / 1e6).toFixed(2);
const corto = (s: string) => `${s.slice(0, 10)}…`;
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
const saldo = (a: Hex) =>
  publico.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [a] });

const p1Key = generatePrivateKey();
const p2Key = generatePrivateKey();
const agente = (key: Hex) =>
  createAgent({
    arbiterUrl: ARBITRO,
    privateKey: key,
    paid1v1: { rpcUrl: RPC, escrow: ESCROW, chainId: 84532, maxStake: 1 },
  });
const a1 = agente(p1Key);
const a2 = agente(p2Key);
const plataforma = await publico.readContract({
  address: ESCROW,
  abi: escrowAbi,
  functionName: "platformWallet",
});
console.log(
  `escrow ${corto(ESCROW)} · deployer ${corto(deployer.address)} · p1 ${corto(a1.address)} · p2 ${corto(a2.address)}`,
);

// 2. ETH para el gas (lo único que pone una persona) y USDC de prueba.
const dep = createWalletClient({ account: deployer, chain: baseSepolia, transport: http(RPC) });
for (const a of [a1, a2]) {
  const hash = await dep.sendTransaction({ to: a.address, value: parseEther("0.00005") });
  const r = await publico.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`ETH para ${a.address}: la transacción falló`);
  const m = await a.mintTestUsdc(1);
  console.log(`  ✓ ${corto(a.address)}: ETH para el gas y 1 USDC de prueba (${corto(m.txHash)})`);
}
const plataformaAntes = await saldo(plataforma);

// 3. Los dos agentes juegan solos.
const quieto: LiveStrategy = { decide: () => null, maxTicks: 6_000 };
const r1 = await a1.playAndSubmit({ game: "racing", stake: 1 });
console.log(
  `  ✓ p1: ${r1.deposit?.step} en ${corto(r1.matchId)}, jugó; espera rival: ${r1.waitingForRival}`,
);
const r2 = await a2.playAndSubmit({ game: "racing", stake: 1, liveStrategy: quieto });
console.log(`  ✓ p2: ${r2.deposit?.step} en ${corto(r2.matchId)}, jugó`);
if (r2.matchId !== r1.matchId) {
  console.log("SMOKE CON DIFERENCIAS: los dos agentes quedaron en partidas distintas");
  process.exit(1);
}

// 4. El árbitro liquida solo.
let v = await a1.getResult(r1.matchId);
for (let i = 0; !v.settleTx && !v.settleOutcome && i < 40; i++) {
  await pausa(5_000);
  v = await a1.getResult(r1.matchId);
}
console.log(
  `resultado: ${v.status} · ganador ${v.winner ? corto(v.winner) : "—"} · settleTx ${v.settleTx ?? "—"}`,
);
const [s1, s2, sp] = await Promise.all([saldo(a1.address), saldo(a2.address), saldo(plataforma)]);
console.log(
  `saldos: p1 ${usdc(s1)} USDC · p2 ${usdc(s2)} USDC · plataforma +${usdc(sp - plataformaAntes)} USDC`,
);
const ok =
  v.settleTx !== undefined &&
  (s1 === 1_700_000n || s2 === 1_700_000n) &&
  sp - plataformaAntes === 300_000n;
console.log(
  ok
    ? "SMOKE OK: dos agentes jugaron solos y el árbitro pagó 1,70 al ganador y 0,30 de comisión"
    : "SMOKE CON DIFERENCIAS: revisar arriba",
);
process.exit(ok ? 0 : 1);
