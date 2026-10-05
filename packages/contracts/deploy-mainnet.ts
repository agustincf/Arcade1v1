// Deploy de Escrow1v1 a Base MAINNET (W7 de docs/MAINNET.md; pre-auditoría
// DEP-1 a DEP-6). Lo corre `deploy-base-mainnet.sh`, que carga `.env.mainnet`:
//
//   bash packages/contracts/deploy-base-mainnet.sh              # = desplegar
//   bash packages/contracts/deploy-base-mainnet.sh chequeos     # solo los chequeos
//   bash packages/contracts/deploy-base-mainnet.sh verificar [dirección]
//   bash packages/contracts/deploy-base-mainnet.sh fuente <dirección>   # reintenta Basescan
//   bash packages/contracts/deploy-base-mainnet.sh hash         # para build-aprobada.json
//
// Antes de firmar nada (chequeos): el código compilado es EXACTAMENTE el
// aprobado (build-aprobada.json: el hash del bytecode de creación, que cubre la
// fuente, las librerías, el compilador y su configuración), el árbol está limpio
// y el commit está en main, la red es Base mainnet con el USDC real, la Safe es
// una Safe, la Ledger y la llave del árbitro no tienen código, y alcanza el gas.
// Después de firmar (verificar): relee el contrato desplegado —el código contra
// el compilado, cada parámetro, las mesas, el dominio EIP-712 y el traspaso a la
// Safe— y comprueba que la fuente quedó verificada en Basescan.
//
// Las funciones puras (preflightChecks, deploymentChecks, ...) tienen sus tests
// en test/deploy-mainnet.test.ts; el camino con cadena lo ensaya
// check-mainnet-deploy.sh en una copia de Base.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createPublicClient,
  encodeAbiParameters,
  formatEther,
  http,
  isAddress,
  keccak256,
  toHex,
  zeroAddress,
  type Hex,
} from "viem";

export const BASE_CHAIN_ID = 8453;
/** El USDC de Circle en Base. */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** La comisión (15%) y las mesas: las de script/DeployMainnet.s.sol y las que
 *  muestra la web. test/deploy-mainnet.test.ts ata las tres. */
export const FEE_BPS = 1500;
export const STAKES_USDC = [1, 2, 5, 10];
/** El dominio con el que firma el árbitro (apps/server/src/sign.ts). */
const EIP712_NAME = "Arcade1v1Escrow";
const EIP712_VERSION = "2";

export type Status = "ok" | "fail" | "pending" | "skipped";
export interface Check {
  id: string;
  status: Status;
  msg: string;
}

/** La build que se puede desplegar (build-aprobada.json). */
export interface ApprovedBuild {
  commit: string;
  creationCodeHash: string;
  forge: string;
  basis: string;
}

export interface PreflightFacts {
  env: Record<string, string | undefined>;
  forgeVersion: string | null;
  /** `headInMain` null: no se pudo traer origin/main. */
  git: { dirty: string[]; headInMain: boolean | null };
  build: { creationCodeHash: string } | { error: string };
  approved: ApprovedBuild | null;
  /** null: el nodo no contestó (o faltan direcciones para preguntar). */
  chainId: number | null;
  usdcHasCode: boolean | null;
  safe: { hasCode: boolean; threshold: number | null; owners: string[] } | null;
  accounts: { deployerHasCode: boolean; arbiterHasCode: boolean } | null;
  balance: { wei: bigint; requiredWei: bigint } | null;
}

const same = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
const ok = (id: string, msg: string): Check => ({ id, status: "ok", msg });
const fail = (id: string, msg: string): Check => ({ id, status: "fail", msg });
const skipped = (id: string, msg: string): Check => ({ id, status: "skipped", msg });

/** Las cuatro direcciones que pide el deploy. */
const ADDRESS_VARS = ["DEPLOYER_ADDRESS", "ARBITER_ADDRESS", "PLATFORM_WALLET", "SAFE_ADDRESS"];

function envProblems(env: Record<string, string | undefined>): string[] {
  const p: string[] = [];
  for (const v of ADDRESS_VARS) {
    const val = env[v];
    if (!val) p.push(`falta ${v}`);
    else if (!isAddress(val, { strict: false })) p.push(`${v} no es una dirección ("${val}")`);
  }
  const { DEPLOYER_ADDRESS: dep, ARBITER_ADDRESS: arb, PLATFORM_WALLET: plat } = env;
  // El árbitro firma desde un servidor: su llave no puede ser la Ledger, ni la
  // Safe, ni la que junta la comisión.
  if (same(arb, dep)) p.push("ARBITER_ADDRESS es la Ledger que despliega");
  if (same(arb, env.SAFE_ADDRESS)) p.push("ARBITER_ADDRESS es la Safe");
  if (same(arb, plat)) p.push("ARBITER_ADDRESS es la wallet de la comisión");
  // Variables de la versión anterior del deploy: el script ya no las lee, y un
  // valor distinto del fijo pasaría sin que nadie se entere.
  if (env.OWNER_ADDRESS) {
    p.push(
      "OWNER_ADDRESS ya no se usa: la Ledger que firma va en DEPLOYER_ADDRESS y la dueña final es SAFE_ADDRESS",
    );
  }
  if (env.USDC_ADDRESS && !same(env.USDC_ADDRESS, USDC_BASE)) {
    p.push(
      `USDC_ADDRESS=${env.USDC_ADDRESS}, pero el deploy usa siempre el USDC real (${USDC_BASE})`,
    );
  }
  if (env.FEE_BPS && Number(env.FEE_BPS) !== FEE_BPS) {
    p.push(
      `FEE_BPS=${env.FEE_BPS}, pero la comisión está fija en ${FEE_BPS} (la que muestra la web)`,
    );
  }
  return p;
}

/** Los chequeos de antes de firmar. Cualquier "fail" frena el deploy. */
export function preflightChecks(f: PreflightFacts): Check[] {
  const checks: Check[] = [];
  const envP = envProblems(f.env);
  checks.push(
    envP.length ? fail("env", envP.join("; ")) : ok("env", "variables completas y bien formadas"),
  );
  checks.push(
    f.env.ETHERSCAN_API_KEY
      ? ok("basescan", "hay clave para verificar la fuente (ETHERSCAN_API_KEY)")
      : fail("basescan", "falta ETHERSCAN_API_KEY: sin ella la fuente no se verifica en Basescan"),
  );

  if (f.git.dirty.length) {
    const list = f.git.dirty.slice(0, 5).join(", ") + (f.git.dirty.length > 5 ? ", …" : "");
    checks.push(fail("git", `hay cambios sin commitear en packages/contracts: ${list}`));
  } else if (f.git.headInMain === null) {
    checks.push(fail("git", "no se pudo traer origin/main para comparar (git fetch)"));
  } else if (!f.git.headInMain) {
    checks.push(
      fail("git", "este commit no está en origin/main: se despliega solo lo que entró a main"),
    );
  } else {
    checks.push(ok("git", "árbol limpio y commit en main"));
  }

  if (!f.approved) {
    checks.push(
      fail(
        "build",
        "no hay build aprobada: packages/contracts/build-aprobada.json se completa cuando se cierra la auditoría",
      ),
    );
  } else if ("error" in f.build) {
    checks.push(fail("build", `no compiló: ${f.build.error}`));
  } else if (!same(f.build.creationCodeHash, f.approved.creationCodeHash)) {
    const why =
      f.forgeVersion !== f.approved.forge
        ? `compilaste con forge ${f.forgeVersion ?? "?"} y la aprobada se compiló con ${f.approved.forge}: ` +
          `instalá esa versión (foundryup --install v${f.approved.forge}) y probá de nuevo`
        : "¿cambió src/, lib/ o foundry.toml?";
    checks.push(
      fail(
        "build",
        `el código compilado no es el aprobado (${f.build.creationCodeHash} ≠ ${f.approved.creationCodeHash}): ${why}`,
      ),
    );
  } else {
    checks.push(
      ok("build", `el código es el aprobado (commit ${f.approved.commit}; ${f.approved.basis})`),
    );
  }

  if (f.chainId === null) {
    checks.push(fail("red", "no se pudo leer la red (BASE_MAINNET_RPC_URL)"));
  } else if (f.chainId !== BASE_CHAIN_ID) {
    checks.push(
      fail("red", `el nodo está en la red ${f.chainId}, no en Base mainnet (${BASE_CHAIN_ID})`),
    );
  } else {
    checks.push(ok("red", `Base mainnet (${BASE_CHAIN_ID})`));
  }

  if (f.usdcHasCode === null) checks.push(skipped("usdc", "sin red"));
  else if (!f.usdcHasCode) checks.push(fail("usdc", `no hay contrato en ${USDC_BASE}`));
  else checks.push(ok("usdc", `el USDC de Circle (${USDC_BASE})`));

  if (!f.safe) {
    checks.push(skipped("safe", "sin red o sin SAFE_ADDRESS"));
  } else if (!f.safe.hasCode) {
    checks.push(
      fail("safe", "SAFE_ADDRESS no es un contrato: tiene que ser la dirección de la Safe"),
    );
  } else if (f.safe.threshold === null || f.safe.threshold < 1) {
    checks.push(fail("safe", "SAFE_ADDRESS no contesta como una Safe (getThreshold)"));
  } else {
    const single =
      f.safe.threshold === 1 ? " (con una sola firma no protege más que una Ledger)" : "";
    checks.push(
      ok(
        "safe",
        `Safe que pide ${f.safe.threshold} de ${f.safe.owners.length} firmas${single}: ${f.safe.owners.join(", ")}`,
      ),
    );
  }

  if (!f.accounts) {
    checks.push(skipped("cuentas", "sin red o sin direcciones"));
  } else {
    const p: string[] = [];
    // Una cuenta con código (una delegación EIP-7702) la puede mover un
    // contrato además de su llave: la Ledger queda de dueña hasta que la Safe
    // acepte, y el árbitro firma los pagos.
    if (f.accounts.deployerHasCode)
      p.push("DEPLOYER_ADDRESS tiene código (¿una delegación EIP-7702?)");
    if (f.accounts.arbiterHasCode)
      p.push("ARBITER_ADDRESS tiene código: tiene que ser una llave común");
    checks.push(
      p.length
        ? fail("cuentas", p.join("; "))
        : ok("cuentas", "la Ledger y el árbitro son cuentas comunes"),
    );
  }

  if (!f.balance) {
    checks.push(skipped("saldo", "sin red o sin DEPLOYER_ADDRESS"));
  } else if (f.balance.wei < f.balance.requiredWei) {
    checks.push(
      fail(
        "saldo",
        `la Ledger tiene ${formatEther(f.balance.wei)} ETH y el deploy pide al menos ${formatEther(f.balance.requiredWei)}`,
      ),
    );
  } else {
    checks.push(ok("saldo", `${formatEther(f.balance.wei)} ETH en la Ledger (alcanza)`));
  }
  return checks;
}

/** Saldo pedido para el gas: tres veces lo que costarían 4 M de gas (el deploy
 *  y las seis transacciones gastan menos), con un piso de 0,003 ETH por la
 *  parte de la tarifa que Base paga en L1. */
export function requiredBalanceWei(gasPriceWei: bigint): bigint {
  const floor = 3n * 10n ** 15n;
  const estimate = gasPriceWei * 4_000_000n * 3n;
  return estimate > floor ? estimate : floor;
}

export interface DeployExpect {
  escrow: string;
  arbiter: string;
  platform: string;
  safe: string;
  deployer: string;
}

export interface DeployFacts {
  chainId: number;
  code: { matches: boolean; detail?: string };
  reads:
    | {
        usdc: string;
        arbiter: string;
        platformWallet: string;
        feeBps: number;
        /** De STAKES_USDC, las que el contrato permite. */
        allowedStakes: number[];
        owner: string;
        pendingOwner: string;
        domain: { name: string; version: string; chainId: number; verifyingContract: string };
      }
    | { error: string };
  /** null: sin ETHERSCAN_API_KEY no se preguntó. */
  basescan: { verified: boolean; compiler: string } | { error: string } | null;
  /** ¿El compilado contra el que se comparó es la build aprobada? null: todavía
   *  no hay build aprobada. */
  buildApproved: boolean | null;
}

/** La relectura del contrato desplegado. */
export function deploymentChecks(e: DeployExpect, f: DeployFacts): Check[] {
  const checks: Check[] = [];
  checks.push(
    f.chainId === BASE_CHAIN_ID
      ? ok("red", `Base mainnet (${BASE_CHAIN_ID})`)
      : fail("red", `la red es ${f.chainId}, no Base mainnet`),
  );
  checks.push(
    f.code.matches
      ? ok("codigo", "el código desplegado es el compilado (salvo los inmutables, releídos abajo)")
      : fail(
          "codigo",
          `el código desplegado NO es el compilado${f.code.detail ? `: ${f.code.detail}` : ""}`,
        ),
  );

  if (f.buildApproved === null) {
    checks.push(
      skipped("build", "todavía no hay build aprobada para comparar (build-aprobada.json)"),
    );
  } else if (f.buildApproved) {
    checks.push(ok("build", "y el compilado es la build aprobada (build-aprobada.json)"));
  } else {
    checks.push(
      fail(
        "build",
        "el compilado contra el que se comparó NO es la build aprobada (build-aprobada.json)",
      ),
    );
  }
  if ("error" in f.reads) {
    checks.push(fail("lecturas", `no se pudo leer el contrato: ${f.reads.error}`));
  } else {
    const r = f.reads;
    const eq = (id: string, label: string, got: string, want: string) =>
      checks.push(
        same(got, want)
          ? ok(id, `${label}: ${want}`)
          : fail(id, `${label} es ${got}, se esperaba ${want}`),
      );
    eq("usdc", "USDC", r.usdc, USDC_BASE);
    eq("arbitro", "árbitro", r.arbiter, e.arbiter);
    eq("plataforma", "wallet de la comisión", r.platformWallet, e.platform);
    checks.push(
      r.feeBps === FEE_BPS
        ? ok("comision", `comisión ${FEE_BPS} bps (15%)`)
        : fail("comision", `comisión ${r.feeBps} bps, se esperaba ${FEE_BPS}`),
    );
    const stakesOk =
      r.allowedStakes.length === STAKES_USDC.length &&
      STAKES_USDC.every((s) => r.allowedStakes.includes(s));
    checks.push(
      stakesOk
        ? ok("mesas", `mesas habilitadas: ${STAKES_USDC.join(", ")} USDC`)
        : fail(
            "mesas",
            `mesas habilitadas: ${r.allowedStakes.join(", ") || "ninguna"}; se esperaban ${STAKES_USDC.join(", ")}`,
          ),
    );
    const d = r.domain;
    checks.push(
      d.name === EIP712_NAME &&
        d.version === EIP712_VERSION &&
        d.chainId === BASE_CHAIN_ID &&
        same(d.verifyingContract, e.escrow)
        ? ok(
            "dominio",
            `dominio EIP-712 ("${d.name}", "${d.version}", ${d.chainId}): el que firma el árbitro`,
          )
        : fail(
            "dominio",
            `dominio EIP-712 ("${d.name}", "${d.version}", ${d.chainId}, ${d.verifyingContract}) no es el del árbitro`,
          ),
    );
    if (same(r.owner, e.safe) && same(r.pendingOwner, zeroAddress)) {
      checks.push(ok("duenio", `la dueña es la Safe (${e.safe})`));
    } else if (same(r.owner, e.deployer) && same(r.pendingOwner, e.safe)) {
      checks.push({
        id: "duenio",
        status: "pending",
        msg: `falta que la Safe acepte: la dueña sigue siendo la Ledger hasta que la Safe firme acceptOwnership() en ${e.escrow}`,
      });
    } else {
      checks.push(
        fail(
          "duenio",
          `dueña ${r.owner}, pendiente ${r.pendingOwner}: no es el traspaso a la Safe (${e.safe})`,
        ),
      );
    }
  }

  if (f.basescan === null) {
    checks.push(skipped("basescan", "sin ETHERSCAN_API_KEY no se comprobó"));
  } else if ("error" in f.basescan) {
    checks.push(skipped("basescan", `no se pudo consultar Basescan: ${f.basescan.error}`));
  } else if (f.basescan.verified) {
    checks.push(ok("basescan", `fuente verificada en Basescan (${f.basescan.compiler})`));
  } else {
    checks.push(
      fail(
        "basescan",
        "la fuente no está verificada en Basescan: reintentalo con `deploy-base-mainnet.sh fuente <dirección>`",
      ),
    );
  }
  return checks;
}

type ImmutableRefs = Record<string, { start: number; length: number }[]>;

/** ¿El código desplegado es el compilado? Los inmutables (el USDC, el dominio
 *  EIP-712 en caché) los escribe el constructor: se comparan aparte, releídos. */
export function runtimeCodeMatches(
  onchain: string,
  compiled: string,
  refs: ImmutableRefs,
): boolean {
  const a = onchain.toLowerCase().replace(/^0x/, "");
  const b = compiled.toLowerCase().replace(/^0x/, "");
  if (!a || a.length !== b.length) return false;
  const mask = (s: string) => {
    const chars = s.split("");
    for (const list of Object.values(refs)) {
      for (const { start, length } of list) {
        for (let i = start * 2; i < (start + length) * 2; i++) chars[i] = "0";
      }
    }
    return chars.join("");
  };
  return mask(a) === mask(b);
}

/** La dirección del Escrow1v1 en el registro de `forge script --broadcast`. */
export function escrowFromBroadcast(run: unknown): string | null {
  const txs = (run as { transactions?: unknown[] })?.transactions ?? [];
  for (const tx of txs as {
    transactionType?: string;
    contractName?: string;
    contractAddress?: string;
  }[]) {
    if (tx.transactionType === "CREATE" && tx.contractName === "Escrow1v1" && tx.contractAddress) {
      return tx.contractAddress;
    }
  }
  return null;
}

/** La respuesta de `getsourcecode` de la API de Etherscan v2 (Basescan). */
export function basescanStatus(resp: unknown): { verified: boolean; compiler: string } {
  const r = (resp as { result?: { SourceCode?: string; CompilerVersion?: string }[] })?.result?.[0];
  return { verified: !!r?.SourceCode, compiler: r?.CompilerVersion ?? "" };
}

// ---- Lo que habla con git, forge y la cadena ----------------------------------

const DIR = dirname(fileURLToPath(import.meta.url));
const ARTIFACT = join(DIR, "out/Escrow1v1.sol/Escrow1v1.json");
const APPROVED_FILE = join(DIR, "build-aprobada.json");
const TOOL_ENV = { ...process.env, PATH: `${homedir()}/.foundry/bin:${process.env.PATH ?? ""}` };

const rpcUrl = () => process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org";
const client = () => createPublicClient({ transport: http(rpcUrl()) });

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, {
    cwd: DIR,
    env: TOOL_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function forgeVersion(): string | null {
  try {
    return /(\d+\.\d+\.\d+)/.exec(run("forge", ["--version"]))?.[1] ?? null;
  } catch {
    return null;
  }
}

interface Artifact {
  bytecode: { object: Hex };
  deployedBytecode: { object: Hex; immutableReferences?: ImmutableRefs };
  rawMetadata?: string;
  metadata?: {
    compiler: { version: string };
    settings: unknown;
    sources: Record<string, { keccak256: string }>;
  };
}

/** El código de creación sin la metadata que solc le pega al final (CBOR; sus
 *  dos últimos bytes dicen cuánto mide). Dos builds con la misma fuente pueden
 *  diferir solo ahí si cambia algo de la metadata y no el código. */
export function withoutMetadata(code: Hex): Hex {
  const hex = code.replace(/^0x/, "");
  const cborBytes = parseInt(hex.slice(-4), 16) + 2;
  return `0x${hex.slice(0, hex.length - cborBytes * 2)}`;
}

/** Compila (sin los tests) y devuelve el artefacto de Escrow1v1. */
function build(): Artifact {
  run("forge", ["build", "--skip", "test"]);
  return JSON.parse(readFileSync(ARTIFACT, "utf8")) as Artifact;
}

function gitFacts(): PreflightFacts["git"] {
  const dirty = run("git", ["status", "--porcelain", "--", "."])
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3));
  let headInMain: boolean | null;
  try {
    run("git", ["fetch", "--quiet", "origin", "main"]);
    const r = spawnSync("git", ["merge-base", "--is-ancestor", "HEAD", "origin/main"], {
      cwd: DIR,
    });
    headInMain = r.status === 0 ? true : r.status === 1 ? false : null;
  } catch {
    headInMain = null;
  }
  return { dirty, headInMain };
}

function readApproved(): ApprovedBuild | null {
  const j = JSON.parse(readFileSync(APPROVED_FILE, "utf8")) as { aprobada?: ApprovedBuild | null };
  return j.aprobada ?? null;
}

const hasCode = async (address: string) => {
  const code = await client().getCode({ address: address as Hex });
  return !!code && code !== "0x";
};

const safeAbi = [
  {
    type: "function",
    name: "getThreshold",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getOwners",
    inputs: [],
    outputs: [{ type: "address[]" }],
    stateMutability: "view",
  },
] as const;

async function chainFacts(env: Record<string, string | undefined>) {
  const c = client();
  const valid = (v: string) => !!env[v] && isAddress(env[v]!, { strict: false });
  let chainId: number | null = null;
  try {
    chainId = await c.getChainId();
  } catch {
    return { chainId, usdcHasCode: null, safe: null, accounts: null, balance: null };
  }
  const usdcHasCode = await hasCode(USDC_BASE);
  let safe: PreflightFacts["safe"] = null;
  if (valid("SAFE_ADDRESS")) {
    const address = env.SAFE_ADDRESS as Hex;
    const code = await hasCode(address);
    let threshold: number | null = null;
    let owners: string[] = [];
    if (code) {
      try {
        threshold = Number(
          await c.readContract({ address, abi: safeAbi, functionName: "getThreshold" }),
        );
        owners = [...(await c.readContract({ address, abi: safeAbi, functionName: "getOwners" }))];
      } catch {
        threshold = null;
      }
    }
    safe = { hasCode: code, threshold, owners };
  }
  const accounts =
    valid("DEPLOYER_ADDRESS") && valid("ARBITER_ADDRESS")
      ? {
          deployerHasCode: await hasCode(env.DEPLOYER_ADDRESS!),
          arbiterHasCode: await hasCode(env.ARBITER_ADDRESS!),
        }
      : null;
  const balance = valid("DEPLOYER_ADDRESS")
    ? {
        wei: await c.getBalance({ address: env.DEPLOYER_ADDRESS as Hex }),
        requiredWei: requiredBalanceWei(await c.getGasPrice()),
      }
    : null;
  return { chainId, usdcHasCode, safe, accounts, balance };
}

async function gatherPreflight(): Promise<PreflightFacts> {
  const env = process.env;
  let buildFacts: PreflightFacts["build"];
  try {
    buildFacts = { creationCodeHash: keccak256(build().bytecode.object) };
  } catch (e) {
    buildFacts = { error: (e as Error).message.split("\n")[0] };
  }
  return {
    env,
    forgeVersion: forgeVersion(),
    git: gitFacts(),
    build: buildFacts,
    approved: readApproved(),
    ...(await chainFacts(env)),
  };
}

const escrowAbi = [
  {
    type: "function",
    name: "usdc",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "arbiter",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "platformWallet",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "feeBps",
    inputs: [],
    outputs: [{ type: "uint16" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pendingOwner",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowedStake",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "eip712Domain",
    inputs: [],
    outputs: [
      { type: "bytes1" },
      { type: "string" },
      { type: "string" },
      { type: "uint256" },
      { type: "address" },
      { type: "bytes32" },
      { type: "uint256[]" },
    ],
    stateMutability: "view",
  },
] as const;

async function gatherDeployment(escrow: Hex): Promise<DeployFacts> {
  const c = client();
  const artifact = build();
  const onchain = (await c.getCode({ address: escrow })) ?? "0x";
  const code =
    onchain === "0x"
      ? { matches: false, detail: "no hay código en esa dirección" }
      : {
          matches: runtimeCodeMatches(
            onchain,
            artifact.deployedBytecode.object,
            artifact.deployedBytecode.immutableReferences ?? {},
          ),
        };
  let reads: DeployFacts["reads"];
  try {
    const read = <
      F extends "usdc" | "arbiter" | "platformWallet" | "feeBps" | "owner" | "pendingOwner",
    >(
      functionName: F,
    ) => c.readContract({ address: escrow, abi: escrowAbi, functionName });
    const allowed = await Promise.all(
      STAKES_USDC.map((s) =>
        c.readContract({
          address: escrow,
          abi: escrowAbi,
          functionName: "allowedStake",
          args: [BigInt(s * 1_000_000)],
        }),
      ),
    );
    const [, name, version, chainId, verifyingContract] = await c.readContract({
      address: escrow,
      abi: escrowAbi,
      functionName: "eip712Domain",
    });
    reads = {
      usdc: await read("usdc"),
      arbiter: await read("arbiter"),
      platformWallet: await read("platformWallet"),
      feeBps: Number(await read("feeBps")),
      allowedStakes: STAKES_USDC.filter((_, i) => allowed[i]),
      owner: await read("owner"),
      pendingOwner: await read("pendingOwner"),
      domain: { name, version, chainId: Number(chainId), verifyingContract },
    };
  } catch (e) {
    reads = { error: (e as Error).message.split("\n")[0] };
  }
  let basescan: DeployFacts["basescan"] = null;
  const key = process.env.ETHERSCAN_API_KEY;
  if (key) {
    try {
      const url =
        `https://api.etherscan.io/v2/api?chainid=${BASE_CHAIN_ID}&module=contract` +
        `&action=getsourcecode&address=${escrow}&apikey=${key}`;
      basescan = basescanStatus(await (await fetch(url)).json());
    } catch (e) {
      basescan = { error: (e as Error).message };
    }
  }
  const approved = readApproved();
  const buildApproved = approved
    ? same(keccak256(artifact.bytecode.object), approved.creationCodeHash)
    : null;
  return { chainId: await c.getChainId(), code, reads, basescan, buildApproved };
}

const ICON: Record<Status, string> = { ok: "✓", fail: "✗", pending: "⏳", skipped: "–" };
const print = (checks: Check[]) => {
  for (const c of checks) console.log(`${ICON[c.status]} [${c.id}] ${c.msg}`);
};
const anyFail = (checks: Check[]) => checks.some((c) => c.status === "fail");

/** El escrow del último `forge script --broadcast` de DeployMainnet.
 *  `notBefore` (epoch ms): si el registro es anterior, es de otro intento (forge
 *  falló antes de mandar nada) y no cuenta. */
export function lastBroadcastEscrow(notBefore?: number): string | null {
  const dir = process.env.FOUNDRY_BROADCAST || join(DIR, "broadcast");
  const file = join(dir, "DeployMainnet.s.sol", String(BASE_CHAIN_ID), "run-latest.json");
  if (!existsSync(file)) return null;
  if (notBefore !== undefined && statSync(file).mtimeMs < notBefore) return null;
  return escrowFromBroadcast(JSON.parse(readFileSync(file, "utf8")));
}

function deployExpect(escrow: string): DeployExpect {
  const missing = ["ARBITER_ADDRESS", "PLATFORM_WALLET", "SAFE_ADDRESS", "DEPLOYER_ADDRESS"].filter(
    (v) => !process.env[v],
  );
  if (missing.length)
    throw new Error(`faltan ${missing.join(", ")} (las del .env.mainnet del deploy)`);
  return {
    escrow,
    arbiter: process.env.ARBITER_ADDRESS!,
    platform: process.env.PLATFORM_WALLET!,
    safe: process.env.SAFE_ADDRESS!,
    deployer: process.env.DEPLOYER_ADDRESS!,
  };
}

async function verify(escrowArg?: string): Promise<boolean> {
  const escrow = escrowArg ?? lastBroadcastEscrow();
  if (!escrow || !isAddress(escrow, { strict: false })) {
    throw new Error("¿qué contrato? pasá la dirección: verificar <dirección>");
  }
  console.log(`Escrow1v1: ${escrow}`);
  const checks = deploymentChecks(deployExpect(escrow), await gatherDeployment(escrow as Hex));
  print(checks);
  return !anyFail(checks);
}

function constructorArgs(): Hex {
  const e = deployExpect(zeroAddress);
  return encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "uint16" },
      { type: "address" },
    ],
    [USDC_BASE, e.arbiter as Hex, e.platform as Hex, FEE_BPS, e.deployer as Hex],
  );
}

/** Verifica la fuente en Basescan (también la intenta `forge script --verify`). */
function verifySource(escrow: string): boolean {
  const r = spawnSync(
    "forge",
    [
      "verify-contract",
      escrow,
      "src/Escrow1v1.sol:Escrow1v1",
      "--chain",
      String(BASE_CHAIN_ID),
      "--etherscan-api-key",
      process.env.ETHERSCAN_API_KEY ?? "",
      "--constructor-args",
      constructorArgs(),
      "--watch",
    ],
    { cwd: DIR, env: TOOL_ENV, stdio: "inherit" },
  );
  return r.status === 0;
}

async function deploy(): Promise<boolean> {
  const facts = await gatherPreflight();
  const checks = preflightChecks(facts);
  print(checks);
  if (anyFail(checks)) {
    console.log("\n❌ No se despliega: arreglá lo marcado con ✗ y volvé a correrlo.");
    return false;
  }
  const env = process.env;
  console.log(`
⚠️  ESTÁS POR DESPLEGAR EN BASE MAINNET — ESTO MANEJA DINERO REAL.
    Firma (y dueña hasta que la Safe acepte): ${env.DEPLOYER_ADDRESS}  ← tu Ledger
    Dueña final (Safe)                       : ${env.SAFE_ADDRESS}
    Árbitro (firma resultados y asientos)    : ${env.ARBITER_ADDRESS}
    Wallet de la comisión                    : ${env.PLATFORM_WALLET}
    Comisión                                 : ${FEE_BPS} bps (15%)
    Mesas                                    : ${STAKES_USDC.join(", ")} USDC
    USDC                                     : ${USDC_BASE}
    Build                                    : commit ${facts.approved?.commit} (${facts.approved?.basis})

    La Ledger te va a pedir 6 firmas: el contrato, las 4 mesas y el traspaso a la Safe.
`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Escribí MAINNET en mayúsculas para confirmar: ");
  rl.close();
  if (answer.trim() !== "MAINNET") {
    console.log("Cancelado.");
    return false;
  }

  // Cada valor va explícito: forge además carga solo el .env de testnet de esta
  // carpeta, y una variable que faltara se tomaría de ahí.
  const started = Date.now();
  const r = spawnSync(
    "forge",
    [
      "script",
      "script/DeployMainnet.s.sol:DeployMainnet",
      "--rpc-url",
      rpcUrl(),
      "--ledger",
      "--sender",
      env.DEPLOYER_ADDRESS!,
      "--broadcast",
      "--slow",
      "--verify",
      "--etherscan-api-key",
      env.ETHERSCAN_API_KEY!,
      "-vv",
    ],
    {
      cwd: DIR,
      stdio: "inherit",
      env: {
        ...TOOL_ENV,
        ARBITER_ADDRESS: env.ARBITER_ADDRESS,
        PLATFORM_WALLET: env.PLATFORM_WALLET,
        SAFE_ADDRESS: env.SAFE_ADDRESS,
      },
    },
  );
  const escrow = lastBroadcastEscrow(started);
  if (!escrow) {
    console.log(
      `\n❌ forge terminó con código ${r.status} y no hay contrato desplegado en el registro.`,
    );
    return false;
  }
  if (r.status !== 0) {
    console.log(
      `\n⚠️  forge terminó con código ${r.status}, pero el contrato se desplegó: releyéndolo.`,
    );
  }

  console.log("\n--- Relectura del contrato desplegado ---");
  const good = await verify(escrow);
  console.log(`
Próximos pasos:
 1. En la Safe (app.safe.global, red Base): Nueva transacción → Transaction Builder
    → dirección ${escrow} → método acceptOwnership() → firmala con las firmas que pida.
 2. Volvé a correr: bash packages/contracts/deploy-base-mainnet.sh verificar ${escrow}
    (tiene que decir ✓ [duenio] la dueña es la Safe).
 3. Árbitro (Render): CHAIN_ID=${BASE_CHAIN_ID}, ESCROW_ADDRESS=${escrow}, RPC_URL=<tu nodo de Base mainnet>.
    Después: curl -s https://<árbitro>/health tiene que dar "escrow":"ok".
 4. Web (Vercel): NEXT_PUBLIC_CHAIN_ID=${BASE_CHAIN_ID}, NEXT_PUBLIC_ESCROW_ADDRESS=${escrow},
    NEXT_PUBLIC_USDC_ADDRESS=${USDC_BASE}.
 5. Anotá la dirección en docs/MAINNET.md (y en el informe de la auditoría).`);
  return good;
}

async function main(): Promise<number> {
  const [cmd = "desplegar", arg] = process.argv.slice(2);
  switch (cmd) {
    case "desplegar":
      return (await deploy()) ? 0 : 1;
    case "chequeos": {
      const checks = preflightChecks(await gatherPreflight());
      print(checks);
      return anyFail(checks) ? 1 : 0;
    }
    case "verificar":
      return (await verify(arg)) ? 0 : 1;
    case "fuente":
      if (!arg) throw new Error("fuente <dirección>");
      return verifySource(arg) ? 0 : 1;
    case "hash": {
      const artifact = build();
      const hash = keccak256(artifact.bytecode.object);
      const commit = run("git", ["rev-parse", "--short", "HEAD"]).trim();
      console.log(
        JSON.stringify({ commit, creationCodeHash: hash, forge: forgeVersion() }, null, 2),
      );
      // Para comparar dos builds que no dan el mismo hash: ¿difiere el código
      // o solo la metadata? ¿qué archivo o qué opción del compilador?
      const m = artifact.metadata;
      console.log(
        JSON.stringify(
          {
            codeWithoutMetadata: keccak256(withoutMetadata(artifact.bytecode.object)),
            metadata: artifact.rawMetadata ? keccak256(toHex(artifact.rawMetadata)) : null,
            solc: m?.compiler.version,
            settings: m?.settings,
            sources: Object.fromEntries(
              Object.entries(m?.sources ?? {}).map(([k, v]) => [k, v.keccak256]),
            ),
          },
          null,
          2,
        ),
      );
      return 0;
    }
    default:
      throw new Error(`no conozco "${cmd}": desplegar, chequeos, verificar, fuente o hash`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`❌ ${(e as Error).message}`);
      process.exit(1);
    },
  );
}
