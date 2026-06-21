// Configuracion central de SEO (reutilizada por metadatos, sitemap y schema.org).

export const SITE = {
  name: "Arcade1v1",
  // Cambiar por tu dominio real cuando lo tengas (o setear NEXT_PUBLIC_SITE_URL).
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://arcade1v1.app",
  title: "Arcade1v1 — Play 1v1 Games & Win USDC",
  description:
    "Arcade1v1 is a 1v1 skill-game arena: two players bet the same USDC and the higher score wins the pot. Play Tetris, Flappy, Racing and 2048 head-to-head on Base. (Testnet demo.)",
  keywords: [
    "1v1 games",
    "play games for money",
    "win USDC",
    "skill games betting",
    "crypto arcade",
    "Tetris 1v1",
    "Flappy 1v1",
    "racing game 1v1",
    "2048 1v1",
    "Base USDC",
    "head to head games",
    "duels for money",
    "play to earn arcade",
  ],
};

/** Titulos/descripciones SEO por juego (para las paginas de mesa). */
export const GAME_SEO: Record<string, { title: string; description: string }> = {
  tetris: {
    title: "Play Tetris 1v1 for USDC",
    description:
      "Challenge a rival to 1v1 Tetris and win the USDC pot. Highest score wins, classic arcade speed. Asynchronous, fair (shared piece order). Testnet demo on Base.",
  },
  flappy: {
    title: "Play Flappy 1v1 for USDC",
    description:
      "Go head-to-head in Flappy: dodge the pipes, outscore your rival and take the USDC pot. Fast, fair and asynchronous. Testnet demo on Base.",
  },
  racing: {
    title: "Play Racing 1v1 for USDC",
    description:
      "Dodge traffic in a neon arcade racer and beat your rival's score to win the USDC pot. Asynchronous 1v1 on Base. Testnet demo.",
  },
  "2048": {
    title: "Play 2048 1v1 for USDC",
    description:
      "Merge tiles, hit the highest number and beat your rival to win the USDC pot in 1v1 2048. Asynchronous and fair. Testnet demo on Base.",
  },
};

/** Preguntas frecuentes (en ingles, para el schema FAQPage / motores de IA). */
export const FAQ = [
  {
    q: "What is Arcade1v1?",
    a: "Arcade1v1 is a 1v1 arena where two players each bet the same amount of USDC and the higher score wins the pot.",
  },
  {
    q: "Which games can I play?",
    a: "Tetris, Flappy 1v1, Racing and 2048 — all head-to-head, asynchronous and score-based: the highest score wins.",
  },
  {
    q: "How does the money work?",
    a: "Both players deposit USDC into a smart-contract escrow on Base. The platform keeps a 15% commission and the winner takes the rest. If no rival appears within 1 hour, you are fully refunded.",
  },
  {
    q: "Is it live with real money?",
    a: "Not yet. Arcade1v1 currently runs on the Base Sepolia testnet with play money while it is being built and audited.",
  },
];
