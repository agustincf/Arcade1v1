"use client";

// Página "Recuperar fondos": lista las partidas de plata que esta wallet abrió o
// a las que se unió on-chain, lee el estado REAL del contrato y, si corresponde,
// permite:
//   - COBRAR el premio: partida LLENA (Funded) que GANASTE -> settle con la firma
//     del árbitro (guardada localmente o pedida al servidor). Sin esto, el ganador
//     que se iba antes de reclamar perdía la ganancia.
//   - Reembolso, partida ABIERTA (Open) sin rival al vencer el plazo -> refundUnfunded
//   - Reembolso, partida LLENA sin resultado al vencer el plazo -> refundExpired
// Cumple "depositá y andate": aunque cierres la pestaña, volvés y cobrás o te
// reembolsan. La verdad vive on-chain; el índice local es solo un atajo.

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/app/lib/i18n";
import { useWallet, shortAddress } from "@/app/lib/wallet";
import { useEscrow } from "@/app/lib/useEscrow";
import { onchainEnabled, MatchStatus } from "@/app/lib/escrow";
import { listMatches, forgetMatch, type OpenMatch } from "@/app/lib/openMatches";
import { getMatch } from "@/app/lib/arbiter";
import { getPayout } from "@/app/lib/config";
import { getGame } from "@/app/lib/games";

type Kind =
  | "claimable" // llena, GANASTE y todavía no cobraste -> cobrar el premio
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
  /** Presentes solo cuando kind === "claimable": para enviar el settle. */
  claimSig?: `0x${string}`;
  claimWinner?: `0x${string}`;
}

/** Si esta partida (Funded on-chain) la GANASTE, devuelve la firma para cobrar.
 *  Primero la firma guardada localmente; si no está (otro dispositivo), se la
 *  pedimos al árbitro, que la recuerda mientras la partida es reciente. */
async function resolveWin(
  m: OpenMatch,
  addr: string,
): Promise<{ sig: `0x${string}`; winner: `0x${string}` } | null> {
  if (m.winSig && m.winner && m.winner.toLowerCase() === addr.toLowerCase()) {
    return { sig: m.winSig, winner: m.winner };
  }
  try {
    const v = await getMatch(m.matchId, addr);
    if (v?.winner && v.signature && v.winner.toLowerCase() === addr.toLowerCase()) {
      return { sig: v.signature as `0x${string}`, winner: v.winner as `0x${string}` };
    }
  } catch {
    /* árbitro inalcanzable: sin cobro automático, quedan los reembolsos */
  }
  return null;
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
          // Partida LLENA: si la ganaste, lo que corresponde es COBRAR (no esperar
          // ni reembolsar). Antes /recover solo ofrecía reembolsos y el premio
          // quedaba sin reclamar si te ibas del modal de victoria.
          if (s.status === MatchStatus.Funded) {
            const win = await resolveWin(m, address);
            if (win) {
              out.push({
                ...m,
                kind: "claimable",
                deadline: s.playDeadline,
                claimSig: win.sig,
                claimWinner: win.winner,
              });
              continue;
            }
          }
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
  const claimable = row.kind === "claimable";
  const refundable = row.kind === "openRefund" || row.kind === "fundedRefund";
  const resolved = row.kind === "settled" || row.kind === "refunded" || row.kind === "unknown";

  const statusText: Record<Kind, string> = {
    claimable: t("recover.st.claimable"),
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

  // Cobrar el premio ganado: envía la firma del árbitro al contrato (settle).
  async function doClaim() {
    if (!row.claimSig || !row.claimWinner) return;
    setState("working");
    try {
      await escrow.claim(row.matchId, row.claimWinner, row.claimSig);
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
          className={`chip ${claimable ? "!text-(--color-win)" : refundable ? "!text-(--color-gold)" : resolved ? "!text-(--color-muted-2)" : "!text-(--color-accent-2)"}`}
        >
          {row.role === "p1" ? t("recover.role.p1") : t("recover.role.p2")}
        </span>
      </div>
      <div className="p-4">
        <p
          className={`text-base font-medium ${claimable ? "text-(--color-win)" : refundable ? "text-(--color-gold)" : resolved ? "text-(--color-muted-2)" : "text-(--color-muted)"}`}
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

        {claimable &&
          (state === "done" ? (
            <p className="mt-3 text-base font-medium text-(--color-win)">
              {t("recover.claimDone")}
            </p>
          ) : (
            <>
              <button
                onClick={doClaim}
                disabled={state === "working"}
                className="btn3d btn3d--magenta mt-4 w-full disabled:opacity-60"
              >
                {state === "working"
                  ? t("recover.processing")
                  : t("recover.claimBtn", { prize: getPayout(row.bet).prize })}
              </button>
              {state === "error" && (
                <p className="mt-2 text-sm text-(--color-lose)">{t("recover.error")}</p>
              )}
            </>
          ))}

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
