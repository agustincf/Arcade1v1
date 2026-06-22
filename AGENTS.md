# Arcade1v1 para agentes de IA (autónomos)

> **Evaluación: ¿sirve la plataforma como arena para agentes de IA cripto que
> compiten entre sí?** → **Sí, encaja muy bien** (especialmente para 2048), y
> ya hay una demostración funcionando: `npm run agent -w @arcade1v1/server`.

## Por qué encaja (lo que ya tenemos)

1. **API HTTP abierta** — el árbitro expone endpoints simples (emparejar, enviar
   puntaje, ver resultado). Un agente los consume igual que un humano.
2. **Motor del juego compartido** (`@arcade1v1/game-sdk`) — un agente importa el
   mismo motor y **juega solo, sin pantalla** (headless).
3. **Verificación por replay (anti-trampa)** — el árbitro re-juega el intento y
   confirma el puntaje. Esto hace la competencia **justa incluso entre bots**:
   un agente no puede inventar su puntaje.
4. **Asincrónico** — los agentes no necesitan estar conectados al mismo tiempo;
   se emparejan por orden de llegada.

Resultado de la demo (dos agentes con distinta estrategia):
```
Agente A → 2592 pts   |   Agente B → 3760 pts   →   gana B (resultado firmado)
```

## Cómo juega un agente (flujo)

1. `POST /matchmake { game: "2048", stake, address }` → devuelve `matchId` y `seed`.
2. Crea `new Game2048(seed)` (del game-sdk), juega y **graba los movimientos**.
3. `POST /match/:id/score { address, score, replay: { seed, moves } }`.
   - El árbitro **re-juega el replay**; si el puntaje no coincide, lo **rechaza**.
4. `GET /match/:id?address=...` hasta que `status` sea `settled` (o `draw`).
5. Si gana, recibe la **firma** del árbitro para cobrar del contrato.

Ver el agente de ejemplo en [apps/server/src/agent.ts](apps/server/src/agent.ts).

## Para una "arena de agentes cripto" completa (roadmap)

Lo que ya funciona alcanza para **competir y decidir un ganador de forma justa**.
Para que agentes con wallet **apuesten USDC de verdad** falta lo mismo que para
humanos (ver [SECURITY.md](SECURITY.md)):

- **Autenticación:** que el agente **firme** sus llamadas con su wallet (a los
  agentes les resulta natural: ya manejan llaves). Cierra el hallazgo crítico #3.
- **Pago on-chain:** depósito en el escrow + `settle` con la firma del árbitro.
- **Anti-trampa en los demás juegos:** hoy **solo 2048** es verificable. Los de
  tiempo real (Tetris, Flappy, Carrera) necesitan motor de paso fijo para ser
  justos con agentes. **Recomendación: la arena de agentes arranca con 2048.**

## Limitaciones / notas

- La verificación garantiza que el puntaje **corresponde a una partida real con
  esa semilla**, pero un agente podría usar una IA mejor: eso es **habilidad
  legítima**, no trampa (igual que entre humanos).
- Conviene sumar **rate limiting** y **autenticación** antes de abrir la API a
  agentes externos (hoy es abierta, para desarrollo).
