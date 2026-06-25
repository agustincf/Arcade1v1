"use client";

import Link from "next/link";
import { GAMES } from "@/app/lib/games";
import { BetQuickPlay } from "@/app/components/BetQuickPlay";
import { GameIcon } from "@/app/components/GameIcon";
import { useT } from "@/app/lib/i18n";
import { FAQ } from "@/app/lib/seo";

export default function HomePage() {
  const { t } = useT();

  return (
    <div>
      {/* Hero */}
      <section className="mb-8 text-center">
        <h1 className="font-pixel text-2xl text-[--color-accent] neon sm:text-4xl">
          {t("hero.title")}
        </h1>
        <p className="font-screen mt-3 text-xl text-[--color-accent-2] neon-cyan">
          {t("hero.sub")}
        </p>
        <BetQuickPlay />
      </section>

      {/* Tarjetas de juego */}
      <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {GAMES.map((game, i) => {
          const titleClass = i % 2 === 0 ? "win-title" : "win-title win-title--cyan";
          return (
            <Link key={game.id} href={`/game/${game.id}`}>
              <div className="win h-full transition hover:-translate-y-1">
                <div className={titleClass}>
                  <span>{t(`game.${game.id}.name`).toUpperCase()}.EXE</span>
                  <span className="win-dots">
                    <span className="win-dot" />
                    <span className="win-dot" />
                    <span className="win-dot" />
                  </span>
                </div>
                <div className="p-5">
                  <div className="mb-3 flex justify-center">
                    <GameIcon id={game.id} size={64} />
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <span className="chip">
                      <span className="blink">●</span> {t("card.open")}
                    </span>
                  </div>
                  <p className="font-screen mt-3 text-center text-lg text-slate-300">
                    {t(`game.${game.id}.desc`)}
                  </p>
                  <div className="mt-5 text-center">
                    <span className="btn3d btn3d--magenta inline-block">{t("card.cta")}</span>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </section>

      {/* Como funciona */}
      <section className="win mt-8">
        <div className="win-title win-title--cyan">
          <span>{t("how.title")}</span>
          <span className="win-dots">
            <span className="win-dot" />
            <span className="win-dot" />
          </span>
        </div>
        <div className="font-screen grid grid-cols-1 gap-3 p-5 text-lg sm:grid-cols-3">
          <Step n="1" text={t("how.s1")} />
          <Step n="2" text={t("how.s2")} />
          <Step n="3" text={t("how.s3")} />
        </div>
        <p className="font-screen px-5 pb-4 text-sm text-slate-500">{t("how.fee")}</p>
      </section>

      {/* Preguntas frecuentes (SEO + motores de IA) */}
      <section className="win mt-8">
        <div className="win-title">
          <span>{t("faq.title")}</span>
          <span className="win-dots">
            <span className="win-dot" />
            <span className="win-dot" />
          </span>
        </div>
        <div className="font-screen p-5 text-lg">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div
              key={n}
              className="border-b-2 border-dashed border-[--color-border] py-3 last:border-0"
            >
              <h2 className="font-pixel text-[11px] text-[--color-accent-2]">{t(`faq.q${n}`)}</h2>
              <p className="mt-2 text-slate-300">{t(`faq.a${n}`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Dato estructurado FAQPage (schema.org) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FAQ.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          }),
        }}
      />
    </div>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="font-pixel text-sm text-[--color-gold]">{n}</span>
      <span className="text-slate-300">{text}</span>
    </div>
  );
}
