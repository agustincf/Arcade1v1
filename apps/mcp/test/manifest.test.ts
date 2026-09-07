// El manifiesto del registry MCP (apps/mcp/server.json) se valida recién al
// publicarlo con `mcp-publisher`, y para entonces el paquete npm ya salió: un
// rechazo ahí obliga a quemar una versión sólo para corregir una línea de
// texto. Estos chequeos son los del schema que el propio archivo declara en
// `$schema` (ServerDetail de https://static.modelcontextprotocol.io/schemas/,
// donde `description` tiene minLength 1 y maxLength 100), pero offline: el CI
// no sale a internet.
// Correr: node --import tsx --test apps/mcp/test/manifest.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));

const manifest = read("../server.json") as {
  $schema: string;
  name: string;
  description: string;
  version: string;
  packages: { registryType: string; identifier: string; version: string }[];
};
const pkg = read("../package.json") as { name: string; version: string; mcpName: string };

/** El schema cuenta caracteres (code points), no bytes: un guion largo pesa
 *  uno. Se mide igual con el spread para no depender de los pares subrogados. */
const DESCRIPTION_MAX = 100;

test("server.json: la descripción entra en el tope del schema del registry", () => {
  const len = [...manifest.description].length;
  assert.ok(len >= 1, "el schema exige una descripción no vacía");
  assert.ok(
    len <= DESCRIPTION_MAX,
    `la descripción mide ${len} caracteres y el registry rechaza más de ${DESCRIPTION_MAX}: ${manifest.description}`,
  );
});

test("server.json: no queda el nombre viejo del formato y sí el visible", () => {
  assert.match(manifest.description, /Aleph/);
});

test("server.json: nombre y versiones acompañan al paquete npm", () => {
  assert.equal(manifest.name, pkg.mcpName, "el registry ata el manifiesto al `mcpName` del npm");
  assert.equal(manifest.version, pkg.version);
  const npm = manifest.packages.find((p) => p.registryType === "npm");
  assert.ok(npm, "el manifiesto publica el paquete npm");
  assert.equal(npm.identifier, pkg.name);
  assert.equal(npm.version, pkg.version, "publicar el manifiesto apuntando a otra versión rebota");
});
