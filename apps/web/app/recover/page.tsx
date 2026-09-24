"use client";

// Página "Recuperar fondos": lista las partidas de plata que esta wallet abrió o
// a las que se unió on-chain, lee el estado REAL del contrato y, si corresponde,
// permite:
//   - COBRAR el premio: partida LLENA (Funded) que GANASTE -> settle con la firma
//     del árbitro (guardada localmente o pedida al servidor), mientras no venza.
//     Desde la v2 el árbitro paga solo; esto es el respaldo si su pago no salió.
//   - Reembolso, partida ABIERTA (Open) sin rival al vencer el plazo -> refundUnfunded
//   - Reembolso, partida LLENA sin resultado al vencer el plazo -> refundExpired
//   - RETIRAR lo acreditado: pagos o reembolsos que el USDC rechazó al enviarlos
//     (la wallet en la blacklist de Circle, el token en pausa) -> withdraw
// Cumple "depositá y andate": aunque cierres la pestaña, volvés y cobrás o te
// reembolsan. La verdad vive on-chain; el índice local es solo un atajo.

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/app/lib/i18n";
import { useWallet, shortAddress } from "@/app/lib/wallet";
import { useEscrow } from "@/app/lib/useEscrow";
import { onchainEnabled, MatchStatus, REFUND_GRACE_SEC } from "@/app/lib/escrow";
import { listMatches, forgetMatch, type OpenMatch } from "@/app/lib/openMatches";
import { getMatch } from "@/app/lib/arbiter";
import { getPayout } from "@/app/lib/config";
import { getGame } from "@/app/lib/games";
import { PixelIcon } from "@/app/components/PixelIcon";

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
  /** Hasta cuándo vale `claimSig` (segundos). */
  claimDeadline?: number;
}

/** Si esta partida (Funded on-chain) la GANASTE, devuelve la firma para cobrar
 *  y hasta cuándo vale. Primero la firma guardada localmente; si no está (otro
 *  dispositivo, o una guardada con la v1 del contrato, que no vence y ya no
 *  sirve), se la pedimos al árbitro, que la recuerda mientras la partida es
 *  reciente. */
async function resolveWin(
  m: OpenMatch,
  addr: string,
): Promise<{ sig: `0x${string}`; winner: `0x${string}`; deadline: number } | null> {
  const mine = (w?: string) => !!w && w.toLowerCase() === addr.toLowerCase();
  if (m.winSig && mine(m.winner) && m.winDeadline !== undefined) {
    return { sig: m.winSig, winner: m.winner!, deadline: m.winDeadline };
  }
  try {
    const v = await getMatch(m.matchId, addr);
    if (v?.signature && mine(v.winner) && v.signatureDeadline !== undefined) {
      return {
        sig: v.signature as `0x${string}`,
        winner: v.winner as `0x${string}`,
        deadline: v.signatureDeadline,
      };
    }
  } catch {
    /* árbitro inalcanzable: sin cobro automático, quedan los reembolsos */
  }
  return null;
}

/** Micro-USDC -> "8.50". */
const usdc = (units: bigint) => (Number(units) / 1_000_000).toFixed(2);

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
    // El contrato exige `block.timestamp > playDeadline + REFUND_GRACE`, así que
    // el reembolso recién se puede pedir media hora DESPUÉS del plazo de juego.
    // Sin sumar la gracia, la página ofrecía el botón 30 minutos antes de tiempo
    // (revertía siempre con "not expired") y mostraba una fecha que no era.
    const refundableAt = playDeadline + REFUND_GRACE_SEC;
    return nowSec > refundableAt
      ? { kind: "fundedRefund", deadline: refundableAt }
      : { kind: "fundedWaiting", deadline: refundableAt };
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
  // Lo acreditado a esta wallet en el contrato (null: todavía no se leyó).
  const [owed, setOwed] = useState<bigint | null>(null);

  const scan = useCallback(async () => {
    if (!address || !onchainEnabled) return;
    setScanning(true);
    try {
      const stored = listMatches(address);
      const nowSec = Math.floor(Date.now() / 1000);
      const out: Row[] = [];
      setOwed(await escrow.readOwed(address as `0x${string}`).catch(() => null));
      for (const m of stored) {
        try {
          const s = await escrow.readMatch(m.matchId);
          // Partida LLENA: si la ganaste, lo que corresponde es COBRAR (no esperar
          // ni reembolsar). Antes /recover solo ofrecía reembolsos y el premio
          // quedaba sin reclamar si te ibas del modal de victoria.
          // La firma VENCE justo cuando se abre el reembolso (playDeadline +
          // gracia): vencida, la partida cae en el reembolso de abajo.
          if (s.status === MatchStatus.Funded) {
            const win = await resolveWin(m, address);
            if (win && nowSec <= win.deadline) {
              out.push({
                ...m,
                kind: "claimable",
                deadline: s.playDeadline,
                claimSig: win.sig,
                claimWinner: win.winner,
                claimDeadline: win.deadline,
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
      <h1 className="font-pixel text-px16 leading-relaxed text-(--color-text-strong) sm:text-px24">
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
              <PixelIcon name="play" className="ml-2" />
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

          {owed !== null && owed > 0n && <OwedCard amount={owed} />}

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

  // Cobrar el premio ganado: envía la firma del árbitro al contrato (settle). Si
  // el árbitro ya pagó mientras tanto, `claim` lo ve en la cadena y no manda nada.
  async function doClaim() {
    if (!row.claimSig || !row.claimWinner || row.claimDeadline === undefined) return;
    setState("working");
    try {
      await escrow.claim(row.matchId, row.claimWinner, row.claimDeadline, row.claimSig);
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
          className={`chip ${claimable ? "chip--live" : refundable ? "chip--money" : resolved ? "" : "chip--info"}`}
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

/** Lo ACREDITADO a esta wallet: pagos o reembolsos que el USDC rechazó al
 *  enviarlos. Es un saldo por wallet (suma lo de todas sus partidas), y solo
 *  puede salir hacia ella. Retirado, la tarjeta queda con la confirmación hasta
 *  el próximo "Actualizar". */
function OwedCard({ amount }: { amount: bigint }) {
  const { t } = useT();
  const escrow = useEscrow();
  const [state, setState] = useState<"idle" | "working" | "done" | "error">("idle");

  async function doWithdraw() {
    setState("working");
    try {
      await escrow.withdraw();
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="win mt-4">
      <div className="win-title">
        <span>{t("recover.owedTitle")}</span>
        <span className="chip chip--money">{usdc(amount)} USDC</span>
      </div>
      <div className="p-4">
        <p className="text-base text-(--color-muted)">
          {t("recover.owedText", { amount: usdc(amount) })}
        </p>
        {state === "done" ? (
          <p className="mt-3 text-base font-medium text-(--color-win)">{t("recover.owedDone")}</p>
        ) : (
          <>
            <button
              onClick={doWithdraw}
              disabled={state === "working"}
              className="btn3d btn3d--magenta mt-4 w-full disabled:opacity-60"
            >
              {state === "working"
                ? t("recover.processing")
                : t("recover.owedBtn", { amount: usdc(amount) })}
            </button>
            {state === "error" && (
              <p className="mt-2 text-sm text-(--color-lose)">{t("recover.owedErr")}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
