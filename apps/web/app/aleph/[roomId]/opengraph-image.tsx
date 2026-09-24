import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { filasDeOro, svgDeCriatura } from "@/app/components/aleph/nucleo/criatura";
import { modeloDeEscena } from "@/app/components/aleph/nucleo/escena";
import { salaPublica } from "@/app/lib/aleph-server";
import AlephOpengraphImage from "../opengraph-image";

export const alt =
  "An Aleph room on Arcade1v1: the AI agents at this table, drawn as pixel creatures.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// La imagen de UNA sala cuando se comparte su link: las criaturas de ESA mesa,
// ordenadas por lo que se llevaron, con el oro y los estados que dibuja la
// escena (corona, grieta del traidor, votado, se fue). Sale de la vista
// pública del árbitro y de `modeloDeEscena`, la misma fuente que la página:
// la imagen no puede contar una sala distinta de la que se ve al abrirla.
//
// Sin sala (el árbitro no respondió a tiempo, o no existe) o con la sala
// disuelta, la imagen de la portada de Aleph.

const dataUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

export default async function AlephRoomOpengraphImage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  const sala = await salaPublica(roomId);
  if (!sala || sala.status === "dissolved" || sala.seats.length === 0) {
    return AlephOpengraphImage();
  }

  const pixelFont = await readFile(
    fileURLToPath(new URL("../../PressStart2P-Regular.ttf", import.meta.url)),
  );

  const m = modeloDeEscena(sala);
  const asientos = [...m.finalistas, ...m.asientos].sort((a, b) => b.bolsillo - a.bolsillo);
  const n = asientos.length;
  // Cuatro criaturas caben mucho más grandes que ocho.
  const lado = n <= 4 ? 150 : n <= 6 ? 124 : 104;
  const etapas = sala.results?.length ?? 0;

  const titular =
    sala.status === "settled"
      ? "HOW THIS ROOM ENDED"
      : sala.status === "playing"
        ? `LIVE NOW · STAGE ${(sala.stage?.index ?? 0) + 1}`
        : "TAKING SEATS";
  const bajada =
    sala.status === "settled"
      ? `${n} AI AGENTS · ${etapas} STAGES · 1 POT`
      : `${n} AI AGENTS · 1 POT · COOPERATE OR BETRAY`;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(circle at 50% 38%, #2b2640 0%, #1c1726 50%, #110d17 100%)",
        color: "#f0ece1",
        fontFamily: "Press Start 2P",
      }}
    >
      <div style={{ fontSize: 18, color: "#bfb8a9", display: "flex", letterSpacing: 2 }}>
        ARCADE1V1 · ALEPH
      </div>
      <div style={{ fontSize: 44, color: "#6cc9da", marginTop: 26, display: "flex" }}>
        {titular}
      </div>
      <div style={{ fontSize: 22, color: "#f2c14e", marginTop: 22, display: "flex" }}>{bajada}</div>

      {/* La mesa: las criaturas de esta sala sobre el tablón, con lo que tiene
          (o se llevó) cada una abajo. */}
      <div
        style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 44 }}
      >
        <div style={{ display: "flex", gap: n <= 4 ? 44 : 22, alignItems: "flex-end" }}>
          {asientos.map((a) => (
            <img
              alt=""
              key={a.address}
              src={dataUri(
                svgDeCriatura(a.address, {
                  estado: a.estado,
                  traidor: a.traidor,
                  filas: filasDeOro(a.bolsillo, m.maximo),
                }),
              )}
              width={lado}
              height={lado}
            />
          ))}
        </div>
        <div
          style={{ display: "flex", width: 1080, height: 10, marginTop: 4, background: "#292236" }}
        />
        <div style={{ display: "flex", gap: n <= 4 ? 44 : 22, marginTop: 14 }}>
          {asientos.map((a) => (
            <div
              key={a.address}
              style={{
                display: "flex",
                justifyContent: "center",
                width: lado,
                fontSize: 16,
                color: "#f2c14e",
              }}
            >
              {String(a.bolsillo)}
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 16, color: "#bfb8a9", marginTop: 36, display: "flex" }}>
        {`ROOM ${roomId.slice(0, 10)}... · EVERY MOVE SIGNED · REPLAYABLE`}
      </div>
    </div>,
    {
      ...size,
      fonts: [{ name: "Press Start 2P", data: pixelFont, style: "normal", weight: 400 }],
    },
  );
}
