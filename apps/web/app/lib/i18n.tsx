"use client";

// Provider de idioma. El diccionario del idioma ACTIVO llega por prop desde el
// servidor (layout → Providers); el cliente no importa datos de idioma. Cambiar
// idioma setea la cookie y refresca: el servidor re-renderiza con el nuevo
// idioma y manda su diccionario (sin traer los 4 al cliente).

import { createContext, useContext, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LANGS, type Lang, LANG_LABELS, type Dict, translate } from "./i18n-dict";

export { LANGS, LANG_LABELS };
export type { Lang };

interface I18nState {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nState | null>(null);

export function I18nProvider({
  lang,
  dict,
  children,
}: {
  lang: Lang;
  dict: Dict;
  children: React.ReactNode;
}) {
  const router = useRouter();

  useEffect(() => {
    document.documentElement.lang = lang;
    // Honrar una elección previa si el servidor no la tomó (p. ej. cookie vencida
    // pero localStorage vivo): setear cookie y refrescar. Caso normal: no-op.
    const saved = localStorage.getItem("arcade.lang");
    if (saved && (LANGS as readonly string[]).includes(saved) && saved !== lang) {
      document.cookie = `arcade.lang=${saved}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    }
  }, [lang, router]);

  function setLang(l: Lang) {
    localStorage.setItem("arcade.lang", l);
    document.cookie = `arcade.lang=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
    router.refresh(); // el servidor re-renderiza en el nuevo idioma y manda su diccionario
  }

  function t(key: string, vars?: Record<string, string | number>) {
    return translate(dict, key, vars);
  }

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT debe usarse dentro de <I18nProvider>");
  return ctx;
}
