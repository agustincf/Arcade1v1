"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LocaleLink as Link } from "@/app/components/LocaleLink";
import { getGame } from "@/app/lib/games";
import { getPayout, PLATFORM_FEE, IS_MAINNET } from "@/app/lib/config";
import { GameIcon } from "@/app/components/GameIcon";
import { useT } from "@/app/lib/i18n";
import { useWallet } from "@/app/lib/wallet";
import { useEscrow } from "@/app/lib/useEscrow";
import { onchainEnabled } from "@/app/lib/escrow";
import { rememberMatch } from "@/app/lib/openMatches";
import { useSignMessage } from "wagmi";
import { scoreAuthMessage, matchmakeAuthMessage } from "@arcade1v1/game-sdk/auth";
import {
  matchmake,
  submitScore,
  getMatch,
  playBot,
  playerId,
  warmUpArbiter,
  type MatchView,
} from "@/app/lib/arbiter";
import { ReplayPlayer } from "@/app/components/replay/ReplayPlayer";
import { TetrisGame, type TetrisResult } from "@/app/games/tetris/TetrisGame";
import { FlappyGame, type FlappyResult } from "@/app/games/flappy/FlappyGame";
import { RacingGame, type RacingResult } from "@/app/games/racing/RacingGame";
import { Game2048Component, type Result2048 } from "@/app/games/g2048/Game2048";
import { SnakeGame, type SnakeResult } from "@/app/games/snake/SnakeGame";
import { InvadersGame, type InvadersResult } from "@/app/games/invaders/InvadersGame";

type Outcome = "win" | "lose" | "draw" | null;
const rnd = () => Math.floor(Math.random() * 1e9);

export default function MatchPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = use(params);
  const game = getGame(gameId);
  const router = useRouter();
  const search = useSearchParams();
  const { t } = useT();
  const { address, connect } = useWallet();
  const { signMessageAsync } = useSignMessage();
  const free = search.get("free") === "1";
  const challengeId = search.get("challenge");
  const bet = Number(search.get("bet") ?? 0);
  // LADDER GRATIS (bet=0, sin ?free=1): partida rankeada de verdad — pasa por
  // el árbitro (rival real + ELO) pero sin depósito. ?free=1 queda como el modo
  // práctica offline de siempre (sin árbitro ni ranking).
  const rankedFree = !free && bet === 0;
  const payout = getPayout(bet);
  const escrow = useEscrow();
  // Si hay contrato configurado y es partida de plata, hay que depositar antes.
  const needsDeposit = onchainEnabled && !free && bet > 0;

  const [seed, setSeed] = useState<number | null>(free ? rnd() : null);
  const [round, setRound] = useState(0);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  // Distinguimos el motivo del error para no mentirle al usuario: "sign" es
  // que canceló la firma en su wallet; "server" es que el árbitro no respondió.
  // En ambos casos hay botón de REINTENTAR (antes quedaba trancado sin salida).
  const [error, setError] = useState<null | "sign" | "server">(null);
  const [retry, setRetry] = useState(0);
  const [slowHint, setSlowHint] = useState(false);
  // En produccion NUNCA simulamos un rival: si el arbitro no responde, error.
  const devMode = process.env.NODE_ENV !== "production";
  // Wallet requerida para emparejar: partidas de plata siempre; la ladder
  // gratis también en producción (el árbitro exige la firma anti-suplantación;
  // en dev se puede probar como invitado).
  const needsWallet = !address && (needsDeposit || (rankedFree && !devMode));
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [youScore, setYouScore] = useState<number | null>(null);
  const [rivalScore, setRivalScore] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [ratingDelta, setRatingDelta] = useState<number>(0);
  const [freeDone, setFreeDone] = useState(false);
  const [forfeit, setForfeit] = useState(false);
  // Estado on-chain. El depósito es UNA sola acción: aprueba el USDC (solo la
  // primera vez) y enseguida abre/se une a la partida.
  const [role, setRole] = useState<"p1" | "p2" | null>(null);
  const [deposited, setDeposited] = useState(false);
  const [funding, setFunding] = useState<"" | "approving" | "depositing">("");
  const [depositErr, setDepositErr] = useState(false);
  const [submitting, setSubmitting] = useState(false); // enviando puntaje (firma + envío)
  const [winnerSig, setWinnerSig] = useState<string | null>(null);
  const [winnerAddr, setWinnerAddr] = useState<string | null>(null);
  // Replay del rival (llega con el resultado): se puede MIRAR su corrida para
  // aprender — es el mismo feedback rico que reciben los agentes.
  const [rivalReplay, setRivalReplay] = useState<unknown>(null);
  const [showRival, setShowRival] = useState(false);
  const [claimState, setClaimState] = useState<"idle" | "claiming" | "done" | "error">("idle");
  const pidRef = useRef<string>("");
  const lastRunRef = useRef<{ score: number; replay?: unknown } | null>(null);
  // Evita disparar DOS pedidos de firma/emparejamiento a la vez (pasaba en
  // desarrollo por el doble montaje de React, y al cambiar de cuenta con un
  // pedido en vuelo): el usuario veía dos popups y parecía un loop.
  const mmStarted = useRef(false);

  // Al entrar a la partida, despertamos al árbitro por si vino directo por URL
  // (si pasó por la mesa, ya está despierto).
  useEffect(() => {
    if (!free) warmUpArbiter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Emparejamiento con el arbitro (solo partidas de plata). Si el servidor no
  // responde o el usuario cancela la firma, mostramos el motivo con REINTENTAR.
  useEffect(() => {
    if (free || matchId || error) return;
    // Modo plata on-chain: con la wallet conectada alcanza para emparejar (orden
    // de llegada). El depósito (approve + open/join) viene después, en un paso.
    if (needsWallet) return;
    if (mmStarted.current) return;
    mmStarted.current = true;
    pidRef.current = playerId(address ?? null);
    (async () => {
      // MODO DESAFÍO: la partida ya existe (la creó el botón "Desafiar"); no se
      // empareja, se carga y se juega como una ladder gratis rankeada.
      if (challengeId) {
        try {
          const v = await getMatch(challengeId, pidRef.current);
          if (!v) throw new Error("challenge not found");
          setMatchId(v.matchId);
          setSeed(v.seed);
          setRole(v.role ?? null);
        } catch {
          mmStarted.current = false;
          setError("server");
        }
        return;
      }
      // Con wallet conectada, el emparejamiento va FIRMADO (en producción el
      // árbitro lo exige: evita que alguien encole direcciones ajenas).
      let auth: { signature: string; ts: number } | undefined;
      if (address) {
        const ts = Date.now();
        try {
          const signature = await signMessageAsync({
            message: matchmakeAuthMessage(game!.id, bet, pidRef.current, ts),
          });
          auth = { signature, ts };
        } catch {
          // Canceló (o no vio) la firma en su wallet. En producción sin firma
          // no hay emparejamiento: avisamos claro y dejamos reintentar.
          if (!devMode) {
            mmStarted.current = false;
            setError("sign");
            return;
          }
          /* en dev se puede emparejar sin firma */
        }
      }
      try {
        const v = await matchmake(game!.id, bet, pidRef.current, auth);
        setMatchId(v.matchId);
        setSeed(v.seed);
        setRole(v.role ?? null);
      } catch {
        mmStarted.current = false;
        if (devMode) {
          setOffline(true);
          setSeed(rnd());
        } else {
          setError("server");
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, retry]);

  // Si "Conectando…" se estira (el hosting gratuito del árbitro despierta de a
  // poco), lo decimos: sin este aviso parecía colgado.
  const searching = !free && seed === null && !error && !needsWallet;
  useEffect(() => {
    if (!searching) {
      setSlowHint(false);
      return;
    }
    const tm = setTimeout(() => setSlowHint(true), 5000);
    return () => clearTimeout(tm);
  }, [searching]);

  // Aviso del navegador si cierra/recarga durante el intento (de plata).
  useEffect(() => {
    if (free) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (playing && outcome === null) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [playing, outcome, free]);

  // Mientras esperamos que el rival juegue, consultamos el resultado.
  useEffect(() => {
    if (!waiting || !matchId) return;
    const iv = setInterval(async () => {
      try {
        const v = await getMatch(matchId, pidRef.current);
        if (v.status === "settled" || v.status === "draw") {
          applyResult(v);
          setWaiting(false);
        }
      } catch {
        /* reintenta */
      }
    }, 2500);
    return () => clearInterval(iv);
  }, [waiting, matchId]);

  if (!game) return null;

  function applyResult(v: MatchView) {
    const opp = v.opponent;
    setRivalScore(opp ? (v.scores[opp] ?? 0) : 0);
    if (v.outcome === "draw") setOutcome("draw");
    else if (v.outcome && v.role === v.outcome) {
      setOutcome("win");
      // Guardamos la firma del arbitro para que el ganador pueda cobrar on-chain.
      if (v.signature && v.winner) {
        setWinnerSig(v.signature);
        setWinnerAddr(v.winner);
      }
    } else setOutcome("lose");
    if (typeof v.rating === "number") {
      setRating(v.rating);
      setRatingDelta(v.ratingDelta ?? 0);
    }
    if (v.rivalReplay) setRivalReplay(v.rivalReplay);
  }

  // UNA sola acción para entrar a la partida: aprueba el USDC (solo la 1ra vez;
  // si ya hay allowance suficiente, no pide nada) y enseguida abre (p1) o se une
  // (p2) depositando. Así el jugador no pasa por dos pantallas separadas.
  async function doFund() {
    if (!matchId || !address) return;
    setDepositErr(false);
    try {
      // 1) Allowance (gratis salvo la primera vez de la wallet).
      setFunding("approving");
      await escrow.approveStake(address as `0x${string}`, bet);
      // 2) Depósito: el 1ro ABRE la partida, el 2do se UNE a la que abrió el rival.
      setFunding("depositing");
      if (role === "p2") {
        await escrow.join(matchId as `0x${string}`, bet);
      } else {
        await escrow.open(matchId as `0x${string}`, bet);
      }
      setDeposited(true);
      // Recordamos la partida por wallet: si nunca aparece rival (o no hay
      // resultado a tiempo), el usuario puede volver a /recover y reembolsar.
      rememberMatch(address, {
        matchId: matchId as `0x${string}`,
        game: game!.id,
        bet,
        role: role === "p2" ? "p2" : "p1",
        ts: Date.now(),
      });
    } catch {
      setDepositErr(true);
    } finally {
      setFunding("");
    }
  }

  async function doClaim() {
    if (!matchId || !winnerSig || !winnerAddr) return;
    setClaimState("claiming");
    try {
      await escrow.claim(
        matchId as `0x${string}`,
        winnerAddr as `0x${string}`,
        winnerSig as `0x${string}`,
      );
      setClaimState("done");
    } catch {
      setClaimState("error");
    }
  }

  function simulate(score: number) {
    const rival = Math.max(0, Math.round(score * (0.6 + Math.random() * 0.9)));
    setRivalScore(rival);
    setOutcome(score > rival ? "win" : score < rival ? "lose" : "draw");
  }

  async function finishMatch(score: number, replay?: unknown) {
    setPlaying(false);
    setYouScore(score);
    if (free) {
      setFreeDone(true);
      return;
    }
    // Guardamos el intento: si el envío falla (red/server), REINTENTAR lo
    // reenvía tal cual en vez de perder la corrida (clave con plata en juego).
    lastRunRef.current = { score, replay };
    if (offline || !matchId) {
      if (devMode) simulate(score);
      else setError("server");
      return;
    }
    setSubmitting(true);
    try {
      // Si hay wallet conectada, firmamos el envio (autenticacion). En móvil por
      // QR, esto abre la firma en el celular: el modal avisa que hay que ir ahí.
      let signature: string | undefined;
      if (address) {
        try {
          signature = await signMessageAsync({
            message: scoreAuthMessage(matchId, pidRef.current, score),
          });
        } catch {
          // Canceló (o no vio) la firma en su wallet. En producción el árbitro
          // la exige: avisamos la verdad ("cancelaste la firma") con REINTENTAR,
          // en vez de enviar sin firma, rebotar y culpar falsamente al servidor.
          if (!devMode) {
            setError("sign");
            return;
          }
          /* en dev se envia sin firma */
        }
      }
      const v = await submitScore(matchId, pidRef.current, score, replay, signature);
      if (v.status === "settled" || v.status === "draw") applyResult(v);
      else setWaiting(true);
    } catch {
      if (devMode) simulate(score);
      else setError("server");
    } finally {
      setSubmitting(false);
    }
  }

  async function tryBot() {
    if (!matchId) return;
    try {
      const v = await playBot(matchId);
      if (v.status === "settled" || v.status === "draw") {
        applyResult(v);
        setWaiting(false);
      }
    } catch {
      /* noop */
    }
  }

  // RENDICIÓN REAL: al abandonar, se envía un puntaje 0 verificable (replay
  // vacío con la semilla de la partida). Así el árbitro decide YA y el rival
  // gana y cobra en minutos — que es lo que el texto de abandono promete. Sin
  // esto, el árbitro nunca se enteraba y el rival quedaba esperando ~2 horas
  // hasta el reembolso por expiración. Best-effort: si falla (red caída, firma
  // cancelada), la partida expira y se reembolsa como antes.
  async function submitForfeit() {
    if (!matchId || seed === null) return;
    const emptyReplay =
      game!.id === "2048"
        ? { seed, moves: [] }
        : game!.id === "flappy"
          ? { seed, ticks: 0, flaps: [] }
          : { seed, ticks: 0, inputs: [] };
    try {
      let signature: string | undefined;
      if (address) {
        signature = await signMessageAsync({
          message: scoreAuthMessage(matchId, pidRef.current, 0),
        });
      }
      await submitScore(matchId, pidRef.current, 0, emptyReplay, signature);
    } catch {
      /* best-effort: sin aviso al árbitro, queda el reembolso por expiración */
    }
  }

  function handleExit() {
    if (free || !playing || outcome !== null) {
      router.push("/");
      return;
    }
    if (!window.confirm(t("match.confirmExit"))) return;
    setPlaying(false);
    setForfeit(true);
    setRivalScore(youScore ?? 0);
    setOutcome("lose");
    void submitForfeit();
  }

  // REINTENTAR tras un error: si ya jugamos, reenvía el puntaje guardado; si
  // el error fue antes (firma o emparejamiento), vuelve a buscar rival.
  function retryAfterError() {
    setError(null);
    if (matchId && lastRunRef.current) {
      finishMatch(lastRunRef.current.score, lastRunRef.current.replay);
    } else {
      setRetry((r) => r + 1);
    }
  }

  function replayFree() {
    setSeed(rnd());
    setRound((r) => r + 1);
    setYouScore(null);
    setFreeDone(false);
    setPlaying(false);
  }

  const gameProps = { onStarted: () => setPlaying(true) };

  return (
    <div className="mx-auto max-w-2xl">
      <button
        onClick={handleExit}
        className="text-sm font-medium text-(--color-accent-2) hover:underline"
      >
        {t("match.exit")}
      </button>

      {/* Marcador */}
      <div className="win mt-3">
        <div className="win-title">
          <span>
            {t(`game.${game.id}.name`).toUpperCase()} ·{" "}
            {free ? t("match.modeFree") : rankedFree ? t("match.freeLadder") : `${bet} USDC`}
          </span>
          {free ? (
            <span className="chip !text-(--color-lime)">{t("match.gratis")}</span>
          ) : rankedFree ? (
            <span className="chip !text-(--color-lime)">{t("match.rankedChip")}</span>
          ) : (
            <span className="chip !text-(--color-gold)">{t("match.pot", { n: payout.pot })}</span>
          )}
        </div>
        {!free && (
          <div className="flex items-center justify-between p-4">
            <ScoreSide label={t("match.you")} score={youScore} />
            <span className="font-pixel text-base text-(--color-gold) blink">VS</span>
            <ScoreSide label={t("match.rival")} score={rivalScore} right />
          </div>
        )}
        {free && (
          <p className="px-4 py-3 text-center text-base text-(--color-muted)">
            {t("match.freeIntro")}
          </p>
        )}
      </div>

      {/* Area de juego */}
      <div className="win mt-4">
        <div className="win-title win-title--cyan">
          <span>{t("match.playing")}</span>
          <span className="win-dots">
            <span className="win-dot" />
            <span className="win-dot" />
          </span>
        </div>
        <div className="p-5">
          {error ? (
            <div className="py-8 text-center">
              <p className="text-base font-medium text-(--color-lose)">
                {error === "sign" ? t("match.signCancelled") : t("match.error")}
              </p>
              <button onClick={retryAfterError} className="btn3d btn3d--magenta mt-5">
                {t("match.retry")}
              </button>
            </div>
          ) : needsWallet ? (
            <div className="py-8 text-center">
              {/* En la ladder gratis no hay depósito: el texto lo dice (la wallet
                  es solo para firmar y rankear). En mesas de plata, el de siempre. */}
              <p className="text-base font-medium text-(--color-accent-2)">
                {rankedFree ? t("match.connectFirstFree") : t("match.connectFirst")}
              </p>
              <button onClick={connect} className="btn3d btn3d--magenta mt-5">
                {t("connect")}
              </button>
              {/* PUERTA PARA CURIOSOS: probar el juego SIN wallet, en modo práctica
                  (offline, sin ranking). Recarga limpia con ?free=1: el estado del
                  emparejamiento no es re-entrante (mismo patrón que la revancha). */}
              {rankedFree && (
                <p className="mt-4">
                  <button
                    onClick={() => window.location.assign(`/game/${gameId}/match?free=1`)}
                    className="text-sm font-medium text-(--color-accent-2) hover:underline"
                  >
                    {t("match.guestBtn")}
                  </button>
                </p>
              )}
            </div>
          ) : seed === null ? (
            <div className="py-10 text-center">
              <p className="text-base font-medium text-(--color-accent-2)">
                {t("match.connecting")}
              </p>
              {slowHint && (
                <p className="mx-auto mt-3 max-w-sm text-sm text-(--color-muted-2)">
                  {t("match.waking")}
                </p>
              )}
            </div>
          ) : needsDeposit && !deposited ? (
            <div className="py-6 text-center">
              <p className="font-pixel text-sm text-(--color-gold)">{t("match.playTitle")}</p>
              <p className="mx-auto mt-3 max-w-sm text-base leading-relaxed text-(--color-muted)">
                {role === "p2" ? t("match.joinHint", { bet }) : t("match.openHint", { bet })}
              </p>
              <button
                onClick={doFund}
                disabled={funding !== ""}
                className="btn3d btn3d--magenta mt-5 w-full disabled:opacity-60"
              >
                {funding === "approving"
                  ? t("match.approving")
                  : funding === "depositing"
                    ? t("match.depositing")
                    : role === "p2"
                      ? t("match.joinBtn", { bet })
                      : t("match.openBtn", { bet })}
              </button>
              {funding !== "" ? (
                <p className="mt-3 text-sm text-(--color-muted-2)">{t("match.fundingNote")}</p>
              ) : depositErr ? (
                <>
                  <p className="mt-3 text-sm text-(--color-lose)">{t("match.depositRetry")}</p>
                  {/* Causa típica del fallo en testnet: sin fichas de prueba. Atajo al faucet. */}
                  {!IS_MAINNET && (
                    <p className="mt-2 text-sm">
                      <Link href="/faucet" className="text-(--color-accent-2) hover:underline">
                        {t("match.faucetLink")}
                      </Link>
                    </p>
                  )}
                </>
              ) : null}
            </div>
          ) : game.id === "tetris" ? (
            <TetrisGame
              key={round}
              seed={seed}
              {...gameProps}
              onFinish={(r: TetrisResult) => finishMatch(r.score, r.replay)}
            />
          ) : game.id === "flappy" ? (
            <FlappyGame
              key={round}
              seed={seed}
              {...gameProps}
              onFinish={(r: FlappyResult) => finishMatch(r.score, r.replay)}
            />
          ) : game.id === "racing" ? (
            <RacingGame
              key={round}
              seed={seed}
              {...gameProps}
              onFinish={(r: RacingResult) => finishMatch(r.score, r.replay)}
            />
          ) : game.id === "snake" ? (
            <SnakeGame
              key={round}
              seed={seed}
              {...gameProps}
              onFinish={(r: SnakeResult) => finishMatch(r.score, r.replay)}
            />
          ) : game.id === "invaders" ? (
            <InvadersGame
              key={round}
              seed={seed}
              {...gameProps}
              onFinish={(r: InvadersResult) => finishMatch(r.score, r.replay)}
            />
          ) : (
            <Game2048Component
              key={round}
              seed={seed}
              {...gameProps}
              onFinish={(r: Result2048) => finishMatch(r.score, r.replay)}
            />
          )}
        </div>
      </div>

      {!free && (
        <p className="mt-3 text-center text-sm text-(--color-muted-3)">{t("match.pairNote")}</p>
      )}

      {/* Enviando el puntaje: hay que confirmar la firma (clave en móvil por QR) */}
      {submitting && !waiting && outcome === null && (
        <Modal title={t("match.signing")}>
          <div className="text-5xl">📲</div>
          <p className="mt-4 text-base leading-relaxed text-(--color-muted-bright)">
            {t("match.signingBody")}
          </p>
        </Modal>
      )}

      {/* Esperando que el rival juegue (asincronico) */}
      {waiting && outcome === null && (
        <Modal title={t("match.playing")}>
          <div className="relative mx-auto h-14 w-14">
            <span className="absolute inset-0 animate-spin rounded-full border-4 border-(--color-border) border-t-(--color-accent)" />
          </div>
          <p className="mt-4 text-base text-(--color-muted-bright)">{t("match.waitingRival")}</p>
          <p className="mt-2 text-base text-(--color-muted-2)">
            {t("match.yourScore")}: <b className="text-(--color-gold)">{youScore}</b>
          </p>
          <div className="mt-5 flex flex-col gap-3">
            {/* El bot de práctica solo existe en desarrollo (en producción el
                árbitro lo rechaza; no mostramos un botón muerto). */}
            {devMode && (
              <button onClick={tryBot} className="btn3d btn3d--cyan w-full">
                {t("match.vsBot")}
              </button>
            )}
            <button onClick={() => router.push("/")} className="btn3d btn3d--magenta w-full">
              {t("home")}
            </button>
          </div>
        </Modal>
      )}

      {/* Resultado MODO LIBRE */}
      {freeDone && (
        <Modal title={t("result.exe")}>
          <div className="flex justify-center">
            <GameIcon id={game.id} size={56} />
          </div>
          <h2 className="font-pixel mt-3 text-lg text-(--color-accent-2)">{t("match.freeHead")}</h2>
          <p className="mt-3 text-base text-(--color-muted-bright)">{t("match.yourScore")}</p>
          <p className="font-pixel mt-1 text-3xl text-(--color-gold)">{youScore}</p>
          <p className="mt-3 text-base leading-relaxed text-(--color-muted)">
            {t("match.freeUpsell")}
          </p>
          <div className="mt-5 flex flex-col gap-3">
            <button
              onClick={() => router.push(`/game/${gameId}`)}
              className="btn3d btn3d--magenta w-full"
            >
              {t("match.playUsdc")}
            </button>
            <div className="flex gap-3">
              <button onClick={replayFree} className="btn3d btn3d--cyan flex-1">
                {t("match.playAgain")}
              </button>
              <button onClick={() => router.push("/")} className="btn3d btn3d--cyan flex-1">
                {t("home")}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Resultado partida de plata */}
      {outcome !== null && (
        <Modal title={t("result.exe")}>
          <div className="text-6xl">
            {forfeit ? "🏳️" : outcome === "win" ? "🏆" : outcome === "lose" ? "💀" : "🤝"}
          </div>
          <h2
            className={`font-pixel mt-3 text-lg ${
              outcome === "win"
                ? "text-(--color-win)"
                : outcome === "draw"
                  ? "text-(--color-text)"
                  : "text-(--color-lose)"
            }`}
          >
            {forfeit
              ? t("match.forfeit")
              : outcome === "win"
                ? t("match.win")
                : outcome === "lose"
                  ? t("match.lose")
                  : t("match.draw")}
          </h2>

          {forfeit ? (
            <p className="mt-4 text-base leading-relaxed text-(--color-muted)">
              {t("match.forfeitText", { pot: payout.pot })}
            </p>
          ) : (
            <>
              <div className="mt-4 flex items-center justify-center gap-6 text-base">
                <div>
                  <div className="text-sm text-(--color-muted-2)">{t("match.you")}</div>
                  <div className="font-pixel text-base text-(--color-accent-2)">{youScore}</div>
                </div>
                <div className="text-(--color-muted-3)">vs</div>
                <div>
                  <div className="text-sm text-(--color-muted-2)">{t("match.rival")}</div>
                  <div className="font-pixel text-base text-(--color-muted-bright)">
                    {rivalScore}
                  </div>
                </div>
              </div>
              {rating !== null && (
                <p className="mt-3 text-sm text-(--color-muted)">
                  {t("lb.rating")}: <b className="text-(--color-gold)">{rating}</b>{" "}
                  <span className={ratingDelta >= 0 ? "text-(--color-win)" : "text-(--color-lose)"}>
                    ({ratingDelta >= 0 ? "+" : ""}
                    {ratingDelta})
                  </span>
                </p>
              )}
              {rivalReplay != null && !forfeit && (
                <button
                  onClick={() => setShowRival(true)}
                  className="btn3d btn3d--cyan mt-4 w-full"
                >
                  🎬 {t("match.watchRival")}
                </button>
              )}
              {rankedFree && (
                <p className="mt-4 text-sm leading-relaxed text-(--color-muted)">
                  {t("match.freeRankedNote")}
                </p>
              )}
              {!rankedFree && (
                <div className="win mt-5">
                  <div className="win-title">
                    <span>{t("match.cashlog")}</span>
                  </div>
                  <div className="p-4 text-base">
                    {outcome === "win" && (
                      <>
                        <Money label={t("table.totalPot")} value={`${payout.pot} USDC`} />
                        <Money
                          label={t("table.fee", { pct: PLATFORM_FEE * 100 })}
                          value={`- ${payout.fee} USDC`}
                        />
                        <div className="my-2 border-t border-(--color-border)" />
                        <div className="flex justify-between">
                          <span className="text-(--color-muted)">{t("match.cobras")}</span>
                          <span className="font-pixel text-sm text-(--color-win)">
                            {payout.prize} USDC
                          </span>
                        </div>
                      </>
                    )}
                    {outcome === "lose" && (
                      <p className="text-(--color-muted)">{t("match.loseText", { bet })}</p>
                    )}
                    {outcome === "draw" && (
                      <p className="text-(--color-muted)">{t("match.drawText", { bet })}</p>
                    )}
                  </div>
                </div>
              )}
              {outcome === "win" && !rankedFree && onchainEnabled && winnerSig && (
                <div className="mt-4">
                  {claimState === "done" ? (
                    <p className="text-base font-medium text-(--color-win)">
                      {t("match.claimDone")}
                    </p>
                  ) : (
                    <>
                      <button
                        onClick={doClaim}
                        disabled={claimState === "claiming"}
                        className="btn3d btn3d--magenta w-full disabled:opacity-60"
                      >
                        {claimState === "claiming"
                          ? t("match.depositWait")
                          : t("match.claimBtn", { prize: payout.prize })}
                      </button>
                      {claimState === "error" && (
                        <p className="mt-2 text-sm text-(--color-lose)">{t("match.claimErr")}</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}

          <div className="mt-5 flex gap-3">
            {!forfeit && (
              <button
                onClick={() => {
                  // Revancha gratis: recarga limpia de la misma URL (el estado
                  // del emparejamiento no es re-entrante). De plata: a la mesa.
                  if (rankedFree) window.location.assign(`/game/${gameId}/match?bet=0`);
                  else router.push(`/game/${gameId}`);
                }}
                className="btn3d btn3d--magenta flex-1"
              >
                {t("match.rematch")}
              </button>
            )}
            <button onClick={() => router.push("/")} className="btn3d btn3d--cyan flex-1">
              {t("home")}
            </button>
          </div>
        </Modal>
      )}

      {/* Replay del rival (feedback rico: mirá cómo jugó para aprender) */}
      {showRival && rivalReplay != null && (
        <Modal title={t("match.rivalRun")}>
          <ReplayPlayer game={game.id} replay={rivalReplay} />
          <button onClick={() => setShowRival(false)} className="btn3d btn3d--magenta mt-4 w-full">
            {t("close")}
          </button>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4">
      <div className="win w-full max-w-sm">
        <div className="win-title">
          <span>{title}</span>
          <span className="win-dots">
            <span className="win-dot" />
          </span>
        </div>
        <div className="p-6 text-center">{children}</div>
      </div>
    </div>
  );
}

function ScoreSide({
  label,
  score,
  right,
}: {
  label: string;
  score: number | null;
  right?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${right ? "flex-row-reverse" : ""}`}>
      <div
        className={`font-pixel flex h-12 w-12 items-center justify-center rounded-lg border border-(--color-border) bg-(--color-surface-2) text-sm ${
          right ? "text-(--color-muted-2)" : "text-(--color-accent)"
        }`}
      >
        {right ? "P2" : "P1"}
      </div>
      <div className={right ? "text-right" : ""}>
        <div className="font-pixel text-px10 text-(--color-muted-2)">{label}</div>
        <div className="font-pixel text-base text-(--color-gold)">{score ?? "--"}</div>
      </div>
    </div>
  );
}

function Money({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-(--color-muted-2)">{label}</span>
      <span className="text-(--color-text)">{value}</span>
    </div>
  );
}
