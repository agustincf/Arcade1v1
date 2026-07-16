// Registro de juegos disponibles en el arcade.
// Agregar un juego nuevo en el futuro = sumar una entrada aca (y su modulo).

export interface GameInfo {
  id: string;
  name: string;
  /** "live" = jugable; "soon" = proximamente (muestra el diseño modular). */
  status: "live" | "soon";
}

// Orden de exhibicion: Space Invaders (la perla) primero.
export const GAMES: GameInfo[] = [
  {
    id: "invaders",
    name: "Space Invaders",
    status: "live",
  },
  {
    id: "flappy",
    name: "Flappy 1v1",
    status: "live",
  },
  {
    id: "2048",
    name: "2048",
    status: "live",
  },
  {
    id: "snake",
    name: "Snake",
    status: "live",
  },
  {
    id: "tetris",
    name: "Tetris",
    status: "live",
  },
  {
    // Nombre canónico en inglés como el resto (el display por idioma sale del
    // i18n: game.racing.name = Carrera/Course/रेसिंग). Este `name` se usa en
    // contextos sin idioma, p. ej. el schema.org del layout.
    id: "racing",
    name: "Racing",
    status: "live",
  },
];

export function getGame(id: string): GameInfo | undefined {
  return GAMES.find((g) => g.id === id);
}
