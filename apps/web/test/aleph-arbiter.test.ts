// La web lee salas de Aleph del árbitro: rutas correctas y vista PÚBLICA.
// Importa: acá nunca se firma un pase de vista (los humanos miran, no juegan),
// así que ninguna URL puede llevar address/signature/ts. Si alguna vez alguien
// agrega eso "para ver más", este test lo agarra.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getAlephLobbies,
  getAlephRoom,
  getAlephLog,
  getRecentAlephRooms,
} from "../app/lib/arbiter";

const realFetch = globalThis.fetch;

/** Responde lo que se le diga y anota las URLs que le pidieron. */
function fakeFetch(body: unknown, status = 200) {
  const urls: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    urls.push(String(url));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return urls;
}

test("lobbies: pide /aleph/lobbies y devuelve la lista", async (t) => {
  const lobby = { roomId: "0xroom", stake: 0, seats: 3, min: 4, max: 8, closesAt: 111 };
  const urls = fakeFetch({ lobbies: [lobby] });
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const out = await getAlephLobbies();

  assert.deepEqual(out, [lobby]);
  assert.ok(urls[0].endsWith("/aleph/lobbies"), urls[0]);
});

test("sala: pide la vista PÚBLICA, sin pase de vista en la URL", async (t) => {
  const urls = fakeFetch({ roomId: "0xroom", status: "playing", seats: [] });
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const room = await getAlephRoom("0xroom");

  assert.equal(room?.status, "playing");
  assert.ok(urls[0].includes("/aleph/0xroom"), urls[0]);
  for (const leak of ["address=", "signature=", "ts="]) {
    assert.ok(!urls[0].includes(leak), `la web no firma pases de vista: ${urls[0]}`);
  }
});

test("sala inexistente: 404 devuelve null, no explota", async (t) => {
  fakeFetch({ error: "room not found" }, 404);
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  assert.equal(await getAlephRoom("0xnope"), null);
});

test("registro: pide /aleph/:id/log", async (t) => {
  const urls = fakeFetch({ roomId: "0xroom", events: [], payouts: {} });
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  await getAlephLog("0xroom");

  assert.ok(urls[0].endsWith("/aleph/0xroom/log"), urls[0]);
});

test("recientes: pide /aleph/recent con el límite y desenvuelve rooms", async (t) => {
  const room = { roomId: "0xroom", stake: 0, seats: ["0xa"], stages: 4 };
  const urls = fakeFetch({ rooms: [room] });
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  const out = await getRecentAlephRooms(7);

  assert.deepEqual(out, [room]);
  assert.ok(urls[0].includes("/aleph/recent?limit=7"), urls[0]);
});
