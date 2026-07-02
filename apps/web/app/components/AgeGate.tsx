"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/app/lib/i18n";

// Confirmación de edad + aceptación de términos, una sola vez (localStorage).
// Estándar para plataformas de skill-gaming. No bloquea a los crawlers (se
// renderiza recién en el cliente).
export function AgeGate() {
  const { t } = useT();
  const [accepted, setAccepted] = useState(true); // true en SSR/1er paint: no parpadea

  useEffect(() => {
    setAccepted(localStorage.getItem("arcade.agegate") === "ok");
  }, []);

  if (accepted) return null;

  function accept() {
    localStorage.setItem("arcade.agegate", "ok");
    setAccepted(true);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4">
      <div className="win w-full max-w-md">
        <div className="win-title">
          <span>{t("age.title")}</span>
        </div>
        <div className="p-6 text-center">
          <div className="text-5xl">🔞</div>
          <p className="mt-4 text-lg leading-relaxed text-[--color-muted-bright]">
            {t("age.body")}
          </p>
          <p className="mt-3 text-base leading-relaxed text-[--color-muted-2]">
            {t("age.terms")}{" "}
            <Link href="/terms" className="text-[--color-accent-2] underline underline-offset-2">
              {t("age.termsLink")}
            </Link>
            .
          </p>
          <button onClick={accept} className="btn3d btn3d--magenta mt-5 w-full">
            {t("age.accept")}
          </button>
          <a
            href="https://www.google.com"
            className="mt-3 block text-base text-[--color-muted-3] underline"
          >
            {t("age.leave")}
          </a>
        </div>
      </div>
    </div>
  );
}
