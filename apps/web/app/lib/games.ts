// Registro de juegos disponibles en el arcade.
// Agregar un juego nuevo en el futuro = sumar una entrada aca (y su modulo).

export interface GameInfo {
  id: string;
  name: string;
  tagline: string;
  description: string;
  emoji: string;
  /** "live" = jugable; "soon" = proximamente (muestra el diseño modular). */
  status: "live" | "soon";
}

// Orden de exhibicion: Space Invaders (la perla) primero.
export const GAMES: GameInfo[] = [
  {
    id: "invaders",
    name: "Space Invaders",
    tagline: "Defendé la galaxia",
    description:
      "Destrui oleadas de aliens antes de que te invadan. Mas naves abatidas = mas pozo.",
    emoji: "👾",
    status: "live",
  },
  {
    id: "flappy",
    name: "Flappy 1v1",
    tagline: "Un toque, mil nervios",
    description: "Esquiva los tubos y aguanta mas que el rival. Pulso de acero, bolsillo lleno.",
    emoji: "🐤",
    status: "live",
  },
  {
    id: "2048",
    name: "2048",
    tagline: "Sumá y dominá",
    description:
      "Desliza, combina fichas iguales y hace el numero mas alto. Mas puntaje, te llevas el pozo.",
    emoji: "🔢",
    status: "live",
  },
  {
    id: "snake",
    name: "Snake",
    tagline: "Crecé sin chocar",
    description: "Comé, crecé y no te choques. Cuanto mas largo, mas puntos: el que mas come gana.",
    emoji: "🐍",
    status: "live",
  },
  {
    id: "tetris",
    name: "Tetris",
    tagline: "El rey del puntaje",
    description:
      "Apila, hace lineas y revienta el tablero. Mas puntaje que tu rival = te llevas el pozo.",
    emoji: "🟦",
    status: "live",
  },
  {
    id: "racing",
    name: "Carrera",
    tagline: "Pisa a fondo",
    description: "Manejas, esquivas y acelera sin parar. El ultimo en chocar gana la partida.",
    emoji: "🏎️",
    status: "live",
  },
];

export function getGame(id: string): GameInfo | undefined {
  return GAMES.find((g) => g.id === id);
}
