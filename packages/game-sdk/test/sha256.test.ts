// SHA-256 propio del game-sdk (el paquete no tiene dependencias, a propósito).
// Se compara contra los vectores oficiales: si esto no da exacto, el azar de
// Aleph deja de ser reproducible y las partidas no verifican. Correr:
//   node --import tsx --test packages/game-sdk/test/sha256.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256, sha256Hex } from "../src/sha256";

const bytes = (s: string) => new TextEncoder().encode(s);

test("sha256: vectores oficiales (FIPS 180-4)", () => {
  assert.equal(
    sha256Hex(bytes("")),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    sha256Hex(bytes("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(
    sha256Hex(bytes("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  );
});

test("sha256: el caso de los 56 bytes (el relleno se va a un bloque nuevo)", () => {
  // 55 bytes entran justo con su relleno; 56 fuerzan un segundo bloque. Es el
  // borde donde falla toda implementación mal hecha.
  assert.equal(
    sha256Hex(bytes("a".repeat(55))),
    "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318",
  );
  assert.equal(
    sha256Hex(bytes("a".repeat(56))),
    "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
  );
  assert.equal(
    sha256Hex(bytes("a".repeat(64))),
    "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb",
  );
});

test("sha256: mensajes largos (varios bloques)", () => {
  assert.equal(
    sha256Hex(bytes("a".repeat(1000))),
    "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3",
  );
});

test("sha256: devuelve 32 bytes y no toca la entrada", () => {
  const entrada = new Uint8Array([1, 2, 3, 4, 5]);
  const copia = entrada.slice();
  const out = sha256(entrada);
  assert.equal(out.length, 32);
  assert.deepEqual(entrada, copia, "la entrada no se modifica");
});

test("sha256: coincide con node:crypto en 500 entradas al azar de todo largo", async () => {
  // Verificación cruzada contra una implementación de referencia. node:crypto
  // solo se usa acá, en el test: el motor no puede depender de él (no existe en
  // el navegador), pero sí sirve de oráculo.
  const { createHash } = await import("node:crypto");
  for (let i = 0; i < 500; i++) {
    const len = i < 70 ? i : Math.floor(Math.random() * 600);
    const msg = new Uint8Array(len);
    for (let j = 0; j < len; j++) msg[j] = Math.floor(Math.random() * 256);
    const esperado = createHash("sha256").update(msg).digest("hex");
    assert.equal(sha256Hex(msg), esperado, `difiere con ${len} bytes`);
  }
});

test("sha256: un solo bit distinto cambia todo el hash", () => {
  const a = sha256Hex(new Uint8Array([0]));
  const b = sha256Hex(new Uint8Array([1]));
  assert.notEqual(a, b);
  let iguales = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) iguales++;
  assert.ok(iguales < a.length / 2, `hashes demasiado parecidos (${iguales}/${a.length})`);
});
