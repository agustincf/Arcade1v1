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
│   │   ├── tetris/   → Juego: Tetris (asincronico, por puntaje).
│   │   └── flappy/   → Juego: Flappy Bird 1v1 (asincronico, por puntaje).
│   └── contracts/    → El contrato de escrow (Solidity) que custodia el pozo.
```

Para agregar un juego nuevo en el futuro: se crea una carpeta nueva en
`packages/games/` que cumpla el contrato de `game-sdk`, y se registra. El resto
de la plataforma no se toca.

### Regla general de los juegos

Todos los juegos son **asincronicos y por puntaje**: cada jugador juega su
intento cuando quiere (dentro de la ventana de la partida) y **gana el que hace
mas puntos**. Empate o jugador que no juega a tiempo → reembolso.

---

## Mesas de apuesta

Montos fijos: **5, 10, 20, 50 y 100 USDC** (los dos jugadores apuestan lo mismo).
Comision de la plataforma: **10% del pozo** (configurable), enviada
automaticamente a la wallet de la plataforma.

---

## Reglas del dinero (escrow)

1. Los dos jugadores depositan su apuesta en el contrato inteligente.
2. El backend "arbitro" valida quien gano y lo **firma** digitalmente.
3. El contrato **verifica la firma** y paga: premio al ganador + comision a la
   plataforma. Nadie toca el dinero a mano.
4. **Reembolso** total a ambos si la partida se cancela, si falta un jugador, o
   si pasa **1 hora** y un jugador no jugo su intento.

Conexion de billetera: **WalletConnect** (MetaMask en compu + billeteras de
celular por QR), via wagmi + RainbowKit. Se monta en la Fase 4.

---

## Plan por fases

- [x] **Fase 0** — Estructura del proyecto y herramientas.
- [x] **Fase 1** — Pantallas navegables (datos de mentira).
- [ ] **Fase 2** — Tetris (asincronico, por puntaje).
- [ ] **Fase 3** — Flappy 1v1 (asincronico, por puntaje).
- [ ] **Fase 4** — Contrato escrow en testnet + billetera + USDC de prueba.
- [ ] **Fase 5** — Backend arbitro (resultado real → pago en testnet).
- [ ] **Fase 6** — Seguridad, pruebas y checklist pre-dinero-real.
