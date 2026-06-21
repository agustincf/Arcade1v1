"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getGame } from "@/app/lib/games";
import { getPayout, PLATFORM_FEE } from "@/app/lib/config";
import { GameIcon } from "@/app/components/GameIcon";
import { useT } from "@/app/lib/i18n";
import { useWallet } from "@/app/lib/wallet";
import {
  matchmake,
  submitScore,
  getMatch,
  playBot,
  playerId,
  type MatchView,
} from "@/app/lib/arbiter";
import { TetrisGame, type TetrisResult } from "@/app/games/tetris/TetrisGame";
import { FlappyGame, type FlappyResult } from "@/app/games/flappy/FlappyGame";
import { RacingGame, type RacingResult } from "@/app/games/racing/RacingGame";
import { Game2048Component, type Result2048 } from "@/app/games/g2048/Game2048";

type Outcome = "win" | "lose" | "draw" | null;
const rnd = () => Math.floor(Math.random() * 1e9);

export default function MatchPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = use(params);
  const game = getGame(gameId);
  const router = useRouter();
  const search = useSearchParams();
  const { t } = useT();
  const { address } = useWallet();
  const free = search.get("free") === "1";
  const bet = Number(search.get("bet") ?? 0);
  const payout = getPayout(bet);

  const [seed, setSeed] = useState<number | null>(free ? rnd() : null);
  const [round, setRound] = useState(0);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [youScore, setYouScore] = useState<number | null>(null);
  const [rivalScore, setRivalScore] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [freeDone, setFreeDone] = useState(false);
  const [forfeit, setForfeit] = useState(false);
  const pidRef = useRef<string>("");

  // Emparejamiento con el arbitro (solo partidas de plata). Si el servidor no
  // responde, seguimos en modo "offline" con rival simulado (no se cuelga).
  useEffect(() => {
    if (free) return;
    pidRef.current = playerId(address ?? null);
    let cancel = false;
    (async () => {
      try {
        const v = await matchmake(game!.id, bet, pidRef.current);
        if (cancel) return;
        setMatchId(v.matchId);
        setSeed(v.seed);
      } catch {
        if (cancel) return;
        setOffline(true);
        setSeed(rnd());
      }
    })();
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, matchId]);

  if (!game) return null;

  function applyResult(v: MatchView) {
    const opp = v.opponent;
    setRivalScore(opp ? (v.scores[opp] ?? 0) : 0);
    if (v.outcome === "draw") setOutcome("draw");
    else if (v.outcome && v.role === v.outcome) setOutcome("win");
    else setOutcome("lose");
  }

  function simulate(score: number) {
    const rival = Math.max(0, Math.round(score * (0.6 + Math.random() * 0.9)));
    setRivalScore(rival);
    setOutcome(score > rival ? "win" : score < rival ? "lose" : "draw");
  }

  async function finishMatch(score: number) {
    setPlaying(false);
    setYouScore(score);
    if (free) {
      setFreeDone(true);
      return;
    }
    if (offline || !matchId) {
      simulate(score);
      return;
    }
    try {
      const v = await submitScore(matchId, pidRef.current, score);
      if (v.status === "settled" || v.status === "draw") applyResult(v);
      else setWaiting(true);
    } catch {
      simulate(score);
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
        className="font-screen text-xl text-[--color-accent-2] hover:underline"
      >
        {t("match.exit")}
      </button>

      {/* Marcador */}
      <div className="win mt-3">
        <div className="win-title">
          <span>
            {t(`game.${game.id}.name`).toUpperCase()} ·{" "}
            {free ? t("match.modeFree") : `${bet} USDC`}
          </span>
          {free ? (
            <span className="chip !text-[--color-lime]">{t("match.gratis")}</span>
          ) : (
            <span className="chip !text-[--color-gold]">
              {t("match.pot", { n: payout.pot })}
            </span>
          )}
        </div>
        {!free && (
          <div className="flex items-center justify-between p-4">
            <ScoreSide label={t("match.you")} score={youScore} />
            <span className="font-pixel text-base text-[--color-gold] blink">VS</span>
            <ScoreSide label={t("match.rival")} score={rivalScore} right />
          </div>
        )}
        {free && (
          <p className="font-screen px-4 py-3 text-center text-lg text-slate-300">
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
          {seed === null ? (
            <p className="font-screen py-10 text-center text-xl text-[--color-accent-2]">
              {t("match.connecting")}
            </p>
          ) : game.id === "tetris" ? (
            <TetrisGame key={round} seed={seed} {...gameProps} onFinish={(r: TetrisResult) => finishMatch(r.score)} />
          ) : game.id === "flappy" ? (
            <FlappyGame key={round} seed={seed} {...gameProps} onFinish={(r: FlappyResult) => finishMatch(r.score)} />
          ) : game.id === "racing" ? (
            <RacingGame key={round} seed={seed} {...gameProps} onFinish={(r: RacingResult) => finishMatch(r.score)} />
          ) : (
            <Game2048Component key={round} seed={seed} {...gameProps} onFinish={(r: Result2048) => finishMatch(r.score)} />
          )}
        </div>
      </div>

      {!free && (
        <p className="font-screen mt-3 text-center text-base text-slate-500">
          {t("match.pairNote")}
        </p>
      )}

      {/* Esperando que el rival juegue (asincronico) */}
      {waiting && outcome === null && (
        <Modal title={t("match.playing")}>
          <div className="relative mx-auto h-14 w-14">
            <span className="absolute inset-0 animate-spin rounded-full border-4 border-[--color-border] border-t-[--color-accent]" />
          </div>
          <p className="font-screen mt-4 text-lg text-slate-200">
            {t("match.waitingRival")}
          </p>
          <p className="font-screen mt-2 text-lg text-slate-400">
            {t("match.yourScore")}:{" "}
            <b className="text-[--color-gold]">{youScore}</b>
          </p>
          <div className="mt-5 flex flex-col gap-3">
            <button onClick={tryBot} className="btn3d btn3d--cyan w-full">
              🤖 {t("match.vsBot")}
            </button>
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
          <h2 className="font-pixel mt-3 text-lg text-[--color-accent-2] neon-cyan">
            {t("match.freeHead")}
          </h2>
          <p className="font-screen mt-3 text-xl text-slate-200">{t("match.yourScore")}</p>
          <p className="font-pixel text-3xl text-[--color-gold]">{youScore}</p>
          <p className="font-screen mt-3 text-lg text-slate-300">{t("match.freeUpsell")}</p>
          <div className="mt-5 flex flex-col gap-3">
            <button onClick={() => router.push(`/game/${gameId}`)} className="btn3d btn3d--magenta w-full">
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
              outcome === "win" ? "text-[--color-win]" : outcome === "draw" ? "text-slate-100" : "text-[--color-lose]"
            }`}
          >
            {forfeit ? t("match.forfeit") : outcome === "win" ? t("match.win") : outcome === "lose" ? t("match.lose") : t("match.draw")}
          </h2>

          {forfeit ? (
            <p className="font-screen mt-4 text-lg text-slate-300">
              {t("match.forfeitText", { pot: payout.pot })}
            </p>
          ) : (
            <>
              <div className="font-screen mt-4 flex items-center justify-center gap-6 text-xl">
                <div>
                  <div className="text-slate-400">{t("match.you")}</div>
                  <div className="font-pixel text-base text-[--color-accent-2]">{youScore}</div>
                </div>
                <div className="text-slate-500">vs</div>
                <div>
                  <div className="text-slate-400">{t("match.rival")}</div>
                  <div className="font-pixel text-base text-slate-200">{rivalScore}</div>
                </div>
              </div>
              <div className="win mt-5">
                <div className="win-title"><span>{t("match.cashlog")}</span></div>
                <div className="font-screen p-4 text-lg">
                  {outcome === "win" && (
                    <>
                      <Money label={t("table.totalPot")} value={`${payout.pot} USDC`} />
                      <Money label={t("table.fee", { pct: PLATFORM_FEE * 100 })} value={`- ${payout.fee} USDC`} />
                      <div className="my-2 border-t-2 border-dashed border-[--color-border]" />
                      <div className="flex justify-between">
                        <span className="text-slate-300">{t("match.cobras")}</span>
                        <span className="font-pixel text-sm text-[--color-win]">{payout.prize} USDC</span>
                      </div>
                    </>
                  )}
                  {outcome === "lose" && (
                    <p className="text-slate-300">{t("match.loseText", { bet })}</p>
                  )}
                  {outcome === "draw" && (
                    <p className="text-slate-300">{t("match.drawText", { bet })}</p>
                  )}
                </div>
              </div>
            </>
          )}

          <div className="mt-5 flex gap-3">
            {!forfeit && (
              <button onClick={() => router.push(`/game/${gameId}`)} className="btn3d btn3d--magenta flex-1">
                {t("match.rematch")}
              </button>
            )}
            <button onClick={() => router.push("/")} className="btn3d btn3d--cyan flex-1">
              {t("home")}
            </button>
          </div>
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
      <div className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-[#0a0518] bg-[--color-surface-2] text-xl">
        {right ? "👤" : "🙂"}
      </div>
      <div className={right ? "text-right" : ""}>
        <div className="font-pixel text-[10px] text-slate-400">{label}</div>
        <div className="font-pixel text-base text-[--color-gold]">{score ?? "--"}</div>
      </div>
    </div>
  );
}

function Money({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-100">{value}</span>
    </div>
  );
}
