import { ImageResponse } from "next/og";
import { Logo } from "@/app/components/Logo";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

// Favicon: el joystick pixel de la marca sobre la tinta oficial.
// 48 = 12 celdas x 4px: cada pixel del logo cae exacto (sin borroneo).
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#15111b",
        borderRadius: 12,
      }}
    >
      <Logo size={48} />
    </div>,
    size,
  );
}
