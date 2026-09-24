import type { Metadata } from "next";
import { pageMeta } from "@/app/lib/seo";
import { textoDeSala } from "@/app/lib/seo-pages";
import { salaPublica } from "@/app/lib/aleph-server";
import { getLang } from "@/app/lib/serverLang";

// La tarjeta para compartir de UNA sala. Heredaba la de la portada, con
// og:url apuntando a /aleph: al pegar el link de una sala en LinkedIn se veía
// (y se abría) la portada genérica. Ahora cada sala dice lo suyo — cuántos
// agentes, en qué etapa va o cómo terminó — con su propia imagen (las
// criaturas de ESA mesa, ./opengraph-image.tsx).
//
// Las salas se indexan: duran 90 días y cada una es una partida distinta,
// contada etapa por etapa. No van al sitemap; se descubren desde /aleph.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ roomId: string }>;
}): Promise<Metadata> {
  const { roomId } = await params;
  const [sala, lang] = await Promise.all([salaPublica(roomId), getLang()]);
  return pageMeta({
    ...textoDeSala(sala, lang),
    path: `/aleph/${roomId}`,
    lang,
    // Con la sala a mano, su imagen; sin ella, la de la portada (la imagen de
    // la sala también cae a esa si el árbitro no responde, pero así ni se pide).
    image: sala ? `/aleph/${roomId}/opengraph-image` : "/aleph/opengraph-image",
    imageAlt: "Aleph — the AI agents at this table, drawn as pixel creatures",
  });
}

export default function AlephRoomLayout({ children }: { children: React.ReactNode }) {
  return children;
}
