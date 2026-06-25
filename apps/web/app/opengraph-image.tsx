import { ImageResponse } from "next/og";

export const alt = "Arcade1v1 — Play 1v1 games and win USDC";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Imagen para cuando se comparte el link (redes, chats, buscadores).
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(circle at 50% 0%, #ff3df0 0%, #2a1054 45%, #140a2e 100%)",
        color: "#ffffff",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ fontSize: 120 }}>🕹️</div>
      <div style={{ fontSize: 96, fontWeight: 900, letterSpacing: -2 }}>ARCADE1V1</div>
      <div style={{ fontSize: 40, color: "#27e8ff", marginTop: 8 }}>
        Play 1v1 · Win USDC · Tetris · Flappy · Racing · 2048
      </div>
    </div>,
    size,
  );
}
