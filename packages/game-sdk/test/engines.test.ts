// Tests unitarios de los 6 motores del arcade y sus verificadores.
//
// Por qué importan: el verificador (`verifyX`) es el corazón del ANTI-TRAMPA.
// El servidor re-juega el replay del jugador y exige que el puntaje coincida.
// Para que eso sea sólido, cada motor tiene que ser DETERMINISTA (misma semilla
// + mismas entradas => mismo puntaje) y el verificador tiene que reproducir
// exactamente el puntaje del intento. Acá lo probamos de forma directa.
//
// Correr: node --import tsx --test packages/game-sdk/test/engines.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { Game2048, verify2048, type Dir, type Replay2048 } from "@arcade1v1/game-sdk/g2048";
import { TetrisEngine, verifyTetris, type TetrisAction, type ReplayTetris } from "@arcade1v1/game-sdk/tetris";
import { FlappyEngine, FLAPPY_DT, verifyFlappy, type ReplayFlappy } from "@arcade1v1/game-sdk/flappy";
import { RacingEngine, RACING_DT, verifyRacing, type RaceAction, type ReplayRacing } from "@arcade1v1/game-sdk/racing";
import { SnakeEngine, verifySnake, type ReplaySnake } from "@arcade1v1/game-sdk/snake";
import { InvadersEngine, verifyInvaders, type InvaderAction, type ReplayInvaders } from "@arcade1v1/game-sdk/invaders";

// --------------------------------------------------------------------------
// Helpers: cada uno juega un intento determinista y devuelve { score, replay }.
// (Mismo patrón que usa el selftest del árbitro, acá aislado por juego.)
// --------------------------------------------------------------------------

function play2048(seed: number): { score: number; replay: Replay2048 } {
  const g = new Game2048(seed);
  const dirs: Dir[] = ["left", "up", "right", "down"];
  const moves: Dir[] = [];
  for (let i = 0; !g.over && i < 4000 && moves.length < 500; i++) {
    if (g.move(dirs[i % 4])) moves.push(dirs[i % 4]);
  }
  return { score: g.score, replay: { seed, moves } };
}

function playTetris(seed: number): { score: number; replay: ReplayTetris } {
  const g = new TetrisEngine(seed);
  const inputs: { t: number; a: TetrisAction }[] = [];
  let t = 0;
  while (!g.over && t < 3000) {
    if (t % 6 === 0) {
      g.apply("h");
      inputs.push({ t, a: "h" });
    }
    g.tick();
    t++;
  }
  return { score: g.score, replay: { seed, ticks: t, inputs } };
}

function playFlappy(seed: number): { score: number; replay: ReplayFlappy } {
  const g = new FlappyEngine(seed);
  const flaps: number[] = [];
  let t = 0;
  while (!g.over && t < 600) {
    if (t % 18 === 0) {
      g.flap();
      flaps.push(t);
    }
    g.update(FLAPPY_DT);
    t++;
  }
  return { score: g.score, replay: { seed, ticks: t, flaps } };
}

function playRacing(seed: number): { score: number; replay: ReplayRacing } {
  const g = new RacingEngine(seed);
  const inputs: { t: number; a: RaceAction }[] = [];
  let t = 0;
  while (!g.over && t < 1200) {
    if (t % 40 === 0) {
      g.moveRight();
      inputs.push({ t, a: "r" });
    } else if (t % 40 === 20) {
      g.moveLeft();
      inputs.push({ t, a: "l" });
    }
    g.update(RACING_DT);
    t++;
  }
  return { score: g.score, replay: { seed, ticks: t, inputs } };
}

function playSnake(seed: number): { score: number; replay: ReplaySnake } {
  const g = new SnakeEngine(seed);
  let t = 0;
  while (!g.over && t < 2000) {
    g.tick();
    t++;
  }
  return { score: g.score, replay: { seed, ticks: t, inputs: [] } };
}

function playInvaders(seed: number): { score: number; replay: ReplayInvaders } {
  const g = new InvadersEngine(seed);
  const inputs: { t: number; a: InvaderAction }[] = [];
  g.apply("r1");
  inputs.push({ t: 0, a: "r1" });
  g.apply("f1");
  inputs.push({ t: 0, a: "f1" });
  let t = 0;
  while (!g.over && t < 3000) {
    g.tick();
    t++;
  }
  return { score: g.score, replay: { seed, ticks: t, inputs } };
}

// --------------------------------------------------------------------------
// Suite parametrizada: las 3 propiedades que el anti-trampa necesita de cada
// juego.  Cada `verify` re-juega el replay y devuelve el puntaje real.
// --------------------------------------------------------------------------

interface GameCase {
  name: string;
  play: (seed: number) => { score: number; replay: unknown };
  verify: (replay: unknown) => number;
  /** Un replay manipulado a mano que NO puede dar el puntaje inflado. */
  tampered: (seed: number) => unknown;
}

const CASES: GameCase[] = [
  {
    name: "2048",
    play: play2048,
    verify: (r) => verify2048(r as Replay2048),
    tampered: (seed) => ({ seed, moves: [] }),
  },
  {
    name: "tetris",
    play: playTetris,
    verify: (r) => verifyTetris(r as ReplayTetris),
    tampered: (seed) => ({ seed, ticks: 5, inputs: [] }),
  },
  {
    name: "flappy",
    play: playFlappy,
    verify: (r) => verifyFlappy(r as ReplayFlappy),
    tampered: (seed) => ({ seed, ticks: 5, flaps: [] }),
  },
  {
    name: "racing",
    play: playRacing,
    verify: (r) => verifyRacing(r as ReplayRacing),
    tampered: (seed) => ({ seed, ticks: 5, inputs: [] }),
  },
  {
    name: "snake",
    play: playSnake,
    verify: (r) => verifySnake(r as ReplaySnake),
    tampered: (seed) => ({ seed, ticks: 5, inputs: [] }),
  },
  {
    name: "invaders",
    play: playInvaders,
    verify: (r) => verifyInvaders(r as ReplayInvaders),
    tampered: (seed) => ({ seed, ticks: 5, inputs: [] }),
  },
];

const SEED = 424242;

for (const c of CASES) {
  test(`${c.name}: determinista (misma semilla => mismo puntaje)`, () => {
    const a = c.play(SEED);
    const b = c.play(SEED);
    assert.equal(a.score, b.score, "el motor debe ser determinista");
  });

  test(`${c.name}: verify reproduce el puntaje del intento`, () => {
    const { score, replay } = c.play(SEED);
    assert.equal(c.verify(replay), score, "verify debe re-jugar y dar el mismo puntaje");
  });

  test(`${c.name}: verify es estable (mismo replay => mismo puntaje)`, () => {
    const { replay } = c.play(SEED);
    assert.equal(c.verify(replay), c.verify(replay));
  });

  test(`${c.name}: un replay manipulado NO da un puntaje inflado`, () => {
    const realScore = c.play(SEED).score;
    const tamperedScore = c.verify(c.tampered(SEED));
    // El replay recortado/vacío produce un puntaje DETERMINISTA y distinto del
    // intento real (jamás el 999999 que pretendería un tramposo).
    assert.notEqual(tamperedScore, 999999);
    assert.ok(
      tamperedScore <= realScore,
      `un replay manipulado (${tamperedScore}) no puede superar al intento real (${realScore})`,
    );
  });
}
