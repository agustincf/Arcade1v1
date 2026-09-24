import "server-only";
import type { Dict, Lang } from "../i18n-dict";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";

// Los 3 diccionarios viven acá, SOLO en el servidor. El cliente recibe el del
// idioma activo por prop (no importa este módulo), así su bundle no los trae.
const DICTS: Record<Lang, Dict> = { en, es, fr };

export function getDict(lang: Lang): Dict {
  return DICTS[lang];
}
