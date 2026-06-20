# apps/server — El backend y "arbitro"

El cerebro que vive en un servidor de confianza:

- **Emparejamiento (matchmaking):** junta a dos jugadores en la misma mesa.
- **Tiempo real:** sincroniza las partidas (jugadas, marcador) al instante.
- **Autoridad del juego:** corre la logica de cada juego (del `game-sdk`) para
  validar jugadas y evitar trampas.
- **Arbitro:** cuando termina la partida, **firma** digitalmente el resultado
  para que el contrato escrow pague al ganador.

> Vacio por ahora. Se construye entre la **Fase 2** y la **Fase 5**.
> Tecnologia prevista: Node.js + WebSockets (tiempo real).
