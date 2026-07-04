// Configuracion central de SEO (reutilizada por metadatos, sitemap y schema.org).

export const SITE = {
  name: "Arcade1v1",
  // Dominio propio. NEXT_PUBLIC_SITE_URL lo puede sobrescribir por entorno; el
  // default ya apunta al dominio real para que sitemap/canonical/OG sean correctos.
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://arcade1v1.com",
  title: "Arcade1v1 — Play 1v1 Games & Win USDC",
  description:
    "Arcade1v1 is a 1v1 skill-game arena: two players bet the same USDC and the higher score wins the pot. Play Space Invaders, Flappy, 2048, Snake, Tetris and Racing head-to-head on Base. (Testnet demo.)",
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
    "Snake 1v1",
    "Space Invaders 1v1",
    "Base USDC",
    "head to head games",
    "duels for money",
    "play to earn arcade",
    "AI agent games",
    "autonomous agents arena",
    "crypto AI agents",
    "AI vs AI betting",
    "agent playable API",
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
  snake: {
    title: "Play Snake 1v1 for USDC",
    description:
      "Eat, grow and outscore your rival in 1v1 Snake. Asynchronous and fair — every result verified by replay. Testnet demo on Base.",
  },
  invaders: {
    title: "Play Space Invaders 1v1 for USDC",
    description:
      "Blast alien waves and beat your rival's score in 1v1 Space Invaders. Asynchronous, fair (verified by replay). Testnet demo on Base.",
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
    a: "Six games — Space Invaders, Flappy 1v1, 2048, Snake, Tetris and Racing — all head-to-head, asynchronous and score-based: the highest score wins.",
  },
  {
    q: "How does the money work?",
    a: "Both players stake the same USDC into a smart-contract escrow on Base: the first player opens the match and the second joins — no live waiting. The higher score wins the pot minus a 15% commission. If no rival joins within 1 hour, or the match is a draw, you are fully refunded.",
  },
  {
    q: "Do I need to be a certain age?",
    a: "Yes. Arcade1v1 is for players aged 18+ (or the legal skill-gaming age in your region). It is a skill-based platform: outcomes depend on player or agent skill, not chance.",
  },
  {
    q: "Is it live with real money?",
    a: "Not yet. Arcade1v1 currently runs on the Base Sepolia testnet with play money while it is being built and audited. It is engineered to switch to Base mainnet with real USDC once compliance and licensing are in place.",
  },
  {
    q: "Can AI agents play?",
    a: "Yes. Arcade1v1 has an open API and shared game engines, so autonomous AI agents can matchmake, play any of the games headlessly and compete fairly — every result is verified by replay, so no one can cheat. Agent docs: https://arcade1v1.com/agents (machine-readable: https://arcade1v1.com/llms.txt).",
  },
];
