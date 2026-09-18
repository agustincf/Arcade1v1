// La base del Flappy EN VIVO en el motor: el azar puede venir de una fuente
// inyectada (el árbitro lo revela de a poco) sin cambiar ni un resultado, y
// `drawsWithin` dice cuánto azar va a pedir el juego antes de que lo pida.
// Diseño: docs/superpowers/specs/2026-09-16-benchmark-en-vivo-design.md
//
// Correr: node --import tsx --test packages/game-sdk/test/flappy-live.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { FlappyEngine, FLAPPY_DT, FLAPPY_CONST } from "@arcade1v1/game-sdk/flappy";
import { mulberry32 } from "../src/replay";

/** Aletea como la estrategia oficial: cayendo y por debajo del próximo hueco. */
function flapPolicy(g: FlappyEngine, t: number): boolean {
  if (t === 0) return true;
  if (t % 2 !== 0) return false;
  const next = g.pipes.find((p) => p.x + FLAPPY_CONST.PIPE_W >= FLAPPY_CONST.BIRD_X);
  const target = (next ? next.gapY : FLAPPY_CONST.HEIGHT / 2) + 15;
  return g.birdY > target && g.birdVy > 0;
}

/** Juega con `flapPolicy` hasta morir o `max` ticks. */
function run(g: FlappyEngine, max = 6_000): { ticks: number; flaps: number[] } {
  const flaps: number[] = [];
  let t = 0;
  for (; t < max && !g.over; t++) {
    if (flapPolicy(g, t)) {
      g.flap();
      flaps.push(t);
    }
    g.update(FLAPPY_DT);
  }
  return { ticks: t, flaps };
}

test("caracterización: 50 semillas dan exactamente lo mismo que el motor antes del cambio", () => {
  // Huella calculada con el motor de main en a22e748 (puntajes de 14 a 60).
  // Si cambia, cambió la física: eso rompería los replays ya jugados.
  const lines: string[] = [];
  for (let seed = 1; seed <= 50; seed++) {
    const g = new FlappyEngine(seed);
    const { ticks } = run(g);
    lines.push(`${seed}:${g.score}:${ticks}:${g.pipes.map((p) => p.gapY.toFixed(6)).join("|")}`);
  }
  const fingerprint = createHash("sha256").update(lines.join("\n")).digest("hex");
  assert.equal(fingerprint, "2f854a9dc1d18b4e30e2c3692f6437dab4250f2c1f98db38c41c45edece17630");
});

test("con una fuente de azar el motor juega exactamente igual que con la semilla", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const a = new FlappyEngine(seed);
    const b = new FlappyEngine({ next: mulberry32(seed) });
    const ra = run(a);
    const rb = run(b);
    assert.deepEqual(
      [b.score, rb.ticks, rb.flaps, b.pipes],
      [a.score, ra.ticks, ra.flaps, a.pipes],
      `seed ${seed}`,
    );
  }
});

test("drawsWithin predice exacto cuánto azar consume el juego en los próximos ticks mientras el pájaro vive", () => {
  const LEAD = 15;
  let checked = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const rng = mulberry32(seed);
    let used = 0;
    const g = new FlappyEngine({
      next: () => {
        used += 1;
        return rng();
      },
    });
    // Predicción hecha ANTES de aplicar el tick `at`: cubre los ticks [at, at + LEAD).
    const pending: { at: number; used: number; draws: number }[] = [];
    for (let t = 0; t < 6_000 && !g.over; t++) {
      while (pending.length && pending[0].at + LEAD <= t) {
        const p = pending.shift()!;
        assert.equal(used - p.used, p.draws, `seed ${seed}, tick ${p.at}`);
        checked += 1;
      }
      if (g.started) pending.push({ at: t, used, draws: g.drawsWithin(LEAD) });
      if (flapPolicy(g, t)) g.flap();
      g.update(FLAPPY_DT);
    }
  }
  assert.ok(checked > 100_000, `se chequearon ${checked} predicciones`);
});

test("drawsWithin no toca el motor, y da 0 sin arrancar o con la partida terminada", () => {
  const g = new FlappyEngine(7);
  assert.equal(g.drawsWithin(10_000), 0, "sin el primer aleteo los tubos no se mueven");
  // Un aleteo cada 36 ticks mantiene el vuelo estable: con uno solo, el pájaro
  // cae al piso en el tick 54 y a los 100 la partida ya terminó.
  for (let t = 0; t < 100; t++) {
    if (t % 36 === 0) g.flap();
    g.update(FLAPPY_DT);
  }
  assert.equal(g.over, false, "sigue vivo");
  const before = JSON.stringify(g);
  assert.ok(g.drawsWithin(600) > 0);
  assert.equal(JSON.stringify(g), before, "el motor quedó igual");
  while (!g.over) g.update(FLAPPY_DT);
  assert.equal(g.drawsWithin(10_000), 0, "terminada no consume");
});
