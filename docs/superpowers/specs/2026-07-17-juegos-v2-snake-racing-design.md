# Juegos v2: Snake y Racing con decisiones de riesgo-recompensa

**Fecha:** 2026-07-17 · **Estado:** aprobado por el dueño (alcance, mecánicas y transición)

## Objetivo

Subir el techo de habilidad de Snake y Racing para que funcionen mejor como
benchmark de agentes. Hoy Racing está casi "resuelto": la estrategia trivial
incluida (esquivar al carril libre) juega casi óptimo, así que el juego no
distingue a un agente brillante de uno mediocre. La mejora agrega _decisiones
con tensión_ (desviarse o no, saltar o esquivar) en vez de solo reflejos.

**Criterio de éxito central (medible):** corriendo muchas semillas con las
estrategias incluidas, la brecha de puntaje medio entre la estrategia trivial y
la planificadora debe agrandarse claramente respecto de las reglas actuales.

## Alcance

- **En esta tanda:** Snake y Racing (evolución sobre los motores actuales).
- **Próxima tanda (v3, solo esbozada):** Flappy — monedas flotantes en
  posiciones incómodas + hueco de tamaño variable por caño.
- **Sin cambios:** 2048 y Tetris (profundos por diseño), Invaders (ya tiene
  riesgo-recompensa: OVNI bonus, filas con valores distintos, escudos, vidas).
- **Sin cambios on-chain:** el contrato no se toca; el puntaje sigue siendo un
  número firmado y verificado por replay.

## Snake v2: moneda que vence

- La fruta queda igual (siempre hay una, +1 punto, alarga la víbora).
- **Moneda:** como máximo una a la vez. En cada paso de la víbora sin moneda
  activa hay una probabilidad chica (inicial ~1/40, rng del motor) de que
  aparezca en una celda libre.
- Vale **+3 puntos** y **también alarga** la víbora: agarrarla nunca es gratis
  (desvío + más cuerpo = más riesgo de encerrarse).
- Vive **~28 pasos de la víbora** (no ticks: así la ventana en celdas es la
  misma cuando el juego acelera). Los últimos ~8 pasos parpadea en la UI.
- Valores iniciales calibrables en playtesting; la spec fija el mecanismo.

## Racing v2: salto, obstáculos saltables y monedas

- **Salto (acción nueva `j`):** dura ~0,5 s (30 ticks; ajustado en el plan:
  el intervalo mínimo entre filas de obstáculos es 0,5 s, y un salto más largo
  que ese intervalo crearía situaciones sin salida). En el aire **no se puede
  cambiar de carril** (saltar es comprometerse); los inputs de carril se
  ignoran mientras está en el aire. Al aterrizar, cooldown ~10 ticks.
  El generador además nunca exige dos saltos en filas consecutivas.
- **Obstáculos de dos clases:** _sólidos_ (solo se esquivan, los actuales) y
  _saltables_ (vallas/baches bajos: se esquivan o se saltan; visualmente más
  chatos). La proporción de saltables sube con el nivel (~25% → ~45%). En el
  patrón "pared doble", el carril de escape puede traer un saltable (recién
  desde el nivel 2, valor inicial calibrable): la única salida es saltar en el
  carril correcto.
- **Garantía de salida:** el generador nunca crea situaciones sin escape
  alcanzable considerando distancia de reacción y cooldown del salto. Se
  demuestra con un test que corre una estrategia oráculo sobre miles de
  semillas.
- **Monedas:** grupos de 3–5 en fila sobre un carril, +1 cada una, no
  colisionan (se recogen al pasar por su banda). Spawn determinista en los
  huecos entre obstáculos; a veces el carril con monedas termina en una valla
  (jugada de riesgo: juntar todo y saltar a tiempo).
- **Balance de velocidad:** la velocidad pasa a escalar con un contador de
  obstáculos superados, no con el puntaje total (las monedas no aceleran el
  juego).
- **Controles humanos:** desktop ↑ / espacio / W; mobile deslizar hacia
  arriba. Visual del salto: el auto se agranda y la sombra se despega (sin
  arte nuevo).

## Transición: corte seco con versión de reglas

Decisión del dueño: **corte seco** (estamos en testnet). Para que el corte sea
digno y no críptico:

- El game-sdk exporta una **versión de reglas por juego** (ej.
  `RULES_V = { snake: 2, racing: 2, flappy: 1, … }`).
- El replay enviado incluye su versión; ante mismatch el árbitro rechaza con
  **error explícito** (`err.rulesVersion` en el patrón de errores firmados +
  i18n): "reglas desactualizadas — actualizá @arcade1v1/mcp".
- La respuesta del matchmake incluye la versión vigente; el agent-sdk nuevo la
  valida al entrar (los clientes nuevos nunca juegan un match entero para
  enterarse al final; los viejos fallan al enviar, con mensaje claro).
- **Deploy coordinado:** web + árbitro salen del mismo push (monorepo);
  ventana tranquila; no sembrar durante el deploy; publicar
  `@arcade1v1/mcp` 0.2.0 inmediatamente; aviso en la página de agentes.
- Los matches ya cerrados no se re-verifican; un match en vuelo durante la
  ventana se rechaza con el error claro (costo aceptado en testnet).

## Identidad de los juegos

Los nombres visibles NO cambian (decisión del dueño): Snake sigue siendo
Snake y Racing sigue siendo Racing en el front, el catálogo, el MCP y los
docs. Los juegos evolucionan de reglas sin renombrarse ni duplicarse.

## Cambios acompañantes

- **Estrategias incluidas:** `racing.dodger` y `racing-weaver` aprenden a
  saltar y ganan parámetro de codicia de monedas; `snake.greedy` y
  `snake-survivor` ganan slider de codicia de moneda. La brecha
  trivial-vs-planificadora es la vara del benchmark.
- **Web:** render y controles nuevos en `SnakeGame.tsx` y `RacingGame.tsx`;
  instrucciones actualizadas en los 4 idiomas; el modo libre hereda todo. El
  visor de replays (modo espectador y sandbox del builder) también dibuja y
  re-simula las mecánicas nuevas.
- **Docs:** ejemplo del agente LLM de Racing en la página de agentes
  refrescado; README de game-sdk / agent-sdk / strategies / mcp.
- **Tests:** determinismo de replays v2 en `engines.test.ts`; test
  anti-imposible del generador de Racing; la sonda E2E de Playwright sigue
  verde; `npm run check` verde antes de publicar.

## Criterios de aceptación

1. Mismo replay → mismo puntaje (tests de determinismo v2 en ambos juegos).
2. La brecha trivial vs. planificadora crece en ambos juegos (script sobre N
   semillas; el plan fija N y el umbral).
3. Un cliente con paquete viejo recibe el error explicativo, nunca un
   mismatch críptico.
4. En mobile se puede saltar y juntar monedas sin tutorial (playtest manual).
5. Generador de Racing sin situaciones imposibles (test oráculo).

## Fuera de alcance

Flappy v3 (solo esbozo), cambios en 2048/Tetris/Invaders, cambios de contrato
u on-chain, arte nuevo, powerups, modos de juego nuevos.
