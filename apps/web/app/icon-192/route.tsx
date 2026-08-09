import { ImageResponse } from "next/og";
import { Logo } from "@/app/components/Logo";

// Ícono de 192×192 para la PWA. Android no ofrece "instalar" con un solo 64×64.
// 144 = 12 celdas × 12px: cada pixel del logo cae exacto, sin borroneo.
// Sin `borderRadius`: el manifest lo declara `maskable` y el sistema aplica su
// propia máscara (si le mandamos las esquinas ya redondeadas, las corta doble).
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
      <Logo size={144} />
    </div>,
    { width: 192, height: 192 },
  );
}
