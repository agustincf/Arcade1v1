# Fase 7 — Operación pre-mainnet · Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RPC propio y gas del árbitro monitoreado — los dos requisitos operativos del roadmap antes de mainnet. Cierra v3 como **3.0.0**.

**Architecture:** El monitor de gas ya existe (WIP del dueño, revisado y aprobado): `apps/server/src/gas-monitor.ts` chequea el saldo ETH del árbitro cada 5 min contra `RPC_URL` (variable que el server ya exigía en producción vía config-guard), alerta bajo umbral (log + webhook opcional, con cooldown anti-spam) y publica un snapshot seguro en `GET /stats` (campo `gas`). Falta: mostrarlo en `/status` (×4 idiomas), el runbook en `DEPLOY.md`, y la parte operativa junto al dueño (cuenta RPC + env en Render/Vercel + probar la alerta bajando el umbral).

**Tech Stack:** viem (server), Next.js (web), Node test runner.

## Global Constraints

- **El WIP del dueño se commitea tal cual está diseñado** (revisado: alerta con cooldown, sin secretos expuestos, fail-fast coherente con config-guard, testeado). Solo formateo prettier.
- **Honestidad en /status**: el bloque de gas solo aparece cuando el monitor está activo (`gas.enabled`); en testnet sin monitor no se muestra nada sintético.
- **4 idiomas** para todo texto nuevo. **No pushear sin OK.**
- El release **3.0.0** y el cierre del milestone se declaran SOLO tras la verificación operativa en producción (RPC propio activo + alerta probada).

---

### Task 1: Commitear el WIP del gas-monitor (formateado)

- [ ] Prettier sobre `apps/server/src/gas-monitor.ts` y `apps/server/test/gas-monitor.test.ts`.
- [ ] Correr el test: `node --import tsx --test apps/server/test/gas-monitor.test.ts` → PASS.
- [ ] Commit de `gas-monitor.ts`, su test, `apps/server/src/index.ts`, `apps/server/.env.example`, `apps/web/.env.local.example` con mensaje `feat(server): monitor del gas del árbitro (saldo, umbral y alerta)` — autoría del diseño: el dueño.

### Task 2: Gas visible en /status (×4 idiomas)

**Files:** `apps/web/app/lib/arbiter.ts` (tipo `GasView` + campo `gas` en `StatsView`), `apps/web/app/status/StatusClient.tsx` (bloque de gas), `apps/web/app/lib/i18n/{en,es,hi,fr}.ts` (claves nuevas).

- [ ] `StatsView` suma `gas?: GasView` con `{ enabled, address?, balanceEth?, thresholdEth?, low?, checkedAt?, error? }`.
- [ ] En `StatusClient`, tras las tarjetas de métricas, un bloque "Gas del árbitro" **solo si `stats.gas?.enabled`**: saldo en ETH, umbral, estado (OK verde / bajo en rojo), y hora del último chequeo. Si `gas.error`, mostrarlo (honesto).
- [ ] Claves i18n ×4: `status.gas` (título), `status.gasBalance`, `status.gasThreshold`, `status.gasOk`, `status.gasLow`, `status.gasChecked`, `status.gasHint` (una línea de por qué importa: el árbitro paga los reembolsos).
- [ ] Test de completitud i18n sigue verde (`apps/web/test/i18n.test.ts`).

### Task 3: Runbook en DEPLOY.md

- [ ] Sección "Operación: RPC propio y gas del árbitro": crear cuenta gratis (Alchemy/QuickNode), setear `RPC_URL` (Render) y `NEXT_PUBLIC_RPC_URL` (Vercel), variables del monitor (`GAS_ALERT_ETH`, `GAS_ALERT_WEBHOOK_URL`), qué mirar en `/status`, cómo probar la alerta (subir el umbral por encima del saldo, no vaciar la wallet), y cómo recargar gas. En simple.

### Task 4: Chequeo y gate

- [ ] `npm run check` completo (ahora el formato del gas-monitor ya está arreglado → debería quedar todo verde).
- [ ] Verificación local: `GAS_MONITOR_ENABLED=true RPC_URL=<público de sepolia>` → `GET /stats` trae `gas` con saldo real; `/status` lo muestra; con `GAS_ALERT_ETH` altísimo, la alerta se loguea.
- [ ] Mostrar al dueño y pedir OK para push. **El changelog 3.0.0, el tag y el cierre del milestone quedan para DESPUÉS de la parte operativa junto al dueño** (cuenta RPC + env en prod + alerta probada en prod).

### Task 5 (con el dueño): operación en producción

- [ ] Crear cuenta RPC (plan gratis) juntos; pegar `RPC_URL` en Render y `NEXT_PUBLIC_RPC_URL` en Vercel.
- [ ] Verificar `/status` en prod con saldo real del árbitro vía RPC propio.
- [ ] Probar la alerta subiendo el umbral (no vaciando la wallet).
- [ ] Changelog **3.0.0** + marcar Fase 7 + actualizar `docs/ROADMAP.md` (v3 → estado actual) + tag de release en GitHub. v3 cerrada.
