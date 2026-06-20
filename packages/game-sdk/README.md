# game-sdk

Define el **contrato comun** que todo juego del arcade debe cumplir para
"enchufarse" a la plataforma. Es el corazon del diseño modular.

## Regla general de los juegos

Todos los juegos son **asincronicos y por puntaje**:

- Cada jugador juega su propio intento ("run") cuando quiere, dentro de una
  ventana de tiempo (ej: 1 hora desde que se emparejan).
- Gana el que hace **mas puntos**. Empate → reembolso a ambos.
- Si un jugador no juega su intento a tiempo → reembolso a ambos.

## Que implementa cada juego

Ver `src/index.ts`:

- `GameMeta` → identidad (id, nombre, descripcion, unidad de puntaje).
- `GameServerModule` → corre en el servidor (la "autoridad"): re-verifica cada
  intento para evitar trampa y decide quien gano comparando puntajes.
- `GameClientModule` → lo que se juega en el navegador; al terminar entrega un
  `GameRun` (puntaje + replay para re-verificar).

Agregar un juego nuevo = crear un modulo que cumpla estas interfaces. No se
toca el resto de la plataforma.
