#!/usr/bin/env node
// Pruebas de MUTACIÓN de Escrow1v1: ¿los tests detectan un bug de verdad?
//
// Una suite en verde no prueba nada si no fallaría ante un bug. Este script
// planta un bug por vez en src/Escrow1v1.sol (cada "mutante" es un cambio
// chico y realista: sacar un chequeo, cambiar un <= por <, pagarle al que no
// es), corre la suite entera salvo las pruebas contra la red
// (`forge test --no-match-path 'test/fork/*'`: unitarias, pre-auditoría e
// invariantes) y anota si la detectó. Todos tienen que quedar detectados.
//
// Siempre restaura el contrato original (el contenido leído al arrancar, no
// git), aunque algo falle o se corte con Ctrl+C.
//
// Uso:  node packages/contracts/mutantes.mjs   (tarda ~10 min)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const DIR = dirname(fileURLToPath(import.meta.url));
const SRC = join(DIR, "src/Escrow1v1.sol");
const ORIGINAL = readFileSync(SRC, "utf8");

// [nombre, texto original, texto mutado]. El original tiene que aparecer UNA vez.
const MUTANTES = [
  // --- pagos y comisión ---
  [
    "settle se olvida de la comisión",
    "uint256 fee = (pot * m.frozenFeeBps) / BPS;",
    "uint256 fee = 0;",
  ],
  [
    "settle cobra la comisión vigente y no la congelada",
    "uint256 fee = (pot * m.frozenFeeBps) / BPS;",
    "uint256 fee = (pot * feeBps) / BPS;",
  ],
  ["open no congela la comisión", "        m.frozenFeeBps = feeBps;\n", ""],
  [
    "_pay sin el chequeo del presupuesto de gas",
    'require(gasleft() >= (PAY_GAS * 64) / 63 + 5_000, "insufficient gas");',
    "",
  ],
  [
    "_pay con un margen corto (2_000)",
    "(PAY_GAS * 64) / 63 + 5_000",
    "(PAY_GAS * 64) / 63 + 2_000",
  ],
  [
    "_pay le da al token todo el gas (sin presupuesto)",
    "success := call(g, token, 0, 0x00, 0x44, 0x00, 0x20)",
    "success := call(gas(), token, 0, 0x00, 0x44, 0x00, 0x20)",
  ],
  [
    "_tryTransfer copia la respuesta entera (return bomb)",
    "success := call(g, token, 0, 0x00, 0x44, 0x00, 0x20)",
    "success := call(g, token, 0, 0x00, 0x44, 0x00, 0x20)\n            returndatacopy(fmp, 0x00, returndatasize())",
  ],
  [
    "_pay acredita siempre, sin intentar pagar",
    "if (_tryTransfer(to, amount)) return;",
    "if (false && _tryTransfer(to, amount)) return;",
  ],
  [
    "el reembolso de p2 va a p1",
    "if (m.p2Paid) _pay(id, m.p2, m.stake);",
    "if (m.p2Paid) _pay(id, m.p1, m.stake);",
  ],
  ["withdraw no pone el crédito en cero", "        owed[account] = 0;\n", ""],
  [
    "withdrawFor le paga a quien llama",
    "    function withdrawFor(address account) external nonReentrant {\n        _withdraw(account);",
    "    function withdrawFor(address account) external nonReentrant {\n        _withdraw(msg.sender);",
  ],
  // --- plazos ---
  [
    "refundExpired sin la gracia",
    "block.timestamp > uint256(m.playDeadline) + REFUND_GRACE,",
    "block.timestamp > uint256(m.playDeadline),",
  ],
  ["settle ignora el vencimiento", 'require(block.timestamp <= deadline, "result expired");', ""],
  [
    "settle sin tope al vencimiento del resultado",
    'uint256(deadline) <= uint256(m.playDeadline) + REFUND_GRACE,\n            "deadline too late"',
    'true,\n            "deadline too late"',
  ],
  [
    "el tope del vencimiento con < en vez de <=",
    "uint256(deadline) <= uint256(m.playDeadline) + REFUND_GRACE,",
    "uint256(deadline) < uint256(m.playDeadline) + REFUND_GRACE,",
  ],
  [
    "open sin tope de duración",
    'uint256(playDeadline) <= block.timestamp + MAX_MATCH_DURATION,\n            "deadlines too far"',
    'true,\n            "deadlines too far"',
  ],
  [
    "refundUnfunded en el mismo segundo que join (>=)",
    'require(block.timestamp > m.fundDeadline, "not expired");',
    'require(block.timestamp >= m.fundDeadline, "not expired");',
  ],
  // --- estados y firmas ---
  [
    "settle le paga a cualquiera (sin chequear ganador)",
    'require(winner == m.p1 || winner == m.p2, "bad winner");',
    "",
  ],
  [
    "join ignora la mesa cerrada",
    '        require(allowedStake[m.stake], "stake not allowed");',
    "",
  ],
  ["open no chequea si la partida existe", 'require(m.status == Status.None, "match exists");', ""],
  [
    "el asiento no firma el stake",
    "                        player,\n                        stake,",
    "                        player,\n                        uint256(0),",
  ],
  ["join deja entrar al mismo jugador", 'require(msg.sender != m.p1, "same player");', ""],
  ["settle no marca la partida como liquidada", "        m.status = Status.Settled;\n", ""],
  [
    "refundExpired acepta partidas abiertas",
    'require(m.status == Status.Funded, "not funded");\n        // Recien tras',
    'require(m.status == Status.Funded || m.status == Status.Open, "not funded");\n        // Recien tras',
  ],
  // --- administración ---
  [
    "cualquiera cancela",
    'require(msg.sender == arbiter || msg.sender == owner(), "not allowed");',
    "",
  ],
  ["setArbiter no cambia el árbitro", "        arbiter = a;\n", ""],
  [
    "setFeeBps sin tope",
    '        require(f <= MAX_FEE_BPS, "fee too high");\n        feeBps = f;',
    "        feeBps = f;",
  ],
  [
    "setPlatformWallet sin dueño",
    "function setPlatformWallet(address w) external onlyOwner {",
    "function setPlatformWallet(address w) external {",
  ],
  [
    "setPlatformWallet acepta el escrow o el token",
    '        require(w != address(this) && w != address(usdc), "bad wallet");\n',
    "",
  ],
  ["setAllowedStake acepta una mesa de 0", '        require(amount > 0, "zero stake");\n', ""],
];

const env = { ...process.env, PATH: `${join(homedir(), ".foundry/bin")}:${process.env.PATH}` };

/** "detectado" si la suite de invariantes falla con el mutante puesto. */
function correr() {
  try {
    execFileSync("forge", ["test", "--no-match-path", "test/fork/*"], {
      cwd: DIR,
      env,
      stdio: "pipe",
    });
    return "SOBREVIVE";
  } catch (e) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    return out.includes("Compiler run failed") ? "NO COMPILA" : "detectado";
  }
}

function restaurar() {
  writeFileSync(SRC, ORIGINAL);
}
process.on("SIGINT", () => {
  restaurar();
  process.exit(130);
});

let detectados = 0;
try {
  for (const [nombre, viejo, nuevo] of MUTANTES) {
    const veces = ORIGINAL.split(viejo).length - 1;
    if (veces !== 1) {
      console.log(`??          ${nombre}: el texto a mutar aparece ${veces} veces`);
      continue;
    }
    writeFileSync(SRC, ORIGINAL.replace(viejo, nuevo));
    const r = correr();
    if (r === "detectado") detectados++;
    console.log(`${r.padEnd(11)} ${nombre}`);
  }
} finally {
  restaurar();
}
console.log(`\n${detectados}/${MUTANTES.length} detectados`);
process.exit(detectados === MUTANTES.length ? 0 : 1);
