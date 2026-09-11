// NARRADOR de Aleph: convierte los resultados de una sala en una lista de
// líneas para leer. Es PURO —sin React, sin red, sin reloj— y no devuelve
// texto: devuelve CLAVES i18n con sus variables ya formateadas, así la misma
// sala se cuenta igual en los 4 idiomas y el test puede verificarla sin
// montar nada. La página hace t(line.key, line.vars).
//
// Todo lo que dice sale de StageResult, que arma el motor
// (packages/game-sdk/src/aleph.ts). Nada se recalcula acá: si un número no
// está en el resultado, no se inventa.
import { ALEPH_RULES as R, type StageKind, type StageResult } from "@arcade1v1/game-sdk/aleph";

export interface StoryLine {
  key: string;
  vars?: Record<string, string | number>;
}

export interface StoryStage {
  /** 1-based: "Etapa 1" es la primera, aunque el motor la indexe en 0. */
  n: number;
  /** El índice del motor (0-based). La página lo usa para pegarle a esta etapa
   *  los mensajes que se dijeron en ella (`AlephMessage.stage`). */
  index: number;
  kind: StageKind;
  lines: StoryLine[];
}

/** Cómo se muestra una dirección (nombre del perfil o forma corta). La pone la
 *  página; el narrador no sabe de perfiles. */
export type NameFn = (address: string) => string;

const pct = (bps: number) => `${bps / 100}%`;
const names = (xs: string[], name: NameFn) => xs.map(name).join(", ");

function share(r: StageResult, name: NameFn, out: StoryLine[]): void {
  const kept = r.kept ?? [];
  const contributed = r.contributed ?? [];
  if (kept.length === 0) {
    out.push({ key: "aleph.story.share.allIn", vars: { contributed: names(contributed, name) } });
  } else if (contributed.length === 0) {
    out.push({ key: "aleph.story.share.allKept", vars: { kept: names(kept, name) } });
  } else {
    out.push({
      key: "aleph.story.share.mixed",
      vars: { kept: names(kept, name), contributed: names(contributed, name) },
    });
  }
  if (r.bonus) out.push({ key: "aleph.story.share.bonus", vars: { bonus: r.bonus } });
}

function offer(r: StageResult, name: NameFn, out: StoryLine[]): void {
  out.push({ key: "aleph.story.offer.made", vars: { pct: pct(r.offerBps ?? 0) } });
  const accepted = r.accepted ?? [];
  if (r.voided) {
    out.push({ key: "aleph.story.offer.void", vars: { pct: pct(R.OFFER_VOID_BURN_BPS) } });
    return;
  }
  if (accepted.length === 0) {
    out.push({ key: "aleph.story.offer.none" });
    return;
  }
  out.push({
    key: "aleph.story.offer.taken",
    vars: { who: names(accepted, name), each: r.eachGot ?? 0 },
  });
}

function vote(r: StageResult, name: NameFn, out: StoryLine[]): void {
  const votes = r.votes ?? {};
  if (r.eliminated) {
    out.push({
      key: "aleph.story.vote.out",
      vars: { who: name(r.eliminated), votes: votes[r.eliminated] ?? 0 },
    });
  }
  const tally = Object.entries(votes)
    .map(([addr, n]) => `${name(addr)}: ${n}`)
    .join(" · ");
  if (tally) out.push({ key: "aleph.story.vote.tally", vars: { tally } });
}

function lock(r: StageResult, name: NameFn, out: StoryLine[]): void {
  out.push({ key: "aleph.story.lock.code", vars: { code: r.code ?? "" } });
  const solvers = r.solvers ?? [];
  const traitors = r.traitors ?? [];
  if (r.failed || solvers.length === 0) {
    out.push({ key: "aleph.story.lock.failed", vars: { pct: pct(R.LOCK_FAIL_BURN_BPS) } });
    return;
  }
  if (traitors.length === 0) {
    out.push({
      key: "aleph.story.lock.all",
      vars: { who: names(solvers, name), bonus: r.bonus ?? 0 },
    });
    return;
  }
  out.push({
    key: "aleph.story.lock.traitors",
    vars: { who: names(traitors, name), each: r.eachGot ?? 0 },
  });
  // Los que acertaron sin traicionar merecen el crédito igual: quedaron
  // expuestos al mismo riesgo y se llevaron nada.
  const honest = solvers.filter((s) => !traitors.includes(s));
  if (honest.length) {
    out.push({ key: "aleph.story.lock.solvers", vars: { who: names(honest, name) } });
  }
}

function final(r: StageResult, name: NameFn, out: StoryLine[]): void {
  const choices = r.choices ?? {};
  const thieves = Object.keys(choices).filter((a) => choices[a] === "steal");
  if (thieves.length === 0) return void out.push({ key: "aleph.story.final.split" });
  if (thieves.length === 1) {
    return void out.push({ key: "aleph.story.final.steal", vars: { who: name(thieves[0]) } });
  }
  out.push({ key: "aleph.story.final.both" });
}

const BY_KIND: Record<StageKind, (r: StageResult, name: NameFn, out: StoryLine[]) => void> = {
  share,
  offer,
  vote,
  lock,
  final,
};

/** Una sala contada etapa por etapa. `name` traduce direcciones a etiquetas. */
export function storyFromResults(results: StageResult[], name: NameFn): StoryStage[] {
  return results.map((r, i) => {
    const lines: StoryLine[] = [];
    BY_KIND[r.kind](r, name, lines);
    // La Final termina la sala: no hay abandonos que contar, ni decaimiento, ni
    // tablero que mostrar después (el pozo queda en 0 y lo que importa es la
    // tabla de pagos, que la página muestra aparte).
    if (r.kind !== "final") {
      if (r.abandoned?.length) {
        lines.push({ key: "aleph.story.abandoned", vars: { who: names(r.abandoned, name) } });
      }
      if (r.decay) lines.push({ key: "aleph.story.decay", vars: { decay: r.decay } });
      lines.push({ key: "aleph.story.after", vars: { pot: r.potAfter, box: r.boxAfter } });
    }
    return { n: i + 1, index: r.index, kind: r.kind, lines };
  });
}

/** Todas las claves que este módulo puede emitir. El test las cruza contra los
 *  4 diccionarios: si alguien agrega una rama y se olvida de traducirla, falla
 *  acá y no en pantalla. */
export const STORY_KEYS = [
  "aleph.story.share.allIn",
  "aleph.story.share.allKept",
  "aleph.story.share.mixed",
  "aleph.story.share.bonus",
  "aleph.story.offer.made",
  "aleph.story.offer.void",
  "aleph.story.offer.none",
  "aleph.story.offer.taken",
  "aleph.story.vote.out",
  "aleph.story.vote.tally",
  "aleph.story.lock.code",
  "aleph.story.lock.failed",
  "aleph.story.lock.all",
  "aleph.story.lock.traitors",
  "aleph.story.lock.solvers",
  "aleph.story.final.split",
  "aleph.story.final.steal",
  "aleph.story.final.both",
  "aleph.story.abandoned",
  "aleph.story.decay",
  "aleph.story.after",
] as const;
