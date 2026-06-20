"use client";

// Piezas visuales COMPARTIDAS por todos los juegos, para que tengan el mismo
// lenguaje: misma caja de overlay, mismos botones, misma pantalla de fin.

export function GameOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 p-4 text-center">
      {children}
    </div>
  );
}

export function StartScreen({
  emoji,
  title,
  instructions,
  onStart,
}: {
  emoji: string;
  title: string;
  instructions: string;
  onStart: () => void;
}) {
  return (
    <GameOverlay>
      <div className="text-5xl">{emoji}</div>
      <h3 className="font-pixel mt-2 text-sm text-[--color-gold] neon">{title}</h3>
      <p className="font-screen mt-2 max-w-[240px] text-lg text-slate-100">
        {instructions}
      </p>
      <button onClick={onStart} className="btn3d btn3d--magenta mt-4">
        EMPEZAR ▶
      </button>
    </GameOverlay>
  );
}

export function GameOverScreen({
  headline,
  score,
  onConfirm,
}: {
  headline: string;
  score: number;
  onConfirm: () => void;
}) {
  return (
    <GameOverlay>
      <h3 className="font-pixel text-base text-[--color-lose]">{headline}</h3>
      <p className="font-screen mt-3 text-lg text-slate-200">Tu puntaje</p>
      <p className="font-pixel text-3xl text-[--color-accent-2] neon-cyan">{score}</p>
      <button onClick={onConfirm} className="btn3d btn3d--magenta mt-4">
        CONFIRMAR ▶
      </button>
    </GameOverlay>
  );
}
