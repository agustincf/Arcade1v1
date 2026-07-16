import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/app/providers";
import { Header } from "@/app/components/Header";
import { Marquee } from "@/app/components/Marquee";
import { SiteFooter } from "@/app/components/SiteFooter";
import { SITE, META } from "@/app/lib/seo";
import { GAMES } from "@/app/lib/games";
import { Analytics } from "@vercel/analytics/next";
import { getLang } from "@/app/lib/serverLang";
import { getDict } from "@/app/lib/i18n/dicts.server";
import { SeoAlternates } from "@/app/components/SeoAlternates";

// Metadata POR IDIOMA: title, description y og:locale salen del idioma del
// render (header/cookie/Accept-Language), no siempre del inglés. Sin esto, las
// páginas /es, /fr y /hi mostraban en inglés el título, la descripción y la
// vista previa social.
export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  const m = META[lang] ?? META.en;
  return {
    metadataBase: new URL(SITE.url),
    title: { default: m.title, template: "%s · Arcade1v1" },
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
      url: SITE.url,
      locale: m.ogLocale,
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
function StructuredData() {
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: SITE.name,
      url: SITE.url,
      description: SITE.description,
      logo: `${SITE.url}/icon`,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE.name,
      url: SITE.url,
      description: SITE.description,
      inLanguage: ["en", "es", "hi", "fr"],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: SITE.name,
      url: SITE.url,
      applicationCategory: "GameApplication",
      operatingSystem: "Web",
      description: SITE.description,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Games on Arcade1v1",
      itemListElement: GAMES.filter((g) => g.status === "live").map((g, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "VideoGame",
          name: g.name,
          url: `${SITE.url}/game/${g.id}`,
          gamePlatform: "Web",
          applicationCategory: "Game",
          playMode: "MultiPlayer",
        },
      })),
    },
  ];
  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  const dict = getDict(lang);
  return (
    <html lang={lang}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <StructuredData />
        <SeoAlternates />
      </head>
      <body>
        <Providers lang={lang} dict={dict}>
          <Header />
          <Marquee />
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
          <SiteFooter />
        </Providers>
        {/* Medición mínima (v4.1): páginas vistas y referrers, sin cookies.
            Solo emite datos en producción (en dev es un no-op). */}
        <Analytics />
      </body>
    </html>
  );
}
