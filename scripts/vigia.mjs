// Vigía del árbitro y del USDC (O4 de docs/MAINNET.md). Lo corre
// .github/workflows/keep-alive.yml cada ~10 minutos, y de paso despierta al
// árbitro (el Render gratuito duerme sin tráfico).
//
// Mira tres cosas y, si algo anda mal, abre un issue en GitHub (al dueño del
// repo le llega por mail). Cuando se normaliza, comenta y lo cierra solo. Un
// problema que sigue abierto no vuelve a avisar: un issue por problema.
//
//   1. arbitro — `/health` no responde, o responde sin `ok: true`.
//   2. escrow  — el árbitro cerró las mesas de plata porque su configuración no
//                coincide con el contrato (`escrow: "blocked"`), o no lo pudo
//                verificar en minuto y medio (`"unverified"`, que es normal
//                solo justo después de arrancar). La ladder gratis sigue.
//   3. usdc    — el proxy del USDC de Circle en Base mainnet apunta a otra
//                implementación que la de las pruebas contra el USDC real
//                (packages/contracts/test/fork/, AUDIT.md A6): hay que volver a
//                correrlas sobre un bloque nuevo.
//
// Sin dependencias (Node 18+ y la CLI `gh`, que ya está en los runners de
// GitHub). Uso local, sin tocar issues:
//   node scripts/vigia.mjs --dry-run
// Variables: ARBITER_URL, BASE_RPC_URL, VIGIA_SIMULAR=<arbitro|escrow|usdc>
// (fuerza ese problema, para probar el aviso de punta a punta).

/** El USDC de Circle en Base mainnet (`FiatTokenProxy`). */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** Ranura de la implementación del proxy de Circle (el estilo de ZeppelinOS,
 *  `keccak256("org.zeppelinos.proxy.implementation")`), no la de EIP-1967:
 *  esa está vacía en este proxy. */
export const USDC_IMPL_SLOT = "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3";
/** La implementación contra la que pasaron las pruebas de test/fork/ (la del
 *  bloque 51.972.000, y la misma al 2026-11-28). Cuando Circle la cambie: correr
 *  test/fork/ con FORK_BLOCK en un bloque nuevo y, si pasa, actualizar esto. */
export const USDC_IMPL_ESPERADA = "0x2ce6311ddae708829bc0784c967b7d77d19fd779";

export const ETIQUETA = "vigia";

const TITULOS = {
  arbitro: "[vigía] El árbitro no responde",
  escrow: "[vigía] Las mesas de plata están cerradas: el árbitro no coincide con el contrato",
  usdc: "[vigía] El USDC de Base cambió de versión: hay que volver a correr las pruebas",
};

const QUE_HACER = {
  arbitro: [
    "Nadie puede emparejar ni jugar mientras tanto, y el árbitro no paga ni reembolsa.",
    "",
    "Qué hacer: mirar el servicio en el panel de Render (eventos y logs). Si un",
    "deploy falló, volver al anterior desde Render.",
  ],
  escrow: [
    "El árbitro rechaza las mesas de plata (responde `paid tables disabled`). La",
    "ladder gratis sigue andando.",
    "",
    "Qué hacer: el log del árbitro dice el motivo (`escrow NO coincide`). Lo",
    "habitual es una variable que no coincide con el contrato después de un",
    "redeploy o de rotar la llave: `ESCROW_ADDRESS`, la llave del árbitro, la",
    "comisión o las mesas habilitadas.",
  ],
  usdc: [
    "Circle actualizó el contrato del USDC en Base. El escrow sigue andando (un",
    "pago que falla queda acreditado, nunca se pierde), pero el presupuesto fijo de",
    "gas por pago (`PAY_GAS`) se midió contra la versión anterior (AUDIT.md, A6).",
    "",
    "Qué hacer: volver a correr las pruebas contra el USDC real en un bloque nuevo:",
    "",
    "```bash",
    "cd packages/contracts",
    "BASE_RPC_URL=https://mainnet.base.org FORK_BLOCK=<bloque> forge test --match-path 'test/fork/*' -vv",
    "```",
    "",
    "Si pasan, actualizar `USDC_IMPL_ESPERADA` en `scripts/vigia.mjs` con la",
    "implementación nueva (y el bloque de las pruebas en su comentario): con eso",
    "este issue se cierra solo. Si fallan, el presupuesto no alcanza: avisar al",
    "auditor antes de tocar el contrato.",
  ],
};

const marca = (tipo) => `<!-- vigia:${tipo} -->`;

async function fetchConTope(fetchImpl, url, init, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Pide `/health`: el primer intento paga el arranque en frío de Render
 *  (hasta 120 s), y si falla se reintenta una vez a los 15 s. Devuelve el JSON
 *  o el motivo del fallo. */
export async function leerHealth({
  url,
  fetchImpl = fetch,
  esperar = (ms) => new Promise((r) => setTimeout(r, ms)),
  topeMs = 120_000,
}) {
  let motivo = "";
  for (let intento = 0; intento < 2; intento++) {
    if (intento > 0) await esperar(15_000);
    try {
      const r = await fetchConTope(fetchImpl, `${url}/health`, {}, topeMs);
      if (!r.ok) {
        motivo = `HTTP ${r.status}`;
        continue;
      }
      return { health: await r.json() };
    } catch (err) {
      motivo =
        err?.name === "AbortError"
          ? `sin respuesta en ${topeMs / 1000} s`
          : String(err?.message ?? err);
    }
  }
  return { motivo };
}

/** El árbitro: problema si no respondió o si no dice `ok: true`. */
export function evaluarArbitro(lectura, url) {
  if (lectura.motivo) return { tipo: "arbitro", problema: `${url}/health: ${lectura.motivo}` };
  if (lectura.health?.ok !== true)
    return {
      tipo: "arbitro",
      problema: `${url}/health respondió sin ok: ${JSON.stringify(lectura.health)}`,
    };
  return { tipo: "arbitro", problema: null, detalle: `commit ${lectura.health.commit ?? "?"}` };
}

/** El escrow: sin el campo, el árbitro no tiene mesas de plata y no hay nada que
 *  mirar. "unverified" pide una segunda mirada (es normal recién arrancado). */
export function evaluarEscrow(health) {
  if (!health || !("escrow" in health))
    return { tipo: "escrow", problema: null, detalle: "sin mesas de plata" };
  if (health.escrow === "ok") return { tipo: "escrow", problema: null, detalle: "ok" };
  if (health.escrow === "unverified") return { tipo: "escrow", problema: null, reintentar: true };
  return { tipo: "escrow", problema: `/health dice escrow: ${JSON.stringify(health.escrow)}` };
}

async function rpc(fetchImpl, url, method, params) {
  const r = await fetchConTope(
    fetchImpl,
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
    30_000,
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message ?? JSON.stringify(j.error));
  return j.result;
}

/** El USDC: compara la implementación del proxy con la de las pruebas. Si el
 *  RPC público falla no hay veredicto (ni abre ni cierra): un parpadeo del nodo
 *  no es un cambio del USDC. */
export async function evaluarUsdc({ rpcUrl, fetchImpl = fetch }) {
  let slot, bloque;
  try {
    slot = await rpc(fetchImpl, rpcUrl, "eth_getStorageAt", [USDC_BASE, USDC_IMPL_SLOT, "latest"]);
    bloque = parseInt(await rpc(fetchImpl, rpcUrl, "eth_blockNumber", []), 16);
  } catch (err) {
    return {
      tipo: "usdc",
      problema: null,
      sinDatos: true,
      detalle: `no se pudo leer Base: ${err?.message ?? err}`,
    };
  }
  const impl = `0x${String(slot).slice(-40)}`.toLowerCase();
  if (impl === USDC_IMPL_ESPERADA)
    return { tipo: "usdc", problema: null, detalle: `implementación ${impl}` };
  return {
    tipo: "usdc",
    problema: `el proxy apunta a ${impl}; las pruebas se corrieron contra ${USDC_IMPL_ESPERADA}. Bloque actual: ${bloque}.`,
  };
}

/** Qué hacer con cada resultado, dados los issues abiertos del vigía
 *  (`[{ number, body }]`): abrir uno nuevo, cerrar el que se normalizó, o nada. */
export function decidir(resultados, abiertos) {
  const acciones = [];
  for (const r of resultados) {
    if (r.sinDatos) continue;
    const abierto = abiertos.find((i) => (i.body ?? "").includes(marca(r.tipo)));
    if (r.problema && !abierto)
      acciones.push({ accion: "abrir", tipo: r.tipo, problema: r.problema });
    if (!r.problema && abierto)
      acciones.push({ accion: "cerrar", tipo: r.tipo, numero: abierto.number, detalle: r.detalle });
  }
  return acciones;
}

export function cuerpoIssue(tipo, problema, ahora = new Date()) {
  return [
    marca(tipo),
    `**Detectado:** ${ahora.toISOString()}`,
    "",
    `**Qué vio:** ${problema}`,
    "",
    ...QUE_HACER[tipo],
    "",
    "---",
    "Lo abrió el vigía (`scripts/vigia.mjs`, cada ~10 minutos). Lo cierra solo cuando",
    "esto se normaliza; mientras siga abierto no vuelve a avisar.",
  ].join("\n");
}

export const tituloIssue = (tipo) => TITULOS[tipo];

async function main() {
  const { execFileSync } = await import("node:child_process");
  const dry = process.argv.includes("--dry-run");
  const url = (process.env.ARBITER_URL || "https://arcade1v1.onrender.com").replace(/\/$/, "");
  const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const simular = process.env.VIGIA_SIMULAR || "";
  if (simular && !TITULOS[simular]) throw new Error(`VIGIA_SIMULAR inválido: ${simular}`);

  let lectura = await leerHealth({ url });
  const arbitro = evaluarArbitro(lectura, url);
  let escrow = arbitro.problema
    ? { tipo: "escrow", problema: null, sinDatos: true, detalle: "el árbitro no respondió" }
    : evaluarEscrow(lectura.health);
  if (escrow.reintentar) {
    console.log("escrow sin verificar: miro de nuevo en 90 s (normal recién arrancado)");
    await new Promise((r) => setTimeout(r, 90_000));
    lectura = await leerHealth({ url });
    escrow = lectura.health
      ? evaluarEscrow(lectura.health)
      : { tipo: "escrow", problema: null, sinDatos: true };
    if (escrow.reintentar)
      escrow = {
        tipo: "escrow",
        problema: '/health sigue diciendo escrow: "unverified" después de 90 s',
      };
  }
  const usdc = await evaluarUsdc({ rpcUrl });

  const resultados = [arbitro, escrow, usdc].map((r) =>
    r.tipo === simular
      ? { tipo: r.tipo, problema: `SIMULADO (VIGIA_SIMULAR=${simular}): es una prueba del aviso.` }
      : r,
  );
  for (const r of resultados)
    console.log(
      `${r.tipo}: ${r.problema ? `PROBLEMA — ${r.problema}` : r.sinDatos ? `sin datos — ${r.detalle}` : `ok — ${r.detalle ?? ""}`}`,
    );

  const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" });
  const abiertos = dry
    ? []
    : JSON.parse(
        gh(
          "issue",
          "list",
          "--label",
          ETIQUETA,
          "--state",
          "open",
          "--json",
          "number,body",
          "--limit",
          "50",
        ),
      );
  const acciones = decidir(resultados, abiertos);
  if (dry) {
    for (const a of acciones) console.log(`(dry-run) ${a.accion} ${a.tipo}`);
    return;
  }
  if (acciones.some((a) => a.accion === "abrir"))
    gh(
      "label",
      "create",
      ETIQUETA,
      "--force",
      "--color",
      "B60205",
      "--description",
      "Avisos automáticos del vigía (scripts/vigia.mjs)",
    );
  for (const a of acciones) {
    if (a.accion === "abrir") {
      const out = gh(
        "issue",
        "create",
        "--title",
        tituloIssue(a.tipo),
        "--label",
        ETIQUETA,
        "--body",
        cuerpoIssue(a.tipo, a.problema),
      );
      console.log(`abrí ${out.trim()}`);
    } else {
      gh(
        "issue",
        "close",
        String(a.numero),
        "--comment",
        `Se normalizó (${new Date().toISOString()}): ${a.detalle ?? "ok"}. Lo cierra el vigía.`,
      );
      console.log(`cerré #${a.numero}`);
    }
  }
}

const { pathToFileURL } = await import("node:url");
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
