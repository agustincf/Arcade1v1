// W7 (pre-auditoría DEP-1 a DEP-6): la lógica del deploy a mainnet, sin cadena.
// Los chequeos de antes de firmar (preflightChecks), la relectura del contrato
// desplegado (deploymentChecks), la comparación del código con el compilado y
// que las constantes del script, del verificador y de la web sean las mismas.
// Con la cadena (una copia de Base), lo ensaya check-mainnet-deploy.sh.
//
// Correr: node --import tsx --test packages/contracts/test/deploy-mainnet.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BET_AMOUNTS, PLATFORM_FEE } from "../../../apps/web/app/lib/config.js";
import {
  BASE_CHAIN_ID,
  USDC_BASE,
  FEE_BPS,
  STAKES_USDC,
  preflightChecks,
  deploymentChecks,
  runtimeCodeMatches,
  escrowFromBroadcast,
  lastBroadcastEscrow,
  basescanStatus,
  requiredBalanceWei,
  type Check,
  type PreflightFacts,
  type DeployExpect,
  type DeployFacts,
} from "../deploy-mainnet.js";

const A = (c: string) => "0x" + c.repeat(40);
const HASH = "0x" + "ab".repeat(32);

const ENV = {
  DEPLOYER_ADDRESS: A("1"),
  ARBITER_ADDRESS: A("2"),
  PLATFORM_WALLET: A("3"),
  SAFE_ADDRESS: A("5"),
  ETHERSCAN_API_KEY: "clave",
};

/** Todo en orden: lo que tiene que pasar para que el deploy se pueda firmar. */
const GOOD: PreflightFacts = {
  env: ENV,
  forgeVersion: "1.8.3",
  git: { dirty: [], headInMain: true },
  build: { creationCodeHash: HASH },
  approved: { commit: "abc1234", creationCodeHash: HASH, forge: "1.8.3", basis: "auditoría X" },
  chainId: BASE_CHAIN_ID,
  usdcHasCode: true,
  safe: { hasCode: true, threshold: 2, owners: [A("6"), A("7"), A("8")] },
  accounts: { deployerHasCode: false, arbiterHasCode: false },
  balance: { wei: 10n ** 18n, requiredWei: 10n ** 16n },
};

const failed = (checks: Check[]) => checks.filter((c) => c.status === "fail").map((c) => c.id);
const msgOf = (checks: Check[], id: string) => checks.find((c) => c.id === id)?.msg ?? "";

test("todo en orden: ningún chequeo falla", () => {
  assert.deepEqual(failed(preflightChecks(GOOD)), []);
});

test("sin build aprobada, el deploy no se puede firmar", () => {
  const c = preflightChecks({ ...GOOD, approved: null });
  assert.deepEqual(failed(c), ["build"]);
  assert.match(msgOf(c, "build"), /build-aprobada\.json/);
});

test("otro código que el aprobado: con otro forge, dice qué versión instalar", () => {
  const other = { ...GOOD, build: { creationCodeHash: "0x" + "cd".repeat(32) } };
  const sameForge = preflightChecks(other);
  assert.deepEqual(failed(sameForge), ["build"]);
  assert.match(msgOf(sameForge, "build"), /no es el aprobado/);

  const otherForge = preflightChecks({ ...other, forgeVersion: "1.9.0" });
  assert.match(msgOf(otherForge, "build"), /foundryup --install v1\.8\.3/);
});

test("árbol con cambios, o un commit que no está en main: no", () => {
  const dirty = preflightChecks({
    ...GOOD,
    git: { dirty: ["src/Escrow1v1.sol"], headInMain: true },
  });
  assert.deepEqual(failed(dirty), ["git"]);
  assert.match(msgOf(dirty, "git"), /src\/Escrow1v1\.sol/);
  assert.deepEqual(failed(preflightChecks({ ...GOOD, git: { dirty: [], headInMain: false } })), [
    "git",
  ]);
});

test("otra red, sin USDC o sin nodo: no", () => {
  assert.deepEqual(failed(preflightChecks({ ...GOOD, chainId: 84532 })), ["red"]);
  assert.deepEqual(failed(preflightChecks({ ...GOOD, usdcHasCode: false })), ["usdc"]);
  const noRpc = preflightChecks({
    ...GOOD,
    chainId: null,
    usdcHasCode: null,
    safe: null,
    accounts: null,
    balance: null,
  });
  assert.ok(failed(noRpc).includes("red"));
});

test("la Safe tiene que ser un contrato que conteste como una Safe", () => {
  const eoa = preflightChecks({ ...GOOD, safe: { hasCode: false, threshold: null, owners: [] } });
  assert.deepEqual(failed(eoa), ["safe"]);
  const notSafe = preflightChecks({
    ...GOOD,
    safe: { hasCode: true, threshold: null, owners: [] },
  });
  assert.deepEqual(failed(notSafe), ["safe"]);
  // Una Safe de una sola firma pasa, pero el chequeo lo dice.
  const single = preflightChecks({
    ...GOOD,
    safe: { hasCode: true, threshold: 1, owners: [A("6")] },
  });
  assert.deepEqual(failed(single), []);
  assert.match(msgOf(single, "safe"), /1 de 1/);
});

test("la Ledger y la llave del árbitro no pueden tener código (delegación EIP-7702)", () => {
  const c = preflightChecks({
    ...GOOD,
    accounts: { deployerHasCode: true, arbiterHasCode: false },
  });
  assert.deepEqual(failed(c), ["cuentas"]);
  assert.match(msgOf(c, "cuentas"), /DEPLOYER_ADDRESS/);
});

test("saldo que no alcanza para el gas: no", () => {
  const c = preflightChecks({ ...GOOD, balance: { wei: 1n, requiredWei: 10n ** 16n } });
  assert.deepEqual(failed(c), ["saldo"]);
});

test("variables: faltantes, mal formadas, repetidas o de la versión vieja", () => {
  const without = { ...ENV } as Record<string, string | undefined>;
  delete without.SAFE_ADDRESS;
  assert.deepEqual(failed(preflightChecks({ ...GOOD, env: without })), ["env"]);
  assert.deepEqual(failed(preflightChecks({ ...GOOD, env: { ...ENV, ARBITER_ADDRESS: "0x12" } })), [
    "env",
  ]);
  // El árbitro firma con una llave caliente: no puede ser la Ledger ni la Safe.
  const same = preflightChecks({ ...GOOD, env: { ...ENV, ARBITER_ADDRESS: ENV.DEPLOYER_ADDRESS } });
  assert.deepEqual(failed(same), ["env"]);
  // OWNER_ADDRESS, USDC_ADDRESS y FEE_BPS ya no se configuran: si quedaron con
  // otro valor, el deploy no las usaría y nadie se enteraría.
  const legacy = preflightChecks({ ...GOOD, env: { ...ENV, FEE_BPS: "1000" } });
  assert.deepEqual(failed(legacy), ["env"]);
  assert.match(msgOf(legacy, "env"), /FEE_BPS/);
  assert.deepEqual(failed(preflightChecks({ ...GOOD, env: { ...ENV, FEE_BPS: "1500" } })), []);
  const usdc = preflightChecks({ ...GOOD, env: { ...ENV, USDC_ADDRESS: A("9") } });
  assert.deepEqual(failed(usdc), ["env"]);
  const owner = preflightChecks({ ...GOOD, env: { ...ENV, OWNER_ADDRESS: A("1") } });
  assert.deepEqual(failed(owner), ["env"]);
  assert.match(msgOf(owner, "env"), /DEPLOYER_ADDRESS/);
});

test("sin clave de Basescan no se puede verificar la fuente: no", () => {
  const env = { ...ENV } as Record<string, string | undefined>;
  delete env.ETHERSCAN_API_KEY;
  assert.deepEqual(failed(preflightChecks({ ...GOOD, env })), ["basescan"]);
});

test("el saldo pedido: tres veces el gas del deploy, con un piso", () => {
  assert.equal(requiredBalanceWei(0n), 3n * 10n ** 15n); // piso: 0,003 ETH
  assert.equal(requiredBalanceWei(10n ** 9n), 4_000_000n * 10n ** 9n * 3n); // 1 gwei
});

// ---- Después del deploy -------------------------------------------------------

const ESCROW = A("e");
const EXPECT: DeployExpect = {
  escrow: ESCROW,
  arbiter: ENV.ARBITER_ADDRESS,
  platform: ENV.PLATFORM_WALLET,
  safe: ENV.SAFE_ADDRESS,
  deployer: ENV.DEPLOYER_ADDRESS,
};

/** Recién desplegado: la Safe todavía no aceptó. */
const DEPLOYED: DeployFacts = {
  chainId: BASE_CHAIN_ID,
  code: { matches: true },
  reads: {
    usdc: USDC_BASE,
    arbiter: ENV.ARBITER_ADDRESS.toUpperCase().replace("0X", "0x"),
    platformWallet: ENV.PLATFORM_WALLET,
    feeBps: FEE_BPS,
    allowedStakes: STAKES_USDC,
    owner: ENV.DEPLOYER_ADDRESS,
    pendingOwner: ENV.SAFE_ADDRESS,
    domain: {
      name: "Arcade1v1Escrow",
      version: "2",
      chainId: BASE_CHAIN_ID,
      verifyingContract: ESCROW,
    },
  },
  basescan: { verified: true, compiler: "v0.8.24+commit.e11b9ed9" },
  buildApproved: true,
};

const statusOf = (checks: Check[], id: string) => checks.find((c) => c.id === id)?.status;

test("recién desplegado: todo coincide y falta que la Safe acepte", () => {
  const c = deploymentChecks(EXPECT, DEPLOYED);
  assert.deepEqual(failed(c), []);
  assert.equal(statusOf(c, "duenio"), "pending");
  assert.match(msgOf(c, "duenio"), /acceptOwnership/);
});

test("la Safe aceptó: la dueña es la Safe", () => {
  const reads = { ...DEPLOYED.reads, owner: ENV.SAFE_ADDRESS, pendingOwner: A("0") };
  const c = deploymentChecks(EXPECT, { ...DEPLOYED, reads } as DeployFacts);
  assert.equal(statusOf(c, "duenio"), "ok");
});

test("cada parámetro que no coincide falla con su nombre", () => {
  const base = DEPLOYED.reads as Exclude<DeployFacts["reads"], { error: string }>;
  const cases: [Partial<typeof base>, string][] = [
    [{ usdc: A("9") }, "usdc"],
    [{ arbiter: A("9") }, "arbitro"],
    [{ platformWallet: A("9") }, "plataforma"],
    [{ feeBps: 1000 }, "comision"],
    [{ allowedStakes: [1, 2, 10] }, "mesas"],
    [{ owner: A("9"), pendingOwner: A("0") }, "duenio"],
    // La Ledger sigue de dueña pero el traspaso no se hizo (o va a otro lado).
    [{ pendingOwner: A("0") }, "duenio"],
    [{ pendingOwner: A("9") }, "duenio"],
    [{ domain: { ...base.domain, version: "1" } }, "dominio"],
  ];
  for (const [patch, id] of cases) {
    const c = deploymentChecks(EXPECT, { ...DEPLOYED, reads: { ...base, ...patch } });
    assert.deepEqual(failed(c), [id], JSON.stringify(patch));
  }
  assert.deepEqual(failed(deploymentChecks(EXPECT, { ...DEPLOYED, chainId: 1 })), ["red"]);
  assert.deepEqual(failed(deploymentChecks(EXPECT, { ...DEPLOYED, code: { matches: false } })), [
    "codigo",
  ]);
});

test("la build: la aprobada, otra, o sin build aprobada todavía", () => {
  assert.equal(statusOf(deploymentChecks(EXPECT, DEPLOYED), "build"), "ok");
  const other = deploymentChecks(EXPECT, { ...DEPLOYED, buildApproved: false });
  assert.deepEqual(failed(other), ["build"]);
  assert.equal(
    statusOf(deploymentChecks(EXPECT, { ...DEPLOYED, buildApproved: null }), "build"),
    "skipped",
  );
});

test("si no se pudo leer el contrato, falla sin romperse", () => {
  const c = deploymentChecks(EXPECT, {
    ...DEPLOYED,
    code: { matches: false, detail: "no hay código" },
    reads: { error: "execution reverted" },
  });
  assert.ok(failed(c).includes("codigo"));
  assert.ok(failed(c).includes("lecturas"));
});

test("Basescan: verificado, sin verificar, o sin clave (no se comprobó)", () => {
  assert.equal(statusOf(deploymentChecks(EXPECT, DEPLOYED), "basescan"), "ok");
  const unverified = { ...DEPLOYED, basescan: { verified: false, compiler: "" } };
  assert.deepEqual(failed(deploymentChecks(EXPECT, unverified)), ["basescan"]);
  assert.equal(
    statusOf(deploymentChecks(EXPECT, { ...DEPLOYED, basescan: null }), "basescan"),
    "skipped",
  );
});

test("el código desplegado se compara con el compilado salvo los inmutables", () => {
  // 6 bytes; un inmutable de 2 bytes en el offset 2.
  const compiled = "0x" + "6080" + "0000" + "f3fe";
  const refs = { "7": [{ start: 2, length: 2 }] };
  assert.equal(runtimeCodeMatches("0x6080abcdf3fe", compiled, refs), true);
  assert.equal(runtimeCodeMatches("0x6081abcdf3fe", compiled, refs), false); // fuera del inmutable
  assert.equal(runtimeCodeMatches("0x6080abcdf3", compiled, refs), false); // otro largo
  assert.equal(runtimeCodeMatches("0x", compiled, refs), false); // sin código
});

test("la dirección del escrow sale del registro del deploy de forge", () => {
  const run = {
    transactions: [
      { transactionType: "CREATE", contractName: "Escrow1v1", contractAddress: ESCROW },
      { transactionType: "CALL", contractName: "Escrow1v1", contractAddress: ESCROW },
    ],
  };
  assert.equal(escrowFromBroadcast(run), ESCROW);
  assert.equal(escrowFromBroadcast({ transactions: [] }), null);
});

test("un registro de deploy anterior al que se acaba de correr no cuenta", () => {
  const dir = mkdtempSync(join(tmpdir(), "broadcast-"));
  const runDir = join(dir, "DeployMainnet.s.sol", String(BASE_CHAIN_ID));
  mkdirSync(runDir, { recursive: true });
  const file = join(runDir, "run-latest.json");
  writeFileSync(
    file,
    JSON.stringify({
      transactions: [
        { transactionType: "CREATE", contractName: "Escrow1v1", contractAddress: ESCROW },
      ],
    }),
  );
  const old = new Date(Date.now() - 3_600_000);
  utimesSync(file, old, old);
  const prev = process.env.FOUNDRY_BROADCAST;
  process.env.FOUNDRY_BROADCAST = dir;
  try {
    assert.equal(lastBroadcastEscrow(), ESCROW, "sin límite: el último registro");
    // forge falló antes de mandar nada: el registro es de un intento anterior.
    assert.equal(lastBroadcastEscrow(Date.now() - 60_000), null);
  } finally {
    if (prev === undefined) delete process.env.FOUNDRY_BROADCAST;
    else process.env.FOUNDRY_BROADCAST = prev;
  }
});

test("la respuesta de Basescan (API de Etherscan v2)", () => {
  const ok = {
    status: "1",
    result: [{ SourceCode: "contract X {}", CompilerVersion: "v0.8.24+commit.e11b9ed9" }],
  };
  assert.deepEqual(basescanStatus(ok), { verified: true, compiler: "v0.8.24+commit.e11b9ed9" });
  const not = { status: "1", result: [{ SourceCode: "", CompilerVersion: "" }] };
  assert.deepEqual(basescanStatus(not), { verified: false, compiler: "" });
});

// ---- Una sola verdad para la comisión, las mesas, la red y el USDC (DEP-6) ----

test("la comisión y las mesas del deploy son las que muestra la web", () => {
  assert.equal(FEE_BPS, Math.round(PLATFORM_FEE * 10_000));
  assert.deepEqual(STAKES_USDC, [...BET_AMOUNTS]);
});

test("el script de Solidity usa las mismas constantes que el verificador", () => {
  const sol = readFileSync(new URL("../script/DeployMainnet.s.sol", import.meta.url), "utf8");
  const num = (re: RegExp) => Number(re.exec(sol)?.[1]?.replace(/_/g, ""));
  assert.equal(num(/FEE_BPS\s*=\s*([\d_]+);/), FEE_BPS);
  assert.equal(num(/BASE_CHAIN_ID\s*=\s*([\d_]+);/), BASE_CHAIN_ID);
  assert.equal(/USDC_BASE\s*=\s*(0x[0-9a-fA-F]{40});/.exec(sol)?.[1], USDC_BASE);
  const stakes = [...sol.matchAll(/setAllowedStake\(([\d_]+), true\)/g)].map(
    (m) => Number(m[1].replace(/_/g, "")) / 1_000_000,
  );
  assert.deepEqual(stakes, STAKES_USDC);
});
