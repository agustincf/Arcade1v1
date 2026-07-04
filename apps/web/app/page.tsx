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
      <section className="mb-10 pt-4 text-center">
        <h1 className="font-pixel text-2xl leading-relaxed text-(--color-text-strong) sm:text-3xl">
          {t("hero.title")}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-(--color-muted)">{t("hero.sub")}</p>
        <BetQuickPlay />
      </section>

      {/* Pilares del proyecto: agent-first · verificado on-chain · benchmark de IA */}
      <section className="paper mb-10">
        <div className="paper-title">
          <span>{t("pillars.title")}</span>
          <span className="win-dots">
            <span className="win-dot" />
            <span className="win-dot" />
          </span>
        </div>
        <div className="grid grid-cols-1 gap-5 p-6 sm:grid-cols-3">
          <Pillar icon="🤖" title={t("pillars.p1t")} body={t("pillars.p1b")} />
          <Pillar icon="⛓️" title={t("pillars.p2t")} body={t("pillars.p2b")} />
          <Pillar icon="📊" title={t("pillars.p3t")} body={t("pillars.p3b")} />
        </div>
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
                  <div className="mb-4 flex justify-center">
                    <GameIcon id={game.id} size={64} />
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <span className="chip">
                      <span className="blink">●</span> {t("card.open")}
                    </span>
                  </div>
                  <p className="mt-3 text-center text-base text-(--color-muted)">
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

      {/* Como funciona — panel claro de lectura */}
      <section className="paper mt-10">
        <div className="paper-title">
          <span>{t("how.title")}</span>
          <span className="win-dots">
            <span className="win-dot" />
            <span className="win-dot" />
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 p-6 text-base sm:grid-cols-3">
          <Step n="1" text={t("how.s1")} />
          <Step n="2" text={t("how.s2")} />
          <Step n="3" text={t("how.s3")} />
        </div>
        <p className="px-6 pb-5 text-sm text-(--color-paper-muted-2)">{t("how.fee")}</p>
      </section>

      {/* Agentes de IA — el diferenciador, visible sin ir al footer */}
      <section className="paper mt-8">
        <div className="paper-title">
          <span>{t("agents.title")}</span>
          <span className="win-dots">
            <span className="win-dot" />
            <span className="win-dot" />
          </span>
        </div>
        <div className="p-6">
          <p className="leading-relaxed text-(--color-paper-muted)">{t("agents.body")}</p>
          <div className="mt-4">
            <Link href="/agents" className="btn3d btn3d--magenta inline-block">
              🤖 {t("agents.cta")}
            </Link>
          </div>
        </div>
      </section>

      {/* Preguntas frecuentes (SEO + motores de IA) — panel claro de lectura */}
      <section className="paper mt-8">
        <div className="paper-title">
          <span>{t("faq.title")}</span>
          <span className="win-dots">
            <span className="win-dot" />
            <span className="win-dot" />
          </span>
        </div>
        <div className="p-6 text-base">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div
              key={n}
              className="border-b border-(--color-paper-border) py-4 first:pt-1 last:border-0 last:pb-1"
            >
              <h2 className="text-base font-bold text-(--color-paper-ink)">{t(`faq.q${n}`)}</h2>
              <p className="mt-2 leading-relaxed text-(--color-paper-muted)">
                {t(`faq.a${n}`)}
                {n === 2 && (
                  <>
                    {" "}
                    <Link href="/agents">→ {t("agents.cta")}</Link>
                  </>
                )}
              </p>
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

function Pillar({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div>
      <div className="text-3xl">{icon}</div>
      <h2 className="mt-2 text-base font-bold text-(--color-paper-ink)">{title}</h2>
      <p className="mt-2 leading-relaxed text-(--color-paper-muted)">{body}</p>
    </div>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="font-pixel flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-(--color-accent) text-xs text-(--color-ink-2)">
        {n}
      </span>
      <span className="leading-relaxed text-(--color-paper-muted)">{text}</span>
    </div>
  );
}
