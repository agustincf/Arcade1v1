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
  markWebhookNotified,
  recordSettledResult,
  recordWebhookFailure,
  setAgentPending,
  type HostedAgent,
} from "./agents.js";
import { notifyWebhook, webhookAgentsEnabled } from "./webhook-fetch.js";

// Kill switch + perillas de ritmo (por entorno, como el resto de la config).
const ENABLED = process.env.AGENTS_ENABLED !== "false";
const TICK_MS = Number(process.env.AGENT_RUNNER_TICK_MS ?? 30_000);
const PLAY_INTERVAL_MS = Number(process.env.AGENT_PLAY_INTERVAL_MS ?? 10 * 60_000);
const MAX_PLAYS_PER_TICK = Number(process.env.AGENT_MAX_PLAYS_PER_TICK ?? 4);
const AGENT_STAKE = 0; // los agentes hosteados SOLO juegan la ladder gratis
// Cuánto espera el agente desafiado a que el retador juegue antes de soltar el
// desafío (anti denegación de juego). Corto: el retador humano juega en segundos.
const CHALLENGE_ABANDON_MS = Number(process.env.CHALLENGE_ABANDON_MS ?? 5 * 60_000);
// Plazo del dev BYO para responder con su /play tras la notificación; vencido,
// el runner rinde por él (score 0) para que el rival no espere ~2h el reembolso.
const WEBHOOK_PLAY_DEADLINE_MS = Number(process.env.WEBHOOK_PLAY_DEADLINE_MS ?? 10 * 60_000);

/** Replay VACÍO por juego: la "rendición real" (score 0 verificable). Espejo
 *  exacto del submitForfeit de la web (apps/web/.../match/page.tsx). */
export function emptyReplay(game: string, seed: number): unknown {
  if (game === "2048") return { seed, moves: [] };
  if (game === "flappy") return { seed, ticks: 0, flaps: [] };
  return { seed, ticks: 0, inputs: [] };
}

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
    recordSettledResult(agent, m, address);
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

    // AGENTE BYO: el cerebro está afuera. El invariante clave es que una
    // partida ya emparejada SIEMPRE se cierra (juega o se rinde), pase lo que
    // pase con la notificación, la auto-pausa o el kill switch — si no, el
    // rival queda colgado ~2h. Por eso la rendición está al final y la pausa
    // solo ocurre DESPUÉS de cerrar la partida.
    if (agent.webhook) {
      const killed = !webhookAgentsEnabled();
      const notifiedAt = agent.webhook.notifiedAt;

      // Dentro del plazo (y con el webhook habilitado): esperar el /play del dev.
      if (!killed && notifiedAt && Date.now() - notifiedAt < WEBHOOK_PLAY_DEADLINE_MS) {
        return false;
      }
      // Primer contacto: avisar al dev y ARRANCAR EL RELOJ. Se marca ANTES del
      // await: aunque la notificación falle o el tick se solape, no se
      // re-notifica la misma partida ni queda sin deadline. La notificación
      // fallida NO cuenta falla acá (el forfeit de abajo la cuenta, una sola
      // por partida) — así "3 fallas" = 3 partidas sin responder, como dicen
      // las docs, en vez de pausar a la partida y media.
      if (!killed && !notifiedAt) {
        const deadline = Date.now() + WEBHOOK_PLAY_DEADLINE_MS;
        markWebhookNotified(agent);
        try {
          await notifyWebhook(agent.webhook, {
            agentId: agent.id,
            matchId: m.matchId,
            game: m.game,
            seed: m.seed,
            deadline,
          });
        } catch (e) {
          console.log(`webhook notify ${agent.id}:`, (e as Error).message);
        }
        return false; // notificar es barato: no cuenta para el throttle
      }

      // Plazo vencido (o kill switch apagado): RENDICIÓN REAL (replay vacío
      // verificable) para que el rival cobre en minutos. Cerrar la partida es
      // lo importante; la auto-pausa viene después.
      try {
        const account = privateKeyToAccount(agent.privateKey);
        const signature = await account.signMessage({
          message: scoreAuthMessage(m.matchId, address, 0),
        });
        const after = await submitScore(
          m.matchId,
          address,
          0,
          emptyReplay(m.game, m.seed),
          signature,
        );
        // El dev no cumplió ESTA partida → una falla (el forfeit por kill
        // switch no cuenta: no es su culpa). Ocurre tras cerrar la partida.
        if (!killed && recordWebhookFailure(agent)) {
          console.log(`webhook agent ${agent.id} auto-pausado (partidas sin responder)`);
        }
        recordSettledResult(agent, after, address);
        return true; // el forfeit re-simuló un replay: cuenta para el throttle
      } catch (e) {
        // El match pudo expirar/purgarse entre medio: soltar el pending para no
        // reintentar el forfeit en loop tick tras tick.
        console.error(`webhook forfeit ${agent.id}:`, (e as Error).message);
        setAgentPending(agent, undefined);
        return false;
      }
    }

    const { score, replay } = runStrategy(
      { game: agent.game, strategyId: agent.strategyId, params: agent.params },
      m.seed,
    );
    const account = privateKeyToAccount(agent.privateKey);
    const signature = await account.signMessage({
      message: scoreAuthMessage(m.matchId, address, score),
    });
    const after = await submitScore(m.matchId, address, score, replay, signature);
    recordSettledResult(agent, after, address);
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
    if (plays >= MAX_PLAYS_PER_TICK) break;
    try {
      // Una partida EN VUELO se cierra siempre —aunque el agente esté pausado o
      // el kill switch de webhooks esté off— porque su rival ya está emparejado
      // y esperando: dejarla abierta lo cuelga ~2h hasta el reembolso en vez de
      // darle el resultado en minutos.
      if (agent.pendingMatchId) {
        if (await playPendingMatch(agent)) plays++;
        continue;
      }
      // Sin partida en vuelo: un agente pausado o con el kill switch off NO
      // encola partidas nuevas.
      if (!agent.active) continue;
      if (agent.webhook && !webhookAgentsEnabled()) continue;
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
