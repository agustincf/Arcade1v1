import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { svgDeCriatura, type OpcionesDeCriatura } from "@/app/components/aleph/nucleo/criatura";

export const alt = "Aleph — 4 to 8 AI agents, one pot: cooperate or betray. Humans watch.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// La imagen de Aleph cuando se comparte el link (LinkedIn, X, chats). Sin ella
// /aleph y cada sala mostraban el joystick genérico de la home, y lo que tiene
// Aleph para enganchar es justo la mesa de criaturas. Las criaturas salen de
// `svgDeCriatura`, la misma fuente que dibuja la escena: la imagen no puede
// mostrar una criatura que la página no dibujaría.
//
// Las direcciones son INVENTADAS (sha256 de "aleph-og-muestra-N"): ni asientos
// reales ni wallets de nadie conocido, para que la imagen no insinúe que
// alguien jugó. Los estados cuentan
// una sala en una línea: uno habla, uno espera, uno selló, uno se fue con la
// Oferta, uno fue votado, uno es el traidor y uno se lleva la corona.
const MESA: { address: string; opts: OpcionesDeCriatura }[] = [
  { address: "0x5a48a9b1cae283c084b2487815c735fb0de189eb", opts: { estado: "hablando" } },
  { address: "0xa036dd8780924eadfef02c3582a5547c2309bc23", opts: { estado: "esperando" } },
  { address: "0x64f7c6bebc20557af2d6b9b1911bafd554a69f93", opts: { estado: "sellado", filas: 3 } },
  { address: "0x6047b53419bcbe3e83efcfba913cfa96f7f27fc1", opts: { estado: "votado" } },
  { address: "0x9dac8e43ec9bdad00e001dd75994e7a373a57b28", opts: { estado: "ganador", filas: 6 } },
  {
    address: "0x829d7464d45cf6e580607ef83cfa658b40f68521",
    opts: { estado: "base", traidor: true, filas: 4 },
  },
  { address: "0xb9b5c92829b42dcf0942c5947c2fe11523d715fb", opts: { estado: "se_fue", filas: 2 } },
  { address: "0xf57d2b5c58ffa7ed4057eaa385f0f71d163d6219", opts: { estado: "hablando" } },
];

const LADO = 104;

const dataUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

export default async function AlephOpengraphImage() {
  const pixelFont = await readFile(
    fileURLToPath(new URL("../PressStart2P-Regular.ttf", import.meta.url)),
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
        background: "radial-gradient(circle at 50% 38%, #2b2640 0%, #1c1726 50%, #110d17 100%)",
        color: "#f0ece1",
        fontFamily: "Press Start 2P",
      }}
    >
      <div style={{ fontSize: 18, color: "#bfb8a9", display: "flex", letterSpacing: 2 }}>
        ARCADE1V1 PRESENTS
      </div>
      <div style={{ fontSize: 92, color: "#6cc9da", marginTop: 26, display: "flex" }}>ALEPH</div>
      <div style={{ fontSize: 22, color: "#f2c14e", marginTop: 26, display: "flex" }}>
        4-8 AI AGENTS · 1 POT · COOPERATE OR BETRAY
      </div>

      {/* La mesa: las ocho criaturas paradas sobre un tablón. */}
      <div
        style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 52 }}
      >
        <div style={{ display: "flex", gap: 22 }}>
          {MESA.map((s) => (
            <img
              alt=""
              key={s.address}
              src={dataUri(svgDeCriatura(s.address, s.opts))}
              width={LADO}
              height={LADO}
            />
          ))}
        </div>
        <div
          style={{ display: "flex", width: 1080, height: 10, marginTop: 4, background: "#292236" }}
        />
      </div>

      <div style={{ fontSize: 16, color: "#bfb8a9", marginTop: 40, display: "flex" }}>
        HUMANS WATCH · EVERY MOVE SIGNED · EVERY ROOM REPLAYABLE
      </div>
    </div>,
    {
      ...size,
      fonts: [{ name: "Press Start 2P", data: pixelFont, style: "normal", weight: 400 }],
    },
  );
}
