// PAGO DE UNA MESA DE PLATA de punta a punta en cadena local (anvil), con el
// árbitro REAL (funciones in-process): 4 wallets se sientan, reciben su pase,
// abren/depositan en EscrowAleph, el árbitro ve los depósitos y arranca, juegan
// hasta liquidar, el árbitro firma la tabla en USDC y la manda, y cada uno cobra
// exactamente lo que dice la tabla. Después: un fondeo incompleto que vence y el
// árbitro cancela on-chain. Antes de todo: los digests EIP-712 del árbitro (viem)
// coinciden bit a bit con los del contrato.
//
// Todos los tests del árbitro corren contra una cadena INYECTADA (`fakeChain`):
// prueban que el árbitro es coherente consigo mismo, no que un contrato de
// verdad acepte lo que produce. Esto es lo único que cruza esa costura.
//
// Variables (las pone check-aleph-e2e.sh): RPC_URL, CHAIN_ID=31337,
// ALEPH_ESCROW_ADDRESS, USDC_ADDR, ARBITER_PRIVATE_KEY, ALEPH_STAKES=0,2,
// ALEPH_MAX_SEATS=4, ALEPH_FUNDING_MS (corto, para el escenario de vencimiento).
//
// A propósito SIN "dotenv/config": todo lo que hace falta lo pasa el wrapper por
// entorno, y así ningún .env del repo (que localmente puede tener la clave y el
// RPC de una red de VERDAD) se cuela en una corrida contra anvil.
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  hashTypedData,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { escrowAlephAbi, erc20MinimalAbi, usdcPayoutTable } from "@arcade1v1/game-sdk/aleph";
import {
  matchmakeAuthMessage,
  alephViewAuthMessage,
  alephActionAuthMessage,
} from "@arcade1v1/game-sdk/auth";
import { actionLine, type AlephAction } from "@arcade1v1/game-sdk/aleph";
import {
  joinAleph,
  getAlephRoom,
  actAleph,
  alephChainTick,
  alephLog,
  ALEPH_FUNDING_MS,
} from "./aleph.js";
import {
  alephDomain,
  ALEPH_SEAT_TYPES,
  ALEPH_PAYOUT_TYPES,
  alephSeatsHash,
  alephTableHash,
} from "./sign.js";

const RPC = process.env.RPC_URL || "http://localhost:8545";
const USDC = process.env.USDC_ADDR as Hex;
const ESCROW = process.env.ALEPH_ESCROW_ADDRESS as Hex;
const STAKE = 2_000_000n;

// Cuentas estándar de anvil (públicas, sin valor). La #1 es el árbitro (la misma
// que usan offline-env.ts y check-aleph-deploy.sh) y la #3 la plataforma (la
// misma que check-payment-e2e.sh): por eso los asientos son la #2, #4, #5 y #6.
// Que un asiento fuera TAMBIÉN la plataforma haría que su fila y la comisión
// cayeran en la misma balance, y las dos comprobaciones del final dejarían de
// significar nada.
const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SEAT_KEYS = [
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
] as const;
const PLATFORM = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as Hex;

// `seatsHashOf` no está en el ABI del game-sdk (el árbitro no lo necesita: el
// hash lo calcula él). Acá sí, para cruzar `alephSeatsHash` contra el contrato.
const seatsHashOfAbi = [
  {
    type: "function",
    name: "seatsHashOf",
    inputs: [{ name: "seats", type: "address[]" }],
    outputs: [{ type: "bytes32" }],
    stateMutability: "pure",
  },
] as const;

const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = (k: string) =>
  createWalletClient({
    account: privateKeyToAccount(k as Hex),
    chain: foundry,
    transport: http(RPC),
  });
const owner = wallet(OWNER_KEY);
const seats = SEAT_KEYS.map((k) => ({
  w: wallet(k),
  pk: k as Hex,
  address: privateKeyToAccount(k as Hex).address,
}));
const low = (a: string) => a.toLowerCase() as Hex;

async function send(
  c: ReturnType<typeof wallet>,
  address: Hex,
  abi: unknown,
  fn: string,
  args: unknown[],
) {
  const hash = await c.writeContract({
    address,
    abi,
    functionName: fn,
    args,
    account: c.account,
    chain: foundry,
  } as never);
  await pub.waitForTransactionReceipt({ hash });
}
const bal = (a: Hex) =>
  pub.readContract({
    address: USDC,
    abi: erc20MinimalAbi,
    functionName: "balanceOf",
    args: [a],
  }) as Promise<bigint>;
const usd = (x: bigint) => (Number(x) / 1e6).toFixed(6);

function fail(msg: string): never {
  console.log(`\n❌ ${msg}`);
  process.exit(1);
}

async function join(s: (typeof seats)[number], now: number) {
  const acc = privateKeyToAccount(s.pk);
  const signature = await acc.signMessage({
    message: matchmakeAuthMessage("aleph", 2, low(s.address), now),
  });
  return joinAleph(2, s.address, { signature, ts: now }, now);
}
async function view(roomId: string, s: (typeof seats)[number], now: number) {
  const acc = privateKeyToAccount(s.pk);
  const signature = await acc.signMessage({
    message: alephViewAuthMessage(roomId, low(s.address), now),
  });
  return (await getAlephRoom(roomId, s.address, now, { signature, ts: now }))!;
}
async function act(
  roomId: string,
  s: (typeof seats)[number],
  stage: number,
  phase: "talk" | "decide",
  action: AlephAction,
  now: number,
) {
  const acc = privateKeyToAccount(s.pk);
  const signature = await acc.signMessage({
    message: alephActionAuthMessage(roomId, stage, phase, actionLine(action), now),
  });
  return actAleph(roomId, s.address, { stage, phase, action, signature, ts: now }, now);
}

/** Misma política guionada que los tests: lleva la sala al final sin esperar plazos. */
function policy(v: Awaited<ReturnType<typeof view>>, me: string): AlephAction {
  const st = v.stage!;
  if (st.phase === "talk") return { type: "ready" };
  const alive = v.seats.filter((x) => x.status === "alive");
  switch (st.kind) {
    case "share":
      return { type: me === alive[0].address ? "keep" : "contribute" };
    case "offer":
      return { type: "decline" };
    case "vote":
      return { type: "vote", target: (alive.find((x) => x.address !== me) ?? alive[0]).address };
    case "lock":
      return { type: "ready" };
    default:
      return { type: "split" };
  }
}

async function digestCheck() {
  console.log("--- 0) Digests EIP-712: árbitro (viem) == contrato ---");
  const roomId = ("0x" + "11".repeat(32)) as Hex;
  const list = seats.map((s) => low(s.address));
  // `seatsHash` PRIMERO y por separado: `seatDigest` lo recibe como argumento,
  // así que comparar digests no diría nada sobre él. Si `alephSeatsHash`
  // difiriera del `keccak256(abi.encode(seats))` que el contrato calcula solo
  // dentro de `open`, el único síntoma sería un "bad seat" desconcertante.
  const seatsHash = alephSeatsHash(list);
  const onchainSeatsHash = (await pub.readContract({
    address: ESCROW,
    abi: seatsHashOfAbi,
    functionName: "seatsHashOf",
    args: [list],
  })) as Hex;
  if (seatsHash.toLowerCase() !== onchainSeatsHash.toLowerCase())
    fail(`seatsHash difiere: viem ${seatsHash} · contrato ${onchainSeatsHash}`);
  const msg = {
    roomId,
    seatsHash,
    stake: STAKE,
    fundDeadline: 1_900_000_000n,
    playDeadline: 1_900_010_800n,
    player: list[0],
  };
  const ours = hashTypedData({
    domain: alephDomain(),
    types: ALEPH_SEAT_TYPES,
    primaryType: "Seat",
    message: msg,
  });
  const theirs = (await pub.readContract({
    address: ESCROW,
    abi: escrowAlephAbi,
    functionName: "seatDigest",
    args: [roomId, msg.seatsHash, msg.stake, msg.fundDeadline, msg.playDeadline, msg.player],
  })) as Hex;
  if (ours.toLowerCase() !== theirs.toLowerCase())
    fail(`seatDigest difiere: viem ${ours} · contrato ${theirs}`);
  const amounts = [1n, 2n, 3n, 4n];
  const tableHash = alephTableHash(list, amounts);
  const onchainHash = (await pub.readContract({
    address: ESCROW,
    abi: escrowAlephAbi,
    functionName: "tableHashOf",
    args: [list, amounts],
  })) as Hex;
  if (tableHash.toLowerCase() !== onchainHash.toLowerCase())
    fail("tableHash difiere entre viem y el contrato");
  const oursP = hashTypedData({
    domain: alephDomain(),
    types: ALEPH_PAYOUT_TYPES,
    primaryType: "Payout",
    message: { roomId, tableHash },
  });
  const theirsP = (await pub.readContract({
    address: ESCROW,
    abi: escrowAlephAbi,
    functionName: "payoutDigest",
    args: [roomId, tableHash],
  })) as Hex;
  if (oursP.toLowerCase() !== theirsP.toLowerCase())
    fail("payoutDigest difiere entre viem y el contrato");
  console.log("✓ seatsHash, seatDigest, tableHash y payoutDigest coinciden");
}

async function prepare() {
  await send(owner, ESCROW, escrowAlephAbi, "setAllowedStake", [STAKE, true]);
  await owner.sendTransaction({
    to: privateKeyToAccount(process.env.ARBITER_PRIVATE_KEY as Hex).address,
    value: parseEther("1"),
    chain: foundry,
  });
  for (const s of seats) {
    await send(owner, USDC, erc20MinimalAbi, "mint", [s.address, STAKE]);
    await send(s.w, USDC, erc20MinimalAbi, "approve", [ESCROW, STAKE]);
  }
}

async function happyPath() {
  console.log("\n--- 1) Cuatro asientos fondean, juegan y cobran ---");
  let now = Date.now();
  let v;
  for (const s of seats) v = await join(s, now);
  if (v!.status !== "funding") fail(`esperaba funding, hay ${v!.status}`);
  const roomId = v!.roomId;

  // Cada asiento deposita con su pase: el primero abre, los demás depositan.
  for (let i = 0; i < seats.length; i++) {
    const mine = await view(roomId, seats[i], now);
    const d = mine.deposit;
    if (!d) fail(`el asiento ${i} no recibió su pase`);
    if (i === 0) {
      await send(seats[0].w, ESCROW, escrowAlephAbi, "open", [
        roomId,
        d.seats,
        BigInt(d.stake),
        BigInt(d.fundDeadline),
        BigInt(d.playDeadline),
        d.seatSig,
      ]);
    } else {
      await send(seats[i].w, ESCROW, escrowAlephAbi, "deposit", [roomId, d.seatSig]);
    }
  }
  const inEscrow = await bal(ESCROW);
  if (inEscrow !== STAKE * 4n) fail(`el escrow tiene ${usd(inEscrow)} USDC, esperaba 8`);
  console.log("✓ 4 depósitos · escrow:", usd(inEscrow), "USDC (esperado 8)");

  await alephChainTick(now);
  v = (await getAlephRoom(roomId, undefined, now))!;
  if (v.status !== "playing") fail(`el árbitro no vio los depósitos: ${v.status}`);
  console.log("✓ la sala arrancó al ver los N depósitos · commit:", v.commit);

  // Jugar hasta el final.
  for (let guard = 0; guard < 400 && v.status !== "settled"; guard++) {
    for (const s of seats) {
      const mine = await view(roomId, s, now);
      const you = mine.you;
      if (mine.status !== "playing" || !you || you.status !== "alive" || you.decided || you.ready)
        continue;
      await act(roomId, s, mine.stage!.index, mine.stage!.phase, policy(mine, low(s.address)), now);
      now += 50;
    }
    v = (await getAlephRoom(roomId, undefined, now))!;
  }
  if (v.status !== "settled") fail("la sala no terminó");
  console.log("✓ liquidada en unidades:", JSON.stringify(v.payouts));

  await alephChainTick(now + 1);
  v = (await getAlephRoom(roomId, undefined, now + 1))!;
  if (!v.settleTx || !/^0x[0-9a-f]{64}$/i.test(v.settleTx)) fail(`sin settleTx: ${v.settleTx}`);
  console.log("✓ settle enviado:", v.settleTx);

  const feeBps = Number(
    await pub.readContract({ address: ESCROW, abi: escrowAlephAbi, functionName: "feeBps" }),
  );
  const t = usdcPayoutTable(
    seats.map((s) => low(s.address)),
    v.payouts!,
    STAKE,
    feeBps,
  );
  for (let i = 0; i < seats.length; i++) {
    const b = await bal(seats[i].address);
    if (b !== t.amounts[i]) fail(`asiento ${i}: cobró ${usd(b)}, esperaba ${usd(t.amounts[i])}`);
  }
  const p = await bal(PLATFORM);
  if (p !== t.fee + t.dust)
    fail(`plataforma: ${usd(p)}, esperaba ${usd(t.fee + t.dust)} (comisión + polvo)`);
  if ((await bal(ESCROW)) !== 0n) fail("el escrow no quedó en cero");
  console.log("✓ cada asiento cobró su fila; plataforma =", usd(p), "(comisión + polvo); escrow 0");

  const log = alephLog(roomId, now + 2);
  if (!log.usdc?.signature || !log.usdc.table)
    fail("el registro no publica la tabla en USDC ni su firma");
  console.log("\nPAGO DE UNA MESA DE PLATA VERIFICADO ✅");
}

async function unfundedScenario() {
  console.log(
    "\n--- 2) Fondeo incompleto: vence, el árbitro cancela, cada uno recupera lo suyo ---",
  );
  // Los mismos 4 asientos (ya liberados). Solo dos depositan.
  for (const s of seats.slice(0, 2)) {
    await send(owner, USDC, erc20MinimalAbi, "mint", [s.address, STAKE]);
    await send(s.w, USDC, erc20MinimalAbi, "approve", [ESCROW, STAKE]);
  }
  const before = await Promise.all(seats.map((s) => bal(s.address)));
  let now = Date.now();
  let v;
  for (const s of seats) v = await join(s, now);
  if (v!.status !== "funding") fail(`esperaba funding, hay ${v!.status}`);
  const roomId = v!.roomId;
  const d0 = (await view(roomId, seats[0], now)).deposit!;
  await send(seats[0].w, ESCROW, escrowAlephAbi, "open", [
    roomId,
    d0.seats,
    BigInt(d0.stake),
    BigInt(d0.fundDeadline),
    BigInt(d0.playDeadline),
    d0.seatSig,
  ]);
  const d1 = (await view(roomId, seats[1], now)).deposit!;
  await send(seats[1].w, ESCROW, escrowAlephAbi, "deposit", [roomId, d1.seatSig]);
  if ((await bal(ESCROW)) !== STAKE * 2n) fail("esperaba 2 stakes en el escrow");

  await alephChainTick(now);
  v = (await getAlephRoom(roomId, undefined, now))!;
  if (v.status !== "funding" || v.deposited?.length !== 2)
    fail(`el árbitro no vio los 2 depósitos: ${JSON.stringify(v.deposited)}`);

  // Vence el plazo del ÁRBITRO (reloj inyectado): disuelve y cancela on-chain.
  now += ALEPH_FUNDING_MS + 1;
  await alephChainTick(now);
  await alephChainTick(now + 1);
  v = (await getAlephRoom(roomId, undefined, now + 1))!;
  if (v.status !== "dissolved") fail(`esperaba dissolved, hay ${v.status}`);
  const after = await Promise.all(seats.map((s) => bal(s.address)));
  for (let i = 0; i < seats.length; i++) {
    if (after[i] !== before[i]) fail(`asiento ${i}: ${usd(after[i])} vs ${usd(before[i])} antes`);
  }
  if ((await bal(ESCROW)) !== 0n) fail("el escrow no devolvió todo");
  console.log("✓ los dos que depositaron recuperaron su stake; los otros no perdieron nada");
  console.log("\nREEMBOLSO POR FONDEO INCOMPLETO VERIFICADO ✅");
}

async function main() {
  await digestCheck();
  await prepare();
  await happyPath();
  await unfundedScenario();
}

main().catch((e) => {
  console.error("Error:", (e as { shortMessage?: string }).shortMessage || (e as Error).message);
  process.exit(1);
});
