"use client";

// Sistema de idiomas (i18n). Idioma por defecto: ingles.
// Soporta EN / ES / HI / FR, con autodeteccion por navegador y selector manual.
// El diccionario y la logica pura de traduccion viven en ./i18n-dict (no-cliente).

import { createContext, useContext, useEffect, useState } from "react";
import { LANGS, type Lang, LANG_LABELS, translate } from "./i18n-dict";

export { LANGS, LANG_LABELS };
export type { Lang };

interface I18nState {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nState | null>(null);

function detect(): Lang {
  if (typeof window === "undefined") return "en";
  const saved = localStorage.getItem("arcade.lang") as Lang | null;
  if (saved && LANGS.includes(saved)) return saved;
  const nav = navigator.language.slice(0, 2).toLowerCase() as Lang;
  return LANGS.includes(nav) ? nav : "en";
}

export function I18nProvider({
  initialLang = "en",
  children,
}: {
  initialLang?: Lang;
  children: React.ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    // Si el servidor ya fijó un idioma válido distinto del default, respetarlo.
    // Solo autodetectar cuando no hubo elección previa (sin cookie/localStorage).
    if (initialLang !== "en") {
      document.documentElement.lang = initialLang;
      return;
    }
    const d = detect();
    setLangState(d);
    document.documentElement.lang = d;
  }, [initialLang]);

  function setLang(l: Lang) {
    setLangState(l);
    localStorage.setItem("arcade.lang", l);
    document.cookie = `arcade.lang=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
  }

  function t(key: string, vars?: Record<string, string | number>) {
    return translate(lang, key, vars);
  }

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT debe usarse dentro de <I18nProvider>");
  return ctx;
}
