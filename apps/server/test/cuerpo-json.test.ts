// El lector de cuerpos del árbitro frente a pedidos comprimidos.
//
// Un pedido con `Content-Encoding: gzip` y bytes de sobra después del cuerpo
// tiraba el proceso entero (body-parser < 2.4.0, GHSA-27r3-jxmh-p828): sin
// firma, sin ruta válida, un solo pedido. El árbitro no necesita cuerpos
// comprimidos (ningún cliente los manda), así que directamente no los
// descomprime: eso cierra esta falla y cualquier otra del descompresor.
//
// Correr: node --import tsx --test apps/server/test/cuerpo-json.test.ts

import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { cuerpoJson } from "../src/cuerpo-json.js";

const app = express();
app.set("env", "test"); // que Express no imprima el stack de cada rechazo esperado
app.use(cuerpoJson());
app.post("/eco", (req, res) => {
  res.json({ recibido: req.body });
});
const server = app.listen(0);
const PUERTO = (server.address() as AddressInfo).port;
after(() => server.close());

/** Manda el cuerpo crudo, en los pedazos dados (un `write` por pedazo, con una
 *  pausa entre uno y otro), y devuelve el código de la respuesta. */
function enviar(pedazos: Buffer[], cabeceras: Record<string, string>): Promise<number> {
  return new Promise((ok, mal) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PUERTO,
        method: "POST",
        path: "/eco",
        headers: { "Content-Type": "application/json", ...cabeceras },
      },
      (res) => {
        res.resume();
        res.on("end", () => ok(res.statusCode ?? 0));
      },
    );
    req.on("error", mal);
    void (async () => {
      for (const p of pedazos) {
        req.write(p);
        await new Promise((r) => setTimeout(r, 30));
      }
      req.end();
    })();
  });
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

// El ataque, tal como se reprodujo contra body-parser 2.3.0: un cuerpo gzip
// válido con ceros de relleno (el descompresor lo da por terminado y el árbitro
// contesta), y después más bytes en otro pedazo, que le llegan a un
// descompresor que ya terminó y al que nadie escucha. Ese error no lo atrapaba
// nadie: con Node, eso es el proceso caído.
test("un cuerpo gzip con relleno y bytes de sobra no tira el proceso", async () => {
  const caidas: unknown[] = [];
  const anotar = (e: unknown) => caidas.push(e);
  process.on("uncaughtException", anotar);
  try {
    const cuerpo = Buffer.concat([gzipSync(JSON.stringify({ a: 1 })), Buffer.alloc(4)]);
    await enviar([cuerpo, Buffer.from("bytes de sobra")], { "Content-Encoding": "gzip" });
    // El error llegaba DESPUÉS de la respuesta.
    await pausa(300);
    assert.deepEqual(caidas, []);
  } finally {
    process.off("uncaughtException", anotar);
  }
});

const COMPRESORES: Record<string, (texto: string) => Buffer> = {
  gzip: gzipSync,
  deflate: deflateSync,
  br: brotliCompressSync,
};

for (const [codificacion, comprimir] of Object.entries(COMPRESORES)) {
  test(`un cuerpo ${codificacion} se rechaza con 415, sin descomprimirlo`, async () => {
    const comprimido = comprimir(JSON.stringify({ a: 1 }));
    const estado = await enviar([comprimido], { "Content-Encoding": codificacion });
    assert.equal(estado, 415);
  });
}

test("un JSON sin comprimir entra como siempre", async () => {
  const r = await fetch(`http://127.0.0.1:${PUERTO}/eco`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score: 42, replay: { ticks: 0 } }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { recibido: { score: 42, replay: { ticks: 0 } } });
});

test("un cuerpo más grande que el tope se rechaza con 413", async () => {
  const r = await fetch(`http://127.0.0.1:${PUERTO}/eco`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relleno: "x".repeat(300 * 1024) }),
  });
  assert.equal(r.status, 413);
});
