# Redeploy v3.4.0 — atar al rival on-chain + gracia del reembolso

Esta versión **cambia el contrato** (`Escrow1v1`): `open` y `join` ahora reciben
un "asiento" firmado por el árbitro. El contrato desplegado es inmutable, así que
hay que **desplegar uno nuevo** y apuntar web + servidor a su dirección.

> **Por qué no se puede auto-desplegar como las otras versiones.** El web y el
> servidor nuevos hablan el ABI nuevo (`open`/`join` con `seatSig`). Contra el
> contrato viejo revertirían, y el código viejo contra el contrato nuevo también.
> Por eso el cambio de contrato y el de código tienen que ir **coordinados**.

Es **testnet** (Base Sepolia, dinero de juego), así que una ventana breve de
incompatibilidad durante el switch no arriesga plata real.

---

## Antes de empezar

1. **Que no queden partidas de plata en curso** en el contrato viejo (o dejalas
   liquidar/reembolsar). En testnet, con dinero de juego, el riesgo es nulo.
2. Tener a mano (ya existen en el setup actual):
   - La **clave del deployer** (`PRIVATE_KEY`) — la misma que desplegó el escrow actual.
   - La **address del árbitro** (`ARBITER_ADDRESS`) — la misma de siempre.
   - La **wallet de plataforma** (`PLATFORM_WALLET`) y `FEE_BPS` (1500 = 15%).
   - **Reusar el USDC de prueba existente**: pasar `USDC_ADDRESS` con la dirección
     del TestUSDC actual, así los saldos de prueba de los jugadores siguen valiendo.
   - Acceso a las variables de entorno de **Vercel** (web) y **Render** (árbitro).

---

## Pasos

### 1) Desplegar el nuevo escrow en Base Sepolia

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd packages/contracts

PRIVATE_KEY=<deployer>        \
ARBITER_ADDRESS=<arbiter>     \
PLATFORM_WALLET=<platform>    \
FEE_BPS=1500                  \
USDC_ADDRESS=<TestUSDC actual>  \  # reusar el USDC existente
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast
```

El script imprime la **nueva** `ESCROW_ADDRESS` y ya deja habilitadas las mesas
1/2/5/10 USDC. Anotá esa dirección.

> Alternativa: `bash packages/contracts/deploy-base-sepolia.sh` (mismo efecto,
> lee las variables del entorno/.env).

### 2) Actualizar las variables de entorno (nueva dirección)

- **Vercel (web)**: `NEXT_PUBLIC_ESCROW_ADDRESS` = nueva dirección.
  (`NEXT_PUBLIC_USDC_ADDRESS` no cambia si reusaste el USDC.)
- **Render (árbitro)**: `ESCROW_ADDRESS` = nueva dirección.
  `CHAIN_ID=84532` y `ARBITER_PRIVATE_KEY` no cambian.

### 3) Publicar el código nuevo (web + servidor)

Mergear la rama a `main` y pushear (dispara el auto-deploy):

```bash
git checkout main
git merge --no-ff fix/contract-rival-binding-refund-grace
git push origin main
```

Hacé el paso 2 (env) y el 3 (push) **seguidos**, para acortar la ventana en la
que el código y el contrato podrían no coincidir. El árbitro nuevo NO arranca si
la config está mal formada (guarda de v3.3.1), así que un error de tipeo se ve al
toque en los logs de Render.

### 4) Verificar en Sepolia

- Abrir una mesa de plata, unir a un rival y jugar un duelo completo → cobro OK.
- Probar el reembolso desde `/recover` en una partida sin rival.
- Chequear `/status` (métricas del árbitro) y que el monitor de gas esté verde.

---

## Reversa (si algo sale mal)

- **Revertir el env** a la `ESCROW_ADDRESS` vieja y `git revert` del merge → el
  sistema vuelve al contrato anterior (que sigue funcionando; solo le falta el
  arreglo del asiento/gracia).
- Los fondos del contrato viejo se recuperan siempre por sus caminos normales
  (`refundUnfunded` / `refundExpired` / `cancelMatch`).

---

## Qué se verificó antes de este redeploy

- **14 tests de Foundry** (`forge test`): incluye rechazo de asiento inválido,
  no-reuso del asiento entre partidas, y que dentro de la gracia el `settle`
  tardío le gana al reembolso (anti-griefing).
- **`npm run check`** completo en verde (typecheck ×4 workspaces, lint, formato,
  77 tests del servidor, selftest).
- **E2E on-chain** (`bash packages/contracts/check-payment-e2e.sh`): despliega en
  anvil, empareja por el backend real, deposita con asiento, cobra y reembolsa en
  empate — todo OK.
