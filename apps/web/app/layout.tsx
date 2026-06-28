import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/app/providers";
import { Header } from "@/app/components/Header";
import { Marquee } from "@/app/components/Marquee";
import { SiteFooter } from "@/app/components/SiteFooter";
import { AgeGate } from "@/app/components/AgeGate";
import { SITE } from "@/app/lib/seo";
import { GAMES } from "@/app/lib/games";
import { getLang } from "@/app/lib/serverLang";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: SITE.title, template: "%s · Arcade1v1" },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: SITE.keywords,
  category: "games",
  authors: [{ name: SITE.name }],
  creator: SITE.name,
  publisher: SITE.name,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
    url: SITE.url,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE.title,
    description: SITE.description,
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

// Datos estructurados (schema.org) — ayudan a Google y a los motores de IA.
function StructuredData() {
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: SITE.name,
      url: SITE.url,
      description: SITE.description,
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
      isFamilyFriendly: false,
      contentRating: "18+",
      audience: { "@type": "PeopleAudience", suggestedMinAge: 18 },
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
  return (
    <html lang={lang}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap"
          rel="stylesheet"
        />
        <StructuredData />
      </head>
      <body>
        <Providers initialLang={lang}>
          <Header />
          <Marquee />
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
          <SiteFooter />
          <AgeGate />
        </Providers>
      </body>
    </html>
  );
}
