// Helpers de alto nivel: crear un agente y "jugá y enviá" en una sola llamada.
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, type Chain, type Hex } from "viem";
import { foundry, base, baseSepolia } from "viem/chains";
import {
  ArbiterClient,
  type MatchView,
  type AlephLobby,
  type AlephRoomView,
  type AlephViewPass,
} from "./client";
import {
  randomWallet,
  signScore,
  signMatchmake,
  signLiveStart,
  signAlephAction,
  signAlephView,
} from "./sign";
import {
  DEFAULT_STRATEGIES,
  defaultLiveStrategy,
  type LiveStrategy,
  type Strategy,
} from "./strategies";
import { RULES_V } from "@arcade1v1/game-sdk/rules";
import { checkLiveReveals, isLiveMatch } from "@arcade1v1/game-sdk/live";
import { playFlappyLive, type FlappyLiveReply } from "@arcade1v1/game-sdk/flappy-live";
import { waitUntilSealed } from "@arcade1v1/game-sdk/chain";
import { normalizeModel } from "@arcade1v1/game-sdk/auth";
import {
  ALEPH_RULES_V,
  ALEPH_ESCROW_STATUS,
  escrowAlephAbi,
  erc20MinimalAbi,
  stakeToUnits,
  type Phase,
  type AlephAction,
} from "@arcade1v1/game-sdk/aleph";

/** Lo que un agente guarda de una partida EN VIVO para comprobarla cuando se
 *  decida: el hash del secreto que el árbitro comprometió al emparejar y todo lo
 *  que le reveló, en orden. Con `checkLiveReveals(view.secret, secretHash,
 *  reveals)` se verifica que el árbitro no mandó valores que no salían de ese
 *  secreto. `playAndSubmit` ya lo comprueba si la partida vuelve decidida. */
export interface LiveReceipt {
  secretHash: string;
  reveals: number[];
}

/** Cuántas veces `playAndSubmit` retoma un intento en vivo que se cortó a mitad
 *  de partida (se agotaron los reintentos, un token viejo, una desincronización):
 *  cada vez abre de nuevo con firma, y el árbitro le devuelve su progreso. */
const MAX_LIVE_RESUMES = 2;

/** El árbitro acepta un pase de vista por MATCHMAKE_AUTH_TTL_MS (10 min). Lo
 *  renovamos a los 8 para no quedar justo en el borde entre dos sondeos. */
export const VIEW_PASS_MAX_AGE_MS = 8 * 60_000;

/** Cuánto espera `alephDeposit` a ver minado el `open` de otro asiento antes
 *  de depositar (ver el catch de `send("open")`): 60 lecturas cada 500 ms, 30 s
 *  en total. Sobra para un bloque de Base. Si ese `open` no se mina en ese
 *  tiempo, el `deposit` sale igual y falla con el motivo del contrato. */
const ROOM_OPEN_POLL_MS = 500;
const ROOM_OPEN_POLLS = 60;

export interface AlephWithdrawResult {
  /** Lo que esta wallet tenía acreditado en el escrow (micro-USDC). 0n = nada:
   *  no se mandó ninguna transacción. */
  amount: bigint;
  /** El `withdraw`, cuando hubo algo que cobrar. */
  txHash?: Hex;
}

export interface AlephDepositResult {
  /** `open` (fui el primero: abrí la sala), `deposit`, o `already` (ya figuraba). */
  step: "open" | "deposit" | "already";
  txHash?: Hex;
  /** La vista privada que se leyó antes de depositar. */
  view: AlephRoomView;
}

/** Red según el `chainId` que manda el árbitro en `deposit`. Un id desconocido
 *  NO cae a una red por defecto: caer a baseSepolia hacía que la wallet siguiera
 *  hasta el primer write con una red que nadie eligió, y el error que viem tira
 *  ahí nombra la red equivocada. Un valor del árbitro que no entendemos se
 *  rechaza acá, antes de leer ni gastar nada. */
function chainFor(id: number): Chain {
  if (id === 31337) return foundry;
  if (id === 8453) return base;
  if (id === 84532) return baseSepolia;
  throw new Error(
    `unknown chainId ${id} from the arbiter: this SDK knows 8453 (base), 84532 (base sepolia) and 31337 (anvil)`,
  );
}

export function createAgent(opts: {
  arbiterUrl?: string;
  privateKey?: Hex;
  client?: ArbiterClient;
  /** Tope de tiempo por pedido al árbitro, en ms (default
   *  `DEFAULT_TIMEOUT_MS`). Solo se usa cuando el agente crea su propio
   *  cliente: con `client` propio, el tope es el de ese cliente. */
  timeoutMs?: number;
  /** Reloj inyectable (tests): fecha los `ts` de las firmas y la edad del pase. */
  clock?: () => number;
  /** RPC de la red del escrow. Con él, una `privateKey` fondeada y `escrow`, la
   *  wallet del agente puede DEPOSITAR en una mesa de plata de Aleph
   *  (`alephDeposit`) y `alephJoin` acepta stake > 0. La wallet tiene que tener
   *  el USDC del stake y gas. Sin `rpcUrl` el SDK solo firma mensajes, como
   *  siempre. */
  rpcUrl?: string;
  /** El EscrowAleph que custodia las mesas de plata, clavado por quien configura
   *  el agente. OBLIGATORIO para jugar plata: sin él, `alephJoin` con stake > 0 y
   *  `alephDeposit` se niegan antes de tocar la red. El árbitro también nombra un
   *  escrow en su respuesta, pero esa respuesta viaja por la red y puede llegar
   *  falsificada o desviada. Con el pin, el approve solo puede ir a ESTE
   *  contrato, que toma fondos únicamente cuando esta misma wallet llama a
   *  `open`/`deposit` con el pase firmado de su asiento: ninguna respuesta del
   *  árbitro puede mandar la plata a un extraño. Va la dirección del contrato:
   *  `0x` + 40 hex y no la cero (el checksum no se exige); `undefined` o "" es
   *  "sin pin", y cualquier otro valor hace tirar a `createAgent`. */
  escrow?: string;
  /** Aleph: el modelo de IA que este agente DECLARA al sentarse ("claude-sonnet-5",
   *  "openai/gpt-5"). Va firmado en el pedido de asiento, queda en esa sala y se
   *  ve en público como "declarado", con su fila en la tabla por modelo
   *  (`GET /aleph/models`). Se normaliza con `normalizeModel`. Nadie lo verifica. */
  model?: string;
}): {
  address: Hex;
  client: ArbiterClient;
  matchmake(game: string, stake: number): Promise<MatchView>;
  /** Empareja y juega. En un juego EN VIVO (la vista dice `live: true`) abre el
   *  intento firmado y compromete las jugadas mientras recibe el azar de a poco;
   *  `liveStrategy` reemplaza a la estrategia por defecto, y la vista vuelve con
   *  `liveReceipt` para comprobar el secreto cuando la partida se decida. */
  playAndSubmit(args: {
    game: string;
    stake: number;
    strategy?: Strategy;
    liveStrategy?: LiveStrategy;
  }): Promise<MatchView & { liveReceipt?: LiveReceipt }>;
  /** Aleph: pedir asiento (firmado). Stake 0 es la mesa gratis; una mesa de
   *  plata exige `rpcUrl`, `privateKey` y `escrow` en `createAgent`, y sin ellos
   *  se niega antes de tocar la red. Idempotente. Antes de sentarse, mira la
   *  versión de reglas de la mesa abierta (si hay una) y corta sin pedir
   *  asiento si no coincide. */
  /** `opts.model` le gana al `model` de `createAgent` para este asiento. */
  alephJoin(stake?: number, opts?: { model?: string }): Promise<AlephRoomView>;
  /** Aleph: TU vista privada, con pase de vista firmado (cacheado 8 min).
   *  Si el árbitro rechaza el pase en silencio (200 con la vista pública),
   *  reintenta una vez con uno recién firmado antes de tirar un error claro. */
  alephView(roomId: string): Promise<AlephRoomView>;
  /** Aleph: una acción firmada. PASÁ SIEMPRE `at` (etapa/fase) copiado de la
   *  vista sobre la que decidiste: es lo que ata la firma a esa fase y hace que
   *  el árbitro conteste "stage or phase mismatch" si cerró mientras pensabas.
   *  Si se omite, se consulta la vista primero (un GET más) y la acción se firma
   *  para la fase que esté abierta EN ESE MOMENTO, que puede no ser la que viste
   *  (en la Cerradura, un `ready` de "terminé de hablar" pasaría a ser un PASE). */
  alephAct(
    roomId: string,
    action: AlephAction,
    at?: { stage: number; phase: Phase },
  ): Promise<AlephRoomView>;
  /** Aleph, mesa de plata: deposita el stake de ESTA wallet en la sala en
   *  `funding` (approve si hace falta, `open` si soy el primero, `deposit` si
   *  no). Idempotente: si ya deposité, no manda nada. Exige `rpcUrl` y
   *  `escrow` en `createAgent`: sin ellos se niega antes de tocar la red.
   *  Antes de aprobar un solo USDC valida lo que el árbitro pide contra lo que
   *  eligió quien configura el AGENTE, nunca contra la vista del propio
   *  árbitro: el escrow, contra el clavado; el stake, exactamente el que se
   *  pidió con `alephJoin` para esa sala en este proceso, o no más de
   *  `limits.maxStake` (USDC) si se da, y sin ninguna de las dos anclas se niega
   *  antes de tocar la red; la red, contra el `rpcUrl`. Quien deposita desde
   *  OTRO proceso (un reinicio, un script aparte) pasa su tope:
   *  `alephDeposit(roomId, { maxStake: 2 })`. */
  alephDeposit(roomId: string, limits?: { maxStake?: number }): Promise<AlephDepositResult>;
  /** Aleph, mesa de plata: cobra lo que el escrow tiene ACREDITADO a esta
   *  wallet. Pasa cuando el USDC rechazó un pago al liquidar o reembolsar (la
   *  address estaba en la blacklist de Circle, o el token en pausa): el resto de
   *  la sala cobró igual y esa parte quedó guardada a nombre de esta wallet.
   *  Lee `owed` primero y, sin nada acreditado, no manda ninguna transacción.
   *  Exige `rpcUrl`, `privateKey` y `escrow` en `createAgent`: cobra del escrow
   *  CLAVADO, nunca de uno que nombre el árbitro. Es un saldo por dirección:
   *  una llamada cobra lo de todas las salas. */
  alephWithdraw(): Promise<AlephWithdrawResult>;
} {
  // UN PIN QUE NO SE PUEDE USAR NO CUENTA COMO PIN, y se corta acá, al crear el
  // agente: antes de sentarse y de tocar la red. `missingOptions` (más abajo)
  // solo mira si hay algo, así que "0x", unos espacios o la dirección cero
  // pasaban por pin puesto: `alephJoin` se sentaba a una mesa que no podía pagar
  // (cada depósito moría en "escrow mismatch" y la sala se disolvía en fondeo
  // para los otros asientos) y, si el árbitro servía la misma cero, se firmaba un
  // approve a 0x000…000. `undefined` y "" siguen siendo "sin pin": la plata se
  // niega después, con `missing: escrow`. Es la regla que el MCP aplica a
  // ARCADE_ALEPH_ESCROW_ADDRESS (apps/mcp/src/config.ts): `0x` + 40 hex y no la
  // cero, sin recortar espacios ni exigir checksum EIP-55; el cruce con el escrow
  // del árbitro sigue sin distinguir mayúsculas. El mensaje NO repite el valor:
  // en este campo se puede pegar una clave privada por error.
  const pin: unknown = opts.escrow;
  if (
    pin !== undefined &&
    pin !== "" &&
    (typeof pin !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(pin) ||
      pin.toLowerCase() === "0x" + "0".repeat(40))
  ) {
    throw new Error(
      "createAgent: escrow must be the EscrowAleph contract address — 0x followed by 40 hex digits, not the zero address (its value is not shown here)",
    );
  }
  const wallet = opts.privateKey
    ? { privateKey: opts.privateKey, address: privateKeyToAccount(opts.privateKey).address }
    : randomWallet();
  const client =
    opts.client ??
    new ArbiterClient(opts.arbiterUrl ?? "http://localhost:4000", { timeoutMs: opts.timeoutMs });
  const clock = opts.clock ?? Date.now;

  // En el 1v1 la wallet del SDK SOLO firma mensajes: no manda transacciones
  // on-chain, así que no puede depositar en una mesa de plata. Dejar pasar
  // stake > 0 crea una partida fantasma que nunca se fondea, y el humano que se
  // empareja del otro lado quema gas contra un contrato que revierte. Mejor
  // fallar acá, claro. (En Aleph sí hay camino: `rpcUrl`, `privateKey` y
  // `escrow` + `alephDeposit`.)
  function assertFreeTable(stake: number): void {
    if (stake > 0) {
      throw new Error(
        `el SDK no deposita on-chain, así que no puede jugar la mesa de ${stake} USDC: ` +
          `usá stake 0 (la ladder rankeada gratis, mismo ELO) o el flujo web para mesas de plata`,
      );
    }
  }

  // Emparejar FIRMADO (el árbitro en producción lo exige: anti-suplantación).
  async function matchmake(game: string, stake: number): Promise<MatchView> {
    assertFreeTable(stake);
    const auth = await signMatchmake({
      game,
      stake,
      address: wallet.address,
      privateKey: wallet.privateKey,
    });
    return client.matchmake(game, stake, wallet.address, auth);
  }

  async function playAndSubmit(args: {
    game: string;
    stake: number;
    strategy?: Strategy;
    liveStrategy?: LiveStrategy;
  }): Promise<MatchView & { liveReceipt?: LiveReceipt }> {
    // Un juego en vivo se valida ANTES de emparejar: si esta llamada no puede
    // jugarlo, emparejar dejaría una partida que se pierde por no jugarla.
    if (isLiveMatch(args.game, RULES_V[args.game])) liveStrategyFor(args);
    const m = await matchmake(args.game, args.stake);
    // Guard de versión: si el árbitro corre otras reglas, avisar YA (antes de
    // jugar), con el remedio. El árbitro repite este control en el submit.
    const localV = RULES_V[args.game];
    if (m.rulesV !== undefined && localV !== undefined && m.rulesV !== localV) {
      throw new Error(
        `rules version mismatch for ${args.game}: arbiter v${m.rulesV}, SDK v${localV} — update @arcade1v1 packages`,
      );
    }
    if (m.live) return playLive(m, args);
    const strat = args.strategy ?? DEFAULT_STRATEGIES[args.game];
    if (!strat) throw new Error(`no hay estrategia por defecto para el juego: ${args.game}`);
    if (m.seed === undefined) throw new Error(`the arbiter sent no seed for ${args.game}`);
    const { score, replay } = strat(m.seed);
    const signature = await signScore({
      matchId: m.matchId,
      address: wallet.address,
      score,
      privateKey: wallet.privateKey,
    });
    return client.submitScore(m.matchId, wallet.address, score, replay, signature);
  }

  // Con qué se juega en vivo `args.game`, o por qué esta llamada no puede.
  function liveStrategyFor(args: {
    game: string;
    strategy?: Strategy;
    liveStrategy?: LiveStrategy;
  }): LiveStrategy {
    if (args.strategy) {
      throw new Error(
        `${args.game} is played live: its randomness only arrives after each commit — ` +
          `pass liveStrategy (a per-tick decision) instead of strategy`,
      );
    }
    if (args.game !== "flappy") {
      throw new Error(`this SDK cannot play ${args.game} live yet — update @arcade1v1 packages`);
    }
    const live = args.liveStrategy ?? defaultLiveStrategy(args.game);
    if (!live) throw new Error(`no default live strategy for ${args.game}`);
    return live;
  }

  // EN VIVO: no hay semilla. Se abre el intento con una firma y se juega con
  // playFlappyLive, que compromete las jugadas y consume el azar revelado.
  async function playLive(
    m: MatchView,
    args: { game: string; strategy?: Strategy; liveStrategy?: LiveStrategy },
  ): Promise<MatchView & { liveReceipt: LiveReceipt }> {
    const live = liveStrategyFor(args);
    // Todo lo revelado, en orden: la apertura trae los valores desde el
    // primero y cada compromiso los que siguen al `have` que mandó el driver,
    // así que concatenarlos reconstruye la serie.
    let reveals: number[] = [];
    let confirmed: number;
    for (let resumes = 0; ; resumes++) {
      const auth = await signLiveStart({
        matchId: m.matchId,
        address: wallet.address,
        privateKey: wallet.privateKey,
        ts: clock(),
      });
      const start = await client.liveStart(m.matchId, wallet.address, auth);
      if (start.over) {
        confirmed = start.score;
        break;
      }
      reveals = [...start.reveal];
      const token = start.token;
      try {
        const result = await playFlappyLive({
          start,
          decide: live.decide,
          commit: async (c): Promise<FlappyLiveReply> => {
            const reply = await client.liveCommit(m.matchId, wallet.address, { ...c, token });
            reveals.push(...reply.reveal);
            return reply;
          },
          maxTicks: live.maxTicks,
        });
        confirmed = result.score;
        break;
      } catch (e) {
        // Retomar nunca reinicia el intento: el árbitro devuelve dónde quedó.
        // Si la partida ya no admite jugadas, la apertura lo dice y sale ese error.
        if (resumes >= MAX_LIVE_RESUMES) throw e;
      }
    }
    // El puntaje lo confirma el árbitro al cerrar el intento. La vista pública
    // no muestra puntajes hasta decidir (anti-espionaje), así que el propio se
    // completa con esa confirmación: queda igual que la respuesta de un envío
    // de puntaje de los de siempre.
    const view = await client.getMatch(m.matchId, wallet.address);
    const me = wallet.address.toLowerCase();
    const scores =
      view.scores[me] === undefined ? { ...view.scores, [me]: confirmed } : view.scores;
    const liveReceipt: LiveReceipt = { secretHash: m.secretHash ?? "", reveals };
    // Decidida, la partida tiene que mostrar su secreto: sin él no hay cómo
    // comprobarla, y eso también es una alarma (no un "no se sabe").
    const decided = view.status === "settled" || view.status === "draw";
    if (decided && view.secret === undefined) {
      throw new Error(
        `live match ${m.matchId} was decided but the arbiter did not publish its secret: ` +
          `it cannot be verified`,
      );
    }
    if (
      view.secret !== undefined &&
      !checkLiveReveals(view.secret, liveReceipt.secretHash, reveals)
    ) {
      throw new Error(
        `live match ${m.matchId}: the published secret does not match what the arbiter committed ` +
          `(secretHash) or the values it revealed`,
      );
    }
    return { ...view, scores, liveReceipt };
  }

  // ---- Aleph (formato multi-agente) ------------------------------------

  // El lobby SÍ publica rulesV antes de sentarse: GET /aleph/lobbies da el
  // roomId de la mesa abierta y GET /aleph/:id sin pase (vista pública, sin
  // costo) trae rulesV para esa sala en cualquier estado (roomView,
  // apps/server/src/aleph.ts). Miramos ahí ANTES de pedir asiento: un SDK
  // desactualizado que se sienta igual deja un asiento mudo que estira CADA
  // fase hasta ALEPH_PHASE_MS (nadie decide por consenso) y arrastra a los
  // demás 3-7 asientos durante dos etapas, hasta que MAX_ABSENCES lo marca
  // `abandoned`. Es mejor esfuerzo: si el GET falla (red caída) seguimos de
  // largo y confiamos en la red de contención de abajo.
  async function assertCompatibleRules(stake: number): Promise<void> {
    let lobbies: AlephLobby[];
    try {
      lobbies = await client.alephLobbies();
    } catch {
      return;
    }
    const open = lobbies.find((l) => l.stake === stake);
    if (!open) return; // primera mesa de esta vida del árbitro: nada que mirar todavía.
    let pub: AlephRoomView;
    try {
      pub = await client.alephView(open.roomId);
    } catch {
      return;
    }
    if (pub.rulesV !== ALEPH_RULES_V) {
      throw new Error(
        `rules version mismatch for aleph: arbiter v${pub.rulesV}, SDK v${ALEPH_RULES_V} — ` +
          `update @arcade1v1 packages (room ${open.roomId})`,
      );
    }
  }

  // El stake que ESTE agente pidió al sentarse, por sala (roomId en
  // minúsculas). Es el ancla de `alephDeposit`: la única cifra del depósito que
  // no sale de la respuesta del árbitro. Vive en la memoria del proceso a
  // propósito: quien deposita desde otro proceso pasa su propio tope
  // (`maxStake`) en vez de recuperar algo que el árbitro pueda reescribir.
  const joinedStakes = new Map<string, number>();

  // Las opciones de `createAgent` que faltan para tocar plata, en el orden en que
  // se piden. Solo NOMBRES, nunca valores: la clave y la URL del RPC son secretas.
  function missingOptions(needed: readonly ("rpcUrl" | "privateKey" | "escrow")[]): string[] {
    return needed.filter((name) => !opts[name]);
  }

  async function alephJoin(stake = 0, joinOpts: { model?: string } = {}): Promise<AlephRoomView> {
    // Una mesa de plata solo tiene sentido si esta wallet puede depositar sin
    // quedar expuesta. Sin RPC, con la wallet efímera que se sortea cuando no hay
    // `privateKey` (nadie la fondeó ni puede fondearla a tiempo), o sin `escrow`
    // (sin el cual `alephDeposit` se niega), se sentaría para nada: la sala
    // entraría en fondeo y se disolvería a los 10 min haciendo perder el tiempo
    // a los otros 3-7 asientos. Se corta antes de tocar la red.
    if (stake > 0) {
      const missing = missingOptions(["rpcUrl", "privateKey", "escrow"]);
      if (missing.length > 0) {
        throw new Error(
          `a money table (${stake} USDC) needs a wallet that can deposit safely: pass rpcUrl, a funded ` +
            `privateKey and escrow (the EscrowAleph address you trust) to createAgent, or use stake 0 ` +
            `— missing: ${missing.join(", ")}`,
        );
      }
    }
    await assertCompatibleRules(stake);
    // Normalizado ACÁ: el árbitro re-arma el mensaje con el modelo normalizado,
    // así que lo firmado y lo enviado tienen que ser el mismo string.
    const model = normalizeModel(joinOpts.model ?? opts.model);
    const auth = await signMatchmake({
      game: "aleph",
      stake,
      address: wallet.address,
      privateKey: wallet.privateKey,
      ts: clock(),
      model,
    });
    const v = await client.alephJoin(stake, wallet.address, auth, model);
    // Red de contención: si no había mesa abierta para mirar antes (primera
    // sala) o la versión cambió justo en el medio, igual cortamos acá. No hay
    // endpoint para abandonar la mesa, así que el roomId va en el mensaje: el
    // dueño del agente necesita saber cuál quedó con un asiento mudo.
    if (v.rulesV !== ALEPH_RULES_V) {
      throw new Error(
        `rules version mismatch for aleph: arbiter v${v.rulesV}, SDK v${ALEPH_RULES_V} — ` +
          `update @arcade1v1 packages (room ${v.roomId})`,
      );
    }
    // Se anota solo si la sala que devolvió el árbitro es de la mesa pedida. El
    // join es idempotente: con asiento en una sala de plata, pedir la gratis
    // (el default de `aleph_join` en el MCP, que un modelo usa para volver a
    // encontrar su sala) devuelve ESA sala, y pisar su ancla con 0 dejaría a
    // un agente legítimo sin poder depositar, y la sala se disolvería para los
    // demás. Una sala de otro stake no deja ancla: su depósito se niega.
    if (v.stake === stake) joinedStakes.set(v.roomId.toLowerCase(), stake);
    return v;
  }

  // Un pase por sala, reutilizado mientras sirve: firmar en cada sondeo sería
  // gratis en CPU pero inútil, y el árbitro lo acepta 10 minutos.
  const passes = new Map<string, AlephViewPass>();
  async function viewPass(roomId: string): Promise<AlephViewPass> {
    const now = clock();
    const cached = passes.get(roomId);
    if (cached && now - cached.ts < VIEW_PASS_MAX_AGE_MS) return cached;
    for (const [id, p] of passes) if (now - p.ts >= VIEW_PASS_MAX_AGE_MS) passes.delete(id);
    const { signature, ts } = await signAlephView({
      roomId,
      address: wallet.address,
      privateKey: wallet.privateKey,
      ts: now,
    });
    const pass = { address: wallet.address, signature, ts };
    passes.set(roomId, pass);
    return pass;
  }

  // El árbitro NUNCA lanza ante un pase inválido: si verifySigned falla (firma
  // mala, o el `ts` cacheado ya luce vencido para EL RELOJ DEL SERVIDOR, p.ej.
  // un host sin NTP 3 minutos atrasado) responde 200 con la vista PÚBLICA, sin
  // `you` (getAlephRoom, apps/server/src/aleph.ts). Si eso pasa mientras
  // tenemos asiento, jugar a ciegas con `you` undefined es peor que fallar
  // claro: acá lo detectamos y reintentamos una vez con un pase recién
  // firmado (ts = ahora, lejos del borde) antes de resignarnos.
  //
  // EN FONDEO la marca es otra: la vista privada de un asiento trae el bloque
  // `deposit` (withDeposit, apps/server/src/aleph.ts) y la pública no. Es el
  // estado donde hay PLATA de por medio, así que es donde menos se puede
  // confundir un pase rechazado con "esta sala no está fondeando".
  function passWasRejected(v: AlephRoomView): boolean {
    const mine = v.seats.some((s) => s.address.toLowerCase() === wallet.address.toLowerCase());
    if (!mine) return false;
    if (v.status === "funding") return v.deposit === undefined;
    if (v.status === "playing" || v.status === "settled") return v.you === undefined;
    return false;
  }

  async function alephView(roomId: string): Promise<AlephRoomView> {
    const v = await client.alephView(roomId, await viewPass(roomId));
    if (!passWasRejected(v)) return v;
    passes.delete(roomId); // el pase cacheado no sirve: forzar uno nuevo, no reusarlo.
    const retry = await client.alephView(roomId, await viewPass(roomId));
    if (passWasRejected(retry)) {
      throw new Error(
        `view pass rejected for room ${roomId}: check the system clock (address ${wallet.address} ` +
          `has a seat but the arbiter won't grant the private view)`,
      );
    }
    return retry;
  }

  async function alephAct(
    roomId: string,
    action: AlephAction,
    at?: { stage: number; phase: Phase },
  ): Promise<AlephRoomView> {
    let where = at;
    if (!where) {
      // Sin ancla: se firma para la fase abierta AHORA. Es cómodo para un
      // script de una sola acción, pero quien decide mirando una vista tiene
      // que pasar `at` (ver el JSDoc de arriba).
      const v = await alephView(roomId);
      if (v.status !== "playing" || !v.stage) {
        throw new Error(`room ${roomId} is not playing (${v.status})`);
      }
      where = { stage: v.stage.index, phase: v.stage.phase };
    }
    const { signature, ts } = await signAlephAction({
      roomId,
      stage: where.stage,
      phase: where.phase,
      action,
      privateKey: wallet.privateKey,
      ts: clock(),
    });
    return client.alephAct(roomId, wallet.address, {
      stage: where.stage,
      phase: where.phase,
      action,
      signature,
      ts,
    });
  }

  // La ÚNICA transacción que manda este SDK. Todo lo demás es firma.
  async function alephDeposit(
    roomId: string,
    limits: { maxStake?: number } = {},
  ): Promise<AlephDepositResult> {
    // SIN PIN DE ESCROW NO SE DEPOSITA, y se corta antes de hablar con el
    // árbitro o con el RPC. Sin pin, todo lo que decide la plata sale de quien
    // responde: el contrato al que se aprueba (`deposit.escrow`) y también cada
    // control de idempotencia, porque la lista `deposited` es del árbitro y
    // `roomOf`/`paid` se leen del escrow que él mismo nombra. Una respuesta
    // falsa o desviada (el `arbiterUrl` por defecto es `http://`; no hace falta
    // robar la llave del árbitro) cobraba así un approve a su contrato POR CADA
    // llamada, no uno solo. Con el pin, el approve solo puede ir a ese contrato,
    // que toma fondos únicamente cuando esta wallet llama a `open`/`deposit` con
    // el pase firmado de su asiento.
    const missing = missingOptions(["rpcUrl", "escrow"]);
    if (missing.length > 0) {
      throw new Error(
        `alephDeposit needs rpcUrl and escrow (the EscrowAleph address you trust) in createAgent ` +
          `— missing: ${missing.join(", ")}; not depositing`,
      );
    }
    // EL MONTO LO ANCLA EL AGENTE, NO EL ÁRBITRO. `deposit` llega en un JSON
    // por la red (el `arbiterUrl` por defecto es `http://`), y cruzar su
    // `stake` contra el `stake` de la misma vista no prueba nada: las dos
    // cifras las escribe el árbitro. Uno comprometido, mal configurado o
    // suplantado que mintiera coherente (750 en los dos campos, justo el saldo
    // de la wallet, que es público) pasaba ese control y se llevaba un approve
    // por todo, sin que el agente se hubiera sentado a ninguna mesa. Solo
    // cuentan cifras que eligió el agente: el stake con que se sentó a ESTA
    // sala en este proceso, o el tope que pasa quien llama. Sin ninguna no se
    // deposita, y se corta acá: antes de hablar con el árbitro o con el RPC.
    const { maxStake } = limits;
    if (maxStake !== undefined && !(Number.isFinite(maxStake) && maxStake > 0)) {
      throw new Error(
        `maxStake must be a positive number of USDC (got ${maxStake}) — not depositing`,
      );
    }
    const joined = joinedStakes.get(roomId.toLowerCase());
    if (joined === undefined && maxStake === undefined) {
      throw new Error(
        `no stake of your own for room ${roomId}: this agent did not take that seat with alephJoin ` +
          `in this process and no maxStake was given, so only the arbiter's response would decide ` +
          `how much USDC to approve — not depositing (pass alephDeposit(roomId, { maxStake }))`,
      );
    }
    // Primero la vista: si la sala no está fondeando no hay nada que mandar, y
    // así el error es del árbitro (claro) y no del RPC (críptico).
    const view = await alephView(roomId);
    if (view.status !== "funding") {
      throw new Error(`room ${roomId} is not funding (${view.status})`);
    }
    // Sin bloque `deposit` no hay nada que firmar, y el motivo NO es que la sala
    // no esté fondeando (acaba de comprobarse que sí): o esta address no tiene
    // asiento, o el árbitro devolvió la vista pública. Ese segundo caso ya lo
    // reintenta `alephView` con un pase fresco, así que si llegamos acá siendo
    // asiento es que ni con uno nuevo alcanzó.
    if (!view.deposit) {
      throw new Error(
        `no deposit pass in your private view of room ${roomId}: address ${wallet.address} ` +
          `may not be a seat there, or the arbiter rejected your view pass (check the system clock)`,
      );
    }
    const me = wallet.address.toLowerCase();
    if (view.deposited?.some((a) => a.toLowerCase() === me)) return { step: "already", view };

    const d = view.deposit;
    const escrow = d.escrow as Hex;
    const usdc = d.usdc as Hex;
    const stake = BigInt(d.stake);
    const id = roomId as Hex;

    // Las anclas de arriba contra lo que pide el árbitro. Con las dos, valen
    // las dos: el stake con que se sentó manda, y el tope no se puede pasar.
    if (joined !== undefined && stake !== stakeToUnits(joined)) {
      throw new Error(
        `deposit stake mismatch in room ${roomId}: the arbiter asks for ${stake} micro-USDC ` +
          `but this agent joined it at ${joined} USDC (${stakeToUnits(joined)} micro-USDC) — not depositing`,
      );
    }
    if (maxStake !== undefined && stake > stakeToUnits(maxStake)) {
      throw new Error(
        `deposit over maxStake in room ${roomId}: the arbiter asks for ${stake} micro-USDC, ` +
          `more than your maxStake of ${maxStake} USDC (${stakeToUnits(maxStake)} micro-USDC) — not depositing`,
      );
    }
    // El escrow que nombra el árbitro tiene que ser el clavado (obligatorio, se
    // exigió arriba): es un dato del despliegue, no algo que el agente pueda
    // derivar de la sala. Sin pin, esta comparación también falla cerrada.
    if (!opts.escrow || opts.escrow.toLowerCase() !== escrow.toLowerCase()) {
      throw new Error(
        `escrow mismatch in room ${roomId}: the arbiter points at ${escrow} but createAgent ` +
          `pinned ${opts.escrow} — not depositing`,
      );
    }

    const chain = chainFor(d.chainId);
    const account = privateKeyToAccount(wallet.privateKey);
    const pub = createPublicClient({ chain, transport: http(opts.rpcUrl) });
    const w = createWalletClient({ account, chain, transport: http(opts.rpcUrl) });
    // La red la decide el RPC del operador, no el árbitro. Sin este control, un
    // `rpcUrl` apuntado a otra red se descubre recién en el primer write (cuatro
    // lecturas más tarde) y con un error de viem sobre "la cadena del cliente".
    const rpcChainId = await pub.getChainId();
    if (rpcChainId !== d.chainId) {
      throw new Error(
        `chain mismatch: the arbiter's escrow is on chain ${d.chainId} but rpcUrl is chain ${rpcChainId}`,
      );
    }

    // LA CADENA ES LA AUTORIDAD sobre quién ya pagó: la lista del árbitro va un
    // tick atrás (la refresca `alephChainTick`). Sin esta lectura, volver a
    // llamar —lo más normal después de un timeout— gastaría un approve y
    // moriría con "insufficient USDC" (la wallet ya pagó) en vez de decir la
    // verdad: que el depósito ya está.
    const onchain = await pub.readContract({
      address: escrow,
      abi: escrowAlephAbi,
      functionName: "roomOf",
      args: [id],
    });
    const roomStatus = Number(onchain[5]);
    if (roomStatus !== ALEPH_ESCROW_STATUS.None) {
      const alreadyPaid = await pub.readContract({
        address: escrow,
        abi: escrowAlephAbi,
        functionName: "paid",
        args: [id, account.address],
      });
      if (alreadyPaid) return { step: "already", view };
    }

    const balance = await pub.readContract({
      address: usdc,
      abi: erc20MinimalAbi,
      functionName: "balanceOf",
      args: [account.address],
    });
    if (balance < stake) {
      throw new Error(
        `insufficient USDC to deposit: have ${balance}, need ${stake} (micro-USDC) at ${usdc}`,
      );
    }
    const allowance = await pub.readContract({
      address: usdc,
      abi: erc20MinimalAbi,
      functionName: "allowance",
      args: [account.address, escrow],
    });
    if (allowance < stake) {
      // EXACTAMENTE el stake, nunca un permiso infinito, y al escrow, que solo
      // puede tomarlo dentro de `open`/`deposit` con el pase de ESTE asiento.
      // Si el depósito de abajo falla, el permiso queda puesto: vale un stake,
      // contra ese contrato, y el próximo intento lo reutiliza en vez de
      // aprobar (y pagar gas) de nuevo.
      const hash = await w.writeContract({
        address: usdc,
        abi: erc20MinimalAbi,
        functionName: "approve",
        args: [escrow, stake],
        account,
        chain,
      });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`USDC approve reverted on-chain: ${usdc} spender ${escrow} (tx ${hash})`);
      }
      // El recibo puede ser PRECONFIRMADO: sin esperar a que se selle su bloque,
      // la simulación de abajo lee `latest` sin el permiso y revierte con
      // ERC20InsufficientAllowance (ver waitUntilSealed).
      await waitUntilSealed(pub, receipt.blockNumber);
    }

    // Simular antes de mandar: un revert seguro no quema gas, y el motivo del
    // contrato ("fund expired", "not a seat", "already paid") llega entero.
    const send = async (
      functionName: "open" | "deposit",
      args: readonly unknown[],
    ): Promise<Hex> => {
      const { request } = await pub.simulateContract({
        address: escrow,
        abi: escrowAlephAbi,
        functionName,
        args: args as never,
        account,
        chain,
      });
      // MARGEN sobre la estimación de gas, que el nodo devuelve EXACTA. Entre
      // estimar y minar entran los depósitos de los otros asientos, y el ÚLTIMO
      // cuesta ~1 % más (marca la sala Funded y emite RoomFunded): sin margen
      // esa transacción se queda sin gas, revierte, cobra el gas igual y el
      // depósito no entra. Medido: con 4 asientos depositando a la vez pasaba
      // en 3 de cada 5 corridas. El gas que sobra no se cobra.
      const gas = await pub.estimateContractGas({
        address: escrow,
        abi: escrowAlephAbi,
        functionName,
        args: args as never,
        account,
      });
      const hash = await w.writeContract({ ...request, gas: (gas * 5n) / 4n });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      // Con el recibo preconfirmado, `latest` todavía no tiene esta transacción
      // ni la que la hizo revertir: el catch de abajo leería la sala sin abrir, y
      // quien llame después vería un depósito que todavía no está.
      await waitUntilSealed(pub, receipt.blockNumber);
      // Un revert MINADO no lanza: viem devuelve el recibo con status
      // "reverted" y el hash parece un éxito. Sin este control, un depósito que
      // nunca entró se reportaría como hecho y el agente esperaría una sala que
      // se va a disolver por fondeo incompleto.
      if (receipt.status !== "success") {
        throw new Error(`aleph ${functionName} reverted on-chain for room ${roomId} (tx ${hash})`);
      }
      return hash;
    };
    // Sala sin abrir = me toca abrirla. La lectura es de antes del approve y
    // puede quedar vieja, pero solo en una dirección (la sala se abre, nunca se
    // cierra): ese caso lo levanta el catch de abajo.
    let step: "open" | "deposit" = roomStatus === ALEPH_ESCROW_STATUS.None ? "open" : "deposit";
    const openArgs = [
      roomId,
      d.seats,
      stake,
      BigInt(d.fundDeadline),
      BigInt(d.playDeadline),
      d.seatSig,
    ] as const;
    let txHash: Hex;
    try {
      txHash =
        step === "open" ? await send("open", openArgs) : await send("deposit", [roomId, d.seatSig]);
    } catch (e) {
      // Carrera: otro asiento abrió la sala entre mi lectura y mi envío. Se
      // CONFIRMA, no se adivina: si la simulación cazó el revert el motivo
      // viene en el mensaje ("room exists"), pero si mi transacción se minó
      // detrás de la otra el recibo no trae motivo ninguno — ahí lo dice la
      // cadena, que a esta altura tiene la sala abierta.
      let raced = step === "open" && /room exists/i.test((e as Error).message);
      if (step === "open" && !raced) {
        try {
          const after = await pub.readContract({
            address: escrow,
            abi: escrowAlephAbi,
            functionName: "roomOf",
            args: [id],
          });
          raced = Number(after[5]) !== ALEPH_ESCROW_STATUS.None;
        } catch {
          // El RPC no contesta: vale el error original, que es el informativo.
        }
      }
      if (!raced) throw e;
      // El "room exists" puede venir de la ESTIMACIÓN de gas, no de la
      // simulación. viem no le pasa bloque a `eth_estimateGas` y el nodo (anvil,
      // al menos) estima sobre el bloque PENDIENTE, que ya incluye el `open` del
      // otro asiento aunque siga en el pool. La simulación del `deposit`, en
      // cambio, mira el último bloque minado, donde la sala todavía no existe:
      // revertía "not funding". Pasaba de a ratos en CI, con los cuatro asientos
      // depositando a la vez. Se espera a ver la sala abierta en ese bloque.
      for (let i = 0; i < ROOM_OPEN_POLLS; i++) {
        const open = await pub
          .readContract({
            address: escrow,
            abi: escrowAlephAbi,
            functionName: "roomOf",
            args: [id],
          })
          .then(
            (r) => Number(r[5]) !== ALEPH_ESCROW_STATUS.None,
            () => false,
          );
        if (open) break;
        await new Promise((r) => setTimeout(r, ROOM_OPEN_POLL_MS));
      }
      step = "deposit";
      txHash = await send("deposit", [roomId, d.seatSig]);
    }
    return { step, txHash, view };
  }

  async function alephWithdraw(): Promise<AlephWithdrawResult> {
    // Sin las tres cosas no hay nada que cobrar con criterio: sin RPC no se lee
    // la cadena, sin `privateKey` la wallet es efímera (no pudo tener nada
    // acreditado) y sin el pin el único escrow a mano sería uno que nombra la
    // red. Se corta antes de hablar con nadie.
    const missing = missingOptions(["rpcUrl", "privateKey", "escrow"]);
    if (missing.length > 0) {
      throw new Error(
        `alephWithdraw needs rpcUrl, privateKey and escrow (the EscrowAleph address you trust) in ` +
          `createAgent — missing: ${missing.join(", ")}; not withdrawing`,
      );
    }
    const escrow = opts.escrow as Hex;
    const account = privateKeyToAccount(wallet.privateKey);
    // No hay vista del árbitro que nombre la red: la dice el RPC del operador,
    // y una que el SDK no conoce se rechaza igual que en `alephDeposit`.
    const chain = chainFor(await createPublicClient({ transport: http(opts.rpcUrl) }).getChainId());
    const pub = createPublicClient({ chain, transport: http(opts.rpcUrl) });
    const amount = await pub.readContract({
      address: escrow,
      abi: escrowAlephAbi,
      functionName: "owed",
      args: [account.address],
    });
    if (amount === 0n) return { amount };
    const w = createWalletClient({ account, chain, transport: http(opts.rpcUrl) });
    // Simular primero: si la address sigue en la blacklist (o el USDC en
    // pausa), el motivo del token llega entero y no se quema gas.
    const { request } = await pub.simulateContract({
      address: escrow,
      abi: escrowAlephAbi,
      functionName: "withdraw",
      args: [],
      account,
      chain,
    });
    const hash = await w.writeContract(request);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    // Mismo cuidado que el depósito: un recibo preconfirmado todavía no está en
    // `latest`, y un revert minado no lanza.
    await waitUntilSealed(pub, receipt.blockNumber);
    if (receipt.status !== "success") {
      throw new Error(`aleph withdraw reverted on-chain (tx ${hash})`);
    }
    return { amount, txHash: hash };
  }

  return {
    address: wallet.address,
    client,
    matchmake,
    playAndSubmit,
    alephJoin,
    alephView,
    alephAct,
    alephDeposit,
    alephWithdraw,
  };
}
