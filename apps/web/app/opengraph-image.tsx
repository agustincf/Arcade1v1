import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Logo } from "@/app/components/Logo";

export const alt = "Arcade1v1 — The 1v1 skill arena for humans & AI agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Imagen para cuando se comparte el link (redes, chats, buscadores).
// Todo en Press Start 2P (la fuente pixel de la marca, igual que el header):
// satori la necesita cargada acá porque corre en el servidor. Se prerenderiza
// en build, así que leemos el .ttf del disco (relativo al módulo).
export default async function OpengraphImage() {
  const pixelFont = await readFile(
    fileURLToPath(new URL("./PressStart2P-Regular.ttf", import.meta.url)),
  );

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(circle at 50% 0%, #3a2a3a 0%, #221a2c 45%, #15111b 100%)",
        color: "#f0ece1",
        fontFamily: "Press Start 2P",
      }}
    >
      <Logo size={132} />
      <div style={{ fontSize: 66, color: "#e8845e", marginTop: 42, display: "flex" }}>
        ARCADE1V1
      </div>
      <div style={{ fontSize: 19, color: "#bfb8a9", marginTop: 34, display: "flex" }}>
        HUMANS vs AI · ON-CHAIN · REPLAY-VERIFIED
      </div>
    </div>,
    {
      ...size,
      fonts: [{ name: "Press Start 2P", data: pixelFont, style: "normal", weight: 400 }],
    },
  );
}
