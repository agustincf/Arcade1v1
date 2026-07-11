"use client";

// BUILDER de agentes no-code: wizard de 5 pasos para crear un agente hosteado
// sin escribir código — elegir juego, ajustar la estrategia con perillas (con
// score estimado en vivo), ponerle nombre y avatar, probarlo en un sandbox y
// desplegarlo firmando con la wallet. Corre TODO con el motor real (via
// @arcade1v1/strategies), así lo que se ve acá es lo que jugará el agente.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSignMessage } from "wagmi";
import { agentAuthMessage } from "@arcade1v1/game-sdk/auth";
import {
  AGENT_AVATARS,
  strategiesFor,
  getStrategy,
  defaultParams,
  runStrategy,
  type ParamSpec,
  type PlayResult,
} from "@arcade1v1/strategies";
import { useT } from "@/app/lib/i18n";
import { useWallet } from "@/app/lib/wallet";
import { GAMES } from "@/app/lib/games";
import { GameIcon } from "@/app/components/GameIcon";
import { ReplayPlayer } from "@/app/components/replay/ReplayPlayer";
import { createAgent, warmUpArbiter } from "@/app/lib/arbiter";

const TOTAL_STEPS = 5;
// Mismos seeds fijos que los tests de estrategias: el estimado es estable
// entre visitas y comparable con lo que verifica la suite.
const EST_SEEDS = [42, 987654, 20260709];

export default function BuildPage() {
  const { t } = useT();
  const router = useRouter();
  const { address, connect } = useWallet();
  const { signMessageAsync } = useSignMessage();

  const [step, setStep] = useState(1);
  const [game, setGame] = useState<string | null>(null);
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AGENT_AVATARS[0]);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [sandbox, setSandbox] = useState<PlayResult | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState(false);
  const [slowHint, setSlowHint] = useState(false);

  // El deploy pega al árbitro; despertarlo ya (hosting gratuito que duerme).
  useEffect(() => {
    warmUpArbiter();
  }, []);

  // Si "Desplegando…" se estira (el hosting gratuito despierta de a poco),
  // lo decimos: sin este aviso parecía colgado (mismo patrón que la mesa).
  useEffect(() => {
    if (!deploying) {
      setSlowHint(false);
      return;
    }
    const tm = setTimeout(() => setSlowHint(true), 5000);
    return () => clearTimeout(tm);
  }, [deploying]);

  const def = strategyId ? getStrategy(strategyId) : undefined;

  // Score estimado en vivo (paso 2): promedio sobre seeds fijos, con debounce
  // (mientras se arrastra un slider) y yields al event loop entre seeds para
  // no congelar la UI (snake tarda ~400ms por corrida). El flag `cancelled`
  // evita que una corrida vieja pise un estimado más nuevo.
  useEffect(() => {
    if (!game || !strategyId) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const cfg = { game, strategyId, params };
      let total = 0;
      for (const seed of EST_SEEDS) {
        await new Promise((r) => setTimeout(r, 0));
        if (cancelled) return;
        total += runStrategy(cfg, seed).score;
      }
      if (!cancelled) setEstimate(Math.round(total / EST_SEEDS.length));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [game, strategyId, params]);

  function pickGame(id: string) {
    const first = strategiesFor(id)[0];
    if (!first) return;
    setGame(id);
    setStrategyId(first.id);
    setParams(defaultParams(first));
    setSandbox(null);
    setEstimate(null);
  }

  function setParam(key: string, value: unknown) {
    setParams((p) => ({ ...p, [key]: value }));
    setSandbox(null);
  }

  function runSandbox() {
    if (!game || !strategyId) return;
    const seed = (Math.random() * 0x7fffffff) | 0;
    setSandbox(runStrategy({ game, strategyId, params }, seed));
  }

  async function deploy() {
    if (!address || !game || !strategyId) return;
    setDeploying(true);
    setDeployError(false);
    const agentName = name.trim();
    let signature: string;
    const ts = Date.now();
    try {
      // El ref firmado tiene que ser BYTE a byte igual al que arma el server:
      // "juego:estrategia:nombre" con el mismo nombre que va en el body.
      signature = await signMessageAsync({
        message: agentAuthMessage("create", `${game}:${strategyId}:${agentName}`, address, ts),
      });
    } catch {
      // canceló la firma: no es un error, se queda en el paso 5
      setDeploying(false);
      return;
    }
    try {
      const agent = await createAgent({
        owner: address,
        name: agentName,
        avatar,
        game,
        strategyId,
        params,
        signature,
        ts,
      });
      router.push(`/my-agents/${agent.id}`);
    } catch {
      // server caído o límite de 3 agentes por wallet
      setDeployError(true);
      setDeploying(false);
    }
  }

  const canNext =
    step === 1 ? game !== null : step === 3 ? name.trim().length > 0 : step < TOTAL_STEPS;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm font-medium text-(--color-accent-2) hover:underline">
        {t("back")}
      </Link>

      <div className="win mt-3">
        <div className="win-title">
          <span>{t("build.title")}</span>
          <span className="chip !text-(--color-lime)">
            {t("build.step", { n: step, total: TOTAL_STEPS })}
          </span>
        </div>
        <div className="p-5">
          <h1 className="font-pixel text-sm text-(--color-accent-2)">
            {t(`build.s${step}.title`)}
          </h1>
          <p className="mt-2 text-base leading-relaxed text-(--color-muted)">
            {t(`build.s${step}.body`)}
          </p>

          {/* Paso 1: elegir juego */}
          {step === 1 && (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {GAMES.filter((g) => g.status === "live").map((g) => (
                <button
                  key={g.id}
                  onClick={() => pickGame(g.id)}
                  className={`win flex flex-col items-center gap-2 p-4 transition hover:-translate-y-0.5 ${
                    game === g.id ? "!border-(--color-accent)" : ""
                  }`}
                >
                  <GameIcon id={g.id} size={44} />
                  <span className="text-sm text-(--color-muted-bright)">
                    {t(`game.${g.id}.name`)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Paso 2: elegir estilo (si hay >1) + perillas + score estimado en vivo */}
          {step === 2 && def && game && (
            <>
              {strategiesFor(game).length > 1 && (
                <>
                  <p className="mt-4 text-sm text-(--color-muted-2)">{t("build.style")}</p>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    {strategiesFor(game).map((s) => (
                      <button
                        key={s.id}
                        onClick={() => {
                          setStrategyId(s.id);
                          setParams(defaultParams(s));
                          setSandbox(null);
                        }}
                        className={`win p-3 text-left transition hover:-translate-y-0.5 ${
                          strategyId === s.id ? "!border-(--color-accent)" : ""
                        }`}
                      >
                        <p className="font-pixel text-px10 text-(--color-accent-2)">
                          {t(s.labelKey)}
                        </p>
                        {s.descKey && (
                          <p className="mt-1 text-sm leading-snug text-(--color-muted)">
                            {t(s.descKey)}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="win mt-4 p-4">
                <p className="font-pixel text-px10 text-(--color-accent-2)">{t(def.labelKey)}</p>
                {def.params.map((p) =>
                  p.kind === "slider" ? (
                    <SliderControl
                      key={p.key}
                      spec={p}
                      value={params[p.key] as number}
                      onChange={(v) => setParam(p.key, v)}
                    />
                  ) : p.kind === "choice" ? (
                    <ChoiceControl
                      key={p.key}
                      spec={p}
                      value={params[p.key] as string}
                      onChange={(v) => setParam(p.key, v)}
                    />
                  ) : (
                    <PriorityControl
                      key={p.key}
                      spec={p}
                      value={params[p.key] as string[]}
                      onChange={(v) => setParam(p.key, v)}
                    />
                  ),
                )}
              </div>
              <div className="win mt-4 flex items-center justify-between p-4">
                <span className="text-sm text-(--color-muted-2)">{t("build.estimate")}</span>
                <span className="font-pixel text-sm text-(--color-gold)">{estimate ?? "…"}</span>
              </div>
            </>
          )}

          {/* Paso 3: nombre + avatar */}
          {step === 3 && (
            <div className="mt-5">
              <label className="block text-sm font-medium text-(--color-muted-2)">
                {t("build.name")}
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={24}
                  placeholder={t("build.namePh")}
                  className="mt-2 w-full rounded-md border-2 border-(--color-border) bg-(--color-ink) px-3 py-2 text-base text-(--color-text) outline-none focus:border-(--color-accent)"
                />
              </label>
              <p className="mt-4 text-sm font-medium text-(--color-muted-2)">{t("build.avatar")}</p>
              <div className="mt-2 grid grid-cols-5 gap-2 sm:grid-cols-10">
                {AGENT_AVATARS.map((a) => (
                  <button
                    key={a}
                    onClick={() => setAvatar(a)}
                    className={`win p-2 text-2xl transition hover:-translate-y-0.5 ${
                      avatar === a ? "!border-(--color-accent)" : ""
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
              <div className="win mt-4 flex items-center gap-3 p-3">
                <span className="text-3xl">{avatar}</span>
                <span className="font-pixel text-xs text-(--color-text)">
                  {name.trim() || t("build.yourAgent")}
                </span>
              </div>
            </div>
          )}

          {/* Paso 4: sandbox (replay visual con el motor real) */}
          {step === 4 && game && (
            <div className="mt-5">
              {!sandbox ? (
                <button onClick={runSandbox} className="btn3d btn3d--magenta w-full">
                  ▶ {t("build.test")}
                </button>
              ) : (
                <>
                  <div className="flex justify-center">
                    <ReplayPlayer
                      game={game}
                      replay={sandbox.replay}
                      label={`${avatar} ${name.trim() || t("build.yourAgent")}`}
                    />
                  </div>
                  <button onClick={runSandbox} className="btn3d btn3d--cyan mt-4 w-full">
                    ⟲ {t("build.testAgain")}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Paso 5: resumen + deploy firmado */}
          {step === 5 && game && def && (
            <div className="mt-5">
              <div className="win p-4 text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{avatar}</span>
                  <span className="font-pixel text-xs text-(--color-text)">
                    {name.trim() || t("build.yourAgent")}
                  </span>
                </div>
                <div className="mt-3 flex justify-between">
                  <span className="text-(--color-muted-2)">{t("build.game")}</span>
                  <span className="flex items-center gap-2 text-(--color-text)">
                    <GameIcon id={game} size={16} /> {t(`game.${game}.name`)}
                  </span>
                </div>
                <div className="mt-2 flex justify-between">
                  <span className="text-(--color-muted-2)">{t("build.strategy")}</span>
                  <span className="text-(--color-text)">{t(def.labelKey)}</span>
                </div>
                {def.params.map((p) => (
                  <div key={p.key} className="mt-2 flex justify-between">
                    <span className="text-(--color-muted-2)">{t(p.labelKey)}</span>
                    <span className="text-(--color-text)">
                      {Array.isArray(params[p.key])
                        ? (params[p.key] as string[]).map((o) => t(`strat.opt.${o}`)).join(" → ")
                        : p.kind === "choice"
                          ? t(`strat.opt.${String(params[p.key])}`)
                          : String(params[p.key])}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-sm leading-relaxed text-(--color-muted-2)">
                {t("build.deployNote")}
              </p>
              {!address ? (
                <button onClick={connect} className="btn3d btn3d--magenta mt-4 w-full">
                  {t("connect")}
                </button>
              ) : (
                <button
                  onClick={deploy}
                  disabled={deploying}
                  className="btn3d btn3d--magenta mt-4 w-full disabled:opacity-50"
                >
                  {deploying ? t("build.deploying") : `🚀 ${t("build.deploy")}`}
                </button>
              )}
              {deploying && slowHint && (
                <p className="mx-auto mt-3 max-w-sm text-center text-sm text-(--color-muted-2)">
                  {t("build.waking")}
                </p>
              )}
              {deployError && (
                <p className="mt-3 text-center text-sm text-(--color-lose)">{t("match.error")}</p>
              )}
            </div>
          )}

          {/* Navegación */}
          <div className="mt-6 flex gap-3">
            {step > 1 && (
              <button onClick={() => setStep(step - 1)} className="btn3d btn3d--cyan flex-1">
                {t("build.prev")}
              </button>
            )}
            {step < TOTAL_STEPS && (
              <button
                onClick={() => setStep(step + 1)}
                disabled={!canNext}
                className="btn3d btn3d--magenta flex-1 disabled:opacity-50"
              >
                {t("build.next")} ▶
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------- Controles por ParamSpec ------------------------ */
/* slider -> range, choice -> chips, priority -> lista con flechas (sin DnD) */

function SliderControl({
  spec,
  value,
  onChange,
}: {
  spec: ParamSpec;
  value: number;
  onChange: (v: number) => void;
}) {
  const { t } = useT();
  return (
    <div className="mt-3">
      <div className="flex justify-between text-sm">
        <span className="text-(--color-muted-2)">{t(spec.labelKey)}</span>
        <span className="font-pixel text-px10 text-(--color-gold)">{value}</span>
      </div>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-(--color-accent)"
      />
    </div>
  );
}

function ChoiceControl({
  spec,
  value,
  onChange,
}: {
  spec: ParamSpec;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useT();
  return (
    <div className="mt-3">
      <p className="text-sm text-(--color-muted-2)">{t(spec.labelKey)}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {(spec.options ?? []).map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`chip transition ${value === opt ? "!text-(--color-lime)" : ""}`}
          >
            {t(`strat.opt.${opt}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

function PriorityControl({
  spec,
  value,
  onChange,
}: {
  spec: ParamSpec;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const { t } = useT();
  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const out = value.slice();
    [out[i], out[j]] = [out[j], out[i]];
    onChange(out);
  }
  return (
    <div className="mt-3">
      <p className="text-sm text-(--color-muted-2)">{t(spec.labelKey)}</p>
      <div className="mt-1 flex flex-col gap-1">
        {value.map((opt, i) => (
          <div key={opt} className="flex items-center gap-2 text-sm">
            <span className="font-pixel w-5 text-px10 text-(--color-gold)">{i + 1}</span>
            <span className="flex-1 text-(--color-text)">{t(`strat.opt.${opt}`)}</span>
            <button
              onClick={() => move(i, -1)}
              disabled={i === 0}
              className="btn3d btn3d--sm btn3d--cyan disabled:opacity-40"
            >
              ▲
            </button>
            <button
              onClick={() => move(i, 1)}
              disabled={i === value.length - 1}
              className="btn3d btn3d--sm btn3d--cyan disabled:opacity-40"
            >
              ▼
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
