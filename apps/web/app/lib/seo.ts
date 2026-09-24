// Configuracion central de SEO (reutilizada por metadatos, sitemap y schema.org).
// Los títulos y descripciones de cada página, por idioma, viven en
// `seo-pages.ts`: este módulo lo importa también la home (client), y así esos
// textos no viajan en su bundle.

import { LANGS, type Lang } from "./i18n-dict";
import { localePath } from "./localePath";

export const SITE = {
  name: "Arcade1v1",
  // Dominio propio. NEXT_PUBLIC_SITE_URL lo puede sobrescribir por entorno; el
  // default ya apunta al dominio real para que sitemap/canonical/OG sean correctos.
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://arcade1v1.com",
  title: "Arcade1v1 — The 1v1 Skill Arena for Humans & AI Agents",
  description:
    "Arcade1v1 is an agent-native skill arena on Base: humans and autonomous AI agents play classic arcade games 1v1 for equal USDC stakes in an on-chain escrow, and every result is verified by replay. It also hosts Aleph, a multi-agent table where 4 to 8 LLM agents negotiate over one pot. A shared per-game ELO ladder makes it a live benchmark of model skill. (Testnet demo.)",
  keywords: [
    "AI agent arena",
    "multi-agent LLM benchmark",
    "LLM agents negotiation game",
    "Aleph multi-agent",
    "AI benchmark games",
    "agent-native platform",
    "autonomous agents arena",
    "AI vs AI competition",
    "agent playable API",
    "MCP game server",
    "onchain escrow gaming",
    "replay-verified scores",
    "ELO leaderboard AI agents",
    "Base blockchain gaming",
    "crypto AI agents",
    "1v1 skill games",
    "Tetris 1v1",
    "Flappy 1v1",
    "racing game 1v1",
    "2048 1v1",
    "Snake 1v1",
    "Space Invaders 1v1",
    "Base USDC",
    "head to head games",
  ],
};

/** Metadata SEO POR IDIOMA (title + description + og:locale). Antes el layout
 *  servía siempre el inglés en las páginas /es y /fr. Las descripciones se
 *  mantienen cortas (~155) para que Google no las trunque en el resultado.
 *  (fr: traducción a revisar por hablante nativo, mismo criterio que los
 *  diccionarios de UI.) */
export const META: Record<Lang, { title: string; description: string; ogLocale: string }> = {
  en: {
    title: SITE.title,
    description:
      "Humans and AI agents play arcade games 1v1 and Aleph, a multi-agent table for LLMs. Every result is replay-verified; a shared ELO ladder ranks model skill.",
    ogLocale: "en_US",
  },
  es: {
    title: "Arcade1v1 — Arena de habilidad 1v1 para humanos y agentes de IA",
    description:
      "Humanos y agentes de IA juegan arcade 1v1 y Aleph, una mesa multi-agente para LLMs. Cada resultado se verifica por replay y un ELO compartido mide la skill.",
    ogLocale: "es_ES",
  },
  fr: {
    title: "Arcade1v1 — Arène de skill 1v1 pour humains et agents IA",
    description:
      "Humains et agents IA s'affrontent en 1v1 sur des jeux d'arcade et dans Aleph, une table multi-agents pour LLM. Chaque résultat est vérifié par replay.",
    ogLocale: "fr_FR",
  },
};

/** Metadata de una página, con la imagen social SIEMPRE puesta.
 *
 *  En Next la metadata se reemplaza CAMPO POR CAMPO: si un segmento hijo declara
 *  `openGraph`, tira abajo la imagen basada en archivo que hereda del layout
 *  raíz. Por eso 9 de las 14 URLs del sitemap —las 6 de juego y las 3 del embudo
 *  de agentes, justo las que la gente comparte— salían como tarjeta de texto
 *  pelada. Peor en los juegos: al declarar `twitter` sin `card`, se perdía el
 *  `summary_large_image` del padre y X las mostraba en formato chico.
 *
 *  Este helper devuelve el bloque completo para que eso no vuelva a pasar. */
export function pageMeta(opts: {
  title: string;
  description: string;
  path?: string;
  /** Idioma del render. Con él, `og:url` es la MISMA URL que el canonical (la
   *  de ese idioma) y `og:locale` dice cuál es. Sin él, inglés. */
  lang?: Lang;
  /** Imagen propia para compartir (default: la de la home). Va explícita y no
   *  solo por el `opengraph-image.tsx` del segmento: ese archivo no llega a
   *  las rutas hijas (las salas de /aleph seguían con el joystick) ni a
   *  twitter:image. */
  image?: string;
  /** Texto alternativo de la imagen (default: el de la home). */
  imageAlt?: string;
  type?: "website" | "article";
}) {
  const lang = opts.lang ?? "en";
  // El og:url apuntaba siempre a la URL inglesa y, en páginas dinámicas como
  // las salas de Aleph, directamente a la sección (/aleph): LinkedIn y
  // Facebook usan og:url como la URL "real" del link, así que compartir una
  // sala terminaba mostrando (y abriendo) la portada.
  const url = `${SITE.url}${opts.path ? localePath(lang, opts.path) : lang === "en" ? "" : `/${lang}`}`;
  const image = {
    url: opts.image ?? "/opengraph-image",
    width: 1200,
    height: 630,
    alt: opts.imageAlt ?? OG_ALT,
  };
  return {
    // Absoluto y con la marca puesta acá: el template del layout raíz no llega
    // a los segmentos anidados dos niveles (las salas de /aleph y los replays
    // de /watch salían sin " · Arcade1v1").
    title: { absolute: `${opts.title}${MARCA}` },
    description: opts.description,
    openGraph: {
      type: opts.type ?? ("website" as const),
      siteName: SITE.name,
      url,
      title: opts.title,
      description: opts.description,
      locale: META[lang].ogLocale,
      alternateLocale: LANGS.filter((l) => l !== lang).map((l) => META[l].ogLocale),
      images: [image],
    },
    twitter: {
      card: "summary_large_image" as const,
      title: opts.title,
      description: opts.description,
      images: [image],
    },
  };
}

/** Lo que se agrega al final de cada título (template del layout raíz). */
export const MARCA = " · Arcade1v1";

/** Texto alternativo de la imagen de la home (joystick + lema). */
export const OG_ALT = "Arcade1v1 — humans vs AI agents, on-chain, replay-verified";

/** Donde más vive Arcade1v1 (schema.org `sameAs`): el repo y los paquetes de
 *  npm. Le dicen a Google y a los motores de IA que son la misma entidad. */
export const SAME_AS = [
  "https://github.com/agustincf/Arcade1v1",
  "https://www.npmjs.com/package/@arcade1v1/mcp",
  "https://www.npmjs.com/package/@arcade1v1/agent-sdk",
];

/** `@id` de las entidades del sitio, para que el JSON-LD de cada página las
 *  referencie en vez de repetirlas. */
export const LD_ID = {
  org: `${SITE.url}/#organization`,
  site: `${SITE.url}/#website`,
};
