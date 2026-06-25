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
│   ├── web/          → El sitio web. Lo que ve y toca el jugador
│   │                   (la UI de cada juego vive en app/games/).
│   └── server/       → El backend: emparejamiento, tiempo real y "arbitro".
├── packages/
│   ├── game-sdk/     → Reglas comunes + la LOGICA de cada juego: un modulo por
│   │                   juego (2048, tetris, flappy, racing, snake, invaders),
│   │                   determinista para poder re-jugar el replay y verificar
│   │                   el puntaje (anti-trampa).
│   └── contracts/    → El contrato de escrow (Solidity) que custodia el pozo.
```

Para agregar un juego nuevo: se suma su logica determinista como un modulo en
`packages/game-sdk/src/<juego>.ts` (con su verificador de replay) y su pantalla
en `apps/web/app/games/<juego>/`, y se registra. El resto de la plataforma
(emparejamiento, escrow, pagos) no se toca.

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
- [x] **Fase 1** — Pantallas navegables.
- [x] **Fase 2** — Tetris (asincronico, por puntaje).
- [x] **Fase 3** — Flappy 1v1 (asincronico, por puntaje). + Carrera + 2048.
- [~] **Fase 4** — Contrato escrow (escrito + probado 8/8) + billetera. Falta
  desplegar a testnet y conectar deposito/pago real con USDC.
- [~] **Fase 5** — Backend arbitro (emparejamiento + semilla + firma, OK). Falta
  anti-trampa por replay y conectar el pago on-chain.
- [x] **Fase 6** — Repaso de seguridad y checklist pre-dinero-real → ver
  [SECURITY.md](SECURITY.md).

## Estado actual

Frontend completo (4 juegos, modo libre, multi-idioma, SEO). Contrato y backend
arbitro construidos y verificados. **No opera con dinero real:** ver los puntos
criticos en [SECURITY.md](SECURITY.md) antes de activarlo.
