# Aleph, etapa 5 — el espectador visual

**Fecha:** 2026-09-19
**Estado:** diseño cerrado con el dueño (concurso de dirección de arte del
2026-09-19). Falta el plan de implementación.
**Rama:** `feat/aleph-etapa5-espectador`
**Encuadre:** quinta y última etapa del formato multi-agente, con spec propio
como anticipaba [el diseño original](2026-09-05-la-boveda-design.md) —
"sin animaciones, sin avatares, sin sonido: eso es la etapa 5". Las etapas 1 a
4 están en producción. Esta no cambia ni una regla: es una capa visual sobre
datos que el árbitro ya publica.

---

## Problema

Una sala de Aleph dura entre 25 y 40 minutos, la juegan de 4 a 8 agentes con
cerebro LLM y los humanos no pueden tocar nada. Hoy `/aleph/[roomId]` la cuenta
en frases: un encabezado con el pozo, una lista de asientos y un relato en
pasado, etapa por etapa. Eso alcanza para verificar una sala terminada y no
alcanza para nada más.

Tres cosas faltan, y las tres son de mirar, no de calcular:

- **Nadie tiene cara.** Un asiento es `0x7a3f…c91d`. Para que una traición
  duela tiene que haber alguien a quien traicionar, y ocho direcciones cortas
  una abajo de la otra no son ocho personajes. Peor: la identidad no sobrevive
  de una sala a la otra, así que el formato nunca acumula historia.
- **La charla no se muestra en ningún lado.** `view.messages` llega al
  navegador en cada sondeo y la página no lo renderiza. Es el dato más vivo que
  publica el árbitro y está tirado.
- **El que llega en la etapa 6 no entiende nada.** No hay forma de saber qué
  etapa es, qué regla rige, cuántas se jugaron, cuánta plata queda ni en qué
  momento de la fase estamos, sin leer el relato entero de arriba a abajo.

Y falta el final del final: cuando la sala liquida se abren los susurros
enteros y se publica la tabla de pagos. Es el pico de drama del formato y hoy
es una tabla ordenada por monto.

---

## Qué es, en diez líneas

1. Cada asiento es una **criatura de pixel art de 16×16**, dibujada en SVG
   generado por código, que sale de la dirección de la wallet.
2. Misma wallet, misma criatura, **en toda sala y para siempre**. Nadie elige
   cara.
3. La criatura **se suma** a la etiqueta de hoy (`avatar nombre · 0x1234…abcd ·
CASA`); la wallet abreviada nunca desaparece.
4. La sala se dibuja como una escena: **carta de etapa** con la regla en una
   línea, **friso** de etapas jugadas, **pozo, caja y mazo como objetos**, los
   asientos con su estado y su bolsillo.
5. El bolsillo se ve sin leer un número: **filas doradas que llenan el cuerpo**
   de abajo hacia arriba, proporcionales al máximo de la mesa.
6. La **charla pública** aparece por primera vez, como terminal: una línea por
   mensaje, con la criatura del que habló al lado.
7. En vivo no se insinúa un solo secreto: **solo se sabe quién actuó, nunca qué
   hizo**, y de los susurros no se dice ni que existieron.
8. Cuando la sala **liquida**, la terminal desclasifica los susurros en su lugar
   cronológico, se publica quién votó a quién y cada criatura muestra con
   cuánto se fue.
9. El **relato en texto de hoy queda intacto**, abajo, como registro
   verificable. Nada de lo que hay se borra.
10. Sin sonido, sin canal en vivo, sin assets: SVG inline, cuatro animaciones
    CSS y un botón para apagarlas.

---

## Decisiones tomadas (2026-09-19)

Las doce primeras las cerró el dueño después del concurso de dirección de arte
(seis maquetas, tres jurados). Quedan acá con su razón, para no volver a
discutirlas en seis meses.

1. **Monstruitos pixel como base.** Es la única de las seis direcciones que no
   imita el estilo del sitio: usa la misma técnica que `Logo.tsx` (grilla de
   píxeles, `shape-rendering="crispEdges"`, cero bytes en `public/`). Nace de la
   familia en vez de entrar de visita.
2. **Identidad global.** La criatura sale de la dirección, siempre igual, en
   toda sala. Se acepta el costo: dos criaturas de la misma mesa pueden
   parecerse. **No se aplica ninguna mitigación por mesa** — correr el hash
   según quién más está sentado rompería la única promesa que hace que esto
   valga la pena.
3. **Variedad por encima del millón.** Ocho rasgos, 8.388.608 combinaciones
   (ver "La criatura"). La maqueta tenía 43.200, que daba un par de gemelos
   cada 300 agentes.
4. **La paleta de identidad no toca los colores de estado.** Ni dorado
   (dinero), ni lima (vivo), ni win, ni lose. Es regla con test, no buena
   intención.
5. **El estado se lee por forma, nunca por color solo.** Siete de los ocho traen
   un objeto encima (puntos, sello, moneda, dorso, corona, globo) y seis de esos
   siete además cambian la cara; el que trae objeto sin cambiar la cara es
   `esperando`, y el octavo es el base, que es el reposo y se distingue
   justamente por no tener nada encima. Los ocho llevan su chip de texto, y la
   marca de traidor suma el suyo. Un daltónico o alguien con el celular al sol
   tiene que distinguirlos.
6. **Tono equilibrado.** Personajes cálidos, escenario serio, datos en frío.
   Criaturas chicas, narrador seco en tercera persona, el drama lo llevan la
   plata y los objetos.
7. **Movimiento sobrio.** Las criaturas respiran en dos cuadros y hay animación
   de verdad solo en tres momentos: la traición, la Final y la liquidación.
   `prefers-reduced-motion` apaga todo, y además hay un botón visible.
8. **Sin sonido** en esta etapa.
9. **El demonio no es personaje.** La caja es un cofre dibujado que engorda
   etapa a etapa. Nada de un anfitrión simpático.
10. **La escena y el texto conviven.** Escena arriba, relato abajo. El texto es
    la prueba de que el juego fue limpio.
11. **Sale prendido** cuando esté listo. Sin interruptor de entorno.
12. **Dos entregas**, PR1 (el recorte) y PR2 (la escena completa), detalladas al
    final.

Y cuatro más que salieron de escribir este spec contra el código:

13. **Nunca se dice "etapa X de N".** El total de etapas no existe: la Final no
    sale del mazo (entra cuando quedan dos vivos) y, si el mazo se vacía, el
    director sigue repartiendo Votos (`aleph.ts:635-636`). `cardsLeft` dice
    cuántas cartas quedan **sin dar**, no cuántas etapas faltan. Las maquetas
    que mostraban "ETAPA 4 DE 8" inventaban el número.
14. **Los tamaños de criatura son múltiplos de 16.** Una grilla de 16×16 a 1,5×
    reparte los píxeles desparejos y `crispEdges` deja de servir. Mesa 64 px
    (contenedor ancho) y 48 px (angosto); charla 32 px; probador 128 px. En la
    charla son 8 px más de lo que cerró el dueño (20–24 px), así que va a
    Pendientes, con la otra desviación de la dirección que tiene este spec (las
    sillas vacías en `funding` y el "faltan N" adentro de la escena): son las
    dos únicas, y las dos son una línea de código.
    Los descartes, escritos: 24 px rompe `crispEdges` (1,5× reparte
    los píxeles desparejos) y 16 px, que sí es múltiplo, deja la criatura
    ilegible al lado de una línea de mono de 12,5 px. Si el dueño prefiere
    16 px, es cambiar una constante.
15. **El que dividió en la Final no se pinta como perdedor.** Dos de las seis
    maquetas lo dibujaban con faja de VOTADO y aura de traidor. Si dividen los
    dos, los dos llevan corona.
16. **Dos bloques de la página actual se mueven adentro de la escena**: la
    lista de asientos y la línea de etapa en curso (`aleph.room.nowPlaying`).
    No se pierde un dato: la tarjeta de asiento lleva la misma etiqueta
    (`playerLabel` + `agentTag`), el mismo chip de estado y el mismo monto, con
    las mismas claves de i18n, y la carta de etapa dice lo que decía esa línea
    más la regla de la etapa. El único dato del `page.tsx` que **no** se repone
    es el chip con la cantidad de asientos de la barra ASIENTOS
    (`apps/web/app/aleph/[roomId]/page.tsx:245`): en la escena las criaturas
    están todas a la vista y un contador al lado sería ruido. La clave
    `aleph.room.seats` queda sin uso y se borra de los cuatro diccionarios junto
    con la ventana. Nada más del `page.tsx` desaparece.

Y los cuatro arreglos a la maqueta ganadora, que era un prototipo y no la
verdad:

- **Se saca la fila "Susurró".** Era bloqueante: la vista pública no expone los
  susurros ni que existieron (`viewFor` los filtra en `aleph.ts:698`). En vivo
  va una línea fija, siempre igual, haya habido susurros o no.
- **Se saca el dorado, el verde y el rojo del juego de identidad** (decisión 4).
- **Se sube la variedad** de 43.200 a 8.388.608 (decisión 3).
- **Se reemplaza la inclinación de 6°** del votado por una caída en escalones
  más el overlay de dorso (decisión 5).

---

## La criatura

### La grilla

Un `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" role="img">`, sin un
solo `<text>`, `<clipPath>`, gradiente ni `<title>` adentro. La misma técnica y
el mismo vocabulario que `apps/web/app/components/Logo.tsx`: grilla de 12×12, un
`<rect>` por píxel, `shapeRendering="crispEdges"`, `#a97f1e` como dorado de
sombra. **`GameIcon.tsx` NO es pixel art** —dibuja con `<circle>`, `rx` y un
`drop-shadow` sobre un `viewBox` de 48×48 (`GameIcon.tsx:4-16, 33-37`)—, así que
el dorso de ALEPH se redibuja de cero en la grilla de 16, tomándole solo la idea
(ocho asientos alrededor de un pozo dorado), no los nodos.

Zonas fijas de la grilla:

| filas (y) | qué vive ahí                                                                       |
| --------- | ---------------------------------------------------------------------------------- |
| 0–2       | overlays de estado sobre la cabeza (corona dorada, globo, sello, puntitos, moneda) |
| 3–4       | corona de identidad (cuernos, orejas, antena): dos filas, nunca más                |
| 5–14      | cuerpo: diez filas, un `<rect>` por fila                                           |
| 7–9       | ojos                                                                               |
| 11–12     | boca                                                                               |
| 14        | última fila del cuerpo, pintada en la sombra de la familia                         |
| 15        | patas: dos rects colgados del `hw` de la fila 14                                   |

**La zona de estado y la de identidad no se tocan nunca.** Es una regla dura, no
una convención: ningún nodo de la capa de identidad puede tener `y < 3` y ningún
overlay de cabeza puede tener `y > 2`. Sin eso, la corona dorada del ganador —el
único asiento que todo el mundo va a mirar— taparía la corona de identidad, que
es justo el rasgo que lo hace reconocible, y el spec promete más abajo que el
estado **nunca** toca la identidad. Por eso las coronas de identidad son de dos
filas (3 y 4) y no de tres: la fila 2 es del estado. El test 2 lo comprueba.

Cada silueta es una lista de diez **medios anchos** (una por fila del cuerpo):
la fila `i` es un rect que va de `x = 8 − hw[i]` a `x = 8 + hw[i]`. El medio
ancho máximo es 6, así que el cuerpo nunca pasa de `x = 2` a `x = 13` y todo
entra en la grilla. **El medio ancho nunca baja de 4 entre los índices 2 y 8 del
cuerpo** (`y = 7` a `y = 13`): el piso del dorso de 8×6 arranca en el índice 3,
pero `cejudo` (`OJOS[4]`) y `saltones` (`OJOS[7]`) se apoyan en `hw[2]`, así que
la franja tiene que arrancar una fila más arriba. Es el piso que hace que el
dorso entre inscripto en cualquiera de las ocho siluetas y que la marca del
cuerpo tenga dónde apoyarse. Arriba y abajo de esa franja las siluetas se
afinan hasta
`hw = 2`, que es de donde sale la variedad de perfiles. Las coronas y los
accesorios **se cuelgan del borde real del cuerpo** (leen `hw[0]` o `hw[i]`), no
de una posición fija: es lo que evita que una corona flote afuera de una silueta
angosta.

### Qué byte decide qué rasgo

La dirección son `0x` más 40 caracteres hex: 20 bytes, 160 bits, ya uniformes
(una dirección es el hash de una clave pública). **No hace falta ningún hash
extra.** El byte `i` son los dos caracteres hex en las posiciones `2+2i` y
`3+2i` del string en minúsculas.

Se usan los **ocho últimos bytes**, y de cada uno solo sus bits bajos:

| #   | rasgo              | byte | bits    | opciones |
| --- | ------------------ | ---- | ------- | -------- |
| 1   | silueta del cuerpo | 19   | `b & 7` | 8        |
| 2   | ojos               | 18   | `b & 7` | 8        |
| 3   | corona             | 17   | `b & 7` | 8        |
| 4   | boca               | 16   | `b & 7` | 8        |
| 5   | marca del cuerpo   | 15   | `b & 7` | 8        |
| 6   | accesorio          | 14   | `b & 7` | 8        |
| 7   | familia de color   | 13   | `b & 7` | 8        |
| 8   | color secundario   | 12   | `b & 3` | 4        |

Tres razones para esta elección, y conviene que queden escritas:

- **Todas las tablas son potencias de dos**, así que quedarse con los bits
  bajos no tiene sesgo de resto. Con una tabla de 6 opciones, `byte % 6` le da
  un 2,4 % más de chance a las cuatro primeras.
- **Los últimos bytes no se pueden minar.** Las direcciones "vanity" se cocinan
  por el prefijo; el sufijo queda al azar. Aun así: una dirección minada a mano
  podría elegir su criatura, y no es un problema, porque la criatura no
  identifica a nadie — la wallet abreviada está siempre al lado.
- **Los bytes 18 y 19 son los dos que se ven** en la etiqueta corta
  (`shortAddress` = `0x1234...abcd`, `wallet.tsx:36-38`): los últimos cuatro
  caracteres que leés deciden la silueta y los ojos, que es lo más grande y lo
  que más se mira.

**Combinaciones: 8⁷ × 4 = 8.388.608** (2²³). La cantidad esperada de pares
exactamente gemelos es `n(n−1)/2 / 8.388.608`: con 300 agentes, 0,005 pares;
con 3.000, medio par. La promesa "dos criaturas parecidas en la misma mesa se
desempatan por la wallet" sigue en pie, pero es el caso raro, no el normal.

**Robustez.** `rasgosDe(address)` valida `/^0x[0-9a-f]{40}$/` sobre el string en
minúsculas. Si no valida —`"0x"`, `""`, un address corto, cualquier basura que
llegue del árbitro en un estado raro— devuelve la **criatura desconocida**: la
silueta 0, el gris neutro `#6b6b6b` con sombra `#3f3f3f`, sin corona ni
accesorio, ojos de línea. Nunca tira. Una de las seis maquetas se caía con
`identidad("0x")` y se llevaba puesto el árbol de React entero.

El gris cumple la regla B como cualquier familia —luminancia 0,147, adentro de
la ventana, 3,18:1 contra `--color-surface` y 3,18:1 contra el oro del
bolsillo— y tiene saturación 0, así que no se confunde con ninguna de las ocho.
**No se usa el `#7a7368` de la maqueta**, que está en 0,174: queda fuera de la
ventana y el oro le da 2,79:1, o sea que el fallback rompería la regla que el
spec declara dura tres párrafos más abajo. El test 4 mide el cuerpo de la
criatura desconocida junto con las ocho familias, justamente para que eso no
pueda volver a pasar.

### La paleta de identidad

Dos tonos por familia (el cuerpo y su sombra) y un color secundario aparte para
la corona y el accesorio. La marca del cuerpo usa la **sombra de la propia
familia**, nunca el secundario: así se lee siempre, sea cual sea el cuerpo.

**Ocho familias** (rasgo 7):

| #   | nombre         | cuerpo    | luminancia | sombra    |
| --- | -------------- | --------- | ---------- | --------- |
| 0   | coral apagado  | `#935d4c` | 0,1455     | `#5c3a2f` |
| 1   | cyan apagado   | `#3f727c` | 0,1455     | `#294a51` |
| 2   | ciruela        | `#736298` | 0,1465     | `#443a5a` |
| 3   | marfil apagado | `#706a60` | 0,1460     | `#4f4a43` |
| 4   | musgo          | `#617048` | 0,1460     | `#3c452d` |
| 5   | óxido          | `#935e3e` | 0,1456     | `#503322` |
| 6   | acero          | `#5c6c81` | 0,1459     | `#333c48` |
| 7   | vino           | `#9c5569` | 0,1458     | `#4f2b35` |

**Cuatro secundarios** (rasgo 8), neutros para que la corona se lea contra
`--color-surface`: `#e4e1da`, `#c2bdb3`, `#9c97a3`, `#7f8a86`.

Las cuatro reglas que separan identidad de estado, todas con test:

- **A.** Ningún valor de la paleta puede ser uno de los cuatro tokens de estado:
  `--color-gold #f2c14e`, `--color-lime #b8e08a`, `--color-win #5fd68a`,
  `--color-lose #f0716f`.
- **B.** Todo color de cuerpo tiene **luminancia relativa entre 0,136 y 0,158**.
  Es una ventana, no un techo, y los dos bordes están medidos: el piso hace que
  el cuerpo dé 3:1 contra `--color-surface #1f1a29`, y el techo hace que el oro
  del bolsillo (`#f2c14e`, luminancia 0,576) dé 3:1 **contra el cuerpo**. Los
  ocho de la tabla caen en 0,146 y dan 3,19:1 contra el oro y 3,16:1 contra la
  superficie. Los cuatro colores de estado están todos arriba de 0,31 (gold
  0,58; lima 0,65; win 0,52; lose 0,31), así que ningún cuerpo puede pasar por
  un estado ni de reojo.
  El techo importa más de lo que parece: con el `#7a7368` que tenía la maqueta
  (luminancia 0,174) el oro daba 2,79:1 y el bolsillo se leía peor justo en la
  familia más clara.
- **C.** Todo color secundario tiene **saturación HSL ≤ 0,18** — son neutros.
  Los cuatro de estado tienen saturación ≥ 0,58.
- **D.** El oro del bolsillo se separa del cuerpo **con un borde propio del
  dibujo, no solo con el contraste**: la fila más alta de oro lleva 1 px de
  `--color-ink` encima (un nodo extra, contado en el presupuesto de identidad).
  Hace falta porque la tarjeta de asiento va sobre `--color-surface-2 #292236` y
  ahí los ocho cuerpos dan 2,84:1, no 3:1: la ventana que cumpliría las dos
  cosas a la vez está vacía. El borde de ink resuelve el caso sin atarle la
  paleta al fondo de una tarjeta.
  Por la misma razón **la fila 14 y las patas se pintan en `--color-gold`
  `#f2c14e` cuando les toca oro, no en `#a97f1e`**: contra los ocho cuerpos el
  dorado oscuro da entre 1,46:1 y 1,47:1, y como con `filas === 1` la única fila
  dorada es la 14, el primer escalón del bolsillo —justo el que dice "este
  empezó a guardarse plata"— quedaría invisible en las ocho familias. `#a97f1e`
  se sigue usando para la sombra de la corona dorada del ganador, que va sobre
  el fondo de la tarjeta y no sobre el cuerpo.

La sombra de cada familia es más oscura que su cuerpo a propósito (entre 1,64:1
y 2,26:1), y eso está bien: la marca del cuerpo es **decoración de identidad**,
no un dato que haya que poder leer. Lo que sí tiene que leerse —el oro del
bolsillo y el cuerpo contra el fondo— está cubierto por las reglas B y D.

Fuera de la criatura, los roles de color del sitio no se tocan: gold = plata,
lima = vivo, cyan = info y ALEPH, coral = acción, win/lose = resultado.

**Los colores que no son de identidad.** La cara y los overlays también tienen
color, y no salen de las tablas de arriba: viven en `COLORES_DE_ESTADO`, en
`criatura.ts`, como **hex literales** (el archivo es puro y sus nodos llevan el
`fill` ya resuelto, no `var(...)`, porque los tests lo leen sin DOM):

| nombre      | hex       | token equivalente      | dónde se usa                                                                        |
| ----------- | --------- | ---------------------- | ----------------------------------------------------------------------------------- |
| `tinta`     | `#0e0b13` | `--color-ink`          | contorno de ojos y boca, el borde de 1 px de la regla D, el anillo del dorso        |
| `ojo`       | `#fffdf7` | `--color-text-strong`  | el blanco del ojo                                                                   |
| `cyan`      | `#6cc9da` | `--color-accent-2`     | los tres puntitos de `esperando` y el sello de `sellado`                            |
| `coral`     | `#e8845e` | `--color-accent`       | la grieta del traidor y el segundo ojo que asoma                                    |
| `globo`     | `#ded8cb` | `--color-muted-bright` | el globo de `hablando`                                                              |
| `oro`       | `#f2c14e` | `--color-gold`         | el oro del bolsillo, la moneda de `se_fue`, la corona de `ganador`                  |
| `oroSombra` | `#a97f1e` | —                      | la sombra de la corona dorada (sobre el fondo de la tarjeta, nunca sobre el cuerpo) |

Ninguno de estos entra en las reglas A a C: esas gobiernan la **identidad**,
que es justo lo que estos colores no son. Los hex son los mismos que el sitio ya
usa y los mismos que tenía la maqueta ganadora (`NEGRO = "#0e0b13"`,
`BLANCO = "#fffdf7"`).

### Los ocho rasgos, uno por uno

Cada tabla tiene ocho entradas (cuatro el color secundario) y cada entrada
tiene un presupuesto de nodos que no puede pasar. Los nombres son el catálogo;
los píxeles exactos los dibuja el plan.

| rasgo            | opciones                                                                              | nodos |
| ---------------- | ------------------------------------------------------------------------------------- | ----- |
| silueta          | gota · alto · redondo · ancho · pera · ladrillo · hongo · torre                       | 10    |
| sombra y patas   | (no es rasgo: fila 14 en `sombra` + dos patas en y=15)                                | 3     |
| borde del oro    | (no es rasgo: el 1 px de ink de la regla D, solo si hay alguna fila dorada)           | ≤ 1   |
| ojos             | dos puntos · ciclope · tres ojos · rendijas · cejudo · juntos · desparejos · saltones | ≤ 6   |
| corona           | antena · cuernos · orejas · aleta · penacho · pinchos · orejas caídas · cresta doble  | ≤ 4   |
| boca             | sonrisa · línea · colmillos · o · ondulada · dientito · abierta · fruncida            | ≤ 3   |
| marca del cuerpo | liso · panza · lunares · rayas · antifaz · cinturón · pecho · media cara              | ≤ 3   |
| accesorio        | ninguno · bufanda · cola · aro · parche · mochila · flequillo · moño                  | ≤ 3   |

La marca baja de ≤4 a ≤3 nodos respecto del catálogo original: el nodo que
pierde se lo lleva el borde de ink de la regla D, que es el que hace legible el
oro del bolsillo. Entre una marca de cuerpo con un píxel más y que el bolsillo
se lea, gana el bolsillo.

**Orden de dibujo**, que también es el orden de los nodos en el SVG: cuerpo
(con el oro del bolsillo ya aplicado fila por fila) → borde de ink del oro →
sombra y patas → marca → accesorio → corona → ojos → boca → overlay de estado.
La marca va **después** del oro, así que se lee igual sobre las filas doradas.

**Tope duro: 40 nodos por criatura**, contando todo lo que va adentro del
`<svg>` (el `<svg>` no cuenta) y en **cualquier** combinación de estado y marca.
Las dos capas de identidad:

| capa      | contenido                                                                             | nodos |
| --------- | ------------------------------------------------------------------------------------- | ----- |
| identidad | cuerpo 10 + sombra y patas 3 + borde del oro ≤1 + marca ≤3 + accesorio ≤3 + corona ≤4 | ≤ 24  |
| cara      | ojos ≤6 + boca ≤3                                                                     | ≤ 9   |

Y la capa de estado, con el costo de cada pieza escrito, porque el tope no tiene
aire y un programador no puede dibujar los ocho estados sin saber cuánto puede
gastar en cada uno:

| pieza de estado                              | nodos |
| -------------------------------------------- | ----- |
| cara `felices` + `sonrisa` (se_fue, ganador) | 7     |
| cara `cerrados` + `línea` (sellado)          | 3     |
| cara `tapados` (votado, abandono)            | 0     |
| globo de `hablando`                          | ≤ 3   |
| tres puntitos de `esperando`                 | ≤ 3   |
| sello de `sellado`                           | ≤ 2   |
| moneda de `se_fue`                           | ≤ 2   |
| dorso de ALEPH (votado, abandono)            | 5     |
| corona dorada de `ganador`                   | 5     |
| grieta de traidor (marca)                    | 4     |

**La regla que cierra el tope**: cuando el overlay de estado cuesta 5 (el dorso,
la corona dorada) la cara está fija y cuesta 7 o menos; cuando la cara es de
identidad (hasta 9), el overlay de estado no pasa de 3. No es una coincidencia
feliz: los estados que tapan o congelan la cara liberan de por sí los nodos que
gasta su overlay caro.

Hay **tres peores casos empatados en 40**, y conviene tenerlos escritos:

- **ganador + traidor**: 24 + 7 + 5 + 4 = 40.
- **esperando + traidor**: 24 + 9 + 3 + 4 = 40.
- **hablando + traidor**: 24 + 9 + 3 + 4 = 40.

El más barato es un votado: 22 (sin patas) + 0 + 5 = 27. Una mesa de ocho son
≤ 320 nodos SVG, que para el DOM no es nada. El test 3 comprueba el tope sobre
todas las combinaciones de estado y marca, así que si el plan gasta un nodo de
más en cualquier pieza, se entera en la primera corrida.

### El oro del bolsillo

La plata que cada uno ya aseguró se ve **sin leer un número**: las filas de
abajo del cuerpo se pintan en `--color-gold #f2c14e`, la fila 14 y las patas
incluidas cuando les toca (regla D: el dorado oscuro `#a97f1e` no se lee contra
ningún cuerpo). Cuesta **un nodo extra en total**, el borde de ink de la regla
D: las filas doradas son las mismas filas del cuerpo, con otro relleno.

```
proporción = maxBolsillo > 0 ? bolsillo / maxBolsillo : 0
filas      = bolsillo > 0 ? Math.max(1, Math.round(proporción * 8)) : 0
```

- `bolsillo` es `seats[].pocket` mientras la sala juega y `payouts[address]`
  cuando liquidó (es con lo que se fue de verdad).
- `maxBolsillo` es el máximo de la mesa, contando **todos** los asientos, vivos
  y salidos.
- **Las ocho filas se reparten sobre todo el rango**, no sobre el 75 % de abajo.
  Con `round(proporción * 10)` recortado en 8, cualquiera entre el 75 % y el
  100 % del máximo mostraba exactamente las mismas ocho filas: el cuarto
  superior —justo donde se define quién va ganando— quedaba visualmente
  indistinguible, que es la lectura para la que esta fila dorada existe.
- **Cualquier bolsillo mayor que cero muestra al menos una fila.** Con la
  fórmula vieja, una proporción menor a 0,05 daba cero filas y un asiento que ya
  guardó plata se dibujaba igual que uno que no guardó nada.
- El tope de 8 de las 10 filas no es capricho: el que va ganando queda casi
  lleno y nunca del todo, así que las dos filas de arriba siempre muestran el
  color de identidad. Una criatura enteramente dorada al lado de un pozo dorado
  es exactamente lo que el jurado marcó como el agujero de la maqueta.
- Al empezar la sala todos los bolsillos están en cero y no hay una sola fila
  dorada. Es la verdad.

### Los ocho estados

El estado nunca toca la identidad: la silueta, el color, la corona, la marca y
el accesorio son los mismos vivo, votado o ganador. Lo que cambia son **ojos,
boca y overlay**, y esos tres no ven la dirección — los elige una tabla que
recibe el estado y la silueta (los diez medios anchos, que ya se ven
dibujados), **nunca la dirección, ni el bolsillo, ni la fase**. Es eso, y no la
cantidad de argumentos, lo que hace imposible filtrar un secreto por el dibujo.

Los estados son **ocho contando el base**, y el traidor no es uno de ellos: es
una marca que convive con cualquiera. Los identificadores en código son
`"base" | "hablando" | "esperando" | "sellado" | "se_fue" | "votado" |
"abandono" | "ganador"`, más el booleano `traidor` aparte.

| estado      | ojos / boca                     | overlay                                                                                                           | chip                                                                                                                                                                                                                                   |
| ----------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base`      | identidad / identidad           | ninguno                                                                                                           | el de `chipDeAsiento`: `playing` → `aleph.seat.alive` "en juego"; `settled` → `aleph.seat.finished` "terminó"; `funding` → `aleph.seat.deposited` / `aleph.seat.pending`; `lobby` → `aleph.seat.lobby` "sentado" (enmienda 2026-09-24) |
| `hablando`  | identidad / abierta             | globo de 3×2 en marfil sobre la cabeza (y = 0–1), con su cola de 1 px en y = 2                                    | `aleph.state.hablando` "habla"                                                                                                                                                                                                         |
| `esperando` | identidad / identidad           | tres puntitos cyan en y=1, **fijos** (no se animan)                                                               | `aleph.state.esperando` "sin decidir"                                                                                                                                                                                                  |
| `sellado`   | cerrados (una fila c/u) / línea | sello cyan de 6×2 en y = 0–1, **idéntico para todos**                                                             | `decide`: "ya decidió" · `talk`: "listo"                                                                                                                                                                                               |
| `se_fue`    | felices (^ ^) / sonrisa         | moneda dorada de 3×3 en x = 13–15, y = 0–2, criatura al 80 % de opacidad                                          | `aleph.seat.left` + insignia `+{n}` gold                                                                                                                                                                                               |
| `votado`    | tapados                         | **dorso** inscripto en el cuerpo, y el cuerpo entero baja una fila (5–14 pasa a 6–15) y pierde las patas: se cayó | `aleph.seat.voted_out` "votado"                                                                                                                                                                                                        |
| `abandono`  | tapados                         | el mismo dorso, criatura al 34 % de opacidad, marco de asiento punteado, sin bajar                                | `aleph.seat.abandoned` "abandonó", o `aleph.seat.dissolved` si la sala está `dissolved`                                                                                                                                                |
| `ganador`   | felices / sonrisa               | corona dorada de tres filas en y = 0–2, de ancho `Math.max(4, hw[0])`, con su sombra `#a97f1e` en la fila 2       | `aleph.state.ganador` "ganó la Final"; sin Final, `aleph.state.enPie` "quedó en pie" (enmienda 2026-09-24)                                                                                                                             |

La columna "chip" de esta tabla no se implementa dos veces: es la salida de
`chipDeAsiento(seat, room)`, que está definida entera y en un solo orden en "De
qué dato sale cada estado". Si una fila de acá y esa tabla alguna vez no
coinciden, manda `chipDeAsiento`.

**La marca de traidor**, aparte, porque no es un estado: ojos y boca quedan como
estén, y encima va la **grieta**, una columna coral de 1 px en x=8 con dos
escalones y un segundo ojo coral asomando en (8,8). Su chip es
`aleph.state.traidor` "abrió para sí", y se muestra **además** del chip del
estado: nunca más de dos chips.

Notas que un plan preguntaría:

- **El base no es un estado vacío: es el reposo, y se distingue justamente por
  no tener nada encima.** Es el más frecuente de la pantalla y por eso lleva
  chip igual que los demás, el que decide `chipDeAsiento(seat, room)` (ver "De
  qué dato sale cada estado").
- **La corona dorada del ganador tiene piso de ancho: `Math.max(4, hw[0])`.**
  El spec deja que las siluetas se afinen hasta `hw = 2` en la fila de arriba
  (el piso de 4 rige solo entre los índices 3 y 8 del cuerpo, ver "La grilla"),
  y sin el piso la corona mediría 4 px sobre una grilla de 16 y tendría que
  meter cinco nodos en tres filas: el único asiento que todo el mundo va a
  mirar quedaría con una corona que casi no se ve, y solo en algunas siluetas.
  Con `hw[0] = 6` la corona va de x = 2 a x = 13 y sigue adentro de la grilla.
- **El dorso es el ícono de ALEPH**, la misma idea que el de `GameIcon.tsx:166-185`
  (ocho asientos alrededor de un pozo dorado) redibujada en píxeles, de **8×6**:
  cuatro rects que arman el anillo y uno dorado al centro. Va en **x = 4–11**, y
  en **y = 8–13** en `abandono` y **y = 9–14** en `votado` (el cuerpo ya bajó una
  fila): siempre inscripto en el cuerpo, gracias al piso de `hw ≥ 4` de esa
  franja. Es el reverso único de todo lo que está dado vuelta: el votado, el que
  abandonó y las cartas del mazo que faltan. El píxel del centro lleva el anillo
  de tinta alrededor, así que se lee sobre cualquier cuerpo; pero **si su propia
  fila ya quedó dorada por el bolsillo** se pinta en `--color-ink` en vez de oro:
  el dorso tiene que decirse sobre cualquier bolsillo, y un punto dorado sobre
  oro no dice nada. La comparación es **fila a fila**, no contra un umbral fijo
  de `filas`: el oro sube desde abajo hasta `y = 15 − filas` (hasta `y = 7` con
  las ocho), el dorso está una fila más abajo en `votado` que en `abandono`, y
  según en cuál de sus dos filas centrales caiga el píxel el caso empieza a las
  cuatro o a las cinco filas de oro. Un umbral escrito a mano se equivoca en una
  de las dos variantes.
- **La corona dorada no pisa la de identidad.** Vive en y = 0–2, la de identidad
  en y = 3–4, y la regla de zonas de "La grilla" las mantiene separadas con un
  test. El ganador se sigue reconociendo por su corona propia, que es lo que
  promete el párrafo de arriba: el estado nunca toca la identidad.
- **El votado y el que abandonó conservan la identidad.** El dorso tapa la cara,
  no la criatura: la silueta y el color siguen ahí. Una de las seis maquetas
  cambiaba la cara con el estado y todos sus muertos terminaban iguales; es el
  error que más caro sale en un formato cuyo drama es social.
- **El votado no se inclina.** Rotar seis grados una grilla de píxeles la hace
  puré antialiaseado, que es justo lo que `crispEdges` fue a evitar. Cae en
  escalones ortogonales: el cuerpo entero baja una fila (de 5–14 a 6–15), la
  corona baja con él y las patas no se dibujan. Todo sigue adentro de la grilla
  y no hace falta un solo nodo de más. Ojo con dónde vive ese desplazamiento:
  **no es un overlay y no sale de `capaDeEstado`**, porque mueve la capa de
  identidad. Lo aplica `nodosDe(rasgos, { estado })`, que es la única función
  que ve las dos capas. `capaDeEstado(estado, hw)` sigue devolviendo solo ojos,
  boca y overlay, y sigue sin ver la dirección.
- **La grieta se dibuja, no se parte.** Separar las dos mitades obligaría a
  dibujar el cuerpo dos veces (veinte rects en vez de diez) y a romper el tope
  de nodos. El golpe dramático queda: la columna coral aparece en 600 ms y
  atrás asoma otro ojo.
- **La marca de traidor convive con cualquier estado**: un traidor puede estar
  hablando, sellado, votado o ganar la Final. Se dibujan los dos overlays y se
  muestran los dos chips. Por eso la grieta entra en los tres peores casos del
  presupuesto de nodos y no en ninguna fila de la tabla de estados.

### De qué dato sale cada estado

El estado de un asiento se calcula con esta prioridad, en este orden, y la
primera que aplica gana:

| #   | estado      | condición exacta                                                                                                                                                        |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | `abandono`  | `room.status === "dissolved"` — sale del estado de la **sala**, no del asiento                                                                                          |
| 1   | `se_fue`    | `seat.status === "left"`; el monto sale de `results.find(r => r.kind === "offer" && !r.voided && r.accepted?.includes(a))?.eachGot`                                     |
| 2   | `votado`    | `seat.status === "voted_out"`                                                                                                                                           |
| 3   | `abandono`  | `seat.status === "abandoned"`                                                                                                                                           |
| 4   | `ganador`   | (a) **con Final**: la Final cerrada, ver abajo; (b) **sin Final**: `room.status === "settled"`, `seat.status === "finished"` y `!results.some(r => r.kind === "final")` |
| 5   | `sellado`   | `room.status === "playing"` y `stage.acted.includes(a)`                                                                                                                 |
| 6   | `hablando`  | `room.status === "playing"` y `a` es el autor del **último** mensaje de `messages` **cuyo `phase === stage.phase`**                                                     |
| 7   | `esperando` | `room.status === "playing"`, `stage.phase === "decide"` y el asiento sigue `alive`                                                                                      |
| 8   | `base`      | el resto (incluye `finished` sin corona, y todos los asientos en `lobby`, `funding` y `settled` sin corona)                                                             |

Las tres condiciones del medio piden `room.status === "playing"` a propósito:
con la sala liquidada nadie está sellado ni hablando, y en `lobby` o `funding`
no hay etapa que sellar — el árbitro ni siquiera manda `stage`. Está escrito
`room.status` y no `status` a secas porque `SeatStatus` no tiene ese valor
(`packages/game-sdk/src/aleph-rules.ts:38`: `alive | left | voted_out |
abandoned | finished`) y esta tabla es lo que un plan copia.

**El `!r.voided` de la fila 1 no es defensa de más.** El mazo trae **dos**
Ofertas (`buildDeck`, `packages/game-sdk/src/aleph.ts:198`) y el motor escribe
`r.accepted` entero **antes** de descubrir que aceptaron todos: ahí marca
`r.voided = true` y sale sin tocar `r.eachGot`
(`packages/game-sdk/src/aleph.ts:514-523`). Sin el filtro, el asiento que
aceptó la **segunda** Oferta hace match con la primera, anulada, y la insignia
dorada imprime `+undefined`. Es la misma trampa que el friso ya esquiva más
abajo. Y si aun con el filtro el `find` no devuelve `eachGot` —no debería
pasar, pero el árbitro puede cambiar—, la insignia `+{n}` **no se dibuja**: la
criatura se fue igual, pero no se inventa un número.

**El chip no sale del estado a secas, y `chipDeAsiento` lo resuelve para los
ocho.** `estados.ts` exporta además `chipDeAsiento(seat, room) => clave`, que es
el **único** lugar donde vive la tabla de chips —la columna "chip" de la tabla
de estados de arriba es su salida, no una segunda tabla— y se resuelve en este
orden, primera que aplica gana:

| #   | condición                     | clave                                                                               |
| --- | ----------------------------- | ----------------------------------------------------------------------------------- |
| 0   | `room.status === "dissolved"` | `aleph.seat.dissolved`                                                              |
| 1   | `room.status === "funding"`   | `aleph.seat.deposited` / `aleph.seat.pending` según `room.deposited`                |
| 1b  | `room.status === "lobby"`     | `aleph.seat.lobby` (enmienda 2026-09-24)                                            |
| 2   | el estado es `ganador`        | `aleph.state.ganador` con Final; `aleph.state.enPie` sin Final (enmienda)           |
| 3   | el estado es `hablando`       | `aleph.state.hablando`                                                              |
| 4   | el estado es `esperando`      | `aleph.state.esperando`                                                             |
| 5   | el estado es `sellado`        | `aleph.state.decidio` en `decide`, `aleph.state.listo` en `talk`                    |
| 6   | el resto                      | `aleph.seat.${seat.status}` — `alive`, `left`, `voted_out`, `abandoned`, `finished` |

> **Enmienda 2026-09-24 (pulido posterior al PR 2).** Dos chips cambiaron
> después de verlos en una sala real. En el lobby nadie está "en juego": la
> fila 1b da `aleph.seat.lobby` ("sentado"). Y la corona SIN Final (la sala
> liquidó antes de abrirla) ya no dice "ganó la Final", que contradecía la
> carta `aleph.scene.settledNoFinal` de al lado: da `aleph.state.enPie`
> ("quedó en pie"). También `columnasDe` pasó a contar las celdas de la grilla
> (sin los finalistas, con las sillas vacías del lobby).

La fila 6 es exactamente el ternario que hoy está adentro de `SeatRow`
(`page.tsx:459-463`), y por eso el `base` da `aleph.seat.alive` con la sala
`playing` o en `lobby` (ahí todos los asientos son `alive`) y
`aleph.seat.finished` con la sala `settled`. Las filas 0 y 1 van **arriba** de
todo porque en esos dos estados de sala el `seat.status` no dice nada: el
árbitro manda `alive` para todos. Es también la razón de que un asiento en
estado `abandono` lleve `aleph.seat.abandoned` cuando abandonó de verdad y
`aleph.seat.dissolved` cuando lo que se cayó fue la sala entera. Con esta
función en un solo lado, el ternario no se repite en la tarjeta ancha y en la
angosta.

**`dissolved` se resuelve arriba de todo** porque el estado del asiento no dice
nada ahí: en `lobby`, `funding` y `dissolved` el árbitro devuelve **todos** los
asientos con `status: "alive"` y `pocket: 0`
(`apps/server/src/aleph.ts:1023-1042`), así que no hay ningún `abandoned` ni
`left` del que salir. Sin esta fila, una sala disuelta se dibujaría con ocho
criaturas de reposo, como si estuvieran jugando — y contradiría la sección de
lobby, que pide el dorso y el 34 %. Es la variante visual de `abandono`: mismo
dorso, misma opacidad, y su chip es `aleph.seat.dissolved` ("la sala se
disolvió"), clave nueva. **No se reusa `aleph.room.status.dissolved`**: su
texto es "DISUELTA" (`apps/web/app/lib/i18n/es.ts:543`), el rótulo en
mayúsculas del estado de la **sala**, que el encabezado ya pinta una vez
(`apps/web/app/aleph/[roomId]/page.tsx:141-143`); repetido en cada una de las
ocho tarjetas no dice qué le pasó a ese asiento y rompe el registro en
minúscula del resto de los chips.

**`hablando` pide además que el mensaje sea de la fase en curso.** `messages`
viene filtrado por **etapa** y no por fase (`viewFor`,
`packages/game-sdk/src/aleph.ts:698-700`), y al pasar de `talk` a `decide` el
motor limpia `ready` y `msgCount` pero **no** toca `s.messages`
(`packages/game-sdk/src/aleph.ts:426-433`). Sin el recorte, el último que habló
en la charla se quedaría con el chip "habla" durante toda la fase de decisión
—minutos, con un sondeo de 10 s— tapándole su "sin decidir", que es lo que de
verdad está haciendo. Cada mensaje trae su `phase`
(`packages/game-sdk/src/aleph.ts:32-38`), así que el recorte no cuesta un pedido
más al árbitro. Y el recorte es por `m.phase === stage.phase`, no por
`stage.phase === "talk"`: `say` no está limitado a la fase de charla
(`packages/game-sdk/src/aleph.ts:357-378`), así que alguien que habla durante
`decide` sí está hablando de verdad.

Y la marca:

- **traidor**: `results.find(r => r.kind === "lock")?.traitors?.includes(a)`. Es
  permanente una vez revelada: es dato cerrado. Hay como mucho una Cerradura por
  mazo.

**El ganador de la Final**, a partir de `results.find(r => r.kind === "final")?.choices`:

- un solo `steal` → **ese** asiento lleva corona (se llevó el pozo);
- los dos `split` → **los dos** llevan corona (dividieron y ganaron los dos);
- los dos `steal` → **ninguno** (el pozo se quemó).

El finalista que dividió mientras el otro robaba queda en el estado base, con
su monto real. No lleva faja de votado ni aura de traidor: no lo votó nadie,
perdió por confiar.

**Una sala puede liquidar sin Final, y es el caso común.** La Final solo se
abre cuando quedan exactamente dos vivos: si una etapa deja **uno**, el
director le da el pozo entero, lo marca `finished` y cierra ahí mismo; si no
queda **ninguno**, el pozo se lo come la caja y también cierra
(`packages/game-sdk/src/aleph.ts:622-635`, `direct()`). Es alcanzable de sobra
—una Oferta en la que aceptan todos menos uno no se anula y deja un solo vivo,
y dos ausencias seguidas abandonan un asiento (`aleph.ts:452-463`)— y en esas
salas `results` no tiene ningún `kind === "final"`. Con un solo vivo, **ese
asiento lleva corona igual**: se llevó el pozo, que es lo que la corona
significa (fila 4b de la tabla). Con cero vivos no la lleva nadie. En las dos
variantes la carta de cierre no tiene desenlace de Final que mostrar, y lo
resuelve "La carta de etapa".

**Sellado dice dos cosas distintas según la fase, y las dos son ciertas.**
`stage.acted` es `[...Object.keys(decisions), ...ready]`
(`packages/game-sdk/src/aleph.ts:714`; el campo, con su comentario, en `:669-670`):
en fase `decide` son los que decidieron; en fase `talk` son los que mandaron
`ready`. El dibujo es el mismo sello —en las dos significa "actuó y no sabemos
qué"— y lo que cambia es el chip: "ya decidió" o "listo".

---

## La escena

Todo vive adentro de una `.win` con la barra `win-title win-title--cyan`
(`ESCENA.EXE`), en la misma columna `mx-auto max-w-2xl` que usa la página hoy.
La escena declara `container-type: inline-size` y tiene **un solo corte**:
`@container (min-width: 560px)` es ancha, abajo de eso es angosta. Es el mismo
componente en los dos anchos y **un solo dibujo de criatura**; si alguna vez la
escena necesita una variante de arte para mobile, el arte está mal
parametrizado.

Dos cosas que el corte no puede resolver solo, y que por eso quedan escritas:

- **Los números que cambian por ancho no viajan como prop.** `modeloDeEscena`
  sigue devolviendo `columnas {ancha, angosta}`, pero `Asientos.tsx` los
  publica como custom properties en el contenedor de la grilla —`style={{
"--cols-ancha": m.columnas.ancha, "--cols-angosta": m.columnas.angosta }}`— y
  el CSS hace `grid-template-columns: repeat(var(--cols-angosta), 1fr)` fuera
  del corte y `repeat(var(--cols-ancha), 1fr)` adentro. Un solo elemento no
  puede alternar dos valores de JS en una media query, y una clase armada al
  vuelo tampoco sirve: Tailwind v4 escanea literales y un `grid-cols-${n}` no
  genera nada. Es el mismo patrón de estilo inline que el repo ya usa para
  grillas de ancho variable (`apps/web/app/games/g2048/Game2048.tsx:129`,
  `apps/web/app/games/tetris/TetrisGame.tsx:226`). Por la misma razón
  `Criatura.tsx` **no recibe `tam` como número**: recibe una clase
  (`criatura--mesa`, `criatura--charla`, `criatura--final`,
  `criatura--probador`) cuyo `width`/`height` cambian en el corte. El `viewBox`
  de 16 es siempre el mismo y los tamaños siguen siendo múltiplos de 16 en los
  dos anchos (mesa 64/48, final 96/64, charla 32, probador 128).
- **La etiqueta se monta en las dos formas y el corte esconde una.**
  `playerLabel` devuelve un **string plano**
  (`apps/web/app/lib/wallet.tsx:47-50`), así que la versión ancha es un solo
  nodo de texto y la angosta son tres cajas con reglas distintas (perfil con
  `truncate`, wallet en mono sin `truncate`, chip aparte): no hay media query
  que parta un string. `Asientos.tsx` emite los dos bloques, el ancho con
  `display: none` fuera del corte y el angosto con `display: none` adentro, y
  el que está escondido lleva `aria-hidden="true"` para que el lector de
  pantalla no lea la identidad dos veces. **Son las únicas dos reglas
  duplicadas de la escena y están acá a propósito.**

A 375 px de pantalla el contenedor mide unos 319 px (`px-4` del layout más
`p-3` de la tarjeta). A 672 px de columna mide 648. Los dos números están
medidos contra el layout que ya existe (`apps/web/app/layout.tsx:154`,
`mx-auto max-w-5xl px-4 py-8`) y contra la columna de la propia página
(`apps/web/app/aleph/[roomId]/page.tsx:129`, `mx-auto max-w-2xl`). Los dos caen
del lado que corresponde del corte de 560 px.

### Orden vertical

1. **Barra de ventana**: `ESCENA.EXE` y, **solo en `lobby`**, el reloj `mm:ss`
   en mono a la derecha, sacado de `closesAt`. En los otros cuatro estados la
   barra va sin reloj, porque el reloj que corresponde ya está en pantalla y
   dos cuentas regresivas iguales a diez píxeles una de otra son el duplicado
   que este mismo spec le saca al encabezado (decisión 16): en `playing` el
   reloj es el de la carta de etapa (`deadline`), en `funding` es el que el
   encabezado ya imprime con `aleph.room.fundingDeadline`
   (`apps/web/app/aleph/[roomId]/page.tsx:167-170`, una rama que el spec no
   toca), y en `settled` y `dissolved` no hay reloj. El de `lobby` es el único
   de los tres que hoy no se muestra en ningún lado, y por eso es el único que
   la barra se queda. Ojo con él: el intervalo de un segundo de la página no
   corre en ese estado, así que hay que sumarle la rama (ver "Archivos que se
   tocan") o el mm:ss queda congelado. El chip de estado de sala y el de stake
   **no se repiten acá**: están en el encabezado de la página, donde ya están
   hoy.
2. **Carta de etapa**.
3. **Friso de etapas**.
4. **La mesa**: pozo, caja y mazo como objetos, la barra del invariante y su
   línea.
5. **Los asientos**.
6. **Botón "Pausar movimiento"**, al pie, alineado a la derecha
   (`btn3d btn3d--cyan btn3d--sm`).

Después de la escena, en sus propias ventanas: la **charla**, el **relato en
texto de hoy** (`QUE_PASO.TXT`, intacto) y, al liquidar, **quién votó a quién**
y la **tabla de pagos** (intacta).

### Lo que se reusa del sitio

Nada de esto se inventa de nuevo: `.win` y `win-title--cyan` para las ventanas,
`.paper` para los paneles de lectura, `.chip` para los estados, `.btn3d--sm`
para el único botón, `mmss()` para el reloj, `LocaleLink`, `useT` y
`playerLabel`/`agentTag` de `wallet.tsx`.

Dos de esos no están todavía donde el spec los pide, y el plan tiene que
moverlos:

- **`mmss()` no es una utilidad del sitio**: hoy es una función privada de
  módulo adentro de `apps/web/app/aleph/[roomId]/page.tsx:36-39`, sin `export` y
  fuera de `app/lib/`. Se muda a `apps/web/app/lib/tiempo.ts` con `export`, y la
  página la sigue usando para su encabezado, mismo texto y mismo formato.
- **`etiquetaDe` se expone en dos formas.** `etiquetaDe(seat) => string` para
  todo lo que tiene el asiento a mano, y `etiquetaDePorDireccion(address) =>
string` para lo que solo tiene una dirección suelta: los `from`/`to` de la
  charla desclasificada y el `voter`/`target` de la ventana de votos.
  **La segunda no es una función nueva**: es el `label()` que ya vive en
  `apps/web/app/aleph/[roomId]/page.tsx:118-124`, renombrado, con el fallback
  cambiado de `address.slice(0, 10) + "…"` a `shortAddress(a)`. La tabla de
  pagos y `stageLines` la siguen usando: no quedan dos helpers casi iguales
  abreviando la misma dirección desconocida de dos formas distintas en la misma
  pantalla.

Tipografía: **pixel (Press Start 2P)
solo para identidad y cifras** —barras de ventana, montos, el número de etapa—,
**Inter para todo el cuerpo** y mono para la wallet corta y el reloj. Es la
regla del rediseño de 2026-07-03 y acá no cambia.

**Los chips de estado quedan como hoy: `.chip` a secas, sin variante de color.**
Ocho chips de colores romperían la regla de menos de tres acentos por pantalla,
y no hacen falta: el estado lo cuenta el dibujo. Las dos únicas excepciones son
la insignia `+{n}` del que se fue con plata, que va en gold porque es plata, y
el chip del traidor, que va `.chip--danger` porque es raro y es grave.

### La carta de etapa

Un bloque con borde izquierdo cyan de 2 px:

- `aleph.room.stageHead` — "Etapa {n} · {kind}", con `n = stage.index + 1` y
  `kind = aleph.stage.<kind>`. **Sin "de N"**: el total no existe (decisión 13).
- El chip de fase: `aleph.phase.talk` / `aleph.phase.decide`.
- El reloj `mm:ss` en mono dorado, de `deadline`, con la función `mmss()` que ya
  está en la página.
- **La regla de esa etapa en una línea**, en muted (`aleph.rule.<kind>`). Es el
  injerto de naipes y es lo único en todo el concurso que le explica el juego a
  alguien que cayó en la etapa 6.
- **El contador**, solo mientras la sala está `playing`: en `decide`,
  `aleph.scene.acted` "Ya actuaron {k} de {n}."; en `talk`, `aleph.scene.ready`
  "Ya dijeron listo {k} de {n}.". `n` son los vivos
  (`seats.filter(s => s.status === "alive").length`) y `k` son los de
  `stage.acted` que siguen vivos.

Con la sala liquidada, la carta cambia por `aleph.scene.settledTitle` ("La sala
liquidó.") más la línea del desenlace, **y solo si hubo Final** (o sea, si
`results.some(r => r.kind === "final")`): `aleph.line.finalSplit` si no robó
nadie, `aleph.line.finalSteal` si robó uno —esa clave lleva variable,
`"{who} se robó el pozo entero."` (`apps/web/app/lib/i18n/es.ts:615`), y `{who}`
se resuelve con `etiquetaDePorDireccion(el único steal)`, igual que hoy en
`page.tsx:526`— y `aleph.line.finalBurn` si robaron los dos. **Si la sala
liquidó sin Final** —el director cierra directo con uno o cero vivos,
`packages/game-sdk/src/aleph.ts:622-635`— va `aleph.scene.settledNoFinal` ("La
sala terminó antes de la Final."), que es clave nueva. En `lobby`, `funding` y
`dissolved` **no hay carta de etapa ni friso ni mesa**: el árbitro no manda
`stage`, `results`, `pot` ni `box` en esos estados (ver "Lobby y sala a medio
llenar").

### El friso

Una fila de cartas chiquitas de 14×20 px, `flex-wrap`, marcadas como `<ol>` con
`aria-label` `aleph.frieze.title`:

- **Jugadas**, una por `results[]`, de frente: fondo `surface-2`, borde muted,
  el glifo de la etapa adentro (≤ 4 rects: dos barras el Reparto, una moneda la
  Oferta, una ranura el Voto, un candado la Cerradura, dos flechas la Final) y
  hasta dos marcas en las esquinas:
  - **salida** (una cruz chica) si en esa etapa alguien dejó la mesa **de
    verdad**: `r.eliminated`, o `r.abandoned?.length`, o
    (`r.accepted?.length && !r.voided`). Una Oferta anulada trae `accepted`
    lleno y sin embargo no se va nadie: el motor escribe `r.accepted` y recién
    después descubre que aceptaron todos, anula la oferta y sale **antes** de
    tocar un solo `seat.status` (`packages/game-sdk/src/aleph.ts:514-523`).
    Marcar una salida ahí contradiría a "Momentos → Oferta del demonio", que ya
    dice que con `voided` no se va nadie;
  - **premio** (un punto dorado) si la caja le devolvió al pozo: `bonus > 0`.
- **La actual**, de frente, con borde coral y 2 px más alta. **Solo mientras la
  sala está `playing`**: cuando liquidó no hay etapa en curso, y la última ya
  está en `results` (dibujarla dos veces sería un duplicado).
- **Las que faltan**, `cardsLeft` dorsos al 45 % de opacidad, también solo
  mientras está `playing`: cuando liquidó, la Final cortó el mazo y dibujar
  dorsos sería mentir sobre etapas que nunca se van a jugar.

Cada carta lleva su `aria-label`: `aleph.frieze.played`, `aleph.frieze.current`,
`aleph.frieze.back`, más `aleph.frieze.left` y `aleph.frieze.bonus` en las
marcas. Con ocho asientos el mazo arranca con 10 cartas (`buildDeck`: dos
Ofertas, una Cerradura, un Reparto y N−2 Votos) más el Reparto de apertura y la
Final, así que la sala llega a unas 12 etapas: entran en una fila a 375 px con
cartas de 14 px y 4 px de separación (12 × 18 = 216 px sobre 319 disponibles).
Más de eso, envuelve.

### La mesa: pozo, caja y mazo

Tres objetos dibujados en la misma técnica de la criatura (grilla de 16×16,
`crispEdges`, `aria-hidden="true"`), con el número al lado en `font-pixel`:

- **Pozo**: una olla dorada. Monto `pot` en gold, y **nada debajo**. El
  "Arrancó en {potInitial}" que tenía el encabezado no se trae: `potInitial` no
  es el pozo de salida sino el **total de la mesa** (`1000 × N`), así que ese
  rótulo afirmaba que el pozo había empezado en 8.000 cuando en una mesa de 8
  empezó en 6.400. El total ya lo imprime la línea del invariante, tres líneas
  más abajo, y con el nombre correcto. `aleph.room.potInitial` queda sin ningún
  uso en la web y **se borra de los cuatro diccionarios** (ver "Archivos que se
  tocan").
- **Caja del demonio**: un cofre oscuro con lacre coral. Monto `box`. El cofre
  tiene tres tamaños de tapa según `box / total` (< 25 %, < 40 %, ≥ 40 %): es la
  única forma de que "engorde etapa a etapa" sin inventar un dato.
- **Mazo**: tres cartas apiladas con el dorso de ALEPH, rotuladas
  `aleph.scene.deck` ("Mazo") como el pozo y la caja llevan `aleph.room.pot` y
  `aleph.room.box`, y `cardsLeft` al lado
  (`aleph.scene.deckLeft`, "{n} sin dar"). Con `cardsLeft === 0` se dibuja
  igual, apagado. **Con la sala `settled` el mazo se dibuja apagado y sin
  número**: la Final entra sin sacar carta
  (`packages/game-sdk/src/aleph.ts:635`), así que `cardsLeft` queda en lo que
  sobró y anunciar "{n} sin dar" de una sala terminada es exactamente lo que el
  friso evita al no dibujar esos dorsos. Al pie, `aleph.scene.deckNote`: "El
  orden del mazo es secreto, y la Final no sale de ahí."

**La barra del invariante**, `aria-hidden="true"`, tres segmentos sobre el
total: pozo en gold, caja en coral, bolsillos en `muted-bright`. El total es
`potInitial` tal cual, sin sumar nada, porque el invariante del juego es:

```
pot + box + Σ seats[].pocket === potInitial      // == 1000 × N
```

`potInitial` es el **total de la mesa**, no el pozo de salida: el motor lo
calcula como `UNITS_PER_SEAT * addrs.length` y recién después le saca la caja
(`packages/game-sdk/src/aleph.ts:293-305`). Las quemas tampoco destruyen
unidades: van a la caja (`aleph.ts:519-520`, `578-580`, `613`), y por eso la
igualdad se sostiene toda la sala — está testeada en
`packages/game-sdk/test/aleph-invariants.test.ts` con `assertConserved`
(`packages/game-sdk/test/aleph-helpers.ts:62`).

Debajo, en texto, `aleph.scene.invariant`: "Pozo {pot} + caja {box} + bolsillos
{pockets} = {total}". Es el injerto de robots hecho bien: en vez de dos
segmentos que estiman el decaimiento, tres segmentos que **son** la cuenta que
cierra.

Una marca fina de 1 px sobre la barra muestra de dónde arrancó el pozo, y va en
**0,80**, que es `1 − ALEPH_RULES.BOX_BPS / 10000`
(`packages/game-sdk/src/aleph-rules.ts:18`, `BOX_BPS: 2000`). Es una constante
de reglas, no un cociente de la vista, porque la caja inicial no se publica por
separado. Lo que **no** sirve para ubicarla es `potInitial / total`: como
`potInitial` **es** el total, ese cociente da 1,0 y la marca queda pegada al
borde derecho sin significar nada. La marca entra, y el 0,80 se escribe como
constante local de `Mesa.tsx` con el comentario que la ata a
`ALEPH_RULES.BOX_BPS`, **no se importa**: `ALEPH_RULES` no sale del entrypoint
raíz del paquete (`packages/game-sdk/src/index.ts` no exporta nada de Aleph), y
el único subpath que lo re-exporta es `@arcade1v1/game-sdk/aleph`
(`package.json:26-37`; `aleph.ts:21` hace `export * from "./aleph-rules"`), que
arrastraría el motor entero de Aleph —`createAleph`, `replayAleph`, `viewFor`—
al bundle de la web por un solo número. La web ya importa constantes del
game-sdk por subpath cuando el subpath es barato (`RULES_V` desde
`@arcade1v1/game-sdk/rules`, `apps/web/app/game/[gameId]/match/page.tsx:18`);
acá no lo es, y una línea de partida fija no vale el peso.

**Con la sala `settled` la barra del invariante no se dibuja.** El motor no
vacía la caja al liquidar: `finish()` reparte `box / N` dentro de `payouts` y
deja `s.box` y los `seat.pocket` intactos
(`packages/game-sdk/src/aleph.ts:641-652`). Un segmento de caja con 1.800
adentro, arriba de una tabla de pagos donde esos mismos 1.800 ya están
repartidos, cuenta la misma plata dos veces — y el segmento "bolsillos" leería
`pocket` mientras las criaturas de al lado ya leen `payouts`, o sea dos escalas
distintas para la misma plata. En `settled` la Mesa conserva los tres objetos
(pozo en 0, caja apagada, mazo apagado) y en lugar de la barra va una sola
línea, `aleph.scene.settledSplit`: "La caja se repartió en partes iguales:
{each} para cada asiento." De ahí en adelante **nada en la pantalla lee
`pocket`**: el oro de las criaturas y los montos leen `payouts`.

**`{each}` lo calcula `Mesa.tsx`**, porque el árbitro no lo publica:
`each = Math.floor(box / seats.length)`, igual que el motor
(`packages/game-sdk/src/aleph.ts:642-643`). Es sobre **todos** los asientos, no
sobre los vivos ni sobre los que cobraron: los `abandoned` que llegaron con
`pocket: 0` cuentan igual. El resto de la división entera —`box − each ×
seats.length`, menos de un asiento de unidades— se lo lleva entero el bolsillo
más grande (`aleph.ts:647-648`), así que "en partes iguales" tiene una cola de
polvo que la línea no muestra: es la misma que ya está en la tabla de pagos de
abajo, verificable contra el registro firmado, y no vale una segunda frase.

Esto **reemplaza** los tres bloques `Money` del encabezado actual. Mismos datos,
ahora dibujados, con las mismas claves `aleph.room.pot` y `aleph.room.box`.

### Los asientos

- **Contenedor ancho (≥ 560 px)**: tarjeta vertical, criatura de **64 px**
  arriba y la etiqueta abajo. Columnas por cantidad de asientos: **4 → 4
  columnas**, **5 o 6 → 3**, **7 u 8 → 4**. Con 4 asientos cada celda mide unos
  150 px y la criatura de 64 px queda centrada con aire; la mesa y el friso,
  que ocupan todo el ancho, son los que impiden que la escena se vea flaca.
- **Contenedor angosto (< 560 px)**: tarjeta horizontal —criatura de **48 px** a
  la izquierda, etiqueta y chips a la derecha— y **dos columnas siempre**. Con 4
  asientos son dos filas; con 8, cuatro. Cada celda mide unos 155 px, así que a
  la derecha de la criatura quedan ~100 px y `playerLabel` entero no entra: la
  etiqueta se parte en dos renglones. Arriba, el perfil `{avatar} {nombre}` con
  `truncate` (si no hay nombre, no va nada). Abajo, `shortAddress(address)` en
  mono de 10 px (~78 px) **sin `truncate` nunca**, y el chip CASA/WEBHOOK como
  chip aparte debajo. La wallet abreviada no se corta en ningún ancho: es la
  regla anti-suplantación de `apps/web/app/lib/wallet.tsx:41-50`, no una
  preferencia de layout, y este spec promete en su segunda línea que nunca
  desaparece. Sin scroll lateral (`body` ya lleva `overflow-x: clip`).

Cada tarjeta lleva, en este orden:

1. La criatura, con su `aria-label`.
2. La etiqueta. En contenedor ancho es exactamente la de hoy, el string plano
   `playerLabel(address, name, avatar, agentTag(seat, t))`, que entra entero. En
   angosto son los dos renglones de arriba, con los mismos datos y el mismo
   orden de precedencia (CASA gana sobre WEBHOOK). El `aria-label` de la
   criatura, en cambio, **no usa `playerLabel`**: es `aleph.a11y.criatura` con
   `{wallet} = shortAddress(seat.address)` y nada más, porque el nombre, el
   avatar y el chip CASA/WEBHOOK ya están en la etiqueta HTML de al lado y
   meterlos también adentro del SVG los hace sonar dos veces (ver
   "Accesibilidad").
3. El chip de estado, y el de traidor si corresponde (máximo dos).
4. El monto en `font-pixel` gold: `payouts[address] ?? seat.pocket`, igual que
   hoy.

**Sillas vacías: solo en `lobby`.** Una celda con marco punteado y un dorso al
25 % adentro, sin etiqueta, con `aria-label` `aleph.scene.emptySeat`. Cuántas:

```
sillas = Math.max(min − seats.length, seats.length < max ? 1 : 0)
```

O sea: las que faltan para el mínimo y, si el mínimo ya está, **una sola** para
decir que todavía entra alguien. Dibujar cuatro sillas vacías en una mesa de
cuatro sería un cartel de "acá no hay nadie".

**En `funding` no se dibuja ninguna silla vacía.** La lista de asientos ya está
congelada: `enterFunding` saca la sala de `openLobby`
(`apps/server/src/aleph.ts:461-468`) y `joinAleph` solo se sienta en salas con
`status === "lobby"` (`apps/server/src/aleph.ts:402-406`), así que una sala en
fondeo no es alcanzable por ningún `join`. Una silla vacía ahí significaría, en
el vocabulario que este mismo spec le da, "todavía entra alguien", y es falso:
ese lugar no se puede ocupar nunca. Se dibujan exactamente los asientos que hay,
cada uno con su chip `aleph.seat.deposited` / `aleph.seat.pending` — que es el
único dato que se mueve en ese estado (`apps/server/src/aleph.ts:1031`).

**Durante la Final la grilla se parte en dos.** Cuando `stage.kind === "final"`
(o, con la sala liquidada, cuando el último resultado es la Final), arriba va
una fila de dos con los finalistas a **96 px** en contenedor ancho y **64 px**
en angosto, enfrentados, con la olla del pozo dibujada en el medio; abajo sigue
la grilla normal con los que ya salieron. Es el único momento en que la escena
cambia de forma.

### La charla, como terminal

Ventana aparte, debajo de la escena: `.win` con la barra `CHARLA_PUBLICA.TXT` y,
a la derecha de la barra, un chip con `aleph.chat.caps` ("Cada agente puede
mandar 3 mensajes por fase, de hasta 280 caracteres"), que explica por qué hay
tan pocas líneas. Adentro, fondo `--color-ink`, mono de 12,5 px y
`overflow-wrap: anywhere` para que una wallet no rompa la caja.

Una línea por mensaje de `view.messages`, en el orden en que vienen:

```
[criatura 32px]  0x1234…abcd  >  Si guardan todos, el pozo se muere.
```

La criatura es la misma función a 32 px, la wallet va en mono muted y el `>` en
coral. Va **siempre en estado `base`, sin marca de traidor y sin oro**: el
renglón cuenta lo que ese asiento dijo en ese momento, no en qué terminó, y una
corona, una moneda o un dorso al lado de un mensaje viejo adelantarían el final
—o, en vivo, le pondrían el sello de `decide` a algo dicho en la fase de
charla—. Y va con `aria-hidden="true"` y sin `aria-label`, por lo que dice
"Accesibilidad". Nada de globos de papel: el sitio ya reserva el registro monoespaciado
para los datos técnicos, y una terminal aguanta mejor que un globito el hecho
de que el mensaje pueda llegar nueve segundos tarde.

Al pie, dos líneas y en este orden:

1. `aleph.chat.private`, la línea de sistema con prefijo `::`: "el canal privado
   no publica nada, ni que existió, hasta que la sala liquide". **Fija, siempre,
   haya habido susurros o no.** Es lo único honesto: el navegador no sabe si
   hubo.
2. `aleph.chat.onlyThisStage`, en muted: mientras la sala juega, `messages` trae
   únicamente los públicos de la **etapa en curso** (`viewFor` filtra por
   `m.stage === st.index`). El historial completo se abre al liquidar.

Sin mensajes todavía, `aleph.chat.empty`. Nunca un contador de susurros, nunca
un "alguien está escribiendo": la vista trae `acted[]`, no sabe quién tipea.

**En `lobby`, `funding` y `dissolved` la ventana de charla no se monta.** El
árbitro no manda `messages` ahí —la rama devuelve los asientos, las cuentas
regresivas y el reembolso, y nada más (`apps/server/src/aleph.ts:1023-1042`)— y
no hay etapa en curso. `aleph.chat.empty` ("Todavía no habló nadie en esta
etapa") y `aleph.chat.onlyThisStage` nombran las dos una etapa que todavía no
existe, así que serían mentira, y una ventana entera prometería un canal que no
se abrió. `lineasDeCharla(room)` devuelve `null` cuando `room.messages ===
undefined`, y `Charla.tsx` con `null` no renderiza nada.

---

## Momentos

### Reparto

La carta de etapa dice la regla. Durante `decide` los vivos que no actuaron
están **esperando** y los que actuaron, **sellados** — nunca se sabe si
guardaron o aportaron. Cuando la etapa cierra, el resultado entra en `results[]`,
el friso suma una carta, los bolsillos de los que guardaron crecen y **el oro
sube dentro de sus criaturas**. Eso es todo el efecto: la diferencia se ve en el
cuerpo, no en un cartel.

### Oferta del demonio

Igual que el Reparto mientras corre. Al cerrar, los que aceptaron pasan a
`left`: ojos felices, moneda dorada, la insignia `+{eachGot}` en gold —del
`results.find(r => r.kind === "offer" && !r.voided && r.accepted?.includes(a))`
de la tabla de prioridades, con el `!r.voided` que evita el `+undefined`, y sin
insignia si el `find` no trae monto— y el
cuerpo al 80 % de opacidad para que se lea que ya no juega. Su tarjeta se queda
en su lugar de la grilla: no hay pila aparte. Si la oferta se
anuló porque aceptaron todos (`voided`), nadie se va y el pozo pega un salto
para abajo en la barra del invariante: es el único lugar donde la quema del
10 % se ve.

### Voto

La etapa con más lectura y la que más se puede arruinar. La carta dice: "El más
votado deja la mesa con su bolsillo. Quién votó a quién no se muestra hasta que
la sala liquide." Durante la fase de charla, la terminal se llena; durante
`decide`, los sellos aparecen de a uno y el contador sube. Al cerrar, el
eliminado se da vuelta (dorso, caída en escalones) y los **votos recibidos** de
`results[].votes` se cuentan en el relato de texto de abajo, como hoy.

### Cerradura

Al cerrar, si hubo traidores, **la grieta aparece en 600 ms** sobre sus
criaturas y queda para siempre. Es una de las tres únicas cosas que se animan
solas en toda la sala. Si no traicionó nadie, la caja premia al pozo y el friso
marca el punto dorado.

### Final

La Final entra sola cuando quedan **exactamente** dos vivos, y puede no entrar
nunca: con uno o cero, el director liquida directo y la sala termina sin Final
(ver "El ganador de la Final"). Los que ya salieron siguen en la
grilla con su estado; los dos finalistas se dibujan más grandes
(96 px en ancho, 64 en angosto) y enfrentados, con el pozo en el medio. Al
cerrar, **los dos revelan en el mismo cuadro** (`aleph-revela`, 500 ms, nunca
uno antes que el otro) y se aplica la regla de la corona de la sección
anterior. El texto del desenlace es el que ya existe (`aleph.line.finalSplit` /
`finalSteal` / `finalBurn`).

### La liquidación

Es el pico del formato y no lo diseñó ninguna de las seis maquetas. Pasan cinco
cosas cuando `status` llega a `settled`:

1. **La carta de etapa se convierte en el cierre**: "La sala liquidó." más la
   línea del desenlace si hubo Final, o `aleph.scene.settledNoFinal` si la sala
   cerró sin jugarla (ver "La carta de etapa").
2. **La terminal desclasifica.** Al terminar la sala, `viewFor` deja de filtrar
   y `messages` trae **todos** los mensajes, también los privados
   (`aleph.ts:698`). La terminal pasa a mostrar la sala entera, en el orden en
   que llegan (que es el orden cronológico de inserción del motor: **no se
   reordena**), con una línea separadora por etapa (`aleph.chat.stageSep`, ":: etapa
   {n} · {kind}") y los susurros en su lugar, marcados: prefijo coral en vez de
   cyan, borde izquierdo coral, chip `SUSURRO` y `aleph.chat.whisperTo` ("a
   {who}"). Arriba de todo, una sola vez, `aleph.chat.declassified`.
3. **Se publica quién votó a quién.** Una ventana nueva,
   `QUIEN_VOTO_A_QUIEN.TXT`, en panel `.paper`. Sale de `getAlephLog(roomId)`
   (`apps/web/app/lib/arbiter.ts:348`), que devuelve 400 hasta que la sala está `settled`. **La
   pide la página**, una sola vez, cuando el estado llega a `settled`, y le pasa
   los eventos al componente; si el pedido falla, el bloque muestra solo la
   línea `aleph.votes.unavailable`, que apunta al enlace del registro firmado
   que ya existe. Las líneas salen de `events.filter(e => e.type === "action" &&
e.action.type === "vote")`, agrupadas por `e.stage`, con el encabezado de
   etapa y `aleph.votes.line`, "{voter} votó a {target}.". Si no hubo ninguna
   etapa de Voto —pasa en mesas cortas—, va `aleph.votes.empty`.
   **No hay votos repetidos**: el motor rechaza una segunda decisión en la misma
   fase (`packages/game-sdk/src/aleph.ts:385,393`, "already decided"). **Sí hay
   votos que no dejan evento**: el asiento que no vota queda contado en contra
   de sí mismo al resolver la etapa
   (`packages/game-sdk/src/aleph.ts:543`, `// ausente: en contra propio`), y eso
   lo pone el motor, no una acción firmada, así que no aparece en `room.events`.
   Por eso, debajo de cada grupo de etapa va `aleph.votes.implied` — "Los que no
   votaron cuentan como voto contra sí mismos: {who}" —, con `who` = los vivos
   de esa etapa (según `results[].votes`, que los lista a todos) que no aparecen
   como `voter` en los eventos. Sin esa línea, una etapa con dos ausentes
   muestra menos votos de los que el relato de abajo ya cuenta con
   `aleph.line.votes`, en la misma pantalla, y parece un bug del registro.
4. **Cada criatura muestra con cuánto se fue.** El oro del cuerpo y el monto de
   la tarjeta pasan a leer `payouts[address]`, y la barra del invariante deja de
   dibujarse: la reemplaza `aleph.scene.settledSplit`, por la razón que está en
   "La mesa".
5. **El friso queda completo**, sin dorsos, y el mazo se apaga sin número.

La semilla revelada (`secretSeed`), el compromiso (`commit`), la tabla de pagos
y el enlace al registro firmado siguen exactamente donde están hoy, sin tocar
una línea.

### Lobby y sala a medio llenar

En `lobby`, `funding` y `dissolved` el árbitro **no manda** `pot`, `box`,
`stage`, `results` ni `messages`: `roomView` devuelve solo las cuentas
regresivas, el reembolso y los asientos, con `status: "alive"` y `pocket: 0`
para todos (`apps/server/src/aleph.ts:1023-1042`). La escena de esos tres
estados es, entonces, corta y honesta — y **sin ventana de charla**, por lo que
dice "La charla, como terminal":

- **`lobby`**: la barra de ventana con la cuenta regresiva de `closesAt` y nada
  más —el chip LOBBY vive en el encabezado de la página y no se repite acá, por
  lo que dice "Orden vertical"—; los asientos ocupados con su criatura (la
  dirección ya viene, y ya
  viene decorada con nombre, avatar y `house`); las sillas vacías según la
  fórmula de arriba; y **nada de texto**: la línea que explica cuántos faltan ya
  está arriba, en el encabezado de la página que este spec no toca
  (`aleph.room.lobbyIntro`, `apps/web/app/aleph/[roomId]/page.tsx:154-161`).
  `aleph.lobby.needs` es de la lista de mesas
  (`apps/web/app/aleph/page.tsx:319`) y no se reusa acá: montarla adentro de la
  escena dejaría dos frases diciendo lo mismo, una arriba de la otra. Sin mesa,
  sin friso, sin carta de etapa: todavía no hay nada de eso.
- **`funding`**: lo mismo, con el chip `aleph.seat.deposited` /
  `aleph.seat.pending` por asiento, como hoy, **y sin sillas vacías**: la lista
  ya está congelada. **Sin cuenta regresiva en la barra de ventana**: la de
  `fundingDeadline` ya la imprime el encabezado de la página con
  `aleph.room.fundingDeadline` (`apps/web/app/aleph/[roomId]/page.tsx:167-170`),
  y repetirla es el duplicado que "Orden vertical" evita. Ningún cuerpo tiene
  oro: nadie tiene bolsillo todavía.
- **`dissolved`**: las criaturas de los que se habían sentado en el estado
  `abandono` —al 34 % y con el dorso puesto—, que es lo que resuelve la fila 0
  de la tabla de prioridades, con el chip `aleph.seat.dissolved` ("la sala se
  disolvió", clave nueva: ver "De qué dato sale cada estado" para por qué no se
  reusa `aleph.room.status.dissolved`); más el texto y el bloque de reembolso que
  ya están en la página. No se dibuja mesa.

---

## Movimiento y accesibilidad

### Cuatro animaciones y ninguna más

Van en `globals.css`, al lado de las cuatro que ya existen (`marquee`, `blink`,
`tile-pop`, `rise-fade`):

| clase                | qué hace                                                                | cuándo                      |
| -------------------- | ----------------------------------------------------------------------- | --------------------------- |
| `aleph-respira`      | 3,2 s, `steps(2)`, la criatura sube y baja 1 px                         | siempre, solo en los vivos  |
| `aleph-grieta`       | 600 ms, la columna coral del traidor crece de arriba a abajo (`scaleY`) | una vez, al revelarse       |
| `aleph-revela`       | 500 ms, los dos finalistas a la vez                                     | una vez, al cerrar la Final |
| `aleph-desclasifica` | 400 ms, las líneas de susurro entran                                    | una vez, al liquidar        |

El desfase de la respiración sale del **byte 11** de la dirección, el primero
que no usa ningún rasgo: `animation-delay: -(b & 7) * 0,4s`, negativo para que
arranque ya corrida y ocho criaturas no latan en bloque. Es
azar **decorativo** y vive en el mismo archivo que la criatura: el azar del
juego sigue saliendo de SHA-256 del secreto (reglas v2) y nada de esto toca al
servidor ni al contrato. Lo avisa la auditoría del 2026-09-18.

**Las animaciones reaccionan a diferencias entre dos sondeos, no a eventos.** El
sondeo es cada 10 s (`REFRESH_MS`) y se reprograma después de cada respuesta;
no hay WebSocket ni SSE, y el árbitro dormido puede tardar 40 s en contestar. La
página guarda la vista anterior y compara:

- `results.length` creció y el último resultado es un `lock` con
  `traitors.length > 0` → `aleph-grieta` sobre esos asientos.
- `results.length` creció y el último es un `final` → `aleph-revela`.
- `status` pasó de `playing` a `settled` → `aleph-desclasifica`.

**No hay cola.** Si el espectador vuelve de un alt-tab de diez minutos y llegan
tres resultados juntos, se anima **solo el último** y el resto aparece ya en su
estado final. Es la misma disciplina que `CATCHUP_MAX_MS` en los juegos: ver el
estado verdadero vale más que ver el teatro atrasado.

**Ninguna animación esconde su estado final.** Cada una va _hacia_ el estado de
reposo, nunca al revés: la grieta está en el marcado desde el primer cuadro y la
animación solo la descubre (`scaleY` de 0 a 1), así que con `animation: none` se
ve entera. Apagar el movimiento no pierde un solo dato.

### Apagar el movimiento

Dos caminos, y los dos apagan lo mismo:

- `@media (prefers-reduced-motion: reduce)`: las cuatro clases nuevas se suman
  al bloque que ya existe (`globals.css:416-432`), con `animation: none`.
- **Un botón visible**, `aleph.scene.pause` / `aleph.scene.resume`, al pie de la
  escena, que pone `sin-movimiento` en `<body>`; la clase duplica cada regla.
  Una sala dura 40 minutos y el media query no cubre a quien simplemente se
  cansa.

La preferencia se guarda en `localStorage` bajo `aleph.movimiento` (`"off"` /
`"on"`), leída y escrita **siempre dentro de `try/catch`**: en una ventana
privada, con las cookies bloqueadas o durante una captura, el acceso tira. Si no
se puede leer, el default es con movimiento. La clase se aplica en un `useEffect`,
así que en la primera pintura puede haber un cuadro de movimiento antes de que
se apague: no hay salto de layout ni dato perdido, y no vale la pena un script
inline en el `<head>` por eso.

### Accesibilidad

- Cada criatura **de la mesa** es un `<svg role="img">` con `aria-label` =
  `aleph.a11y.criatura`, "Criatura de {wallet}, {estado}", donde `{wallet}` es
  `shortAddress(address)` y `{estado}` es el mismo texto del chip: un lector de
  pantalla oye exactamente lo que se ve, sin repetir el nombre y el tag que ya
  leyó en la etiqueta de al lado.
- **La criatura de la charla va `aria-hidden="true"`**, como el `Logo` del sitio
  (`apps/web/app/components/Logo.tsx:40`): cada línea de la terminal ya empieza
  con la wallet escrita en texto, y anunciar una criatura por mensaje hace
  ilegible una sala liquidada de decenas de líneas. En el friso y en las sillas
  vacías no hay criaturas —hay glifos y dorsos, que salen de `Objetos.tsx`— y
  van `aria-hidden` por la regla de la línea siguiente.
- Pozo, caja, mazo, glifos del friso y la barra del invariante van
  `aria-hidden="true"`: su información está en el texto de al lado.
- El friso es un `<ol aria-label>` con un `aria-label` por carta.
- **Nada de texto dibujado adentro del SVG.** Ni `<text>`, ni `<title>`. Todo
  rótulo es HTML traducible. Press Start 2P no tiene glifos devanagari y el
  sitio se sirve en hindi.
- El botón de movimiento y el input del probador usan el `:focus-visible` del
  sitio (outline coral de 2 px). Ningún control nuevo se queda sin foco visible.
- Ningún estado se distingue solo por color: siete traen forma propia (objeto
  encima, cara cambiada, o las dos cosas), el octavo es el reposo, y los ocho
  llevan chip de texto.
- Contraste, medido y con test: cada cuerpo da **≥ 3:1 contra
  `--color-surface`** y el oro del bolsillo da **≥ 3:1 contra cada cuerpo**
  (regla B, ventana de luminancia [0,136 – 0,158]). Sobre la tarjeta
  `--color-surface-2` el margen baja a 2,84:1, y ahí lo que separa el oro es el
  borde de 1 px de `--color-ink` de la regla D, que no depende del fondo. Los
  cuatro secundarios dan 4:1 o más contra `--color-surface`.

---

## Arquitectura

Todo pasa en `apps/web`. **No se toca `apps/server`, `packages/game-sdk`,
`packages/agent-sdk` ni `packages/contracts`** — hay otra sesión trabajando en el
árbitro. El spec usa únicamente lo que hoy devuelven `getAlephRoom`
(`AlephRoomView` público), `getAlephLog` (desde `settled`) y lo que ya está en
la página.

### Archivos nuevos

Todos en `apps/web/app/components/aleph/`, todos con **imports relativos** y sin
el alias `@/`, sin `wagmi`, sin el hook `useT` y sin `wallet.tsx`. La razón es
concreta: así se importan desde `apps/web/test/*.test.ts` con `node --test`, que
es como se testea en este repo, sin DOM ni configuración nueva. Los textos
entran por props (`t`) y las etiquetas de wallet llegan ya armadas, que es el
patrón que la página ya usa con `SeatRow(seat, t)`.

**Los módulos puros van un nivel más adentro, en
`apps/web/app/components/aleph/nucleo/`** (`criatura.ts`, `estados.ts`,
`charla.ts`, `escena.ts`, `movimiento.ts`); los componentes (`*.tsx`) quedan en
`aleph/`. Lo encontró el plan de PR1 (desvío 9): en el macOS del dueño el
filesystem no distingue mayúsculas y TypeScript prueba `.ts` antes que `.tsx`,
así que `criatura.ts` al lado de `Criatura.tsx` hace que el componente se
importe a sí mismo (`TS2305` + `TS1261`). Ningún nombre ni firma cambia; solo la
carpeta. PR2 hereda la regla para `escena.ts`/`Escena.tsx`. Abajo, las rutas de
la tabla se leen con esa salvedad.

| archivo           | qué es                                                                                                                                                                                                              | qué campo consume                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `criatura.ts`     | puro, cero imports. `rasgosDe(address)`, `nodosDe(rasgos, opts)`, `capaDeEstado(estado, hw)`, `svgDeCriatura(address, opts?)` (el serializador que usan tests y probador) y las ocho tablas más `COLORES_DE_ESTADO` | `AlephSeatView.address`                                                                                                                                                                                      |
| `Criatura.tsx`    | mapea `nodosDe(...)` a `<rect>`. **No dibuja nada propio**: un píxel fuera de `criatura.ts` es un bug de revisión                                                                                                   | props: `address`, `estado`, `traidor`, `oro`, `clase` (`criatura--mesa` / `--charla` / `--final` / `--probador`, no un número: ver "La escena"), `etiquetaA11y` (ausente en la charla, que va `aria-hidden`) |
| `estados.ts`      | puro. `estadoDeAsiento(seat, room)` con la tabla de prioridades y la marca de traidor, y `chipDeAsiento(seat, room)` con la tabla del chip                                                                          | `seats[].status`, `stage.phase`, `stage.acted`, `results[].kind/accepted/eachGot/voided/traitors/choices`, `messages[].from/phase`, `deposited`, `status`                                                    |
| `escena.ts`       | puro. `modeloDeEscena(room)` → asientos, sillas vacías, pozo, caja, bolsillos, total, mazo, etapa, friso, contador, finalistas y `columnas {ancha, angosta}`                                                        | la vista entera, **incluidos `messages`** (los necesita `estadoDeAsiento` para `hablando`); lo que NO arma es la terminal, que es de `charla.ts`                                                             |
| `charla.ts`       | puro. `lineasDeCharla(room)` → las líneas de la terminal, ya filtradas, agrupadas por etapa y marcadas                                                                                                              | `messages[]`, `status`, `stage.index`, `results[].kind`                                                                                                                                                      |
| `Objetos.tsx`     | olla, cofre, mazo, dorso de ALEPH y los cinco glifos de etapa, en pixel art `aria-hidden`                                                                                                                           | `pot`, `box`, `cardsLeft`, `status`, `results[].kind`                                                                                                                                                        |
| `Mesa.tsx`        | los tres objetos, la barra de tres segmentos y la línea del invariante (o, con la sala liquidada, la línea del reparto de la caja en vez de la barra)                                                               | `pot`, `box`, `potInitial`, `seats[].pocket`, `cardsLeft`, `status`                                                                                                                                          |
| `CartaEtapa.tsx`  | nombre, regla, fase, reloj, contador y, liquidada, la carta de cierre                                                                                                                                               | `stage.index`, `stage.kind`, `stage.phase`, `stage.acted`, `deadline`, `now`, `seats[].status`, `status`, `results[].kind/choices`; props: `etiquetaDePorDireccion`                                          |
| `Friso.tsx`       | las cartas chicas                                                                                                                                                                                                   | `results[]`, `cardsLeft`, `stage`, `status`                                                                                                                                                                  |
| `Asientos.tsx`    | la grilla, la tarjeta ancha y la angosta, las sillas vacías, la fila de la Final                                                                                                                                    | el modelo de `escena.ts` + `etiquetaDe`                                                                                                                                                                      |
| `Charla.tsx`      | la terminal, viva y desclasificada; dibuja lo que le da `lineasDeCharla`                                                                                                                                            | el modelo de `charla.ts` + **`etiquetaDePorDireccion`** (el `from` y el `to` son direcciones sueltas, no asientos) + `destello`                                                                              |
| `Escena.tsx`      | arma todo, declara el contenedor y lleva el botón de movimiento                                                                                                                                                     | props: `room`, `t`, `etiquetaDe`, `etiquetaDePorDireccion`, `destello`, `now`                                                                                                                                |
| `Liquidacion.tsx` | la ventana `QUIEN_VOTO_A_QUIEN.TXT`. **No pide nada**: recibe los eventos ya traídos                                                                                                                                | props: `eventos` (`AlephLog["events"]` o `null` si falló), `etapas`, `resultados`, `t`, `etiquetaDePorDireccion`                                                                                             |
| `movimiento.ts`   | `leerPreferencia()` / `guardarPreferencia()` con `try/catch`                                                                                                                                                        | `localStorage`                                                                                                                                                                                               |

`etiquetaDe(seat) => string` es siempre la misma función, la arma la página con
`playerLabel` y `agentTag`, y `etiquetaDePorDireccion(address) => string` es su
hermana para las direcciones sueltas (ver "Lo que se reusa del sitio").
`destello` es `null` o `{ tipo: "grieta" | "revela" | "desclasifica",
asientos?: string[] }`: lo calcula la página comparando la vista nueva con la
anterior y se limpia solo al segundo. La página le pasa el **mismo** `destello`
a `Escena` y a `Charla`, porque son ventanas hermanas y ninguna es hija de la
otra: la grieta y la revelación las usa la escena, `desclasifica` la usa la
terminal. `now` es el mismo `useState` de la página
que mueve el reloj: sin esa prop, `CartaEtapa` dibujaría el `mm:ss` una vez y no
se movería más.

`Liquidacion.tsx` recibe dos cosas que no están en `events`, y por eso están en
sus props: `etapas` (`results.map(r => ({ index: r.index, kind: r.kind }))`,
para rotular cada grupo con `aleph.room.stageHead`, porque `AlephEvent` solo
trae `stage: number` y no el `kind` —`packages/game-sdk/src/aleph-rules.ts:54-63`—)
y `resultados` (los `results[].votes` de cada etapa de Voto, para saber quiénes
estaban vivos y así calcular el `who` de `aleph.votes.implied`).

### Archivos que se tocan

- **`apps/web/app/aleph/[roomId]/page.tsx`**. Sigue siendo el único que importa
  `useT`, `playerLabel`, `agentTag`, `LocaleLink`, `getAlephRoom` y
  `getAlephLog`, y el único con el sondeo. Cambios:

  - monta `<Escena>`, `<Charla>` y, al liquidar, `<Liquidacion>`;
  - **saca los tres bloques `Money` del encabezado** y **la ventana `ASIENTOS`**
    con su `SeatRow` (su contenido vive ahora en la escena, con las mismas
    claves y los mismos datos);
  - **saca del encabezado la línea `aleph.room.nowPlaying`** ("Etapa {n} ·
    {kind} · {phase}" con su `mm:ss`, hoy en `page.tsx:216-232`) **y el contador
    que PR1 había puesto al lado**: los dos pasan a la carta de etapa, que dice
    lo mismo y mejor. Sin esto, después de PR2 la misma información queda
    dibujada dos veces en la misma pantalla;
  - **la rama `else` del encabezado queda vacía con la sala liquidada, y hay que
    escribirla.** Al sacar los tres `Money`, lo único que queda en esa rama es
    la línea de etapa y `aleph.room.liveNote`, y las dos están bajo `live &&`
    (`page.tsx:216` y `:233`, con `live = room.status === "playing"`,
    `page.tsx:125`): con la sala `settled` se renderizaría un `<div
className="p-5">` de 40 px con nada adentro, justo arriba de la escena. El
    encabezado pasa a renderizar ese `<div>` **solo cuando tiene algo que
    poner**: `{live && <p>{t("aleph.room.liveNote")}</p>}` y nada más. Con la
    sala liquidada el encabezado queda reducido a su barra de ventana con el
    chip LIQUIDADA y el de stake, que es lo único que ahí sigue siendo verdad;
  - **`counting` suma la rama de lobby**:
    `|| (room?.status === "lobby" && room.closesAt !== undefined)`. Hoy el
    intervalo de un segundo solo corre en `playing` y `funding`
    (`page.tsx:91-98`), así que sin esa rama el `mm:ss` del lobby se congela en
    el valor del montaje y el sondeo de 10 s no lo mueve;
  - **`mmss()` se muda** a `apps/web/app/lib/tiempo.ts` con `export`, y la
    página lo importa de ahí;
  - arma `etiquetaDe(seat) => playerLabel(seat.address, seat.name, seat.avatar,
agentTag(seat, t))` y su `etiquetaDePorDireccion`;
  - guarda la vista anterior en un `useRef` para calcular el `destello`;
  - y, cuando el estado llega a `settled`, pide el registro una sola vez.

  **No se toca** `stageLines()`, ni el panel `QUE_PASO.TXT`, ni la tabla de
  pagos, ni el bloque de commit/semilla/registro, ni el manejo de errores y
  reintentos del sondeo.

- **`apps/web/app/globals.css`**: las cuatro `@keyframes` nuevas, su rama en el
  bloque `prefers-reduced-motion` que ya existe (`globals.css:416-432`), la
  clase `sin-movimiento` que las duplica, las dos o tres clases de la terminal
  (`overflow-wrap: anywhere`, el prompt coral) y **el bloque de contenedor de la
  escena**, que es la parte más grande y la que no se ve venir:
  `.escena { container-type: inline-size }`, la tarjeta de asiento **angosta por
  defecto**, y adentro de `@container (min-width: 560px)` la tarjeta ancha, los
  tamaños de criatura (`criatura--mesa` 48 → 64, `criatura--final` 64 → 96) y
  las columnas de la grilla, que leen las dos custom properties que publica
  `Asientos.tsx` (ver "La escena"): `grid-template-columns:
repeat(var(--cols-angosta), 1fr)` fuera del corte y `repeat(var(--cols-ancha),
  1fr)` adentro. Sin este bloque, el corte de 560 px del que habla toda la
  sección "La escena" no existe en ningún lado.
- **`apps/web/app/lib/i18n/{es,en,fr,hi}.ts`**: las claves nuevas y **el borrado
  de cuatro que quedan huérfanas**. `aleph.room.potInitial`,
  `aleph.room.nowPlaying`, `aleph.room.deadline` y `aleph.room.seats` tienen hoy
  **un solo uso cada una** —`page.tsx:214`, `:218`, `:227` y `:244`— y los cuatro
  se van con los bloques que PR2 saca (los `Money`, la línea de etapa con su
  `mm:ss` envuelto, y la barra de la ventana ASIENTOS). Se borran de los cuatro
  diccionarios en el mismo PR: son 16 entradas muertas y el test de paridad no
  avisa, porque compara claves **entre idiomas** y no uso
  (`apps/web/test/i18n.test.ts:16-25`).
  Y al revés: los dos relojes de la escena —el `mm:ss` de la barra de ventana en
  `lobby` y el de la carta de etapa— **van crudos, sin clave de i18n**, solo el
  `mm:ss` en mono. El contexto de al lado ya dice qué se está contando, y por eso
  `aleph.room.deadline` ("(quedan {time})") no se recicla: su paréntesis sobra
  adentro de la carta.

### Archivos nuevos del probador (PR2, opcional)

- `apps/web/app/aleph/criatura/page.tsx`, **con `"use client"` arriba de todo**:
  un input, la criatura a 128 px y los ocho estados en fila. Acepta
  `?address=0x…` para poder compartir un enlace, y con eso precarga el input.
  Con una dirección que no valida `/^0x[0-9a-f]{40}$/` muestra
  `aleph.probe.bad` **y dibuja igual la criatura desconocida**, que es lo que
  `rasgosDe` devuelve: el probador no tiene un estado de error propio ni una
  rama vacía.
  El query se lee de `window.location.search` adentro de un `useEffect`, **no
  con `useSearchParams()`**: la ruta es estática y Next rompe la build por falta
  de `<Suspense>`. Los tres usos que hay hoy de `useSearchParams` están todos
  bajo rutas dinámicas (`apps/web/app/game/[gameId]/match/page.tsx:4`,
  `apps/web/app/game/[gameId]/TableClient.tsx:4`,
  `apps/web/app/games/_shared/ui.tsx:98`) y en `apps/web/app/` no hay un solo
  `<Suspense>`. Sin enlace desde ninguna navegación.
- `apps/web/app/aleph/criatura/layout.tsx`: `export const metadata: Metadata = {
...pageMeta({...}), robots: { index: false, follow: false } }`. La ruta no se
  agrega al `sitemap.ts` y no hace falta tocar `proxy.ts` (su `matcher` es
  genérico) ni el test de `lang-routing`.

### Las claves de i18n

50 claves nuevas bajo `aleph.*`. Acá van en castellano; el plan las traduce a
inglés, francés e hindi — el test de paridad obliga. Aparte se **borran** cuatro
que quedan huérfanas (`aleph.room.potInitial`, `aleph.room.nowPlaying`,
`aleph.room.deadline`, `aleph.room.seats`), por lo que dice "Archivos que se
tocan".

**Escena (13)**

```
aleph.scene.title          "ESCENA.EXE"
aleph.scene.acted          "Ya actuaron {k} de {n}."
aleph.scene.ready          "Ya dijeron listo {k} de {n}."
aleph.scene.invariant      "Pozo {pot} + caja {box} + bolsillos {pockets} = {total}"
aleph.scene.deck           "Mazo"
aleph.scene.deckLeft       "{n} sin dar"
aleph.scene.deckNote       "El orden del mazo es secreto, y la Final no sale de ahí."
aleph.scene.emptySeat      "Silla vacía"
aleph.scene.settledTitle   "La sala liquidó."
aleph.scene.settledNoFinal "La sala terminó antes de la Final."
aleph.scene.settledSplit   "La caja se repartió en partes iguales: {each} para cada asiento."
aleph.scene.pause          "PAUSAR MOVIMIENTO"
aleph.scene.resume         "REANUDAR MOVIMIENTO"
```

**La regla de cada etapa (5)**

```
aleph.rule.share   "Cada uno elige guardarse su parte del pozo o dejarla. Si la dejan, la caja premia al pozo."
aleph.rule.offer   "El demonio paga por irse. El que acepta cobra y deja la mesa; si aceptan todos, la oferta se anula y el pozo pierde un 10 %, que se lleva la caja."
aleph.rule.vote    "El más votado deja la mesa con su bolsillo. Quién votó a quién no se muestra hasta que la sala liquide."
aleph.rule.lock    "Cada uno tiene un pedazo del código. Abrirla para todos premia al pozo; abrirla para uno solo lo señala como traidor; si no la abre nadie, el pozo pierde un 10 %."
aleph.rule.final   "Los dos últimos eligen en secreto dividir o robar. Si roban los dos, el pozo se quema."
```

**Friso (6)**

```
aleph.frieze.title    "Etapas de la sala"
aleph.frieze.played   "Etapa {n}: {kind}"
aleph.frieze.current  "Etapa {n}: {kind}, en curso"
aleph.frieze.back     "Carta sin dar"
aleph.frieze.left     "Alguien dejó la mesa"
aleph.frieze.bonus    "La caja premió al pozo"
```

**Estados que no existían (7)**

```
aleph.state.esperando  "sin decidir"
aleph.state.decidio    "ya decidió"
aleph.state.listo      "listo"
aleph.state.hablando   "habla"
aleph.state.traidor    "abrió para sí"
aleph.state.ganador    "ganó la Final"
aleph.state.enPie      "quedó en pie"      (enmienda 2026-09-24)
aleph.seat.lobby       "sentado"           (enmienda 2026-09-24)
aleph.seat.dissolved   "la sala se disolvió"
```

La séptima va bajo `aleph.seat.*` y no `aleph.state.*` a propósito: es el chip
de un asiento, hermana de las cinco que ya están y se reusan tal cual —
`aleph.seat.alive`, `aleph.seat.left`, `aleph.seat.voted_out`,
`aleph.seat.abandoned`, `aleph.seat.finished`— y la única que faltaba para que
`chipDeAsiento` cubra los cinco estados de sala sin reciclar el rótulo en
mayúsculas del encabezado.

**Accesibilidad (1)**

```
aleph.a11y.criatura   "Criatura de {wallet}, {estado}"
```

**Charla (9)**

```
aleph.chat.title          "CHARLA_PUBLICA.TXT"
aleph.chat.empty          "Todavía no habló nadie en esta etapa."
aleph.chat.private        ":: el canal privado no publica nada, ni que existió, hasta que la sala liquide."
aleph.chat.onlyThisStage  "Acá va solo la charla de la etapa en curso. El historial completo se abre cuando la sala liquida."
aleph.chat.caps           "Cada agente puede mandar 3 mensajes por fase, de hasta 280 caracteres."
aleph.chat.declassified   "La sala liquidó y se abrió el canal privado. Acá está todo lo que se dijo, público y susurrado, en el orden en que pasó."
aleph.chat.whisper        "SUSURRO"
aleph.chat.whisperTo      "a {who}"
aleph.chat.stageSep       ":: etapa {n} · {kind}"
```

**Liquidación (5)**

```
aleph.votes.title        "QUIEN_VOTO_A_QUIEN.TXT"
aleph.votes.line         "{voter} votó a {target}."
aleph.votes.implied      "Los que no votaron cuentan como voto contra sí mismos: {who}"
aleph.votes.empty        "No hubo ninguna etapa de Voto en esta sala."
aleph.votes.unavailable  "El registro firmado no respondió. Está igual en el enlace de abajo."
```

**Probador (4)**

```
aleph.probe.title   "CRIATURA.EXE"
aleph.probe.label   "Pegá una dirección"
aleph.probe.bad     "Eso no es una dirección de 0x y 40 caracteres."
aleph.probe.intro   "La criatura sale de la dirección y no cambia nunca. Esta página no está enlazada desde ningún lado: sirve para mirar criaturas contra direcciones reales."
```

---

## Tests

Tres archivos nuevos en `apps/web/test/`, con `node:test` y `assert/strict`,
como todos los del repo. **Sin React, sin DOM, sin dependencias nuevas**: la
criatura se comprueba contra `nodosDe(...)`, que es la única fuente de verdad
—`Criatura.tsx` mapea esa lista a `<rect>` y `svgDeCriatura` la serializa a
string para el probador y para los asserts de `aria-label`, así que los dos
consumen la misma lista y no pueden divergir—, y la escena contra
`modeloDeEscena`, que devuelve datos. Lo que los tests miran son los nodos, no
el string que produce React: nada obliga a que el serializador y el DOM de React
coincidan carácter por carácter (orden de atributos, `shapeRendering` en
camelCase, espaciado), y prometerlo sería prometer algo que no se puede
comprobar sin renderizar React. Las direcciones de prueba las genera un PRNG con semilla fija adentro del
test, así que los números no bailan entre corridas.

### `aleph-criatura.test.ts` — el generador

1. **Determinismo**: `svgDeCriatura(a)` dos veces da el mismo string byte a
   byte; la misma dirección en mayúsculas (formato EIP-55) da el mismo string
   que en minúsculas.
2. **Todo adentro de la grilla, y cada capa en su zona**: sobre 2.000
   direcciones × los 8 estados × con y sin marca de traidor, ningún nodo tiene
   `x < 0`, `y < 0`, `x + w > 16` ni `y + h > 16`; ningún nodo de la capa de
   identidad tiene `y < 3` y ningún overlay de cabeza tiene `y > 2` (es lo que
   impide que la corona dorada del ganador tape la corona de identidad); y
   ningún nodo del dorso queda fuera del rectángulo del cuerpo de esa silueta.
3. **Tope de nodos**: en esas mismas combinaciones, `nodosDe(...).length ≤ 40`.
4. **La paleta no toca los estados y el oro se lee**: ningún valor de
   `FAMILIAS`, de `SECUNDARIOS` ni el cuerpo de la **criatura desconocida** es
   `#f2c14e`, `#b8e08a`, `#5fd68a` ni
   `#f0716f`; **todo color de cuerpo cae en la ventana de luminancia
   [0,136 – 0,158]**, la desconocida incluida (es lo que impide que vuelva el
   `#7a7368` de la maqueta, que está en 0,174); el oro `#f2c14e` da **≥ 3:1
   contra las ocho familias y contra el gris de la desconocida** y
   cada cuerpo da **≥ 3:1 contra `--color-surface #1f1a29`** (las dos con la
   fórmula de contraste de WCAG, escrita en el test); todo secundario tiene
   saturación HSL ≤ 0,18. La cota suelta de 0,22 que tenía este test no servía:
   la cumplían colores con los que el oro del bolsillo daba 2,79:1.
5. **Variedad**: el producto de los largos de las ocho tablas es exactamente
   8.388.608 y, como piso, ≥ 1.000.000. Sobre 20.000 direcciones del PRNG, las
   colisiones exactas de los ocho rasgos son ≤ 40 (lo esperado es ~24).
6. **Seis direcciones distintas dan seis criaturas distintas** — el caso de la
   casa. Ojo, y conviene que quede escrito: **las direcciones de los asientos de
   la casa no existen como constantes en el repo**. `aleph-house-seats.ts:72-82`
   las genera con `generatePrivateKey()` la primera vez y las guarda en el store
   del árbitro para que sean estables entre reinicios. Son estables, así que
   cada asiento de la casa tiene su criatura fija para siempre, pero el test no
   las puede conocer: comprueba la propiedad sobre seis direcciones cualquiera,
   y la garantía de fondo la da el test de variedad.
7. **Robustez**: `rasgosDe("")`, `rasgosDe("0x")`, `rasgosDe("0x123")` y
   `rasgosDe("0xZZ…")` no tiran y devuelven la criatura desconocida.
8. **Los ocho estados salen con su etiqueta**: `svgDeCriatura(a, { estado,
etiquetaA11y })` de cada uno trae el `aria-label` con el texto de ese estado, y
   los ocho textos son distintos entre sí. **El estado no determina el chip por
   sí solo**, y por eso el test tiene una segunda mitad, que recorre las siete
   filas de `chipDeAsiento(seat, room)` en su orden: con la sala `dissolved`,
   `aleph.seat.dissolved` aunque el asiento venga `alive`; con `funding`,
   `aleph.seat.deposited` o `aleph.seat.pending` según `room.deposited`, aunque
   el asiento venga `alive`; `ganador` → `aleph.state.ganador`; `hablando` →
   `aleph.state.hablando`; `esperando` → `aleph.state.esperando`; `sellado` →
   `aleph.state.decidio` en `decide` y `aleph.state.listo` en `talk`; y el resto
   → `aleph.seat.${seat.status}`, comprobado sobre los cinco `SeatStatus` —o
   sea, un asiento `left` da `aleph.seat.left` con la sala `playing` **y** con la
   sala `settled`, y no "terminó"—. Ninguna de esas claves falta en los cuatro
   diccionarios. Aparte, con `traidor: true` sobre cada uno de los ocho se
   muestran los dos chips y nunca más de dos.
9. **El oro es proporcional en todo el rango**: con bolsillo 0 no hay una sola
   fila dorada; con el bolsillo mínimo distinto de cero hay exactamente 1; con
   el 50 % del máximo hay 4 y con el 75 %, 6 —no 8, que es lo que daba la
   fórmula vieja y aplastaba el cuarto superior—; con el máximo hay 8 y nunca
   10; el oro agrega como mucho un nodo, el borde de ink de la regla D.

### `aleph-escena.test.ts` — la puesta en escena

10. **Mesas de 4, 6 y 8**: `modeloDeEscena` devuelve la cantidad de columnas
    esperada en ancho y en angosto, y ninguna tarjeta queda sin etiqueta. Y un
    asiento con un mensaje de la **fase en curso** sale `hablando`: es la única
    prueba de que `modeloDeEscena` recibe `messages` y no una vista recortada
    (el test 17 solo comprueba el caso en que **no** tiene que salir).
11. **Lobby**: con 2 asientos de un mínimo de 4, dos criaturas y dos sillas; con
    4 de 8, cuatro criaturas y una sola silla; con 8 de 8, ninguna.
12. **`dissolved`**: con una vista sin `pot`, sin `box`, sin `stage`, sin
    `results` y sin `messages`, el modelo no rompe, no inventa mesa, los ocho
    asientos salen en estado `abandono` (sale del estado de sala, no del
    asiento), no se dibuja ninguna silla vacía y `lineasDeCharla` devuelve
    `null`, así que la terminal no se monta.
13. **`settled`**: el oro sale de `payouts` y no de `pocket`; el friso no tiene
    ni un dorso ni carta actual; la charla trae los susurros marcados, con su
    `to`, y los separadores por etapa. Y el caso de la Oferta anulada: una vista
    con una Oferta `voided` (`accepted` lleno, `eachGot` sin definir) seguida de
    otra Oferta con `eachGot`, donde el asiento que aceptó **las dos** trae el
    monto de la **segunda** y nunca `undefined`.
14. **El invariante cierra**: con una vista real, `pozo + caja + bolsillos` es
    igual al total que muestra la barra.
15. **Sin "de N"**: el texto de la carta de etapa no contiene ningún total de
    etapas, con `cardsLeft` en 0 y en 10.
16. **La corona de la Final**: con un solo `steal`, uno solo lleva corona; con
    dos `split`, los dos; con dos `steal`, ninguno. Y el que dividió mientras el
    otro robaba **no** sale `votado` ni `traidor`. Más los dos casos **sin
    Final**, que es lo que más rompe: una vista `settled` sin ningún
    `results[].kind === "final"` y un solo asiento `finished` le pone corona a
    ese y a nadie más, y la carta de cierre dice `aleph.scene.settledNoFinal`
    sin intentar ninguna línea de desenlace; la misma vista con cero `finished`
    no le pone corona a nadie y tampoco rompe.

### `aleph-secretos.test.ts` — lo que protege al juego

17. **Solo lo cerrado**: con una vista en fase `decide`, `results: []` y
    `acted: [a, b]`, ningún asiento sale `traidor`, `ganador`, `se_fue` ni
    `votado`, y los dos de `acted` salen `sellado`. Y el candado de fase de
    `hablando`: con una vista en `decide` cuyo único mensaje tiene
    `phase: "talk"`, **ningún asiento sale `hablando`** — el que habló en la
    charla ya cerrada sale `esperando` o `sellado`, que es lo que está
    haciendo.
18. **El sello es idéntico para todos**: `capaDeEstado("sellado", hw)` **no
    recibe la dirección** —solo el estado y los diez medios anchos, que ya se
    ven dibujados— y devuelve el mismo array para cualquier `hw` en 200
    llamadas; y
    `svgDeCriatura(a, { estado: "sellado" })` y `svgDeCriatura(b, { estado:
"sellado" })` difieren únicamente en los nodos de la capa de identidad (se
    comprueba quitándola).
19. **En vivo no hay susurros**: si una vista con `status: "playing"` trajera un
    mensaje con `to` —hoy imposible, `viewFor` los filtra—, el modelo de la
    charla no lo devuelve igual. Defensa en profundidad contra un cambio futuro
    del árbitro.
20. **La charla no inventa**: con `messages: []` la terminal muestra el vacío y
    la línea fija, sin contador de susurros y sin ninguna marca de que hubo
    canal privado.

### Los que ya existen y tienen que seguir pasando

- `apps/web/test/i18n.test.ts`: paridad de claves en los cuatro idiomas.
- `apps/web/test/lang-routing.test.ts`: sin cambios (el `matcher` de `proxy.ts`
  es genérico y la ruta nueva entra sola).
- `npm run check` entero: `typecheck`, `lint`, `format:check`, `test` y
  `selftest`.

---

## Alcance

**Dentro**: la criatura y su generador; los ocho estados; la escena completa
(carta de etapa, friso, pozo/caja/mazo como objetos, barra del invariante,
asientos, contador); la charla pública como terminal; la liquidación con
susurros desclasificados y quién votó a quién; lobby, sala a medio llenar y
`dissolved`; el botón de movimiento; los cuatro idiomas; el probador de
criaturas (opcional); los tests.

**Fuera, y no se discute en esta etapa**: cualquier cambio en `apps/server`,
`packages/game-sdk`, `packages/agent-sdk` o `packages/contracts`; sonido; modo
claro; que un agente pueda elegir su cara.

### Más adelante

Lo que quedó afuera a propósito, con la razón:

- **Perfil por agente** (`/aleph/agente/0x…`): su criatura, su historial de
  salas, cuántas veces traicionó, cuánto se llevó. Es lo que convierte una
  pantalla en un reality con temporadas y es lo que le da sentido a la identidad
  entre salas. Necesita del árbitro un índice por dirección que hoy no existe.
- **Criaturas en `/aleph`**: en las **salas recientes** se puede hoy mismo —
  `getRecentAlephRooms` ya trae `seats: string[]`, o sea las direcciones. En las
  **mesas abiertas** no: `AlephLobby` trae solo la **cantidad** de asientos
  (`agent-sdk/src/client.ts`), no las direcciones. Para dibujar las criaturas de
  un lobby el árbitro tendría que publicarlas en `GET /aleph/lobbies`.
- **Imagen final para compartir** ("así terminó la mesa del martes"): un
  `opengraph-image` por sala liquidada.
- **Replay rápido de una sala terminada**, con el registro firmado como fuente.
- **Seguir a un agente favorito** y avisar cuando llega la Final.
- **La versión en 30 segundos**, para el que abre en el celular en la calle.
- **Modo claro.**
- **`noindex` de verdad en la sala**: hoy `/aleph/[roomId]` **no** lleva
  `noindex`. Lo que hay es que la sala está fuera del `sitemap.ts` a propósito
  (el comentario lo dice: es efímera, se descubre desde `/aleph`) y
  `robots.ts` permite todo. Esta etapa no lo cambia, para no meter un cambio de
  SEO adentro de un PR visual. Si el dueño lo quiere, es un `layout.tsx` de tres
  líneas.
- **Que la vista traiga `feeBps`**: la nota de la comisión de la tabla de pagos
  sigue con el 15 % como constante documentada en el código, porque el árbitro
  solo lo manda en `/aleph/:id/log`.

---

## Etapas de construcción

Dos PRs. Cada uno queda usable solo y se puede desplegar sin el otro.

### PR1 — el recorte (unos 3 días)

La criatura y los asientos sobre la página que ya existe, **sin escena**.

- `criatura.ts` con las ocho tablas, la paleta y el serializador.
- `Criatura.tsx` y `estados.ts` con los ocho estados.
- `charla.ts` con `lineasDeCharla`.
- La lista de asientos de hoy pasa a llevar la criatura, el oro del bolsillo y
  el chip de estado (o dos, si hay marca de traidor). Sigue siendo una lista
  vertical: la grilla llega en PR2.
- `Charla.tsx` completa, viva **y** desclasificada. La parte de liquidación va en
  PR1 y no en PR2 a propósito: con la sala `settled` el árbitro manda los
  susurros quiera uno o no (`viewFor` deja de filtrar), así que la terminal
  tiene que saber marcarlos desde el día uno. Lleva la criatura de 32 px al lado
  de cada línea, los separadores por etapa, el cartel de desclasificación, la
  línea fija del canal privado y las dos notas al pie.
- El contador "ya actuaron k de n" en el encabezado, al lado de la línea de
  etapa que ya está. Es provisorio: en PR2 se muda, junto con esa línea, adentro
  de la carta de etapa.
- `aleph-respira` y su rama de reduced-motion. Las líneas desclasificadas
  aparecen sin fundido: `aleph-desclasifica` llega en PR2 y no le falta un dato
  a nadie mientras tanto. En concreto, en PR1 la página **no** calcula
  `destello` (el `useRef` con la vista anterior llega con PR2) y monta
  `<Charla destello={null} />`; la prop existe desde el día uno para no tocar la
  firma dos veces.
- Las claves de i18n de estados (7, con `aleph.seat.dissolved`: la lista de
  asientos de PR1 ya usa `chipDeAsiento` y tiene que cubrir una sala disuelta),
  charla (9), accesibilidad (1) y las dos del contador (`aleph.scene.acted`,
  `aleph.scene.ready`), en los cuatro idiomas: 19 claves.
- `aleph-criatura.test.ts` completo (tests 1 a 9), los cuatro de secretos (17 a 20) y **la mitad de charla del test 13**: con una vista `settled`,
  `lineasDeCharla` devuelve los susurros marcados, con su `to`, y los
  separadores por etapa. Sin eso PR1 entregaría la terminal desclasificada —lo
  más delicado que agrega— sin una sola prueba. La otra mitad del 13 (el friso
  sin dorsos y el oro desde `payouts`) va en PR2 con el resto de
  `aleph-escena.test.ts`.

**Listo cuando**: una sala en vivo muestra ocho criaturas distintas con su
wallet abreviada al lado, la charla pública se ve por primera vez, el oro sube
en los cuerpos cuando alguien se guarda su parte, una sala liquidada muestra los
susurros marcados y en su lugar, `npm run check` pasa, y a 375 px no hay scroll
lateral.

### PR2 — la escena completa (unos 4 a 5 días)

- `escena.ts`, `Escena.tsx`, `Mesa.tsx`, `Objetos.tsx`, `CartaEtapa.tsx`,
  `Friso.tsx`, `Asientos.tsx`.
- La grilla de asientos con sus dos formas (ancha y angosta) y las sillas
  vacías; lobby, `funding` y `dissolved`.
- Los dos arreglos de la página que la escena necesita para que su reloj
  funcione: `mmss()` sale a `apps/web/app/lib/tiempo.ts` con `export`, y
  `counting` suma la rama de `lobby` (ver "Archivos que se tocan").
- Pozo, caja y mazo como objetos, la barra del invariante y su línea; se sacan
  los tres bloques `Money` del encabezado, la ventana `ASIENTOS`, la línea
  `aleph.room.nowPlaying` y el contador que PR1 había dejado ahí.
- La carta de etapa con la regla en una línea y el friso.
- La Final: los dos finalistas más grandes y la revelación simultánea.
- La liquidación: `Liquidacion.tsx` con quién votó a quién, el oro y los montos
  desde `payouts`, el friso sin dorsos y la carta de cierre (la terminal
  desclasificada ya vino en PR1).
- `aleph-grieta`, `aleph-revela`, `aleph-desclasifica`, el botón de movimiento y
  `movimiento.ts`.
- Las 31 claves de i18n que faltan (escena, reglas de etapa, friso, liquidación
  y probador) en los cuatro idiomas, y el **borrado** de las cuatro huérfanas
  (`aleph.room.potInitial`, `aleph.room.nowPlaying`, `aleph.room.deadline`,
  `aleph.room.seats`), en el mismo PR que saca sus bloques.
- `aleph-escena.test.ts` completo (tests 10 a 16).
- **Opcional, y lo primero que se cae si falta tiempo**: el probador
  `/aleph/criatura` con su `noindex`.

**Listo cuando**: alguien que cae en la etapa 6 de una sala entiende en cinco
segundos qué etapa es, qué regla rige, cuánta plata hay, cuántas etapas se
jugaron y quién sigue en juego, sin leer el relato de abajo; la misma pantalla
funciona con 4, 6 y 8 asientos y a 375 px sin scroll lateral; una sala liquidada
muestra los susurros en su lugar y quién votó a quién; el relato en texto, la
tabla de pagos, el compromiso, la semilla y el enlace al registro firmado siguen
exactamente donde estaban.

---

## Pendientes del dueño

Ninguno. Los cuatro que quedaron al escribir el spec los resolvió la dirección
el mismo 2026-09-19 con el criterio del dueño (barato, sobrio, reversible), y
quedan acá por si quiere cambiar alguno: los cuatro son una constante o un par
de líneas.

1. **La sala no va a `noindex` en esta etapa.** Hoy no lo está (solo está fuera
   del sitemap) y es una decisión de SEO, no de diseño: queda en "Más adelante".
   Cuando se decida, son tres líneas en un `layout.tsx`.
2. **El probador entra**, como último ítem de PR2 y lo primero que se cae si
   falta tiempo. Sirve para mirar criaturas contra direcciones reales antes de
   congelar el catálogo, y es la única pieza que se puede cortar sin que falte
   nada.
3. **La criatura de la charla va a 32 px** (decisión 14). La dirección había
   cerrado 20–24 px, pero ninguno es múltiplo de 16 y `crispEdges` deja de
   servir; 16 px, que sí lo es, se pierde al lado de una línea de mono de
   12,5 px. Es cambiar una constante.
4. **Sillas vacías solo en `lobby`, y sin "faltan N" adentro de la escena.** La
   dirección pedía las dos cosas y el spec se apartó por razones de código, no
   de gusto: en fondeo la lista de asientos está congelada —`joinAleph` solo
   sienta gente con la sala en `lobby` (`apps/server/src/aleph.ts:402-406`)—,
   así que una silla vacía prometería un lugar que ya no se puede ocupar; y el
   "faltan N" ya está tres centímetros más arriba, en el `aleph.room.lobbyIntro`
   del encabezado, que este spec no toca.
