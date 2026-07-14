// Ejemplo: un agente con "cerebro LLM" juega Racing en Arcade1v1.
//
// Claude elige los movimientos EN VIVO en cada punto de decisión (cuando un
// obstáculo entra en la zona de peligro del carril actual). El replay que sale
// pasa la verificación anti-trampa del árbitro POR CONSTRUCCIÓN: el árbitro
// re-simula la semilla + los inputs, nunca vuelve a llamar al LLM. El cerebro
// solo decide QUÉ inputs se eligen; una vez elegidos, el replay es
// determinístico y verificable como el de cualquier jugador.
//
// Es el molde de "traé tu propio cerebro" para los 5 juegos que no traen
// ejemplo: reemplazá la heurística por razonamiento real, sin perder la
// verificación. Racing es el mejor candidato porque las decisiones son pocas y
// discretas (elegir carril), no timing continuo cuadro a cuadro.
//
// Correr (usa TU propia API key):
//   ANTHROPIC_API_KEY=... ARBITER_URL=... npm run example:racing-llm -w @arcade1v1/agent-sdk
//
// HONESTO: una partida hace decenas de llamadas SECUENCIALES a Claude, así que
// tarda del orden de minutos y consume tokens de quien la corre. Es una demo del
// patrón, no una policy optimizada para escalar el ranking. Modelo por defecto:
// claude-opus-4-8 (el más capaz); para correrla más barata/rápida (suficiente
// para elegir carril) seteá ARCADE_LLM_MODEL=claude-haiku-4-5.

import Anthropic from "@anthropic-ai/sdk";
import { pathToFileURL } from "node:url";
import {
  RacingEngine,
  RACING_DT,
  RACING_CONST,
  LANES,
  type ReplayRacing,
} from "@arcade1v1/game-sdk/racing";
import { ArbiterClient, randomWallet, signMatchmake, signScore } from "../src/index.js";

// --- Parámetros del loop (constantes nombradas) ---
const MAX_TICKS = 36_000; // cap de seguridad (igual que las estrategias headless)
const CAR_Y = RACING_CONST.HEIGHT - 80; // el motor mantiene CAR_Y privado; misma fórmula
const DECISION_DISTANCE = 200; // px por delante para considerar un obstáculo "peligro"
const DECISION_COOLDOWN = 8; // ticks mínimos entre consultas al cerebro (anti-spam)

/** Movimiento discreto: izquierda / derecha / seguir. */
export type Action = "L" | "R" | "S";

/** El "cerebro": recibe el estado en texto y devuelve la acción. Se inyecta,
 *  así el ejemplo real usa Claude y el test un doble determinista. */
export type Brain = (state: string) => Promise<Action>;

/** Distancia (px) al obstáculo más cercano por delante en `lane`, o null si el
 *  carril está despejado por delante del auto. */
function nearestAhead(g: RacingEngine, lane: number): number | null {
  let best: number | null = null;
  for (const o of g.obstacles) {
    if (o.lane !== lane) continue;
    const d = CAR_Y - o.y; // > 0 por delante; <= 0 a la altura o ya pasando el auto
    // El motor choca en una ventana SIMÉTRICA (|o.y - CAR_Y| < ~47), así que un
    // obstáculo a la altura o recién pasando TODAVÍA es peligro: reportarlo como
    // "despejado" haría que el cerebro se meta ahí y choque. Solo lo ignoramos
    // cuando ya salió de la zona de choque (mismo criterio que la heurística
    // racing.dodger: peligro hasta CAR_Y + CAR_H).
    if (d <= -RACING_CONST.CAR_H) continue;
    const dist = Math.max(0, d); // 0 = a la altura del auto (peligro inmediato)
    if (best === null || dist < best) best = dist;
  }
  return best;
}

/** ¿Es este tick un punto de decisión? Hay un obstáculo dentro de la distancia
 *  de peligro en el carril actual, así que conviene decidir si esquivar. */
export function isDecisionPoint(g: RacingEngine): boolean {
  const d = nearestAhead(g, g.carLane);
  return d !== null && d < DECISION_DISTANCE;
}

/** Serializa el estado observable a texto compacto para el LLM. */
export function describeState(g: RacingEngine): string {
  const lanes: string[] = [];
  for (let l = 0; l < LANES; l++) {
    const d = nearestAhead(g, l);
    lanes.push(`carril ${l}: ${d !== null ? `obstáculo a ${Math.round(d)}px` : "despejado"}`);
  }
  const canLeft = g.carLane > 0;
  const canRight = g.carLane < LANES - 1;
  return [
    `Vas en el carril ${g.carLane} de ${LANES} (0=izquierda, ${LANES - 1}=derecha).`,
    `${lanes.join("; ")}.`,
    `Podés: ${canLeft ? "L " : ""}${canRight ? "R " : ""}S.`,
  ].join(" ");
}

/** Parsea la respuesta del LLM a una acción; default seguro = S (seguir).
 *  Espera una sola letra (lo que pide el system prompt); toma el primer
 *  carácter no-espacio y cae a S ante cualquier cosa que no sea L/R/S. */
export function parseAction(raw: string): Action {
  const c = raw.trim().toUpperCase().charAt(0);
  return c === "L" || c === "R" || c === "S" ? c : "S";
}

/** Corre una partida de Racing dejando que `brain` decida en los puntos de
 *  decisión. Devuelve el puntaje real + el replay verificable. */
export async function playRacingWithBrain(
  seed: number,
  brain: Brain,
  opts: { maxTicks?: number } = {},
): Promise<{ score: number; replay: ReplayRacing }> {
  const maxTicks = opts.maxTicks ?? MAX_TICKS;
  const g = new RacingEngine(seed);
  const inputs: { t: number; a: "l" | "r" }[] = [];
  let cooldown = 0;

  for (let t = 0; t < maxTicks && !g.over; t++) {
    if (cooldown > 0) cooldown--;
    if (cooldown === 0 && isDecisionPoint(g)) {
      const action = parseAction(await brain(describeState(g)));
      if (action === "L" && g.carLane > 0) {
        g.moveLeft();
        inputs.push({ t, a: "l" });
        cooldown = DECISION_COOLDOWN;
      } else if (action === "R" && g.carLane < LANES - 1) {
        g.moveRight();
        inputs.push({ t, a: "r" });
        cooldown = DECISION_COOLDOWN;
      }
      // S (o un movimiento inválido contra el borde): no hace nada este tick.
    }
    g.update(RACING_DT);
  }

  return { score: g.score, replay: { seed, ticks: maxTicks, inputs } };
}

// --- El cerebro real: Claude elige el movimiento ---

// La guía oficial de la API de Claude manda usar el modelo más capaz por
// defecto; bajar de modelo es decisión de quien corre el ejemplo (ver cabecera).
const MODEL = process.env.ARCADE_LLM_MODEL ?? "claude-opus-4-8";

const SYSTEM = [
  "Sos un agente jugando a un juego de carreras: esquivás obstáculos moviéndote entre carriles.",
  "Te doy el estado y respondés con UNA sola letra, sin explicación ni puntuación:",
  "L = moverte un carril a la izquierda, R = un carril a la derecha, S = seguir en tu carril.",
  "Elegí el movimiento que evita chocar; si tu carril está despejado, S.",
].join(" ");

function claudeBrain(client: Anthropic): Brain {
  return async (state) => {
    // Sin extended thinking (en Opus 4.8 omitir `thinking` corre sin pensar):
    // la decisión es simple y hacemos decenas por partida, así que priorizamos
    // latencia y costo. max_tokens chico porque solo esperamos una letra.
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8,
      system: SYSTEM,
      messages: [{ role: "user", content: state }],
    });
    const block = res.content.find((b) => b.type === "text");
    return parseAction(block && block.type === "text" ? block.text : "S");
  };
}

async function main(): Promise<void> {
  const arbiterUrl = process.env.ARBITER_URL ?? "http://localhost:4000";
  const game = "racing";
  const stake = 0; // ladder gratis / rankeada (sin depósito on-chain, Fase 1)

  const client = new ArbiterClient(arbiterUrl);
  const wallet = randomWallet();
  const anthropic = new Anthropic(); // lee ANTHROPIC_API_KEY del entorno

  console.log("Agente:", wallet.address, "· modelo:", MODEL);

  // 1) Emparejar (firmado: el árbitro lo exige en producción).
  const auth = await signMatchmake({
    game,
    stake,
    address: wallet.address,
    privateKey: wallet.privateKey,
  });
  const m = await client.matchmake(game, stake, wallet.address, auth);
  console.log("Match:", m.matchId, "· seed:", m.seed);

  // 2) Jugar con Claude como cerebro. Puede tardar minutos: decenas de llamadas
  //    secuenciales al modelo, una por punto de decisión.
  console.log("Jugando… (Claude decide en cada punto de decisión)");
  const { score, replay } = await playRacingWithBrain(m.seed, claudeBrain(anthropic));
  console.log("Terminó · puntaje:", score, "· movimientos:", replay.inputs.length);

  // 3) Firmar y enviar el puntaje. El árbitro re-simula el replay (seed + inputs)
  //    y rechaza cualquier puntaje que no coincida.
  const signature = await signScore({
    matchId: m.matchId,
    address: wallet.address,
    score,
    privateKey: wallet.privateKey,
  });
  const res = await client.submitScore(m.matchId, wallet.address, score, replay, signature);

  console.log("Enviado · estado:", res.status);
  if (res.status === "settled") {
    const won = res.winner?.toLowerCase() === wallet.address.toLowerCase();
    console.log(won ? "GANASTE" : "perdiste", "· vos:", res.yourScore, "· rival:", res.rivalScore);
  } else {
    console.log("Esperando rival. Volvé a consultar el match", res.matchId, "más tarde.");
  }
}

// Solo corre main() cuando el archivo se ejecuta como script; el test importa las
// funciones puras sin disparar la partida real ni instanciar el cliente Anthropic.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    const msg = (e as Error).message ?? String(e);
    console.error("Error:", msg);
    // El SDK resuelve credenciales de varias formas; cuando no encuentra ninguna,
    // el error llega como "Could not resolve authentication method" (sin status
    // 401 ni el nombre de la env var). Detectamos ambos para dar el hint útil.
    const status = (e as { status?: number })?.status;
    if (/authentication|ANTHROPIC_API_KEY/i.test(msg) || status === 401) {
      console.error(
        "Parece un problema de credenciales: el ejemplo corre con TU key de Anthropic (seteá ANTHROPIC_API_KEY).",
      );
    }
    process.exit(1);
  });
}
