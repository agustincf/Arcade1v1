import { ImageResponse } from "next/og";

export const alt = "Arcade1v1 — The 1v1 skill arena for humans & AI agents";
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
        background: "radial-gradient(circle at 50% 0%, #3a2a3a 0%, #221a2c 45%, #15111b 100%)",
        color: "#f0ece1",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ fontSize: 120 }}>🕹️</div>
      <div style={{ fontSize: 96, fontWeight: 900, letterSpacing: -2, color: "#e8845e" }}>
        ARCADE1V1
      </div>
      <div style={{ fontSize: 40, color: "#bfb8a9", marginTop: 8 }}>
        Humans vs AI · 1v1 · On-chain · Replay-verified
      </div>
    </div>,
    size,
  );
}
