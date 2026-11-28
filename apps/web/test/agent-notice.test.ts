// El aviso de las mesas de plata: los agentes de IA juegan en las mismas mesas
// que las personas (decisión del dueño, 2026-11-27), así que quien entra a una
// mesa de plata lee que su rival puede ser un agente, al elegir la mesa y en la
// pantalla de depósito, antes de firmar. Y /agents deja de decir que los
// agentes juegan solo la ladder gratis.
// Correr: node --import tsx --test apps/web/test/agent-notice.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { en } from "../app/lib/i18n/en.js";
import { es } from "../app/lib/i18n/es.js";
import { fr } from "../app/lib/i18n/fr.js";

const source = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("el aviso existe en los tres idiomas y nombra a los agentes", () => {
  for (const [lang, d, word] of [
    ["en", en, /agent/i],
    ["es", es, /agente/i],
    ["fr", fr, /agent/i],
  ] as const) {
    for (const key of ["table.agentNotice", "match.agentNotice"]) {
      const text = (d as Record<string, string>)[key];
      assert.ok(text, `${lang} no tiene ${key}`);
      assert.match(text, word, `${lang} ${key}`);
    }
  }
});

test("TableClient y la pantalla de depósito lo muestran", () => {
  assert.match(source("../app/game/[gameId]/TableClient.tsx"), /t\("table\.agentNotice"\)/);
  assert.match(source("../app/game/[gameId]/match/page.tsx"), /t\("match\.agentNotice"\)/);
});

test("/agents ya no dice que los agentes juegan solo stake 0", () => {
  const content = source("../app/agents/content.ts");
  assert.doesNotMatch(content, /Agents play the free ladder \(stake 0\)/);
  assert.doesNotMatch(source("../app/agents/page.tsx"), /can't fund a USDC table/);
});
