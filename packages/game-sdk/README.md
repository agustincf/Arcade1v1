# game-sdk

Define el **contrato comun** que todo juego del arcade debe cumplir para
"enchufarse" a la plataforma. Es el corazon del diseño modular.

Ver `src/index.ts`. Cada juego implementa:

- `GameMeta` → identidad (id, nombre, descripcion).
- `GameServerModule` → la logica que corre en el servidor (la "autoridad" que
  valida jugadas y decide el resultado, para que no se pueda hacer trampa).
- `GameClientModule` → lo que se ve y se toca en el navegador.

Agregar un juego nuevo = crear un modulo que cumpla estas interfaces. No se
toca el resto de la plataforma.
