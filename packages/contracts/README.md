# contracts — Contrato de escrow (Solidity, para Base)

Contrato `Escrow1v1` que custodia el pozo y paga solo segun las reglas. Hecho
con **Foundry** y piezas de seguridad de **OpenZeppelin**.

## Que hace

- `createMatch` — el arbitro crea la partida (dos jugadores + mesa + plazos).
- `deposit` — cada jugador deposita su apuesta en USDC (igual monto los dos).
- `settle` — con la **firma del arbitro** (verificada por el contrato), paga
  premio al ganador + comision a la wallet de la plataforma.
- `refundUnfunded` — si no se lleno a tiempo, cada uno recupera su deposito.
- `refundExpired` — si paso el plazo de juego sin resultado (ej: el rival no
  jugo en 1 hora), se devuelve todo a ambos.
- `cancelMatch` — el arbitro/dueño cancela (empate o disputa) y reembolsa.

Nadie puede sacar el dinero de los jugadores a mano: solo se mueve por estas
reglas. La comision tiene un tope duro de 20%.

## Correr las pruebas (local, sin gastar nada)

```bash
cd packages/contracts
forge test -vv
```

## Desplegar en Base Sepolia (testnet)

1. Copiar `.env.example` a `.env` y completar los valores.
2. Ejecutar:

```bash
cd packages/contracts
source .env
forge script script/Deploy.s.sol --rpc-url "$BASE_SEPOLIA_RPC_URL" --broadcast
```

> Estado: contrato escrito y probado (8/8 pruebas OK). Despliegue a testnet:
> pendiente (Parte 2 de la Fase 4).
