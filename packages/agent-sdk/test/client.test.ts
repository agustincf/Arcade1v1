import { test } from "node:test";
import assert from "node:assert/strict";
import { ArbiterClient } from "../src/client.ts";

function fakeFetch(captured: { url?: string; init?: RequestInit }, body: unknown) {
  return (async (url: string, init?: RequestInit) => {
    captured.url = String(url);
    captured.init = init;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

/** node:test cancela un test cuyo `await` sigue pendiente en cuanto el event
 *  loop se queda sin trabajo REF-eado: "Promise resolution is still pending but
 *  the event loop has already resolved". Los tests de abajo esperan justamente
 *  eso —un abort— y el abort nace de `AbortSignal.timeout`, cuyo timer interno
 *  va SIN ref: para node no cuenta como trabajo pendiente. Como el fetch falso
 *  tampoco abre ningún socket, apenas el test se pone a esperar no queda NADA
 *  ref-eado, node drena el loop antes de que el tope dispare y los tests salen
 *  `cancelledByParent`. Pasa en node 22 (el que corre CI) y no en node 24, así
 *  que sin este andamio el rojo aparece solo en CI.
 *
 *  El cliente está bien: en producción el fetch real deja un socket ref-eado
 *  esperando la respuesta del árbitro, y ese socket sostiene el loop hasta que
 *  el tope corta. Lo que falta es solo en el test, que no tiene socket.
 *
 *  Por eso `withRefdEventLoop` sostiene el loop con un timer PROPIO (ref-eado)
 *  mientras corre el cuerpo, y lo apaga en `finally` para que el proceso no
 *  quede colgado ni siquiera si una aserción falla en el medio. */
async function withRefdEventLoop<T>(body: () => Promise<T>): Promise<T> {
  const keepAlive = setInterval(() => {}, 1_000);
  try {
    return await body();
  } finally {
    clearInterval(keepAlive);
  }
}

test("matchmake hace POST /matchmake con el body correcto", async () => {
  const cap: { url?: string; init?: RequestInit } = {};
  const client = new ArbiterClient("http://arbiter.test", {
    fetchImpl: fakeFetch(cap, {
      matchId: "0xabc",
      game: "2048",
      stake: 5,
      seed: 42,
      status: "waiting",
      scores: {},
    }),
  });
  const m = await client.matchmake("2048", 5, "0xPLAYER");
  assert.equal(cap.url, "http://arbiter.test/matchmake");
  assert.equal(cap.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(cap.init?.body)), {
    game: "2048",
    stake: 5,
    address: "0xPLAYER",
  });
  assert.equal(m.matchId, "0xabc");
  assert.equal(m.seed, 42);
});

test("leaderboard hace GET y devuelve el top", async () => {
  const cap: { url?: string; init?: RequestInit } = {};
  const client = new ArbiterClient("http://arbiter.test", {
    fetchImpl: fakeFetch(cap, { game: "2048", top: [{ address: "0x1", rating: 1200 }] }),
  });
  const top = await client.leaderboard("2048", 10);
  assert.equal(cap.url, "http://arbiter.test/leaderboard/2048?limit=10");
  assert.deepEqual(top, [{ address: "0x1", rating: 1200 }]);
});

test("un pedido colgado se corta por el tope de tiempo, con la ruta en el mensaje", async () => {
  // Un fetch que NUNCA responde, como el árbitro cuando su host gratuito se
  // duerme o se reinicia en medio de un deploy: solo termina si el cliente
  // manda un signal. Sin tope, este await bloquea al agente por minutos —
  // fases enteras de Aleph— sin que ningún contador de sondeos se entere.
  const hanging = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason));
    })) as typeof fetch;
  const client = new ArbiterClient("http://arbiter.test", { fetchImpl: hanging, timeoutMs: 20 });
  await withRefdEventLoop(async () => {
    await assert.rejects(
      () => client.rating("0x" + "1".repeat(40)),
      /arbiter rating\/0x1+ timeout after 20ms/,
    );
    // El pase de vista viaja en el query string de esta ruta: el mensaje del
    // timeout nombra la ruta, nunca el query (misma regla que el error del GET).
    const room = "0x" + "ab".repeat(32);
    await assert.rejects(
      () =>
        client.alephView(room, { address: "0x" + "2".repeat(40), signature: "0xSECRET", ts: 1 }),
      (e: Error) => {
        assert.match(e.message, new RegExp(`arbiter /aleph/${room} timeout after 20ms`));
        assert.ok(!/0xSECRET/.test(e.message), "el pase no se filtra en el error");
        return true;
      },
    );
  });
});

test("con timeoutMs 0 el cliente no pone signal (tope a cargo de quien lo llame)", async () => {
  const cap: { url?: string; init?: RequestInit } = {};
  const client = new ArbiterClient("http://arbiter.test", {
    fetchImpl: fakeFetch(cap, { ratings: { "2048": 1200 } }),
    timeoutMs: 0,
  });
  await client.rating("0xPLAYER");
  assert.equal(cap.init?.signal, undefined);
});

test("el primer pedido espera el arranque en frío; ya despierto, el sondeo vuelve al tope corto", async () => {
  // El árbitro vive en un host gratuito que se duerme: el primer pedido puede
  // tener que despertarlo (arranque en frío medido: 42,4 s). Con el tope de
  // régimen ese pedido falla SIEMPRE, que es el bug que registra el CHANGELOG
  // 3.6.0. Pero el tope largo no puede quedarse: el sondeo de una sala de Aleph
  // corre cada 5 s y un GET colgado ahí se come fases enteras del reloj.
  let calls = 0;
  const awakeThenHanging = ((_url: string, init?: RequestInit) => {
    calls += 1;
    if (calls === 1) return Promise.resolve(new Response("{}", { status: 200 }));
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason));
    });
  }) as typeof fetch;
  const hanging = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason));
    })) as typeof fetch;

  // Dormido de punta a punta: el error nombra el tope largo, no el corto.
  const cold = new ArbiterClient("http://arbiter.test", {
    fetchImpl: hanging,
    timeoutMs: 10,
    coldStartTimeoutMs: 60,
  });
  // Con una respuesta de por medio, el host está despierto y manda el corto.
  const warm = new ArbiterClient("http://arbiter.test", {
    fetchImpl: awakeThenHanging,
    timeoutMs: 10,
    coldStartTimeoutMs: 60,
  });
  await withRefdEventLoop(async () => {
    await assert.rejects(() => cold.alephLobbies(), /\/aleph\/lobbies timeout after 60ms/);
    await warm.alephLobbies();
    await assert.rejects(() => warm.alephLobbies(), /\/aleph\/lobbies timeout after 10ms/);
  });
});

test("el tope del SDK no pisa el signal que ya traiga quien llama", async () => {
  // Pisarlo en silencio es exactamente lo que rompió a la web: su fetch
  // inyectado ponía 75 s SOLO si el init venía sin signal, y el SDK se lo
  // ponía siempre. Los dos topes tienen que convivir: el de acá acota, el del
  // llamador sigue pudiendo cancelar.
  const client = new ArbiterClient("http://arbiter.test", { timeoutMs: 60_000 });
  const mine = new AbortController();
  const merged = (client as unknown as { init(init: RequestInit): RequestInit }).init({
    signal: mine.signal,
  }).signal as AbortSignal;
  assert.equal(merged.aborted, false);
  mine.abort(new Error("lo canceló quien llama"));
  assert.equal(merged.aborted, true);
});
