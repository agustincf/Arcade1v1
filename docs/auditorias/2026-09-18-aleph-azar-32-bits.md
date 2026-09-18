# Aleph: ¿se puede adivinar el azar de la partida?

**Auditoría del 2026-09-18** · rama de trabajo, nada corrido contra producción

## La respuesta corta

**No hay ventaja real en las mesas de plata.** Probé los cuatro sorteos de Aleph
(el mazo, las ofertas, los códigos de la Cerradura y el desempate) recorriendo
las 4.294.967.296 semillas posibles de cada uno, y en ninguno un jugador puede
adivinar lo que viene mejor que tirando una moneda.

**Pero el motivo por el que estamos a salvo no es el que uno querría.** No
estamos a salvo porque el generador sea fuerte — es débil, y se rompe en
segundos. Estamos a salvo porque Aleph, casi por casualidad, muestra muy poca
información. Una regla del juego distinta (una segunda Cerradura, una mesa más
grande) lo rompería. Es un margen prestado, no ganado.

Mi recomendación fue: **no es un incendio**, pero conviene arreglarlo antes de
pasar a plata de verdad (mainnet). El dueño aprobó hacerlo ese mismo día; el
arreglo está al final, en "Lo que se hizo".

---

## Qué encontré, sorteo por sorteo

Aleph sortea cuatro cosas con la semilla secreta de la sala. Cada una usa solo
32 bits de esa semilla, y 32 bits se pueden probar uno por uno en un minuto.
La pregunta es si lo que un jugador ve durante la partida alcanza para
descubrir esos 32 bits. Medí cuántas semillas siguen siendo posibles después
de ver cada cosa:

| Sorteo                      | Lo que ve un jugador | Semillas que quedan | ¿Puede adivinar lo que viene?                                           |
| --------------------------- | -------------------- | ------------------- | ----------------------------------------------------------------------- |
| **Cerradura** (los códigos) | su dígito            | 429.410.353         | No: acierta el siguiente dígito 10,00 % — el azar puro es 10 %          |
| **Ofertas**                 | la oferta actual     | 268.394.548         | No: acierta la próxima oferta 6,26 % — el azar puro es 6,25 %           |
| **Mazo**                    | 6 de las 8 cartas    | 10.225.757          | No: acierta lo mismo que quien simplemente cuenta las cartas que faltan |
| **Desempate**               | nada                 | —                   | No se publica nunca, ni siquiera al final                               |

El caso del mazo es el más lindo de explicar: sí, el ataque reduce las semillas
posibles de 4.294 millones a 10 millones. Pero eso **no sirve de nada**, porque
el mazo tiene pocas combinaciones y cualquiera que lleve la cuenta de qué
cartas ya salieron llega a la misma predicción sin atacar nada. Lo comprobé
caso por caso: con dos cartas por salir, el ataque acierta el orden 50 % de las
veces, que es exactamente lo que da elegir entre las dos a mano. La única
diferencia que queda no sale de romper el azar, sino del sesgo del mazo que
explico más abajo, y ese se calcula leyendo el código.

Para dimensionarlo: en una mesa de 8 el mazo trae 10 cartas y una partida
promedio llega a mostrar 6. Solo la mitad de las partidas llega siquiera a
jugar la Cerradura.

Ni siquiera juntando varias cuentas: con **6 de los 8 dígitos** de una Cerradura
en la mano (o sea, seis asientos confabulados), adivinar el séptimo sigue
estando en 10,55 % contra 10 % del azar.

## Por qué en Flappy sí funciona y acá no

En Flappy el juego usa el número del azar **tal cual sale**, y ese número lleva
los 32 bits puestos. Lo medí:

- Flappy: **una** sola tirada deja 3 candidatas (6,7 segundos). Con dos, queda
  **la semilla exacta**.
- Aleph: una tirada deja **429 millones** de candidatas.

La diferencia es que Aleph nunca muestra el número crudo: lo aplasta hasta
dejar un dígito del 0 al 9 (3,3 bits) o un escalón de oferta (4 bits). Se tira
casi toda la información antes de que el jugador la vea. Eso es lo que salva a
Aleph, y fue suerte de diseño, no una decisión.

## El dato que más me preocupa

Le puse número a lo frágil que es ese margen. Hoy el mazo trae **una sola
Cerradura**. Si trajera dos, al cerrarse la primera se publica su código
completo, y con eso ya se puede adivinar el de la segunda:

- a ciegas: **1 en 100.000.000**
- con el ataque: **1 en 48**

Dos millones de veces mejor. Ese es el juego entero regalado: quien lo sepa
abre la Cerradura sin pedirle el dígito a nadie y traiciona para quedarse con
el 10 % del pozo.

O sea: **hoy Aleph no es explotable, pero está a una regla de distancia de
serlo.** Y no hay nada en el código que avise de eso. Cualquiera que en el
futuro agregue una segunda Cerradura, suba el máximo de asientos o muestre más
azar en el modo espectador (la etapa 5) rompería la seguridad sin enterarse.

## Un segundo hallazgo, aparte del generador

El mazo **no sale parejo**. De los 630 órdenes posibles, el más probable sale
0,357 % de las veces y el menos probable 0,119 %: **tres veces más seguido**.

No es culpa del generador (cambiarlo no lo arregla). Viene de la regla que
evita dos Ofertas seguidas: cuando el sorteo las deja pegadas, la segunda se
intercambia con otra carta, y ese arreglo concentra ciertos órdenes. La cuenta
cierra exacta: de los 840 órdenes que existen, los 210 que tienen las Ofertas
pegadas quedan vacíos y su probabilidad se reparte entre los otros 630 — que es
justo lo que salió medido.

Como el código es público, un agente cuidadoso puede apostar a los órdenes más
probables. La ventaja es chica, pero es gratis y no requiere romper nada.

Se arregla barajando de nuevo hasta que no queden Ofertas pegadas, en vez de
corregir con un intercambio.

## Lo que se hizo

El dueño aprobó el arreglo de fondo el 2026-09-18 y quedó implementado en la
rama `fix/aleph-azar-hash`. **Reglas de Aleph v2:** cada número sorteado sale
de `SHA-256(secreto + propósito + etapa + contador)` en vez de 32 bits sueltos.
Probar todas las combinaciones pasa de un minuto a imposible, y el margen deja
de depender de la suerte.

El sesgo del mazo se arregló en la misma versión: cuando las dos Ofertas salen
pegadas, se vuelve a barajar en lugar de intercambiar una carta.

De los tres costos que había previsto, quedaron dos:

1. **Sube la versión de reglas** (de 1 a 2) y hay que publicar los paquetes.
2. **El motor sigue sabiendo jugar v1.** Cada sala guarda con qué versión nació
   y se re-simula con esa. Sin esto, todas las partidas ya jugadas dejarían de
   verificar, y la web promete en cuatro idiomas que cualquiera puede
   verificarlas.
3. ~~Hay que desplegarlo sin salas en curso~~ — **ya no hace falta.** Como cada
   sala arrastra su versión, una partida que esté jugándose durante el deploy
   sigue con las reglas con las que empezó y termina normal. Las salas nuevas
   nacen en v2. Hay un test que lo prueba justamente así: una sala guardada
   antes del cambio, restaurada después.

Lo que **no** cambia: la plata, la tabla de pagos, las comisiones ni ninguna
otra regla del juego. Solo de dónde sale el azar.

## Detalles para el archivo

- Ningún agujero de los graves: la semilla secreta solo sale cuando la sala
  termina, y el `commit` público no ayuda a adivinarla.
- Los cuatro sorteos están en `packages/game-sdk/src/aleph.ts` (`rngFor`), y
  las mediciones se hicieron con una copia verificada contra el motor real
  sobre 300 semillas.
- Todo se corrió en local. No se tocó ni el árbitro de Render ni la web.
