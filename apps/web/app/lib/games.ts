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

export const GAMES: GameInfo[] = [
  {
    id: "tetris",
    name: "Tetris",
    tagline: "El rey del puntaje",
    description: "Apila, hace lineas y revienta el tablero. Mas puntaje que tu rival = te llevas el pozo.",
    emoji: "🟦",
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
    id: "racing",
    name: "Carrera",
    tagline: "Pisa a fondo",
    description: "Manejas, esquivas y acelera sin parar. El ultimo en chocar gana la apuesta.",
    emoji: "🏎️",
    status: "live",
  },
  {
    id: "coming-soon",
    name: "Proximamente",
    tagline: "Se viene mas accion",
    description: "Nuevos duelos en camino. Quedate cerca: el que avisa no traiciona.",
    emoji: "✨",
    status: "soon",
  },
];

export function getGame(id: string): GameInfo | undefined {
  return GAMES.find((g) => g.id === id);
}
