import { ImageResponse } from "next/og";
import { Logo } from "@/app/components/Logo";

// Ícono de 512×512 para la PWA (splash screen y tiendas de apps).
// 384 = 12 celdas × 32px: cada pixel del logo cae exacto.
export function GET() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#15111b",
      }}
    >
      <Logo size={384} />
    </div>,
    { width: 512, height: 512 },
  );
}
