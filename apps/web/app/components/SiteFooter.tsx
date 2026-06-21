"use client";

import { useT } from "@/app/lib/i18n";

export function SiteFooter() {
  const { t } = useT();
  return (
    <footer className="mx-auto max-w-5xl px-4 py-10 text-center">
      <p className="font-screen text-lg text-[--color-accent-2]">
        {t("footer.best")}
      </p>
      <p className="font-screen text-base text-slate-400">
        {t("footer.demo")} <span className="blink text-[--color-gold]">● REC</span>
      </p>
    </footer>
  );
}
