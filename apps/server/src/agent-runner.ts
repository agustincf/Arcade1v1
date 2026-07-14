// RUNNER de agentes hosteados: el proceso que los hace jugar SOLOS.
// Cada ~30s revisa los agentes activos; el que pasó su cooldown se encola en
// la ladder gratis (stake 0) y, cuando su partida está lista, corre su
// estrategia y envía el puntaje FIRMADO con su propia wallet. Todo va por las
// funciones in-process de matchmaking (un solo code path, mismas reglas que
// cualquier jugador externo: firma, verificación de replay, ELO).

import { privateKeyToAccount } from "viem/accounts";
import { runStrategy } from "@arcade1v1/strategies";
import { matchmakeAuthMessage, scoreAuthMessage } from "@arcade1v1/game-sdk/auth";
import {
  getMatch,
  matchmake,
  peekWaiterAddress,
  submitScore,
  SUBMIT_WINDOW_MS,
  pendingChallengesFor,
  acceptChallenge,
} from "./matchmaking.js";
import {
  hostedAgentByAddress,
  isHouseWallet,
  listAgents,
  recordAgentResult,
  setAgentPending,
  type HostedAgent,
} from "./agents.js";

// Kill switch + perillas de ritmo (por entorno, como el resto de la config).
const ENABLED = process.env.AGENTS_ENABLED !== "false";
const TICK_MS = Number(process.env.AGENT_RUNNER_TICK_MS ?? 30_000);
const PLAY_INTERVAL_MS = Number(process.env.AGENT_PLAY_INTERVAL_MS ?? 10 * 60_000);
const MAX_PLAYS_PER_TICK = Number(process.env.AGENT_MAX_PLAYS_PER_TICK ?? 4);
const AGENT_STAKE = 0; // los agentes hosteados SOLO juegan la ladder gratis
// Cuánto espera el agente desafiado a que el retador juegue antes de soltar el
// desafío (anti denegación de juego). Corto: el retador humano juega en segundos.
const CHALLENGE_ABANDON_MS = Number(process.env.CHALLENGE_ABANDON_MS ?? 5 * 60_000);

const normAddr = (a: string) => String(a).toLowerCase();

async function playPendingMatch(agent: HostedAgent): Promise<boolean> {
  const address = normAddr(agent.address);
  const m = getMatch(agent.pendingMatchId!, address);

  // La partida ya no existe (purgada/expirada): soltar y arrancar de nuevo.
  if (!m) {
    setAgentPending(agent, undefined);
    return false;
  }

  // Terminó: registrar el resultado en el historial del agente.
  if (m.status === "settled" || m.status === "draw") {
    recordAgentResult(agent, {
      matchId: m.matchId,
      game: m.game,
      opponent: m.opponent,
      yourScore: m.yourScore,
      rivalScore: m.rivalScore,
      outcome: m.status === "draw" ? "draw" : m.winner === address ? "win" : "loss",
      ratingDelta: m.ratingDelta,
      ts: Date.now(),
    });
    return false;
  }

  // Espera colgada (el rival nunca jugó y la ventana pasó): soltar.
  if (agent.pendingSince && Date.now() - agent.pendingSince > SUBMIT_WINDOW_MS + 15 * 60_000) {
    setAgentPending(agent, undefined);
    return false;
  }

  // ANTI-DENEGACIÓN DE JUEGO: un DESAFÍO que el retador abandonó (nunca envió su
  // intento) no debe congelar al agente objetivo ~2h. Si soy el desafiado y el
  // retador no jugó dentro de una ventana corta, suelto y vuelvo a la ladder (el
  // match abandonado lo barre el barrendero). Sin esto, un request gratis dejaba
  // a un agente elegido fuera de juego, repetible = DoS dirigido.
  if (
    m.challengeTarget &&
    !m.rivalSubmitted &&
    agent.pendingSince &&
    Date.now() - agent.pendingSince > CHALLENGE_ABANDON_MS
  ) {
    setAgentPending(agent, undefined);
    return false;
  }

  // Con rival y sin nuestro puntaje: jugar ahora (la vista pre-decisión solo
  // muestra el puntaje propio, así que esta lectura no filtra nada). En un
  // DESAFÍO, el agente desafiado NO se compromete (ni gasta cómputo) hasta que el
  // retador jugó: así un desafío abandonado no le cuesta nada (se suelta arriba).
  if (m.status === "ready" && m.scores[address] === undefined) {
    if (m.challengeTarget && !m.rivalSubmitted) return false;
    const { score, replay } = runStrategy(
      { game: agent.game, strategyId: agent.strategyId, params: agent.params },
      m.seed,
    );
    const account = privateKeyToAccount(agent.privateKey);
    const signature = await account.signMessage({
      message: scoreAuthMessage(m.matchId, address, score),
    });
    const after = await submitScore(m.matchId, address, score, replay, signature);
    if (after.status === "settled" || after.status === "draw") {
      recordAgentResult(agent, {
        matchId: after.matchId,
        game: after.game,
        opponent: after.opponent,
        yourScore: after.yourScore,
        rivalScore: after.rivalScore,
        outcome: after.status === "draw" ? "draw" : after.winner === address ? "win" : "loss",
        ratingDelta: after.ratingDelta,
        ts: Date.now(),
      });
    }
    return true; // jugó (cuenta para el throttle global)
  }

  return false; // sigue esperando rival o el resultado del rival
}

async function enqueueAgent(agent: HostedAgent) {
  const address = normAddr(agent.address);
  // ANTI ELO-FARMING: si el que espera en la cola es OTRO agente hosteado del
  // mismo dueño, este tick no emparejamos (nada de inflar rating con un
  // "gemelo sacrificable"). Los agentes solo juegan vía este runner, así que
  // el chequeo acá cierra el caso por completo. EXCEPCIÓN: la casa — sus
  // agentes comparten wallet a propósito y jugar entre sí ES su función
  // (arena viva 24/7 en los 6 juegos); la etiqueta CASA mantiene el ranking
  // interpretable. El candado sigue intacto para terceros.
  const waiting = peekWaiterAddress(agent.game, AGENT_STAKE);
  if (waiting && !isHouseWallet(agent.owner)) {
    const other = hostedAgentByAddress(waiting);
    if (other && other.owner === agent.owner && normAddr(other.address) !== address) return;
  }
  const ts = Date.now();
  const account = privateKeyToAccount(agent.privateKey);
  const signature = await account.signMessage({
    message: matchmakeAuthMessage(agent.game, AGENT_STAKE, address, ts),
  });
  const m = await matchmake(agent.game, AGENT_STAKE, address, { signature, ts });
  setAgentPending(agent, m.matchId);
}

/** Un tick del runner. Exportado para poder probarlo en forma directa. */
export async function runAgentsTick(now = Date.now()): Promise<void> {
  let plays = 0;
  for (const agent of listAgents()) {
    if (!agent.active) continue;
    if (plays >= MAX_PLAYS_PER_TICK) break;
    try {
      if (agent.pendingMatchId) {
        if (await playPendingMatch(agent)) plays++;
        continue;
      }
      // DESAFÍOS: tienen prioridad sobre la cola aleatoria. Si hay uno dirigido a
      // este agente, lo acepta (in-process) y lo juega.
      const challenges = pendingChallengesFor(agent.address);
      if (challenges.length) {
        acceptChallenge(challenges[0].matchId, agent.address);
        setAgentPending(agent, challenges[0].matchId);
        if (await playPendingMatch(agent)) plays++;
        continue;
      }
      // Cooldown con jitter (±20%) para que los agentes no entren todos en
      // fila exacta y se emparejen siempre entre los mismos.
      const jitter = 1 + (Math.random() - 0.5) * 0.4;
      const due = !agent.lastPlayedAt || now - agent.lastPlayedAt > PLAY_INTERVAL_MS * jitter;
      if (due) await enqueueAgent(agent);
    } catch (e) {
      console.error(`agent ${agent.id} (${agent.game}):`, (e as Error).message);
    }
  }
}

if (ENABLED) {
  const timer = setInterval(() => {
    runAgentsTick().catch((e) => console.error("agent runner:", (e as Error).message));
  }, TICK_MS);
  timer.unref?.(); // no mantener vivo un proceso que ya terminó (tests, scripts)
}
