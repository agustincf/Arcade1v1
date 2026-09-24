#!/usr/bin/env node
// SMOKE de la mesa de plata de Aleph contra el árbitro PUBLICADO en Base
// Sepolia: cuatro wallets efímeras del agent-sdk se sientan en la mesa de 2
// USDC, esperan a que cierre el lobby (hasta ALEPH_LOBBY_MS, 10 min), reciben
// gas y USDC de prueba de la wallet que fondea, depositan, juegan con una
// política guionada que solo manda acciones legales y, al final, comprueban que
// el contrato le pagó a cada asiento lo que da la tabla recalculada con la
// comisión que se lee del propio contrato. Tarda 15-30 minutos: el lobby y el
// fondeo tienen plazos reales.
//
// Antes de gastar nada corre un CHEQUEO PREVIO de solo lectura: la red, el
// escrow, el árbitro, el saldo de la wallet que fondea y el mint del USDC de
// prueba. Con `--preflight` corre solo eso.
//
// Uso normal: el lanzador carga la clave de packages/contracts/.env y se la pasa
// a este proceso por entorno, nunca por una línea de comandos ni por la salida.
//   bash packages/contracts/smoke-aleph-base-sepolia.sh <ALEPH_ESCROW_ADDRESS> [--preflight]
// Chequeo previo sin ninguna clave:
//   ALEPH_ESCROW_ADDRESS=0x… SMOKE_FUNDER_ADDRESS=0x… \
//     node --import tsx scripts/aleph-money-smoke.mjs --preflight
//
// Variables:
//   ALEPH_ESCROW_ADDRESS      OBLIGATORIA: el EscrowAleph en el que confía el smoke (el pin).
//   FUNDER_KEY                clave de la wallet que fondea; obligatoria salvo con --preflight.
//   SMOKE_FUNDER_ADDRESS      con --preflight y sin clave: la dirección de esa wallet.
//   ARBITER_URL               default https://arcade1v1.onrender.com
//   RPC_URL                   default https://sepolia.base.org
//   SMOKE_GAS_PER_WALLET_WEI  opcional: pisa el gas calculado para cada wallet efímera.
import { pathToFileURL } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  formatEther,
  formatGwei,
  formatUnits,
  getAddress,
  http,
  keccak256,
  recoverAddress,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import {
  ArbiterClient,
  COLD_START_TIMEOUT_MS,
  createAgent,
  legalActions,
} from "@arcade1v1/agent-sdk";
import {
  ALEPH_ESCROW_STATUS,
  erc20MinimalAbi,
  escrowAlephAbi,
  stakeToUnits,
  usdcPayoutTable,
} from "@arcade1v1/game-sdk/aleph";

const CHAIN_ID = 84532; // Base Sepolia
const STAKE_USDC = 2;
const STAKE_UNITS = stakeToUnits(STAKE_USDC); // micro-USDC
const SEATS = 4;
const DEFAULT_ARBITER = "https://arcade1v1.onrender.com";
const DEFAULT_RPC = "https://sepolia.base.org";
const WEB = "https://arcade1v1.com";
const ZERO = "0x" + "0".repeat(40);
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

// GAS DE CADA WALLET EFÍMERA: 1 000 000 de gas al precio de la red en el
// momento, por 5, con un piso de 0,00002 ETH; SMOKE_GAS_PER_WALLET_WEI lo pisa.
// Cada wallet manda dos transacciones: el approve y el open o el deposit. El
// margen cubre que el precio suba entre el cálculo y el depósito; el piso, el
// costo de datos en L1 que Base cobra aparte y que `gasPrice` no incluye, que es
// lo que más pesa cuando el gas de L2 está casi en cero.
const GAS_UNITS_PER_WALLET = 1_000_000n;
const GAS_MARGIN = 5n;
const GAS_FLOOR_WEI = 20_000_000_000_000n;
// Las 8 transacciones de la wallet que fondea: 4 envíos de ETH (21 000 de gas
// cada uno) y 4 `mint` del USDC de prueba (se cuentan 100 000 por mint, con
// holgura), con el mismo margen y el mismo piso.
const FUNDER_TX_GAS = 4n * 21_000n + 4n * 100_000n;

// TOPES: nada puede dejar el smoke colgado. Hay uno total y uno por fase. Los del
// lobby y del fondeo cuelgan de los plazos que publica el árbitro, con margen
// para su ticker (cada 5 s) y para la gracia con que disuelve un fondeo (2 min).
const TOTAL_CAP_MS = 45 * 60_000;
const LOBBY_MARGIN_MS = 2 * 60_000;
const FUNDING_MARGIN_MS = 3 * 60_000;
// Con menos que esto hasta el plazo de fondeo no se gasta: las transacciones del
// fondeo y de los depósitos, cada una esperando su recibo, podrían no entrar.
const MIN_FUNDING_LEFT_MS = 3 * 60_000;
const PLAY_CAP_MS = 20 * 60_000;
const SETTLE_CAP_MS = 5 * 60_000;
const RECEIPT_TIMEOUT_MS = 2 * 60_000;

// El árbitro limita los POST de /aleph (sentarse y actuar) a 12 cada 10 s por IP
// (RL_MAX_EXPENSIVE), y los 4 agentes del smoke salen de la misma IP: uno por
// segundo como mucho deja margen. Un pedido rechazado también cuenta para el
// límite, así que ante un 429 se espera la ventana entera en vez de insistir.
const POST_SPACING_MS = 1_000;
const RATE_WINDOW_MS = 10_000;

// `allowedStake` no está en el ABI del game-sdk (ni el árbitro ni el SDK lo
// leen): alcanza con el getter público del mapping.
const allowedStakeAbi = [
  {
    type: "function",
    name: "allowedStake",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
];
const ESCROW_STATUS_NAME = Object.fromEntries(
  Object.entries(ALEPH_ESCROW_STATUS).map(([name, n]) => [n, name]),
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lower = (a) => String(a).toLowerCase();
const maxBig = (a, b) => (a > b ? a : b);
const eth = (wei) => `${formatEther(wei)} ETH`;
const usdc = (units) => `${formatUnits(units, 6)} USDC`;
const clock = (ms) => (Number.isFinite(ms) ? new Date(ms).toTimeString().slice(0, 8) : "?");
const rateLimited = (e) => / 429:/.test(errMsg(e));

/** El motivo legible de un error. De viem se toma `shortMessage` (y `details`,
 *  si es corto): el `message` completo de un error de red lista la URL del RPC,
 *  en la que suele viajar una clave de API (viem solo tacha usuario y
 *  contraseña). */
function errMsg(e) {
  if (e && typeof e === "object" && typeof e.shortMessage === "string" && e.shortMessage) {
    const details =
      typeof e.details === "string" && e.details.length <= 200 ? ` (${e.details})` : "";
    return `${e.shortMessage}${details}`;
  }
  return e instanceof Error ? e.message : String(e);
}

// La sala en juego. Desde que existe, toda falla la imprime con su link, para
// mirarla en la web o verificarla después aunque el smoke haya muerto.
let currentRoom;

function fail(msg) {
  console.error(`\n❌ ${msg}`);
  if (currentRoom) {
    console.error(`   sala: ${currentRoom}`);
    console.error(`   ${WEB}/aleph/${currentRoom}`);
  }
  process.exit(1);
}

/** Negarse antes de crear un solo cliente: hasta acá no se tocó la red. */
function refuse(msg) {
  console.error(`❌ ${msg}`);
  console.error("   No se tocó la red.");
  process.exit(2);
}

/** Reintenta una lectura, o una operación idempotente por diseño (`alephJoin` y
 *  `alephDeposit` miran el estado antes de mandar nada), cuando tropieza con la
 *  red: el árbitro corre en un host gratuito y el RPC público reparte entre
 *  nodos que pueden ir un bloque atrás. Un envío suelto (`sendTransaction`,
 *  `writeContract`) nunca pasa por acá: reintentarlo a ciegas puede duplicarlo. */
async function retry(label, fn, attempts = 4, delayMs = 5_000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      // El `cause` queda para quien inspeccione el error; `fail` imprime solo el
      // mensaje, que no lleva la URL del RPC (ver errMsg).
      if (i === attempts) throw new Error(`${label}: ${errMsg(e)}`, { cause: e });
      const wait = rateLimited(e) ? RATE_WINDOW_MS : delayMs;
      console.log(
        `  ⚠ ${label}: ${errMsg(e)} (reintento ${i} de ${attempts - 1} en ${wait / 1000} s)`,
      );
      await sleep(wait);
    }
  }
}

let lastPostAt = 0;
/** Espacia los POST al árbitro (ver POST_SPACING_MS). */
async function paced(fn) {
  const wait = lastPostAt + POST_SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastPostAt = Date.now();
  return fn();
}

/** Lee y valida el entorno antes de crear un solo cliente: con cualquier valor
 *  que no sirva, el smoke se niega sin tocar la red. Ningún mensaje repite el
 *  valor de una variable ni de un argumento, porque en cualquiera se puede pegar
 *  una clave por error. */
function readConfig(argv, env) {
  const preflight = argv.includes("--preflight");
  const extra = argv.filter((a) => a !== "--preflight");
  if (extra.length > 0) {
    // Una bandera mal escrita sí se muestra: con esa forma no puede ser una clave.
    const shown = /^--[a-z-]{1,30}$/.test(extra[0]) ? ` (${extra[0]})` : "";
    refuse(`argumento no reconocido${shown}: el único que se acepta es --preflight.`);
  }

  // EL PIN es obligatorio y sale solo de acá: el escrow nunca se toma de la
  // respuesta del árbitro. Misma regla que createAgent: 0x + 40 hex y no la cero.
  const rawPin = env.ALEPH_ESCROW_ADDRESS;
  if (rawPin === undefined || rawPin === "") {
    refuse(
      "falta ALEPH_ESCROW_ADDRESS: la dirección del EscrowAleph en el que confía el smoke. " +
        "Es obligatoria: el escrow no se toma de la respuesta del árbitro.",
    );
  }
  if (!ADDRESS_RE.test(rawPin) || lower(rawPin) === ZERO) {
    refuse(
      "ALEPH_ESCROW_ADDRESS no sirve de pin: tiene que ser 0x seguido de 40 dígitos hex, " +
        "y no la dirección cero (su valor no se muestra).",
    );
  }
  // Al checksum EIP-55: viem rechaza una dirección con mayúsculas que no formen
  // un checksum válido, y el pin no lo exige.
  const pin = getAddress(lower(rawPin));

  let funderAccount;
  const key = env.FUNDER_KEY;
  if (key !== undefined && key !== "") {
    if (!KEY_RE.test(key)) {
      refuse(
        "FUNDER_KEY no es una clave privada: 0x seguido de 64 dígitos hex (su valor no se muestra).",
      );
    }
    try {
      funderAccount = privateKeyToAccount(key);
    } catch {
      refuse("FUNDER_KEY no es una clave privada válida (su valor no se muestra).");
    }
  }
  let funderAddress;
  const rawFunder = env.SMOKE_FUNDER_ADDRESS;
  if (rawFunder !== undefined && rawFunder !== "") {
    if (!ADDRESS_RE.test(rawFunder)) {
      refuse(
        "SMOKE_FUNDER_ADDRESS tiene que ser 0x seguido de 40 dígitos hex (su valor no se muestra).",
      );
    }
    funderAddress = getAddress(lower(rawFunder));
  }
  if (!preflight && !funderAccount) {
    refuse(
      "falta FUNDER_KEY, la clave de la wallet que fondea. Corré el smoke con " +
        "packages/contracts/smoke-aleph-base-sepolia.sh, que la toma de .env sin pasarla por " +
        "una línea de comandos. Sin clave solo corre --preflight.",
    );
  }
  if (funderAccount && funderAddress && funderAddress !== funderAccount.address) {
    refuse(
      `SMOKE_FUNDER_ADDRESS no es la dirección de FUNDER_KEY (${funderAccount.address}): dejá una sola.`,
    );
  }

  let gasOverride;
  const gas = env.SMOKE_GAS_PER_WALLET_WEI;
  if (gas !== undefined && gas !== "") {
    if (!/^[0-9]{1,30}$/.test(gas) || BigInt(gas) === 0n) {
      refuse("SMOKE_GAS_PER_WALLET_WEI tiene que ser un entero positivo, en wei.");
    }
    gasOverride = BigInt(gas);
  }

  const arbiterUrl = (env.ARBITER_URL || DEFAULT_ARBITER).replace(/\/+$/, "");
  httpUrl("ARBITER_URL", arbiterUrl);
  const rpcUrl = env.RPC_URL || DEFAULT_RPC;
  return {
    preflight,
    pin,
    funderAccount,
    funder: funderAccount?.address ?? funderAddress,
    gasOverride,
    arbiterUrl,
    rpcUrl,
    // Solo el host: en la ruta de la URL del RPC suele ir una clave de API.
    rpcHost: httpUrl("RPC_URL", rpcUrl).host,
  };
}

function httpUrl(name, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    refuse(`${name} no es una URL válida (su valor no se muestra).`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    refuse(`${name} tiene que empezar con http:// o https://.`);
  }
  return url;
}

/** Lo que necesita la wallet que fondea con el gas a `gasPrice` (wei), según la
 *  fórmula de arriba. Exportada, como `decide`, para probarla sin correr el smoke. */
export function gasBudget(gasPrice, override) {
  const perWallet = override ?? maxBig(gasPrice * GAS_UNITS_PER_WALLET * GAS_MARGIN, GAS_FLOOR_WEI);
  const funderTxs = maxBig(gasPrice * FUNDER_TX_GAS * GAS_MARGIN, GAS_FLOOR_WEI);
  return { gasPrice, perWallet, funderTxs, total: perWallet * BigInt(SEATS) + funderTxs };
}

const budgetLine = (b, override) =>
  `${SEATS} × ${eth(b.perWallet)} por wallet${override ? " (SMOKE_GAS_PER_WALLET_WEI)" : ""}` +
  ` + ${eth(b.funderTxs)} de sus 8 transacciones, con el gas a ${formatGwei(b.gasPrice)} gwei`;

/** LA POLÍTICA GUIONADA: lleva la sala al final sin esperar plazos. Elige solo
 *  entre las acciones que el SDK da por legales para ESA vista (`legalActions`:
 *  la fase, la etapa y el estado del asiento) y devuelve null cuando no hay nada
 *  que decidir: la sala no está en juego, el asiento ya no está vivo o ya decidió
 *  en esta fase. En la charla, `ready`. Al decidir: en el Reparto el primer
 *  asiento vivo se guarda su parte y los demás aportan, así la tabla sale
 *  despareja y la conversión a USDC se prueba con montos distintos; en la Oferta
 *  nadie acepta; en el Voto cada uno vota al primer vivo que no es él; en la
 *  Cerradura todos pasan; en la Final todos reparten. `me` va en minúsculas. */
export function decide(view, me) {
  const legal = legalActions(view);
  if (legal.length === 0) return null;
  const st = view.stage;
  const alive = view.seats.filter((s) => s.status === "alive");
  let action;
  if (st.phase === "talk") action = { type: "ready" };
  else if (st.kind === "share") action = { type: alive[0]?.address === me ? "keep" : "contribute" };
  else if (st.kind === "offer") action = { type: "decline" };
  else if (st.kind === "vote") {
    const target = alive.find((s) => s.address !== me);
    if (!target) return null;
    action = { type: "vote", target: target.address };
  } else if (st.kind === "lock") action = { type: "ready" };
  else if (st.kind === "final") action = { type: "split" };
  else return null;
  return legal.includes(action.type) ? action : null;
}

/** La dirección con la que firma el árbitro publicado (GET /arbiter). Es la que
 *  tiene que figurar como `arbiter()` en el escrow: si no, cada `open` y cada
 *  `deposit` revierten con "bad seat". La clave del árbitro vive en Render, así
 *  que esta lectura es la forma de cruzarlas sin tenerla. */
async function servedArbiterAddress(arbiterUrl) {
  const r = await fetch(`${arbiterUrl}/arbiter`, {
    signal: AbortSignal.timeout(COLD_START_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`GET /arbiter ${r.status}`);
  const { address } = await r.json();
  if (!ADDRESS_RE.test(String(address))) throw new Error("GET /arbiter no devolvió una dirección");
  return getAddress(lower(address));
}

/** CHEQUEO PREVIO, de solo lectura. Corre todos los chequeos aunque falle
 *  alguno, así un solo intento muestra todo lo que falta, y devuelve lo que la
 *  corrida necesita de la cadena: el token y el árbitro que nombra el escrow. */
async function preflight(cfg, pub, arbiter) {
  console.log("\nChequeo previo (solo lectura: no se transmite nada)");
  let failures = 0;
  const check = (ok, line) => {
    console.log(`${ok ? "✔" : "✘"} ${line}`);
    if (!ok) failures++;
  };
  const why = (settled) => errMsg(settled.reason);

  // Todo lo que no depende de otra lectura va a la vez. Las dos del árbitro se
  // reintentan: corre en un host gratuito que se duerme, y despertarlo llegó a
  // tardar más que el tope de arranque en frío del SDK (COLD_START_TIMEOUT_MS,
  // 75 s). Sin reintento, un árbitro dormido contaba como caído.
  const [chainId, code, usdcAddr, arbiterAddr, allowed, info, served, gasPrice, balance] =
    await Promise.allSettled([
      pub.getChainId(),
      pub.getCode({ address: cfg.pin }),
      pub.readContract({ address: cfg.pin, abi: escrowAlephAbi, functionName: "usdc" }),
      pub.readContract({ address: cfg.pin, abi: escrowAlephAbi, functionName: "arbiter" }),
      pub.readContract({
        address: cfg.pin,
        abi: allowedStakeAbi,
        functionName: "allowedStake",
        args: [STAKE_UNITS],
      }),
      retry("GET /aleph/lobbies", () => arbiter.alephLobbiesInfo(), 3),
      retry("GET /arbiter", () => servedArbiterAddress(cfg.arbiterUrl), 3),
      pub.getGasPrice(),
      cfg.funder ? pub.getBalance({ address: cfg.funder }) : Promise.resolve(undefined),
    ]);

  if (chainId.status === "fulfilled") {
    check(
      chainId.value === CHAIN_ID,
      `red: chainId ${chainId.value} (se espera ${CHAIN_ID}, Base Sepolia)`,
    );
  } else {
    check(false, `red: el RPC no devolvió el chainId (${why(chainId)})`);
  }

  if (code.status === "fulfilled") {
    const has = !!code.value && code.value !== "0x";
    check(has, `escrow: ${has ? "hay" : "NO hay"} código en ${cfg.pin}`);
  } else {
    check(false, `escrow: no se pudo leer el código de ${cfg.pin} (${why(code)})`);
  }

  // El token tiene que tener código: simular `mint` contra una dirección vacía no
  // revierte, y el chequeo del mint pasaría sin probar nada.
  let token;
  if (usdcAddr.status === "fulfilled") {
    const addr = usdcAddr.value;
    let tokenCode;
    let codeError;
    try {
      tokenCode = await pub.getCode({ address: addr });
    } catch (e) {
      codeError = errMsg(e);
    }
    const has = lower(addr) !== ZERO && !!tokenCode && tokenCode !== "0x";
    if (has) token = addr;
    const note = has
      ? "(con código)"
      : codeError
        ? `(no se pudo leer su código: ${codeError})`
        : "(sin código: ahí no hay un token)";
    check(has, `escrow.usdc() = ${addr} ${note}`);
  } else {
    check(false, `escrow.usdc(): no se pudo leer (${why(usdcAddr)})`);
  }

  let arbiterOnchain;
  if (arbiterAddr.status === "rejected") {
    check(false, `escrow.arbiter(): no se pudo leer (${why(arbiterAddr)})`);
  } else {
    arbiterOnchain = arbiterAddr.value;
    if (served.status === "rejected") {
      check(
        false,
        `escrow.arbiter() = ${arbiterOnchain}, sin poder cruzarla con GET /arbiter (${why(served)})`,
      );
    } else {
      const same = lower(arbiterOnchain) === lower(served.value);
      check(
        same,
        same
          ? `escrow.arbiter() = ${arbiterOnchain}, la dirección con la que firma el árbitro (GET /arbiter)`
          : `escrow.arbiter() = ${arbiterOnchain}, pero el árbitro firma con ${served.value} ` +
              `(GET /arbiter): cada open y cada deposit revertirían con "bad seat"`,
      );
    }
  }

  if (allowed.status === "fulfilled") {
    check(allowed.value === true, `escrow.allowedStake(${STAKE_UNITS}) = ${allowed.value}`);
  } else {
    check(false, `escrow.allowedStake(${STAKE_UNITS}): no se pudo leer (${why(allowed)})`);
  }

  if (info.status === "fulfilled") {
    const { stakes } = info.value;
    const listed = stakes.includes(STAKE_USDC);
    check(
      listed,
      `el árbitro responde y ${listed ? "lista" : "NO lista"} ${STAKE_USDC} en stakes ` +
        `(stakes=[${stakes.join(", ")}])`,
    );
  } else {
    check(false, `el árbitro no respondió GET /aleph/lobbies (${why(info)})`);
  }

  if (!cfg.funder) {
    check(false, "saldo de la wallet que fondea: falta FUNDER_KEY o SMOKE_FUNDER_ADDRESS");
  } else if (gasPrice.status === "rejected") {
    check(false, `saldo de ${cfg.funder}: no se pudo leer el precio de gas (${why(gasPrice)})`);
  } else if (balance.status === "rejected") {
    check(false, `saldo de ${cfg.funder}: no se pudo leer (${why(balance)})`);
  } else {
    const b = gasBudget(gasPrice.value, cfg.gasOverride);
    const enough = balance.value >= b.total;
    check(
      enough,
      `saldo de ${cfg.funder}: ${eth(balance.value)}; ` +
        (enough
          ? `alcanza para ${eth(b.total)}`
          : `hacen falta ${eth(b.total)}, faltan ${eth(b.total - balance.value)}`) +
        ` (${budgetLine(b, cfg.gasOverride)})`,
    );
  }

  if (!cfg.funder) {
    check(false, "mint del USDC de prueba: falta la wallet que fondea");
  } else if (!token) {
    check(
      false,
      "mint del USDC de prueba: sin un escrow.usdc() con código no hay token que probar",
    );
  } else {
    try {
      await pub.simulateContract({
        address: token,
        abi: erc20MinimalAbi,
        functionName: "mint",
        args: [cfg.funder, STAKE_UNITS],
        account: cfg.funder,
      });
      check(
        true,
        `mint del USDC de prueba simulable desde ${cfg.funder} (eth_call, sin transmitir)`,
      );
    } catch (e) {
      check(false, `mint del USDC de prueba NO simulable desde ${cfg.funder}: ${errMsg(e)}`);
    }
  }

  console.log(
    failures === 0 ? "\nChequeo previo: todo en verde." : `\nChequeo previo: ${failures} en rojo.`,
  );
  return { ok: failures === 0, usdc: token, arbiter: arbiterOnchain };
}

/** Antes de mandar una sola transacción, el bloque `deposit` de la vista privada
 *  de CADA asiento se cruza con lo que eligió el smoke (el pin, la red, el stake
 *  y sus 4 wallets) y con la cadena (el token que nombra el escrow), y el pase
 *  tiene que recuperar a `arbiter()` con el mismo digest que verifica el
 *  contrato. El SDK repite el pin y el stake al depositar, pero para entonces el
 *  fondeo ya gastó gas y USDC en las cuatro wallets. */
async function checkPasses(pub, cfg, pre, agents) {
  const ours = agents
    .map((a) => lower(a.address))
    .sort()
    .join();
  let first;
  for (const a of agents) {
    const view = await retry(`leer el pase de ${a.address}`, () => a.alephView(currentRoom));
    const d = view.deposit;
    if (view.status !== "funding" || !d) {
      fail(`${a.address} no recibió su pase de depósito (la sala está en ${view.status})`);
    }
    if (lower(d.escrow) !== lower(cfg.pin)) {
      fail(
        `el árbitro manda a depositar en ${d.escrow}, pero el pin es ${cfg.pin}: no se deposita`,
      );
    }
    if (d.chainId !== CHAIN_ID) {
      fail(`el pase es para la red ${d.chainId}, no para ${CHAIN_ID} (Base Sepolia)`);
    }
    if (BigInt(d.stake) !== STAKE_UNITS) {
      fail(`el pase pide ${d.stake} micro-USDC y la mesa del smoke es de ${STAKE_UNITS}`);
    }
    if (lower(d.usdc) !== lower(pre.usdc)) {
      fail(`el pase nombra el token ${d.usdc}, pero escrow.usdc() es ${pre.usdc}`);
    }
    const seats = d.seats.map(lower);
    if ([...seats].sort().join() !== ours) {
      fail(
        `la sala congeló ${seats.length} asientos y no son exactamente las ${SEATS} wallets ` +
          `del smoke: ${d.seats.join(", ")}`,
      );
    }
    // El digest EIP-712 que verifican `open` y `deposit` (`seatDigest` es su
    // vista pública), con el hash de la lista en el ORDEN del árbitro, que es la
    // que se va a presentar.
    const digest = await retry("leer seatDigest del escrow", () =>
      pub.readContract({
        address: cfg.pin,
        abi: escrowAlephAbi,
        functionName: "seatDigest",
        args: [
          currentRoom,
          keccak256(encodeAbiParameters([{ type: "address[]" }], [seats])),
          BigInt(d.stake),
          BigInt(d.fundDeadline),
          BigInt(d.playDeadline),
          a.address,
        ],
      }),
    );
    const signer = await recoverAddress({ hash: digest, signature: d.seatSig });
    if (lower(signer) !== lower(pre.arbiter)) {
      fail(
        `el pase de ${a.address} lo firmó ${signer}, pero el escrow solo acepta a ${pre.arbiter}: ` +
          `open y deposit revertirían con "bad seat"`,
      );
    }
    first ??= d;
  }
  const left = first.fundDeadline * 1000 - Date.now();
  if (left < MIN_FUNDING_LEFT_MS) {
    fail(
      `quedan ${Math.max(0, Math.floor(left / 1000))} s de fondeo, menos de ` +
        `${MIN_FUNDING_LEFT_MS / 60_000} min: no se gasta`,
    );
  }
  console.log(
    `✔ los ${SEATS} pases apuntan al pin, a Base Sepolia y a ${usdc(STAKE_UNITS)} de ${pre.usdc}, ` +
      `con la lista de las ${SEATS} wallets, y los firmó escrow.arbiter()`,
  );
  return first;
}

async function expectSuccess(pub, hash, label) {
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
  // Un revert MINADO no lanza: viem devuelve el recibo con status "reverted".
  if (receipt.status !== "success") fail(`${label} revirtió on-chain (${hash})`);
  return receipt;
}

/** Gas y USDC de prueba para las 4 wallets. El saldo se vuelve a comprobar con
 *  el precio de gas de ESTE momento: el chequeo previo corrió antes del lobby,
 *  hasta 10 minutos atrás. El nonce se lleva a mano: el RPC público reparte entre
 *  nodos, y uno que va un bloque atrás devolvería un nonce ya usado justo después
 *  de un recibo. */
async function fundWallets(pub, funder, cfg, pre, agents) {
  const [gasPrice, balance] = await Promise.all([
    retry("leer el precio de gas", () => pub.getGasPrice()),
    retry("leer el saldo de la wallet que fondea", () => pub.getBalance({ address: cfg.funder })),
  ]);
  const b = gasBudget(gasPrice, cfg.gasOverride);
  if (balance < b.total) {
    fail(
      `la wallet que fondea (${cfg.funder}) tiene ${eth(balance)} y hacen falta ${eth(b.total)}: ` +
        `faltan ${eth(b.total - balance)} (${budgetLine(b, cfg.gasOverride)})`,
    );
  }
  console.log(`\nFondeo desde ${cfg.funder}: ${budgetLine(b, cfg.gasOverride)}`);
  let nonce = await retry("leer el nonce de la wallet que fondea", () =>
    pub.getTransactionCount({ address: cfg.funder, blockTag: "pending" }),
  );
  for (const a of agents) {
    const gasTx = await funder.sendTransaction({
      to: a.address,
      value: b.perWallet,
      nonce: nonce++,
    });
    await expectSuccess(pub, gasTx, `el envío de gas a ${a.address}`);
    const { request } = await retry("simular el mint", () =>
      pub.simulateContract({
        address: pre.usdc,
        abi: erc20MinimalAbi,
        functionName: "mint",
        args: [a.address, STAKE_UNITS],
        account: cfg.funderAccount,
      }),
    );
    const mintTx = await funder.writeContract({ ...request, nonce: nonce++ });
    await expectSuccess(pub, mintTx, `el mint a ${a.address}`);
    console.log(
      `  ✔ ${a.address}: ${eth(b.perWallet)} (${gasTx}) y ${usdc(STAKE_UNITS)} (${mintTx})`,
    );
  }
}

/** Juega con `decide` mientras la sala esté en juego. Cada asiento decide sobre
 *  SU vista privada y firma la acción atada a la etapa y la fase de esa vista. */
async function play(arbiter, agents, view) {
  let v = view;
  const limit = Date.now() + PLAY_CAP_MS;
  let seen = "";
  let rejected = 0;
  while (v.status === "playing") {
    const where = `etapa ${v.stage.index} · ${v.stage.kind}/${v.stage.phase}`;
    if (Date.now() > limit) fail(`la partida no terminó en ${PLAY_CAP_MS / 60_000} min (${where})`);
    if (where !== seen) {
      console.log(`  ${where} · vivos: ${v.seats.filter((s) => s.status === "alive").length}`);
      seen = where;
    }
    for (const a of agents) {
      const mine = await retry("leer una vista privada", () => a.alephView(currentRoom));
      const action = decide(mine, lower(a.address));
      if (!action) continue;
      try {
        await paced(() =>
          a.alephAct(currentRoom, action, { stage: mine.stage.index, phase: mine.stage.phase }),
        );
        rejected = 0;
      } catch (e) {
        console.log(`  ⚠ ${a.address} ${action.type}: ${errMsg(e)}`);
        if (rateLimited(e)) {
          await sleep(RATE_WINDOW_MS);
          continue;
        }
        // Lo esperable es una carrera: la fase cerró por plazo entre leer y
        // actuar ("stage or phase mismatch"), o la acción anterior entró y se
        // perdió la respuesta ("already decided"). No se reintenta a ciegas: la
        // vuelta siguiente decide sobre una vista nueva.
        if (++rejected >= 8)
          fail(`el árbitro rechazó 8 acciones seguidas; la última: ${errMsg(e)}`);
      }
    }
    await sleep(3_000);
    v = await retry("leer la sala", () => arbiter.alephView(currentRoom));
  }
  return v;
}

/** La liquidación on-chain: espera `settleTx` o `settleOutcome` hasta
 *  SETTLE_CAP_MS y dice cuál llegó. Devuelve el bloque desde el que leer los
 *  saldos cuando hay transacción propia del árbitro. */
async function awaitSettle(pub, arbiter, view) {
  let v = view;
  const limit = Date.now() + SETTLE_CAP_MS;
  while (!v.settleTx && !v.settleOutcome) {
    if (Date.now() > limit) {
      fail(
        v.payoutSig
          ? `el árbitro no mandó settle en ${SETTLE_CAP_MS / 60_000} min. La tabla firmada está ` +
              `publicada (payoutSig y payoutDeadline en la vista; usdc.table, usdc.signature y ` +
              `usdc.deadline en GET /aleph/<id>/log) y cualquiera puede presentarla antes de que ` +
              `venza: settle(id, seats, amounts, deadline, signature) en el EscrowAleph.`
          : `el árbitro no mandó settle en ${SETTLE_CAP_MS / 60_000} min y todavía no publicó la ` +
              `tabla firmada (no hay payoutSig): mirá los logs del árbitro.`,
      );
    }
    await sleep(5_000);
    v = await retry("leer la sala", () => arbiter.alephView(currentRoom));
  }
  if (v.settleTx) {
    const receipt = await pub.waitForTransactionReceipt({
      hash: v.settleTx,
      timeout: RECEIPT_TIMEOUT_MS,
    });
    if (receipt.status !== "success")
      fail(`el settle del árbitro revirtió on-chain (${v.settleTx})`);
    console.log(`✔ settle del árbitro: ${v.settleTx} (bloque ${receipt.blockNumber})`);
    return { view: v, blockNumber: receipt.blockNumber };
  }
  if (v.settleOutcome === "refunded") {
    fail("la sala se REEMBOLSÓ en vez de pagarse (settleOutcome=refunded): la tabla no se pagó");
  }
  if (v.settleOutcome !== "external") fail(`settleOutcome desconocido: ${v.settleOutcome}`);
  console.log(
    "✔ settle sin hash propio (settleOutcome=external): la tabla la presentó otra transacción con la misma firma",
  );
  return { view: v, blockNumber: undefined };
}

/** Lo que pagó el contrato contra la tabla recalculada acá: la tabla en unidades
 *  convertida con la comisión que se lee del ESCROW, no la que informa el
 *  árbitro. Con transacción propia se lee en su bloque: un nodo del RPC público
 *  que va atrás todavía no vería el pago. */
async function verifyPayouts(pub, cfg, pre, v, seats, blockNumber) {
  const at = blockNumber === undefined ? {} : { blockNumber };
  let ok = true;
  const check = (good, line) => {
    ok &&= good;
    console.log(`${good ? "✔" : "✘"} ${line}`);
  };
  const [room, feeBps] = await Promise.all([
    retry("leer la sala en el escrow", () =>
      pub.readContract({
        address: cfg.pin,
        abi: escrowAlephAbi,
        functionName: "roomOf",
        args: [currentRoom],
        ...at,
      }),
    ),
    retry("leer la comisión del escrow", () =>
      pub.readContract({ address: cfg.pin, abi: escrowAlephAbi, functionName: "feeBps", ...at }),
    ),
  ]);
  const status = Number(room[5]);
  check(
    status === ALEPH_ESCROW_STATUS.Settled,
    `EscrowAleph: la sala está ${ESCROW_STATUS_NAME[status] ?? status} (se espera Settled)`,
  );
  const t = usdcPayoutTable(seats, v.payouts, STAKE_UNITS, Number(feeBps));
  check(
    seats.every((a, i) => v.payoutsUsdc?.[a] === t.amounts[i].toString()),
    `la tabla que firmó el árbitro es la conversión de la tabla en unidades ` +
      `(comisión de ${feeBps} bps leída del escrow, polvo ${t.dust})`,
  );
  for (let i = 0; i < seats.length; i++) {
    const balance = await retry("leer un saldo de USDC", () =>
      pub.readContract({
        address: pre.usdc,
        abi: erc20MinimalAbi,
        functionName: "balanceOf",
        args: [seats[i]],
        ...at,
      }),
    );
    check(
      balance === t.amounts[i],
      `${seats[i]} cobró ${usdc(balance)} (esperado ${usdc(t.amounts[i])})`,
    );
  }
  return ok;
}

/** La corrida que gasta: sentarse, esperar el lobby, cruzar los pases, fondear,
 *  depositar, jugar, esperar la liquidación y comprobar los saldos. */
async function run(cfg, pub, arbiter, pre) {
  const funder = createWalletClient({
    account: cfg.funderAccount,
    chain: baseSepolia,
    transport: http(cfg.rpcUrl),
  });
  // Cada agente lleva el pin: sin `escrow`, el SDK se niega a sentarse en una
  // mesa de plata y a depositar.
  const agents = Array.from({ length: SEATS }, () =>
    createAgent({
      arbiterUrl: cfg.arbiterUrl,
      privateKey: generatePrivateKey(),
      rpcUrl: cfg.rpcUrl,
      escrow: cfg.pin,
    }),
  );
  console.log("\nWallets efímeras (sus claves no salen de este proceso):");
  for (const a of agents) console.log(`  ${a.address}`);

  // 1) Sentarse. La sala tiene que quedar SOLO con estas 4 wallets: un asiento
  //    ajeno no deposita por el smoke (la sala se disolvería en el fondeo) y su
  //    saldo de USDC no se puede predecir.
  const { lobbies } = await retry("leer los lobbies", () => arbiter.alephLobbiesInfo());
  const busy = lobbies.find((l) => l.stake === STAKE_USDC && l.status === "lobby" && l.seats > 0);
  if (busy) {
    fail(
      `ya hay un lobby de la mesa de ${STAKE_USDC} con ${busy.seats} asiento(s) ajeno(s) ` +
        `(sala ${busy.roomId}, cierra a las ${clock(busy.closesAt)}): esperá a que cierre y ` +
        `volvé a correr el smoke.`,
    );
  }
  console.log(`\nSentando las ${SEATS} wallets en la mesa de ${STAKE_USDC} USDC…`);
  const joined = [];
  for (const a of agents) {
    joined.push(await retry(`sentar a ${a.address}`, () => paced(() => a.alephJoin(STAKE_USDC))));
    currentRoom ??= joined[0].roomId;
  }
  const ids = [...new Set(joined.map((j) => j.roomId))];
  if (ids.length !== 1) fail(`las ${SEATS} wallets quedaron en salas distintas: ${ids.join(", ")}`);
  console.log(`Sala ${currentRoom}\n  ${WEB}/aleph/${currentRoom}`);

  // 2) Esperar a que cierre el lobby: ALEPH_LOBBY_MS desde que se abrió.
  let v = joined[joined.length - 1];
  if (v.status === "lobby") {
    console.log(`  lobby: cierra a las ${clock(v.closesAt)}`);
    const limit = (v.closesAt ?? Date.now() + 10 * 60_000) + LOBBY_MARGIN_MS;
    while (v.status === "lobby") {
      if (Date.now() > limit)
        fail(`el lobby no cerró: tenía que cerrar a las ${clock(v.closesAt)}`);
      await sleep(10_000);
      v = await retry("leer la sala", () => arbiter.alephView(currentRoom));
      process.stdout.write(".");
    }
    process.stdout.write("\n");
  }
  if (v.status !== "funding") {
    fail(`al cerrar el lobby la sala tenía que pasar a funding, y está en ${v.status}`);
  }
  console.log(`  fondeo: vence a las ${clock(v.fundingDeadline)}`);

  // 3) Nada sale a la cadena sin cruzar antes los pases.
  const pass = await checkPasses(pub, cfg, pre, agents);

  // 4) Gas y USDC de prueba para las 4.
  await fundWallets(pub, funder, cfg, pre, agents);

  // 5) Depositar, en fila. A la vez, los cuatro leerían la sala sin abrir y
  //    podrían salir varios `open`: los que llegan tarde revierten on-chain,
  //    cobran gas y el SDK cae a `deposit` (esa carrera ya la prueba el e2e en
  //    anvil). Con reintento, porque un nodo del RPC que va atrás puede no ver
  //    todavía el mint o la sala abierta, y `alephDeposit` lee la cadena antes
  //    de mandar nada.
  console.log("\nDepósitos:");
  for (const a of agents) {
    const r = await retry(
      `el depósito de ${a.address}`,
      () => a.alephDeposit(currentRoom),
      3,
      6_000,
    );
    console.log(`  ✔ ${a.address}: ${r.step}${r.txHash ? ` ${r.txHash}` : ""}`);
  }

  // 6) El árbitro ve los depósitos en su tick de cadena y arranca la sala.
  const fundingLimit = (v.fundingDeadline ?? pass.fundDeadline * 1000) + FUNDING_MARGIN_MS;
  while (v.status === "funding") {
    if (Date.now() > fundingLimit) {
      fail(
        `la sala no arrancó a tiempo: el árbitro vio ${v.deposited?.length ?? 0} de ${SEATS} depósitos`,
      );
    }
    await sleep(5_000);
    v = await retry("leer la sala", () => arbiter.alephView(currentRoom));
  }
  if (v.status === "dissolved") {
    fail(
      `la sala se disolvió en el fondeo con ${v.deposited?.length ?? 0} de ${SEATS} depósitos; ` +
        `reembolso: ${v.refundTx ?? v.refundOutcome ?? "pendiente"}`,
    );
  }
  if (v.status !== "playing") {
    fail(`después del fondeo la sala tenía que pasar a playing, y está en ${v.status}`);
  }
  console.log(`\n✔ la sala arrancó · commit ${v.commit}`);

  // 7) Jugar hasta el final.
  v = await play(arbiter, agents, v);
  if (v.status !== "settled") fail(`la partida terminó en ${v.status}, no en settled`);
  console.log(`✔ liquidada en unidades: ${JSON.stringify(v.payouts)}`);

  // 8) La liquidación on-chain y lo que cobró cada asiento.
  const settled = await awaitSettle(pub, arbiter, v);
  const seats = pass.seats.map(lower);
  const ok = await verifyPayouts(pub, cfg, pre, settled.view, seats, settled.blockNumber);
  if (!ok) fail("LOS BALANCES NO CUADRAN");
  console.log("\nMESA DE PLATA VERIFICADA EN SEPOLIA ✅");
  console.log(`  ${WEB}/aleph/${currentRoom}`);
  console.log(
    `  registro: node --import tsx scripts/aleph-verify.mjs ${cfg.arbiterUrl} ${currentRoom}`,
  );
}

async function main() {
  const cfg = readConfig(process.argv.slice(2), process.env);
  // La clave ya vive en `cfg`: que no la herede nada más de este proceso.
  delete process.env.FUNDER_KEY;

  const pub = createPublicClient({ chain: baseSepolia, transport: http(cfg.rpcUrl) });
  const arbiter = new ArbiterClient(cfg.arbiterUrl);
  setTimeout(
    () => fail(`tope total de ${TOTAL_CAP_MS / 60_000} min: el smoke no terminó`),
    TOTAL_CAP_MS,
  ).unref();
  process.on("SIGINT", () => fail("interrumpido (Ctrl+C)"));

  console.log(
    `Smoke de la mesa de plata de Aleph${cfg.preflight ? " (solo el chequeo previo)" : ""}`,
  );
  console.log(`  árbitro ${cfg.arbiterUrl} · RPC ${cfg.rpcHost} · escrow (pin) ${cfg.pin}`);
  console.log(
    `  wallet que fondea: ${cfg.funder ?? "ninguna (falta FUNDER_KEY o SMOKE_FUNDER_ADDRESS)"}`,
  );

  const pre = await preflight(cfg, pub, arbiter);
  if (cfg.preflight) process.exit(pre.ok ? 0 : 1);
  if (!pre.ok) fail("el chequeo previo no pasó: no se gastó nada");
  await run(cfg, pub, arbiter, pre);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => fail(errMsg(e)));
}
