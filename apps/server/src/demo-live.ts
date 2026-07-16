// Demo EN VIVO en Base Sepolia: corre una partida 1v1 completa con dos jugadores
// que controla el script, para MOSTRAR que el pago on-chain funciona en la red
// publica. La comision (15%) va a la wallet de la plataforma (la del usuario).
//
// Correr desde apps/server:  npx tsx src/demo-live.ts

import "dotenv/config";
import { createPublicClient, createWalletClient, http, maxUint256, type Hex, type Abi } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { randomBytes } from "node:crypto";
import { signResult, signSeat } from "./sign.js";
import { escrowAbi, erc20Abi } from "./abi.js";

const RPC = process.env.RPC_URL || "https://sepolia.base.org";
const ESCROW = process.env.ESCROW_ADDRESS as Hex;
const USDC = "0xBE3A57a90548b336F5EBF997E6DA6d3DC64EE137" as Hex;
const PLATFORM = "0x15bd1EFcC9F23Ca34c99C8b22f79d707F392268C" as Hex; // wallet del usuario
const STAKE = 5_000_000n; // 5 USDC
const SCAN = "https://sepolia.basescan.org";

const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const wallet = (k: Hex) =>
  createWalletClient({ account: privateKeyToAccount(k), chain: baseSepolia, transport: http(RPC) });
const arb = wallet(process.env.ARBITER_PRIVATE_KEY as Hex);
const p1 = wallet(generatePrivateKey());
const p2 = wallet(generatePrivateKey());
const P1 = p1.account.address;
const P2 = p2.account.address;

async function send(
  w: ReturnType<typeof wallet>,
  address: Hex,
  abi: Abi,
  fn: string,
  args: unknown[],
) {
  const hash = await w.writeContract({
    address,
    abi,
    functionName: fn,
    args,
    account: w.account,
    chain: baseSepolia,
  } as never);
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}
const bal = (a: Hex) =>
  pub.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [a],
  }) as Promise<bigint>;
const usd = (x: bigint) => (Number(x) / 1e6).toFixed(2);

async function main() {
  console.log("Jugadores demo (controlados por el script):");
  console.log("  P1:", P1);
  console.log("  P2:", P2, "\n");

  // 1) Gas para los jugadores (desde el arbitro).
  for (const P of [P1, P2]) {
    const h = await arb.sendTransaction({ to: P, value: 12_000_000_000_000n, chain: baseSepolia }); // 0.000012 ETH
    await pub.waitForTransactionReceipt({ hash: h });
  }
  console.log("✓ jugadores fondeados con gas");

  // 2) USDC de prueba para cada uno.
  await send(arb, USDC, erc20Abi, "mint", [P1, STAKE]);
  await send(arb, USDC, erc20Abi, "mint", [P2, STAKE]);
  console.log("✓ 5 USDC de prueba a cada jugador");

  // 3) Cada jugador aprueba (una sola vez).
  await send(p1, USDC, erc20Abi, "approve", [ESCROW, maxUint256]);
  await send(p2, USDC, erc20Abi, "approve", [ESCROW, maxUint256]);

  // 4) P1 ABRE la partida depositando (modelo asincronico: no la crea el arbitro).
  //    El árbitro firma el ASIENTO de cada jugador (lo autoriza a esta partida);
  //    open/join lo exigen. Acá el matchId es local, así que firmamos directo.
  const matchId = ("0x" + randomBytes(32).toString("hex")) as Hex;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const seat1 = await signSeat(matchId, P1);
  const seat2 = await signSeat(matchId, P2);
  const dep1 = await send(p1, ESCROW, escrowAbi, "open", [
    matchId,
    STAKE,
    now + 3600n,
    now + 7200n,
    seat1,
  ]);
  console.log("✓ P1 abrió la partida (depositó)");

  // 5) P2 se UNE depositando -> partida lista.
  const dep2 = await send(p2, ESCROW, escrowAbi, "join", [matchId, seat2]);
  console.log("✓ P2 se unió (depositó) · escrow:", usd(await bal(ESCROW)), "USDC");

  // 6) Gana P1: el arbitro firma y se liquida.
  const platBefore = await bal(PLATFORM);
  const sig = await signResult(matchId, P1);
  const settleTx = await send(arb, ESCROW, escrowAbi, "settle", [matchId, P1, sig]);
  console.log("✓ liquidado (gana P1)\n");

  // 7) Resultado.
  console.log("=== RESULTADO EN BASE SEPOLIA (real) ===");
  console.log("  P1 (ganador) cobró:", usd(await bal(P1)), "USDC  (esperado 8.50)");
  console.log(
    "  TU wallet (comisión) recibió +" + usd((await bal(PLATFORM)) - platBefore),
    "USDC  (esperado 1.50)",
  );
  console.log("  escrow quedó en:", usd(await bal(ESCROW)), "USDC  (esperado 0.00)");
  console.log("\n=== VERLO EN EL EXPLORADOR ===");
  console.log("  P1 abrió:     ", `${SCAN}/tx/${dep1}`);
  console.log("  P2 se unió:   ", `${SCAN}/tx/${dep2}`);
  console.log("  PAGO (settle):", `${SCAN}/tx/${settleTx}`);
  console.log("  tu wallet:    ", `${SCAN}/address/${PLATFORM}`);
}

main().catch((e) => {
  console.error("Error:", (e as { shortMessage?: string }).shortMessage || (e as Error).message);
  process.exit(1);
});
