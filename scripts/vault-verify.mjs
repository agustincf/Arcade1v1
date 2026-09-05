#!/usr/bin/env node
// Verificador PÚBLICO de una sala de La Bóveda: cualquiera puede comprobar que
// el árbitro no hizo trampa, sin confiar en él. Tres chequeos sobre el
// registro que devuelve GET /vault/:id/log:
//   1) keccak256(secretSeed) == commit publicado al arrancar (el azar no cambió);
//   2) cada acción del registro está firmada por su asiento (nadie habló por otro);
//   3) re-simular el registro con el motor público da la MISMA tabla de pagos.
// Uso: node --import tsx scripts/vault-verify.mjs <arbiterUrl> <roomId>
import { pathToFileURL } from "node:url";
import { keccak256, recoverMessageAddress } from "viem";
import { replayVault, actionLine } from "@arcade1v1/game-sdk/vault";
import { vaultActionAuthMessage } from "@arcade1v1/game-sdk/auth";

/** Corre los tres chequeos sobre un registro ya descargado. */
export async function verifyVaultLog(log) {
  const checks = [];
  const check = (ok, name) => checks.push({ name, ok });

  check(keccak256(log.secretSeed) === log.commit, "compromiso: keccak256(secretSeed) == commit");

  let signed = 0;
  let unsigned = 0;
  let badSig = 0;
  for (const ev of log.events) {
    if (ev.type !== "action") continue;
    if (!ev.signature) {
      unsigned++;
      continue;
    }
    try {
      const signer = await recoverMessageAddress({
        message: vaultActionAuthMessage(
          log.roomId,
          ev.stage,
          ev.phase,
          actionLine(ev.action),
          ev.ts,
        ),
        signature: ev.signature,
      });
      if (signer.toLowerCase() === ev.address) signed++;
      else badSig++;
    } catch {
      badSig++;
    }
  }
  check(
    badSig === 0,
    `firmas: ${signed} válidas, ${badSig} inválidas, ${unsigned} sin firma (sin firma solo vale fuera de producción)`,
  );

  let payouts = null;
  let potInitial = 0;
  try {
    const s = replayVault(log.secretSeed, log.seats, log.events);
    payouts = s.payouts;
    potInitial = s.potInitial;
  } catch (e) {
    check(false, `re-simulación: el registro no se puede re-jugar (${e.message})`);
  }
  if (payouts) {
    check(
      JSON.stringify(payouts) === JSON.stringify(log.payouts),
      "re-simulación: la tabla de pagos coincide con la publicada",
    );
    const total = Object.values(payouts).reduce((a, b) => a + b, 0);
    check(total === potInitial, `la tabla suma el total (${total} de ${potInitial})`);
  }
  return { ok: checks.every((c) => c.ok), checks };
}

async function main() {
  const [url, roomId] = process.argv.slice(2);
  if (!url || !roomId) {
    console.error("uso: node --import tsx scripts/vault-verify.mjs <arbiterUrl> <roomId>");
    process.exit(2);
  }
  const r = await fetch(`${url.replace(/\/+$/, "")}/vault/${roomId}/log`);
  if (!r.ok) {
    console.error(`HTTP ${r.status}: ${await r.text()}`);
    process.exit(2);
  }
  const { ok, checks } = await verifyVaultLog(await r.json());
  for (const c of checks) console.log(`${c.ok ? "✔" : "✘"} ${c.name}`);
  console.log(ok ? "\nSala verificada." : "\nLA SALA NO VERIFICA.");
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
