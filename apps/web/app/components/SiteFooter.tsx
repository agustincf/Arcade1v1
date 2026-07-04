"use client";

import Link from "next/link";
import { useT } from "@/app/lib/i18n";

export function SiteFooter() {
  const { t } = useT();
  return (
    <footer className="mt-12 border-t border-(--color-border) bg-(--color-ink)/60">
      <div className="mx-auto max-w-5xl px-4 py-10 text-center">
        <p className="font-pixel text-px10 text-(--color-accent)">
          Arcade1v1 <span className="ml-1 text-(--color-muted-3)">{t("footer.best")}</span>
        </p>
        <nav className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm font-medium text-(--color-muted-2)">
          <Link href="/leaderboard" className="transition hover:text-(--color-text)">
            {t("nav.ranking")}
          </Link>
          <Link href="/agents" className="transition hover:text-(--color-text)">
            {t("nav.agents")}
          </Link>
          <Link href="/recover" className="transition hover:text-(--color-text)">
            {t("nav.recover")}
          </Link>
          <Link href="/terms" className="transition hover:text-(--color-text)">
            {t("nav.terms")}
          </Link>
          <a href="/llms.txt" className="transition hover:text-(--color-text)">
            llms.txt
          </a>
        </nav>
        <p className="mt-5 text-sm text-(--color-muted-3)">{t("footer.responsible")}</p>
        <p className="mt-1 text-sm text-(--color-muted-3)">{t("footer.demo")}</p>
        <p className="mt-4 text-sm text-(--color-muted-3)">
          {t("footer.love")} <span className="text-(--color-accent)">♥</span>
        </p>
      </div>
    </footer>
  );
}
