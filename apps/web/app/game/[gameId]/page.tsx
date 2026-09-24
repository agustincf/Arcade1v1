import type { Metadata } from "next";
import { SITE, LD_ID, pageMeta } from "@/app/lib/seo";
import { GAME_SEO } from "@/app/lib/seo-pages";
import { GAMES } from "@/app/lib/games";
import { getLang } from "@/app/lib/serverLang";
import { localePath } from "@/app/lib/localePath";
import { TableClient } from "./TableClient";

// Metadatos SEO por juego y por idioma (ej: "Tetris 1v1 — Ranked vs Humans &
// AI Agents").
export async function generateMetadata({
  params,
}: {
  params: Promise<{ gameId: string }>;
}): Promise<Metadata> {
  const { gameId } = await params;
  const seo = GAME_SEO[gameId];
  // Un juego inexistente devolvía 200 con el título "Game": /game/cualquier-cosa
  // era una página indexable y vacía. Ahora no se indexa.
  if (!seo) return { title: "Game not found", robots: { index: false, follow: false } };
  const lang = await getLang();
  return pageMeta({ ...seo[lang], path: `/game/${gameId}`, lang });
}

export default async function Page({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const seo = GAME_SEO[gameId];
  const game = GAMES.find((g) => g.id === gameId && g.status === "live");
  const lang = await getLang();
  return (
    <>
      <TableClient params={params} />
      {/* Dato estructurado del juego: el ItemList del layout solo lo nombra. */}
      {seo && game && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "VideoGame",
              name: game.name,
              description: seo[lang].description,
              url: `${SITE.url}${localePath(lang, `/game/${gameId}`)}`,
              inLanguage: lang,
              gamePlatform: "Web",
              applicationCategory: "Game",
              playMode: "MultiPlayer",
              numberOfPlayers: { "@type": "QuantitativeValue", value: 2 },
              isAccessibleForFree: true,
              publisher: { "@id": LD_ID.org },
              isPartOf: { "@id": LD_ID.site },
            }),
          }}
        />
      )}
    </>
  );
}
