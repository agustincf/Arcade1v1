// LA VERSIÓN DESPLEGADA (version.ts): el commit que Render pasa en cada deploy.
// Correr: node --import tsx --test apps/server/test/version.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { deployedCommit } from "../src/version.js";

test("devuelve los 7 caracteres que muestra GitHub", () => {
  const env = { RENDER_GIT_COMMIT: "00C703C1f2e3d4c5b6a79881726354a5b6c7d8e9" };
  assert.equal(deployedCommit(env), "00c703c");
});

test("sin RENDER_GIT_COMMIT (dev, tests) o con algo que no es un commit: null", () => {
  assert.equal(deployedCommit({}), null);
  assert.equal(deployedCommit({ RENDER_GIT_COMMIT: "" }), null);
  assert.equal(deployedCommit({ RENDER_GIT_COMMIT: "main" }), null);
  assert.equal(deployedCommit({ RENDER_GIT_COMMIT: "<script>" }), null);
});
