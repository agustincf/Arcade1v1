"use client";

import { LocaleLink as Link } from "@/app/components/LocaleLink";
import { useState } from "react";
import { useT } from "@/app/lib/i18n";
import { IS_MAINNET } from "@/app/lib/config";

// Dirección de propinas (BTC, on-chain nativo). Va como constante para copiarla
// SIEMPRE exacta: transcribir a mano una bech32 de 42 chars es un desastre y un
// solo carácter mal = fondos perdidos.
const BTC_TIP_ADDRESS = "bc1qfhu02cny3fakla8tgw2dlujvjwk6h3r3wt88jv";

export function SiteFooter() {
  const { t } = useT();
  return (
    <footer className="mt-12 border-t border-(--color-border) bg-(--color-ink)/60">
      <div className="mx-auto max-w-5xl px-4 py-7 text-center">
        <p className="font-pixel text-px10 text-(--color-accent)">
          Arcade1v1 <span className="ml-1 text-(--color-muted-3)">{t("footer.best")}</span>
        </p>
        {/* Un solo nivel de links, podado: "Tu primer agente" vive dentro de
            Construí/Agentes, no necesita entrada propia acá. */}
        <nav className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-sm font-medium text-(--color-muted-2)">
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
          <Link href="/status" className="transition hover:text-(--color-text)">
            {t("nav.status")}
          </Link>
          <Link href="/recover" className="transition hover:text-(--color-text)">
            {t("nav.recover")}
          </Link>
          {/* El faucet solo tiene sentido en testnet (mint abierto del USDC de
              prueba). En la red real no aparece. */}
          {!IS_MAINNET && (
            <Link href="/faucet" className="transition hover:text-(--color-text)">
              {t("nav.faucet")}
            </Link>
          )}
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
        </nav>
        {/* Aviso legal + estado de la red en UNA línea: mismo tono, misma voz */}
        <p className="mt-4 text-sm text-(--color-muted-3)">
          {t("footer.responsible")} · {t("footer.demo")}
        </p>
        {/* Agradecimiento y propina en renglones separados: juntos en una línea
            se empastaban con el aviso legal de arriba. */}
        <p className="mt-4 text-sm text-(--color-muted-3)">
          {t("footer.love")} <span className="text-(--color-accent)">♥</span>
        </p>
        <div className="mt-2">
          <BtcTip />
        </div>
      </div>
    </footer>
  );
}

/** Propina en BTC plegada a un botón chico: muestra la dirección truncada y
 *  copia la COMPLETA al portapapeles (con feedback). La dirección entera de
 *  42 chars ocupaba 3 renglones en mobile y agrandaba todo el footer. */
function BtcTip() {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const short = `${BTC_TIP_ADDRESS.slice(0, 8)}…${BTC_TIP_ADDRESS.slice(-4)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(BTC_TIP_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* algunos navegadores bloquean el portapapeles: el title conserva la dirección completa */
    }
  }

  return (
    <button
      onClick={copy}
      title={BTC_TIP_ADDRESS}
      aria-label={`${t("footer.tip")} — ${BTC_TIP_ADDRESS}`}
      className="inline-flex items-center gap-1.5 align-middle font-mono text-xs text-(--color-muted-2) transition hover:text-(--color-text)"
    >
      <span>
        ₿ {t("footer.tip")} · {short}
      </span>
      <span className="text-(--color-accent)">{copied ? t("footer.copied") : "⧉"}</span>
    </button>
  );
}
