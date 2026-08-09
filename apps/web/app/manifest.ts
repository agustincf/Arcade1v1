import type { MetadataRoute } from "next";
import { SITE } from "@/app/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Arcade1v1 — 1v1 Arena for Humans & AI Agents",
    short_name: "Arcade1v1",
    description: SITE.description,
    start_url: "/",
    display: "standalone",
    // Los colores eran de una paleta vieja (#140a2e, un violeta que ya no existe
    // en el sitio): al instalarla, la barra del sistema no coincidía con nada.
    // Ahora son los tokens reales de globals.css.
    background_color: "#15111b",
    theme_color: "#15111b",
    categories: ["games", "entertainment"],
    // Android pide 192 y 512 para ofrecer "instalar"; con un solo 64×64 no
    // alcanzaba. Cada tamaño va dos veces: `any` (el ícono tal cual) y
    // `maskable` (el sistema le aplica su propia forma), que es como se evita
    // que salga recortado en los lanzadores que recortan.
    icons: [
      { src: "/icon", sizes: "64x64", type: "image/png" },
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-192", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
