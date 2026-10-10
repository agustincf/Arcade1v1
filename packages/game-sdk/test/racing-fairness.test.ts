// GARANTÍA DE SALIDA del generador de Racing v2, en dos capas:
//   (1) INVARIANTE por construcción: ninguna "fila" de spawn bloquea los 3
//       carriles con sólidos, y nunca hay dos paredes-salto consecutivas
//       (el cooldown del salto no recarga entre filas).
//   (2) ORÁCULO: una estrategia con visión perfecta y reglas simples debe
//       sobrevivir un mínimo decente en TODAS las semillas. Si el generador
//       creara algo imposible, el oráculo muere al instante y esto se pone rojo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RacingEngine, RACING_DT, RACING_CONST } from "@arcade1v1/game-sdk/racing";
import { oracleStep } from "./racing-oracle";

const SEEDS = 200;

test("racing v2: cada fila de spawn deja una salida (libre o valla) y no hay dos paredes-salto seguidas", () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const g = new RacingEngine(seed);
    let prevWallWasJump = false;
    let sawRowLastTick = false; // procesar cada fila UNA sola vez (borde de subida)
    for (let t = 0; t < 7200; t++) {
      // Un auto quieto muere en la primera fila que le toque (siempre nivel
      // 0): las paredes-salto recién aparecen desde el nivel 2, así que sin
      // manejar, esa mitad del invariante nunca se llega a ejercitar. Usamos
      // el mismo oráculo calibrado abajo para que el escaneo llegue lejos.
      oracleStep(g);
      g.update(RACING_DT);
      if (g.over) break;
      // Los obstáculos recién spawneados siguen arriba de todo (y ≈ -OBST_H).
      const news = g.obstacles.filter((o) => o.y <= -RACING_CONST.OBST_H + 20);
      const isRow = news.length > 0;
      if (isRow && !sawRowLastTick) {
        const solidLanes = new Set(news.filter((o) => !o.jumpable).map((o) => o.lane));
        assert.ok(
          solidLanes.size < RACING_CONST.LANES,
          `seed ${seed} t=${t}: fila con los ${RACING_CONST.LANES} carriles sólidos (sin salida)`,
        );
        // Una fila de 3 solo existe cuando el "escape" es una valla (pared-salto):
        // el spawn de pared normal pone 2 obstáculos y deja el carril libre vacío.
        const isWallJump = news.length === RACING_CONST.LANES;
        if (news.length >= RACING_CONST.LANES - 1) {
          assert.ok(
            !(prevWallWasJump && isWallJump),
            `seed ${seed} t=${t}: dos paredes-salto consecutivas`,
          );
          prevWallWasJump = isWallJump;
        } else {
          prevWallWasJump = false;
        }
      }
      sawRowLastTick = isRow;
    }
  }
});

test("racing v2: un oráculo simple sobrevive un mínimo razonable en todas las semillas", () => {
  const survivals: number[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const g = new RacingEngine(seed);
    let t = 0;
    for (; t < 3600 && !g.over; t++) {
      oracleStep(g);
      g.update(RACING_DT);
    }
    survivals.push(t);
  }
  const min = Math.min(...survivals);
  const sorted = [...survivals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  // Un generador imposible mata al oráculo en < 5 s. Pisos generosos anti-flaky.
  assert.ok(min >= 15 * 60, `mínimo de supervivencia muy bajo: ${(min / 60).toFixed(1)} s`);
  assert.ok(median >= 45 * 60, `mediana de supervivencia muy baja: ${(median / 60).toFixed(1)} s`);
});
