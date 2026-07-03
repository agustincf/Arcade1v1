"use client";

// Página "Recuperar fondos": lista las partidas de plata que esta wallet abrió o
// a las que se unió on-chain, lee el estado REAL del contrato y, si corresponde,
// permite reclamar el reembolso:
//   - Partida ABIERTA (Open) sin rival al vencer el plazo de depósito -> refundUnfunded
//   - Partida LLENA (Funded) sin resultado al vencer el plazo de juego -> refundExpired
// Cumple la promesa "sin rival en 1 hora, te devolvemos todo" incluso si el
// usuario cerró la pestaña tras depositar (modelo asincrónico "depositá y andate").

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/app/lib/i18n";
import { useWallet, shortAddress } from "@/app/lib/wallet";
import { useEscrow } from "@/app/lib/useEscrow";
import { onchainEnabled, MatchStatus } from "@/app/lib/escrow";
import { listMatches, forgetMatch, type OpenMatch } from "@/app/lib/openMatches";
import { getGame } from "@/app/lib/games";

type Kind =
  | "openWaiting" // abierta, todavía dentro del plazo de depósito
  | "openRefund" // abierta y vencida -> reembolsable
  | "fundedWaiting" // llena, todavía dentro del plazo de juego
  | "fundedRefund" // llena y vencida -> reembolsable
  | "settled" // ya pagada
  | "refunded" // ya reembolsada
  | "unknown"; // no existe on-chain (otra red, etc.)

interface Row extends OpenMatch {
  kind: Kind;
  /** plazo relevante (epoch s) para mostrar "disponible a partir de". */
  deadline: number;
}

function classify(
  status: number,
  fundDeadline: number,
  playDeadline: number,
  nowSec: number,
): { kind: Kind; deadline: number } {
  if (status === MatchStatus.Open) {
    return nowSec > fundDeadline
      ? { kind: "openRefund", deadline: fundDeadline }
      : { kind: "openWaiting", deadline: fundDeadline };
  }
  if (status === MatchStatus.Funded) {
    return nowSec > playDeadline
      ? { kind: "fundedRefund", deadline: playDeadline }
      : { kind: "fundedWaiting", deadline: playDeadline };
  }
  if (status === MatchStatus.Settled) return { kind: "settled", deadline: 0 };
  if (status === MatchStatus.Refunded) return { kind: "refunded", deadline: 0 };
  return { kind: "unknown", deadline: 0 };
}

export default function RecoverPage() {
  const { t } = useT();
  const { address, connected, connect } = useWallet();
  const escrow = useEscrow();

  const [rows, setRows] = useState<Row[] | null>(null);
  const [scanning, setScanning] = useState(false);

  const scan = useCallback(async () => {
    if (!address || !onchainEnabled) return;
    setScanning(true);
    try {
      const stored = listMatches(address);
      const nowSec = Math.floor(Date.now() / 1000);
      const out: Row[] = [];
      for (const m of stored) {
        try {
          const s = await escrow.readMatch(m.matchId);
          const { kind, deadline } = classify(s.status, s.fundDeadline, s.playDeadline, nowSec);
          out.push({ ...m, kind, deadline });
        } catch {
          out.push({ ...m, kind: "unknown", deadline: 0 });
        }
      }
      setRows(out);
    } finally {
      setScanning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  useEffect(() => {
    if (connected && onchainEnabled) scan();
    else setRows(null);
  }, [connected, scan]);

  return (
    <div className="mx-auto max-w-2xl pb-12">
      <h1 className="font-pixel text-xl leading-relaxed text-(--color-text-strong)">
        {t("recover.title")}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-(--color-muted)">{t("recover.intro")}</p>

      {!onchainEnabled ? (
        <div className="win mt-6">
          <div className="win-title">
            <span>{t("recover.title")}</span>
          </div>
          <p className="p-5 text-center text-base text-(--color-muted)">
            {t("recover.notConfigured")}
          </p>
        </div>
      ) : !connected ? (
        <div className="win mt-6">
          <div className="win-title">
            <span>{t("recover.title")}</span>
          </div>
          <div className="p-6 text-center">
            <p className="text-base text-(--color-muted)">{t("recover.connectPrompt")}</p>
            <button onClick={connect} className="btn3d btn3d--magenta mt-5 w-full">
              {t("recover.connect")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-5 flex items-center justify-between">
            <span className="font-mono text-sm text-(--color-muted-2)">
              {address && shortAddress(address)}
            </span>
            <button
              onClick={scan}
              disabled={scanning}
              className="text-sm font-medium text-(--color-accent-2) hover:underline disabled:opacity-50"
            >
              {scanning ? t("recover.scanning") : `↻ ${t("recover.refresh")}`}
            </button>
          </div>

          {rows === null || scanning ? (
            <p className="mt-6 py-10 text-center text-base text-(--color-accent-2)">
              {t("recover.scanning")}
            </p>
          ) : rows.length === 0 ? (
            <p className="mt-6 py-10 text-center text-base text-(--color-muted-2)">
              {t("recover.empty")}
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {rows.map((r) => (
                <MatchRow
                  key={r.matchId}
                  row={r}
                  onResolved={() => {
                    if (address) forgetMatch(address, r.matchId);
                    scan();
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MatchRow({ row, onResolved }: { row: Row; onResolved: () => void }) {
  const { t } = useT();
  const escrow = useEscrow();
  const { address } = useWallet();
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");

  const game = getGame(row.game);
  const refundable = row.kind === "openRefund" || row.kind === "fundedRefund";
  const resolved = row.kind === "settled" || row.kind === "refunded" || row.kind === "unknown";

  const statusText: Record<Kind, string> = {
    openWaiting: t("recover.st.openWaiting"),
    openRefund: t("recover.st.openRefund"),
    fundedWaiting: t("recover.st.fundedWaiting"),
    fundedRefund: t("recover.st.fundedRefund"),
    settled: t("recover.st.settled"),
    refunded: t("recover.st.refunded"),
    unknown: t("recover.st.unknown"),
  };

  async function doRefund() {
    setState("working");
    try {
      if (row.kind === "openRefund") {
        await escrow.refundUnfunded(row.matchId);
      } else {
        await escrow.refundExpired(row.matchId);
      }
      setState("done");
      if (address) forgetMatch(address, row.matchId);
    } catch {
      setState("error");
    }
  }

  return (
    <div className="win">
      <div className="win-title">
        <span>
          {game ? t(`game.${game.id}.name`).toUpperCase() : row.game.toUpperCase()} · {row.bet} USDC
        </span>
        <span
          className={`chip ${refundable ? "!text-(--color-gold)" : resolved ? "!text-(--color-muted-2)" : "!text-(--color-accent-2)"}`}
        >
          {row.role === "p1" ? t("recover.role.p1") : t("recover.role.p2")}
        </span>
      </div>
      <div className="p-4">
        <p
          className={`text-base font-medium ${refundable ? "text-(--color-gold)" : resolved ? "text-(--color-muted-2)" : "text-(--color-muted)"}`}
        >
          {statusText[row.kind]}
        </p>

        {(row.kind === "openWaiting" || row.kind === "fundedWaiting") && (
          <p className="mt-1 text-sm text-(--color-muted-3)">
            {t("recover.availAfter", {
              date: new Date(row.deadline * 1000).toLocaleString(),
            })}
          </p>
        )}

        {refundable &&
          (state === "done" ? (
            <p className="mt-3 text-base font-medium text-(--color-win)">{t("recover.done")}</p>
          ) : (
            <>
              <button
                onClick={doRefund}
                disabled={state === "working"}
                className="btn3d btn3d--magenta mt-4 w-full disabled:opacity-60"
              >
                {state === "working" ? t("recover.processing") : t("recover.btn", { bet: row.bet })}
              </button>
              {state === "error" && (
                <p className="mt-2 text-sm text-(--color-lose)">{t("recover.error")}</p>
              )}
            </>
          ))}

        {resolved && (
          <button
            onClick={onResolved}
            className="mt-3 text-sm text-(--color-muted-2) hover:text-(--color-muted-bright) hover:underline"
          >
            {t("recover.dismiss")}
          </button>
        )}
      </div>
    </div>
  );
}
