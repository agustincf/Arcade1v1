// Resúmenes y links para la persona (present.ts): funciones puras, sin red.
// Correr: node --import tsx --test apps/mcp/test/present.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MatchView, AlephRoomView } from "@arcade1v1/agent-sdk";
import { summarizeMatch, summarizeAleph, webUrlFor } from "../src/present";

const WEB = "https://arcade1v1.com";
const base: MatchView = { matchId: "0x1", game: "snake", stake: 0, status: "waiting", scores: {} };

test("webUrlFor: solo el árbitro publicado tiene web conocida; ARCADE_WEB_URL le gana", () => {
  assert.equal(webUrlFor("https://arcade1v1.onrender.com"), WEB);
  assert.equal(webUrlFor("https://arcade1v1.onrender.com/"), WEB);
  assert.equal(webUrlFor("http://localhost:8787"), undefined, "sin links a la web de otro");
  assert.equal(
    webUrlFor("http://localhost:8787", "http://localhost:3000/"),
    "http://localhost:3000",
  );
  assert.equal(webUrlFor("https://arcade1v1.onrender.com", "  "), WEB, "vacía = ausente");
});

test("summarizeMatch: ganada, perdida y empate, con rating y link", () => {
  const won = summarizeMatch(
    { ...base, status: "settled", yourScore: 30, rivalScore: 12, rating: 1216, ratingDelta: 16 },
    WEB,
  );
  assert.match(won, /^You won the snake match 0x1: 30 to 12\. Rating now 1216 \(\+16\)\./);
  assert.match(won, /Watch both runs side by side: https:\/\/arcade1v1\.com\/watch\/0x1$/);

  const lost = summarizeMatch(
    { ...base, status: "settled", yourScore: 5, rivalScore: 9, ratingDelta: -9 },
    WEB,
  );
  assert.match(lost, /You lost/);
  assert.doesNotMatch(lost, /Rating now/, "sin rating no inventa uno");

  assert.match(
    summarizeMatch({ ...base, status: "draw", yourScore: 7, rivalScore: 7 }, WEB),
    /^Draw/,
  );
});

test("summarizeMatch: ganada o perdida porque alguien no presentó a tiempo", () => {
  const won = summarizeMatch(
    {
      ...base,
      status: "settled",
      role: "p1",
      opponent: "0xb",
      noShow: "0xb",
      yourScore: 30,
      rating: 1212,
      ratingDelta: 12,
    },
    WEB,
  );
  assert.match(
    won,
    /^You won the snake match 0x1: your rival did not submit a run in time\. Rating now 1212 \(\+12\)\./,
  );
  const lost = summarizeMatch(
    { ...base, status: "settled", role: "p2", opponent: "0xa", noShow: "0xb", rivalScore: 30 },
    WEB,
  );
  assert.match(lost, /^You lost the snake match 0x1: you did not submit a run in time\./);
});

test("summarizeMatch: la plata solo aparece en una mesa con stake", () => {
  const free = summarizeMatch(
    { ...base, status: "settled", yourScore: 2, rivalScore: 1, netPnl: 0 },
    WEB,
  );
  assert.doesNotMatch(free, /USDC/);
  const paid = summarizeMatch(
    { ...base, stake: 2, status: "settled", yourScore: 2, rivalScore: 1, netPnl: 1.4 },
    WEB,
  );
  assert.match(paid, /Net: \+1\.4 USDC\./);
});

test("summarizeMatch: sin decidir no promete una repetición que todavía no existe", () => {
  const pending = summarizeMatch({ ...base, status: "ready", yourScore: 40 }, WEB);
  assert.match(pending, /Your score in the snake match 0x1: 40\. Waiting for a rival/);
  assert.match(pending, /Once it is decided, both runs can be watched at https:/);
  const rivalIn = summarizeMatch(
    { ...base, status: "ready", yourScore: 40, rivalSubmitted: true },
    WEB,
  );
  assert.match(rivalIn, /rival already played/);
  assert.match(summarizeMatch(base, WEB), /open: waiting for a rival/);
});

test("summarizeMatch: sin web no hay link", () => {
  assert.doesNotMatch(
    summarizeMatch({ ...base, status: "settled", yourScore: 1, rivalScore: 0 }, undefined),
    /http/,
  );
});

test("summarizeMatch: consultada sin dirección, muestra los dos puntajes", () => {
  const out = summarizeMatch(
    {
      ...base,
      status: "settled",
      scores: {
        "0xaaaa00000000000000000000000000000000bbbb": 3,
        "0xcccc00000000000000000000000000000000dddd": 1,
      },
    },
    WEB,
  );
  assert.match(out, /is decided: 0xaaaa…bbbb 3 vs 0xcccc…dddd 1/);
});

const seat = (address: string, status: "alive" | "voted_out" = "alive") => ({
  address,
  status,
  pocket: 0,
});
const room = (extra: Partial<AlephRoomView>): AlephRoomView =>
  ({
    roomId: "0xroom",
    stake: 0,
    status: "lobby",
    rulesV: 2,
    min: 4,
    max: 8,
    createdAt: 0,
    seats: [seat("0xa"), seat("0xb")],
    ...extra,
  }) as AlephRoomView;

test("summarizeAleph: lobby, en juego y terminada, siempre con el link a la escena", () => {
  assert.match(summarizeAleph(room({}), WEB, "0xa"), /lobby, 2\/8 seats \(starts at 4\)/);
  const playing = summarizeAleph(
    room({
      status: "playing",
      pot: 2800,
      seats: [seat("0xa"), seat("0xb"), seat("0xc", "voted_out")],
      stage: { index: 2, kind: "vote", phase: "talk", acted: [] },
    }),
    WEB,
    "0xa",
    41_200,
  );
  assert.match(playing, /stage 3 \(vote, talk, 42 s left\), 2 seats alive, pot 2800\./);
  const over = summarizeAleph(
    room({
      status: "settled",
      payouts: { "0xa": 1310 },
      rating: { before: 1200, after: 1222, delta: 22 },
    }),
    WEB,
    "0xa",
  );
  assert.match(over, /is over\. Your payout: 1310 units .* Rating now 1222 \(\+22\)\./);
  assert.match(over, /https:\/\/arcade1v1\.com\/aleph\/0xroom$/);
  assert.doesNotMatch(summarizeAleph(room({}), undefined, "0xa"), /http/);
});
