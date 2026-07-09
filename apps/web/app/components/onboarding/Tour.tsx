"use client";

// TOUR de primera visita (sin librerías): oscurece la pantalla y va
// iluminando, paso a paso, el embudo del sitio — jugá gratis, creá tu agente,
// miralo competir. Se muestra una sola vez (flag en localStorage) y se puede
// relanzar desde el footer con /?tour=1.

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/app/lib/i18n";

const DONE_KEY = "arcade.tour.done";

interface StepDef {
  /** Elemento a iluminar: [data-tour=<anchor>]. Sin anchor: tarjeta centrada. */
  anchor?: string;
  titleKey: string;
  bodyKey: string;
}

const STEPS: StepDef[] = [
  { titleKey: "tour.hi.t", bodyKey: "tour.hi.b" },
  { anchor: "free", titleKey: "tour.free.t", bodyKey: "tour.free.b" },
  { anchor: "build", titleKey: "tour.build.t", bodyKey: "tour.build.b" },
  { anchor: "watch", titleKey: "tour.watch.t", bodyKey: "tour.watch.b" },
  { titleKey: "tour.elo.t", bodyKey: "tour.elo.b" },
];

export function Tour() {
  const { t } = useT();
  const router = useRouter();
  const search = useSearchParams();
  const [step, setStep] = useState(-1); // -1 = apagado
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Arranque: primera visita, o relanzado explícito con ?tour=1.
  useEffect(() => {
    const forced = search.get("tour") === "1";
    const done = typeof window !== "undefined" && localStorage.getItem(DONE_KEY);
    if (forced || !done) {
      const tm = setTimeout(() => setStep(0), 800);
      return () => clearTimeout(tm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Medir el elemento del paso actual (y seguirlo si la ventana cambia).
  useEffect(() => {
    if (step < 0) return;
    const anchor = STEPS[step]?.anchor;
    if (!anchor) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${anchor}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const measure = () => setRect(el.getBoundingClientRect());
    // Esperar a que termine el scroll suave antes de medir.
    const tm = setTimeout(measure, 450);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      clearTimeout(tm);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [step]);

  if (step < 0 || step >= STEPS.length) return null;
  const def = STEPS[step];
  const last = step === STEPS.length - 1;

  function finish() {
    localStorage.setItem(DONE_KEY, "1");
    setStep(-1);
    // Limpiar ?tour=1 de la URL para que un reload no lo relance.
    if (search.get("tour")) router.replace("/");
  }

  // Posición de la tarjeta: debajo del elemento iluminado (o centrada).
  const cardStyle: React.CSSProperties =
    rect && def.anchor
      ? rect.bottom + 190 < window.innerHeight
        ? { top: rect.bottom + 12, left: "50%", transform: "translateX(-50%)" }
        : { top: Math.max(12, rect.top - 200), left: "50%", transform: "translateX(-50%)" }
      : { top: "50%", left: "50%", transform: "translate(-50%,-50%)" };

  return (
    <div className="fixed inset-0 z-50">
      {/* Spotlight: el agujero se hace con un box-shadow gigante. */}
      {rect && def.anchor ? (
        <div
          className="pointer-events-none absolute rounded-xl border-2 border-(--color-accent) transition-all duration-300"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(5,2,16,0.82)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-[rgba(5,2,16,0.82)]" />
      )}

      <div className="win fixed w-[min(92vw,360px)]" style={cardStyle}>
        <div className="win-title">
          <span>{t("tour.title")}</span>
          <span className="chip !text-(--color-lime)">
            {step + 1}/{STEPS.length}
          </span>
        </div>
        <div className="p-5">
          <p className="font-pixel text-xs text-(--color-gold)">{t(def.titleKey)}</p>
          <p className="mt-3 text-base leading-relaxed text-(--color-muted-bright)">
            {t(def.bodyKey)}
          </p>
          <div className="mt-5 flex gap-3">
            <button onClick={finish} className="btn3d btn3d--cyan flex-1">
              {t("tour.skip")}
            </button>
            <button
              onClick={() => (last ? finish() : setStep((s) => s + 1))}
              className="btn3d btn3d--magenta flex-1"
            >
              {last ? t("tour.done") : `${t("tour.next")} ▶`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
