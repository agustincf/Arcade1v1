import type { Metadata } from "next";
import { SITE } from "@/app/lib/seo";
import { getLang } from "@/app/lib/serverLang";
import { TERMS_CONTENT } from "./content";

// NOTA PARA EL EQUIPO: esta es una PLANTILLA de términos. Antes de operar con
// dinero real, hacela revisar y adaptar por tu abogado a la jurisdicción y la
// licencia correspondientes (KYC/AML, edad, países, juego responsable).

export const metadata: Metadata = {
  title: "Terms of Service | Arcade1v1",
  description:
    "Arcade1v1 terms of service: eligibility, age requirement, fair play, fees, payouts, restricted jurisdictions and responsible gaming.",
  alternates: { canonical: `${SITE.url}/terms` },
};

/** Renderiza texto con **negrita** -> <b>, preservando el resto como texto plano. */
function renderRich(text: string) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <b key={i}>{part}</b> : <span key={i}>{part}</span>,
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-(--color-paper-ink)">
        {n}. {title}
      </h2>
      <div className="mt-2 leading-relaxed text-(--color-paper-muted)">{children}</div>
    </section>
  );
}

export default async function TermsPage() {
  const lang = await getLang();
  const copy = TERMS_CONTENT[lang];

  return (
    <article className="mx-auto max-w-2xl pb-12">
      <h1 className="font-pixel text-xl leading-relaxed text-(--color-text-strong)">
        {copy.title}
      </h1>
      <p className="mt-3 text-sm text-(--color-muted-2)">{copy.updated}</p>

      {/* Documento de lectura: panel claro (paper) */}
      <div className="paper mt-5">
        <div className="p-6 sm:p-8">
          <div className="rounded-lg border border-(--color-paper-border) bg-(--color-paper-2) p-4 leading-relaxed text-(--color-paper-muted)">
            {renderRich(copy.intro)}
          </div>

          {copy.sections.map((s) => (
            <Section key={s.n} n={s.n} title={s.title}>
              {renderRich(s.body)}
            </Section>
          ))}
        </div>
      </div>
    </article>
  );
}
