"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/app/lib/i18n";

// Dirección de propinas (BTC, on-chain nativo). Va como constante para copiarla
// SIEMPRE exacta: transcribir a mano una bech32 de 42 chars es un desastre y un
// solo carácter mal = fondos perdidos.
const BTC_TIP_ADDRESS = "bc1qfhu02cny3fakla8tgw2dlujvjwk6h3r3wt88jv";

export function SiteFooter() {
  const { t } = useT();
  return (
    <footer className="mt-12 border-t border-(--color-border) bg-(--color-ink)/60">
      <div className="mx-auto max-w-5xl px-4 py-10 text-center">
        <p className="font-pixel text-px10 text-(--color-accent)">
          Arcade1v1 <span className="ml-1 text-(--color-muted-3)">{t("footer.best")}</span>
        </p>
        <nav className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm font-medium text-(--color-muted-2)">
          <Link href="/build" className="transition hover:text-(--color-text)">
            {t("nav.build")}
          </Link>
          <Link href="/my-agents" className="transition hover:text-(--color-text)">
            {t("nav.myagents")}
          </Link>
          <Link href="/watch" className="transition hover:text-(--color-text)">
            {t("nav.watch")}
          </Link>
          <Link href="/leaderboard" className="transition hover:text-(--color-text)">
            {t("nav.ranking")}
          </Link>
          <Link href="/agents" className="transition hover:text-(--color-text)">
            {t("nav.agents")}
          </Link>
          <Link href="/agents/start" className="transition hover:text-(--color-text)">
            {t("nav.firstAgent")}
          </Link>
          <Link href="/recover" className="transition hover:text-(--color-text)">
            {t("nav.recover")}
          </Link>
          <Link href="/terms" className="transition hover:text-(--color-text)">
            {t("nav.terms")}
          </Link>
          <a
            href="https://github.com/agustincf/Arcade1v1/blob/main/CHANGELOG.md"
            target="_blank"
            rel="noopener noreferrer"
            className="transition hover:text-(--color-text)"
          >
            {t("nav.changelog")}
          </a>
          <a href="/llms.txt" className="transition hover:text-(--color-text)">
            llms.txt
          </a>
          {/* Relanzar el tour de bienvenida (?tour=1 lo fuerza en la landing) */}
          <Link href="/?tour=1" className="transition hover:text-(--color-text)">
            {t("nav.tour")}
          </Link>
        </nav>
        <p className="mt-5 text-sm text-(--color-muted-3)">{t("footer.responsible")}</p>
        <p className="mt-1 text-sm text-(--color-muted-3)">{t("footer.demo")}</p>
        <p className="mt-4 text-sm text-(--color-muted-3)">
          {t("footer.love")} <span className="text-(--color-accent)">♥</span>
        </p>
        <BtcTip />
      </div>
    </footer>
  );
}

/** Propina en BTC: la dirección es un botón que la copia al portapapeles
 *  (con feedback), para que nadie tenga que transcribirla a mano. */
function BtcTip() {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(BTC_TIP_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* algunos navegadores bloquean el portapapeles: el texto sigue visible para copiar a mano */
    }
  }

  return (
    <div className="mt-3 flex flex-col items-center gap-1.5">
      <span className="text-px10 text-(--color-muted-3)">{t("footer.tip")}</span>
      <button
        onClick={copy}
        aria-label={t("footer.tip")}
        className="inline-flex max-w-full items-center gap-2 rounded border border-(--color-border) bg-(--color-surface-2) px-2.5 py-1 font-mono text-xs text-(--color-muted-2) transition hover:text-(--color-text)"
      >
        <span className="break-all">{BTC_TIP_ADDRESS}</span>
        <span className="shrink-0 text-(--color-accent)">{copied ? t("footer.copied") : "⧉"}</span>
      </button>
    </div>
  );
}
