// VOCABULARIO de La Bóveda (formato multi-agente): constantes de reglas, tipos
// de acción/evento y la forma canónica que se FIRMA. Lo comparten el motor, el
// árbitro y los SDKs, así nadie deriva una línea distinta de la misma acción
// (sin drift = las firmas verifican). Sin dependencias, sin reloj, sin azar.

/** Versión de reglas. Cambiar cualquier constante de VAULT_RULES es cambiar de
 *  versión: el árbitro y los clientes la comparan como en RULES_V. */
export const VAULT_RULES_V = 1;

/** Reglas numéricas. NO son variables de entorno: son las reglas del juego. */
export const VAULT_RULES = {
  UNITS_PER_SEAT: 1000, // unidades que aporta cada asiento
  BOX_BPS: 2000, // caja del demonio inicial (20 % del total)
  DECAY_BPS: 500, // el pozo pierde 5 % por etapa (a la caja)
  SHARE_BPS: 500, // Reparto: la parte que se ofrece (5 % del pozo)
  SHARE_BONUS_BPS: 250, // Reparto: premio por cada uno que aporta (de la caja)
  OFFER_MIN_BPS: 1000, // Oferta del demonio: mínimo 10 %
  OFFER_MAX_BPS: 2500, // máximo 25 %
  OFFER_STEP_BPS: 100, // en pasos de 1 %
  OFFER_VOID_BURN_BPS: 1000, // si aceptan todos: se anula y se quema 10 %
  LOCK_BONUS_BPS: 2000, // Cerradura abierta para todos: +20 % (de la caja)
  LOCK_TRAITOR_BPS: 1000, // traidores: se reparten 10 % del pozo
  LOCK_FAIL_BURN_BPS: 1000, // nadie acierta: se quema 10 %
  MAX_MSG_LEN: 280, // caracteres por mensaje
  MAX_MSGS_PER_PHASE: 3, // mensajes por jugador por fase
  MAX_ABSENCES: 2, // ausencias seguidas antes de abandonar
  MIN_SEATS: 4,
  MAX_SEATS: 8,
} as const;

export type StageKind = "share" | "offer" | "vote" | "lock" | "final";
export type Phase = "talk" | "decide";
export type SeatStatus = "alive" | "left" | "voted_out" | "abandoned" | "finished";
export type PhaseEndReason = "deadline" | "all_acted" | "all_ready";

export type VaultAction =
  | { type: "keep" }
  | { type: "contribute" }
  | { type: "accept" }
  | { type: "decline" }
  | { type: "vote"; target: string }
  | { type: "submit"; code: string; intent: "all" | "me" }
  | { type: "split" }
  | { type: "steal" }
  | { type: "ready" }
  | { type: "say"; text: string }
  | { type: "whisper"; to: string; text: string };

export type VaultEvent =
  | {
      type: "action";
      address: string;
      stage: number;
      phase: Phase;
      action: VaultAction;
      ts: number;
      signature?: string;
    }
  | { type: "phase_end"; stage: number; phase: Phase; at: number; reason: PhaseEndReason };

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const CODE_RE = /^[0-9]{1,8}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const SIMPLE = new Set(["keep", "contribute", "accept", "decline", "split", "steal", "ready"]);

/** Forma canónica de una acción: la línea que se firma y se guarda. */
export function actionLine(a: VaultAction): string {
  switch (a.type) {
    case "vote":
      return `vote:${a.target.toLowerCase()}`;
    case "submit":
      return `submit:${a.code}:${a.intent}`;
    case "say":
      return `say:${a.text}`;
    case "whisper":
      return `whisper:${a.to.toLowerCase()}:${a.text}`;
    default:
      return a.type;
  }
}

/** Topes de un mensaje: 1..MAX_MSG_LEN caracteres y sin caracteres de control
 *  (saltos de línea incluidos: la firma cubre el texto EXACTO, no se limpia).
 *  Lo usan la validación de forma del árbitro (`validateAction`) y también el
 *  MOTOR al aplicar la acción, así un registro con un mensaje fuera de tope no
 *  re-simula en ningún verificador. */
export function assertMessageText(v: unknown): void {
  if (typeof v !== "string" || v.length < 1 || v.length > VAULT_RULES.MAX_MSG_LEN) {
    throw new Error(`invalid action: text must be 1..${VAULT_RULES.MAX_MSG_LEN} chars`);
  }
  if (CONTROL_RE.test(v)) throw new Error("invalid action: text has control characters");
}

function text(v: unknown): string {
  assertMessageText(v);
  return v as string;
}

function address(v: unknown): string {
  const a = String(v ?? "").toLowerCase();
  if (!ADDRESS_RE.test(a)) throw new Error("invalid action: bad address");
  return a;
}

/** Valida la FORMA de una acción recibida de afuera (JSON) y la normaliza.
 *  Lo que depende del estado (¿está vivo el destino? ¿largo del código?) lo
 *  chequea el motor al aplicarla. */
export function validateAction(raw: unknown): VaultAction {
  if (!raw || typeof raw !== "object") throw new Error("invalid action: not an object");
  const r = raw as Record<string, unknown>;
  const type = String(r.type ?? "");
  if (SIMPLE.has(type)) return { type } as VaultAction;
  switch (type) {
    case "vote":
      return { type, target: address(r.target) };
    case "submit": {
      const code = String(r.code ?? "");
      if (!CODE_RE.test(code)) throw new Error("invalid action: code must be 1..8 digits");
      if (r.intent !== "all" && r.intent !== "me") {
        throw new Error("invalid action: intent must be all|me");
      }
      return { type, code, intent: r.intent };
    }
    case "say":
      return { type, text: text(r.text) };
    case "whisper":
      return { type, to: address(r.to), text: text(r.text) };
    default:
      throw new Error(`invalid action: unknown type "${type}"`);
  }
}
