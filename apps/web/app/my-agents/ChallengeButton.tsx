"use client";

// Botón "Desafiar" en la página (pública) de un agente, para un visitante que NO
// es el dueño. Ofrece: (1) "Juego yo" -> crea un duelo humano→agente firmado y
// abre la partida para jugar el intento; (2) "Con mi agente" -> elige uno de tus
// agentes del mismo juego y crea un duelo agente→agente (ambos juegan solos).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocalePath } from "@/app/components/LocaleLink";
import { useSignMessage } from "wagmi";
import { challengeAuthMessage, agentAuthMessage } from "@arcade1v1/game-sdk/auth";
import { useT } from "@/app/lib/i18n";
import { createChallenge, listAgents, type AgentView } from "@/app/lib/arbiter";
import { useEnsureChain } from "@/app/lib/wallet";
import { CHAIN } from "@/app/lib/wagmi";
import { classifySignError } from "@/app/lib/errors";

export function ChallengeButton({
  targetAgentId,
  targetAddress,
  game,
  viewer,
}: {
  targetAgentId: string;
  targetAddress: string;
  game: string;
  viewer: string;
}) {
  const { t } = useT();
  const router = useRouter();
  const lp = useLocalePath();
  const { signMessageAsync } = useSignMessage();
  const ensureChain = useEnsureChain();
  const [mine, setMine] = useState<AgentView[]>([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [pick, setPick] = useState(false);
  // Motivo del fallo, visible: antes el botón fallaba EN SILENCIO (firma
  // cancelada, agente ocupado, red caída) y el usuario no sabía qué pasó.
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    listAgents(viewer)
      .then((a) => !cancel && setMine(a.filter((x) => x.game === game && x.id !== targetAgentId)))
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [viewer, game, targetAgentId]);

  // Texto del fallo: cancelar la firma o estar en otra red tienen mensaje
  // propio (traducido); el resto muestra el motivo tal cual, acotado.
  function failText(e: unknown): string {
    const s = classifySignError(e);
    if (s.kind === "sign-cancelled") return t("err.signCancelled");
    if (s.kind === "wrong-network") return t("err.wrongNetwork", { chain: CHAIN.name });
    return s.reason.slice(0, 140);
  }

  async function challengeAsHuman() {
    setBusy(true);
    setErr(null);
    try {
      await ensureChain();
      const ts = Date.now();
      const signature = await signMessageAsync({
        message: challengeAuthMessage(viewer, targetAddress, ts),
      });
      const m = await createChallenge({ challenger: viewer, targetAgentId, signature, ts });
      router.push(lp(`/game/${game}/match?challenge=${m.matchId}`));
    } catch (e) {
      setErr(failText(e));
      setBusy(false);
    }
  }

  async function challengeWithAgent(byAgentId: string, owner: string) {
    setBusy(true);
    setErr(null);
    try {
      await ensureChain();
      const ts = Date.now();
      const signature = await signMessageAsync({
        message: agentAuthMessage("challenge", byAgentId, owner, ts),
      });
      await createChallenge({ byAgentId, targetAgentId, signature, ts });
      setSent(true);
    } catch (e) {
      setErr(failText(e));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return <p className="mt-4 text-center text-sm text-(--color-win)">{t("challenge.sent")}</p>;
  }

  return (
    <div className="mt-4">
      <div className="flex gap-3">
        <button
          onClick={challengeAsHuman}
          disabled={busy}
          className="btn3d btn3d--magenta flex-1 disabled:opacity-50"
        >
          ⚔ {t("challenge.me")}
        </button>
        {mine.length > 0 && (
          <button
            onClick={() => setPick((v) => !v)}
            disabled={busy}
            className="btn3d btn3d--cyan flex-1 disabled:opacity-50"
          >
            🤖 {t("challenge.withAgent")}
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-center text-sm text-(--color-lose)">{err}</p>}
      {pick && (
        <div className="win mt-3 p-3">
          <p className="mb-2 text-sm text-(--color-muted-2)">{t("challenge.pickAgent")}</p>
          <div className="flex flex-col gap-2">
            {mine.map((a) => (
              <button
                key={a.id}
                onClick={() => challengeWithAgent(a.id, a.owner)}
                disabled={busy}
                className="win flex items-center gap-2 p-2 text-left text-sm transition hover:-translate-y-0.5 disabled:opacity-50"
              >
                <span className="text-xl">{a.avatar}</span> {a.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
