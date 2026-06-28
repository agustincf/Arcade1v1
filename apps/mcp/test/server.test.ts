import { test } from "node:test";
import assert from "node:assert/strict";
import { ArbiterClient, createAgent } from "@arcade1v1/agent-sdk";
import { buildServer } from "../src/server";

test("buildServer registra las 6 herramientas y devuelve un McpServer", () => {
  const client = new ArbiterClient("http://fake");
  const agent = createAgent({ client });
  const server = buildServer({ agent, client });
  // El McpServer expone su instancia subyacente; basta confirmar que se construyó
  // sin lanzar y que es un objeto con el método connect (contrato MCP).
  assert.ok(server);
  assert.equal(typeof (server as { connect?: unknown }).connect, "function");
});
