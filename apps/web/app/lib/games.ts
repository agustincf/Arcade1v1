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
    id: "chess",
    name: "Ajedrez",
    tagline: "Clasico 1v1",
    description: "Partida de ajedrez con todas las reglas. Gana el que da jaque mate.",
    emoji: "♟️",
    status: "live",
  },
  {
    id: "flappy",
    name: "Flappy 1v1",
    tagline: "Reflejos puros",
    description: "Esquiva los tubos. El que hace mas puntaje se lleva el pozo.",
    emoji: "🐤",
    status: "live",
  },
  {
    id: "coming-soon",
    name: "Proximamente",
    tagline: "Mas juegos en camino",
    description: "El sistema es modular: agregar juegos nuevos es facil.",
    emoji: "✨",
    status: "soon",
  },
];

export function getGame(id: string): GameInfo | undefined {
  return GAMES.find((g) => g.id === id);
}
