import type { Metadata } from "next";
import { Chivo, Chivo_Mono, Press_Start_2P } from "next/font/google";
import "./globals.css";
import { Providers } from "@/app/providers";
import { Header } from "@/app/components/Header";
import { Marquee } from "@/app/components/Marquee";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SITE, META, LD_ID, SAME_AS, MARCA } from "@/app/lib/seo";
import { GAME_SEO, PAGE_SEO } from "@/app/lib/seo-pages";
import { LANGS, type Lang } from "@/app/lib/i18n-dict";
import { localePath, stripLocale } from "@/app/lib/localePath";
import { headers } from "next/headers";
import { GAMES } from "@/app/lib/games";
import { Analytics } from "@vercel/analytics/next";
import { getLang } from "@/app/lib/serverLang";
import { getDict } from "@/app/lib/i18n/dicts.server";
import { SeoAlternates } from "@/app/components/SeoAlternates";

// Metadata POR IDIOMA: title, description y og:locale salen del idioma del
// render (header/cookie/Accept-Language), no siempre del inglés. Sin esto, las
// páginas /es y /fr mostraban en inglés el título, la descripción y la
// vista previa social.
export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  const m = META[lang] ?? META.en;
  // og:url por defecto = la URL de ESTA página en su idioma (la misma que el
  // canonical de <SeoAlternates>). Antes era siempre la home: /status, /terms
  // o /faucet compartidos en LinkedIn se presentaban como la home.
  const bare = stripLocale((await headers()).get("x-bare-path") ?? "/");
  const propia = localePath(lang, bare);
  return {
    metadataBase: new URL(SITE.url),
    title: { default: m.title, template: `%s${MARCA}` },
    description: m.description,
    applicationName: SITE.name,
    keywords: SITE.keywords,
    category: "games",
    authors: [{ name: SITE.name }],
    creator: SITE.name,
    publisher: SITE.name,
    openGraph: {
      type: "website",
      siteName: SITE.name,
      title: m.title,
      description: m.description,
      url: `${SITE.url}${propia === "/" ? "" : propia}`,
      locale: m.ogLocale,
      alternateLocale: LANGS.filter((l) => l !== lang).map((l) => META[l].ogLocale),
    },
    twitter: {
      card: "summary_large_image",
      title: m.title,
      description: m.description,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    manifest: "/manifest.webmanifest",
  };
}

// Datos estructurados (schema.org) — ayudan a Google y a los motores de IA.
// Un solo @graph con @id: la organización, el sitio y la app se referencian en
// vez de repetirse, y el JSON-LD de cada página (juego, Aleph, /agents) apunta
// a los mismos @id.
function StructuredData({ lang }: { lang: Lang }) {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": LD_ID.org,
        name: SITE.name,
        url: SITE.url,
        description: SITE.description,
        // Google pide un logo de 112 px o más: el /icon de 64 px no calificaba.
        logo: { "@type": "ImageObject", url: `${SITE.url}/icon-512`, width: 512, height: 512 },
        sameAs: SAME_AS,
      },
      {
        "@type": "WebSite",
        "@id": LD_ID.site,
        name: SITE.name,
        url: SITE.url,
        description: SITE.description,
        inLanguage: [...LANGS],
        publisher: { "@id": LD_ID.org },
      },
      {
        "@type": "WebApplication",
        name: SITE.name,
        url: SITE.url,
        applicationCategory: "GameApplication",
        operatingSystem: "Web",
        description: SITE.description,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        publisher: { "@id": LD_ID.org },
      },
      {
        "@type": "ItemList",
        name: "Games on Arcade1v1",
        itemListElement: [
          ...GAMES.filter((g) => g.status === "live").map((g) => ({
            "@type": "VideoGame",
            name: g.name,
            description: GAME_SEO[g.id]?.[lang].description,
            url: `${SITE.url}${localePath(lang, `/game/${g.id}`)}`,
            gamePlatform: "Web",
            applicationCategory: "Game",
            playMode: "MultiPlayer",
          })),
          // Aleph no es un juego de puntaje 1v1 sino el formato multi-agente,
          // pero es lo más nuevo del sitio y un motor de IA tiene que verlo acá.
          {
            "@type": "VideoGame",
            name: "Aleph",
            description: PAGE_SEO.aleph[lang].description,
            url: `${SITE.url}${localePath(lang, "/aleph")}`,
            gamePlatform: "Web",
            applicationCategory: "Game",
            playMode: "MultiPlayer",
          },
        ].map((item, i) => ({ "@type": "ListItem", position: i + 1, item })),
      },
    ],
  };
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  );
}

// FUENTES AUTO-HOSPEDADAS. Antes se pedían a Google Fonts con un <link> en el
// <head>: un pedido a un tercero que BLOQUEA el primer render, más el salto de
// layout cuando llega. next/font las sirve desde nuestro propio dominio, con el
// tamaño ya reservado.
//
// Chivo reemplaza a Inter: Inter es la tipografía por defecto de casi toda la
// UI generada, y el sitio se leía como plantilla. Chivo y Chivo Mono son de
// Omnibus-Type (Buenos Aires): una grotesca con algo deportivo y retro que
// se lee bien en 16 px, y su mono hermana para lo técnico (títulos de
// ventana, chips, código, wallets). Las dos son variables: un solo archivo
// cubre todos los pesos.
const chivo = Chivo({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-chivo",
});
const chivoMono = Chivo_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-chivo-mono",
});
const pressStart = Press_Start_2P({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-pixel",
});

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  const dict = getDict(lang);
  return (
    <html lang={lang} className={`${chivo.variable} ${chivoMono.variable} ${pressStart.variable}`}>
      <head>
        <StructuredData lang={lang} />
        <SeoAlternates />
      </head>
      <body>
        <Providers lang={lang} dict={dict}>
          <a href="#contenido" className="skip-link">
            {dict["a11y.skipToContent"] ?? "Skip to main content"}
          </a>
          <Header />
          <Marquee />
          <main id="contenido" className="mx-auto max-w-5xl px-4 py-8">
            {children}
          </main>
          <SiteFooter />
        </Providers>
        {/* Medición mínima (v4.1): páginas vistas y referrers, sin cookies.
            Solo emite datos en producción (en dev es un no-op). */}
        <Analytics />
      </body>
    </html>
  );
}
