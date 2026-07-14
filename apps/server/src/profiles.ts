// PERFILES HUMANOS: nombre + avatar por wallet, para que un jugador deje de
// verse como 0x1234…abcd en el ranking, las partidas y el historial. Reusa la
// validación de agentes (sanitizeName + AGENT_AVATARS): nada de reglas nuevas.
// Persistencia con el mismo jsonStore que ratings/agentes (sobrevive redeploys).
//
// resolveDisplay resuelve una address a su nombre/avatar visible: un AGENTE
// hosteado gana (ya tiene identidad propia), luego el perfil humano, si no nada
// (la web cae al address corto). profiles.ts puede importar agents.ts sin ciclo:
// nada del server importa profiles.

import { jsonStore } from "./persist.js";
import { hostedAgentByAddress, sanitizeName, AGENT_AVATARS, isHouseWallet } from "./agents.js";

export interface Profile {
  name: string;
  avatar: string;
  updatedAt: number;
}

// Opt-in (solo se crea al firmar), pero con tope + desalojo del menos reciente:
// un spammer con muchas wallets no puede hacerlo crecer sin fin.
const MAX_PROFILES = Number(process.env.MAX_PROFILES ?? 5000);

const store$ = jsonStore("profiles");
const profiles = new Map<string, Profile>(); // address(lowercase) -> Profile
const normAddr = (a: string) => String(a).toLowerCase();

function save() {
  store$.save(() => JSON.stringify([...profiles.entries()]));
}

/** Desaloja los perfiles menos recientes si se superó el tope (nunca el recién tocado). */
function evictIfNeeded(keep: string) {
  if (profiles.size <= MAX_PROFILES) return;
  const victims = [...profiles.entries()]
    .filter(([a]) => a !== keep)
    .sort((x, y) => x[1].updatedAt - y[1].updatedAt)
    .slice(0, profiles.size - MAX_PROFILES);
  for (const [a] of victims) profiles.delete(a);
}

export function setProfile(input: { address: string; name: unknown; avatar: unknown }): Profile {
  const address = normAddr(input.address);
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error("bad address");
  const profile: Profile = {
    name: sanitizeName(input.name), // tira si viene vacío/solo-control
    avatar: AGENT_AVATARS.includes(String(input.avatar)) ? String(input.avatar) : AGENT_AVATARS[0],
    updatedAt: Date.now(),
  };
  profiles.set(address, profile);
  evictIfNeeded(address);
  save();
  return profile;
}

export function getProfile(address: string): Profile | undefined {
  return profiles.get(normAddr(address));
}

/** Nombre/avatar visible de una address: agente hosteado -> su identidad;
 *  humano con perfil -> el suyo; si no, {} (la web cae al address corto). */
export function resolveDisplay(address: string): {
  name?: string;
  avatar?: string;
  agentId?: string;
  house?: boolean;
} {
  const a = normAddr(address);
  const agent = hostedAgentByAddress(a);
  if (agent) {
    return {
      name: agent.name,
      avatar: agent.avatar,
      agentId: agent.id,
      ...(isHouseWallet(agent.owner) ? { house: true } : {}),
    };
  }
  const p = profiles.get(a);
  if (p) return { name: p.name, avatar: p.avatar };
  return {};
}

/** Restaura los perfiles guardados. La llama index.ts ANTES de escuchar. */
export async function restoreProfiles(): Promise<void> {
  const raw = await store$.load();
  if (!raw) return;
  try {
    const arr = JSON.parse(raw) as [string, Profile][];
    for (const [a, p] of arr) profiles.set(normAddr(a), p);
    if (arr.length) console.log(`Perfiles recuperados: ${arr.length}`);
  } catch (e) {
    console.error("profiles restore (dato corrupto, arrancamos limpio):", (e as Error).message);
  }
}
