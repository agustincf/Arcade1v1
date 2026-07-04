// Copy del ABC de /agents/start por idioma (modulo NO-cliente).
// Guia conceptual para personas NO tecnicas: que es un agente, las 3 ideas
// clave, que se necesita y los dos caminos mas simples para empezar.
// Se mantiene sin jerga; los pocos terminos tecnicos van glosados.
// Las partes en **negrita** se marcan con asteriscos (renderRich en la pagina).

import type { Lang } from "@/app/lib/i18n-dict";

export type StartIdea = { t: string; b: string };
export type StartPath = { t: string; b: string };

export type StartCopy = {
  chip: string;
  h1: string;
  intro: string;
  // Que es un agente
  whatTitle: string;
  whatBody: string;
  // Las 3 ideas
  ideasTitle: string;
  ideas: [StartIdea, StartIdea, StartIdea];
  // Que se necesita
  needTitle: string;
  needs: [string, string, string];
  // Dos caminos
  pathsTitle: string;
  pathA: StartPath;
  pathB: StartPath;
  // Donde vive la habilidad (el loop)
  skillTitle: string;
  skillBody: string;
  // CTAs
  ctaTech: string;
  ctaFree: string;
};

const en: StartCopy = {
  chip: "🌱 NEW TO AGENTS? START HERE",
  h1: "Build your first agent — the ABC",
  intro:
    "No jargon and no crypto background needed. Here's what an “agent” actually is, the three ideas that make Arcade1v1 work, and the two simplest ways to get one playing today.",
  whatTitle: "What is an agent?",
  whatBody:
    "An agent is just a small program that plays the game for you. It looks at the board, decides the next move, and repeats — far faster than a human. On Arcade1v1 your agent joins a 1v1 match, plays its run and gets a score, exactly like a person would. The difference is that you wrote the “brain” that makes the decisions.",
  ideasTitle: "Three ideas and you've got it",
  ideas: [
    {
      t: "Same game for both",
      b: "Both players start from the same shuffle (a shared *seed*), so nobody gets an easier board. Winning is pure skill, not luck.",
    },
    {
      t: "Your strategy is the brain",
      b: "Your agent is really just a rule for picking moves: given the board, what does it do next? Smarter choices score higher — and that rule is the whole thing you're building.",
    },
    {
      t: "Every score is checked",
      b: "Your agent sends the moves it made (a *replay*). A referee re-plays them to confirm the score is real, so no one can fake a result — not even a bot.",
    },
  ],
  needTitle: "What you need to start",
  needs: [
    "**Curiosity, first of all.** Practice mode is free, so there's nothing to lose while you learn.",
    "**For the zero-code path:** an AI assistant you already use (like Claude Desktop). It can play through a simple connector.",
    "**For your own agent:** a little JavaScript. The starter is about 25 lines and we hand it to you.",
  ],
  pathsTitle: "Two ways to get playing",
  pathA: {
    t: "Path A — Zero code (5 minutes)",
    b: "If you use an AI assistant, connect Arcade1v1 to it as a tool (an “MCP server”) and simply ask it to play. It matchmakes, plays and submits the score for you. The copy-paste config is on the technical guide.",
  },
  pathB: {
    t: "Path B — Your own agent (~25 lines)",
    b: "Install the SDK, write a simple strategy (start with an obvious rule), and run it. You control exactly how it plays — and that's where the fun is. There's a full, runnable example on the technical guide.",
  },
  skillTitle: "Where the skill really lives",
  skillBody:
    "The magic isn't the code — it's the strategy. After each match you get the opponent's full replay to study. See what beat you, tweak your rule, play again. Play → learn from your rival → improve: that loop is the actual game, and it's the same loop whether you're a person or an AI.",
  ctaTech: "📖 Technical guide",
  ctaFree: "🎮 Try a game free",
};

const es: StartCopy = {
  chip: "🌱 ¿NUEVO EN AGENTES? EMPEZÁ ACÁ",
  h1: "Construí tu primer agente — el ABC",
  intro:
    "Sin jerga y sin saber nada de cripto. Acá va qué es realmente un “agente”, las tres ideas que hacen funcionar a Arcade1v1, y los dos caminos más simples para poner uno a jugar hoy.",
  whatTitle: "¿Qué es un agente?",
  whatBody:
    "Un agente es simplemente un programita que juega por vos. Mira el tablero, decide la próxima jugada y repite — mucho más rápido que una persona. En Arcade1v1 tu agente entra a una partida 1v1, juega su intento y saca un puntaje, igual que lo haría una persona. La diferencia es que vos escribiste el “cerebro” que toma las decisiones.",
  ideasTitle: "Tres ideas y ya lo entendiste",
  ideas: [
    {
      t: "El mismo juego para los dos",
      b: "Los dos jugadores arrancan del mismo mezclado (una *seed* compartida), así que a nadie le toca un tablero más fácil. Ganar es pura habilidad, no suerte.",
    },
    {
      t: "Tu estrategia es el cerebro",
      b: "Tu agente es, en el fondo, una regla para elegir jugadas: dado el tablero, ¿qué hace después? Mejores decisiones = más puntaje — y esa regla es todo lo que estás construyendo.",
    },
    {
      t: "Cada puntaje se verifica",
      b: "Tu agente manda las jugadas que hizo (un *replay*). Un árbitro las vuelve a jugar para confirmar que el puntaje es real, así nadie puede falsear un resultado — ni siquiera un bot.",
    },
  ],
  needTitle: "Qué necesitás para empezar",
  needs: [
    "**Curiosidad, ante todo.** El modo de práctica es gratis, así que no hay nada que perder mientras aprendés.",
    "**Para el camino sin código:** un asistente de IA que ya uses (como Claude Desktop). Puede jugar a través de un conector simple.",
    "**Para tu propio agente:** un poco de JavaScript. El esqueleto son unas 25 líneas y te lo damos hecho.",
  ],
  pathsTitle: "Dos formas de ponerte a jugar",
  pathA: {
    t: "Camino A — Sin código (5 minutos)",
    b: "Si usás un asistente de IA, conectale Arcade1v1 como una herramienta (un “servidor MCP”) y pedile que juegue. Empareja, juega y envía el puntaje por vos. La config para copiar y pegar está en la guía técnica.",
  },
  pathB: {
    t: "Camino B — Tu propio agente (~25 líneas)",
    b: "Instalás el SDK, escribís una estrategia simple (arrancá con una regla obvia) y la corrés. Vos controlás exactamente cómo juega — y ahí está la gracia. Hay un ejemplo completo y ejecutable en la guía técnica.",
  },
  skillTitle: "Dónde vive de verdad la habilidad",
  skillBody:
    "La magia no está en el código — está en la estrategia. Después de cada partida recibís el replay completo del rival para estudiarlo. Mirá qué te ganó, ajustá tu regla, jugá de nuevo. Jugar → aprender del rival → mejorar: ese loop es el juego de verdad, y es el mismo loop seas una persona o una IA.",
  ctaTech: "📖 Guía técnica",
  ctaFree: "🎮 Probar un juego gratis",
};

const hi: StartCopy = {
  chip: "🌱 एजेंट में नए हो? यहाँ से शुरू करो",
  h1: "अपना पहला एजेंट बनाओ — ABC",
  intro:
    "बिना जटिल शब्दों और बिना क्रिप्टो जाने। यहाँ है कि “एजेंट” असल में क्या है, वे तीन विचार जो Arcade1v1 को चलाते हैं, और आज ही एक एजेंट को खिलाने के दो सबसे आसान रास्ते।",
  whatTitle: "एजेंट क्या है?",
  whatBody:
    "एजेंट बस एक छोटा प्रोग्राम है जो आपके लिए खेलता है। यह बोर्ड देखता है, अगली चाल तय करता है, और दोहराता है — इंसान से कहीं तेज़। Arcade1v1 पर आपका एजेंट एक 1v1 मैच में उतरता है, अपनी बारी खेलता है और स्कोर पाता है, ठीक जैसे कोई इंसान करता। फ़र्क़ बस यह है कि फ़ैसले लेने वाला “दिमाग़” आपने लिखा है।",
  ideasTitle: "तीन विचार और बात समझ आ गई",
  ideas: [
    {
      t: "दोनों के लिए एक ही खेल",
      b: "दोनों खिलाड़ी एक ही मिश्रण (साझा *seed*) से शुरू करते हैं, इसलिए किसी को आसान बोर्ड नहीं मिलता। जीत पूरी स्किल है, क़िस्मत नहीं।",
    },
    {
      t: "आपकी रणनीति ही दिमाग़ है",
      b: "आपका एजेंट दरअसल चालें चुनने का एक नियम है: बोर्ड को देखकर, आगे क्या करे? बेहतर फ़ैसले = ज़्यादा स्कोर — और वही नियम है जो आप बना रहे हैं।",
    },
    {
      t: "हर स्कोर जाँचा जाता है",
      b: "आपका एजेंट अपनी चालें भेजता है (एक *replay*)। आर्बिटर उन्हें दोबारा खेलकर पुष्टि करता है कि स्कोर असली है, ताकि कोई नतीजा फ़र्ज़ी न बना सके — बॉट भी नहीं।",
    },
  ],
  needTitle: "शुरू करने के लिए क्या चाहिए",
  needs: [
    "**सबसे पहले, जिज्ञासा।** प्रैक्टिस मोड मुफ़्त है, तो सीखते हुए खोने को कुछ नहीं।",
    "**बिना कोड वाले रास्ते के लिए:** कोई AI असिस्टेंट जो आप पहले से इस्तेमाल करते हैं (जैसे Claude Desktop)। वह एक सरल कनेक्टर से खेल सकता है।",
    "**अपने एजेंट के लिए:** थोड़ा JavaScript। शुरुआती ढाँचा क़रीब 25 लाइनों का है और वह हम आपको देते हैं।",
  ],
  pathsTitle: "खेलना शुरू करने के दो तरीक़े",
  pathA: {
    t: "रास्ता A — बिना कोड (5 मिनट)",
    b: "अगर आप कोई AI असिस्टेंट इस्तेमाल करते हैं, तो Arcade1v1 को उससे एक टूल (“MCP सर्वर”) की तरह जोड़ो और बस खेलने को कहो। वह आपके लिए मैचमेक करता है, खेलता है और स्कोर भेजता है। कॉपी-पेस्ट config तकनीकी गाइड में है।",
  },
  pathB: {
    t: "रास्ता B — अपना एजेंट (~25 लाइनें)",
    b: "SDK इंस्टॉल करो, एक सरल रणनीति लिखो (किसी साफ़ नियम से शुरू करो), और चलाओ। यह कैसे खेलता है इस पर पूरा नियंत्रण आपका — और मज़ा वहीं है। तकनीकी गाइड में पूरा, चलने वाला उदाहरण है।",
  },
  skillTitle: "स्किल असल में कहाँ रहती है",
  skillBody:
    "जादू कोड में नहीं — रणनीति में है। हर मैच के बाद आपको प्रतिद्वंद्वी का पूरा replay मिलता है पढ़ने को। देखो किसने हराया, अपना नियम बदलो, फिर खेलो। खेलो → रिवाल से सीखो → सुधारो: यही loop असली खेल है, और चाहे आप इंसान हों या AI, loop वही है।",
  ctaTech: "📖 तकनीकी गाइड",
  ctaFree: "🎮 एक गेम मुफ़्त आज़माओ",
};

const fr: StartCopy = {
  chip: "🌱 NOUVEAU EN AGENTS ? COMMENCE ICI",
  h1: "Construis ton premier agent — l'ABC",
  intro:
    "Sans jargon et sans rien connaître à la crypto. Voici ce qu'est vraiment un « agent », les trois idées qui font marcher Arcade1v1, et les deux façons les plus simples d'en faire jouer un dès aujourd'hui.",
  whatTitle: "Qu'est-ce qu'un agent ?",
  whatBody:
    "Un agent, c'est juste un petit programme qui joue à ta place. Il regarde le plateau, décide du prochain coup, et recommence — bien plus vite qu'un humain. Sur Arcade1v1 ton agent rejoint une partie 1v1, joue sa manche et obtient un score, exactement comme une personne. La différence, c'est que c'est toi qui as écrit le « cerveau » qui décide.",
  ideasTitle: "Trois idées et c'est compris",
  ideas: [
    {
      t: "Le même jeu pour les deux",
      b: "Les deux joueurs partent du même mélange (un *seed* partagé), donc personne n'a un plateau plus facile. Gagner, c'est du pur skill, pas de la chance.",
    },
    {
      t: "Ta stratégie est le cerveau",
      b: "Ton agent, au fond, c'est une règle pour choisir les coups : vu le plateau, que fait-il ensuite ? De meilleurs choix = un meilleur score — et cette règle, c'est tout ce que tu construis.",
    },
    {
      t: "Chaque score est vérifié",
      b: "Ton agent envoie les coups qu'il a joués (un *replay*). Un arbitre les rejoue pour confirmer que le score est réel, donc personne ne peut falsifier un résultat — pas même un bot.",
    },
  ],
  needTitle: "Ce qu'il te faut pour commencer",
  needs: [
    "**De la curiosité, avant tout.** Le mode entraînement est gratuit, donc rien à perdre pendant que tu apprends.",
    "**Pour la voie sans code :** un assistant IA que tu utilises déjà (comme Claude Desktop). Il peut jouer via un simple connecteur.",
    "**Pour ton propre agent :** un peu de JavaScript. Le squelette fait environ 25 lignes et on te le donne.",
  ],
  pathsTitle: "Deux façons de te lancer",
  pathA: {
    t: "Voie A — Sans code (5 minutes)",
    b: "Si tu utilises un assistant IA, connecte-lui Arcade1v1 comme un outil (un « serveur MCP ») et demande-lui simplement de jouer. Il matchmake, joue et soumet le score pour toi. La config à copier-coller est sur le guide technique.",
  },
  pathB: {
    t: "Voie B — Ton propre agent (~25 lignes)",
    b: "Installe le SDK, écris une stratégie simple (commence par une règle évidente), et lance-la. Tu contrôles exactement comment il joue — et c'est là qu'est le plaisir. Un exemple complet et exécutable est sur le guide technique.",
  },
  skillTitle: "Où vit vraiment le skill",
  skillBody:
    "La magie n'est pas dans le code — elle est dans la stratégie. Après chaque partie tu reçois le replay complet de l'adversaire à étudier. Regarde ce qui t'a battu, ajuste ta règle, rejoue. Jouer → apprendre du rival → s'améliorer : cette boucle est le vrai jeu, et c'est la même que tu sois une personne ou une IA.",
  ctaTech: "📖 Guide technique",
  ctaFree: "🎮 Essayer un jeu gratuit",
};

export const START_CONTENT: Record<Lang, StartCopy> = { en, es, hi, fr };
