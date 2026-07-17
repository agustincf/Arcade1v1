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

const CAR_Y = RACING_CONST.HEIGHT - 80;
const SEEDS = 200;

// Calibración (ver task-3-report.md para la evidencia completa): el oráculo
// del plan original (lookahead=240, jumpTrigger=120, sin volver al centro)
// moría en ~3.4s en varias semillas. No fue un problema de un solo umbral:
// eran dos fallas independientes en la ESTRATEGIA, no solo en sus constantes.
//   1. Ventana de salto real: en el aire dura JUMP_TICKS (30 ticks) y a
//      velocidad baja (nivel 0) una valla se queda ~30 ticks en la banda de
//      colisión (|o.y-CAR_Y| < 47px) — el margen útil es de apenas ~5 ticks
//      (~16px) antes del choque. jumpTrigger=120 saltaba muy temprano y
//      aterrizaba con la valla todavía encima. REACT=70/JUMP_TRIGGER=60
//      caen dentro de esa ventana angosta (verificado con barrido empírico).
//   2. Un solo lookahead=240 servía para dos preguntas distintas: "¿empiezo a
//      reaccionar?" (quiere ver lejos) y "¿este carril vecino es un destino
//      seguro AHORA?" (quiere ver cerca). Con 240 para ambas, dos filas dobles
//      consecutivas (separadas ~69 ticks, un intervalo de spawn) con escapes
//      en carriles opuestos "se pisaban" en la ventana ancha aunque sus
//      peligros reales nunca se solaparan en el tiempo — el oráculo terminaba
//      esquivando hacia un carril con una valla ya encima (muerte instantánea,
//      saltar y moverse no son la misma acción en el mismo tick) o rebotando
//      sin avanzar. Cambiar de carril es INSTANTÁNEO (a diferencia del salto,
//      no tiene cooldown), así que no hace falta ver lejos para esquivar: una
//      sola distancia angosta (REACT), reusada para las tres preguntas
//      (reaccionar, elegir destino, volver al centro), alcanza.
//   3. El oráculo era puramente reactivo: nunca volvía al carril central
//      cuando no había nada cerca. Con dos filas dobles de escapes opuestos
//      separadas por un solo intervalo de spawn, esa pasividad podía dejarlo
//      sin forma de cruzar a tiempo. Volver al centro en cuanto está despejado
//      (regla mínima, la aplicaría cualquier jugador razonable) lo resuelve.
// Verificado: con estos parámetros, 0 muertes en 1000 semillas (no solo las
// 200 de este test) hasta el techo de 3600 ticks — no es un umbral al límite.
const REACT = 70; // "¿este carril es peligroso?" — una sola distancia para reaccionar, elegir destino y volver al centro.
const JUMP_TRIGGER = 60; // dispara el salto dentro de la ventana real (ver arriba), no a 120px como el plan original.

/** Un paso del oráculo: decide a lo sumo una acción (mover o saltar) con visión
 * perfecta de `g.obstacles`. Compartido por los dos tests: el primero lo usa
 * para que el auto sobreviva lo bastante como para que el escaneo de filas
 * alcance a ver paredes-salto (solo aparecen desde el nivel 2, ~16s) — un
 * auto quieto muere en la primera fila (~3-4 filas, siempre nivel 0) y esa
 * mitad del invariante nunca se ejercita (confirmado con mutation testing,
 * ver reporte). El segundo lo usa como oráculo de supervivencia en sí mismo. */
function oracleStep(g: RacingEngine): void {
  const near = (lane: number, solidOnly: boolean) =>
    g.obstacles.some(
      (o) =>
        o.lane === lane &&
        (!solidOnly || !o.jumpable) &&
        o.y > CAR_Y - REACT &&
        o.y < CAR_Y + RACING_CONST.CAR_H,
    );
  if (!g.airborne && near(g.carLane, false)) {
    const options = [g.carLane - 1, g.carLane + 1].filter(
      (l) => l >= 0 && l < RACING_CONST.LANES && !near(l, false),
    );
    if (options.length > 0) {
      if (options[0] < g.carLane) g.moveLeft();
      else g.moveRight();
    } else {
      // Sin carril limpio: si lo que viene en el mío es valla, saltar a tiempo.
      const threat = g.obstacles
        .filter((o) => o.lane === g.carLane && o.y < CAR_Y && o.y > CAR_Y - REACT)
        .sort((a, b) => b.y - a.y)[0];
      if (threat?.jumpable && CAR_Y - threat.y < JUMP_TRIGGER) g.jump();
      else {
        // Valla en un vecino es mejor que sólido en el mío — pero solo si
        // todavía da tiempo de saltarla en un tick futuro. Si ya está a
        // menos de JUMP_TRIGGER, mudarse ahí SIN saltar mata igual que un
        // sólido (moverse y saltar no son la misma acción en el mismo tick).
        const jumpableSide = [g.carLane - 1, g.carLane + 1].filter((l) => {
          if (l < 0 || l >= RACING_CONST.LANES || near(l, true)) return false;
          const tooLate = g.obstacles.some(
            (o) => o.lane === l && o.jumpable && o.y < CAR_Y && CAR_Y - o.y <= JUMP_TRIGGER,
          );
          return !tooLate;
        });
        if (jumpableSide.length > 0) {
          if (jumpableSide[0] < g.carLane) g.moveLeft();
          else g.moveRight();
        }
      }
    }
  } else if (!g.airborne && !near(g.carLane, false)) {
    // Nada amenaza ahora mismo: volver al carril central para tener ambas
    // salidas a un solo paso la próxima vez que haga falta.
    const center = Math.floor(RACING_CONST.LANES / 2);
    if (g.carLane !== center) {
      const step = g.carLane < center ? g.carLane + 1 : g.carLane - 1;
      if (!near(step, false)) {
        if (g.carLane < center) g.moveRight();
        else g.moveLeft();
      }
    }
  }
}

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
