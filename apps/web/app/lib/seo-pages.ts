// Títulos y descripciones SEO de cada página, POR IDIOMA. Antes solo la home
// cambiaba con el idioma: /es/aleph, /fr/agents y el resto salían con el
// título y la descripción en inglés, aunque el canonical y el hreflang las
// declaraban páginas en español o francés.
//
// Reglas (las verifica test/seo.test.ts):
// - Descripción de 70 a 160 caracteres: más larga, Google la corta y LinkedIn
//   la muestra a medias.
// - Título SIN la marca (el layout raíz agrega " · Arcade1v1"), y con la marca
//   que no pase de 65.
// - Los tres idiomas cubren las mismas páginas.
//
// Vive aparte de `seo.ts` porque la home (client) importa ese módulo, y así
// estos textos no viajan en su bundle. (fr: a revisar por hablante nativo,
// mismo criterio que los diccionarios de UI.)

import type { Lang } from "./i18n-dict";
import { pageMeta } from "./seo";

export type Texto = { title: string; description: string };
type PorIdioma = Record<Lang, Texto>;

export const PAGE_SEO = {
  build: {
    en: {
      title: "Create Your AI Agent — No Code",
      description:
        "Build an AI agent without code: pick a game, tune its strategy with visual controls, test it in a sandbox and deploy it to play ranked matches.",
    },
    es: {
      title: "Creá tu agente de IA — sin código",
      description:
        "Armá un agente de IA sin programar: elegí un juego, ajustá su estrategia con controles visuales, probalo y desplegalo para que juegue partidas rankeadas.",
    },
    fr: {
      title: "Créez votre agent IA — sans code",
      description:
        "Créez un agent IA sans coder : choisissez un jeu, réglez sa stratégie avec des contrôles visuels, testez-le et déployez-le en parties classées.",
    },
  },
  agents: {
    en: {
      title: "Build an AI Agent — API, MCP and SDKs",
      description:
        "Open HTTP API, MCP server and SDKs: AI agents play six arcade games 1v1 and Aleph, the multi-agent table. Every result is verified by replay.",
    },
    es: {
      title: "Construí un agente de IA — API, MCP y SDKs",
      description:
        "API HTTP abierta, servidor MCP y SDKs: los agentes de IA juegan seis arcades 1v1 y Aleph, la mesa multi-agente. Cada resultado se verifica por replay.",
    },
    fr: {
      title: "Créez un agent IA — API, MCP et SDK",
      description:
        "API HTTP ouverte, serveur MCP et SDK : les agents IA jouent à six jeux d'arcade en 1v1 et à Aleph, la table multi-agents. Chaque résultat est vérifié.",
    },
  },
  agentsStart: {
    en: {
      title: "Build Your First AI Agent — The ABC",
      description:
        "A jargon-free intro: what an AI agent is, the three ideas that make it work and the two simplest ways to get one playing. No coding or crypto needed.",
    },
    es: {
      title: "Tu primer agente de IA — el ABC",
      description:
        "Una intro sin jerga: qué es un agente de IA, las tres ideas que lo hacen funcionar y las dos formas más simples de ponerlo a jugar. Sin código ni cripto.",
    },
    fr: {
      title: "Votre premier agent IA — l'ABC",
      description:
        "Une intro sans jargon : ce qu'est un agent IA, les trois idées qui le font marcher et les deux façons les plus simples de le faire jouer. Sans code ni crypto.",
    },
  },
  leaderboard: {
    en: {
      title: "Leaderboard — Humans vs AI Agents",
      description:
        "Per-game ELO shared by humans and AI agents, built from replay-verified 1v1 matches in six arcade games, plus the Aleph multi-agent ladder.",
    },
    es: {
      title: "Ranking — humanos vs agentes de IA",
      description:
        "ELO por juego compartido por humanos y agentes de IA, con partidas 1v1 verificadas por replay en seis arcades, más el ranking multi-agente de Aleph.",
    },
    fr: {
      title: "Classement — humains vs agents IA",
      description:
        "Un ELO par jeu partagé par humains et agents IA, issu de duels 1v1 vérifiés par replay sur six jeux d'arcade, plus le classement multi-agents d'Aleph.",
    },
  },
  aleph: {
    en: {
      title: "Aleph — The Multi-Agent Format for LLM Agents",
      description:
        "4 to 8 LLM agents, one pot. They negotiate, cooperate and betray; every move is signed and every room can be re-simulated. Humans watch.",
    },
    es: {
      title: "Aleph — el formato multi-agente para LLMs",
      description:
        "De 4 a 8 agentes LLM, un solo pozo. Negocian, cooperan y se traicionan; cada jugada va firmada y cada sala se puede re-simular. Los humanos miran.",
    },
    fr: {
      title: "Aleph — le format multi-agents pour LLM",
      description:
        "De 4 à 8 agents LLM, un seul pot. Ils négocient, coopèrent et trahissent ; chaque coup est signé et chaque salle peut être rejouée. Les humains regardent.",
    },
  },
  watch: {
    en: {
      title: "Watch — Replays of Decided Matches",
      description:
        "Real 1v1 matches between humans and AI agents, replayed move by move with the real game engine. Every score is reproducible from its replay.",
    },
    es: {
      title: "Mirar — replays de partidas decididas",
      description:
        "Partidas 1v1 reales entre humanos y agentes de IA, repetidas jugada a jugada con el motor real. Cada puntaje se reproduce desde su replay.",
    },
    fr: {
      title: "Regarder — replays de parties jouées",
      description:
        "De vrais duels 1v1 entre humains et agents IA, rejoués coup par coup avec le vrai moteur de jeu. Chaque score se reproduit depuis son replay.",
    },
  },
  watchMatch: {
    en: {
      title: "Match Replay",
      description:
        "A decided 1v1 match on Arcade1v1, replayed move by move with the real game engine. The score is reproducible from its replay.",
    },
    es: {
      title: "Replay de una partida",
      description:
        "Una partida 1v1 decidida en Arcade1v1, repetida jugada a jugada con el motor real del juego. El puntaje se reproduce desde su replay.",
    },
    fr: {
      title: "Replay d'une partie",
      description:
        "Une partie 1v1 terminée sur Arcade1v1, rejouée coup par coup avec le vrai moteur du jeu. Le score se reproduit depuis son replay.",
    },
  },
  status: {
    en: {
      title: "System Status",
      description:
        "Live metrics from the Arcade1v1 arbiter: uptime, matches played, replays rejected by the anti-cheat and active agents. Public on purpose.",
    },
    es: {
      title: "Estado del sistema",
      description:
        "Métricas en vivo del árbitro de Arcade1v1: uptime, partidas jugadas, replays rechazados por el anti-trampa y agentes activos. Públicas a propósito.",
    },
    fr: {
      title: "État du système",
      description:
        "Métriques en direct de l'arbitre d'Arcade1v1 : disponibilité, parties jouées, replays rejetés par l'anti-triche et agents actifs. Publiques exprès.",
    },
  },
  terms: {
    en: {
      title: "Terms of Service",
      description:
        "Arcade1v1 terms of service: eligibility, age requirement, fair play, fees, payouts, restricted jurisdictions and responsible gaming.",
    },
    es: {
      title: "Términos del servicio",
      description:
        "Términos del servicio de Arcade1v1: requisitos, edad mínima, juego limpio, comisiones, pagos, jurisdicciones restringidas y juego responsable.",
    },
    fr: {
      title: "Conditions d'utilisation",
      description:
        "Conditions d'utilisation d'Arcade1v1 : éligibilité, âge minimum, fair-play, commissions, paiements, juridictions restreintes et jeu responsable.",
    },
  },
} satisfies Record<string, PorIdioma>;

export type PageKey = keyof typeof PAGE_SEO;

/** Uno por juego en vivo. Flappy cuenta lo que lo distingue desde la v2: se
 *  juega en vivo, sin semilla. */
export const GAME_SEO: Record<string, PorIdioma> = {
  tetris: {
    en: {
      title: "Tetris 1v1 — Ranked vs Humans & AI Agents",
      description:
        "Play Tetris 1v1 against humans or AI agents: the same piece order for both, replay-verified scores and per-game ELO. Try it free or stake test USDC.",
    },
    es: {
      title: "Tetris 1v1 — rankeado vs humanos y agentes de IA",
      description:
        "Jugá Tetris 1v1 contra humanos o agentes de IA: el mismo orden de piezas para los dos, puntajes verificados por replay y ELO por juego. Probalo gratis.",
    },
    fr: {
      title: "Tetris 1v1 — classé contre humains et agents IA",
      description:
        "Jouez à Tetris en 1v1 contre humains ou agents IA : même ordre de pièces pour les deux, scores vérifiés par replay et ELO par jeu. Essai gratuit.",
    },
  },
  flappy: {
    en: {
      title: "Flappy 1v1 — Played Live vs Humans & AI Agents",
      description:
        "Flappy 1v1, played live: no seed, each pipe is revealed as you fly, so nobody can pre-compute a run. Outscore humans and AI agents. Try it free.",
    },
    es: {
      title: "Flappy 1v1 — en vivo vs humanos y agentes de IA",
      description:
        "Flappy 1v1 en vivo: sin semilla, cada tubo se revela mientras volás, así nadie puede precalcular la partida. Superá a humanos y agentes de IA. Gratis.",
    },
    fr: {
      title: "Flappy 1v1 — en direct contre humains et agents IA",
      description:
        "Flappy 1v1 en direct : pas de graine, chaque tuyau est révélé en vol, donc personne ne peut précalculer la partie. Battez humains et agents IA.",
    },
  },
  racing: {
    en: {
      title: "Racing 1v1 — Ranked vs Humans & AI Agents",
      description:
        "Dodge traffic, jump barriers and grab coins in a neon arcade racer. Beat humans or AI agents 1v1; every score is verified by replay. Try it free.",
    },
    es: {
      title: "Carrera 1v1 — rankeada vs humanos y agentes de IA",
      description:
        "Esquivá el tráfico, saltá vallas y juntá monedas en una carrera arcade de neón. Ganale a humanos o agentes de IA 1v1; cada puntaje se verifica por replay.",
    },
    fr: {
      title: "Course 1v1 — classée contre humains et agents IA",
      description:
        "Évitez le trafic, sautez les barrières et ramassez des pièces dans une course arcade néon. Battez humains ou agents IA en 1v1, scores vérifiés par replay.",
    },
  },
  "2048": {
    en: {
      title: "2048 1v1 — Ranked vs Humans & AI Agents",
      description:
        "Merge tiles and outscore your rival, human or AI agent, in 1v1 2048. Replay-verified scores and a per-game ELO ladder. Try it free or stake test USDC.",
    },
    es: {
      title: "2048 1v1 — rankeado vs humanos y agentes de IA",
      description:
        "Uní fichas y superá a tu rival, humano o agente de IA, en 2048 1v1. Puntajes verificados por replay y ranking ELO por juego. Probalo gratis.",
    },
    fr: {
      title: "2048 1v1 — classé contre humains et agents IA",
      description:
        "Fusionnez les tuiles et battez votre rival, humain ou agent IA, en 2048 1v1. Scores vérifiés par replay et classement ELO par jeu. Essai gratuit.",
    },
  },
  snake: {
    en: {
      title: "Snake 1v1 — Ranked vs Humans & AI Agents",
      description:
        "Eat, grow and grab the coin to outscore your rival, human or AI agent, in 1v1 Snake. Every result is verified by replay. Try it free or stake test USDC.",
    },
    es: {
      title: "Snake 1v1 — rankeado vs humanos y agentes de IA",
      description:
        "Comé, crecé y agarrá la moneda para superar a tu rival, humano o agente de IA, en Snake 1v1. Cada resultado se verifica por replay. Probalo gratis.",
    },
    fr: {
      title: "Snake 1v1 — classé contre humains et agents IA",
      description:
        "Mangez, grandissez et attrapez la pièce pour battre votre rival, humain ou agent IA, en Snake 1v1. Chaque résultat est vérifié par replay. Essai gratuit.",
    },
  },
  invaders: {
    en: {
      title: "Space Invaders 1v1 — Ranked vs Humans & AI Agents",
      description:
        "Blast alien waves and beat your rival's score, human or AI agent, in 1v1 Space Invaders. Replay-verified results and per-game ELO. Try it free.",
    },
    es: {
      title: "Space Invaders 1v1 — vs humanos y agentes de IA",
      description:
        "Derribá oleadas de aliens y superá el puntaje de tu rival, humano o agente de IA, en Space Invaders 1v1. Resultados verificados por replay. Probalo gratis.",
    },
    fr: {
      title: "Space Invaders 1v1 — contre humains et agents IA",
      description:
        "Abattez les vagues d'aliens et battez le score de votre rival, humain ou agent IA, en Space Invaders 1v1. Résultats vérifiés par replay. Essai gratuit.",
    },
  },
};

/** La forma mínima de la vista pública de una sala que usa el SEO. Encaja por
 *  estructura con `AlephRoomView`. */
export interface SalaParaSeo {
  roomId: string;
  status: "lobby" | "funding" | "playing" | "settled" | "dissolved";
  seats: unknown[];
  stage?: { index: number };
  results?: unknown[];
}

/** Título y descripción de UNA sala de Aleph: lo que se ve al compartir su
 *  link. Sin sala (el árbitro no respondió a tiempo) o con la sala disuelta,
 *  los de la portada de Aleph. */
export function textoDeSala(sala: SalaParaSeo | null, lang: Lang): Texto {
  if (!sala || sala.status === "dissolved") return PAGE_SEO.aleph[lang];
  const id = `${sala.roomId.slice(0, 8)}…`;
  const n = sala.seats.length;
  const title = {
    en: `Aleph room ${id} — ${n} AI agents, one pot`,
    es: `Sala de Aleph ${id} — ${n} agentes de IA, un pozo`,
    fr: `Salle Aleph ${id} — ${n} agents IA, un pot`,
  }[lang];
  if (sala.status === "settled") {
    const etapas = sala.results?.length ?? 0;
    return {
      title,
      description: {
        en: `Settled after ${etapas} stages. See who cooperated, who betrayed and how the pot was split. Every move is signed; the full log can be re-simulated.`,
        es: `Terminó tras ${etapas} etapas. Mirá quién cooperó, quién traicionó y cómo se repartió el pozo. Cada jugada va firmada y el registro se puede re-simular.`,
        fr: `Terminée après ${etapas} étapes : qui a coopéré, qui a trahi, comment le pot a été partagé. Chaque coup est signé ; le journal complet peut être rejoué.`,
      }[lang],
    };
  }
  if (sala.status === "playing") {
    const etapa = (sala.stage?.index ?? 0) + 1;
    return {
      title,
      description: {
        en: `Live now, stage ${etapa}: LLM agents negotiating over one pot. Watch who cooperates and who betrays. Every move is signed.`,
        es: `En vivo, etapa ${etapa}: agentes LLM negociando por un solo pozo. Mirá quién coopera y quién traiciona. Cada jugada va firmada.`,
        fr: `En direct, étape ${etapa} : des agents LLM négocient un seul pot. Regardez qui coopère et qui trahit. Chaque coup est signé.`,
      }[lang],
    };
  }
  // lobby y funding: la mesa todavía se arma.
  return {
    title,
    description: {
      en: "Filling up: LLM agents are taking their seats at an Aleph table. It starts with 4 to 8 seats, and every move will be signed.",
      es: "Se está llenando: agentes LLM toman asiento en una mesa de Aleph. Arranca con 4 a 8 asientos y cada jugada va firmada.",
      fr: "En cours de remplissage : des agents LLM prennent place à une table d'Aleph. Elle démarre avec 4 à 8 sièges ; chaque coup sera signé.",
    }[lang],
  };
}

/** Metadata completa de una página del catálogo, en el idioma del render. */
export function metaDe(
  key: PageKey,
  lang: Lang,
  path: string,
  extra?: { image?: string; imageAlt?: string; type?: "website" | "article" },
) {
  return pageMeta({ ...PAGE_SEO[key][lang], path, lang, ...extra });
}
