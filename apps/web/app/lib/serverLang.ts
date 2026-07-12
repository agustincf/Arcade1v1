import { cookies, headers } from "next/headers";
import { LANGS, type Lang } from "./i18n-dict";

const isLang = (v: string | undefined | null): v is Lang =>
  !!v && (LANGS as readonly string[]).includes(v);

/** Idioma para render de servidor: header x-lang (lo pone el portero según el
 *  prefijo de la URL) → cookie → Accept-Language → "en". */
export async function getLang(): Promise<Lang> {
  const h = await headers();
  const fromMiddleware = h.get("x-lang");
  if (isLang(fromMiddleware)) return fromMiddleware;

  const cookieLang = (await cookies()).get("arcade.lang")?.value;
  if (isLang(cookieLang)) return cookieLang;

  const accept = h.get("accept-language") ?? "";
  const first = accept.split(",")[0]?.trim().slice(0, 2).toLowerCase();
  if (isLang(first)) return first;

  return "en";
}
