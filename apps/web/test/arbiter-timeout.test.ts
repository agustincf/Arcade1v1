// El tope de tiempo con el que la web le habla al árbitro.
//
// El árbitro corre en un host gratuito que se DUERME por inactividad: el
// arranque en frío medido es 42,4 s (CHANGELOG 3.6.0, donde el keep-alive
// fallaba 96 de cada 100 corridas justamente por un tope más corto que ese
// arranque). Si el tope efectivo de la web baja de eso, el visitante que entra
// a una mesa con el árbitro dormido ve un error en vez de esperar a que
// despierte: la mesa se ve rota aunque el backend esté sano.
//
// Ningún otro test lo agarra porque todos inyectan un fetch falso que responde
// al instante. Acá el fetch falso NO mira el cuerpo: mira el `signal` que
// recibe, que es donde vive el tope real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getMatch, matchmake } from "../app/lib/arbiter";

/** Cuánto margen exigimos: el que la web tenía antes de la regresión. */
const MIN_MS = 75_000;

// `AbortSignal.timeout(ms)` no expone su ms, así que lo espiamos: envolvemos la
// fábrica y anotamos con cuántos ms nació cada signal.
const budgets = new WeakMap<AbortSignal, number>();
const realTimeout = AbortSignal.timeout;
AbortSignal.timeout = ((ms: number) => {
  const signal = realTimeout.call(AbortSignal, ms);
  budgets.set(signal, ms);
  return signal;
}) as typeof AbortSignal.timeout;

const realFetch = globalThis.fetch;

test("los pedidos de la web al árbitro esperan el arranque en frío del host dormido", async (t) => {
  const seen: number[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const signal = init?.signal;
    assert.ok(signal, "todo pedido viaja con un tope de tiempo (nada queda colgado)");
    const ms = budgets.get(signal);
    assert.ok(ms !== undefined, "el tope sale de AbortSignal.timeout");
    seen.push(ms);
    return new Response(JSON.stringify({ matchId: "0xabc", scores: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
    AbortSignal.timeout = realTimeout;
  });

  // El primero es el que paga el arranque en frío…
  await matchmake("2048", 0, "0x" + "1".repeat(40));
  // …pero la pestaña puede quedar abierta y el árbitro volver a dormirse, así
  // que los siguientes tampoco pueden bajar del margen.
  await getMatch("0xabc");

  assert.equal(seen.length, 2);
  for (const ms of seen) {
    assert.ok(ms >= MIN_MS, `el tope efectivo fue ${ms}ms, menos que los ${MIN_MS}ms necesarios`);
  }
});
