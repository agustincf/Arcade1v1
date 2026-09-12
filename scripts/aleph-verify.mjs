#!/usr/bin/env node
// Verificador PÚBLICO de una sala de Aleph: cualquiera puede comprobar que
// el árbitro no hizo trampa, sin confiar en él. Chequeos sobre el registro que
// devuelve GET /aleph/:id/log:
//   1) keccak256(secretSeed) == commit publicado al arrancar (el azar no cambió);
//   2) el registro declara la MISMA versión de reglas que este motor;
//   3) cada acción del registro está firmada por su asiento (nadie habló por otro);
//   4) los cierres de fase son legítimos: uno anticipado solo si el estado lo
//      justifica, uno por plazo solo si pasó una fase entera desde el anterior;
//   5) re-simular el registro con el motor público da la MISMA tabla de pagos;
//   6) en una mesa de plata (con `usdc`), la tabla en USDC firmada sale de
//      convertir la tabla en unidades con la comisión que el registro leyó
//      del contrato (piso por asiento, polvo aparte para la plataforma).
// Uso: node --import tsx scripts/aleph-verify.mjs <arbiterUrl> <roomId> [phaseMs]
import { pathToFileURL } from "node:url";
import { keccak256, recoverMessageAddress } from "viem";
import {
  replayAleph,
  createAleph,
  applyEvent,
  phaseComplete,
  actionLine,
  ALEPH_RULES_V,
  usdcPayoutTable,
  stakeToUnits,
} from "@arcade1v1/game-sdk/aleph";
import { alephActionAuthMessage } from "@arcade1v1/game-sdk/auth";

/** Plazo de fase por default del árbitro (ALEPH_PHASE_MS). No es una regla del
 *  motor sino un knob del servidor, así que se puede pasar por argumento. */
export const DEFAULT_PHASE_MS = 120000;

/** Corre los chequeos sobre un registro ya descargado. `phaseMs` es el plazo de
 *  fase con el que operaba ese árbitro (default 120000). */
export async function verifyAlephLog(log, phaseMs = DEFAULT_PHASE_MS) {
  const checks = [];
  const check = (ok, name) => checks.push({ name, ok });

  check(keccak256(log.secretSeed) === log.commit, "compromiso: keccak256(secretSeed) == commit");
  check(
    log.rulesV === ALEPH_RULES_V,
    `versión de reglas: el registro dice ${log.rulesV} y este motor es ${ALEPH_RULES_V}`,
  );

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
        message: alephActionAuthMessage(
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

  // Cierres de fase: re-simular hasta CADA `phase_end` y ver si el motivo que
  // declara el árbitro se sostiene. Un cierre anticipado que nadie justificaba
  // (o uno por plazo antes de tiempo) es la forma barata de hacer trampa con el
  // reloj, y es lo único que el árbitro decide solo.
  const badEnds = [];
  try {
    let s = createAleph(log.secretSeed, log.seats);
    let prev = typeof log.startedAt === "number" ? log.startedAt : null;
    for (const ev of log.events) {
      if (ev.type === "phase_end") {
        const done = phaseComplete(s);
        if (ev.reason === "all_acted" || ev.reason === "all_ready") {
          if (done !== ev.reason) {
            badEnds.push(
              `etapa ${ev.stage}/${ev.phase} dice "${ev.reason}" y el estado dice "${done ?? "nada"}"`,
            );
          }
        } else if (prev !== null && ev.at - prev < phaseMs) {
          badEnds.push(
            `etapa ${ev.stage}/${ev.phase} cierra por plazo ${ev.at - prev} ms después del anterior (< ${phaseMs})`,
          );
        }
        prev = ev.at;
      }
      s = applyEvent(s, ev);
    }
  } catch (e) {
    badEnds.push(`no se pudo re-simular: ${e.message}`);
  }
  check(
    badEnds.length === 0,
    `cierres de fase legítimos (plazo ${phaseMs} ms)${badEnds.length ? ": " + badEnds.join("; ") : ""}`,
  );

  let payouts = null;
  let potInitial = 0;
  try {
    const s = replayAleph(log.secretSeed, log.seats, log.events);
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

  // 6) Mesa de plata: la tabla en USDC que se firmó sale de la tabla en
  //    unidades con la comisión del contrato (floor por asiento, polvo aparte).
  //    Es el borde donde el árbitro convierte, así que es el borde a vigilar.
  if (log.usdc && payouts) {
    try {
      const t = usdcPayoutTable(log.seats, payouts, stakeToUnits(log.stake), log.usdc.feeBps);
      const published = log.seats.map((a) => String(log.usdc.table?.[a]));
      const expected = t.amounts.map(String);
      check(
        JSON.stringify(published) === JSON.stringify(expected),
        `USDC: la tabla firmada coincide con la conversión (comisión ${log.usdc.feeBps} bps, polvo ${t.dust})`,
      );
    } catch (e) {
      check(false, `USDC: no se pudo recalcular la tabla (${e.message})`);
    }
    // Aparte del try: no depende de la conversión (no puede tirar), y así una
    // tabla que no cierra no tapa el estado de la liquidación, ni al revés.
    // `settle` es permissionless y la firma se publica precisamente para que
    // cualquiera pueda presentarla: "external" (otra transacción, sin hash
    // propio) es una liquidación tan buena como una con `settleTx`. Solo la
    // ausencia de las dos, o "refunded" (la sala se reembolsó en vez de
    // pagarse), cuentan como no liquidada.
    const settledOnchain = !!log.usdc.settleTx || log.usdc.settleOutcome === "external";
    const settleNote = log.usdc.settleTx
      ? log.usdc.settleTx
      : log.usdc.settleOutcome === "external"
        ? "sin hash propio: la presentó otra transacción con la misma firma"
        : log.usdc.settleOutcome === "refunded"
          ? "no se liquidó: la sala se reembolsó on-chain"
          : "todavía no: la firma está publicada, cualquiera puede presentarla";
    check(settledOnchain, `USDC: la liquidación salió a la cadena (${settleNote})`);
  }
  return { ok: checks.every((c) => c.ok), checks };
}

async function main() {
  const [url, roomId, phaseMs] = process.argv.slice(2);
  if (!url || !roomId) {
    console.error(
      "uso: node --import tsx scripts/aleph-verify.mjs <arbiterUrl> <roomId> [phaseMs]\n" +
        `      phaseMs: plazo de fase del árbitro en ms (default ${DEFAULT_PHASE_MS}); ` +
        "es un knob del servidor (ALEPH_PHASE_MS), no una regla del motor.",
    );
    process.exit(2);
  }
  const r = await fetch(`${url.replace(/\/+$/, "")}/aleph/${roomId}/log`);
  if (!r.ok) {
    console.error(`HTTP ${r.status}: ${await r.text()}`);
    process.exit(2);
  }
  const { ok, checks } = await verifyAlephLog(
    await r.json(),
    phaseMs ? Number(phaseMs) : DEFAULT_PHASE_MS,
  );
  for (const c of checks) console.log(`${c.ok ? "✔" : "✘"} ${c.name}`);
  console.log(ok ? "\nSala verificada." : "\nLA SALA NO VERIFICA.");
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
