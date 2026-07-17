#!/usr/bin/env node
// CRITERIO DE ÉXITO de juegos v2: la brecha entre la estrategia "trivial"
// (la que NO conoce las mecánicas nuevas) y la "planificadora" debe ser CLARA.
// - snake: la única mecánica nueva es la moneda => greedy coinGreed 0.8 vs 0.
// - racing: la mecánica dominante es el SALTO (sin saltar, las paredes-salto
//   del nivel 2+ matan seguro) => un dodger v1 inline (esquiva+recentra, no
//   salta, ignora monedas) vs el dodger v2 con sus valores por defecto.
// Si la brecha es ~0, las mecánicas no discriminan habilidad: recalibrar.
// Uso: node --import tsx scripts/gap-check.mjs [semillas=200]
import { getStrategy, defaultParams } from "@arcade1v1/strategies";
import { RacingEngine, RACING_DT, RACING_CONST, LANES } from "@arcade1v1/game-sdk/racing";

const N = Number(process.argv[2] ?? 200);
const CAR_Y = RACING_CONST.HEIGHT - 80;

function avg(id, overrides) {
  const def = getStrategy(id);
  let total = 0;
  for (let seed = 1; seed <= N; seed++) {
    total += def.play(seed, { ...defaultParams(def), ...overrides }).score;
  }
  return total / N;
}

/** Dodger v1 (medidor, no producción): esquivar al carril libre más cercano y
 *  recentrar. No salta ni junta monedas — es la vara "trivial" de racing. */
function racingV1Avg() {
  let total = 0;
  for (let seed = 1; seed <= N; seed++) {
    const g = new RacingEngine(seed);
    let cooldown = 0;
    const danger = (lane, dist) =>
      g.obstacles.some((o) => o.lane === lane && o.y > CAR_Y - dist && o.y < CAR_Y + RACING_CONST.CAR_H);
    for (let t = 0; t < 36_000 && !g.over; t++) {
      if (cooldown > 0) cooldown--;
      if (cooldown === 0) {
        let target = g.carLane;
        if (danger(g.carLane, 160)) {
          const c = [g.carLane - 1, g.carLane + 1].filter((l) => l >= 0 && l < LANES && !danger(l, 200));
          if (c.length > 0) {
            c.sort((a, b) => Math.abs(a - 1) - Math.abs(b - 1));
            target = c[0];
          }
        } else if (g.carLane !== 1 && !danger(1, 240)) {
          target = g.carLane + Math.sign(1 - g.carLane);
        }
        if (target !== g.carLane) {
          if (target < g.carLane) g.moveLeft();
          else g.moveRight();
          cooldown = 8;
        }
      }
      g.update(RACING_DT);
    }
    total += g.score;
  }
  return total / N;
}

function gapLine(game, trivial, planner) {
  const gap = trivial > 0 ? ((planner - trivial) / trivial) * 100 : Infinity;
  console.log(
    `${game.padEnd(8)} trivial=${trivial.toFixed(1)}  planificadora=${planner.toFixed(1)}  brecha=${gap.toFixed(1)}%`,
  );
  return gap;
}

console.log(`Semillas por corrida: ${N}\n`);
const gaps = [
  gapLine("snake", avg("snake.greedy", { coinGreed: 0 }), avg("snake.greedy", { coinGreed: 0.8 })),
  gapLine("racing", racingV1Avg(), avg("racing.dodger", {})),
];
const ok = gaps.every((g) => g >= 10);
console.log(ok ? "\nOK: brecha ≥ 10% en ambos juegos." : "\nATENCIÓN: brecha < 10% — recalibrar (COIN_CHANCE/COIN_VALUE o monedas de racing).");
process.exit(ok ? 0 : 1);
