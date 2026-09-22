// RUNNER de agentes hosteados: el proceso que los hace jugar SOLOS.
// Cada ~30s revisa los agentes activos; el que pasó su cooldown se encola en
// la ladder gratis (stake 0) y, cuando su partida está lista, corre su
// estrategia y envía el puntaje FIRMADO con su propia wallet. Todo va por las
// funciones in-process de matchmaking (un solo code path, mismas reglas que
// cualquier jugador externo: firma, verificación de replay, ELO).

import { privateKeyToAccount } from "viem/accounts";
import { runStrategy, getStrategy, validateParams } from "@arcade1v1/strategies";
import {
  liveStartAuthMessage,
  matchmakeAuthMessage,
  scoreAuthMessage,
} from "@arcade1v1/game-sdk/auth";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { playFlappyLive } from "@arcade1v1/game-sdk/flappy-live";
import {
  getMatch,
  hasSubmittedScore,
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
import { liveStart, liveCommit, closeLiveAttempt } from "./live.js";

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
 *  exacto del submitForfeit de la web (apps/web/.../match/page.tsx). Declara
 *  `v` en los juegos v2+: sin ella, el guard de versión del árbitro rechazaría
 *  hasta la propia rendición (ausente = v1, y una rendición v1 en una partida
 *  v2 no matchea) — el rival quedaría colgado hasta el reembolso por expiración.
 *  En un juego EN VIVO no hay semilla que declarar: su rendición va sin ella.
 */
export function emptyReplay(game: string, seed: number | undefined): unknown {
  const rulesV = RULES_V[game] ?? 1;
  const v = rulesV !== 1 ? { v: rulesV } : {};
  const s = seed === undefined ? {} : { seed };
  if (game === "2048") return { ...s, moves: [], ...v };
  if (game === "flappy") return { ...s, ticks: 0, flaps: [], ...v };
  return { ...s, ticks: 0, inputs: [], ...v };
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

  // Con rival y sin nuestro puntaje: jugar ahora. El "ya jugué" sale del
  // registro interno: la vista pública no muestra puntajes hasta decidir
  // (anti-espionaje), así que mirándola el agente volvía a jugar en cada tick y
  // el envío rebotaba con "already submitted" (un BYO, además, soltaba la
  // partida y perdía el resultado). En un DESAFÍO, el agente desafiado NO se
  // compromete (ni gasta cómputo) hasta que el retador jugó: así un desafío
  // abandonado no le cuesta nada (se suelta arriba).
  const played = hasSubmittedScore(m.matchId, address);
  if (m.status === "ready" && !played) {
    if (m.challengeTarget && !m.rivalSubmitted) return false;

    // PARTIDA EN VIVO (hoy Flappy desde las reglas v2): la vista no trae semilla
    // y se juega comprometiendo jugadas. Un juego que NO es en vivo sin semilla
    // no existe, pero si pasara no hay nada que jugar.
    const live = m.live === true;
    const seed = m.seed;
    if (!live && seed === undefined) return false;

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
            // En vivo no hay semilla: el dev abre su intento y el azar le llega
            // de a poco. Con `secretHash` comprueba el secreto cuando se publique.
            ...(live ? { live: true, secretHash: m.secretHash } : { seed }),
            deadline,
          });
        } catch (e) {
          console.log(`webhook notify ${agent.id}:`, (e as Error).message);
        }
        return false; // notificar es barato: no cuenta para el throttle
      }

      // Plazo vencido (o kill switch apagado): RENDICIÓN REAL (replay vacío
      // verificable) para que el rival cobre en minutos. Cerrar la partida es
      // lo importante; la auto-pausa viene después. EN VIVO el plazo corre
      // hasta terminar el intento: si el dev lo dejó a medio jugar, se cierra
      // contando lo alcanzado; solo si nunca lo abrió se rinde con 0.
      try {
        let after: ReturnType<typeof getMatch>;
        if (live && (await closeLiveAttempt(m.matchId, address))) {
          after = getMatch(m.matchId, address);
        } else {
          const account = privateKeyToAccount(agent.privateKey);
          const signature = await account.signMessage({
            message: scoreAuthMessage(m.matchId, address, 0),
          });
          after = await submitScore(m.matchId, address, 0, emptyReplay(m.game, seed), signature);
        }
        // El dev no cumplió ESTA partida → una falla (el forfeit por kill
        // switch no cuenta: no es su culpa). Ocurre tras cerrar la partida.
        if (!killed && recordWebhookFailure(agent)) {
          console.log(`webhook agent ${agent.id} auto-pausado (partidas sin responder)`);
        }
        if (after) recordSettledResult(agent, after, address);
        return true; // el forfeit re-simuló un replay: cuenta para el throttle
      } catch (e) {
        // El match pudo expirar/purgarse entre medio: soltar el pending para no
        // reintentar el forfeit en loop tick tras tick.
        console.error(`webhook forfeit ${agent.id}:`, (e as Error).message);
        setAgentPending(agent, undefined);
        return false;
      }
    }

    // AGENTE DE LA CASA EN VIVO: juega por el mismo protocolo que cualquiera,
    // en proceso (sin HTTP) y sin ver el secreto, que ni está en su vista.
    // Firma la apertura con su clave, como firma el puntaje.
    if (live) {
      const def = getStrategy(agent.strategyId);
      const step =
        def && def.game === m.game ? def.step?.(validateParams(def, agent.params)) : undefined;
      const account = privateKeyToAccount(agent.privateKey);
      if (!step || m.game !== "flappy") {
        // No sabe jugar este juego en vivo: rendirse para no colgar al rival.
        const signature = await account.signMessage({
          message: scoreAuthMessage(m.matchId, address, 0),
        });
        const after = await submitScore(
          m.matchId,
          address,
          0,
          emptyReplay(m.game, seed),
          signature,
        );
        recordSettledResult(agent, after, address);
        return true;
      }
      const ts = Date.now();
      const signature = await account.signMessage({
        message: liveStartAuthMessage(m.matchId, address, ts),
      });
      const start = await liveStart(m.matchId, address, { signature, ts });
      if (!start.over) {
        const token = start.token;
        await playFlappyLive({
          start,
          decide: step.decide,
          commit: (c) => liveCommit(m.matchId, address, { ...c, token }),
          maxTicks: step.maxTicks,
        });
      }
      const after = getMatch(m.matchId, address);
      if (after) recordSettledResult(agent, after, address);
      return true;
    }

    if (seed === undefined) return false;
    const { score, replay } = runStrategy(
      { game: agent.game, strategyId: agent.strategyId, params: agent.params },
      seed,
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

let runner: NodeJS.Timeout | undefined;
const ticksInFlight = new Set<Promise<void>>();

/** Arranca el runner. Lo llama index.ts DESPUÉS de cargar el estado; antes
 *  arrancaba al importar el módulo y podía correr sobre un estado vacío. */
export function startAgentRunner(): void {
  if (runner || !ENABLED) return;
  runner = setInterval(() => {
    const tick = runAgentsTick().catch((e) => console.error("agent runner:", (e as Error).message));
    ticksInFlight.add(tick);
    void tick.finally(() => ticksInFlight.delete(tick));
  }, TICK_MS);
  runner.unref?.(); // no mantener vivo un proceso que ya terminó (tests, scripts)
}

/** Frena el runner y espera las vueltas en curso (entrega de la posta). */
export async function stopAgentRunner(): Promise<void> {
  if (runner) clearInterval(runner);
  runner = undefined;
  await Promise.all([...ticksInFlight]);
}
