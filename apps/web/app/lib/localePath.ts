import type { Lang } from "./i18n-dict";

const PREFIXED = new Set(["es", "hi", "fr"]);

/** Quita el prefijo de idioma si lo tuviera (para re-prefijar al cambiar). */
export function stripLocale(path: string): string {
  const seg = path.split("/")[1];
  if (PREFIXED.has(seg)) return path.slice(seg.length + 1) || "/";
  return path;
}

/** Prefija un path interno con el idioma activo (inglés = sin prefijo). Deja
 *  intactos los externos, anclas y mailto. Idempotente si ya viene prefijado. */
export function localePath(lang: Lang, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path; // externo/protocolo
  const bare = stripLocale(path);
  if (!PREFIXED.has(lang)) return bare; // inglés: sin prefijo
  return `/${lang}${bare === "/" ? "" : bare}`;
}
