"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useT } from "@/app/lib/i18n";

// Piezas visuales COMPARTIDAS por todos los juegos, para que tengan el mismo
// lenguaje: misma caja de overlay, mismos botones, misma pantalla de fin.

const ARROW_DIR: Record<string, "up" | "down" | "left" | "right"> = {
  "▲": "up",
  "▼": "down",
  "◀": "left",
  "▶": "right",
};

// Los glifos de triángulo (▲◀▼▶) no rinden parejos en la fuente pixel del
// sitio: ▲▼ salían visiblemente más grandes y gruesos que ◀▶ en el mismo
// D-pad. Se dibuja el triángulo con CSS (bordes) para que las 4 direcciones
// midan exactamente lo mismo sin depender del glifo de ninguna fuente.
export function Arrow({ glyph }: { glyph: string }) {
  const dir = ARROW_DIR[glyph];
  if (!dir) return <span aria-hidden="true">{glyph}</span>;
  const cross = "7px solid transparent";
  const point = "11px solid currentColor";
  const style: React.CSSProperties =
    dir === "up"
      ? { borderLeft: cross, borderRight: cross, borderBottom: point }
      : dir === "down"
        ? { borderLeft: cross, borderRight: cross, borderTop: point }
        : dir === "left"
          ? { borderTop: cross, borderBottom: cross, borderRight: point }
          : { borderTop: cross, borderBottom: cross, borderLeft: point };
  return <span aria-hidden="true" className="inline-block h-0 w-0" style={style} />;
}

export function GameOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-(--color-scrim) p-4 text-center">
      {children}
    </div>
  );
}

export function StartScreen({
  icon,
  title,
  instructions,
  onStart,
}: {
  icon: React.ReactNode;
  title: string;
  instructions: string;
  onStart: () => void;
}) {
  const { t } = useT();
  // Las instrucciones dicen "espacio para aletear/mover": si el jugador toca
  // una tecla acá y no pasa nada, parece roto. Espacio o Enter también arrancan.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStart]);
  return (
    <GameOverlay>
      <div>{icon}</div>
      <h3 className="font-pixel mt-2 text-sm text-(--color-gold)">{title}</h3>
      <p className="mt-2 max-w-[260px] text-sm leading-relaxed text-(--color-text)">
        {instructions}
      </p>
      <button onClick={onStart} className="btn3d btn3d--magenta mt-4">
        {t("g.start")}
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
  const { t } = useT();
  // En modo práctica (?free=1) no se envía nada a ningún lado: decir "ENVIAR
  // PUNTAJE" ahí es mentir. Los juegos solo viven en la página de partida,
  // así que el modo se lee de la URL en este único lugar.
  const free = useSearchParams().get("free") === "1";
  return (
    <GameOverlay>
      <h3 className="font-pixel text-base text-(--color-lose)">{headline}</h3>
      <p className="mt-3 text-base text-(--color-muted-bright)">{t("g.yourScore")}</p>
      <p className="font-pixel mt-1 text-3xl text-(--color-accent-2)">{score}</p>
      <button onClick={onConfirm} className="btn3d btn3d--magenta mt-4">
        {t(free ? "g.confirmFree" : "g.confirm")}
      </button>
    </GameOverlay>
  );
}
