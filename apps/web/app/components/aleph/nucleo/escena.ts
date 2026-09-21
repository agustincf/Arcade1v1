// LA PUESTA EN ESCENA. Puro: convierte la vista pública de una sala en el
// modelo que dibujan los componentes. Los componentes no deciden nada — leen
// este objeto. Así la escena entera se prueba con `node --test`, sin DOM.
//
// Lo que NO arma: la terminal de la charla, que es de `charla.ts`.

import { chipDeAsiento, estadoDeAsiento, igual, incluye } from "./estados";
import type {
  AsientoDeSala,
  EstadoDeSala,
  EtapaKind,
  Fase,
  ResultadoDeEtapa,
  SalaDeAleph,
} from "./estados";
import type { Estado } from "./criatura";

/** El `t` de la página. Los componentes de la escena no importan `useT`: los
 *  textos entran por prop, que es lo que les permite ser puros de dibujo. */
export type Traductor = (key: string, vars?: Record<string, string | number>) => string;

/** Lo que la página calcula comparando la vista nueva con la anterior, y que
 *  le pasa IGUAL a la escena y a la terminal: son ventanas hermanas y ninguna
 *  es hija de la otra. Vive acá y no en `Charla.tsx` porque ahora lo usan los
 *  dos lados. */
export type Destello = { tipo: "grieta" | "revela" | "desclasifica"; asientos?: string[] };

/** La etiqueta de un asiento, en las dos formas que la escena necesita. La
 *  arma la página, que es la única que puede importar `wallet.tsx`. La versión
 *  ancha es el string plano de `playerLabel`; la angosta son sus tres pedazos,
 *  porque a 375 px el string entero no entra y no hay media query que parta un
 *  string. */
export interface EtiquetaDeAsiento {
  plana: string;
  /** `{avatar} {nombre}`, o `null` si el asiento no tiene perfil. */
  perfil: string | null;
  /** `shortAddress(address)`. NUNCA se trunca, en ningún ancho. */
  wallet: string;
  /** CASA/WEBHOOK, ya traducido, o `null`. */
  tag: string | null;
}

/** El bolsillo de un asiento, en UN solo lugar: mientras la sala juega es
 *  `pocket`; cuando liquidó es `payouts[address]`, que es con lo que se fue de
 *  verdad. Escrito dos veces, el oro del cuerpo y el monto de la tarjeta se
 *  pueden ir a distintas escalas sin que nadie se entere. */
export function bolsilloDe(seat: AsientoDeSala, room: SalaDeAleph): number {
  const pagos = room.payouts;
  if (!pagos) return seat.pocket;
  // Sin caja, como todo el resto del módulo: el motor escribe `payouts` en
  // minúsculas y `seats[].address` puede llegar en EIP-55. Indexado directo,
  // el oro del cuerpo y el monto de la tarjeta caían a `pocket` sin aviso.
  const clave = Object.keys(pagos).find((a) => igual(a, seat.address));
  return clave === undefined ? seat.pocket : pagos[clave];
}

export interface AsientoDeEscena {
  /** El asiento crudo, para `etiquetaDe`: la escena no arma etiquetas. */
  seat: AsientoDeSala;
  address: string;
  estado: Estado;
  traidor: boolean;
  bolsillo: number;
  /** Clave de i18n; el texto lo resuelve el componente con `t`. */
  chip: string;
  /** El `+{n}` del que se fue con plata. `null` si no hay monto que mostrar. */
  insignia: number | null;
  /** Solo los vivos de una sala en juego respiran. */
  respira: boolean;
}

export interface EtapaDeEscena {
  n: number;
  kind: EtapaKind;
  fase: Fase;
  /** `deadline` (epoch ms), o `null` si el árbitro no lo manda. */
  hasta: number | null;
}

export interface ContadorDeEscena {
  clave: "aleph.scene.acted" | "aleph.scene.ready";
  k: number;
  n: number;
}

export interface CierreDeEscena {
  clave: string;
  /** La dirección del único que robó, para `aleph.line.finalSteal`. */
  quien: string | null;
}

export interface CartaDeEscena {
  etapa: EtapaDeEscena | null;
  contador: ContadorDeEscena | null;
  cierre: CierreDeEscena | null;
}

export interface CartaDelFriso {
  n: number;
  kind: EtapaKind;
  salida: boolean;
  premio: boolean;
}

export interface FrisoDeEscena {
  jugadas: CartaDelFriso[];
  actual: { n: number; kind: EtapaKind } | null;
  /** Dorsos de las que faltan. Cero con la sala liquidada. */
  dorsos: number;
}

export interface MesaDeEscena {
  pozo: number;
  caja: number;
  bolsillos: number;
  total: number;
  cartasSinDar: number;
  /** `settled`: el mazo va apagado y sin número, y no se dibuja la barra. */
  liquidada: boolean;
  /** `settled`: lo que la caja repartió por asiento. `null` mientras juega. */
  reparto: number | null;
}

export interface ModeloDeEscena {
  estado: EstadoDeSala;
  /** `closesAt` del lobby: el único reloj que la barra de la escena se queda. */
  reloj: number | null;
  columnas: { ancha: number; angosta: number };
  asientos: AsientoDeEscena[];
  /** Los dos de la Final, fuera de la grilla. Vacío el resto del tiempo. */
  finalistas: AsientoDeEscena[];
  sillas: number;
  /** El máximo de la mesa: contra él se mide el oro de cada cuerpo. */
  maximo: number;
  mesa: MesaDeEscena | null;
  carta: CartaDeEscena | null;
  friso: FrisoDeEscena | null;
}

/** Columnas del contenedor ancho por cantidad de asientos: 4 -> 4, 5 o 6 -> 3,
 *  7 u 8 -> 4. El angosto son dos, siempre. */
function columnasDe(n: number): { ancha: number; angosta: number } {
  return { ancha: n === 5 || n === 6 ? 3 : 4, angosta: 2 };
}

/** El `+{n}` del que aceptó la Oferta. El `!r.voided` no es defensa de más: el
 *  mazo trae DOS Ofertas y el motor escribe `accepted` entero antes de
 *  descubrir que aceptaron todos, ahí marca `voided` y sale sin tocar
 *  `eachGot`. Sin el filtro, el que aceptó la SEGUNDA hace match con la
 *  primera y la insignia imprime `+undefined`. Y si aun así no hay monto, no
 *  se dibuja: la criatura se fue igual, pero no se inventa un número. */
function insigniaDe(room: SalaDeAleph, address: string, estado: Estado): number | null {
  if (estado !== "se_fue") return null;
  const oferta = (room.results ?? []).find(
    (r) => r.kind === "offer" && !r.voided && incluye(r.accepted, address),
  );
  return typeof oferta?.eachGot === "number" ? oferta.eachGot : null;
}

function asientoDeEscena(seat: AsientoDeSala, room: SalaDeAleph): AsientoDeEscena {
  const { estado, traidor } = estadoDeAsiento(seat, room);
  return {
    seat,
    address: seat.address,
    estado,
    traidor,
    bolsillo: bolsilloDe(seat, room),
    chip: chipDeAsiento(seat, room, estado),
    insignia: insigniaDe(room, seat.address, estado),
    respira: room.status === "playing" && seat.status === "alive",
  };
}

/** Los dos de la Final. Mientras se juega son los dos vivos (las decisiones son
 *  secretas hasta que cierra); con la sala liquidada salen de `choices`, que es
 *  exacto. Si no son exactamente dos, la grilla no se parte. */
function direccionesFinalistas(room: SalaDeAleph): string[] {
  const ultimo = (room.results ?? [])[(room.results ?? []).length - 1];
  if (room.status === "settled" && ultimo?.kind === "final")
    return Object.keys(ultimo.choices ?? {});
  if (room.status === "playing" && room.stage?.kind === "final")
    return room.seats.filter((s) => s.status === "alive").map((s) => s.address);
  return [];
}

function cierreDe(room: SalaDeAleph): CierreDeEscena {
  const final = (room.results ?? []).find((r) => r.kind === "final");
  // Una sala puede liquidar SIN Final, y es el caso común: la Final solo se
  // abre cuando quedan exactamente dos vivos.
  if (!final) return { clave: "aleph.scene.settledNoFinal", quien: null };
  // Deuda anotada: esta agrupación de `steal` repite la de `estados.ts::coronados`.
  // Unificarlas obliga a exportar `coronados`, y PR2 no lo hace (desvío 4).
  const ladrones = Object.entries(final.choices ?? {})
    .filter(([, c]) => c === "steal")
    .map(([a]) => a);
  if (ladrones.length === 0) return { clave: "aleph.line.finalSplit", quien: null };
  if (ladrones.length === 1) return { clave: "aleph.line.finalSteal", quien: ladrones[0] };
  return { clave: "aleph.line.finalBurn", quien: null };
}

function cartaDe(room: SalaDeAleph): CartaDeEscena | null {
  if (room.status === "playing" && room.stage) {
    const vivos = room.seats.filter((s) => s.status === "alive");
    const k = room.stage.acted.filter((a) => vivos.some((s) => igual(s.address, a))).length;
    return {
      etapa: {
        n: room.stage.index + 1,
        kind: room.stage.kind,
        fase: room.stage.phase,
        hasta: room.deadline ?? null,
      },
      contador: {
        clave: room.stage.phase === "decide" ? "aleph.scene.acted" : "aleph.scene.ready",
        k,
        n: vivos.length,
      },
      cierre: null,
    };
  }
  if (room.status === "settled") return { etapa: null, contador: null, cierre: cierreDe(room) };
  return null;
}

/** Una etapa marca SALIDA solo si alguien dejó la mesa de verdad. Una Oferta
 *  anulada trae `accepted` lleno y no se va nadie: el motor la escribe y recién
 *  después descubre que aceptaron todos. */
function salioAlguien(r: ResultadoDeEtapa): boolean {
  if (r.eliminated) return true;
  if (r.abandoned?.length) return true;
  return Boolean(r.accepted?.length) && !r.voided;
}

function frisoDe(room: SalaDeAleph): FrisoDeEscena | null {
  if (room.status !== "playing" && room.status !== "settled") return null;
  const jugando = room.status === "playing";
  return {
    jugadas: (room.results ?? []).map((r) => ({
      n: r.index + 1,
      kind: r.kind,
      salida: salioAlguien(r),
      premio: (r.bonus ?? 0) > 0,
    })),
    // Con la sala liquidada no hay etapa en curso, y la última ya está en
    // `results`: dibujarla sería un duplicado.
    actual: jugando && room.stage ? { n: room.stage.index + 1, kind: room.stage.kind } : null,
    // Y no hay dorsos: la Final cortó el mazo, así que anunciar cartas que
    // nunca se van a dar sería mentir.
    dorsos: jugando ? (room.cardsLeft ?? 0) : 0,
  };
}

function mesaDe(room: SalaDeAleph): MesaDeEscena | null {
  if (room.status !== "playing" && room.status !== "settled") return null;
  const liquidada = room.status === "settled";
  const caja = room.box ?? 0;
  return {
    pozo: room.pot ?? 0,
    caja,
    // Los bolsillos de la barra leen `pocket` SIEMPRE, no `bolsilloDe`: la
    // barra no se dibuja con la sala liquidada, justamente para no contar dos
    // veces la caja que `payouts` ya repartió.
    bolsillos: room.seats.reduce((n, s) => n + s.pocket, 0),
    total: room.potInitial ?? 0,
    cartasSinDar: room.cardsLeft ?? 0,
    liquidada,
    // El árbitro no lo publica: es la misma cuenta que hace el motor.
    reparto: liquidada && room.seats.length > 0 ? Math.floor(caja / room.seats.length) : null,
  };
}

export function modeloDeEscena(room: SalaDeAleph): ModeloDeEscena {
  const finalistas = direccionesFinalistas(room);
  const parte = finalistas.length === 2;
  const todos = room.seats.map((s) => asientoDeEscena(s, room));
  // Las sillas vacías son SOLO del lobby: en `funding` la lista ya está
  // congelada y una silla prometería un lugar que no se puede ocupar.
  const sillas =
    room.status === "lobby"
      ? Math.max(
          0,
          Math.max(
            (room.min ?? 0) - room.seats.length,
            room.seats.length < (room.max ?? 0) ? 1 : 0,
          ),
        )
      : 0;
  return {
    estado: room.status,
    reloj: room.status === "lobby" ? (room.closesAt ?? null) : null,
    columnas: columnasDe(room.seats.length),
    asientos: parte ? todos.filter((a) => !incluye(finalistas, a.address)) : todos,
    finalistas: parte ? todos.filter((a) => incluye(finalistas, a.address)) : [],
    sillas,
    maximo: todos.reduce((m, a) => Math.max(m, a.bolsillo), 0),
    mesa: mesaDe(room),
    carta: cartaDe(room),
    friso: frisoDe(room),
  };
}
