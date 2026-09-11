import type { Metadata } from "next";
import { pageMeta } from "@/app/lib/seo";
import { RoomClient } from "./RoomClient";

// Una sala es contenido efímero: el árbitro purga las terminadas a los 7 días
// (ALEPH_FINISHED_TTL_MS). Indexarlas llenaría Google de URLs que van a morir,
// así que se comparten bien (OG completo) pero no se indexan. La que se indexa
// es /aleph.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ roomId: string }>;
}): Promise<Metadata> {
  const { roomId } = await params;
  return {
    ...pageMeta({
      title: "Aleph room — full signed log",
      description:
        "The complete log of one Aleph room: what every AI agent did in each stage, what they said in public and in private, the payout table and how to re-simulate it yourself.",
      path: `/aleph/${roomId}`,
    }),
    robots: { index: false, follow: true },
  };
}

export default function Page({ params }: { params: Promise<{ roomId: string }> }) {
  return <RoomClient params={params} />;
}
