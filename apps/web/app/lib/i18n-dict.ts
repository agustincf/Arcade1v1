// Contrato de idiomas + traducción pura. Los DATOS de cada idioma viven en
// ./i18n/<lang>.ts y los junta el servidor en dicts.server.ts. El cliente recibe
// solo el diccionario activo por prop, así su bundle no arrastra los 4 idiomas.

export const LANGS = ["en", "es", "hi", "fr"] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_LABELS: Record<Lang, string> = {
  en: "EN",
  es: "ES",
  hi: "हि",
  fr: "FR",
};

export type Dict = Record<string, string>;

/** Traducción pura: toma el diccionario del idioma activo y una clave. Devuelve
 *  la clave cruda si no existe (los 4 idiomas se mantienen completos por test).
 *  Interpola {vars}. */
export function translate(dict: Dict, key: string, vars?: Record<string, string | number>): string {
  let s = dict[key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(vars[k]));
    }
  }
  return s;
}
