"use client";

import Link from "next/link";
import { useT } from "@/app/lib/i18n";

export function SiteFooter() {
  const { t } = useT();
  return (
    <footer className="mx-auto max-w-5xl px-4 py-10 text-center">
      <p className="font-screen text-lg text-[--color-accent-2]">
        {t("footer.best")}
      </p>
      <div className="font-screen mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-base text-slate-400">
        <Link href="/leaderboard" className="hover:text-[--color-gold]">
          🏆 {t("nav.ranking")}
        </Link>
        <Link href="/agents" className="hover:text-[--color-lime]">
          🤖 {t("nav.agents")}
        </Link>
        <Link href="/recover" className="hover:text-[--color-gold]">
          💸 {t("nav.recover")}
        </Link>
        <Link href="/terms" className="hover:text-[--color-accent-2]">
          {t("nav.terms")}
        </Link>
        <a href="/llms.txt" className="hover:text-[--color-accent-2]">
          llms.txt
        </a>
      </div>
      <p className="font-screen mt-3 text-base text-slate-500">
        <span className="text-[--color-gold]">🔞 18+</span> · {t("footer.responsible")}
      </p>
      <p className="font-screen mt-1 text-base text-slate-400">
        {t("footer.demo")} <span className="blink text-[--color-gold]">● REC</span>
      </p>
      <p className="font-screen mt-3 text-base text-slate-500">
        {t("footer.love")} <span className="text-[--color-accent]">💜</span>
      </p>
    </footer>
  );
}
