// Copy de /terms por idioma (modulo NO-cliente).
// "en" es verbatim al texto historico de la pagina (SEO/legal). Las demas
// son traducciones fieles. Las partes en negrita se marcan con **texto**.

import type { Lang } from "@/app/lib/i18n-dict";

export type TermsSection = {
  n: string;
  title: string;
  body: string;
};

export type TermsCopy = {
  title: string;
  updated: string;
  intro: string;
  sections: TermsSection[];
};

const en: TermsCopy = {
  title: "Terms of Service",
  updated: "Last updated: 2026 · Skill-gaming platform",
  intro:
    "Arcade1v1 is currently running on a **test network with play money**. The terms below also govern any future real-money operation. By using Arcade1v1 you agree to them.",
  sections: [
    {
      n: "1",
      title: "Eligibility & age",
      body: "You must be at least **18 years old** (or the legal age for skill-based gaming in your jurisdiction, whichever is higher) and have full legal capacity to enter into this agreement. By using the service you confirm you meet these requirements.",
    },
    {
      n: "2",
      title: "Nature of the service",
      body: "Arcade1v1 is a **skill-based 1v1 arena**. Two players each stake the same amount of USDC and the player with the **higher score wins the pot**, minus a platform fee. Outcomes are determined by player (or agent) skill, not by chance. Games are asynchronous and verified by replay.",
    },
    {
      n: "3",
      title: "Restricted jurisdictions",
      body: "The service is not available to persons located in jurisdictions where skill-gaming for value is prohibited or restricted. You are responsible for ensuring your use is lawful where you are. We may restrict access by region.",
    },
    {
      n: "4",
      title: "Wallets & funds",
      body: "Arcade1v1 is **non-custodial**: you connect your own wallet and your funds are held by an audited smart-contract escrow on Base, not by us. You are responsible for the security of your wallet and private keys.",
    },
    {
      n: "5",
      title: "Stakes, fees & payouts",
      body: "Both players deposit the same stake into escrow. The platform retains a **15% commission** on the pot; the winner receives the remainder. Payouts are executed on-chain by the smart contract. If no opponent joins within the time window, or the match ends in a draw, deposits are refunded.",
    },
    {
      n: "6",
      title: "Fair play & anti-cheat",
      body: "Every result is verified by re-playing the recorded inputs against a shared deterministic engine. Fabricated scores are rejected. Cheating, exploiting, or manipulating matches may result in forfeiture and a ban. Using your own better skill or AI policy is legitimate and allowed.",
    },
    {
      n: "7",
      title: "Responsible gaming",
      body: "Play for entertainment and never stake more than you can afford to lose. Set yourself limits and take breaks. If gaming stops being fun or feels out of control, seek help (e.g., your national problem-gambling helpline). We support self-exclusion on request.",
    },
    {
      n: "8",
      title: "Disclaimers & liability",
      body: "The service is provided “as is”, on a test network, while it is being built and audited. To the maximum extent permitted by law, we are not liable for losses arising from use of the service, smart-contract risk, network issues, or third-party wallets. Nothing here removes rights that cannot be waived.",
    },
    {
      n: "9",
      title: "Changes",
      body: "We may update these terms; the “last updated” date will change. Continued use after changes means you accept the updated terms.",
    },
    {
      n: "10",
      title: "Contact",
      body: "Questions about these terms: reach out via the channels listed on the site.",
    },
  ],
};

const es: TermsCopy = {
  title: "Términos del Servicio",
  updated: "Última actualización: 2026 · Plataforma de skill-gaming",
  intro:
    "Arcade1v1 actualmente corre en una **testnet con dinero de prueba**. Los términos de abajo también rigen cualquier operación futura con dinero real. Al usar Arcade1v1 los aceptás.",
  sections: [
    {
      n: "1",
      title: "Elegibilidad y edad",
      body: "Tenés que tener al menos **18 años** (o la edad legal para skill-gaming en tu jurisdicción, la que sea mayor) y plena capacidad legal para celebrar este acuerdo. Al usar el servicio confirmás que cumplís estos requisitos.",
    },
    {
      n: "2",
      title: "Naturaleza del servicio",
      body: "Arcade1v1 es una **arena 1v1 basada en habilidad**. Dos jugadores apuestan el mismo monto en USDC y el jugador con el **mayor puntaje se lleva el pozo**, menos una comisión de la plataforma. Los resultados dependen de la habilidad del jugador (o agente), no del azar. Las partidas son asincrónicas y se verifican por replay.",
    },
    {
      n: "3",
      title: "Jurisdicciones restringidas",
      body: "El servicio no está disponible para personas ubicadas en jurisdicciones donde el skill-gaming por dinero esté prohibido o restringido. Sos responsable de asegurarte de que tu uso sea legal donde estés. Podemos restringir el acceso por región.",
    },
    {
      n: "4",
      title: "Wallets y fondos",
      body: "Arcade1v1 es **no-custodial**: conectás tu propia wallet y tus fondos quedan en un escrow de contrato inteligente auditado en Base, no en nuestro poder. Sos responsable de la seguridad de tu wallet y tus claves privadas.",
    },
    {
      n: "5",
      title: "Apuestas, comisiones y pagos",
      body: "Los dos jugadores depositan la misma apuesta en el escrow. La plataforma retiene una **comisión del 15%** sobre el pozo; el ganador recibe el resto. Los pagos se ejecutan on-chain por el contrato inteligente. Si ningún rival se une dentro de la ventana de tiempo, o la partida termina en empate, se reembolsan los depósitos.",
    },
    {
      n: "6",
      title: "Juego limpio y anti-trampa",
      body: "Cada resultado se verifica re-jugando los inputs grabados contra un motor determinista compartido. Los puntajes inventados se rechazan. Hacer trampa, explotar fallas o manipular partidas puede resultar en pérdida de la apuesta y un ban. Usar tu propia mejor habilidad o una política de IA propia es legítimo y está permitido.",
    },
    {
      n: "7",
      title: "Juego responsable",
      body: "Jugá por entretenimiento y nunca apuestes más de lo que podés perder. Ponete límites y tomate descansos. Si jugar deja de ser divertido o sentís que se te va de las manos, buscá ayuda (por ejemplo, la línea de ayuda contra el juego problemático de tu país). Ofrecemos auto-exclusión a pedido.",
    },
    {
      n: "8",
      title: "Renuncias y responsabilidad",
      body: "El servicio se ofrece “tal cual”, en una testnet, mientras se construye y audita. En la máxima medida permitida por la ley, no somos responsables de pérdidas derivadas del uso del servicio, riesgos de contratos inteligentes, problemas de red o wallets de terceros. Nada de esto elimina derechos que no se puedan renunciar.",
    },
    {
      n: "9",
      title: "Cambios",
      body: "Podemos actualizar estos términos; la fecha de “última actualización” cambiará. Seguir usando el servicio después de un cambio significa que aceptás los términos actualizados.",
    },
    {
      n: "10",
      title: "Contacto",
      body: "Preguntas sobre estos términos: contactanos por los canales listados en el sitio.",
    },
  ],
};

const hi: TermsCopy = {
  title: "सेवा की शर्तें",
  updated: "आख़िरी अपडेट: 2026 · स्किल-गेमिंग प्लेटफ़ॉर्म",
  intro:
    "Arcade1v1 फ़िलहाल **नकली पैसे वाले टेस्टनेट** पर चलता है। नीचे दी गई शर्तें भविष्य में किसी भी असली-पैसे वाले संचालन पर भी लागू होंगी। Arcade1v1 का उपयोग करके आप इन्हें स्वीकार करते हैं।",
  sections: [
    {
      n: "1",
      title: "पात्रता और उम्र",
      body: "आपकी उम्र कम से कम **18 साल** होनी चाहिए (या आपके क्षेत्र में स्किल-गेमिंग के लिए कानूनी उम्र, जो भी ज़्यादा हो) और इस समझौते में प्रवेश करने की पूरी कानूनी क्षमता होनी चाहिए। सेवा का उपयोग करके आप पुष्टि करते हैं कि आप इन शर्तों को पूरा करते हैं।",
    },
    {
      n: "2",
      title: "सेवा की प्रकृति",
      body: "Arcade1v1 एक **स्किल-आधारित 1v1 अरीना** है। दो खिलाड़ी बराबर USDC दांव पर लगाते हैं और **ज़्यादा स्कोर वाला खिलाड़ी दांव जीतता है**, प्लेटफ़ॉर्म फ़ीस घटाकर। नतीजे खिलाड़ी (या एजेंट) की स्किल पर निर्भर करते हैं, संयोग पर नहीं। मैच एसिंक्रोनस होते हैं और replay से सत्यापित होते हैं।",
    },
    {
      n: "3",
      title: "प्रतिबंधित क्षेत्र",
      body: "जिन क्षेत्रों में मूल्य के लिए स्किल-गेमिंग प्रतिबंधित या निषिद्ध है, वहाँ की सेवा उपलब्ध नहीं है। यह सुनिश्चित करना आपकी ज़िम्मेदारी है कि आपके क्षेत्र में इसका उपयोग कानूनी हो। हम क्षेत्र के अनुसार एक्सेस प्रतिबंधित कर सकते हैं।",
    },
    {
      n: "4",
      title: "वॉलेट और फंड",
      body: "Arcade1v1 **नॉन-कस्टोडियल** है: आप अपना ख़ुद का वॉलेट कनेक्ट करते हैं और आपके फंड Base पर एक ऑडिटेड स्मार्ट-कॉन्ट्रैक्ट एस्क्रो में रहते हैं, हमारे पास नहीं। आपके वॉलेट और प्राइवेट कीज़ की सुरक्षा आपकी ज़िम्मेदारी है।",
    },
    {
      n: "5",
      title: "दांव, फ़ीस और भुगतान",
      body: "दोनों खिलाड़ी एस्क्रो में बराबर दांव जमा करते हैं। प्लेटफ़ॉर्म दांव पर **15% कमीशन** रखता है; बाकी विजेता को मिलता है। भुगतान स्मार्ट कॉन्ट्रैक्ट द्वारा ऑन-चेन किए जाते हैं। अगर समय सीमा के भीतर कोई प्रतिद्वंद्वी नहीं जुड़ता, या मैच ड्रॉ पर ख़त्म होता है, तो जमा राशि वापस कर दी जाती है।",
    },
    {
      n: "6",
      title: "फ़ेयर प्ले और एंटी-चीट",
      body: "हर नतीजा रेकॉर्ड किए गए इनपुट को एक साझा डिटरमिनिस्टिक इंजन के ख़िलाफ़ फिर से चलाकर सत्यापित किया जाता है। बनाए गए स्कोर रिजेक्ट कर दिए जाते हैं। धोखाधड़ी, एक्सप्लॉइट या मैच में हेरफेर करने पर दांव गंवाना और बैन हो सकता है। अपनी बेहतर स्किल या ख़ुद की AI policy का उपयोग करना वैध है और इसकी अनुमति है।",
    },
    {
      n: "7",
      title: "ज़िम्मेदार गेमिंग",
      body: "मनोरंजन के लिए खेलें और जो खो नहीं सकते उससे ज़्यादा कभी दांव पर न लगाएं। ख़ुद के लिए सीमाएं तय करें और ब्रेक लें। अगर गेमिंग मज़ेदार न लगे या नियंत्रण से बाहर महसूस हो, तो मदद लें (जैसे, आपके देश की समस्या-गैंबलिंग हेल्पलाइन)। हम मांगने पर सेल्फ़-एक्सक्लूज़न का समर्थन करते हैं।",
    },
    {
      n: "8",
      title: "डिस्क्लेमर और ज़िम्मेदारी",
      body: "सेवा “जैसी है” दी जाती है, एक टेस्टनेट पर, जब तक इसे बनाया और ऑडिट किया जा रहा है। कानून द्वारा अनुमत अधिकतम सीमा तक, हम सेवा के उपयोग, स्मार्ट-कॉन्ट्रैक्ट जोखिम, नेटवर्क समस्याओं या थर्ड-पार्टी वॉलेट से होने वाले नुकसान के लिए ज़िम्मेदार नहीं हैं। यहाँ कुछ भी उन अधिकारों को नहीं हटाता जिन्हें माफ़ नहीं किया जा सकता।",
    },
    {
      n: "9",
      title: "बदलाव",
      body: "हम इन शर्तों को अपडेट कर सकते हैं; “आख़िरी अपडेट” की तारीख बदल जाएगी। बदलाव के बाद सेवा का उपयोग जारी रखने का मतलब है कि आप अपडेट की गई शर्तें स्वीकार करते हैं।",
    },
    {
      n: "10",
      title: "संपर्क",
      body: "इन शर्तों के बारे में सवाल: साइट पर दिए गए चैनलों के ज़रिए संपर्क करें।",
    },
  ],
};

const fr: TermsCopy = {
  title: "Conditions d'utilisation",
  updated: "Dernière mise à jour : 2026 · Plateforme de skill-gaming",
  intro:
    "Arcade1v1 fonctionne actuellement sur un **testnet avec de l'argent fictif**. Les conditions ci-dessous régissent aussi toute future exploitation avec de l'argent réel. En utilisant Arcade1v1, tu les acceptes.",
  sections: [
    {
      n: "1",
      title: "Éligibilité et âge",
      body: "Tu dois avoir au moins **18 ans** (ou l'âge légal pour le skill-gaming dans ta juridiction, le plus élevé des deux) et la pleine capacité juridique pour conclure cet accord. En utilisant le service, tu confirmes que tu remplis ces conditions.",
    },
    {
      n: "2",
      title: "Nature du service",
      body: "Arcade1v1 est une **arène 1v1 basée sur la compétence**. Deux joueurs misent le même montant en USDC et le joueur avec le **meilleur score rafle la cagnotte**, moins une commission de la plateforme. Les résultats dépendent de la compétence du joueur (ou de l'agent), pas du hasard. Les parties sont asynchrones et vérifiées par replay.",
    },
    {
      n: "3",
      title: "Juridictions restreintes",
      body: "Le service n'est pas disponible pour les personnes situées dans des juridictions où le skill-gaming pour de l'argent est interdit ou restreint. Tu es responsable de t'assurer que ton utilisation est légale là où tu te trouves. Nous pouvons restreindre l'accès par région.",
    },
    {
      n: "4",
      title: "Wallets et fonds",
      body: "Arcade1v1 est **non-custodial** : tu connectes ton propre wallet et tes fonds sont détenus par un escrow de smart contract audité sur Base, pas par nous. Tu es responsable de la sécurité de ton wallet et de tes clés privées.",
    },
    {
      n: "5",
      title: "Mises, commissions et paiements",
      body: "Les deux joueurs déposent la même mise dans l'escrow. La plateforme retient une **commission de 15%** sur la cagnotte ; le gagnant reçoit le reste. Les paiements sont exécutés on-chain par le smart contract. Si aucun adversaire ne rejoint dans le délai prévu, ou si la partie se termine par une égalité, les dépôts sont remboursés.",
    },
    {
      n: "6",
      title: "Fair-play et anti-triche",
      body: "Chaque résultat est vérifié en rejouant les inputs enregistrés sur un moteur déterministe partagé. Les scores fabriqués sont rejetés. Tricher, exploiter une faille ou manipuler une partie peut entraîner la perte de la mise et un ban. Utiliser ta propre meilleure compétence ou une IA personnelle est légitime et autorisé.",
    },
    {
      n: "7",
      title: "Jeu responsable",
      body: "Joue pour le divertissement et ne mise jamais plus que ce que tu peux te permettre de perdre. Fixe-toi des limites et prends des pauses. Si jouer cesse d'être amusant ou te semble incontrôlable, demande de l'aide (par ex. la ligne d'assistance nationale contre le jeu problématique). Nous prenons en charge l'auto-exclusion sur demande.",
    },
    {
      n: "8",
      title: "Avertissements et responsabilité",
      body: "Le service est fourni « tel quel », sur un testnet, pendant qu'il est construit et audité. Dans la mesure maximale permise par la loi, nous ne sommes pas responsables des pertes liées à l'utilisation du service, au risque des smart contracts, aux problèmes réseau ou aux wallets tiers. Rien ici ne supprime des droits qui ne peuvent être abandonnés.",
    },
    {
      n: "9",
      title: "Modifications",
      body: "Nous pouvons mettre à jour ces conditions ; la date de « dernière mise à jour » changera. Continuer à utiliser le service après une modification signifie que tu acceptes les conditions mises à jour.",
    },
    {
      n: "10",
      title: "Contact",
      body: "Questions sur ces conditions : contacte-nous via les canaux listés sur le site.",
    },
  ],
};

export const TERMS_CONTENT: Record<Lang, TermsCopy> = { en, es, hi, fr };
