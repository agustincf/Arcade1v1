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
- `POST /matchmake` `{ game, stake, address, signature?, ts? }` → empareja o deja
  esperando (en producción la firma es obligatoria: `matchmakeAuthMessage`)
- `POST /match/:id/score` `{ address, score, replay, signature }` → verifica el
  replay y guarda el puntaje; al estar los dos, decide y firma
- `GET  /match/:id?address=` → estado (tu puntaje solamente hasta que se decida)
  y, si terminó, `{ winner, signature, feedback rico }`

## Correr

```bash
cp .env.example .env          # y completar ARBITER_PRIVATE_KEY (cast wallet new)
npm run start -w @arcade1v1/server     # arranca en http://localhost:4000
npm run selftest -w @arcade1v1/server  # prueba sin red (firma válida, empate, etc.)
```

> Estado: árbitro completo y verificado (selftest OK): emparejamiento firmado,
> anti-trampa por replay en los 6 juegos (semilla forzada, un intento, ventana
> de envío, puntaje del rival oculto hasta decidir), mesas permitidas, firma
> EIP-712 y reembolso on-chain automático de empates y partidas vencidas.
