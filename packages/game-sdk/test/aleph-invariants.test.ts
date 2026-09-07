// Propiedades del motor: (1) conservación del dinero después de CADA evento y
// tabla que suma el total; (2) re-simular el registro da EXACTAMENTE el estado
// vivo (es lo que hace verificable a la sala); (3) la vista no filtra secretos.
// Correr: node --import tsx --test packages/game-sdk/test/aleph-invariants.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAleph,
  applyEvent,
  replayAleph,
  viewFor,
  phaseComplete,
  aliveSeats,
  type AlephAction,
  type AlephEvent,
  type AlephState,
} from "@arcade1v1/game-sdk/aleph";
import { mulberry32 } from "../src/replay";
import {
  SEED,
  A,
  seedN,
  seats,
  act,
  end,
  skipTalk,
  allDecide,
  assertConserved,
} from "./aleph-helpers";

/** Un agente al azar (reproducible): decide algo válido, a veces falta, a veces habla. */
function randomAction(s: AlephState, me: string, rnd: () => number): AlephAction | null {
  const st = s.stage;
  if (st.phase === "talk") return rnd() < 0.8 ? { type: "ready" } : null;
  const others = aliveSeats(s).filter((x) => x.address !== me);
  switch (st.kind) {
    case "share":
      return { type: rnd() < 0.5 ? "keep" : "contribute" };
    case "offer":
      return { type: rnd() < 0.3 ? "accept" : "decline" };
    case "vote":
      return { type: "vote", target: others[Math.floor(rnd() * others.length)].address };
    case "lock": {
      if (rnd() < 0.3) return { type: "ready" };
      const code = rnd() < 0.5 ? st.code! : "0".repeat(st.codeLength!);
      return { type: "submit", code, intent: rnd() < 0.5 ? "all" : "me" };
    }
    case "final":
      return { type: rnd() < 0.5 ? "split" : "steal" };
  }
}

function playRandomRoom(seed: string, n: number, rnd: () => number) {
  const addrs = seats(n);
  let s = createAleph(seed, addrs);
  const events: AlephEvent[] = [];
  const push = (ev: AlephEvent) => {
    s = applyEvent(s, ev);
    events.push(ev);
    assertConserved(s);
  };
  let guard = 0;
  while (!s.over) {
    if (++guard > 400) throw new Error("la sala no termina");
    const st = s.stage;
    for (const seat of aliveSeats(s)) {
      if (rnd() < 0.15) continue; // ausente
      if (rnd() < 0.3) {
        push({
          type: "action",
          address: seat.address,
          stage: st.index,
          phase: st.phase,
          action: { type: "say", text: "hola" },
          ts: 0,
        });
      }
      const a = randomAction(s, seat.address, rnd);
      if (a) {
        push({
          type: "action",
          address: seat.address,
          stage: st.index,
          phase: st.phase,
          action: a,
          ts: 0,
        });
      }
    }
    push({
      type: "phase_end",
      stage: st.index,
      phase: st.phase,
      at: 0,
      reason: phaseComplete(s) ?? "deadline",
    });
  }
  return { s, events, addrs };
}

test("propiedad: conservación en cada evento, tabla que suma el total y re-simulación exacta", () => {
  let played = 0;
  for (const n of [4, 5, 6, 8]) {
    for (let i = 0; i < 25; i++) {
      const seed = seedN(i * 10 + n);
      const { s, events, addrs } = playRandomRoom(seed, n, mulberry32(i * 1000 + n));
      const sum = Object.values(s.payouts!).reduce((a, b) => a + b, 0);
      assert.equal(sum, s.potInitial, `seed ${seed}`);
      assert.equal(Object.keys(s.payouts!).length, n);
      assert.deepEqual(replayAleph(seed, addrs, events), s, `replay distinto para ${seed}`);
      played++;
    }
  }
  assert.equal(played, 100);
});

test("peor caso: 8 asientos sin Ofertas aceptadas ni abandonos — cantidad de etapas y fases acotada", () => {
  const deck0 = createAleph(SEED, seats(8)).deck;
  let seen = 0;
  let idx = -1;
  deck0.forEach((c, i) => {
    if (c === "vote" && ++seen === 6) idx = i;
  });
  const played = deck0.slice(0, idx + 1);
  const expectedStages = 1 + played.length + 1; // Reparto inicial + cartas hasta el 6.º Voto + Final
  const expectedPhases =
    1 + played.reduce((acc, c) => acc + (c === "share" || c === "offer" ? 1 : 2), 0) + 2;
  let s = createAleph(SEED, seats(8));
  let phases = 0;
  while (!s.over) {
    const st = s.stage;
    if (st.phase === "talk") {
      s = end(s);
      phases++;
      continue;
    }
    const alive = aliveSeats(s);
    for (const seat of alive) {
      const a: AlephAction =
        st.kind === "share"
          ? { type: "contribute" }
          : st.kind === "offer"
            ? { type: "decline" }
            : st.kind === "vote"
              ? { type: "vote", target: alive.find((x) => x.address !== seat.address)!.address }
              : st.kind === "lock"
                ? { type: "ready" }
                : { type: "split" };
      s = act(s, seat.address, a);
    }
    s = end(s, "all_acted");
    phases++;
  }
  assert.equal(s.results.length, expectedStages);
  assert.equal(phases, expectedPhases);
  assert.ok(expectedStages <= 12 && expectedPhases <= 20);
});

test("viewFor: sin fragmentos ajenos, decisiones, mazo ni semilla; privados solo para sus partes", () => {
  let s = createAleph(SEED, seats(4), { deck: ["lock"] });
  s = allDecide(s, { type: "contribute" }); // → Cerradura, charla
  s = act(s, A(1), { type: "whisper", to: A(2), text: "mi dígito es 7" });
  s = act(s, A(3), { type: "say", text: "compartamos" });
  const v1 = viewFor(s, A(1));
  const v3 = viewFor(s, A(3));
  const pub = viewFor(s);
  assert.deepEqual(v1.you!.fragment, s.stage.fragments![A(1)]);
  const json1 = JSON.stringify(v1);
  for (const a of [A(2), A(3), A(4)]) {
    assert.ok(!json1.includes(JSON.stringify(s.stage.fragments![a])), `fragmento ajeno de ${a}`);
  }
  assert.ok(!json1.includes(s.seed.slice(2)));
  assert.ok(!("deck" in v1) && !("seed" in v1) && !("tiebreak" in v1));
  assert.ok(!("code" in v1.stage) && !("fragments" in v1.stage) && !("decisions" in v1.stage));
  assert.equal(v1.cardsLeft, 0);
  assert.equal(v1.stage.codeLength, 4);
  assert.equal(v1.messages.length, 2);
  assert.equal(v3.messages.length, 1, "A3 no ve el susurro de A1 a A2");
  assert.equal(viewFor(s, A(2)).messages.length, 2, "A2 sí ve el susurro que le mandaron");
  assert.equal(pub.messages.length, 1);
  assert.equal(pub.you, undefined);
  assert.deepEqual(
    pub.seats.map((x) => x.address),
    seats(4),
  );

  s = skipTalk(s);
  s = act(s, A(2), { type: "submit", code: s.stage.code!, intent: "me" });
  const v4 = viewFor(s, A(4));
  assert.deepEqual(v4.stage.acted, [A(2)], "se ve QUIÉN actuó, no qué");
  assert.ok(!JSON.stringify(v4).includes('"intent"'));
  assert.equal(viewFor(s, A(2)).you!.decided, true);
  assert.equal(v4.you!.decided, false);
  assert.equal(v4.you!.ready, false);

  // Al cerrar la etapa el código y el traidor se revelan en `results`.
  s = end(s);
  const after = viewFor(s, A(4));
  assert.equal(after.results[1].code, s.results[1].code);
  assert.deepEqual(after.results[1].traitors, [A(2)]);
});

test("viewFor al terminar: pagos y TODOS los mensajes (también privados)", () => {
  let s = createAleph(SEED, seats(4), { deck: ["offer"] });
  s = act(s, A(1), { type: "whisper", to: A(2), text: "secreto" });
  s = allDecide(s, { type: "contribute" });
  for (const a of [A(1), A(2), A(3)]) s = act(s, a, { type: "accept" });
  s = end(s); // sobrevive A4 → termina
  assert.equal(s.over, true);
  const pub = viewFor(s);
  assert.equal(pub.over, true);
  assert.deepEqual(pub.payouts, s.payouts);
  assert.equal(pub.messages.length, 1);
  assert.equal(pub.messages[0].to, A(2));
});
