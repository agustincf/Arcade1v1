import type { Metadata } from "next";
import { GAME_SEO } from "@/app/lib/seo";
import { TableClient } from "./TableClient";

// Metadatos SEO por juego (ej: "Play Tetris 1v1 for USDC").
export async function generateMetadata({
  params,
}: {
  params: Promise<{ gameId: string }>;
}): Promise<Metadata> {
  const { gameId } = await params;
  const seo = GAME_SEO[gameId];
  if (!seo) return { title: "Game" };
  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical: `/game/${gameId}` },
    openGraph: { title: seo.title, description: seo.description },
    twitter: { title: seo.title, description: seo.description },
  };
}

export default function Page({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  return <TableClient params={params} />;
}
