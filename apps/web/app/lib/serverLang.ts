import { cookies, headers } from "next/headers";
import { LANGS, type Lang } from "./i18n-dict";

const isLang = (v: string | undefined | null): v is Lang =>
  !!v && (LANGS as readonly string[]).includes(v);

/** Idioma para render de servidor: cookie → Accept-Language → "en". */
export async function getLang(): Promise<Lang> {
  const cookieLang = (await cookies()).get("arcade.lang")?.value;
  if (isLang(cookieLang)) return cookieLang;

  const accept = (await headers()).get("accept-language") ?? "";
  const first = accept.split(",")[0]?.trim().slice(0, 2).toLowerCase();
  if (isLang(first)) return first;

  return "en";
}
