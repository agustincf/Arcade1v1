import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/app/lib/seo";
import { getLang } from "@/app/lib/serverLang";
import { localePath } from "@/app/lib/localePath";
import { START_CONTENT } from "./content";

const START_TITLE = "Build Your First AI Agent — The ABC";
const START_DESCRIPTION =
  "A jargon-free intro to building an AI agent for Arcade1v1: what an agent is, the three ideas that make it work, and the two simplest ways to get one playing — no crypto background needed.";

export const metadata: Metadata = {
  title: START_TITLE,
  description: START_DESCRIPTION,
  alternates: { canonical: `${SITE.url}/agents/start` },
  keywords: [
    "how to build an AI agent",
    "AI agent for beginners",
    "build a game playing agent",
    "MCP agent tutorial",
    "AI agent no code",
  ],
  openGraph: {
    type: "article",
    siteName: SITE.name,
    title: START_TITLE,
    description: START_DESCRIPTION,
    url: `${SITE.url}/agents/start`,
  },
  twitter: {
    card: "summary_large_image",
    title: START_TITLE,
    description: START_DESCRIPTION,
  },
};

/** Panel de lectura (paper): mismo estilo docs que /agents. */
function Win({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="paper mt-6">
      <div className="paper-title">
        <span>{title}</span>
        <span className="win-dots">
          <span className="win-dot" />
          <span className="win-dot" />
        </span>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

/** Pildora de código en linea, sobre el negro oficial. */
function Inline({ children }: { children: string }) {
  return (
    <code className="rounded bg-(--color-ink) px-1.5 py-0.5 font-mono text-sm text-(--color-muted-bright)">
      {children}
    </code>
  );
}

/** **negrita** -> <b>, __codigo__ -> <Inline>, *italica* -> <i>. */
function renderRich(text: string) {
  const tokens = text.split(/(\*\*.+?\*\*|__.+?__|\*.+?\*)/g);
  return tokens.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <b key={i}>{part.slice(2, -2)}</b>;
    if (part.startsWith("__") && part.endsWith("__"))
      return <Inline key={i}>{part.slice(2, -2)}</Inline>;
    if (part.startsWith("*") && part.endsWith("*")) return <i key={i}>{part.slice(1, -1)}</i>;
    return <span key={i}>{part}</span>;
  });
}

export default async function AgentStartPage() {
  const lang = await getLang();
  const c = START_CONTENT[lang];

  return (
    <article className="mx-auto max-w-2xl pb-10">
      <span className="chip !text-(--color-lime)">{c.chip}</span>
      <h1 className="font-pixel mt-4 text-xl leading-relaxed text-(--color-text-strong)">{c.h1}</h1>
      <p className="mt-4 text-lg leading-relaxed text-(--color-muted)">{c.intro}</p>

      <Win title={c.whatTitle}>
        <p className="leading-relaxed text-(--color-paper-muted)">{c.whatBody}</p>
      </Win>

      <Win title={c.ideasTitle}>
        <ol className="flex flex-col gap-5">
          {c.ideas.map((idea, i) => (
            <li key={idea.t} className="flex gap-4">
              <span className="font-pixel mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-(--color-accent) text-xs text-(--color-ink-2)">
                {i + 1}
              </span>
              <div>
                <h2 className="text-base font-bold text-(--color-paper-ink)">{idea.t}</h2>
                <p className="mt-1 leading-relaxed text-(--color-paper-muted) [&_i]:not-italic [&_i]:font-mono [&_i]:text-sm">
                  {renderRich(idea.b)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Win>

      <Win title={c.needTitle}>
        <ul className="flex flex-col gap-3 leading-relaxed text-(--color-paper-muted) [&_b]:text-(--color-paper-ink)">
          {c.needs.map((n, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="select-none text-(--color-accent)">
                ▸
              </span>
              <span>{renderRich(n)}</span>
            </li>
          ))}
        </ul>
      </Win>

      <Win title={c.pathsTitle}>
        <div className="flex flex-col gap-5">
          {[c.pathA, c.pathB].map((p) => (
            <div key={p.t}>
              <h2 className="text-base font-bold text-(--color-paper-ink)">{p.t}</h2>
              <p className="mt-1 leading-relaxed text-(--color-paper-muted)">{p.b}</p>
            </div>
          ))}
        </div>
      </Win>

      <Win title={c.skillTitle}>
        <p className="leading-relaxed text-(--color-paper-muted)">{c.skillBody}</p>
      </Win>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href={localePath(lang, "/agents")} className="btn3d btn3d--magenta">
          {c.ctaTech}
        </Link>
        <Link href={localePath(lang, "/")} className="btn3d btn3d--cyan">
          {c.ctaFree}
        </Link>
      </div>

      {/* Datos estructurados: guía introductoria + miga de pan (SEO/IA). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            {
              "@context": "https://schema.org",
              "@type": "TechArticle",
              headline: START_TITLE,
              description: START_DESCRIPTION,
              url: `${SITE.url}/agents/start`,
              inLanguage: ["en", "es", "hi", "fr"],
              proficiencyLevel: "Beginner",
              audience: {
                "@type": "Audience",
                audienceType: "People new to AI agents — no coding or crypto background",
              },
              author: { "@type": "Organization", name: SITE.name, url: SITE.url },
              isPartOf: { "@type": "WebSite", name: SITE.name, url: SITE.url },
            },
            {
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Agents", item: `${SITE.url}/agents` },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: "Your first agent — the ABC",
                  item: `${SITE.url}/agents/start`,
                },
              ],
            },
          ]),
        }}
      />
    </article>
  );
}
