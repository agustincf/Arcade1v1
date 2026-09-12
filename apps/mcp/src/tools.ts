// Lógica de cada herramienta MCP como funciones puras (reciben un ArbiterClient
// inyectable). server.ts solo las envuelve en herramientas MCP. Sin on-chain.
import {
  ArbiterClient,
  createAgent,
  describeAlephRules,
  legalActions,
  validateAction,
  ALEPH_RULES_V,
  type MatchView,
  type Phase,
  type AlephLobby,
  type AlephRoomView,
  type AlephDepositResult,
} from "@arcade1v1/agent-sdk";

type Agent = ReturnType<typeof createAgent>;

function assertGame(game: string): void {
  if (!GAMES.includes(game as (typeof GAMES)[number])) {
    throw new Error(`unknown game: ${game}. Conocidos: ${GAMES.join(", ")}`);
  }
}

export const GAMES = ["2048", "tetris", "flappy", "racing", "snake", "invaders"] as const;

/** Formatos que no son cartuchos 1v1 (no entran en `GAMES`: las herramientas
 *  1v1 siguen validando contra los seis juegos). */
export const FORMATS = ["aleph"] as const;

export function listGames(): { games: readonly string[]; formats: readonly string[] } {
  return { games: GAMES, formats: FORMATS };
}

export async function leaderboardTool(
  client: ArbiterClient,
  game: string,
  limit = 20,
): Promise<{ game: string; top: { address: string; rating: number }[] }> {
  const top = await client.leaderboard(game, limit);
  return { game, top };
}

export async function ratingTool(
  client: ArbiterClient,
  address: string,
): Promise<{ address: string; ratings: Record<string, number> }> {
  const ratings = await client.rating(address);
  return { address, ratings };
}

export async function matchmakeTool(agent: Agent, game: string, stake: number): Promise<MatchView> {
  assertGame(game);
  // Firmado con la wallet del agente (el árbitro en producción lo exige).
  return agent.matchmake(game, stake);
}

export async function playAndSubmitTool(
  agent: Agent,
  game: string,
  stake: number,
): Promise<MatchView> {
  assertGame(game);
  return agent.playAndSubmit({ game, stake });
}

export async function getResultTool(
  client: ArbiterClient,
  matchId: string,
  address?: string,
): Promise<MatchView> {
  return client.getMatch(matchId, address);
}

// ---- Aleph (formato multi-agente) ------------------------------------------

/** Lo que devuelve cada herramienta de Aleph que trae vista: la vista del
 *  motor más tres cosas que el modelo no puede reconstruir por su cuenta. */
export type AlephAgentView = AlephRoomView & {
  /** Acciones legales AHORA: el modelo no tiene que deducirlas de
   *  `stage.phase`, `you.decided` y `you.ready`. */
  legal: string[];
  /** La wallet de ESTE asiento. `you` (viewFor, game-sdk/aleph.ts) nunca trae
   *  `address` — es efímera del proceso y no se publica — así que sin esto el
   *  modelo no puede distinguir su propio asiento de los otros 3-7 en
   *  `seats[]` ni sus propios `say` en `messages`: vota o susurra a ciegas,
   *  a veces a sí mismo (el árbitro lo rechaza, o peor, cuenta como ausencia).
   *  En minúsculas: `seats[].address` y `stage.acted` ya lo están (normAddr,
   *  apps/server/src/aleph.ts) y así lo compara el propio ejemplo de
   *  referencia (`const me = agent.address.toLowerCase()`,
   *  packages/agent-sdk/examples/play-aleph-llm.ts) — mandarlo con la
   *  capitalización checksummed de la wallet rompería una comparación
   *  ingenua `target !== me` del modelo. */
  me: string;
  /** Reloj del servidor MCP en el momento de esta respuesta (epoch ms): con
   *  qué comparar `deadline`. El host MCP a lo sumo le inyecta al modelo la
   *  fecha del día, nunca la hora en milisegundos. */
  now: number;
  /** Milisegundos que quedan de la fase actual (`deadline - now`, nunca
   *  negativo), o `undefined` si la sala no tiene fase con plazo (lobby,
   *  settled). Actuar después de que llega a 0 es una fase que ya cerró. */
  msLeft?: number;
  /** Mesa de plata en `funding` y este asiento todavía no depositó: la
   *  próxima llamada es `aleph_deposit`, no `aleph_act`. */
  mustDeposit: boolean;
};

function withLegal(agent: Agent, v: AlephRoomView): AlephAgentView {
  const now = Date.now();
  return {
    ...v,
    legal: legalActions(v),
    me: agent.address.toLowerCase(),
    now,
    msLeft: v.deadline === undefined ? undefined : Math.max(0, v.deadline - now),
    mustDeposit:
      v.status === "funding" &&
      !!v.deposit &&
      !(v.deposited ?? []).some((a) => a.toLowerCase() === agent.address.toLowerCase()),
  };
}

export function alephRulesTool(): { rulesV: number; rules: string } {
  return { rulesV: ALEPH_RULES_V, rules: describeAlephRules() };
}

export async function alephLobbiesTool(
  client: ArbiterClient,
): Promise<{ lobbies: AlephLobby[]; stakes: number[] }> {
  // alephLobbiesInfo (no alephLobbies): sin `stakes` el modelo solo se entera
  // de que existe una mesa de plata si YA hay una sala abierta para ese stake
  // en este instante — la descripción de aleph_join apunta acá para el resto
  // de los casos (fix de review, ver informe de la tarea).
  return client.alephLobbiesInfo();
}

export async function alephJoinTool(agent: Agent, stake = 0): Promise<AlephAgentView> {
  return withLegal(agent, await agent.alephJoin(stake));
}

export async function alephViewTool(agent: Agent, roomId: string): Promise<AlephAgentView> {
  return withLegal(agent, await agent.alephView(roomId));
}

export async function alephActTool(
  agent: Agent,
  roomId: string,
  action: unknown,
  at: { stage: number; phase: Phase },
): Promise<AlephAgentView> {
  // Validar la forma ACÁ da un error claro al modelo sin gastar una firma ni un
  // POST del presupuesto (12 cada 10 s). Lo que depende del estado (¿está vivo
  // el destino?, ¿largo del código?) lo dice el árbitro con su 400.
  //
  // `at` es OBLIGATORIO y lo copia el modelo de la vista sobre la que decidió
  // (`stage.index` y `stage.phase`). Sin él, el SDK re-lee la vista y firma
  // para la fase abierta EN EL MOMENTO DEL POST: entre que el modelo lee
  // aleph_view y llama aleph_act pasan decenas de segundos, y una fase dura ~2
  // minutos, así que la fase puede haber cerrado en el medio. El asiento
  // firmaría entonces, con su wallet y para el registro público, una acción
  // para una fase que nunca vio — y en la Cerradura ese `ready` de "terminé de
  // hablar" (talk) se convierte en un PASE (lock/decide) que quema el intento
  // de la etapa en silencio. Con `at` explícito, el árbitro contesta "stage or
  // phase mismatch" y el modelo puede volver a mirar y decidir, que es lo que
  // promete la descripción de la herramienta.
  return withLegal(agent, await agent.alephAct(roomId, validateAction(action), at));
}

// Nunca dejar que una URL entera sobreviva al resultado de esta herramienta:
// el RPC del operador (RPC_URL) puede traer una API key en el path, como
// suelen armarse las URLs de Alchemy o Infura, y el transporte de viem
// interpola la URL completa en el mensaje cuando el pedido falla (caído,
// limitado, mal configurado) — el PRIMER pedido de red de `alephDeposit` es
// justamente contra ese RPC. Los errores que agent-sdk arma a mano (ver
// agent.ts: stake que no coincide, chainId desconocido, sala fuera de
// `funding`, etc.) nunca mencionan `rpcUrl`, así que enmascarar CUALQUIER URL
// es indistinguible de no tocar nada para esos casos — no hace falta (ni
// conviene) mantener una lista de mensajes "conocidos" que se desactualice
// cada vez que `alephDeposit` sume un guard nuevo: se enmascara la FORMA
// (una URL), no el contenido de un mensaje puntual.
//
// El esquema NO se enumera (nunca `https?` a secas): `createAgent` arma sus
// dos clientes con `http(opts.rpcUrl)` sin mirar el esquema, así que un
// RPC_URL `wss://` (Alchemy e Infura emiten esos endpoints junto a los
// https://, así que es una config real, no rebuscada) hace que TODO pedido
// falle —fetch nativo no abre `wss:`— y viem lo envuelve con la URL entera
// en el mensaje igual. Enumerar "http, https" se queda corto ahí y con
// cualquier esquema futuro que a nadie se le ocurra hoy; en cambio, la FORMA
// genérica de un esquema de URI (RFC 3986: letra, luego letras/dígitos/+/-/.,
// luego "://") cubre todos por igual sin lista que mantener.
function withoutUrls(message: string): string {
  return message.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[rpc url redacted]");
}

export async function alephDepositTool(
  agent: Agent,
  roomId: string,
): Promise<AlephAgentView & { step: "open" | "deposit" | "already"; txHash?: string }> {
  let r: AlephDepositResult;
  try {
    r = await agent.alephDeposit(roomId);
  } catch (e) {
    // Se re-lanza un Error NUEVO, deliberadamente SIN `cause`: adjuntar el
    // objeto original reabriría el mismo hueco que esto sanea, porque
    // `.message` (y cualquier otra propiedad de un error de viem, como
    // `.shortMessage` o `.details`) seguiría alcanzable desde `err.cause` con
    // la URL sin enmascarar. El motivo del fallo igual llega al modelo: solo
    // se pierde la URL, nunca el resto del mensaje. Único uso de
    // `preserve-caught-error` en el repo — `no-control-regex` en
    // apps/server/src/agents.ts:134 es un disable del mismo ESTILO (una
    // regla general, una excepción puntual con motivo en el propio
    // comentario) pero para OTRA regla, no esta.
    // eslint-disable-next-line preserve-caught-error -- a propósito, no un olvido: `cause: e` reintroduciría la URL sin enmascarar (ver comentario arriba)
    throw new Error(withoutUrls(e instanceof Error ? e.message : String(e)));
  }
  // La vista que se devuelve es la de ANTES de depositar (el árbitro ve el
  // depósito en su próximo tick, unos segundos): el modelo sigue sondeando
  // aleph_view hasta que `deposited` lo incluya y la sala pase a `playing`.
  return { ...withLegal(agent, r.view), step: r.step, txHash: r.txHash };
}
