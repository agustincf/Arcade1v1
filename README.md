# Arcade1v1

Arcade de apuestas 1v1 sobre la blockchain **Base** usando **USDC** (dolar digital).
Dos personas juegan un juego corto poniendo dinero; el ganador se lleva el pozo
menos una comision de la plataforma.

> ⚠️ **Estado: SOLO TESTNET (Base Sepolia, dinero de prueba).**
> No se usa dinero real hasta completar la revision legal y de seguridad (Fase 6).

---

## Como esta organizado (la "consola y los cartuchos")

La plataforma (consola) es siempre la misma. Cada juego es un "cartucho" que se
enchufa cumpliendo un contrato comun definido en `packages/game-sdk`.

```
Arcade1v1/
├── apps/
│   ├── web/          → El sitio web. Lo que ve y toca el jugador.
│   └── server/       → El backend: emparejamiento, tiempo real y "arbitro".
├── packages/
│   ├── game-sdk/     → Las "reglas de conexion" que TODO juego debe cumplir.
│   ├── games/
│   │   ├── chess/    → Juego: Ajedrez 1v1.
│   │   └── flappy/   → Juego: Flappy Bird 1v1.
│   └── contracts/    → El contrato de escrow (Solidity) que custodia el pozo.
```

Para agregar un juego nuevo en el futuro: se crea una carpeta nueva en
`packages/games/` que cumpla el contrato de `game-sdk`, y se registra. El resto
de la plataforma no se toca.

---

## Mesas de apuesta

Montos fijos: **1, 5, 10 y 20 USDC**.
Comision de la plataforma: **10% del pozo** (configurable), enviada
automaticamente a la wallet de la plataforma.

---

## Reglas del dinero (escrow)

1. Los dos jugadores depositan su apuesta en el contrato inteligente.
2. El backend "arbitro" valida quien gano y lo **firma** digitalmente.
3. El contrato **verifica la firma** y paga: premio al ganador + comision a la
   plataforma. Nadie toca el dinero a mano.
4. Si la partida se cancela o falta un jugador, hay un mecanismo de **reembolso**.

---

## Plan por fases

- [x] **Fase 0** — Estructura del proyecto y herramientas.
- [ ] **Fase 1** — Pantallas navegables (datos de mentira).
- [ ] **Fase 2** — Ajedrez 1v1.
- [ ] **Fase 3** — Flappy 1v1.
- [ ] **Fase 4** — Contrato escrow en testnet + billetera + USDC de prueba.
- [ ] **Fase 5** — Backend arbitro (resultado real → pago en testnet).
- [ ] **Fase 6** — Seguridad, pruebas y checklist pre-dinero-real.
