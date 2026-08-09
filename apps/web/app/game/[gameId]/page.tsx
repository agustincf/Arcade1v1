import type { Metadata } from "next";
import { GAME_SEO, pageMeta } from "@/app/lib/seo";
import { TableClient } from "./TableClient";

// Metadatos SEO por juego (ej: "Play Tetris 1v1 for USDC").
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
  return pageMeta({ title: seo.title, description: seo.description, path: `/game/${gameId}` });
}

export default function Page({ params }: { params: Promise<{ gameId: string }> }) {
  return <TableClient params={params} />;
}
