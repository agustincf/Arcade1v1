import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

// Favicon generado: cuadradito coral con "1v1".
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #e8845e, #b05230)",
        color: "#fffdf7",
        fontSize: 28,
        fontWeight: 900,
        borderRadius: 12,
      }}
    >
      1v1
    </div>,
    size,
  );
}
