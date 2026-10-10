// El ORÁCULO de la Carrera: un conductor con visión perfecta y reglas simples
// que sobrevive en todas las semillas (lo calibró la prueba de equidad,
// racing-fairness.test.ts). Lo comparten esa prueba y las de Carrera en vivo,
// que lo usan para que el auto llegue lejos y se ejerciten todas las filas.

import { RacingEngine, RACING_CONST } from "@arcade1v1/game-sdk/racing";

const CAR_Y = RACING_CONST.HEIGHT - 80;

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
export function oracleStep(g: RacingEngine): void {
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
