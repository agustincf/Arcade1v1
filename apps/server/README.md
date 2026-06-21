# apps/server — El backend "árbitro" (Fase 5)

Servidor de confianza que coordina las partidas y firma los resultados para que
el contrato pague. API por HTTP (los juegos son asincrónicos, no hay tiempo real).

## Qué hace

- **Emparejamiento por orden de llegada:** el 2do jugador en llegar se junta con
  el 1ro (misma mesa/juego).
- **Semilla compartida:** los dos jugadores reciben la misma semilla → juego justo.
- **Decisión + firma:** cuando llegan los dos puntajes, decide el ganador y
  **firma el resultado (EIP-712)** con la llave del árbitro. El contrato verifica
  esa firma al pagar. Empate → reembolso.

## Endpoints

- `GET  /health` → `{ ok: true }`
- `GET  /arbiter` → `{ address }` (debe coincidir con el árbitro del contrato)
- `POST /matchmake` `{ game, stake, address }` → empareja o deja esperando
- `POST /match/:id/score` `{ address, score }` → guarda puntaje; al estar los dos, firma
- `GET  /match/:id` → estado y, si terminó, `{ winner, signature }`

## Correr

```bash
cp .env.example .env          # y completar ARBITER_PRIVATE_KEY (cast wallet new)
npm run start -w @arcade1v1/server     # arranca en http://localhost:4000
npm run selftest -w @arcade1v1/server  # prueba sin red (firma válida, empate, etc.)
```

> Estado: árbitro + emparejamiento + firma funcionando y verificados (selftest OK).
> Pendiente: anti-trampa por "replay" (re-jugar el intento en el servidor) y
> conectar el frontend al árbitro. El despliegue del contrato a testnet queda
> aparte (Fase 4 parte 2).
