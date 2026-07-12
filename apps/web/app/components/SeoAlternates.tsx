import { headers } from "next/headers";
import { SITE } from "@/app/lib/seo";
import { LANGS } from "@/app/lib/i18n-dict";
import { localePath, stripLocale } from "@/app/lib/localePath";

/** Emite canonical (a la propia URL por idioma) + hreflang de los 4 idiomas y
 *  x-default (inglés), desde el `x-bare-path` que setea el portero. Centraliza lo
 *  que antes hacían canonicals dispersos (varias páginas apuntaban a la home). */
export async function SeoAlternates() {
  const h = await headers();
  const bare = stripLocale(h.get("x-bare-path") ?? "/");
  const lang = (h.get("x-lang") as (typeof LANGS)[number]) ?? "en";
  const abs = (p: string) => `${SITE.url}${p === "/" ? "" : p}`;
  return (
    <>
      <link rel="canonical" href={abs(localePath(lang, bare))} />
      <link rel="alternate" hrefLang="x-default" href={abs(bare)} />
      {LANGS.map((l) => (
        <link key={l} rel="alternate" hrefLang={l} href={abs(localePath(l, bare))} />
      ))}
    </>
  );
}
