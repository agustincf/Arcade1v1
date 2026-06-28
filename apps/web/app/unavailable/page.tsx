import type { Metadata } from "next";
import { getLang } from "@/app/lib/serverLang";
import type { Lang } from "@/app/lib/i18n-dict";

export const metadata: Metadata = {
  title: "Not available in your region | Arcade1v1",
  robots: { index: false, follow: false },
};

const COPY: Record<Lang, { h1: string; body: string; help: string }> = {
  en: {
    h1: "Not available here",
    body: "Arcade1v1 is not available in your region. Access to skill-gaming for value is restricted in your jurisdiction.",
    help: "If you believe this is a mistake, please get in touch.",
  },
  es: {
    h1: "No disponible acá",
    body: "Arcade1v1 no está disponible en tu región. El acceso al skill-gaming por valor está restringido en tu jurisdicción.",
    help: "Si creés que es un error, escribinos.",
  },
  hi: {
    h1: "यहाँ उपलब्ध नहीं",
    body: "Arcade1v1 आपके क्षेत्र में उपलब्ध नहीं है। आपके अधिकार-क्षेत्र में मूल्य के लिए स्किल-गेमिंग पर पाबंदी है।",
    help: "अगर आपको लगता है कि यह ग़लती है, तो हमसे संपर्क करें।",
  },
  fr: {
    h1: "Indisponible ici",
    body: "Arcade1v1 n'est pas disponible dans ta région. L'accès au skill-gaming pour de l'argent est restreint dans ta juridiction.",
    help: "Si tu penses que c'est une erreur, contacte-nous.",
  },
};

export default async function UnavailablePage() {
  const lang = await getLang();
  const c = COPY[lang];
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <div className="text-6xl">🌍</div>
      <h1 className="font-pixel mt-4 text-lg text-[--color-gold]">{c.h1}</h1>
      <p className="mt-4 text-lg leading-relaxed text-[--color-muted]">{c.body}</p>
      <p className="mt-3 text-base leading-relaxed text-[--color-muted-3]">{c.help}</p>
    </div>
  );
}
