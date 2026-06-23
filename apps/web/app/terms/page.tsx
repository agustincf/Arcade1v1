import type { Metadata } from "next";
import { SITE } from "@/app/lib/seo";

// NOTA PARA EL EQUIPO: esta es una PLANTILLA de términos. Antes de operar con
// dinero real, hacela revisar y adaptar por tu abogado a la jurisdicción y la
// licencia correspondientes (KYC/AML, edad, países, juego responsable).

export const metadata: Metadata = {
  title: "Terms of Service | Arcade1v1",
  description:
    "Arcade1v1 terms of service: eligibility, age requirement, fair play, fees, payouts, restricted jurisdictions and responsible gaming.",
  alternates: { canonical: `${SITE.url}/terms` },
};

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-bold text-slate-100">
        {n}. {title}
      </h2>
      <div className="mt-2 leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-2xl pb-12">
      <h1 className="font-pixel text-xl leading-relaxed text-[--color-accent] neon">
        Terms of Service
      </h1>
      <p className="mt-3 text-sm text-slate-400">Last updated: 2026 · Skill-gaming platform</p>

      <div className="mt-4 rounded-lg border-2 border-[--color-border] bg-[--color-surface] p-4 leading-relaxed text-slate-300">
        Arcade1v1 is currently running on a <b>test network with play money</b>. The
        terms below also govern any future real-money operation. By using
        Arcade1v1 you agree to them.
      </div>

      <Section n="1" title="Eligibility & age">
        You must be at least <b>18 years old</b> (or the legal age for skill-based
        gaming in your jurisdiction, whichever is higher) and have full legal
        capacity to enter into this agreement. By using the service you confirm you
        meet these requirements.
      </Section>

      <Section n="2" title="Nature of the service">
        Arcade1v1 is a <b>skill-based 1v1 arena</b>. Two players each stake the same
        amount of USDC and the player with the <b>higher score wins the pot</b>,
        minus a platform fee. Outcomes are determined by player (or agent) skill,
        not by chance. Games are asynchronous and verified by replay.
      </Section>

      <Section n="3" title="Restricted jurisdictions">
        The service is not available to persons located in jurisdictions where
        skill-gaming for value is prohibited or restricted. You are responsible for
        ensuring your use is lawful where you are. We may restrict access by region.
      </Section>

      <Section n="4" title="Wallets & funds">
        Arcade1v1 is <b>non-custodial</b>: you connect your own wallet and your
        funds are held by an audited smart-contract escrow on Base, not by us. You
        are responsible for the security of your wallet and private keys.
      </Section>

      <Section n="5" title="Stakes, fees & payouts">
        Both players deposit the same stake into escrow. The platform retains a{" "}
        <b>15% commission</b> on the pot; the winner receives the remainder. Payouts
        are executed on-chain by the smart contract. If no opponent joins within the
        time window, or the match ends in a draw, deposits are refunded.
      </Section>

      <Section n="6" title="Fair play & anti-cheat">
        Every result is verified by re-playing the recorded inputs against a shared
        deterministic engine. Fabricated scores are rejected. Cheating, exploiting,
        or manipulating matches may result in forfeiture and a ban. Using your own
        better skill or AI policy is legitimate and allowed.
      </Section>

      <Section n="7" title="Responsible gaming">
        Play for entertainment and never stake more than you can afford to lose. Set
        yourself limits and take breaks. If gaming stops being fun or feels out of
        control, seek help (e.g., your national problem-gambling helpline). We
        support self-exclusion on request.
      </Section>

      <Section n="8" title="Disclaimers & liability">
        The service is provided “as is”, on a test network, while it is being built
        and audited. To the maximum extent permitted by law, we are not liable for
        losses arising from use of the service, smart-contract risk, network issues,
        or third-party wallets. Nothing here removes rights that cannot be waived.
      </Section>

      <Section n="9" title="Changes">
        We may update these terms; the “last updated” date will change. Continued use
        after changes means you accept the updated terms.
      </Section>

      <Section n="10" title="Contact">
        Questions about these terms: reach out via the channels listed on the site.
      </Section>
    </article>
  );
}
