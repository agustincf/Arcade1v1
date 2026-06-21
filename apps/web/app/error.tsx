"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto mt-10 max-w-md">
      <div className="win">
        <div className="win-title">
          <span>ERROR.SYS</span>
          <span className="win-dots">
            <span className="win-dot" />
          </span>
        </div>
        <div className="p-6 text-center">
          <div className="text-5xl">💾💥</div>
          <h2 className="font-pixel mt-3 text-sm text-[--color-lose]">
            ALGO SE ROMPIÓ
          </h2>
          <p className="font-screen mt-2 text-lg text-slate-300">
            Tranqui: no se tocó ningún fondo. Probá de nuevo.
          </p>
          <button onClick={reset} className="btn3d btn3d--magenta mt-5">
            REINTENTAR ▶
          </button>
        </div>
      </div>
    </div>
  );
}
