/**
 * game-sdk: las "reglas de conexion" que TODO juego del arcade debe cumplir.
 *
 * Pensalo como la forma del cartucho: si tu juego encaja en estas formas,
 * la consola (frontend + backend + escrow) lo sabe usar sin cambios.
 *
 * En la Fase 0 esto es solo el "contrato" (las formas). La logica real de
 * cada juego se completa en sus fases (Ajedrez = Fase 2, Flappy = Fase 3).
 */

/** Resultado posible de una partida. */
export type MatchOutcome =
  | { kind: "winner"; winner: PlayerId } // gano un jugador
  | { kind: "draw" } //                    empate (en ajedrez: tablas)
  | { kind: "cancelled"; reason: string }; // se cancelo / falto alguien

export type PlayerId = "player1" | "player2";

/** Identidad de un juego dentro del arcade. */
export interface GameMeta {
  /** id unico y estable, ej: "chess" o "flappy". */
  id: string;
  /** nombre lindo para mostrar, ej: "Ajedrez". */
  name: string;
  /** descripcion corta para la card del home. */
  description: string;
  /** siempre 2 por ahora (1v1), pero queda explicito. */
  players: 2;
}

/**
 * La parte del juego que corre en el SERVIDOR (la "autoridad").
 * El servidor es quien decide la verdad: valida jugadas y dicta el resultado.
 * Asi un jugador no puede hacer trampa desde su navegador.
 */
export interface GameServerModule<State = unknown, Move = unknown> {
  meta: GameMeta;
  /** crea el estado inicial de una partida nueva. */
  createInitialState(): State;
  /** aplica una jugada de un jugador y devuelve el nuevo estado (o un error). */
  applyMove(
    state: State,
    player: PlayerId,
    move: Move,
  ): { ok: true; state: State } | { ok: false; error: string };
  /** mira el estado y dice si la partida termino y como. */
  getOutcome(state: State): MatchOutcome | null;
}

/**
 * La parte del juego que corre en el NAVEGADOR (lo que ve el jugador).
 * En la Fase 1 esto sera un componente de React. Se define mas adelante
 * para no atarnos todavia a una libreria concreta.
 */
export interface GameClientModule {
  meta: GameMeta;
  // render(...) y demas se definen en la Fase 1/2/3.
}
