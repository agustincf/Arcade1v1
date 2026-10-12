// Ejemplo: un agente con "cerebro LLM" juega Racing en Arcade1v1.
//
// Claude elige los movimientos en cada punto de decisión (cuando un obstáculo
// entra en la zona de peligro del carril actual). Desde las reglas v3 la Carrera
// se juega EN VIVO: no hay semilla, y cada fila de obstáculos llega recién un
// cuarto de segundo antes de aparecer, así que Claude decide sin ver el futuro,
// como cualquier jugador. El árbitro simula a la par con las jugadas
// comprometidas y nunca vuelve a llamar al LLM: el cerebro solo decide QUÉ se
// juega, y lo jugado se re-verifica con el secreto que se publica al decidir.
// Con un árbitro de reglas v2 (con semilla), el ejemplo juega como antes: arma
// el replay y lo envía firmado.
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
// claude-opus-5-5 con esfuerzo bajo; para correrla más barata/rápida (suficiente
// para elegir carril) seteá ARCADE_LLM_MODEL=claude-haiku-5-5.

import Anthropic from "@anthropic-ai/sdk";
import { pathToFileURL } from "node:url";
import {
  RacingEngine,
  RACING_DT,
  RACING_CONST,
  RACING_RULES_V,
  LANES,
  type ReplayRacing,
  type RaceAction,
} from "@arcade1v1/game-sdk/racing";
import { isLiveMatch } from "@arcade1v1/game-sdk/live";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import {
  ArbiterClient,
  createAgent,
  randomWallet,
  signMatchmake,
  signScore,
  type LiveStrategy,
} from "../src/index.js";

// --- Parámetros del loop (constantes nombradas) ---
const MAX_TICKS = 36_000; // cap de seguridad (igual que las estrategias headless)
const CAR_Y = RACING_CONST.HEIGHT - 80; // el motor mantiene CAR_Y privado; misma fórmula
const DECISION_DISTANCE = 200; // px por delante para considerar un obstáculo "peligro"
const DECISION_COOLDOWN = 8; // ticks mínimos entre consultas al cerebro (anti-spam)

/** Movimiento discreto: izquierda / derecha / saltar / seguir. */
export type Action = "L" | "R" | "J" | "S";

/** El "cerebro": recibe el estado en texto y devuelve la acción. Se inyecta,
 *  así el ejemplo real usa Claude y el test un doble determinista. */
export type Brain = (state: string) => Promise<Action>;

/** Obstáculo más cercano por delante en `lane` (distancia + si es saltable),
 *  o null si el carril está despejado por delante del auto. */
function nearestAhead(g: RacingEngine, lane: number): { dist: number; jumpable: boolean } | null {
  let best: { dist: number; jumpable: boolean } | null = null;
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
    if (best === null || dist < best.dist) best = { dist, jumpable: o.jumpable };
  }
  return best;
}

/** Moneda sin tomar más cercana por delante en `lane` (px), o null. Las
 *  monedas no chocan, así que alcanza con la más próxima aún por delante. */
function nearestCoin(g: RacingEngine, lane: number): number | null {
  let best: number | null = null;
  for (const c of g.coins) {
    if (c.taken || c.lane !== lane) continue;
    const d = CAR_Y - c.y;
    if (d <= 0) continue; // ya a la altura (se recoge sola) o pasada
    if (best === null || d < best) best = d;
  }
  return best;
}

/** ¿Es este tick un punto de decisión? Hay un obstáculo dentro de la distancia
 *  de peligro en el carril actual, así que conviene decidir si esquivar. */
export function isDecisionPoint(g: RacingEngine): boolean {
  const b = nearestAhead(g, g.carLane);
  return b !== null && b.dist < DECISION_DISTANCE;
}

/** Serializa el estado observable a texto compacto para el LLM: por carril,
 *  si lo que viene es una valla saltable o un sólido; si se puede saltar
 *  ahora (no en el aire); y las monedas sueltas a la vista por carril. */
export function describeState(g: RacingEngine): string {
  const lanes: string[] = [];
  for (let l = 0; l < LANES; l++) {
    const b = nearestAhead(g, l);
    if (b === null) lanes.push(`carril ${l}: despejado`);
    else if (b.jumpable) lanes.push(`carril ${l}: valla saltable a ${Math.round(b.dist)}px`);
    else lanes.push(`carril ${l}: obstáculo a ${Math.round(b.dist)}px`);
  }
  // En el aire el motor ignora moveLeft/moveRight/jump por igual (lane-lock):
  // ofrecer L/R ahí sería engañoso, así que las 3 comparten la misma guarda.
  const canJump = !g.airborne;
  const canLeft = canJump && g.carLane > 0;
  const canRight = canJump && g.carLane < LANES - 1;
  const coinParts: string[] = [];
  for (let l = 0; l < LANES; l++) {
    const cd = nearestCoin(g, l);
    if (cd !== null) coinParts.push(`carril ${l} a ${Math.round(cd)}px`);
  }
  return [
    `Vas en el carril ${g.carLane} de ${LANES} (0=izquierda, ${LANES - 1}=derecha).`,
    `${lanes.join("; ")}.`,
    `Podés: ${canLeft ? "L " : ""}${canRight ? "R " : ""}${canJump ? "J " : ""}S.`,
    canJump ? "" : "Estás en el aire: no podés saltar ni cambiar de carril.",
    coinParts.length > 0 ? `Monedas: ${coinParts.join(", ")}.` : "",
  ]
    .filter((s) => s.length > 0)
    .join(" ");
}

/** Parsea la respuesta del LLM a una acción; default seguro = S (seguir).
 *  Espera una sola letra (lo que pide el system prompt); toma el primer
 *  carácter no-espacio y cae a S ante cualquier cosa que no sea L/R/J/S. */
export function parseAction(raw: string): Action {
  const c = raw.trim().toUpperCase().charAt(0);
  return c === "L" || c === "R" || c === "J" || c === "S" ? c : "S";
}

/** El cerebro como estrategia EN VIVO: en cada tick mira el motor (lo que hay
 *  en pantalla) y, solo en un punto de decisión, le pregunta a `brain`. Devuelve
 *  la acción del tick sin tocar el motor; el driver en vivo la aplica y la
 *  compromete. Guarda su cooldown entre ticks: se crea una por partida. */
export function brainLiveStrategy(brain: Brain, opts: { maxTicks?: number } = {}): LiveStrategy {
  let cooldown = 0;
  return {
    maxTicks: opts.maxTicks ?? MAX_TICKS,
    async decide(g: RacingEngine): Promise<RaceAction | null> {
      if (cooldown > 0) cooldown--;
      if (cooldown !== 0 || !isDecisionPoint(g)) return null;
      const action = parseAction(await brain(describeState(g)));
      let a: RaceAction | null = null;
      if (action === "L" && g.carLane > 0) a = "l";
      else if (action === "R" && g.carLane < LANES - 1) a = "r";
      else if (action === "J" && !g.airborne) a = "j";
      // S (o un movimiento inválido contra el borde/en el aire): nada este tick.
      if (a) cooldown = DECISION_COOLDOWN;
      return a;
    },
  };
}

/** Corre una partida de Racing CON SEMILLA (reglas v2) dejando que `brain`
 *  decida en los puntos de decisión, con la misma estrategia que en vivo.
 *  Devuelve el puntaje real + el replay verificable. */
export async function playRacingWithBrain(
  seed: number,
  brain: Brain,
  opts: { maxTicks?: number } = {},
): Promise<{ score: number; replay: ReplayRacing }> {
  const strategy = brainLiveStrategy(brain, opts);
  const g = new RacingEngine(seed);
  const inputs: { t: number; a: RaceAction }[] = [];
  for (let t = 0; t < strategy.maxTicks && !g.over; t++) {
    const a = (await strategy.decide(g, t)) as RaceAction | null;
    if (a === "l") g.moveLeft();
    else if (a === "r") g.moveRight();
    else if (a === "j") g.jump();
    if (a) inputs.push({ t, a });
    g.update(RACING_DT);
  }
  return {
    score: g.score,
    replay: { seed, ticks: strategy.maxTicks, inputs, v: RACING_RULES_V },
  };
}

// --- El cerebro real: Claude elige el movimiento ---

// La guía oficial de la API de Claude manda usar el modelo más capaz por
// defecto; bajar de modelo es decisión de quien corre el ejemplo (ver cabecera).
const MODEL = process.env.ARCADE_LLM_MODEL ?? "claude-opus-5-5";

/** Modelos que aceptan el respaldo del servidor ante un rechazo (la forma con
 *  lista de modelos). Con otro modelo (Haiku, por ejemplo) no se pide. */
const SERVER_FALLBACK = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);

const SYSTEM = [
  "Sos un agente jugando a un juego de carreras: esquivás obstáculos moviéndote entre carriles.",
  "Te doy el estado y respondés con UNA sola letra, sin explicación ni puntuación:",
  "L = moverte un carril a la izquierda, R = un carril a la derecha,",
  "J = saltar (solo sirve contra una VALLA saltable, no contra un obstáculo sólido),",
  "S = seguir en tu carril.",
  "Elegí el movimiento que evita chocar; si no hay carril libre pero lo que viene es saltable, J.",
  "Si tu carril está despejado, S.",
].join(" ");

/** El cerebro con Claude. En Opus 5.5 el razonamiento no se puede apagar: se
 *  baja el esfuerzo (la decisión es simple y hacemos decenas por partida, así
 *  que priorizamos latencia y costo), y max_tokens deja lugar para pensar antes
 *  de la letra. Ante un rechazo del modelo, el servidor reintenta con otro
 *  (`fallbacks`); si igual se rechaza, o la respuesta no trae texto, se sigue
 *  (S): es el default seguro. */
export function claudeBrain(client: Pick<Anthropic, "beta">, model: string = MODEL): Brain {
  const fallback = SERVER_FALLBACK.has(model)
    ? {
        betas: ["server-side-fallback-2026-06-01"],
        fallbacks: [{ model: "claude-opus-4-8" }],
      }
    : {};
  return async (state) => {
    const res = await client.beta.messages.create({
      model,
      max_tokens: 2048,
      output_config: { effort: "low" },
      ...fallback,
      system: SYSTEM,
      messages: [{ role: "user", content: state }],
    });
    if (res.stop_reason === "refusal") return "S";
    const block = res.content.find((b) => b.type === "text");
    return parseAction(block && block.type === "text" ? block.text : "S");
  };
}

async function main(): Promise<void> {
  const arbiterUrl = process.env.ARBITER_URL ?? "http://localhost:4000";
  const game = "racing";
  const stake = 0; // ladder gratis / rankeada (sin depósito on-chain, Fase 1)

  const anthropic = new Anthropic(); // lee ANTHROPIC_API_KEY del entorno

  // EN VIVO (reglas v3): el SDK empareja, abre el intento firmado, juega tick a
  // tick con el cerebro y compromete las jugadas; el árbitro confirma el puntaje.
  if (isLiveMatch(game, RULES_V[game])) {
    const agent = createAgent({ arbiterUrl });
    console.log("Agente:", agent.address, "· modelo:", MODEL);
    console.log("Jugando en vivo… (Claude decide en cada punto de decisión, sin ver el futuro)");
    const res = await agent.playAndSubmit({
      game,
      stake,
      liveStrategy: brainLiveStrategy(claudeBrain(anthropic)),
    });
    const me = agent.address.toLowerCase();
    console.log("Terminó · puntaje:", res.scores[me], "· estado:", res.status);
    if (res.status === "settled") {
      const won = res.winner?.toLowerCase() === me;
      console.log(
        won ? "GANASTE" : "perdiste",
        "· vos:",
        res.yourScore,
        "· rival:",
        res.rivalScore,
      );
    } else {
      console.log("Esperando rival. Volvé a consultar el match", res.matchId, "más tarde.");
    }
    return;
  }

  // CON SEMILLA (un árbitro de reglas v2): se juega de corrido y se envía el
  // replay firmado.
  const client = new ArbiterClient(arbiterUrl);
  const wallet = randomWallet();
  console.log("Agente:", wallet.address, "· modelo:", MODEL);

  // 1) Emparejar (firmado: el árbitro lo exige en producción).
  const auth = await signMatchmake({
    game,
    stake,
    address: wallet.address,
    privateKey: wallet.privateKey,
  });
  const m = await client.matchmake(game, stake, wallet.address, auth);
  if (m.seed === undefined) {
    throw new Error("the arbiter plays racing live: update @arcade1v1 packages to play it");
  }
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
