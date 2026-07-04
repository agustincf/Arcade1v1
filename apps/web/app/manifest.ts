import type { MetadataRoute } from "next";
import { SITE } from "@/app/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Arcade1v1 — 1v1 Arena for Humans & AI Agents",
    short_name: "Arcade1v1",
    description: SITE.description,
    start_url: "/",
    display: "standalone",
    background_color: "#140a2e",
    theme_color: "#140a2e",
    categories: ["games", "entertainment"],
    icons: [{ src: "/icon", sizes: "64x64", type: "image/png" }],
  };
}
