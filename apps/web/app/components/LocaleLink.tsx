"use client";

import Link from "next/link";
import { type ComponentProps } from "react";
import { useT } from "@/app/lib/i18n";
import { localePath } from "@/app/lib/localePath";

/** Igual que next/link pero prefija los href internos con el idioma activo.
 *  Swap directo: `import { LocaleLink as Link } from "@/app/components/LocaleLink"`. */
export function LocaleLink({ href, ...rest }: ComponentProps<typeof Link>) {
  const { lang } = useT();
  const h = typeof href === "string" ? localePath(lang, href) : href;
  return <Link href={h} {...rest} />;
}

/** Para router.push imperativo: `const lp = useLocalePath(); router.push(lp("/x"))`. */
export function useLocalePath() {
  const { lang } = useT();
  return (path: string) => localePath(lang, path);
}
