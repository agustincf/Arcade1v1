"use client";

import { LocaleLink as Link } from "@/app/components/LocaleLink";
import { GAMES } from "@/app/lib/games";
import { BetQuickPlay } from "@/app/components/BetQuickPlay";
import { GameIcon } from "@/app/components/GameIcon";
import { PixelIcon, type PixelIconName } from "@/app/components/PixelIcon";
import { useT } from "@/app/lib/i18n";
import { BET_AMOUNTS } from "@/app/lib/config";

/** Preguntas del FAQ (claves faq.q1..faq.a8 en los tres diccionarios). */
const FAQ_N = [1, 2, 3, 4, 5, 6, 7, 8];

export default function HomePage() {
  const { t, lang } = useT();
  // Las mesas de la tarjeta salen de la misma lista que la mesa de cada juego:
  // si mañana cambia el rango de stakes, la home no queda prometiendo otro.
  const stakes = t("card.stakes", {
    min: Math.min(...BET_AMOUNTS),
    max: Math.max(...BET_AMOUNTS),
  });

  return (
    <div>
      {/* Hero. La pixel en 24/32 px: múltiplos de 8, la grilla de la fuente. */}
      <section className="pt-4 text-center">
        <h1 className="font-pixel text-px24 leading-relaxed text-(--color-text-strong) sm:text-px32">
          {t("hero.title")}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-(--color-muted)">{t("hero.sub")}</p>
        <BetQuickPlay />
      </section>

      {/* ALEPH primero: es lo mas nuevo y lo mas distinto que hay para ver, y
          no compite con los cartuchos porque no es uno — es una mesa de varios
          agentes donde el humano mira. Fuera de la grilla a proposito. */}
      <section className="win mt-12">
        <div className="win-title win-title--cyan">
          <span>{t("aleph.card.title")}</span>
          <span className="chip chip--live">{t("aleph.card.chip")}</span>
        </div>
        <div className="flex flex-col items-center gap-5 p-6 sm:flex-row sm:text-left">
          <GameIcon id="aleph" size={64} />
          <div className="flex-1 text-center sm:text-left">
            <p className="text-base leading-relaxed text-(--color-muted)">{t("aleph.card.body")}</p>
          </div>
          <Link href="/aleph" className="btn3d btn3d--cyan shrink-0">
            {t("aleph.card.cta")}
            <PixelIcon name="play" className="ml-2" />
          </Link>
        </div>
      </section>

      {/* Pilares del proyecto: agent-first · verificado on-chain · benchmark de
          IA. Van sobre la página y no en una caja: tres columnas con ícono,
          título y dos líneas adentro de un panel es la grilla de "features"
          de cualquier plantilla. */}
      <section className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-8">
        <Pillar icon="agent" title={t("pillars.p1t")} body={t("pillars.p1b")} />
        <Pillar icon="verified" title={t("pillars.p2t")} body={t("pillars.p2b")} />
        <Pillar icon="chart" title={t("pillars.p3t")} body={t("pillars.p3b")} />
      </section>

      {/* Cartuchos: la pantalla con el sprite, el nombre y las mesas. Toda la
          tarjeta es el link, así que no lleva un botón por juego: seis botones
          coral iguales competían con el CTA del hero. En celular va en fila
          (antes cada tarjeta ocupaba casi una pantalla: ~3.600 px de scroll
          para los seis juegos). */}
      <section className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {GAMES.map((game) => (
          <Link
            key={game.id}
            href={`/game/${game.id}`}
            className="flex overflow-hidden rounded-md border border-(--color-border) bg-(--color-surface) transition hover:-translate-y-0.5 hover:border-(--color-accent) sm:flex-col"
          >
            <div className="pantalla w-24 shrink-0 border-r border-(--color-border) sm:h-32 sm:w-auto sm:border-r-0 sm:border-b">
              <GameIcon id={game.id} size={64} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col p-3.5 sm:p-4">
              <h2 className="font-pixel text-px8 leading-relaxed text-(--color-text-strong) sm:text-px16">
                {t(`game.${game.id}.name`)}
              </h2>
              <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-(--color-muted) sm:mt-2 sm:line-clamp-none sm:text-base">
                {t(`game.${game.id}.desc`)}
              </p>
              {/* 10 px en celular: a 12 "JUGAR 1V1" y las mesas no entran en
                  un renglón al lado de la pantalla. */}
              <div className="rotulo mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-3 text-2xs sm:pt-4 sm:text-xs">
                <span className="inline-flex items-center gap-2 text-(--color-accent)">
                  {t("card.cta")} <PixelIcon name="play" />
                </span>
                <span className="text-(--color-gold)">{stakes}</span>
              </div>
            </div>
          </Link>
        ))}
      </section>

      {/* Como funciona — panel claro de lectura (el "manual") */}
      <section className="paper mt-12">
        <div className="paper-title">
          <span>{t("how.title")}</span>
        </div>
        <div className="grid grid-cols-1 gap-4 p-6 text-base sm:grid-cols-3">
          <Step n="1" text={t("how.s1")} />
          <Step n="2" text={t("how.s2")} />
          <Step n="3" text={t("how.s3")} />
        </div>
        <p className="px-6 pb-5 text-sm text-(--color-paper-muted-2)">{t("how.fee")}</p>
      </section>

      {/* Agentes de IA — el diferenciador, visible sin ir al footer */}
      <section className="paper mt-12">
        <div className="paper-title">
          <span>{t("agents.title")}</span>
        </div>
        <div className="p-6">
          <p className="leading-relaxed text-(--color-paper-muted)">{t("agents.body")}</p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Link href="/build" className="btn3d btn3d--magenta inline-block">
              <PixelIcon name="agent" className="mr-2" />
              {t("build.cta")}
            </Link>
            {/* Para quien programa: la doc técnica (SDK, API, MCP) sigue viva */}
            <Link href="/agents" className="font-medium text-(--color-paper-ink) underline">
              {t("agents.devLink")} →
            </Link>
          </div>
        </div>
      </section>

      {/* Preguntas frecuentes (SEO + motores de IA) — panel claro de lectura */}
      <section className="paper mt-12">
        <div className="paper-title">
          <span>{t("faq.title")}</span>
        </div>
        <div className="p-6 text-base">
          {FAQ_N.map((n) => (
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

      {/* Dato estructurado FAQPage (schema.org). Sale de las MISMAS claves que
          el FAQ visible y en el idioma de la página: antes era una copia en
          inglés aparte, que en /es y /fr no coincidía con lo que se lee (y
          Google pide que el marcado sea el contenido visible). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            inLanguage: lang,
            mainEntity: FAQ_N.map((n) => ({
              "@type": "Question",
              name: t(`faq.q${n}`),
              acceptedAnswer: { "@type": "Answer", text: t(`faq.a${n}`) },
            })),
          }),
        }}
      />
    </div>
  );
}

function Pillar({ icon, title, body }: { icon: PixelIconName; title: string; body: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3.5 border-t border-(--color-border) pt-4 sm:block sm:pt-5">
      {/* 24 px en celular (al lado del título), 36 en escritorio (arriba):
          siempre múltiplo de la grilla de 12 del ícono. */}
      <span className="row-span-2 text-(--color-accent)">
        <PixelIcon name={icon} className="h-6 w-6 sm:h-9 sm:w-9" />
      </span>
      <h2 className="text-base font-bold text-(--color-text-strong) sm:mt-3.5">{title}</h2>
      <p className="mt-1.5 leading-relaxed text-(--color-muted)">{body}</p>
    </div>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="font-pixel flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-(--color-accent) text-px16 text-(--color-ink-2)">
        {n}
      </span>
      <span className="leading-relaxed text-(--color-paper-muted)">{text}</span>
    </div>
  );
}
