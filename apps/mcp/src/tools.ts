// Lógica de cada herramienta MCP como funciones puras (reciben un ArbiterClient
// inyectable). server.ts solo las envuelve en herramientas MCP. Lo único
// on-chain (el depósito de una mesa de plata de Aleph, y el retiro de lo que el
// escrow haya acreditado) lo manda el agent-sdk, y solo con la config de plata
// del operador (MoneyConfig, más abajo).
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
  type AlephPlaying,
  type AlephRoomView,
  type AlephDepositResult,
  type AlephWithdrawResult,
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
   *  próxima llamada es `aleph_deposit`, no `aleph_act`. En el resultado del
   *  propio `aleph_deposit` siempre es false (ver alephDepositTool). */
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

/** Las mesas de plata de ESTE servidor, fijadas por el operador al arrancar
 *  (config.ts). Vienen del entorno, nunca de los argumentos de una herramienta:
 *  el modelo no elige a qué contrato se aprueba USDC ni el tope por mesa. */
export interface MoneyConfig {
  /** ARCADE_ALEPH_ESCROW_ADDRESS: el mismo pin que recibe `createAgent`. */
  escrow?: string;
  /** ARCADE_ALEPH_MAX_STAKE: lo máximo, en USDC, que la wallet pone en una mesa. */
  maxStake?: number;
}

// FALLAR CERRADO, con un motivo para el OPERADOR. El agent-sdk ya se niega solo
// sin pin (alephJoin de plata y alephDeposit exigen `escrow` antes de tocar la
// red), pero su motivo habla de `createAgent`; acá se corta antes y se nombran
// las variables de entorno que faltan. Con el pin, el approve solo puede ir a
// ese escrow, que toma fondos únicamente cuando esta wallet llama a
// open/deposit con el pase firmado de su asiento: ninguna respuesta del árbitro
// (ARBITER_URL puede ser http://, o de un tercero) manda la plata a un extraño.
// Tampoco se sienta a una mesa de plata: con asiento y sin poder depositar, la
// sala se disolvería en fondeo para los otros 3-7. `money` ausente es mesas de
// plata apagadas, y si se borrara el cableado del pin hacia createAgent en
// index.ts, el SDK sin `escrow` también se niega: falla cerrado, no abierto.
function assertMoneyTables(money: MoneyConfig, refused: string): void {
  if (!money.escrow) {
    throw new Error(
      `${refused}: money tables are off on this MCP server. Its operator has to set ` +
        `ARCADE_ALEPH_ESCROW_ADDRESS (the EscrowAleph contract this wallet may approve USDC to), ` +
        `together with ARCADE_PRIVATE_KEY and RPC_URL, and restart it. The free table (stake 0) needs none of them.`,
    );
  }
}

export function alephRulesTool(): { rulesV: number; rules: string } {
  return { rulesV: ALEPH_RULES_V, rules: describeAlephRules() };
}

export async function alephLobbiesTool(
  client: ArbiterClient,
): Promise<{ lobbies: AlephLobby[]; playing: AlephPlaying[]; stakes: number[] }> {
  // alephLobbiesInfo (no alephLobbies): sin `stakes` el modelo solo se entera
  // de que existe una mesa de plata si YA hay una sala abierta para ese stake
  // en este instante — la descripción de aleph_join apunta acá para el resto
  // de los casos (fix de review, ver informe de la tarea).
  return client.alephLobbiesInfo();
}

export async function alephJoinTool(
  agent: Agent,
  stake = 0,
  money: MoneyConfig = {},
  /** El modelo que declara quien llama. Sin él, el `model` del agente (el
   *  ARCADE_MODEL del operador), si hay. */
  model?: string,
): Promise<AlephAgentView> {
  if (stake > 0) {
    const refused = `not taking a seat at the ${stake} USDC table`;
    assertMoneyTables(money, refused);
    if (money.maxStake !== undefined && stake > money.maxStake) {
      throw new Error(
        `${refused}: this server's operator caps a table at ${money.maxStake} USDC (ARCADE_ALEPH_MAX_STAKE)`,
      );
    }
  }
  return withLegal(agent, await agent.alephJoin(stake, model ? { model } : {}));
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

/** El motivo de un fallo de la wallet, en un Error NUEVO y sin ninguna URL.
 *  Deliberadamente SIN `cause`: adjuntar el original reabriría el mismo hueco
 *  que esto sanea, porque `.message` (y cualquier otra propiedad de un error
 *  de viem, como `.shortMessage` o `.details`) seguiría alcanzable desde
 *  `err.cause` con la URL sin enmascarar. El motivo igual llega al modelo:
 *  solo se pierde la URL, nunca el resto del mensaje. */
function errorWithoutUrls(e: unknown): Error {
  return new Error(withoutUrls(e instanceof Error ? e.message : String(e)));
}

export async function alephDepositTool(
  agent: Agent,
  roomId: string,
  money: MoneyConfig = {},
): Promise<AlephAgentView & { step: "open" | "deposit" | "already"; txHash?: string }> {
  // Antes que nada y afuera del try: este motivo es para el operador y no trae
  // ninguna URL, así que no pasa por la máscara.
  assertMoneyTables(money, "not depositing");
  let r: AlephDepositResult;
  try {
    // El tope del operador viaja como ancla de `alephDeposit`. Sin él, el SDK
    // solo paga el stake con que ESTE proceso se sentó por aleph_join: después
    // de un reinicio del servidor la sala queda sin ancla y no se deposita.
    r = await agent.alephDeposit(roomId, { maxStake: money.maxStake });
  } catch (e) {
    throw errorWithoutUrls(e);
  }
  // La vista que se devuelve es la de ANTES de depositar (el árbitro ve el
  // depósito en su próximo tick, unos segundos): el modelo sigue sondeando
  // aleph_view hasta que `deposited` lo incluya y la sala pase a `playing`.
  // Por eso `mustDeposit` va forzado a false: calculado sobre esa vista vieja,
  // un `open` o `deposit` exitoso volvía diciendo "depositá ya" e invitaba al
  // modelo a repetir la llamada, que en el mejor caso contesta `already` y en
  // el peor choca con un RPC atrasado y un saldo que ya se gastó.
  return { ...withLegal(agent, r.view), mustDeposit: false, step: r.step, txHash: r.txHash };
}

/** Cobra lo que el escrow tiene ACREDITADO a la wallet de este servidor: un
 *  pago que el USDC rechazó al liquidar o reembolsar (la address en la
 *  blacklist de Circle, el token en pausa). El resto de la sala cobró igual;
 *  eso quedó a nombre de esta wallet. Mismo pin y misma máscara de URLs que el
 *  depósito. `amount` en micro-USDC, como string (JSON no lleva bigint). */
export async function alephWithdrawTool(
  agent: Agent,
  money: MoneyConfig = {},
): Promise<{ amount: string; txHash?: string }> {
  assertMoneyTables(money, "not withdrawing");
  let r: AlephWithdrawResult;
  try {
    r = await agent.alephWithdraw();
  } catch (e) {
    throw errorWithoutUrls(e);
  }
  return { amount: r.amount.toString(), txHash: r.txHash };
}
