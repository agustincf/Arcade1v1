/**
 * game-sdk: las "reglas de conexion" que TODO juego del arcade debe cumplir.
 *
 * Pensalo como la forma del cartucho: si tu juego encaja en estas formas,
 * la consola (frontend + backend + escrow) lo sabe usar sin cambios.
 *
 * MODELO DE JUEGO (regla general del arcade):
 *   - Todos los juegos son ASINCRONICOS y POR PUNTAJE.
 *   - Cada jugador juega su propio intento ("run") cuando quiere, dentro de
 *     una ventana de tiempo (ej: 1 hora desde que se emparejan).
 *   - Gana el que hace MAS PUNTOS. Empate -> reembolso a ambos.
 *   - Si un jugador no juega su intento a tiempo -> reembolso a ambos.
 */

export type PlayerId = "player1" | "player2";

/** Resultado posible de una partida. */
export type MatchOutcome =
  | { kind: "winner"; winner: PlayerId } // gano el de mayor puntaje
  | { kind: "draw" } //                    empate de puntaje -> reembolso
  | { kind: "cancelled"; reason: string }; // se cancelo / falto un jugador

/** Identidad de un juego dentro del arcade. */
export interface GameMeta {
  /** id unico y estable, ej: "tetris" o "flappy". */
  id: string;
  /** nombre lindo para mostrar, ej: "Tetris". */
  name: string;
  /** descripcion corta para la card del home. */
  description: string;
  /** como se llama el puntaje en este juego, ej: "puntos", "lineas". */
  scoreUnit: string;
  /** siempre 2 por ahora (1v1), pero queda explicito. */
  players: 2;
}

/**
 * Un "intento" (run) de un jugador: su puntaje + la informacion necesaria
 * para que el SERVIDOR pueda re-verificarlo y evitar trampa.
 */
export interface GameRun {
  /** puntaje final que dice el jugador haber hecho. */
  score: number;
  /**
   * "replay": semilla + registro de jugadas/eventos del intento.
   * El servidor lo re-juega para confirmar que el puntaje es real.
   * Cada juego define su forma concreta.
   */
  replay: unknown;
}

/**
 * La parte del juego que corre en el SERVIDOR (la "autoridad").
 * En async, el servidor re-verifica cada intento para que un jugador no pueda
 * inventar su puntaje desde el navegador, y luego decide quien gano.
 */
export interface GameServerModule {
  meta: GameMeta;
  /** Re-juega el replay y confirma el puntaje real (anti-trampa). */
  verifyRun(
    run: GameRun,
  ): { ok: true; score: number } | { ok: false; error: string };
  /** Compara dos puntajes ya verificados y dicta el resultado. */
  decide(scoreP1: number, scoreP2: number): MatchOutcome;
}

/**
 * La parte del juego que corre en el NAVEGADOR (lo que ve y juega la persona).
 * Renderiza el juego de UN jugador y, al terminar, entrega un GameRun.
 * El componente concreto (React) lo define cada juego en su fase.
 */
export interface GameClientModule {
  meta: GameMeta;
  // render(...) que termina llamando onFinish(run: GameRun) — se define por juego.
}
