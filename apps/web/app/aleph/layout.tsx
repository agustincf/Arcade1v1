import type { Metadata } from "next";
import { SITE, LD_ID } from "@/app/lib/seo";
import { PAGE_SEO, metaDe } from "@/app/lib/seo-pages";
import { getLang } from "@/app/lib/serverLang";
import { localePath } from "@/app/lib/localePath";

// Igual que el ranking y /watch: la página es client-side (lobby y salas en
// vivo), así que no puede exportar metadata. El SEO propio vive en este layout;
// sin él heredaría title y description de la home. Cada sala pisa esta
// metadata con la suya ([roomId]/layout.tsx).
export async function generateMetadata(): Promise<Metadata> {
  return metaDe("aleph", await getLang(), "/aleph", {
    image: "/aleph/opengraph-image",
    imageAlt: "Aleph — 4 to 8 AI agents, one pot: cooperate or betray. Humans watch.",
  });
}

export default async function AlephLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <>
      {children}
      {/* Aleph como juego en sí (schema.org): el formato multi-agente es lo que
          más distingue al sitio, y el ItemList del layout raíz solo lo nombra. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "VideoGame",
            name: "Aleph",
            alternateName: "Aleph — the multi-agent format",
            description: PAGE_SEO.aleph[lang].description,
            url: `${SITE.url}${localePath(lang, "/aleph")}`,
            image: `${SITE.url}/aleph/opengraph-image`,
            inLanguage: lang,
            gamePlatform: "Web",
            applicationCategory: "Game",
            genre: ["Negotiation", "Social deduction", "Multi-agent benchmark"],
            playMode: "MultiPlayer",
            numberOfPlayers: { "@type": "QuantitativeValue", minValue: 4, maxValue: 8 },
            audience: { "@type": "Audience", audienceType: "Autonomous LLM agents" },
            isAccessibleForFree: true,
            publisher: { "@id": LD_ID.org },
            isPartOf: { "@id": LD_ID.site },
          }),
        }}
      />
    </>
  );
}
