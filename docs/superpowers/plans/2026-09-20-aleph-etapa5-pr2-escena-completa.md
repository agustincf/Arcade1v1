# Aleph — Etapa 5, PR 2 de 2: la escena completa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `/aleph/[roomId]` deje de ser una lista y pase a ser una escena: carta de etapa con la regla en una línea, friso de etapas jugadas, pozo/caja/mazo dibujados con la barra del invariante, la grilla de asientos en sus dos formas, la Final con los dos finalistas grandes y, al liquidar, quién votó a quién — de modo que alguien que cae en la etapa 6 entienda en cinco segundos qué pasa sin leer el relato de abajo.

**Architecture:** Todo pasa en `apps/web`, sobre datos que el árbitro ya publica. El corazón es `nucleo/escena.ts`: un módulo **puro** que convierte la vista pública de una sala en un modelo de datos (`modeloDeEscena`) y que se prueba entero con `node --test`, sin DOM. Encima van siete componentes que **solo dibujan** ese modelo (`Objetos`, `Mesa`, `CartaEtapa`, `Friso`, `Asientos`, `Escena`, `Liquidacion`) y un `globals.css` con un `@container` de un solo corte (560 px) del que cuelga todo lo que cambia de forma. La página sigue siendo el único archivo con el sondeo, `useT`, `playerLabel` y el alias `@/`; le suma el `useRef` con la vista anterior (de donde sale el destello de las tres animaciones) y un único pedido del registro firmado al llegar a `settled`.

**Tech Stack:** TypeScript estricto, React 19 / Next 16 (App Router, `"use client"` en la página y en `Escena.tsx`), SVG inline con `shapeRendering="crispEdges"`, CSS container queries + Tailwind v4 + `globals.css`, i18n propia de la web (4 idiomas con paridad forzada por test), `node:test` + `assert/strict` sin DOM ni dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-09-19-aleph-etapa5-espectador-visual-design.md`, y dentro de él: "La escena", "La carta de etapa", "El friso", "La mesa", "Los asientos", "Momentos", "Movimiento y accesibilidad", "Arquitectura", "Las claves de i18n", "Tests" y "Etapas de construcción → PR2 — la escena completa". El plan argumenta desde el spec; **el ejecutor lee los dos**. Manda también el CÓDIGO REAL de PR1 en `main` (`00c703c`): las firmas que están escritas acá se verificaron una por una contra ese código. Desvíos deliberados, con su razón:

1. **`escena.ts` no declara una segunda forma de la vista: ensancha la de `estados.ts`.** El spec le da a `escena.ts` "la vista entera", que trae ocho campos que `SalaDeAleph` no declaraba (`pot`, `box`, `potInitial`, `cardsLeft`, `min`, `max`, `closesAt`, `deadline`), cuatro que `ResultadoDeEtapa` no declaraba (`eliminated`, `abandoned`, `bonus`, `votes`) y cinco que `AsientoDeSala` no declaraba (la ficha pública: `name`, `avatar`, `agentId`, `house`, `byo`). Esos cinco la escena no los lee —se los pasa enteros a `etiquetaDe`—, pero sin ellos la página no compila: `agentTag` pide un objeto con `house`/`byo` y TypeScript rechaza el que no trae ninguno de los dos (`apps/web/app/lib/wallet.tsx:55-56`). Declararlos aparte obligaba a un `Omit<SalaDeAleph, "results">` para poder ensanchar `results`, o sea dos jerarquías de tipos paralelas para la misma vista, que es exactamente lo que se separa sola en seis meses. Se agregan como **opcionales** al tipo que ya existe: `AlephRoomView` los trae todos y sigue encajando por estructura, y los fixtures de tres líneas de los tests siguen compilando.
2. **`chipDeAsiento` acepta un tercer argumento opcional con el estado ya calculado.** Hoy la página llama `estadoDeAsiento` y después `chipDeAsiento`, que vuelve a llamar a `estadoDeAsiento` por adentro: cada asiento recorre `results` y `messages` dos veces, ocho asientos por sondeo. La tabla de chips sigue viviendo en un solo lugar; lo único que cambia es que el llamador puede pasarle lo que ya sabe. Está anotado en el ledger de PR1 (`page.tsx:470-472`).
3. **El `{each}` del reparto de la caja lo calcula `escena.ts`, no `Mesa.tsx`.** El spec se lo asigna al componente ("`{each}` lo calcula `Mesa.tsx`"), pero su punto era que el árbitro no lo publica, no dónde vive la división. En `escena.ts` es puro y lo mira un test (el 13); en `Mesa.tsx` no lo mira nadie, porque los componentes no tienen harness.
4. **La agrupación de votos vive en `escena.ts` (`gruposDeVotos`), y `Liquidacion.tsx` solo dibuja.** El spec pone el `filter`/`groupBy` y el cálculo de los ausentes adentro del componente. Ahí no se puede probar, y el cálculo de los ausentes —los que no votaron y cuentan contra sí mismos— es justo la parte que, si se equivoca, contradice al relato de texto que está tres centímetros más abajo en la misma pantalla.
5. **`etiquetaDe(seat)` devuelve un objeto de cuatro campos y no un string.** El spec lo describe como `(seat) => string`, pero la tarjeta angosta necesita los tres pedazos por separado (perfil con `truncate`, wallet en mono **sin** `truncate`, chip aparte) y `playerLabel` devuelve un string plano — el propio spec dice "no hay media query que parta un string". El objeto (`plana`, `perfil`, `wallet`, `tag`) lo sigue armando la página con `playerLabel` y `agentTag`, así que `wallet.tsx` no entra en `components/aleph/`. `etiquetaDePorDireccion(address) => string` no cambia.
6. **`criatura.ts` exporta `nodosDeGrieta(estado)` y `Criatura.tsx` dibuja la grieta en su propio `<g>`.** `aleph-grieta` tiene que animar **solo** la columna coral del traidor (`scaleY` de 0 a 1), y un `<rect>` suelto adentro de una lista plana de 40 no se puede seleccionar desde el CSS. `nodosDe` usa la misma función por adentro, y un test compara las dos salidas sobre 50 direcciones × 8 estados × 3 cantidades de oro, así que no pueden divergir.
7. **`aleph-revela` va en la FILA de los dos finalistas (`<ol className="escena-final">`), no en el `<svg>` de cada criatura.** La revelación es de los dos finalistas ENTEROS y tiene que salir **en el mismo cuadro**, que es lo que el spec pide ("los dos revelan en el mismo cuadro"): con un solo elemento animado, uno no puede arrancar antes que el otro. Y el `<svg>` de la criatura es justo el nodo que puede llevar `aleph-respira` — hoy no lo lleva en ese instante, porque al revelarse la sala ya está `settled` y nadie respira, pero basta un retoque de la regla de `respira` para que las dos clases con `animation` caigan en el mismo elemento, se pisen y gane la última regla de la hoja.
8. **La marca de "salida" del friso es un punto, no una cruz.** La carta mide 14×20 px: una cruz de 3 px es puré. Las dos marcas (salida en `--color-lose`, premio en `--color-gold`) van con `role="img"` + `aria-label`, que es lo que el spec pide que las nombre.
9. **`Destello` se muda de `Charla.tsx` a `nucleo/escena.ts`.** En PR1 lo declaraba la terminal porque era la única que lo recibía; ahora lo reciben la escena, la terminal y la página. Ningún otro módulo lo importa: `grep -rn "Destello" apps/web` solo lo encuentra en `Charla.tsx` (la otra coincidencia es un comentario suelto de `FlappyGame.tsx`, que no tiene nada que ver).
10. **Con la sala liquidada y sin un solo mensaje, la terminal NO muestra `aleph.chat.empty`.** Su texto es "Todavía no habló nadie **en esta etapa**" y en `settled` no hay etapa en curso que nombrar: es la misma razón por la que el spec no monta la ventana en `lobby`, `funding` ni `dissolved`. El cartel de desclasificación que está arriba ya dice que acá está todo lo que se dijo. Resuelto sin una clave nueva, que es lo que pedía la dirección.
11. **Cuando la Final cierra gana `revela`, y `desclasifica` queda para la liquidación SIN Final.** No es un empate hipotético que haya que desempatar: el árbitro cierra la Final y liquida en la MISMA pasada síncrona (`closePhase` llama a `settleRoom`, que pone `status = "settled"` en el acto — `apps/server/src/aleph.ts:661` y `:668`; y el motor marca `over = true` adentro de `finish`, `packages/game-sdk/src/aleph.ts:622` y `:650`). O sea que **todo** sondeo con un `final` nuevo es también el sondeo de `playing → settled`: si la liquidación se chequea primero, `{ tipo: "revela" }` no se devuelve NUNCA y la revelación simultánea de los finalistas —que el spec pide y que la Task 10 cablea— queda como código muerto. Por eso el ORDEN de esas dos líneas de `destelloEntre` es la decisión, y va primero la Final. Las dos animaciones viven en elementos distintos (las líneas de susurro de la terminal y el `<ol className="escena-final">`), así que no compiten por el mismo nodo; lo único que se pierde en una sala que liquida CON Final es el fundido de los susurros, que entran enteros igual. No se pierde un solo dato en ningún caso: las tres animaciones van hacia el estado de reposo.
12. **Los dos guardas numéricos de `criatura.ts` entran en PR2 aunque PR2 no los consuma.** La revisión final de PR1 los dejó anotados como deuda "a PR2" (`filasDoradas` sin el clamp que sí aplica `capaDeIdentidad`; `nodosDe` sin redondear `filas`). Son dos líneas, tienen test, y PR2 es el PR que mueve el cálculo del bolsillo de lugar: es acá donde corresponde cerrarlos.
13. **`Escena.tsx` lleva su propio `"use client"`.** Usa `useState`/`useEffect` y la página ya abre la frontera de cliente, así que no hace falta; se pone igual para que el módulo sea honesto por su cuenta y no dependa de quién lo importe.
14. **Los tamaños de los objetos los fija el plan, no el spec: 32 px el pozo/caja/mazo, 8 px los glifos del friso y 16×12 px el dorso.** Son múltiplos exactos de sus grillas (16×16, 8×8 y 8×6), que es lo que hace que `crispEdges` siga sirviendo. El spec fija los tamaños de la criatura, no los de los objetos.
15. **La etiqueta escondida NO lleva `aria-hidden`.** El spec dice "el que está escondido lleva `aria-hidden`", pero cuál está escondido lo decide el ancho del CONTENEDOR y un atributo estático del marcado no puede seguirlo: a 375 px la escondida es la **ancha** y la angosta es la visible, así que un `aria-hidden` fijo en la angosta deja muda justo a la tarjeta que se ve — ni perfil, ni wallet, ni chip CASA/WEBHOOK, que es una regresión contra el `SeatRow` de hoy. El `display: none` del corte ya saca del árbol de accesibilidad a la copia escondida en cada ancho, así que exactamente una queda expuesta, que es lo que el spec quiere decir cuando pide que "un lector de pantalla oiga exactamente lo que se ve". La Task 14 lo mira con VoiceOver a 375 px.
16. **`aleph-desclasifica` se aplica a las líneas de susurro, no al `div.charla` entero.** El spec dice "las líneas de susurro entran": el fundido es de lo que estaba tapado, no de la ventana, que ya estaba en pantalla desde antes de liquidar. Un fundido de 400 ms por elemento hace exactamente eso y no necesita un contenedor.
17. **`Liquidacion.tsx` recibe UNA sola prop de etapas, no dos.** El spec le da dos (`etapas` con `{index, kind}` y `resultados` con los `votes`), pero las dos salen del mismo `results[]` de la vista y `gruposDeVotos` ya recibe `ResultadoDeEtapa[]` entero: dos props recortadas del mismo array se pueden desincronizar —una con seis etapas y la otra con cinco— sin que nada avise, y el componente dibujaría votos contra el `kind` equivocado. Se pasa `etapas: ResultadoDeEtapa[]` y listo.
18. **La línea del reparto de la caja nombra el sobrante.** El spec fija `aleph.scene.settledSplit` como "La caja se repartió en partes iguales: {each} para cada asiento." y decide no contar la cola de polvo ("no vale una segunda frase"). Las cuatro traducciones de la Task 5 sí la cuentan, adentro de la misma frase y entre paréntesis: "…{each} para cada uno (el sobrante, al bolsillo más grande)". No es una segunda frase, y cierra el único hueco entre esta línea y la tabla de pagos que está tres centímetros más abajo, donde el bolsillo más grande aparece con unas unidades de más (`finish()`: `const dust = s.box - each * n` y `payouts[richest.address] += dust`, `packages/game-sdk/src/aleph.ts:644` y `:647-648`). `{each}` sigue siendo `Math.floor(box / seats.length)` sobre TODOS los asientos, que es exactamente lo que el spec pide.

## Global Constraints

- Rama: `feat/aleph-etapa5-escena` (ya existe, y este worktree ya está parado ahí, en `main` = `00c703c`). **`main` no acepta push directo**: va por PR con los 2 checks de CI, y **el merge lo hace el dueño desde GitHub**.
- **NO se hace `git push` ni se abre el PR desde este plan.** Lo pide el controlador con OK del dueño. La última tarea cierra con `npm run check`, la build y la verificación visual, y ahí termina.
- **Solo se toca `apps/web`**, más el párrafo de la franja `hw >= 4` del spec (`:194-197`, cuatro líneas que pasan a siete) en la Task 1; **este plan se commitea en la rama ANTES de la Task 1** (commit propio de la dirección, como en PR1: al 2026-09-21 el archivo sigue sin trackear en el worktree, así que el commit está pendiente y lo hace quien arranca la ejecución), y por eso ninguna tarea lo agrega a su `git add`. No se toca `apps/server`, `packages/game-sdk`, `packages/agent-sdk` ni `packages/contracts` — hay otra sesión trabajando en el árbitro.
- Todo lo nuevo vive en `apps/web/app/components/aleph/`, con **imports relativos y sin el alias `@/`**, sin `wagmi`, sin el hook `useT` y sin `wallet.tsx`: así se importan desde `apps/web/test/*.test.ts` con `node --test`, sin DOM ni configuración nueva. Los textos entran por props (`t`) y las etiquetas de wallet llegan ya armadas. Los **módulos puros** (`escena.ts`, `movimiento.ts`) van un nivel más adentro, en `apps/web/app/components/aleph/nucleo/`; los **componentes** (`*.tsx`) quedan en `aleph/`. La única excepción de import es `../../lib/tiempo`, que es puro y no arrastra nada.
- **En `apps/web` no puede haber dos archivos en el MISMO directorio cuyo nombre difiera solo en la caja.** El macOS del dueño no distingue mayúsculas y TypeScript prueba `.ts` antes que `.tsx`: `escena.ts` al lado de `Escena.tsx` haría que el componente se importe a sí mismo (`TS2305` + `TS1261`). Es la razón de la carpeta `nucleo/` y se hereda tal cual de PR1. Comprobación barata, en la Task 2 y de nuevo en la Task 11: `for d in apps/web/app/components/aleph apps/web/app/components/aleph/nucleo; do ls "$d" | tr 'A-Z' 'a-z' | sort | uniq -d; done` tiene que salir vacío.
- **`escena.ts` y `movimiento.ts` son puros**: sin React, sin DOM, sin `localStorage` fuera de un `try/catch`, y sin importar el SDK (declaran la forma mínima que leen; `AlephRoomView` y `AlephLog["events"]` encajan por estructura).
- **Los componentes no deciden nada.** Todo lo que se dibuja sale de `modeloDeEscena`, `lineasDeCharla` o `gruposDeVotos`. Un `if` de negocio adentro de un `.tsx` es un bug de revisión.
- **Nada de texto dentro del SVG**, tampoco en los objetos. Ni `<text>`, ni `<title>`, ni `<clipPath>`, ni gradientes: todo rótulo es HTML traducible (Press Start 2P no tiene glifos devanagari y el sitio se sirve en hindi).
- **`aria-hidden="true"`** en pozo, caja, mazo, dorso, glifos del friso y la barra del invariante: su información está en el texto de al lado. `role="img"` + `aria-label` **solo** en la criatura de la mesa y en las dos marcas del friso.
- **En vivo no se insinúa un solo secreto**: solo se sabe quién actuó, nunca qué hizo, y de los susurros no se dice ni que existieron.
- **Un solo corte, y es de contenedor**: `.escena { container-type: inline-size }` y `@container (min-width: 560px)`. Mismo componente y **un solo dibujo de criatura** en los dos anchos. Tamaños: mesa 48 → 64 px, final 64 → 96 px, charla 32 px, probador 128 px — todos múltiplos de 16.
- **Las columnas viajan como custom properties** (`--cols-ancha` / `--cols-angosta`) y **la etiqueta se monta en las dos formas**, y la esconde el `display: none` del corte, que ya la saca del árbol de accesibilidad (desvío 15: nada de `aria-hidden` fijo). Son las únicas dos reglas duplicadas de la escena y están a propósito.
- **Las tres animaciones nuevas van HACIA el estado de reposo** (`aleph-grieta`, `aleph-revela`, `aleph-desclasifica`), cada una con su rama en el `@media (prefers-reduced-motion: reduce)` que ya existe y en `body.sin-movimiento`. Ninguna esconde su estado final: con `animation: none` no se pierde un dato.
- **i18n**: los 4 diccionarios (`es`, `en`, `fr`, `hi`) tienen **exactamente** las mismas claves, y lo fija `apps/web/test/i18n.test.ts`. Las 31 traducciones se escriben de verdad en los cuatro; nada de placeholders. **No escribir secuencias `\u` (backslash-u) en ningún archivo ni parámetro**: el hindi va en devanagari de verdad.
- **Las cuatro claves huérfanas** (`aleph.room.potInitial`, `aleph.room.nowPlaying`, `aleph.room.deadline`, `aleph.room.seats`) se borran de los cuatro diccionarios **en la misma tarea que saca sus bloques de `page.tsx`**, no antes: mientras la página las use, borrarlas imprime la clave cruda en pantalla y el test de paridad no avisa.
- Estilo del repo: **comentarios en español**, identificadores en inglés salvo los nombres que el spec fija en español (`modeloDeEscena`, `bolsilloDe`, `lineasDeCharla`, `estadoDeAsiento`, `chipDeAsiento`, `rasgosDe`, `nodosDe`, `capaDeEstado`, `svgDeCriatura`, `filasDeOro`).
- **Este archivo ya está prettier-clean, y tiene que seguir estándolo.** `docs/` no está en `.prettierignore`, así que `npm run format:check` (que es `prettier --check .`) también lo mira. Lleva marcadores `<!-- prettier-ignore -->` arriba de los bloques cuya indentación es informativa (el CSS adentro de `@layer components`, los fragmentos de TSX que van adentro del cuerpo de una función y los bloques de i18n, que son fragmentos de objeto y no archivos): **no sacarlos**. Si alguna vez hay que reformatear el plan, `npx prettier --write` sobre ese archivo y nada más.
- Cada tarea termina en verde: `npm run typecheck:web && npm run lint && npm run format:check` y el test del archivo tocado. El `typecheck` completo no hace falta por tarea: PR2 no toca `apps/server`, `apps/mcp` ni `packages/*`. Antes del último commit sí, `npm run check` completo y `npm run build --workspace apps/web`. **Si `format:check` falla, `npx prettier --write` SOLO sobre los archivos de `apps/web` que tocó la tarea, nunca `npm run format`**: `prettier --write .` reescribe todo el repo, incluido este plan.
- Commits chicos, mensajes en español con prefijo (`feat(web): …`, `test(web): …`, `fix(web): …`) y el trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`, que es la atribución de la sesión que dirige esta etapa (la misma que firmó el spec y el plan de PR1). Si otra sesión retoma el plan, manda la suya: se cambia el nombre, no el formato.

---

## File structure

| Archivo                                                                                  | Responsabilidad                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/components/aleph/nucleo/escena.ts` (crear)                                 | Puro. `modeloDeEscena`, `bolsilloDe`, `gruposDeVotos` y los tipos que consumen los siete componentes y la página                                                                 |
| `apps/web/app/components/aleph/nucleo/movimiento.ts` (crear)                             | Puro. `leerPreferencia` / `guardarPreferencia` con `try/catch` sobre `localStorage`                                                                                              |
| `apps/web/app/components/aleph/nucleo/estados.ts` (modificar)                            | Se ensancha la forma de la vista (17 campos opcionales: 8 de sala, 4 de resultado y 5 de asiento), se exportan `igual`/`incluye` y `chipDeAsiento` acepta el estado ya calculado |
| `apps/web/app/components/aleph/nucleo/criatura.ts` (modificar)                           | `filasSanas` (clamp + redondeo en un solo lugar), `nodosDeGrieta` (la grieta sola para poder animarla) y el `case "base"` + chequeo de exhaustividad de `capaDeEstado`           |
| `apps/web/app/components/aleph/Objetos.tsx` (crear)                                      | Olla, cofre de tres tapas, mazo, dorso de ALEPH y los cinco glifos de etapa, en pixel art `aria-hidden`                                                                          |
| `apps/web/app/components/aleph/Mesa.tsx` (crear)                                         | Los tres objetos, la barra de tres segmentos con su marca y la línea del invariante (o la del reparto de la caja, con la sala liquidada)                                         |
| `apps/web/app/components/aleph/CartaEtapa.tsx` (crear)                                   | Etapa, fase, reloj, la regla en una línea, el contador y, liquidada, la carta de cierre                                                                                          |
| `apps/web/app/components/aleph/Friso.tsx` (crear)                                        | Las cartas chicas: jugadas con sus marcas, la actual y los dorsos                                                                                                                |
| `apps/web/app/components/aleph/Asientos.tsx` (crear)                                     | La grilla, la tarjeta en sus dos formas, las sillas vacías y la fila de la Final                                                                                                 |
| `apps/web/app/components/aleph/Escena.tsx` (crear)                                       | Arma todo, declara el contenedor y lleva el botón de movimiento                                                                                                                  |
| `apps/web/app/components/aleph/Liquidacion.tsx` (crear)                                  | `QUIEN_VOTO_A_QUIEN.TXT`. **No pide nada**: recibe los eventos ya traídos                                                                                                        |
| `apps/web/app/components/aleph/Criatura.tsx` (modificar)                                 | La grieta en su propio `<g>` (prop `grietaNueva`), el `animationDelay` sin ruido de punto flotante y el docstring de `clase` con las cuatro variantes                            |
| `apps/web/app/components/aleph/Charla.tsx` (modificar)                                   | Importa `Destello` de `nucleo/escena`, lo consume (el fundido `aleph-desclasifica` en las líneas de susurro) y no muestra `aleph.chat.empty` con la sala liquidada               |
| `apps/web/app/lib/tiempo.ts` (crear)                                                     | `mmss()` con `export`, que hoy es una función privada de `page.tsx`                                                                                                              |
| `apps/web/app/aleph/[roomId]/page.tsx` (modificar)                                       | Monta `<Escena>` y `<Liquidacion>`, saca los tres `Money`, la ventana ASIENTOS, la línea de etapa y el contador provisorio; calcula el destello y pide el registro una vez       |
| `apps/web/app/globals.css` (modificar)                                                   | El bloque de la escena (contenedor, corte de 560 px, friso, mesa, tarjetas), las tres `@keyframes` nuevas, su rama de reduced-motion y `body.sin-movimiento`                     |
| `apps/web/app/lib/i18n/{es,en,fr,hi}.ts` (modificar)                                     | Las 31 claves nuevas y el borrado de las 4 huérfanas, en los 4 idiomas                                                                                                           |
| `apps/web/test/aleph-escena.test.ts` (crear)                                             | Tests 10 a 16 del spec, la insignia, la Oferta anulada, los grupos de votos, los guardas del oro y la preferencia de movimiento                                                  |
| `apps/web/test/aleph-criatura.test.ts` (modificar)                                       | Se lleva el test 13 (mitad de charla) al archivo nuevo y cierra la franja `hw >= 4` en el índice 2                                                                               |
| `apps/web/test/i18n.test.ts` (modificar)                                                 | Dos tests más: las 31 claves nuevas en los 4 idiomas (con sus variables) y las 4 huérfanas borradas                                                                              |
| `apps/web/app/aleph/criatura/page.tsx` (crear, opcional)                                 | El probador: un input, la criatura a 128 px y los ocho estados en fila                                                                                                           |
| `apps/web/app/aleph/criatura/layout.tsx` (crear, opcional)                               | `pageMeta` + `robots: { index: false, follow: false }`                                                                                                                           |
| `docs/superpowers/specs/2026-09-19-aleph-etapa5-espectador-visual-design.md` (modificar) | El párrafo de la franja `hw >= 4`: pasa a arrancar en el índice 2 (`y = 7`) y suma la razón de `cejudo` y `saltones` (Task 1)                                                    |

---

### Task 1: los guardas de `criatura.ts` y la grieta que se puede animar

**Files:**

- Modify: `apps/web/app/components/aleph/nucleo/criatura.ts:130-132` (el docstring de `SILUETAS`), `:328-334` (`filasDoradas` **con su docstring**: `:328-329` es el comentario y `:330-334` el cuerpo; `:336-338` ya es el docstring de `capaDeIdentidad` y no se toca), `:343` (el clamp de `capaDeIdentidad`), `:530-533` (el `default:` de `capaDeEstado`), `:541-546` (`GRIETA`, que cierra en el `];` de `:546`), `:582` y `:599-602` (`nodosDe`: el bloque va de `const grieta` al `return`, con la línea en blanco de `:601` adentro)
- Modify: `apps/web/test/aleph-criatura.test.ts:8` (el import de `lineasDeCharla`, que queda sin uso), `:72-73` (la franja `hw >= 4`; la `:71` es otro assert y NO se toca), `:589-638` (el test 13, que se muda, más la línea en blanco que lo separaba)
- Modify: `docs/superpowers/specs/2026-09-19-aleph-etapa5-espectador-visual-design.md:194-197` (la franja `hw >= 4`, que pasa a arrancar en el índice 2; la oración termina en "dónde apoyarse." de `:197`, así que el rango llega hasta ahí)
- Test: `apps/web/test/aleph-escena.test.ts` (crear)

**Interfaces:**

- Consumes: de PR1 — `nodosDe(rasgos, opts?)`, `filasDoradas(filas)`, `capaDeIdentidad(rasgos, opts?)`, `rasgosDe(address)`, `ESTADOS`, `Estado`, `lineasDeCharla(room)`, `SalaDeAleph`, y de `apps/web/test/aleph-ayuda.ts` — `A`, `B`, `direcciones(n, semilla)`, `sala(parche?, asientos?)`.
- Produces:
  - `nodosDeGrieta(estado: Estado): Nodo[]` — los cuatro nodos coral de la marca del traidor, ya con el desplazamiento del votado aplicado. La consume `Criatura.tsx` en la Task 10.
  - `apps/web/test/aleph-escena.test.ts`, el archivo al que las Tasks 2, 3 y 4 le siguen agregando tests.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/test/aleph-escena.test.ts` con el encabezado, los guardas y el test de charla que se muda desde `aleph-criatura.test.ts` (es el mismo texto, palabra por palabra: se corta de un archivo y se pega en el otro, sin tocar una aserción):

```ts
// LA PUESTA EN ESCENA. Todo contra `modeloDeEscena`, que devuelve datos: los
// componentes solo dibujan lo que hay acá adentro y no deciden nada.

import { test } from "node:test";
import assert from "node:assert/strict";

import { lineasDeCharla } from "../app/components/aleph/nucleo/charla.js";
import {
  ESTADOS,
  filasDoradas,
  nodosDe,
  nodosDeGrieta,
  rasgosDe,
} from "../app/components/aleph/nucleo/criatura.js";
import type { SalaDeAleph } from "../app/components/aleph/nucleo/estados.js";
import { A, B, direcciones } from "./aleph-ayuda.js";

test("los guardas numéricos del oro: ni fraccionarios ni filas de más", () => {
  // Con filas > 8 el oro NO puede subir a la zona de la corona de identidad
  // (y = 3-4) ni a la de estado (y <= 2): la fila más alta que puede pintar es
  // la 7, que es el tope de las ocho.
  for (const filas of [0, 1, 8, 9, 12, 100]) {
    const ys = [...filasDoradas(filas)];
    assert.ok(
      ys.every((y) => y >= 7 && y <= 14),
      `filas=${filas} pintó ${ys}`,
    );
  }
  assert.deepEqual([...filasDoradas(12)], [...filasDoradas(8)]);
  assert.equal(filasDoradas(-3).size, 0);

  // Un no entero indexaba `hw[5.5]` y emitía un rect con x/w en NaN.
  const r = rasgosDe(direcciones(1, 5)[0]);
  for (const filas of [3.5, 0.4, 7.6]) {
    for (const n of nodosDe(r, { estado: "base", filas })) {
      assert.ok(
        Number.isFinite(n.x) &&
          Number.isFinite(n.y) &&
          Number.isFinite(n.w) &&
          Number.isFinite(n.h),
        `filas=${filas} dio ${JSON.stringify(n)}`,
      );
    }
  }
  assert.deepEqual(nodosDe(r, { filas: 3.5 }), nodosDe(r, { filas: 4 }));
});

test("3 bis. la grieta suelta es la misma que dibuja nodosDe", () => {
  // `Criatura.tsx` dibuja el cuerpo con `nodosDe(..., traidor: false)` y la
  // grieta aparte, en su propio <g>, para poder animarla. Si las dos salidas se
  // fueran separando, el traidor se dibujaría distinto según quién lo pida.
  const orden = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    a.y - b.y || a.x - b.x;
  for (const a of direcciones(50, 77)) {
    const r = rasgosDe(a);
    for (const estado of ESTADOS) {
      for (const filas of [0, 4, 8]) {
        const junto = nodosDe(r, { estado, traidor: true, filas });
        const partido = [
          ...nodosDe(r, { estado, traidor: false, filas }),
          ...nodosDeGrieta(estado),
        ];
        assert.equal(junto.length, partido.length);
        assert.deepEqual([...junto].sort(orden), [...partido].sort(orden));
      }
    }
  }
});

test("13 (mitad de charla). liquidada: los susurros salen marcados, con su to y sus separadores", () => {
  const liquidada: SalaDeAleph = {
    status: "settled",
    seats: [
      { address: A, status: "finished", pocket: 6 },
      { address: B, status: "voted_out", pocket: 2 },
    ],
    results: [
      { index: 0, kind: "share" },
      { index: 1, kind: "vote" },
    ],
    messages: [
      { from: A, text: "aportemos todos", stage: 0, phase: "talk" },
      { from: B, to: A, text: "vos y yo, a los demás no", stage: 0, phase: "talk" },
      { from: A, text: "votemos al que guardó", stage: 1, phase: "talk" },
    ],
  };
  const modelo = lineasDeCharla(liquidada);
  assert.ok(modelo);
  assert.equal(modelo.desclasificada, true);
  // Separador, mensaje, susurro, separador, mensaje: en el orden en que vinieron.
  assert.deepEqual(
    modelo.lineas.map((l) => l.tipo),
    ["etapa", "mensaje", "mensaje", "etapa", "mensaje"],
  );
  assert.deepEqual(modelo.lineas[0], { tipo: "etapa", n: 1, kind: "share" });
  assert.deepEqual(modelo.lineas[3], { tipo: "etapa", n: 2, kind: "vote" });

  // `assert.fail` devuelve `never`, así que TypeScript angosta la unión después
  // de la guarda y el assert no puede pasar de casualidad por el lado que no es.
  const susurro = modelo.lineas[2];
  if (susurro.tipo !== "mensaje") assert.fail("la línea 2 tenía que ser un mensaje");
  assert.equal(susurro.susurro, true);
  assert.equal(susurro.to, A);
  assert.equal(susurro.texto, "vos y yo, a los demás no");

  const publico = modelo.lineas[1];
  if (publico.tipo !== "mensaje") assert.fail("la línea 1 tenía que ser un mensaje");
  assert.equal(publico.susurro, false);
  assert.equal(publico.to, undefined);

  // Una etapa sin resultado no rompe: el separador sale igual, sin `kind`.
  const huerfano = lineasDeCharla({ ...liquidada, results: [] });
  assert.ok(huerfano);
  const separador = huerfano.lineas[0];
  if (separador.tipo !== "etapa") assert.fail("la primera línea tenía que ser un separador");
  assert.equal(separador.kind, undefined);
  assert.equal(separador.n, 1);
});
```

Y en `apps/web/test/aleph-criatura.test.ts`, tres ediciones:

1. borrar **`:589-638`**: el test `"13 (mitad de charla)…"` arranca en `:590` (desde `test(` hasta su `});` de `:638`, que es la última línea del archivo) y la `:589` es la línea en blanco que lo separaba del anterior — **se va con él**, o el archivo termina en un renglón vacío y `format:check` se queja;
2. borrar el import que queda sin uso, la **línea 8**: `import { lineasDeCharla } from "../app/components/aleph/nucleo/charla.js";`
3. en las **líneas 72-73** (el `if (j >= 3 && j <= 8)` y su `assert.ok`; la `:71` es el assert del rango `[2, 6]` y NO se toca), cambiar el arranque de la franja del índice 3 al 2:

<!-- prettier-ignore -->
```ts
      // La franja que el spec fija es 3-8, pero la CARA empieza en el índice 2
      // (y = 7): `cejudo` (OJOS[4], x 4..11) y `saltones` (OJOS[7]) necesitan
      // hw[2] >= 4 y hoy lo tienen por casualidad en las ocho siluetas. Pasa
      // tal cual y cierra el hueco antes de que alguien agregue una silueta.
      if (j >= 2 && j <= 8)
        assert.ok(v >= 4, `silueta ${i} fila ${j}: hw=${v} < 4 en la franja 2-8`);
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `node --import tsx --test apps/web/test/aleph-escena.test.ts`
Expected: FAIL, 2 de 3. El de los guardas con `AssertionError [ERR_ASSERTION]: filas=9 pintó 6,7,8,9,10,11,12,13,14`; el de la grieta con `TypeError: (0 , import_criatura.nodosDeGrieta) is not a function or its return value is not iterable`. El test 13 pasa ya (se mudó tal cual).

- [ ] **Step 3: Escribir la implementación mínima**

En `apps/web/app/components/aleph/nucleo/criatura.ts`, seis cambios. **Todos los números de línea son los del archivo en `main`**: la (a) cambia siete líneas por catorce, así que las siguientes se corren. Aplicarlas de arriba hacia abajo y buscar por el TEXTO del anclaje, no por el número.

(a) Reemplazar `filasDoradas` **con su docstring** (`:328-334`) por el saneador más la función. El rango arranca en `:328` —el `/**` del comentario— porque el bloque de abajo trae su propio docstring, y termina en `:334` —el `}` de la función— porque `:336-338` ya es el docstring de `capaDeIdentidad`:

```ts
/** Filas de oro saneadas: entero entre 0 y 8. Las tres puertas que las reciben
 *  pasan por acá, así que un 3,5 no puede indexar `hw` con un fraccionario (y
 *  emitir un rect con x/w en NaN) ni un 12 pintar de oro la fila de la corona
 *  de identidad, que es zona prohibida. */
const filasSanas = (filas: number | undefined): number =>
  Math.max(0, Math.min(8, Math.round(Number(filas) || 0)));

/** Las filas del cuerpo (en `y` absoluto, sin desplazar) que el oro ya pintó.
 *  El oro sube desde abajo: con las ocho filas llega hasta y = 7. */
export function filasDoradas(filas: number): Set<number> {
  const salida = new Set<number>();
  for (let i = 10 - filasSanas(filas); i < 10; i++) salida.add(fy(i));
  return salida;
}
```

(b) En `capaDeIdentidad`, la línea `:343` pasa de `const filas = Math.max(0, Math.min(8, opts?.filas ?? 0));` a:

<!-- prettier-ignore -->
```ts
  const filas = filasSanas(opts?.filas);
```

(c) En `nodosDe`, la línea `:582` hace el mismo reemplazo:

<!-- prettier-ignore -->
```ts
  const filas = filasSanas(opts?.filas);
```

(d) Justo después del cierre de `GRIETA` (el `];` de `:546`, no `:545`, que es el último `nodo(...)` de adentro del array), la grieta suelta; y en `nodosDe` el bloque `:599-602` —de `const grieta` hasta el `return`, la línea en blanco de `:601` incluida— pasa a salir de ella, sin volver a bajarla (ya viene bajada). **Reemplazar solo la `:599` deja `bajar` redeclarado (`TS2451`) y el `return` viejo, que vuelve a bajar la grieta dos veces**:

```ts
/** La grieta sola, ya con el desplazamiento del votado aplicado. La exporta
 *  para que `Criatura.tsx` pueda envolverla en su propio <g> y animarla
 *  (`aleph-grieta` crece de arriba a abajo) sin tocar el resto del dibujo:
 *  un <rect> suelto no se puede seleccionar desde el CSS. `nodosDe` usa esta
 *  misma función, así que las dos salidas no pueden divergir (test 3 bis). */
export function nodosDeGrieta(estado: Estado): Nodo[] {
  const dy = estado === "votado" ? 1 : 0;
  return GRIETA().map((n) => (dy ? { ...n, y: n.y + dy } : n));
}
```

<!-- prettier-ignore -->
```ts
  const grieta = opts?.traidor ? nodosDeGrieta(estado) : [];
  const bajar = (n: Nodo): Nodo => (dy ? { ...n, y: n.y + dy } : n);

  return [...enCuerpo.map(bajar), ...grieta, ...enCabeza];
```

(e) El `default:` de `capaDeEstado` (`:530-533`) pasa a nombrar `base` y a chequear exhaustividad. **El runtime no cambia en una coma**: el retorno de reposo es el mismo y `default:` lo sigue devolviendo; lo único que cambia es que un noveno estado deja de compilar (`TS2322: Type '"…"' is not assignable to type 'never'`) en vez de entrar mudo por la puerta de atrás. Esto es lo que el ledger de PR1 difirió "a PR2", y esta tarea es la que toca el archivo:

<!-- prettier-ignore -->
```ts
    case "base":
      // `base` es el REPOSO, no un estado vacío: se distingue justamente por no
      // tener nada encima, y es el más frecuente de la pantalla.
      return { ojos: null, boca: null, overlay: [] };
    default: {
      // Un noveno estado tiene que salir en ROJO al compilar, no dibujarse como
      // reposo sin que nadie se entere. El retorno sigue siendo el de reposo:
      // la promesa de este módulo es que nunca tira, y eso no se toca.
      const _exhaustivo: never = estado;
      void _exhaustivo;
      return { ojos: null, boca: null, overlay: [] };
    }
```

(f) El docstring de `SILUETAS` (`:130-132`) dice hoy "nunca menos de 4 entre los índices 3 y 8" y pasa a decir la franja real, la misma que el test y el spec. Son las tres líneas que arrancan en "a `x = 8 + hw[i]`" y terminan en el cierre del comentario:

<!-- prettier-ignore -->
```ts
 *  a `x = 8 + hw[i]`. Máximo 6 (el cuerpo nunca pasa de x=2 a x=13) y nunca
 *  menos de 4 entre los índices 2 y 8: es el piso que hace que el dorso de 8x6
 *  entre inscripto en cualquiera de las ocho, y que `cejudo` (OJOS[4]) y
 *  `saltones` (OJOS[7]), que se apoyan en `hw[2]`, no se salgan del cuerpo. */
```

Y en el spec, `docs/superpowers/specs/2026-09-19-aleph-etapa5-espectador-visual-design.md:194-197`, la misma corrección: la revisión final de PR1 pidió que quedara anotada también ahí, porque el spec es la autoridad y hoy dice 3-8. El rango llega hasta `:197` porque la oración termina ahí ("dónde apoyarse.") y sigue con la de "Arriba y abajo de esa franja…", que el bloque devuelve tal cual. Reemplazar esas cuatro líneas por:

<!-- prettier-ignore -->
```md
entra en la grilla. **El medio ancho nunca baja de 4 entre los índices 2 y 8 del
cuerpo** (`y = 7` a `y = 13`): el piso del dorso de 8×6 arranca en el índice 3,
pero `cejudo` (`OJOS[4]`) y `saltones` (`OJOS[7]`) se apoyan en `hw[2]`, así que
la franja tiene que arrancar una fila más arriba. Es el piso que hace que el
dorso entre inscripto en cualquiera de las ocho siluetas y que la marca del
cuerpo tenga dónde apoyarse. Arriba y abajo de esa franja las siluetas se
afinan hasta
```

Las ocho siluetas ya lo cumplen (`SILUETAS[i][2]` = 5, 4, 5, 6, 4, 4, 6, 4): el cambio no mueve un píxel, cierra el hueco antes de que alguien agregue una silueta novena.

- [ ] **Step 4: Correr los tests para verlos pasar**

Run: `node --import tsx --test apps/web/test/aleph-escena.test.ts apps/web/test/aleph-criatura.test.ts apps/web/test/aleph-secretos.test.ts`
Expected: PASS — 3 tests en `aleph-escena`, **13** en `aleph-criatura` (uno menos que los 14 de `main`: el 13 se mudó) y los 5 de `aleph-secretos`. Después, la compuerta: `npm run typecheck:web && npm run lint && npm run format:check` en verde.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/aleph/nucleo/criatura.ts apps/web/test/aleph-criatura.test.ts apps/web/test/aleph-escena.test.ts docs/superpowers/specs/2026-09-19-aleph-etapa5-espectador-visual-design.md
git commit -m "fix(web): los guardas del oro de la criatura y la grieta como nodo aparte

filasDoradas y nodosDe sanean las filas en un solo lugar (entero, 0 a 8): con
12 el oro pintaba la fila de la corona de identidad y con 3,5 salían rects en
NaN. Y la grieta del traidor se puede pedir sola, que es lo que va a permitir
animarla sin tocar el resto del dibujo.

capaDeEstado nombra 'base' y chequea exhaustividad: mismo runtime, pero un
noveno estado pasa a salir en rojo al compilar.

La franja hw >= 4 arranca en el índice 2 y no en el 3 (cejudo y saltones se
apoyan en hw[2]): se corrige el test, el docstring de SILUETAS y el spec, que
es la autoridad. Las ocho siluetas ya lo cumplían.

El test de la mitad de charla se muda al archivo de la escena, que es donde el
spec lo tenía asignado.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `estados.ts` se ensancha y nace `escena.ts`

**Files:**

- Modify: `apps/web/app/components/aleph/nucleo/estados.ts:13-17` (`AsientoDeSala`), `:19-27` (`ResultadoDeEtapa`), `:38-47` (`SalaDeAleph`), `:49-50` (`igual` / `incluye`), `:114-118` (la firma de `chipDeAsiento` y su primera línea de cuerpo)
- Create: `apps/web/app/components/aleph/nucleo/escena.ts`
- Test: `apps/web/test/aleph-escena.test.ts` (agregar, ya existe de la Task 1)

**Interfaces:**

- Consumes: de PR1 — `estadoDeAsiento(seat, room) => { estado: Estado; traidor: boolean }`, `chipDeAsiento(seat, room) => string`, `Estado`, `AsientoDeSala`, `EstadoDeSala`, `EtapaKind`, `Fase`, `ResultadoDeEtapa`, `SalaDeAleph`, `lineasDeCharla(room)`. De la Task 1 — nada.
- Produces (los consumen las Tasks 3 y 8 a 13):
  - `type Traductor = (key: string, vars?: Record<string, string | number>) => string`
  - `type Destello = { tipo: "grieta" | "revela" | "desclasifica"; asientos?: string[] }`
  - `interface EtiquetaDeAsiento { plana: string; perfil: string | null; wallet: string; tag: string | null }`
  - `bolsilloDe(seat: AsientoDeSala, room: SalaDeAleph): number`
  - `interface AsientoDeEscena { seat; address; estado; traidor; bolsillo; chip; insignia; respira }`
  - `interface EtapaDeEscena`, `ContadorDeEscena`, `CierreDeEscena`, `CartaDeEscena`
  - `interface CartaDelFriso`, `FrisoDeEscena`, `MesaDeEscena`, `ModeloDeEscena`
  - `modeloDeEscena(room: SalaDeAleph): ModeloDeEscena`
  - y de `estados.ts`: `igual(a, b)`, `incluye(xs, a)`, `chipDeAsiento(seat, room, previo?)`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `apps/web/test/aleph-escena.test.ts` (y completar el bloque de imports de arriba con lo que hace falta: `bolsilloDe` y `modeloDeEscena` de `escena.js`, y los tipos `AsientoDeSala`, `EstadoDeAsiento` y `SalaDeAleph` de `estados.js`, más `C` y `sala` de `aleph-ayuda.js`).

El bloque de imports del archivo queda así:

```ts
import { lineasDeCharla } from "../app/components/aleph/nucleo/charla.js";
import {
  ESTADOS,
  filasDoradas,
  nodosDe,
  nodosDeGrieta,
  rasgosDe,
} from "../app/components/aleph/nucleo/criatura.js";
import { bolsilloDe, modeloDeEscena } from "../app/components/aleph/nucleo/escena.js";
import type {
  AsientoDeSala,
  EstadoDeAsiento,
  SalaDeAleph,
} from "../app/components/aleph/nucleo/estados.js";
import { A, B, C, direcciones, sala } from "./aleph-ayuda.js";

/** `n` asientos vivos con direcciones estables. */
function asientos(n: number, estado: EstadoDeAsiento = "alive"): AsientoDeSala[] {
  return direcciones(n, 11).map((address) => ({ address, status: estado, pocket: 0 }));
}
```

Y los diez tests (los 10 a 16 del spec, más la insignia con la Oferta anulada, el friso de la Oferta anulada y la sala que liquidó sin Final):

```ts
test("10. mesas de 4, 6 y 8: columnas, etiquetas y el que habla en la fase en curso", () => {
  for (const [n, ancha] of [
    [4, 4],
    [5, 3],
    [6, 3],
    [7, 4],
    [8, 4],
  ] as const) {
    const m = modeloDeEscena(sala({ seats: asientos(n) }));
    assert.equal(m.columnas.ancha, ancha, `mesa de ${n}`);
    assert.equal(m.columnas.angosta, 2, `mesa de ${n}`);
    assert.equal(m.asientos.length, n);
    // Ninguna tarjeta sin etiqueta: la escena pasa el asiento entero, que es
    // lo que `etiquetaDe` necesita para armarla.
    for (const a of m.asientos) {
      assert.equal(a.seat.address, a.address);
      assert.ok(a.chip.startsWith("aleph."), `chip crudo: ${a.chip}`);
    }
  }

  // El que mandó el último mensaje DE LA FASE EN CURSO sale `hablando`: es la
  // única prueba de que el modelo recibe `messages` y no una vista recortada.
  const hablando = modeloDeEscena(
    sala({
      stage: { index: 0, kind: "vote", phase: "talk", acted: [] },
      messages: [{ from: B, text: "votemos al que guardó", stage: 0, phase: "talk" }],
    }),
  );
  assert.equal(hablando.asientos.find((a) => a.address === B)?.estado, "hablando");
  assert.equal(hablando.asientos.find((a) => a.address === B)?.chip, "aleph.state.hablando");
  assert.equal(hablando.asientos.find((a) => a.address === A)?.estado, "base");
});

test("la insignia +{n} sale de la Oferta que NO se anuló, y nunca undefined", () => {
  const room: SalaDeAleph = {
    status: "settled",
    seats: [
      { address: A, status: "left", pocket: 120 },
      { address: B, status: "finished", pocket: 300 },
    ],
    // Dos Ofertas, como el mazo real. La primera se anuló (aceptaron todos) y
    // salió sin tocar `eachGot`; la segunda sí pagó.
    results: [
      { index: 0, kind: "offer", accepted: [A, B], voided: true },
      { index: 1, kind: "offer", accepted: [A], eachGot: 120 },
    ],
    payouts: { [A]: 120, [B]: 300 },
    messages: [],
  };
  const m = modeloDeEscena(room);
  const salido = m.asientos.find((a) => a.address === A);
  assert.equal(salido?.estado, "se_fue");
  assert.equal(salido?.insignia, 120);

  // Sin monto no se inventa un número: la criatura se fue igual.
  const sinMonto = modeloDeEscena({
    ...room,
    results: [{ index: 0, kind: "offer", accepted: [A], voided: true }],
  });
  assert.equal(sinMonto.asientos.find((a) => a.address === A)?.insignia, null);
  // Y el que no se fue nunca lleva insignia.
  assert.equal(m.asientos.find((a) => a.address === B)?.insignia, null);
});

test("11. lobby: las sillas vacías son las que faltan, y una sola si el mínimo ya está", () => {
  const lobby = (n: number, min: number, max: number) =>
    modeloDeEscena({
      status: "lobby",
      seats: asientos(n),
      min,
      max,
      closesAt: 1_700_000_000_000,
    });

  const dosDeCuatro = lobby(2, 4, 8);
  assert.equal(dosDeCuatro.asientos.length, 2);
  assert.equal(dosDeCuatro.sillas, 2);
  assert.equal(lobby(4, 4, 8).sillas, 1);
  assert.equal(lobby(8, 4, 8).sillas, 0);
  // El reloj del lobby es el único que la barra de la escena se queda.
  assert.equal(dosDeCuatro.reloj, 1_700_000_000_000);
  // Y no hay mesa, ni friso, ni carta: el árbitro no manda nada de eso todavía.
  assert.equal(dosDeCuatro.mesa, null);
  assert.equal(dosDeCuatro.friso, null);
  assert.equal(dosDeCuatro.carta, null);

  // En `funding` no se dibuja ninguna silla: la lista ya está congelada.
  const fondeando = modeloDeEscena({
    status: "funding",
    seats: asientos(4),
    min: 4,
    max: 8,
    deposited: [],
  });
  assert.equal(fondeando.sillas, 0);
  assert.equal(fondeando.reloj, null);
  assert.equal(fondeando.asientos[0].chip, "aleph.seat.pending");
});

test("12. dissolved: sin mesa, sin charla y los ocho en abandono", () => {
  // La vista que manda el árbitro en `dissolved`: asientos y nada más.
  const room: SalaDeAleph = { status: "dissolved", seats: asientos(8), min: 4, max: 8 };
  const m = modeloDeEscena(room);
  assert.equal(m.asientos.length, 8);
  for (const a of m.asientos) {
    assert.equal(a.estado, "abandono");
    assert.equal(a.chip, "aleph.seat.dissolved");
    assert.equal(a.respira, false);
    assert.equal(a.bolsillo, 0);
  }
  assert.equal(m.mesa, null);
  assert.equal(m.carta, null);
  assert.equal(m.friso, null);
  assert.equal(m.sillas, 0);
  assert.equal(m.maximo, 0);
  // Sin `messages` la terminal no se monta.
  assert.equal(lineasDeCharla(room), null);
});

test("13. settled: el oro sale de payouts, y el friso no tiene dorsos ni carta actual", () => {
  const [a, b, c, d] = direcciones(4, 21);
  const room: SalaDeAleph = {
    status: "settled",
    seats: [
      { address: a, status: "finished", pocket: 100 },
      { address: b, status: "voted_out", pocket: 40 },
      { address: c, status: "left", pocket: 60 },
      { address: d, status: "abandoned", pocket: 0 },
    ],
    results: [
      { index: 0, kind: "share", bonus: 25 },
      { index: 1, kind: "vote", eliminated: b, votes: { [a]: 0, [b]: 2, [c]: 1 } },
      { index: 2, kind: "offer", accepted: [c], eachGot: 60 },
    ],
    payouts: { [a]: 450, [b]: 90, [c]: 110, [d]: 50 },
    pot: 0,
    box: 200,
    potInitial: 4000,
    cardsLeft: 3,
    messages: [],
  };
  const m = modeloDeEscena(room);
  // `payouts` gana sobre `pocket`, en un solo lugar.
  assert.equal(m.asientos.find((x) => x.address === a)?.bolsillo, 450);
  assert.equal(bolsilloDe(room.seats[0], room), 450);
  // Y sin caja: el motor escribe `payouts` en minúsculas y el asiento puede
  // llegar en EIP-55. Indexado directo, el bolsillo caía a `pocket` en silencio.
  const eip55 = `0x${a.slice(2).toUpperCase()}`;
  assert.equal(bolsilloDe({ ...room.seats[0], address: eip55 }, room), 450);
  assert.equal(m.maximo, 450);
  // Ni un dorso ni carta en curso: la Final cortó el mazo.
  assert.equal(m.friso?.dorsos, 0);
  assert.equal(m.friso?.actual, null);
  assert.equal(m.friso?.jugadas.length, 3);
  // Las marcas del friso: salida donde alguien dejó la mesa de verdad, premio
  // donde la caja le devolvió al pozo.
  assert.deepEqual(
    m.friso?.jugadas.map((j) => [j.salida, j.premio]),
    [
      [false, true],
      [true, false],
      [true, false],
    ],
  );
  // El mazo va apagado y el reparto de la caja es `floor(box / N)`, la misma
  // cuenta que hace el motor (acá 200 / 4 = 50, sin sobrante).
  assert.equal(m.mesa?.liquidada, true);
  assert.equal(m.mesa?.reparto, 50);
  assert.equal(m.mesa?.pozo, 0);
});

test("13 bis. la Oferta anulada no marca salida en el friso", () => {
  const m = modeloDeEscena({
    status: "playing",
    seats: asientos(4),
    stage: { index: 1, kind: "vote", phase: "talk", acted: [] },
    results: [{ index: 0, kind: "offer", accepted: direcciones(4, 11), voided: true }],
    messages: [],
    cardsLeft: 5,
  });
  assert.equal(m.friso?.jugadas[0].salida, false);
  assert.equal(m.friso?.dorsos, 5);
  assert.deepEqual(m.friso?.actual, { n: 2, kind: "vote" });
});

test("14. el invariante cierra: pozo + caja + bolsillos = total", () => {
  const m = modeloDeEscena({
    status: "playing",
    seats: [
      { address: A, status: "alive", pocket: 120 },
      { address: B, status: "alive", pocket: 80 },
      { address: C, status: "left", pocket: 300 },
      { address: direcciones(4, 11)[3], status: "alive", pocket: 0 },
    ],
    stage: { index: 3, kind: "share", phase: "decide", acted: [A] },
    results: [],
    messages: [],
    pot: 2600,
    box: 900,
    potInitial: 4000,
    cardsLeft: 6,
  });
  const mesa = m.mesa;
  assert.ok(mesa);
  assert.equal(mesa.bolsillos, 500);
  assert.equal(mesa.pozo + mesa.caja + mesa.bolsillos, mesa.total);
  assert.equal(mesa.liquidada, false);
  assert.equal(mesa.reparto, null);
  // El contador cuenta a los VIVOS que actuaron, no a los que ya salieron.
  assert.deepEqual(m.carta?.contador, { clave: "aleph.scene.acted", k: 1, n: 3 });
  assert.equal(m.carta?.etapa?.n, 4);
});

test("15. sin 'de N': la carta no trae ningún total de etapas", () => {
  const base: SalaDeAleph = {
    status: "playing",
    seats: asientos(4),
    stage: { index: 5, kind: "lock", phase: "talk", acted: [] },
    results: [],
    messages: [],
    cardsLeft: 10,
  };
  const conMazo = modeloDeEscena(base);
  const sinMazo = modeloDeEscena({ ...base, cardsLeft: 0 });
  // La carta dice lo mismo con 10 cartas sin dar y con ninguna: el total de
  // etapas no existe (la Final no sale del mazo y el director puede repartir
  // Votos de más), así que `cardsLeft` no puede filtrarse ahí adentro.
  assert.deepEqual(conMazo.carta, sinMazo.carta);
  assert.deepEqual(Object.keys(conMazo.carta?.etapa ?? {}).sort(), ["fase", "hasta", "kind", "n"]);
  assert.equal(conMazo.carta?.contador?.n, 4);
  assert.equal(conMazo.carta?.etapa?.n, 6);
  // El mazo sigue contando sus cartas, que es otra cosa: "sin dar", no "faltan".
  assert.equal(conMazo.friso?.dorsos, 10);
  assert.equal(sinMazo.friso?.dorsos, 0);
});

test("16. la corona de la Final, con Final y sin ella", () => {
  const [a, b] = [A, B];
  const finalDe = (choices: Record<string, "split" | "steal">): SalaDeAleph => ({
    status: "settled",
    seats: [
      { address: a, status: "finished", pocket: 300 },
      { address: b, status: "finished", pocket: 200 },
    ],
    results: [{ index: 0, kind: "final", choices }],
    payouts: { [a]: 300, [b]: 200 },
    messages: [],
  });

  // Un solo `steal`: la corona es de él.
  const robo = modeloDeEscena(finalDe({ [a]: "steal", [b]: "split" }));
  const dosDe = (m: ReturnType<typeof modeloDeEscena>) => [...m.finalistas, ...m.asientos];
  assert.equal(dosDe(robo).find((x) => x.address === a)?.estado, "ganador");
  // El que dividió mientras el otro robaba NO se pinta de perdedor.
  const perdio = dosDe(robo).find((x) => x.address === b);
  assert.equal(perdio?.estado, "base");
  assert.equal(perdio?.traidor, false);

  // Los dos `split`: los dos con corona.
  const dividieron = dosDe(modeloDeEscena(finalDe({ [a]: "split", [b]: "split" })));
  assert.deepEqual(
    dividieron.map((x) => x.estado),
    ["ganador", "ganador"],
  );
  // Los dos `steal`: ninguno.
  const quemaron = dosDe(modeloDeEscena(finalDe({ [a]: "steal", [b]: "steal" })));
  assert.deepEqual(
    quemaron.map((x) => x.estado),
    ["base", "base"],
  );

  // La grilla se parte en dos: los dos finalistas arriba, el resto abajo.
  const conFinal = modeloDeEscena(finalDe({ [a]: "steal", [b]: "split" }));
  assert.equal(conFinal.finalistas.length, 2);
  assert.equal(conFinal.asientos.length, 0);
  assert.equal(conFinal.carta?.cierre?.clave, "aleph.line.finalSteal");
  assert.equal(conFinal.carta?.cierre?.quien, a);
  assert.equal(
    modeloDeEscena(finalDe({ [a]: "split", [b]: "split" })).carta?.cierre?.clave,
    "aleph.line.finalSplit",
  );
  assert.equal(
    modeloDeEscena(finalDe({ [a]: "steal", [b]: "steal" })).carta?.cierre?.clave,
    "aleph.line.finalBurn",
  );
});

test("16 bis. una sala que liquidó SIN Final: corona al único vivo y carta sin desenlace", () => {
  const sinFinal = (estados: EstadoDeAsiento[]): SalaDeAleph => ({
    status: "settled",
    seats: direcciones(3, 31).map((address, i) => ({
      address,
      status: estados[i],
      pocket: 10 * (i + 1),
    })),
    results: [{ index: 0, kind: "offer", accepted: [], voided: false }],
    messages: [],
  });

  const unVivo = modeloDeEscena(sinFinal(["finished", "left", "voted_out"]));
  assert.deepEqual(
    unVivo.asientos.map((x) => x.estado),
    ["ganador", "se_fue", "votado"],
  );
  assert.equal(unVivo.finalistas.length, 0);
  // Ni intenta una línea de desenlace: no hubo Final que contar.
  assert.deepEqual(unVivo.carta, {
    etapa: null,
    contador: null,
    cierre: { clave: "aleph.scene.settledNoFinal", quien: null },
  });

  const ninguno = modeloDeEscena(sinFinal(["voted_out", "left", "abandoned"]));
  assert.equal(ninguno.asientos.filter((x) => x.estado === "ganador").length, 0);
  assert.equal(ninguno.carta?.cierre?.clave, "aleph.scene.settledNoFinal");
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `node --import tsx --test apps/web/test/aleph-escena.test.ts`
Expected: FAIL, 1 de 1, con `Error: Cannot find module '../app/components/aleph/nucleo/escena.js'` — el módulo todavía no existe, así que el archivo entero no carga (a diferencia de un export que falta, que solo voltea su propio test).

- [ ] **Step 3: Escribir la implementación mínima**

(a) En `apps/web/app/components/aleph/nucleo/estados.ts`, cuatro ediciones.

`AsientoDeSala` (`:13-17`) suma la ficha pública:

```ts
export interface AsientoDeSala {
  address: string;
  status: EstadoDeAsiento;
  pocket: number;
  /** Ficha pública que resuelve el árbitro. La escena NO la lee: se la pasa
   *  entera a `etiquetaDe`, que la arma la página con `playerLabel`/`agentTag`. */
  name?: string;
  avatar?: string;
  agentId?: string;
  house?: boolean;
  byo?: boolean;
}
```

`ResultadoDeEtapa` (`:19-27`) suma los cuatro campos que leen el friso y la ventana de votos:

```ts
export interface ResultadoDeEtapa {
  index: number;
  kind: EtapaKind;
  accepted?: string[];
  eachGot?: number;
  voided?: boolean;
  traitors?: string[];
  choices?: Record<string, "split" | "steal">;
  /** Los cuatro que lee el friso y la ventana de votos de la liquidación. */
  eliminated?: string;
  abandoned?: string[];
  bonus?: number;
  votes?: Record<string, number>;
}
```

`SalaDeAleph` (`:38-47`) suma la mesa y los datos del lobby, **todos opcionales** (`AlephRoomView` los trae y encaja igual; un fixture de tres líneas también):

```ts
export interface SalaDeAleph {
  status: EstadoDeSala;
  seats: AsientoDeSala[];
  /** Los del lobby. `AlephRoomView` los trae siempre; acá van opcionales para
   *  que un fixture de tres líneas siga compilando. */
  min?: number;
  max?: number;
  closesAt?: number;
  /** Fin de la fase en curso. Solo `playing`. */
  deadline?: number;
  /** La mesa. No vienen en `lobby`, `funding` ni `dissolved`. */
  pot?: number;
  box?: number;
  potInitial?: number;
  cardsLeft?: number;
  /** No viene en `lobby`, `funding` ni `dissolved`. */
  stage?: { index: number; kind: EtapaKind; phase: Fase; acted: string[] };
  results?: ResultadoDeEtapa[];
  messages?: MensajeDeSala[];
  deposited?: string[];
  payouts?: Record<string, number>;
}
```

`igual` e `incluye` (`:49-50`) pasan a exportarse, sin cambiar de nombre ni de cuerpo:

```ts
/** Las direcciones se comparan SIN caja: el árbitro sirve `deposited` en
 *  minúsculas y `seats[].address` puede venir en EIP-55. Las exporta para que
 *  `escena.ts` no escriba su propia versión. */
export const igual = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const incluye = (xs: string[] | undefined, a: string) => (xs ?? []).some((x) => igual(x, a));
```

Y `chipDeAsiento` (`:114-118`) acepta el estado ya calculado:

<!-- prettier-ignore -->
```ts
export function chipDeAsiento(seat: AsientoDeSala, room: SalaDeAleph, previo?: Estado): string {
  if (room.status === "dissolved") return "aleph.seat.dissolved";
  if (room.status === "funding")
    return incluye(room.deposited, seat.address) ? "aleph.seat.deposited" : "aleph.seat.pending";
  // `previo` es el estado que el llamador YA calculó. Sin él, cada asiento
  // vuelve a recorrer `results` y `messages` una segunda vez.
  const estado = previo ?? estadoDeAsiento(seat, room).estado;
```

(el resto del cuerpo, de `if (estado === "ganador")` para abajo, queda igual).

(b) Crear `apps/web/app/components/aleph/nucleo/escena.ts`:

```ts
// LA PUESTA EN ESCENA. Puro: convierte la vista pública de una sala en el
// modelo que dibujan los componentes. Los componentes no deciden nada — leen
// este objeto. Así la escena entera se prueba con `node --test`, sin DOM.
//
// Lo que NO arma: la terminal de la charla, que es de `charla.ts`.

import { chipDeAsiento, estadoDeAsiento, igual, incluye } from "./estados";
import type {
  AsientoDeSala,
  EstadoDeSala,
  EtapaKind,
  Fase,
  ResultadoDeEtapa,
  SalaDeAleph,
} from "./estados";
import type { Estado } from "./criatura";

/** El `t` de la página. Los componentes de la escena no importan `useT`: los
 *  textos entran por prop, que es lo que les permite ser puros de dibujo. */
export type Traductor = (key: string, vars?: Record<string, string | number>) => string;

/** Lo que la página calcula comparando la vista nueva con la anterior, y que
 *  le pasa IGUAL a la escena y a la terminal: son ventanas hermanas y ninguna
 *  es hija de la otra. Vive acá y no en `Charla.tsx` porque ahora lo usan los
 *  dos lados. */
export type Destello = { tipo: "grieta" | "revela" | "desclasifica"; asientos?: string[] };

/** La etiqueta de un asiento, en las dos formas que la escena necesita. La
 *  arma la página, que es la única que puede importar `wallet.tsx`. La versión
 *  ancha es el string plano de `playerLabel`; la angosta son sus tres pedazos,
 *  porque a 375 px el string entero no entra y no hay media query que parta un
 *  string. */
export interface EtiquetaDeAsiento {
  plana: string;
  /** `{avatar} {nombre}`, o `null` si el asiento no tiene perfil. */
  perfil: string | null;
  /** `shortAddress(address)`. NUNCA se trunca, en ningún ancho. */
  wallet: string;
  /** CASA/WEBHOOK, ya traducido, o `null`. */
  tag: string | null;
}

/** El bolsillo de un asiento, en UN solo lugar: mientras la sala juega es
 *  `pocket`; cuando liquidó es `payouts[address]`, que es con lo que se fue de
 *  verdad. Escrito dos veces, el oro del cuerpo y el monto de la tarjeta se
 *  pueden ir a distintas escalas sin que nadie se entere. */
export function bolsilloDe(seat: AsientoDeSala, room: SalaDeAleph): number {
  const pagos = room.payouts;
  if (!pagos) return seat.pocket;
  // Sin caja, como todo el resto del módulo: el motor escribe `payouts` en
  // minúsculas y `seats[].address` puede llegar en EIP-55. Indexado directo,
  // el oro del cuerpo y el monto de la tarjeta caían a `pocket` sin aviso.
  const clave = Object.keys(pagos).find((a) => igual(a, seat.address));
  return clave === undefined ? seat.pocket : pagos[clave];
}

export interface AsientoDeEscena {
  /** El asiento crudo, para `etiquetaDe`: la escena no arma etiquetas. */
  seat: AsientoDeSala;
  address: string;
  estado: Estado;
  traidor: boolean;
  bolsillo: number;
  /** Clave de i18n; el texto lo resuelve el componente con `t`. */
  chip: string;
  /** El `+{n}` del que se fue con plata. `null` si no hay monto que mostrar. */
  insignia: number | null;
  /** Solo los vivos de una sala en juego respiran. */
  respira: boolean;
}

export interface EtapaDeEscena {
  n: number;
  kind: EtapaKind;
  fase: Fase;
  /** `deadline` (epoch ms), o `null` si el árbitro no lo manda. */
  hasta: number | null;
}

export interface ContadorDeEscena {
  clave: "aleph.scene.acted" | "aleph.scene.ready";
  k: number;
  n: number;
}

export interface CierreDeEscena {
  clave: string;
  /** La dirección del único que robó, para `aleph.line.finalSteal`. */
  quien: string | null;
}

export interface CartaDeEscena {
  etapa: EtapaDeEscena | null;
  contador: ContadorDeEscena | null;
  cierre: CierreDeEscena | null;
}

export interface CartaDelFriso {
  n: number;
  kind: EtapaKind;
  salida: boolean;
  premio: boolean;
}

export interface FrisoDeEscena {
  jugadas: CartaDelFriso[];
  actual: { n: number; kind: EtapaKind } | null;
  /** Dorsos de las que faltan. Cero con la sala liquidada. */
  dorsos: number;
}

export interface MesaDeEscena {
  pozo: number;
  caja: number;
  bolsillos: number;
  total: number;
  cartasSinDar: number;
  /** `settled`: el mazo va apagado y sin número, y no se dibuja la barra. */
  liquidada: boolean;
  /** `settled`: lo que la caja repartió por asiento. `null` mientras juega. */
  reparto: number | null;
}

export interface ModeloDeEscena {
  estado: EstadoDeSala;
  /** `closesAt` del lobby: el único reloj que la barra de la escena se queda. */
  reloj: number | null;
  columnas: { ancha: number; angosta: number };
  asientos: AsientoDeEscena[];
  /** Los dos de la Final, fuera de la grilla. Vacío el resto del tiempo. */
  finalistas: AsientoDeEscena[];
  sillas: number;
  /** El máximo de la mesa: contra él se mide el oro de cada cuerpo. */
  maximo: number;
  mesa: MesaDeEscena | null;
  carta: CartaDeEscena | null;
  friso: FrisoDeEscena | null;
}

/** Columnas del contenedor ancho por cantidad de asientos: 4 -> 4, 5 o 6 -> 3,
 *  7 u 8 -> 4. El angosto son dos, siempre. */
function columnasDe(n: number): { ancha: number; angosta: number } {
  return { ancha: n === 5 || n === 6 ? 3 : 4, angosta: 2 };
}

/** El `+{n}` del que aceptó la Oferta. El `!r.voided` no es defensa de más: el
 *  mazo trae DOS Ofertas y el motor escribe `accepted` entero antes de
 *  descubrir que aceptaron todos, ahí marca `voided` y sale sin tocar
 *  `eachGot`. Sin el filtro, el que aceptó la SEGUNDA hace match con la
 *  primera y la insignia imprime `+undefined`. Y si aun así no hay monto, no
 *  se dibuja: la criatura se fue igual, pero no se inventa un número. */
function insigniaDe(room: SalaDeAleph, address: string, estado: Estado): number | null {
  if (estado !== "se_fue") return null;
  const oferta = (room.results ?? []).find(
    (r) => r.kind === "offer" && !r.voided && incluye(r.accepted, address),
  );
  return typeof oferta?.eachGot === "number" ? oferta.eachGot : null;
}

function asientoDeEscena(seat: AsientoDeSala, room: SalaDeAleph): AsientoDeEscena {
  const { estado, traidor } = estadoDeAsiento(seat, room);
  return {
    seat,
    address: seat.address,
    estado,
    traidor,
    bolsillo: bolsilloDe(seat, room),
    chip: chipDeAsiento(seat, room, estado),
    insignia: insigniaDe(room, seat.address, estado),
    respira: room.status === "playing" && seat.status === "alive",
  };
}

/** Los dos de la Final. Mientras se juega son los dos vivos (las decisiones son
 *  secretas hasta que cierra); con la sala liquidada salen de `choices`, que es
 *  exacto. Si no son exactamente dos, la grilla no se parte. */
function direccionesFinalistas(room: SalaDeAleph): string[] {
  const ultimo = (room.results ?? [])[(room.results ?? []).length - 1];
  if (room.status === "settled" && ultimo?.kind === "final")
    return Object.keys(ultimo.choices ?? {});
  if (room.status === "playing" && room.stage?.kind === "final")
    return room.seats.filter((s) => s.status === "alive").map((s) => s.address);
  return [];
}

function cierreDe(room: SalaDeAleph): CierreDeEscena {
  const final = (room.results ?? []).find((r) => r.kind === "final");
  // Una sala puede liquidar SIN Final, y es el caso común: la Final solo se
  // abre cuando quedan exactamente dos vivos.
  if (!final) return { clave: "aleph.scene.settledNoFinal", quien: null };
  const ladrones = Object.entries(final.choices ?? {})
    .filter(([, c]) => c === "steal")
    .map(([a]) => a);
  if (ladrones.length === 0) return { clave: "aleph.line.finalSplit", quien: null };
  if (ladrones.length === 1) return { clave: "aleph.line.finalSteal", quien: ladrones[0] };
  return { clave: "aleph.line.finalBurn", quien: null };
}

function cartaDe(room: SalaDeAleph): CartaDeEscena | null {
  if (room.status === "playing" && room.stage) {
    const vivos = room.seats.filter((s) => s.status === "alive");
    const k = room.stage.acted.filter((a) => vivos.some((s) => igual(s.address, a))).length;
    return {
      etapa: {
        n: room.stage.index + 1,
        kind: room.stage.kind,
        fase: room.stage.phase,
        hasta: room.deadline ?? null,
      },
      contador: {
        clave: room.stage.phase === "decide" ? "aleph.scene.acted" : "aleph.scene.ready",
        k,
        n: vivos.length,
      },
      cierre: null,
    };
  }
  if (room.status === "settled") return { etapa: null, contador: null, cierre: cierreDe(room) };
  return null;
}

/** Una etapa marca SALIDA solo si alguien dejó la mesa de verdad. Una Oferta
 *  anulada trae `accepted` lleno y no se va nadie: el motor la escribe y recién
 *  después descubre que aceptaron todos. */
function salioAlguien(r: ResultadoDeEtapa): boolean {
  if (r.eliminated) return true;
  if (r.abandoned?.length) return true;
  return Boolean(r.accepted?.length) && !r.voided;
}

function frisoDe(room: SalaDeAleph): FrisoDeEscena | null {
  if (room.status !== "playing" && room.status !== "settled") return null;
  const jugando = room.status === "playing";
  return {
    jugadas: (room.results ?? []).map((r) => ({
      n: r.index + 1,
      kind: r.kind,
      salida: salioAlguien(r),
      premio: (r.bonus ?? 0) > 0,
    })),
    // Con la sala liquidada no hay etapa en curso, y la última ya está en
    // `results`: dibujarla sería un duplicado.
    actual: jugando && room.stage ? { n: room.stage.index + 1, kind: room.stage.kind } : null,
    // Y no hay dorsos: la Final cortó el mazo, así que anunciar cartas que
    // nunca se van a dar sería mentir.
    dorsos: jugando ? (room.cardsLeft ?? 0) : 0,
  };
}

function mesaDe(room: SalaDeAleph): MesaDeEscena | null {
  if (room.status !== "playing" && room.status !== "settled") return null;
  const liquidada = room.status === "settled";
  const caja = room.box ?? 0;
  return {
    pozo: room.pot ?? 0,
    caja,
    // Los bolsillos de la barra leen `pocket` SIEMPRE, no `bolsilloDe`: la
    // barra no se dibuja con la sala liquidada, justamente para no contar dos
    // veces la caja que `payouts` ya repartió.
    bolsillos: room.seats.reduce((n, s) => n + s.pocket, 0),
    total: room.potInitial ?? 0,
    cartasSinDar: room.cardsLeft ?? 0,
    liquidada,
    // El árbitro no lo publica: es la misma cuenta que hace el motor.
    reparto: liquidada && room.seats.length > 0 ? Math.floor(caja / room.seats.length) : null,
  };
}

export function modeloDeEscena(room: SalaDeAleph): ModeloDeEscena {
  const finalistas = direccionesFinalistas(room);
  const parte = finalistas.length === 2;
  const todos = room.seats.map((s) => asientoDeEscena(s, room));
  // Las sillas vacías son SOLO del lobby: en `funding` la lista ya está
  // congelada y una silla prometería un lugar que no se puede ocupar.
  const sillas =
    room.status === "lobby"
      ? Math.max(
          0,
          Math.max(
            (room.min ?? 0) - room.seats.length,
            room.seats.length < (room.max ?? 0) ? 1 : 0,
          ),
        )
      : 0;
  return {
    estado: room.status,
    reloj: room.status === "lobby" ? (room.closesAt ?? null) : null,
    columnas: columnasDe(room.seats.length),
    asientos: parte ? todos.filter((a) => !incluye(finalistas, a.address)) : todos,
    finalistas: parte ? todos.filter((a) => incluye(finalistas, a.address)) : [],
    sillas,
    maximo: todos.reduce((m, a) => Math.max(m, a.bolsillo), 0),
    mesa: mesaDe(room),
    carta: cartaDe(room),
    friso: frisoDe(room),
  };
}
```

- [ ] **Step 4: Correr los tests para verlos pasar**

Run: `node --import tsx --test apps/web/test/aleph-escena.test.ts apps/web/test/aleph-criatura.test.ts apps/web/test/aleph-secretos.test.ts`
Expected: PASS — 13 tests en `aleph-escena` (3 de la Task 1 + 10 de esta), y los otros dos archivos sin cambios de conteo.
Después, la compuerta: `npm run typecheck:web && npm run lint && npm run format:check` en verde, y la comprobación de mayúsculas:

```bash
for d in apps/web/app/components/aleph apps/web/app/components/aleph/nucleo; do ls "$d" | tr 'A-Z' 'a-z' | sort | uniq -d; done
```

Expected: sin salida.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/aleph/nucleo/escena.ts apps/web/app/components/aleph/nucleo/estados.ts apps/web/test/aleph-escena.test.ts
git commit -m "feat(web): el modelo de la escena de Aleph

modeloDeEscena convierte la vista pública en datos: asientos con su estado,
chip, bolsillo e insignia, sillas vacías del lobby, finalistas, mesa, carta de
etapa, friso y columnas. El bolsillo (payouts ?? pocket) se calcula en un solo
lugar, y el chip ya no recalcula el estado por segunda vez.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `gruposDeVotos` — quién votó a quién, y los ausentes

**Files:**

- Modify: `apps/web/app/components/aleph/nucleo/escena.ts` (agregar al final)
- Test: `apps/web/test/aleph-escena.test.ts` (agregar)

**Interfaces:**

- Consumes: de la Task 2 — `igual` (vía `estados.ts`) y `ResultadoDeEtapa`.
- Produces (los consume `Liquidacion.tsx` en la Task 12 y la página en la Task 13):
  - `interface EventoDeRegistro { type: string; stage: number; address?: string; action?: { type: string; target?: string } }` — la forma mínima del registro firmado. `AlephLog["events"]` del agent-sdk encaja por estructura, así que la página se lo pasa tal cual y este módulo sigue sin importar el SDK.
  - `interface VotoDeEtapa { voter: string; target: string }`
  - `interface GrupoDeVotos { n: number; kind: EtapaKind; votos: VotoDeEtapa[]; ausentes: string[] }`
  - `gruposDeVotos(eventos: EventoDeRegistro[], etapas: ResultadoDeEtapa[]): GrupoDeVotos[]`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `apps/web/test/aleph-escena.test.ts`. Antes, los dos imports de `escena.js` y el de tipos de `estados.js` quedan así (`EventoDeRegistro` y `ResultadoDeEtapa` son TIPOS y van con `import type`: `isolatedModules` está prendido y un tipo importado como valor rompe la compilación):

```ts
import {
  bolsilloDe,
  gruposDeVotos,
  modeloDeEscena,
} from "../app/components/aleph/nucleo/escena.js";
import type { EventoDeRegistro } from "../app/components/aleph/nucleo/escena.js";
import type {
  AsientoDeSala,
  EstadoDeAsiento,
  ResultadoDeEtapa,
  SalaDeAleph,
} from "../app/components/aleph/nucleo/estados.js";
```

Y el test:

```ts
test("los grupos de votos: una línea por voto firmado y los ausentes aparte", () => {
  const [a, b, c] = direcciones(3, 41);
  const etapas: ResultadoDeEtapa[] = [
    { index: 0, kind: "share" },
    { index: 1, kind: "vote", votes: { [a]: 0, [b]: 2, [c]: 1 }, eliminated: b },
  ];
  const eventos: EventoDeRegistro[] = [
    { type: "action", stage: 1, address: a, action: { type: "vote", target: b } },
    { type: "action", stage: 1, address: c, action: { type: "say" } },
    { type: "action", stage: 1, address: c, action: { type: "vote", target: b } },
    { type: "phase_end", stage: 1 },
    { type: "action", stage: 0, address: a, action: { type: "keep" } },
  ];
  const grupos = gruposDeVotos(eventos, etapas);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].n, 2);
  assert.deepEqual(grupos[0].votos, [
    { voter: a, target: b },
    { voter: c, target: b },
  ]);
  // B no votó: el motor lo cuenta en contra de sí mismo y eso no deja evento.
  assert.deepEqual(grupos[0].ausentes, [b]);

  // Una sala sin etapa de Voto no arma ningún grupo.
  assert.deepEqual(gruposDeVotos(eventos, [{ index: 0, kind: "share" }]), []);
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `node --import tsx --test apps/web/test/aleph-escena.test.ts`
Expected: FAIL, 1 de 14, con `TypeError: (0 , import_escena.gruposDeVotos) is not a function`. No es un `SyntaxError` de módulo: el repo no declara `"type": "module"`, así que `tsx` transpila a CJS y un export que todavía no existe **no rompe la carga del archivo** — los otros 13 tests siguen pasando.

- [ ] **Step 3: Escribir la implementación mínima**

Agregar al final de `apps/web/app/components/aleph/nucleo/escena.ts`:

```ts
// --- La liquidación: quién votó a quién ------------------------------------

/** Un evento del registro firmado, en la forma mínima que esta función lee.
 *  `AlephLog["events"]` encaja por estructura, así que la página se lo pasa
 *  tal cual y este módulo sigue sin importar el SDK. */
export interface EventoDeRegistro {
  type: string;
  stage: number;
  address?: string;
  action?: { type: string; target?: string };
}

export interface VotoDeEtapa {
  voter: string;
  target: string;
}

export interface GrupoDeVotos {
  n: number;
  kind: EtapaKind;
  votos: VotoDeEtapa[];
  /** Los que no votaron: el motor los cuenta en contra de sí mismos y eso no
   *  deja evento firmado. Sin esta línea, una etapa con dos ausentes muestra
   *  menos votos de los que el relato de abajo ya cuenta. */
  ausentes: string[];
}

/** Agrupa los votos del registro por etapa. `etapas` viene de `results`, que es
 *  lo único que sabe el `kind` de cada índice (`AlephEvent` solo trae el
 *  número), y `votes` de esa misma etapa lista a TODOS los que estaban vivos,
 *  que es de donde salen los ausentes. */
export function gruposDeVotos(
  eventos: EventoDeRegistro[],
  etapas: ResultadoDeEtapa[],
): GrupoDeVotos[] {
  return etapas
    .filter((e) => e.kind === "vote")
    .map((e) => {
      const votos = eventos
        .filter((ev) => ev.type === "action" && ev.action?.type === "vote" && ev.stage === e.index)
        .map((ev) => ({ voter: ev.address ?? "", target: ev.action?.target ?? "" }));
      const vivos = Object.keys(e.votes ?? {});
      return {
        n: e.index + 1,
        kind: e.kind,
        votos,
        ausentes: vivos.filter((a) => !votos.some((v) => igual(v.voter, a))),
      };
    });
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `node --import tsx --test apps/web/test/aleph-escena.test.ts`
Expected: PASS, 14 tests. Y la compuerta: `npm run typecheck:web && npm run lint && npm run format:check`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/aleph/nucleo/escena.ts apps/web/test/aleph-escena.test.ts
git commit -m "feat(web): los grupos de votos del registro firmado de Aleph

Una línea por voto firmado, agrupadas por etapa, y aparte los que no votaron:
esos el motor los cuenta en contra de sí mismos al resolver la etapa, y eso no
deja evento. Sin la línea, la ventana mostraría menos votos que el relato de
texto que está justo abajo.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `movimiento.ts` — la preferencia de movimiento

**Files:**

- Create: `apps/web/app/components/aleph/nucleo/movimiento.ts`
- Test: `apps/web/test/aleph-escena.test.ts` (agregar)

**Interfaces:**

- Consumes: nada.
- Produces (los consume `Escena.tsx` en la Task 11):
  - `leerPreferencia(): boolean` — `true` = con movimiento; cualquier problema cae del lado del default.
  - `guardarPreferencia(conMovimiento: boolean): void`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `apps/web/test/aleph-escena.test.ts` (y sumar el import `import { guardarPreferencia, leerPreferencia } from "../app/components/aleph/nucleo/movimiento.js";`):

```ts
test("la preferencia de movimiento sobrevive a un storage roto", () => {
  const previo = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const poner = (valor: unknown) =>
    Object.defineProperty(globalThis, "localStorage", { value: valor, configurable: true });
  const restaurar = () => {
    if (previo) Object.defineProperty(globalThis, "localStorage", previo);
    else Reflect.deleteProperty(globalThis, "localStorage");
  };

  try {
    // Sin storage: el default es CON movimiento, y guardar no tira.
    poner(undefined);
    assert.equal(leerPreferencia(), true);
    guardarPreferencia(false);

    // Storage que tira en los dos accesos (ventana privada, cookies
    // bloqueadas): ni leer ni guardar pueden llevarse puesta la página.
    poner({
      getItem() {
        throw new Error("bloqueado");
      },
      setItem() {
        throw new Error("bloqueado");
      },
    });
    assert.equal(leerPreferencia(), true);
    guardarPreferencia(false);

    // Storage sano: "off" apaga, "on" y cualquier otra cosa prenden.
    const datos: Record<string, string> = {};
    poner({
      getItem: (k: string) => (k in datos ? datos[k] : null),
      setItem: (k: string, v: string) => {
        datos[k] = v;
      },
    });
    assert.equal(leerPreferencia(), true);
    guardarPreferencia(false);
    assert.equal(datos["aleph.movimiento"], "off");
    assert.equal(leerPreferencia(), false);
    guardarPreferencia(true);
    assert.equal(datos["aleph.movimiento"], "on");
    assert.equal(leerPreferencia(), true);
  } finally {
    restaurar();
  }
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `node --import tsx --test apps/web/test/aleph-escena.test.ts`
Expected: FAIL, 1 de 1, con `Error: Cannot find module '../app/components/aleph/nucleo/movimiento.js'` — el módulo todavía no existe y el archivo entero no carga.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `apps/web/app/components/aleph/nucleo/movimiento.ts`:

```ts
// EL BOTÓN DE PAUSAR EL MOVIMIENTO. Una sala dura 40 minutos y el media query
// de `prefers-reduced-motion` no cubre al que simplemente se cansa.
//
// Todo acceso a `localStorage` va adentro de un try/catch: en una ventana
// privada, con las cookies bloqueadas o durante una captura, el acceso TIRA
// —no devuelve `null`—. Si no se puede leer, el default es CON movimiento.

const CLAVE = "aleph.movimiento";

/** `true` = con movimiento. Cualquier problema cae del lado del default. */
export function leerPreferencia(): boolean {
  try {
    return globalThis.localStorage?.getItem(CLAVE) !== "off";
  } catch {
    return true;
  }
}

export function guardarPreferencia(conMovimiento: boolean): void {
  try {
    globalThis.localStorage?.setItem(CLAVE, conMovimiento ? "on" : "off");
  } catch {
    // Sin storage la preferencia dura lo que dure la pestaña. No es un error
    // que haya que contarle a nadie.
  }
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `node --import tsx --test apps/web/test/aleph-escena.test.ts`
Expected: PASS, 15 tests. Y la compuerta: `npm run typecheck:web && npm run lint && npm run format:check`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/aleph/nucleo/movimiento.ts apps/web/test/aleph-escena.test.ts
git commit -m "feat(web): la preferencia de movimiento de Aleph, con el storage a prueba de todo

Leer y escribir localStorage adentro de try/catch: en una ventana privada el
acceso TIRA, no devuelve null. Sin storage, el default es con movimiento.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: las 31 claves de i18n, en los cuatro idiomas

**Files:**

- Modify: `apps/web/app/lib/i18n/es.ts:641` (después de `aleph.chat.stageSep`), `apps/web/app/lib/i18n/en.ts:633`, `apps/web/app/lib/i18n/fr.ts:647`, `apps/web/app/lib/i18n/hi.ts:631`
- Test: `apps/web/test/i18n.test.ts` (agregar un test)

**Interfaces:**

- Consumes: nada.
- Produces: las 31 claves que usan las Tasks 8 a 13 y 15. Escena (11): `aleph.scene.title`, `.invariant`, `.deck`, `.deckLeft`, `.deckNote`, `.emptySeat`, `.settledTitle`, `.settledNoFinal`, `.settledSplit`, `.pause`, `.resume`. Reglas (5): `aleph.rule.{share,offer,vote,lock,final}`. Friso (6): `aleph.frieze.{title,played,current,back,left,bonus}`. Liquidación (5): `aleph.votes.{title,line,implied,empty,unavailable}`. Probador (4): `aleph.probe.{title,label,bad,intro}`.
  Las otras dos de la lista de "Escena (13)" del spec —`aleph.scene.acted` y `aleph.scene.ready`— ya entraron con PR1: 13 − 2 + 5 + 6 + 5 + 4 = **31**.

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `apps/web/test/i18n.test.ts`:

```ts
test("las 31 claves de la etapa 5 (PR2) están en los 4 idiomas", () => {
  const nuevas = [
    // Escena (11; `acted` y `ready` ya entraron con PR1)
    "aleph.scene.title",
    "aleph.scene.invariant",
    "aleph.scene.deck",
    "aleph.scene.deckLeft",
    "aleph.scene.deckNote",
    "aleph.scene.emptySeat",
    "aleph.scene.settledTitle",
    "aleph.scene.settledNoFinal",
    "aleph.scene.settledSplit",
    "aleph.scene.pause",
    "aleph.scene.resume",
    // La regla de cada etapa (5)
    "aleph.rule.share",
    "aleph.rule.offer",
    "aleph.rule.vote",
    "aleph.rule.lock",
    "aleph.rule.final",
    // Friso (6)
    "aleph.frieze.title",
    "aleph.frieze.played",
    "aleph.frieze.current",
    "aleph.frieze.back",
    "aleph.frieze.left",
    "aleph.frieze.bonus",
    // Liquidación (5)
    "aleph.votes.title",
    "aleph.votes.line",
    "aleph.votes.implied",
    "aleph.votes.empty",
    "aleph.votes.unavailable",
    // Probador (4)
    "aleph.probe.title",
    "aleph.probe.label",
    "aleph.probe.bad",
    "aleph.probe.intro",
  ];
  assert.equal(nuevas.length, 31);
  for (const [lang, dict] of Object.entries(DICTS))
    for (const k of nuevas) {
      assert.ok(dict[k], `${lang} no tiene ${k}`);
      assert.ok(dict[k].trim().length > 0, `${lang} tiene ${k} vacía`);
    }

  // Las que llevan variable tienen que llevarla en los 4 idiomas: si una
  // traducción se come el {each}, el número desaparece sin que nadie se entere.
  const conVariables: Record<string, string[]> = {
    "aleph.scene.invariant": ["{pot}", "{box}", "{pockets}", "{total}"],
    "aleph.scene.deckLeft": ["{n}"],
    "aleph.scene.settledSplit": ["{each}"],
    "aleph.frieze.played": ["{n}", "{kind}"],
    "aleph.frieze.current": ["{n}", "{kind}"],
    "aleph.votes.line": ["{voter}", "{target}"],
    "aleph.votes.implied": ["{who}"],
  };
  for (const [lang, dict] of Object.entries(DICTS))
    for (const [k, vars] of Object.entries(conVariables))
      for (const v of vars) assert.ok(dict[k].includes(v), `${lang}: ${k} perdió ${v}`);
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `node --import tsx --test apps/web/test/i18n.test.ts`
Expected: FAIL con `AssertionError [ERR_ASSERTION]: en no tiene aleph.scene.title`.

- [ ] **Step 3: Escribir la implementación mínima**

En cada diccionario, insertar el bloque de su idioma **justo después** de la línea `"aleph.chat.stageSep": …` y antes de `"aleph.card.title"`. Los bloques ya vienen con el corte de línea que hace prettier con `printWidth: 100`: pegados tal cual, `format:check` pasa sin un `--write`.

`apps/web/app/lib/i18n/es.ts`, después de la línea 641:

<!-- prettier-ignore -->
```ts
  "aleph.scene.title": "ESCENA.EXE",
  "aleph.scene.invariant": "Pozo {pot} + caja {box} + bolsillos {pockets} = {total}",
  "aleph.scene.deck": "Mazo",
  "aleph.scene.deckLeft": "{n} sin dar",
  "aleph.scene.deckNote": "El orden del mazo es secreto, y la Final no sale de ahí.",
  "aleph.scene.emptySeat": "Silla vacía",
  "aleph.scene.settledTitle": "La sala liquidó.",
  "aleph.scene.settledNoFinal": "La sala terminó antes de la Final.",
  "aleph.scene.settledSplit":
    "La caja se repartió entre los asientos: {each} para cada uno (el sobrante, al bolsillo más grande).",
  "aleph.scene.pause": "PAUSAR MOVIMIENTO",
  "aleph.scene.resume": "REANUDAR MOVIMIENTO",
  "aleph.rule.share":
    "Cada uno elige guardarse su parte del pozo o dejarla. Si la dejan, la caja premia al pozo.",
  "aleph.rule.offer":
    "El demonio paga por irse. El que acepta cobra y deja la mesa; si aceptan todos, la oferta se anula y el pozo pierde un 10 %, que se lleva la caja.",
  "aleph.rule.vote":
    "El más votado deja la mesa con su bolsillo. Quién votó a quién no se muestra hasta que la sala liquide.",
  "aleph.rule.lock":
    "Cada uno tiene un pedazo del código. Abrirla para todos premia al pozo; abrirla para uno solo lo señala como traidor; si no la abre nadie, el pozo pierde un 10 %.",
  "aleph.rule.final":
    "Los dos últimos eligen en secreto dividir o robar. Si roban los dos, el pozo se quema.",
  "aleph.frieze.title": "Etapas de la sala",
  "aleph.frieze.played": "Etapa {n}: {kind}",
  "aleph.frieze.current": "Etapa {n}: {kind}, en curso",
  "aleph.frieze.back": "Carta sin dar",
  "aleph.frieze.left": "Alguien dejó la mesa",
  "aleph.frieze.bonus": "La caja premió al pozo",
  "aleph.votes.title": "QUIEN_VOTO_A_QUIEN.TXT",
  "aleph.votes.line": "{voter} votó a {target}.",
  "aleph.votes.implied": "Los que no votaron cuentan como voto contra sí mismos: {who}",
  "aleph.votes.empty": "No hubo ninguna etapa de Voto en esta sala.",
  "aleph.votes.unavailable": "El registro firmado no respondió. Está igual en el enlace de abajo.",
  "aleph.probe.title": "CRIATURA.EXE",
  "aleph.probe.label": "Pegá una dirección",
  "aleph.probe.bad": "Eso no es una dirección de 0x y 40 caracteres.",
  "aleph.probe.intro":
    "La criatura sale de la dirección y no cambia nunca. Esta página no está enlazada desde ningún lado: sirve para mirar criaturas contra direcciones reales.",
```

`apps/web/app/lib/i18n/en.ts`, después de la línea 633:

<!-- prettier-ignore -->
```ts
  "aleph.scene.title": "SCENE.EXE",
  "aleph.scene.invariant": "Pot {pot} + box {box} + pockets {pockets} = {total}",
  "aleph.scene.deck": "Deck",
  "aleph.scene.deckLeft": "{n} undealt",
  "aleph.scene.deckNote": "The deck order is secret, and the Final does not come out of it.",
  "aleph.scene.emptySeat": "Empty seat",
  "aleph.scene.settledTitle": "The room settled.",
  "aleph.scene.settledNoFinal": "The room ended before the Final.",
  "aleph.scene.settledSplit":
    "The box was split among the seats: {each} for each one (the remainder goes to the biggest pocket).",
  "aleph.scene.pause": "PAUSE MOTION",
  "aleph.scene.resume": "RESUME MOTION",
  "aleph.rule.share":
    "Each one chooses to keep their share of the pot or leave it. If they leave it, the box rewards the pot.",
  "aleph.rule.offer":
    "The demon pays you to leave. Whoever accepts cashes out and leaves the table; if everyone accepts, the offer is void and the pot loses 10%, which the box takes.",
  "aleph.rule.vote":
    "The most voted leaves the table with their pocket. Who voted for whom is not shown until the room settles.",
  "aleph.rule.lock":
    "Each one holds a piece of the code. Opening it for everyone rewards the pot; opening it for yourself alone marks you as a traitor; if nobody opens it, the pot loses 10%.",
  "aleph.rule.final":
    "The last two secretly choose to split or steal. If both steal, the pot burns.",
  "aleph.frieze.title": "Stages of the room",
  "aleph.frieze.played": "Stage {n}: {kind}",
  "aleph.frieze.current": "Stage {n}: {kind}, in progress",
  "aleph.frieze.back": "Undealt card",
  "aleph.frieze.left": "Someone left the table",
  "aleph.frieze.bonus": "The box rewarded the pot",
  "aleph.votes.title": "WHO_VOTED_FOR_WHOM.TXT",
  "aleph.votes.line": "{voter} voted for {target}.",
  "aleph.votes.implied": "Those who did not vote count as a vote against themselves: {who}",
  "aleph.votes.empty": "There was no Vote stage in this room.",
  "aleph.votes.unavailable": "The signed log did not answer. It is the same in the link below.",
  "aleph.probe.title": "CREATURE.EXE",
  "aleph.probe.label": "Paste an address",
  "aleph.probe.bad": "That is not a 0x address with 40 characters.",
  "aleph.probe.intro":
    "The creature comes out of the address and never changes. This page is not linked from anywhere: it is for looking at creatures against real addresses.",
```

`apps/web/app/lib/i18n/fr.ts`, después de la línea 647:

<!-- prettier-ignore -->
```ts
  "aleph.scene.title": "SCENE.EXE",
  "aleph.scene.invariant": "Pot {pot} + caisse {box} + poches {pockets} = {total}",
  "aleph.scene.deck": "Pioche",
  "aleph.scene.deckLeft": "{n} non distribuées",
  "aleph.scene.deckNote": "L'ordre de la pioche est secret, et la Finale n'en sort pas.",
  "aleph.scene.emptySeat": "Place vide",
  "aleph.scene.settledTitle": "La salle a liquidé.",
  "aleph.scene.settledNoFinal": "La salle s'est terminée avant la Finale.",
  "aleph.scene.settledSplit":
    "La caisse a été partagée entre les places : {each} pour chacune (le reste va à la poche la plus grosse).",
  "aleph.scene.pause": "METTRE EN PAUSE",
  "aleph.scene.resume": "REPRENDRE LE MOUVEMENT",
  "aleph.rule.share":
    "Chacun choisit de garder sa part du pot ou de la laisser. S'ils la laissent, la caisse récompense le pot.",
  "aleph.rule.offer":
    "Le démon paie pour que vous partiez. Celui qui accepte encaisse et quitte la table ; si tous acceptent, l'offre est annulée et le pot perd 10 %, que la caisse emporte.",
  "aleph.rule.vote":
    "Le plus voté quitte la table avec sa poche. Qui a voté pour qui n'est pas montré avant la liquidation de la salle.",
  "aleph.rule.lock":
    "Chacun détient un morceau du code. L'ouvrir pour tous récompense le pot ; l'ouvrir pour soi seul vous désigne comme traître ; si personne ne l'ouvre, le pot perd 10 %.",
  "aleph.rule.final":
    "Les deux derniers choisissent en secret partager ou voler. Si les deux volent, le pot brûle.",
  "aleph.frieze.title": "Étapes de la salle",
  "aleph.frieze.played": "Étape {n} : {kind}",
  "aleph.frieze.current": "Étape {n} : {kind}, en cours",
  "aleph.frieze.back": "Carte non distribuée",
  "aleph.frieze.left": "Quelqu'un a quitté la table",
  "aleph.frieze.bonus": "La caisse a récompensé le pot",
  "aleph.votes.title": "QUI_A_VOTE_POUR_QUI.TXT",
  "aleph.votes.line": "{voter} a voté pour {target}.",
  "aleph.votes.implied": "Ceux qui n'ont pas voté comptent comme un vote contre eux-mêmes : {who}",
  "aleph.votes.empty": "Il n'y a eu aucune étape de Vote dans cette salle.",
  "aleph.votes.unavailable":
    "Le journal signé n'a pas répondu. Il est identique dans le lien ci-dessous.",
  "aleph.probe.title": "CREATURE.EXE",
  "aleph.probe.label": "Collez une adresse",
  "aleph.probe.bad": "Ce n'est pas une adresse en 0x de 40 caractères.",
  "aleph.probe.intro":
    "La créature sort de l'adresse et ne change jamais. Cette page n'est liée depuis nulle part : elle sert à regarder des créatures avec de vraies adresses.",
```

`apps/web/app/lib/i18n/hi.ts`, después de la línea 631 (devanagari de verdad, sin una sola secuencia backslash-u):

<!-- prettier-ignore -->
```ts
  "aleph.scene.title": "दृश्य.EXE",
  "aleph.scene.invariant": "पॉट {pot} + तिजोरी {box} + जेबें {pockets} = {total}",
  "aleph.scene.deck": "गड्डी",
  "aleph.scene.deckLeft": "{n} बिना बाँटे",
  "aleph.scene.deckNote": "गड्डी का क्रम गुप्त है, और फ़ाइनल उसमें से नहीं आता।",
  "aleph.scene.emptySeat": "ख़ाली सीट",
  "aleph.scene.settledTitle": "कमरा निपट गया।",
  "aleph.scene.settledNoFinal": "कमरा फ़ाइनल से पहले ख़त्म हो गया।",
  "aleph.scene.settledSplit":
    "तिजोरी सीटों में बँटी: हर एक को {each} (बचा हुआ सबसे बड़ी जेब में जाता है)।",
  "aleph.scene.pause": "हलचल रोकें",
  "aleph.scene.resume": "हलचल फिर चालू करें",
  "aleph.rule.share":
    "हर कोई चुनता है कि पॉट में से अपना हिस्सा रखे या छोड़ दे। छोड़ने पर तिजोरी पॉट को इनाम देती है।",
  "aleph.rule.offer":
    "दानव जाने के लिए पैसे देता है। जो स्वीकार करता है वह रक़म लेकर मेज़ छोड़ देता है; अगर सब स्वीकार कर लें तो पेशकश रद्द हो जाती है और पॉट 10% खो देता है, जो तिजोरी ले जाती है।",
  "aleph.rule.vote":
    "सबसे ज़्यादा वोट पाने वाला अपनी जेब लेकर मेज़ छोड़ देता है। किसने किसे वोट दिया, यह कमरे के निपटने तक नहीं दिखता।",
  "aleph.rule.lock":
    "हर किसी के पास कोड का एक टुकड़ा है। सबके लिए ताला खोलना पॉट को इनाम देता है; सिर्फ़ अपने लिए खोलना उसे ग़द्दार बताता है; कोई न खोले तो पॉट 10% खो देता है।",
  "aleph.rule.final":
    "आख़िरी दो गुप्त रूप से बाँटना या चुराना चुनते हैं। दोनों चुराएँ तो पॉट जल जाता है।",
  "aleph.frieze.title": "कमरे के चरण",
  "aleph.frieze.played": "चरण {n}: {kind}",
  "aleph.frieze.current": "चरण {n}: {kind}, चल रहा है",
  "aleph.frieze.back": "बिना बाँटा पत्ता",
  "aleph.frieze.left": "कोई मेज़ छोड़ गया",
  "aleph.frieze.bonus": "तिजोरी ने पॉट को इनाम दिया",
  "aleph.votes.title": "किसने_किसे_वोट_दिया.TXT",
  "aleph.votes.line": "{voter} ने {target} को वोट दिया।",
  "aleph.votes.implied": "जिन्होंने वोट नहीं दिया, वह अपने ही ख़िलाफ़ वोट गिना जाता है: {who}",
  "aleph.votes.empty": "इस कमरे में वोट का कोई चरण नहीं हुआ।",
  "aleph.votes.unavailable":
    "हस्ताक्षरित रिकॉर्ड ने जवाब नहीं दिया। वह नीचे के लिंक में वैसा ही है।",
  "aleph.probe.title": "क्रीचर.EXE",
  "aleph.probe.label": "कोई पता चिपकाएँ",
  "aleph.probe.bad": "यह 0x और 40 अक्षरों वाला पता नहीं है।",
  "aleph.probe.intro":
    "क्रीचर पते से बनता है और कभी नहीं बदलता। यह पन्ना कहीं से लिंक नहीं है: यह असली पतों के साथ क्रीचर देखने के लिए है।",
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `node --import tsx --test apps/web/test/i18n.test.ts`
Expected: PASS, 6 tests (los 5 que ya estaban más este). El de paridad tiene que seguir en verde: los 4 idiomas pasan de 539 a **570** claves cada uno (las 4 huérfanas se borran recién en la Task 13, que es la que saca sus bloques de la página).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/lib/i18n/es.ts apps/web/app/lib/i18n/en.ts apps/web/app/lib/i18n/fr.ts apps/web/app/lib/i18n/hi.ts apps/web/test/i18n.test.ts
git commit -m "feat(web): las 31 claves de la escena de Aleph, en los cuatro idiomas

Escena, la regla de cada etapa en una línea, el friso, la ventana de votos y el
probador. Con su test de presencia y de variables: si una traducción se come el
{each}, el número desaparecía sin que nadie se enterara.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: el CSS de la escena

**Files:**

- Modify: `apps/web/app/globals.css`, en **dos** lugares y ninguno más: el bloque nuevo entero se inserta en la **línea 499**, justo después del cierre de `.charla-nota` (`:496-498`) y **antes** del comentario de tres renglones que introduce el `@media (prefers-reduced-motion: reduce)` (`:500-502`); y las tres clases nuevas se suman **adentro** de ese media query, justo después de `.aleph-respira { animation: none; }` (`:514-516` en `main`) y antes del comentario de `.rise-fade` (`:517` en `main`). **Los dos números son los del archivo en `main`**: el Step 1 mete 266 líneas en la 499, así que cuando llega el Step 2 ese punto ya está en la `:783`. El anclaje que manda es el texto, no el número. Los dos caen adentro del `@layer components` que abre en `:157` y cierra en `:570`, así que la indentación del bloque es de dos espacios y la de las reglas del media query, de cuatro.

**Interfaces:**

- Consumes: los tokens que ya existen (`--color-surface-2`, `--color-border`, `--color-ink`, `--color-gold`, `--color-accent`, `--color-accent-2`, `--color-lose`, `--color-muted-bright`, `--color-text-strong`) y `.criatura--mesa` / `.criatura--charla`, que PR1 dejó en `:419-426`.
- Produces (las usan las Tasks 7 a 12): `.escena`, `.carta-etapa`, `.friso`, `.friso-carta`, `.friso-carta--actual`, `.friso-carta--dorso`, `.friso-salida`, `.friso-premio`, `.mesa`, `.mesa-objeto`, `.objeto`, `.objeto--apagado`, `.dorso`, `.glifo`, `.barra`, `.barra-pozo`, `.barra-caja`, `.barra-bolsillos`, `.barra-marca`, `.escena-asientos`, `.escena-final`, `.escena-pozo`, `.asiento`, `.asiento--abandono`, `.asiento--vacia`, `.etiqueta-ancha`, `.etiqueta-angosta`, `.criatura--final`, `.criatura--probador`, `.aleph-grieta`, `.aleph-revela`, `.aleph-desclasifica` y `body.sin-movimiento`.

**Nota sobre el test:** el CSS no lleva test (el repo no tiene harness de DOM ni de estilos). Su compuerta es `npm run lint`, `npm run format:check`, `npm run build --workspace apps/web` y la verificación visual de la Task 14, que mira a 375 px y en desktop.

- [ ] **Step 1: El bloque de la escena**

Insertar en la **línea 499** de `apps/web/app/globals.css`:

<!-- prettier-ignore -->
```css

  /* --- Aleph, etapa 5: la escena --- */

  /* Un solo corte, y es del CONTENEDOR, no de la pantalla: la escena vive en
     una columna de 672 px que a 375 px mide unos 319. Todo lo que cambia de
     forma cuelga de este @container. */
  .escena {
    container-type: inline-size;
  }

  /* La carta de etapa: lo único en toda la pantalla que explica el juego. */
  .carta-etapa {
    border-left: 2px solid var(--color-accent-2);
    padding-left: 10px;
  }

  /* El friso: una carta de 14x20 por etapa. Con ocho asientos la sala llega a
     unas 12 etapas, que a 375 px entran en una fila (12 x 18 = 216 px sobre
     319 disponibles). Más de eso, envuelve. */
  .friso {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 4px;
  }
  .friso-carta {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 20px;
    border: 1px solid var(--color-border);
    border-radius: 2px;
    background: var(--color-surface-2);
  }
  .friso-carta--actual {
    height: 22px;
    border-color: var(--color-accent);
  }
  .friso-carta--dorso {
    opacity: 0.45;
  }
  /* Las dos marcas de la esquina. Un punto de 3 px y no una cruz: a 14 px de
     ancho una cruz es puré antialiaseado. Lo que dice qué son es su
     aria-label, no el color. */
  .friso-salida,
  .friso-premio {
    position: absolute;
    width: 3px;
    height: 3px;
    border-radius: 1px;
  }
  .friso-salida {
    top: 1px;
    right: 1px;
    background: var(--color-lose);
  }
  .friso-premio {
    right: 1px;
    bottom: 1px;
    background: var(--color-gold);
  }

  /* Los objetos: múltiplos exactos de su grilla, que es lo que hace que
     `crispEdges` siga sirviendo (olla/cofre/mazo 16x16 a 32 px, el dorso 8x6 a
     16x12 y los glifos 8x8 a 8 px). */
  .objeto {
    width: 32px;
    height: 32px;
  }
  .objeto--apagado {
    opacity: 0.45;
  }
  .dorso {
    width: 16px;
    height: 12px;
  }
  .glifo {
    width: 8px;
    height: 8px;
  }
  .friso-carta .dorso {
    width: 8px;
    height: 6px;
  }

  /* La mesa: los tres objetos y la barra del invariante. */
  .mesa {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
  }
  .mesa-objeto {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .barra {
    position: relative;
    display: flex;
    height: 8px;
    border-radius: 4px;
    background: var(--color-ink);
    overflow: hidden;
  }
  .barra-pozo {
    background: var(--color-gold);
  }
  .barra-caja {
    background: var(--color-accent);
  }
  .barra-bolsillos {
    background: var(--color-muted-bright);
  }
  /* De dónde arrancó el pozo: 1 - BOX_BPS/10000. `overflow: hidden` la recorta
     a la altura de la barra, así que va adentro y no sobresale. */
  .barra-marca {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--color-text-strong);
  }

  /* La grilla de asientos. Los dos números los publica Asientos.tsx como
     custom properties: un elemento no puede alternar dos valores de JS en una
     media query, y Tailwind v4 escanea literales, así que `grid-cols-${n}` no
     genera nada. */
  .escena-asientos {
    display: grid;
    grid-template-columns: repeat(var(--cols-angosta), minmax(0, 1fr));
    gap: 8px;
  }
  /* La Final: los dos finalistas enfrentados con el pozo en el medio. Es el
     único momento en que la escena cambia de forma. */
  .escena-final {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 8px;
  }
  .escena-pozo {
    display: flex;
    justify-content: center;
  }

  /* La tarjeta de asiento es ANGOSTA por defecto (mobile primero): criatura a
     la izquierda, etiqueta a la derecha, dos columnas. */
  .asiento {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 8px;
    border-radius: 8px;
    background: var(--color-surface-2);
  }
  .asiento--abandono {
    border: 1px dashed var(--color-border);
  }
  .asiento--vacia {
    justify-content: center;
    background: transparent;
    border: 1px dashed var(--color-border);
  }
  .asiento--vacia .dorso {
    opacity: 0.25;
  }
  /* La etiqueta se monta en las DOS formas y el corte esconde una: playerLabel
     devuelve un string plano y no hay media query que parta un string. Este
     `display: none` es TAMBIÉN lo que la saca del árbol de accesibilidad, así
     que la copia escondida no se anuncia y no hace falta —ni serviría— un
     aria-hidden fijo en el marcado (desvío 15). */
  .etiqueta-ancha {
    display: none;
  }
  .criatura--final {
    width: 64px;
    height: 64px;
  }
  .criatura--probador {
    width: 128px;
    height: 128px;
  }

  @container (min-width: 560px) {
    .escena-asientos {
      grid-template-columns: repeat(var(--cols-ancha), minmax(0, 1fr));
    }
    /* Tarjeta vertical: criatura arriba, etiqueta abajo. */
    .asiento {
      flex-direction: column;
      text-align: center;
    }
    .criatura--mesa {
      width: 64px;
      height: 64px;
    }
    .criatura--final {
      width: 96px;
      height: 96px;
    }
    .etiqueta-ancha {
      display: block;
    }
    .etiqueta-angosta {
      display: none;
    }
  }

  /* Las tres animaciones que faltaban. Las tres van HACIA el estado de reposo:
     con `animation: none` no se pierde un solo dato. La grieta está en el
     marcado desde el primer cuadro y la animación solo la descubre. */
  .aleph-grieta {
    transform-box: fill-box;
    transform-origin: 50% 0%;
    animation: aleph-grieta 600ms steps(4, jump-none) 1;
  }
  @keyframes aleph-grieta {
    from {
      transform: scaleY(0);
    }
    to {
      transform: scaleY(1);
    }
  }
  .aleph-revela {
    animation: aleph-revela 500ms ease-out 1;
  }
  @keyframes aleph-revela {
    from {
      opacity: 0.4;
      transform: scale(0.94);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  /* Va en CADA línea de susurro, no en la ventana: el spec dice "las líneas de
     susurro entran", y la terminal ya estaba en pantalla antes de liquidar. Un
     fundido por elemento hace exactamente eso y no necesita un contenedor. */
  .aleph-desclasifica {
    animation: aleph-desclasifica 400ms ease-out 1;
  }
  @keyframes aleph-desclasifica {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  /* El botón de pausa: la misma lista que el media query de abajo. Una sala
     dura 40 minutos y `prefers-reduced-motion` no cubre al que se cansa. */
  body.sin-movimiento .aleph-respira,
  body.sin-movimiento .aleph-grieta,
  body.sin-movimiento .aleph-revela,
  body.sin-movimiento .aleph-desclasifica {
    animation: none;
  }
```

- [ ] **Step 2: La rama de `prefers-reduced-motion`**

Insertar adentro del `@media (prefers-reduced-motion: reduce)` que ya existe, justo después del `.aleph-respira { animation: none; }` de PR1 y antes del comentario de `.rise-fade` (en `main` es la línea 517; después del Step 1, que metió 266 líneas más arriba, queda en la 783 — **buscar por el texto, no por el número**):

<!-- prettier-ignore -->
```css
    .aleph-grieta,
    .aleph-revela,
    .aleph-desclasifica {
      animation: none;
    }
```

- [ ] **Step 3: Comprobar que formatea y construye**

Run: `npx prettier --write apps/web/app/globals.css && npm run lint && npm run format:check && npm run build --workspace apps/web`
Expected: PASS. La build tiene que compilar el CSS sin warnings nuevos.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat(web): el CSS de la escena de Aleph

Contenedor con un solo corte (@container 560px): la tarjeta de asiento angosta
por defecto y vertical adentro del corte, las columnas leídas de dos custom
properties, el friso, los objetos y la barra del invariante. Más las tres
animaciones que faltaban, con su rama de reduced-motion y la clase
sin-movimiento del botón.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `Objetos.tsx` — la olla, el cofre, el mazo, el dorso y los glifos

**Files:**

- Create: `apps/web/app/components/aleph/Objetos.tsx`

**Interfaces:**

- Consumes: `EtapaKind` de `./nucleo/estados`.
- Produces (los consumen las Tasks 8, 9 y 10):
  - `Olla(props: { clase?: string })`
  - `Cofre(props: { parte: number; clase?: string })` — `parte` es `box / total`; decide la tapa (< 25 % → 0, < 40 % → 1, si no 2)
  - `Mazo(props: { apagado?: boolean; clase?: string })`
  - `Dorso(props: { clase?: string })` — grilla de 8×6
  - `Glifo(props: { kind: EtapaKind; clase?: string })` — grilla de 8×8, nunca más de 4 rects

**Nota sobre el test:** los componentes no llevan test de render — el repo no tiene harness de DOM y el spec lo pide así ("Sin React, sin DOM, sin dependencias nuevas"). Su compuerta es `typecheck` + `lint` (la build con los componentes montados se corre en el Step 3 de la Task 12, cuando ya están montados los siete componentes, y de nuevo en el cierre de la Task 14) más la verificación visual de la Task 14. Los píxeles de este archivo se comprobaron al escribir el plan con un script que verifica que los 11 dibujos entren en su grilla y que ningún glifo pase de 4 rects.

- [ ] **Step 1: Escribir el componente**

Crear `apps/web/app/components/aleph/Objetos.tsx`:

```tsx
// LOS OBJETOS DE LA ESCENA: el pozo, la caja del demonio, el mazo, el dorso de
// ALEPH y los cinco glifos de etapa. Misma técnica que la criatura y que
// `Logo.tsx`: grilla de píxeles, un <rect> por píxel, `crispEdges` y cero bytes
// en `public/`.
//
// Todos van `aria-hidden="true"`: su información está en el texto de al lado.
// Y nada de texto adentro del SVG (Press Start 2P no tiene glifos devanagari).

import type { EtapaKind } from "./nucleo/estados";

/** [x, y, w, h, fill] sobre la grilla del objeto. */
type Pixel = [number, number, number, number, string];

const C = {
  oro: "var(--color-gold)",
  oroSombra: "#a97f1e",
  tinta: "var(--color-ink)",
  borde: "var(--color-border)",
  superficie: "var(--color-surface-2)",
  coral: "var(--color-accent)",
  cyan: "var(--color-accent-2)",
};

function Dibujo({
  pixeles,
  ancho,
  alto,
  clase,
}: {
  pixeles: readonly Pixel[];
  ancho: number;
  alto: number;
  clase: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${ancho} ${alto}`}
      shapeRendering="crispEdges"
      className={clase}
      aria-hidden="true"
    >
      {pixeles.map(([x, y, w, h, fill], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill={fill} />
      ))}
    </svg>
  );
}

/** El pozo: una olla dorada con asas. */
const OLLA: readonly Pixel[] = [
  [2, 5, 12, 2, C.oro], // boca
  [3, 7, 10, 5, C.oro], // cuerpo
  [4, 7, 8, 1, C.oroSombra], // sombra de adentro
  [1, 7, 2, 2, C.oroSombra], // asa izquierda
  [13, 7, 2, 2, C.oroSombra], // asa derecha
  [4, 12, 8, 1, C.tinta], // pie
];

export function Olla({ clase = "objeto" }: { clase?: string }) {
  return <Dibujo pixeles={OLLA} ancho={16} alto={16} clase={clase} />;
}

/** La caja del demonio: un cofre oscuro con lacre coral. La tapa tiene tres
 *  alturas según `box / total` (< 25 %, < 40 %, >= 40 %): es la única forma de
 *  que "engorde etapa a etapa" sin inventar un dato. */
const cofre = (tapa: number): Pixel[] => [
  [2, 7 - tapa * 2, 12, 2 + tapa * 2, C.borde],
  [2, 9, 12, 4, C.tinta],
  [7, 8, 2, 3, C.coral],
  [3, 13, 10, 1, C.borde],
];

export function Cofre({ parte, clase = "objeto" }: { parte: number; clase?: string }) {
  const tapa = parte < 0.25 ? 0 : parte < 0.4 ? 1 : 2;
  return <Dibujo pixeles={cofre(tapa)} ancho={16} alto={16} clase={clase} />;
}

/** El mazo: la carta de arriba con el pozo dorado del dorso, y dos abajo. */
const MAZO: readonly Pixel[] = [
  [2, 2, 12, 12, C.borde],
  [3, 3, 10, 10, C.superficie],
  [7, 7, 2, 2, C.oro],
  [3, 14, 10, 1, C.borde],
  [4, 15, 8, 1, C.borde],
];

export function Mazo({ apagado = false, clase = "objeto" }: { apagado?: boolean; clase?: string }) {
  return (
    <Dibujo
      pixeles={MAZO}
      ancho={16}
      alto={16}
      clase={apagado ? `${clase} objeto--apagado` : clase}
    />
  );
}

/** El dorso de ALEPH, de 8x6: el anillo de asientos y el pozo dorado al centro.
 *  Es el reverso único de todo lo que está dado vuelta — las cartas sin dar y
 *  las sillas que todavía no ocupó nadie. */
const DORSO: readonly Pixel[] = [
  [0, 0, 8, 1, C.borde],
  [0, 5, 8, 1, C.borde],
  [0, 1, 1, 4, C.borde],
  [7, 1, 1, 4, C.borde],
  [3, 2, 2, 2, C.oro],
];

export function Dorso({ clase = "dorso" }: { clase?: string }) {
  return <Dibujo pixeles={DORSO} ancho={8} alto={6} clase={clase} />;
}

/** Los cinco glifos de etapa, de 8x8 y nunca más de 4 rects: dos barras el
 *  Reparto, una moneda la Oferta, una ranura el Voto, un candado la Cerradura y
 *  dos flechas encontradas la Final. */
const GLIFOS: Readonly<Record<EtapaKind, readonly Pixel[]>> = {
  share: [
    [1, 2, 6, 1, C.cyan],
    [1, 5, 6, 1, C.cyan],
  ],
  offer: [
    [2, 1, 4, 1, C.oro],
    [1, 2, 6, 4, C.oro],
    [2, 6, 4, 1, C.oro],
  ],
  vote: [
    [1, 1, 6, 5, C.cyan],
    [2, 3, 4, 1, C.tinta],
  ],
  lock: [
    [2, 1, 4, 2, C.cyan],
    [1, 3, 6, 4, C.cyan],
    [3, 4, 2, 2, C.tinta],
  ],
  final: [
    [1, 3, 2, 2, C.coral],
    [3, 2, 1, 4, C.coral],
    [5, 2, 1, 4, C.coral],
    [6, 3, 2, 2, C.coral],
  ],
};

export function Glifo({ kind, clase = "glifo" }: { kind: EtapaKind; clase?: string }) {
  return <Dibujo pixeles={GLIFOS[kind]} ancho={8} alto={8} clase={clase} />;
}
```

- [ ] **Step 2: Comprobar que compila y pasa el lint**

Run: `npm run typecheck:web && npm run lint`
Expected: PASS, sin errores ni warnings nuevos.

- [ ] **Step 3: Formatear**

Run: `npx prettier --write apps/web/app/components/aleph/Objetos.tsx && npm run format:check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/aleph/Objetos.tsx
git commit -m "feat(web): los objetos de la escena de Aleph en pixel art

Olla, cofre de tres tapas (engorda con box/total), mazo, dorso de ALEPH de 8x6
y los cinco glifos de etapa, todos aria-hidden y sin una letra adentro del SVG.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `CartaEtapa.tsx` y `Friso.tsx`

**Files:**

- Create: `apps/web/app/lib/tiempo.ts`
- Create: `apps/web/app/components/aleph/CartaEtapa.tsx`
- Create: `apps/web/app/components/aleph/Friso.tsx`

**Interfaces:**

- Consumes: de la Task 2 — `CartaDeEscena`, `FrisoDeEscena`, `Traductor`. De la Task 7 — `Dorso`, `Glifo`. De la Task 5 — `aleph.rule.*`, `aleph.frieze.*`, `aleph.scene.settledTitle`; y las que ya existían: `aleph.room.stageHead`, `aleph.stage.*`, `aleph.phase.*`, `aleph.line.final*`, `aleph.scene.acted` / `.ready`.
- Produces:
  - `mmss(ms: number): string` en `apps/web/app/lib/tiempo.ts` — la misma función que hoy es privada de `page.tsx:39-42`, con `export`. La consumen `CartaEtapa.tsx`, `Escena.tsx` y la página (Task 13).
  - `CartaEtapa(props: { carta: CartaDeEscena; now: number; t: Traductor; etiquetaDePorDireccion: (address: string) => string })`
  - `Friso(props: { friso: FrisoDeEscena; t: Traductor })`

**Nota sobre el test:** ninguno de los dos componentes lleva test de render (no hay harness de DOM); lo que deciden ya está probado en `modeloDeEscena` (tests 13, 14, 15 y 16). `mmss` tampoco estrena test: es la misma función que la página viene usando desde antes de PR1, movida sin tocarle una línea. La compuerta es `typecheck` + `lint` (la build con los componentes montados se corre en el Step 3 de la Task 12, cuando ya están montados los siete componentes, y de nuevo en el cierre de la Task 14) más la verificación visual de la Task 14.

- [ ] **Step 1: Mudar `mmss` a `app/lib/tiempo.ts`**

Crear `apps/web/app/lib/tiempo.ts` (el cuerpo es idéntico al de `page.tsx:39-42`; la página lo empieza a importar en la Task 13, y hasta entonces convive con el suyo sin molestar):

```ts
// El reloj mm:ss del sitio. Vivía como función privada de módulo adentro de
// `apps/web/app/aleph/[roomId]/page.tsx`; la carta de etapa de la escena
// necesita el mismo formato, así que se muda acá con `export` en vez de
// quedar escrita dos veces.

/** Milisegundos que faltan, como `mm:ss`. Nunca negativo. */
export function mmss(ms: number): string {
  const left = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
}
```

- [ ] **Step 2: Escribir `CartaEtapa.tsx`**

Crear `apps/web/app/components/aleph/CartaEtapa.tsx`:

```tsx
// LA CARTA DE ETAPA: qué etapa es, qué regla rige, en qué fase estamos, cuánto
// falta y cuántos actuaron. Es lo único en toda la pantalla que le explica el
// juego a alguien que cayó en la etapa 6.
//
// NUNCA dice "etapa X de N": el total no existe. La Final no sale del mazo
// (entra cuando quedan dos vivos) y, si el mazo se vacía, el director sigue
// repartiendo Votos. `cardsLeft` dice cuántas cartas quedan SIN DAR, que es
// otra cosa, y eso lo cuenta el mazo de la mesa.

import { mmss } from "../../lib/tiempo";
import type { CartaDeEscena, Traductor } from "./nucleo/escena";

export function CartaEtapa({
  carta,
  now,
  t,
  etiquetaDePorDireccion,
}: {
  carta: CartaDeEscena;
  /** El mismo `useState` que mueve el reloj de la página: sin esta prop el
   *  mm:ss se dibujaría una vez y no se movería más. */
  now: number;
  t: Traductor;
  etiquetaDePorDireccion: (address: string) => string;
}) {
  return (
    <div className="carta-etapa mt-4">
      {carta.etapa && (
        <>
          <p className="font-pixel text-sm text-(--color-muted-bright)">
            {t("aleph.room.stageHead", {
              n: carta.etapa.n,
              kind: t(`aleph.stage.${carta.etapa.kind}`),
            })}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <span className="chip">{t(`aleph.phase.${carta.etapa.fase}`)}</span>
            {carta.etapa.hasta !== null && (
              // Crudo, sin clave de i18n: el contexto de al lado ya dice qué se
              // está contando, y el "(quedan {time})" de `aleph.room.deadline`
              // sobra adentro de la carta.
              <span className="font-mono text-sm text-(--color-gold)">
                {mmss(carta.etapa.hasta - now)}
              </span>
            )}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-(--color-muted)">
            {t(`aleph.rule.${carta.etapa.kind}`)}
          </p>
        </>
      )}
      {carta.contador && (
        <p className="mt-2 text-sm text-(--color-muted-3)">
          {t(carta.contador.clave, { k: carta.contador.k, n: carta.contador.n })}
        </p>
      )}
      {carta.cierre && (
        <>
          <p className="font-pixel text-sm text-(--color-muted-bright)">
            {t("aleph.scene.settledTitle")}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-(--color-muted)">
            {t(
              carta.cierre.clave,
              carta.cierre.quien ? { who: etiquetaDePorDireccion(carta.cierre.quien) } : undefined,
            )}
          </p>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Escribir `Friso.tsx`**

Crear `apps/web/app/components/aleph/Friso.tsx`:

```tsx
// EL FRISO: una carta chiquita por etapa jugada, la actual con borde coral y
// los dorsos de las que faltan. Es lo que contesta "cuántas se jugaron" sin
// leer el relato entero.

import { Dorso, Glifo } from "./Objetos";
import type { FrisoDeEscena, Traductor } from "./nucleo/escena";

export function Friso({ friso, t }: { friso: FrisoDeEscena; t: Traductor }) {
  return (
    <ol className="friso mt-4" aria-label={t("aleph.frieze.title")}>
      {friso.jugadas.map((j) => (
        <li
          key={`j${j.n}`}
          className="friso-carta"
          aria-label={t("aleph.frieze.played", { n: j.n, kind: t(`aleph.stage.${j.kind}`) })}
        >
          <Glifo kind={j.kind} />
          {/* Las dos marcas llevan su propio rótulo: un punto no dice nada solo.
              `role="img"` + `aria-label` es lo que las expone al lector. */}
          {j.salida && (
            <span className="friso-salida" role="img" aria-label={t("aleph.frieze.left")} />
          )}
          {j.premio && (
            <span className="friso-premio" role="img" aria-label={t("aleph.frieze.bonus")} />
          )}
        </li>
      ))}
      {friso.actual && (
        <li
          className="friso-carta friso-carta--actual"
          aria-label={t("aleph.frieze.current", {
            n: friso.actual.n,
            kind: t(`aleph.stage.${friso.actual.kind}`),
          })}
        >
          <Glifo kind={friso.actual.kind} />
        </li>
      )}
      {Array.from({ length: friso.dorsos }, (_, i) => (
        <li
          key={`d${i}`}
          className="friso-carta friso-carta--dorso"
          aria-label={t("aleph.frieze.back")}
        >
          <Dorso />
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Comprobar que compila, pasa el lint y formatea**

Run: `npm run typecheck:web && npm run lint && npx prettier --write apps/web/app/lib/tiempo.ts apps/web/app/components/aleph/CartaEtapa.tsx apps/web/app/components/aleph/Friso.tsx && npm run format:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/lib/tiempo.ts apps/web/app/components/aleph/CartaEtapa.tsx apps/web/app/components/aleph/Friso.tsx
git commit -m "feat(web): la carta de etapa y el friso de Aleph

La carta dice qué etapa es, en qué fase, cuánto falta, la regla en una línea y
cuántos actuaron; con la sala liquidada, la carta de cierre. El friso, una
carta chiquita por etapa con sus marcas de salida y premio. mmss se muda a
app/lib/tiempo.ts para que la carta y la página usen la misma.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `Mesa.tsx` — pozo, caja, mazo y el invariante

**Files:**

- Create: `apps/web/app/components/aleph/Mesa.tsx`

**Interfaces:**

- Consumes: de la Task 2 — `MesaDeEscena`, `Traductor`. De la Task 7 — `Olla`, `Cofre`, `Mazo`. De la Task 5 — `aleph.scene.deck`, `.deckLeft`, `.deckNote`, `.invariant`, `.settledSplit`; y las que ya existían, `aleph.room.pot` y `aleph.room.box`.
- Produces: `Mesa(props: { mesa: MesaDeEscena; t: Traductor })`.

**Nota sobre el test:** sin test de render (no hay harness de DOM). Los números que dibuja salen de `modeloDeEscena` y los miran los tests 13 y 14. La compuerta es `typecheck` + `lint` (la build con los componentes montados se corre en el Step 3 de la Task 12, cuando ya están montados los siete componentes, y de nuevo en el cierre de la Task 14) más la verificación visual de la Task 14.

- [ ] **Step 1: Escribir el componente**

Crear `apps/web/app/components/aleph/Mesa.tsx`:

```tsx
// LA MESA: pozo, caja y mazo como objetos, la barra del invariante y su línea.
// Reemplaza los tres bloques `Money` del encabezado — mismos datos, ahora
// dibujados, con las mismas claves de i18n.

import { Cofre, Mazo, Olla } from "./Objetos";
import type { MesaDeEscena, Traductor } from "./nucleo/escena";

/** De dónde arrancó el pozo sobre el total: `1 − ALEPH_RULES.BOX_BPS / 10000`
 *  con `BOX_BPS = 2000`. Va como constante local y NO se importa: el único
 *  subpath que exporta `ALEPH_RULES` es `@arcade1v1/game-sdk/aleph`, que
 *  arrastraría el motor entero de Aleph —`createAleph`, `replayAleph`,
 *  `viewFor`— al bundle de la web por un solo número. Y lo que NO sirve para
 *  ubicarla es `potInitial / total`: `potInitial` ES el total, así que ese
 *  cociente da 1,0 y la marca queda pegada al borde derecho. */
const ARRANQUE_DEL_POZO = 0.8;

export function Mesa({ mesa, t }: { mesa: MesaDeEscena; t: Traductor }) {
  const pct = (n: number) => (mesa.total > 0 ? (n / mesa.total) * 100 : 0);
  const parte = mesa.total > 0 ? mesa.caja / mesa.total : 0;
  return (
    <div className="mt-4">
      <div className="mesa">
        <div className="mesa-objeto">
          <Olla />
          <span>
            <span className="block text-sm text-(--color-muted-3)">{t("aleph.room.pot")}</span>
            <span className="font-pixel text-sm text-(--color-gold)">{mesa.pozo}</span>
          </span>
        </div>
        <div className="mesa-objeto">
          <Cofre parte={parte} clase={mesa.liquidada ? "objeto objeto--apagado" : "objeto"} />
          <span>
            <span className="block text-sm text-(--color-muted-3)">{t("aleph.room.box")}</span>
            <span className="font-pixel text-sm text-(--color-muted-bright)">{mesa.caja}</span>
          </span>
        </div>
        <div className="mesa-objeto">
          {/* Con la sala liquidada el mazo va apagado y SIN número: la Final
              entra sin sacar carta, así que `cardsLeft` quedó en lo que sobró y
              anunciar "{n} sin dar" de una sala terminada sería mentir. */}
          <Mazo apagado={mesa.liquidada || mesa.cartasSinDar === 0} />
          <span>
            <span className="block text-sm text-(--color-muted-3)">{t("aleph.scene.deck")}</span>
            {!mesa.liquidada && (
              <span className="font-pixel text-sm text-(--color-muted-bright)">
                {t("aleph.scene.deckLeft", { n: mesa.cartasSinDar })}
              </span>
            )}
          </span>
        </div>
      </div>

      {mesa.liquidada ? (
        // El motor no vacía la caja al liquidar: `finish()` reparte `box / N`
        // dentro de `payouts` y deja `box` y los `pocket` intactos. Una barra
        // con esos mismos 1.800 adentro, arriba de una tabla de pagos donde ya
        // están repartidos, contaría la misma plata dos veces.
        <p className="mt-3 text-sm text-(--color-muted-3)">
          {t("aleph.scene.settledSplit", { each: mesa.reparto ?? 0 })}
        </p>
      ) : (
        <>
          <div className="barra mt-3" aria-hidden="true">
            <span className="barra-pozo" style={{ width: `${pct(mesa.pozo)}%` }} />
            <span className="barra-caja" style={{ width: `${pct(mesa.caja)}%` }} />
            <span className="barra-bolsillos" style={{ width: `${pct(mesa.bolsillos)}%` }} />
            {/* De dónde arrancó el pozo. */}
            <span className="barra-marca" style={{ left: `${ARRANQUE_DEL_POZO * 100}%` }} />
          </div>
          <p className="mt-2 text-sm text-(--color-muted-3)">
            {t("aleph.scene.invariant", {
              pot: mesa.pozo,
              box: mesa.caja,
              pockets: mesa.bolsillos,
              total: mesa.total,
            })}
          </p>
        </>
      )}
      <p className="mt-2 text-sm text-(--color-muted-3)">{t("aleph.scene.deckNote")}</p>
    </div>
  );
}
```

- [ ] **Step 2: Comprobar que compila, pasa el lint y formatea**

Run: `npm run typecheck:web && npm run lint && npx prettier --write apps/web/app/components/aleph/Mesa.tsx && npm run format:check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/aleph/Mesa.tsx
git commit -m "feat(web): la mesa de Aleph con el pozo, la caja y el mazo dibujados

Los tres objetos con su monto al lado y la barra de tres segmentos que ES la
cuenta que cierra: pozo + caja + bolsillos = total. Con la sala liquidada la
barra no se dibuja (contaría dos veces la caja que payouts ya repartió) y en su
lugar va la línea del reparto.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `Asientos.tsx` y los dos retoques de `Criatura.tsx`

**Files:**

- Create: `apps/web/app/components/aleph/Asientos.tsx`
- Modify: `apps/web/app/components/aleph/Criatura.tsx:8` (el import), `:24-25` y `:38-39` (la desestructuración y el tipo, que suman `grietaNueva`; los dos bloques traen de vuelta el cierre —`}: {` y `}) {`—, así que el rango llega una línea más abajo), `:30-31` (el docstring de `clase`), `:41-48` (los nodos y el `animationDelay`), `:60-62` (el `map` de `<rect>`)

**Interfaces:**

- Consumes: de la Task 2 — `AsientoDeEscena`, `Destello`, `EtiquetaDeAsiento`, `ModeloDeEscena`, `Traductor`. De la Task 7 — `Dorso`, `Olla`. De la Task 1 — `nodosDeGrieta`. De PR1 — `Criatura`, `nodosDe`, `rasgosDe`, `filasDeOro`, `OPACIDAD_DE_ESTADO`.
- Produces:
  - `Asientos(props: { modelo: ModeloDeEscena; destello: Destello | null; t: Traductor; etiquetaDe: (seat: AsientoDeEscena["seat"]) => EtiquetaDeAsiento })`
  - `Criatura` suma la prop opcional `grietaNueva?: boolean`.

**Nota sobre el test:** sin test de render. Lo que deciden estos dos ya está probado: el modelo por `modeloDeEscena` (tests 10 a 16) y la equivalencia entre la grieta suelta y la que dibuja `nodosDe` por el test "3 bis" de la Task 1. La compuerta es `typecheck` + `lint` (la build con los componentes montados se corre en el Step 3 de la Task 12, cuando ya están montados los siete componentes, y de nuevo en el cierre de la Task 14) más la verificación visual de la Task 14.

- [ ] **Step 1: Los dos retoques de `Criatura.tsx`**

(a) El import de `:8` suma `nodosDeGrieta`:

```tsx
import {
  filasDeOro,
  nodosDe,
  nodosDeGrieta,
  OPACIDAD_DE_ESTADO,
  rasgosDe,
  type Estado,
} from "./nucleo/criatura";
```

(b) El docstring de `clase` (`:30-31`) pasa a nombrar las cuatro variantes:

<!-- prettier-ignore -->
```tsx
  /** `criatura--mesa`, `criatura--charla`, `criatura--final` o
   *  `criatura--probador`: NUNCA un número. Los anchos cambian en el corte de
   *  contenedor de la escena y un número de JS no alterna dos valores en una
   *  media query. */
  clase: string;
```

(c) La prop nueva, en la desestructuración (después de `respira = false,`) y en el tipo (después de `respira?: boolean;`):

<!-- prettier-ignore -->
```tsx
  respira = false,
  grietaNueva = false,
}: {
```

<!-- prettier-ignore -->
```tsx
  respira?: boolean;
  /** La grieta se reveló en ESTE sondeo: se descubre con `aleph-grieta`. */
  grietaNueva?: boolean;
}) {
```

(d) El cuerpo (`:41-48`): la grieta sale aparte y el `animationDelay` deja de tener ruido de punto flotante:

<!-- prettier-ignore -->
```tsx
  const filas = oro ? filasDeOro(oro.bolsillo, oro.maximo) : 0;
  // El cuerpo va SIN la marca y la grieta aparte, en su propio <g>: es la
  // única forma de animarla sola, porque un <rect> suelto no se puede
  // seleccionar desde el CSS. Sale de `nodosDeGrieta`, que es la misma fuente
  // que usa `nodosDe` por adentro, así que las dos no pueden divergir. Queda
  // dibujada al final en vez de antes de los overlays de cabeza, y da igual:
  // la grieta vive en el cuerpo (y = 5 a 14) y esos overlays en y <= 2.
  const nodos = nodosDe(rasgos, { estado, filas });
  const grieta = traidor ? nodosDeGrieta(estado) : [];
  const opacidad = OPACIDAD_DE_ESTADO[estado];
  // El desfase sale del byte 11, el primero que no usa ningún rasgo, y va en
  // negativo para que la animación arranque ya corrida y ocho criaturas no
  // latan en bloque. Es azar DECORATIVO: el del juego sale de SHA-256 del
  // secreto (reglas v2) y no toca ni al servidor ni al contrato.
  //
  // `desfase * 0,4` en punto flotante da `-1.2000000000000002s`: CSS lo parsea
  // igual, pero ensucia el DOM. La división entera por 10 lo deja limpio.
  const estilo = respira ? { animationDelay: `-${(rasgos.desfase * 4) / 10}s` } : undefined;
```

(e) Y el `map` de `<rect>` (`:60-62`) suma el `<g>` de la grieta:

<!-- prettier-ignore -->
```tsx
      {nodos.map((n, i) => (
        <rect key={i} x={n.x} y={n.y} width={n.w} height={n.h} fill={n.fill} />
      ))}
      {grieta.length > 0 && (
        <g className={grietaNueva ? "aleph-grieta" : undefined}>
          {grieta.map((n, i) => (
            <rect key={i} x={n.x} y={n.y} width={n.w} height={n.h} fill={n.fill} />
          ))}
        </g>
      )}
```

- [ ] **Step 2: Escribir `Asientos.tsx`**

Crear `apps/web/app/components/aleph/Asientos.tsx`:

```tsx
// LA GRILLA DE ASIENTOS, en sus dos formas. El mismo componente en los dos
// anchos y UN SOLO dibujo de criatura: lo que cambia de forma lo decide el
// corte de contenedor de 560 px, en `globals.css`.
//
// Dos cosas que ese corte no puede resolver solo y por eso están acá:
//   - las columnas viajan como custom properties (un elemento no puede
//     alternar dos valores de JS en una media query, y Tailwind v4 escanea
//     literales, así que `grid-cols-${n}` no genera nada);
//   - la etiqueta se monta en las DOS formas y el CSS esconde una, porque
//     `playerLabel` devuelve un string plano y no hay media query que parta un
//     string. Y NINGUNA de las dos lleva `aria-hidden`: cuál está escondida lo
//     decide el ancho del contenedor y un atributo del marcado no puede
//     seguirlo —a 375 px la escondida es la ancha—, así que un `aria-hidden`
//     fijo en la angosta dejaba muda justo a la tarjeta que se ve. El
//     `display: none` del corte ya saca del árbol de accesibilidad a la copia
//     escondida en cada ancho: exactamente una queda expuesta.

import type { CSSProperties } from "react";
import { Criatura } from "./Criatura";
import { Dorso, Olla } from "./Objetos";
import type {
  AsientoDeEscena,
  Destello,
  EtiquetaDeAsiento,
  ModeloDeEscena,
  Traductor,
} from "./nucleo/escena";

function Tarjeta({
  asiento,
  maximo,
  tamano,
  destello,
  t,
  etiquetaDe,
}: {
  asiento: AsientoDeEscena;
  maximo: number;
  /** `criatura--mesa` o `criatura--final`: nunca un número. */
  tamano: string;
  destello: Destello | null;
  t: Traductor;
  etiquetaDe: (seat: AsientoDeEscena["seat"]) => EtiquetaDeAsiento;
}) {
  const etiqueta = etiquetaDe(asiento.seat);
  const chip = t(asiento.chip);
  const grietaNueva =
    destello?.tipo === "grieta" &&
    (destello.asientos ?? []).some((a) => a.toLowerCase() === asiento.address.toLowerCase());
  return (
    <li className={`asiento${asiento.estado === "abandono" ? " asiento--abandono" : ""}`}>
      <Criatura
        address={asiento.address}
        estado={asiento.estado}
        traidor={asiento.traidor}
        oro={{ bolsillo: asiento.bolsillo, maximo }}
        clase={`${tamano} shrink-0`}
        // El aria-label NO usa la etiqueta entera: el nombre, el avatar y el
        // chip CASA/WEBHOOK ya están en el HTML de al lado, y meterlos también
        // adentro del SVG los hace sonar dos veces.
        etiquetaA11y={t("aleph.a11y.criatura", { wallet: etiqueta.wallet, estado: chip })}
        respira={asiento.respira}
        grietaNueva={grietaNueva}
      />
      <div className="min-w-0 flex-1">
        <div className="etiqueta-ancha truncate text-sm text-(--color-muted-bright)">
          {etiqueta.plana}
        </div>
        {/* Sin `aria-hidden`: el `display: none` del corte ya esconde una de
            las dos formas del árbol de accesibilidad, y cuál es depende del
            ancho, que el marcado no conoce. */}
        <div className="etiqueta-angosta">
          {etiqueta.perfil && (
            <div className="truncate text-sm text-(--color-muted-bright)">{etiqueta.perfil}</div>
          )}
          {/* La wallet abreviada NUNCA se trunca, en ningún ancho: es la regla
              anti-suplantación de wallet.tsx, no una preferencia de layout. */}
          <div className="font-mono text-px10 text-(--color-muted-3)">{etiqueta.wallet}</div>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {/* CASA/WEBHOOK es chip de IDENTIDAD: no cuenta para el tope de dos,
              que es sobre los de estado. */}
          {etiqueta.tag && <span className="chip etiqueta-angosta">{etiqueta.tag}</span>}
          <span className="chip">{chip}</span>
          {asiento.traidor && <span className="chip chip--danger">{t("aleph.state.traidor")}</span>}
          {asiento.insignia !== null && (
            <span className="chip chip--money">+{asiento.insignia}</span>
          )}
        </div>
      </div>
      <span className="font-pixel shrink-0 text-sm text-(--color-gold)">{asiento.bolsillo}</span>
    </li>
  );
}

export function Asientos({
  modelo,
  destello,
  t,
  etiquetaDe,
}: {
  modelo: ModeloDeEscena;
  destello: Destello | null;
  t: Traductor;
  etiquetaDe: (seat: AsientoDeEscena["seat"]) => EtiquetaDeAsiento;
}) {
  // Las custom properties no entran en `CSSProperties` (csstype solo declara
  // las propiedades conocidas), así que el objeto se arma aparte y se afirma.
  const columnas = {
    "--cols-ancha": modelo.columnas.ancha,
    "--cols-angosta": modelo.columnas.angosta,
  } as CSSProperties;

  return (
    <>
      {/* La Final es el único momento en que la escena cambia de forma: los dos
          finalistas grandes y enfrentados, con la olla del pozo en el medio. */}
      {modelo.finalistas.length === 2 && (
        <ol className={`escena-final mt-4${destello?.tipo === "revela" ? " aleph-revela" : ""}`}>
          <Tarjeta
            asiento={modelo.finalistas[0]}
            maximo={modelo.maximo}
            tamano="criatura--final"
            destello={destello}
            t={t}
            etiquetaDe={etiquetaDe}
          />
          {/* El pozo, en el medio de los dos. Va en su propio <li> porque un
              <ol> solo puede tener <li> de hijo directo. */}
          <li className="escena-pozo" aria-hidden="true">
            <Olla clase="objeto" />
          </li>
          <Tarjeta
            asiento={modelo.finalistas[1]}
            maximo={modelo.maximo}
            tamano="criatura--final"
            destello={destello}
            t={t}
            etiquetaDe={etiquetaDe}
          />
        </ol>
      )}

      <ol className="escena-asientos mt-4" style={columnas}>
        {modelo.asientos.map((a) => (
          <Tarjeta
            key={a.address}
            asiento={a}
            maximo={modelo.maximo}
            tamano="criatura--mesa"
            destello={destello}
            t={t}
            etiquetaDe={etiquetaDe}
          />
        ))}
        {/* Sillas vacías: SOLO en el lobby. En `funding` la lista ya está
            congelada y una silla prometería un lugar que no se puede ocupar. */}
        {Array.from({ length: modelo.sillas }, (_, i) => (
          <li
            key={`silla${i}`}
            className="asiento asiento--vacia"
            aria-label={t("aleph.scene.emptySeat")}
          >
            <Dorso />
          </li>
        ))}
      </ol>
    </>
  );
}
```

- [ ] **Step 3: Comprobar que compila, pasa el lint y formatea**

Run: `npm run typecheck:web && npm run lint && npx prettier --write apps/web/app/components/aleph/Asientos.tsx apps/web/app/components/aleph/Criatura.tsx && npm run format:check && node --import tsx --test apps/web/test/aleph-criatura.test.ts apps/web/test/aleph-escena.test.ts`
Expected: PASS en las cuatro, y los tests de la criatura siguen en verde: `Criatura.tsx` cambió cómo pide los nodos, no qué nodos son.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/aleph/Asientos.tsx apps/web/app/components/aleph/Criatura.tsx
git commit -m "feat(web): la grilla de asientos de Aleph en sus dos formas

Tarjeta angosta por defecto y vertical adentro del corte de 560px, la etiqueta
montada en las dos formas (la esconde el display:none del corte, que ya la saca
del árbol de accesibilidad: un aria-hidden fijo dejaba muda la que se ve a 375
px), las sillas vacías del lobby, la insignia +{n} del que se fue con plata y
la fila de la Final con el pozo en el medio. La criatura dibuja la grieta en su
propio <g> para poder animarla, y el animationDelay sale sin ruido de punto
flotante.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: `Escena.tsx` — la ventana, el contenedor y el botón de movimiento

**Files:**

- Create: `apps/web/app/components/aleph/Escena.tsx`

**Interfaces:**

- Consumes: de la Task 2 — `modeloDeEscena`, `Destello`, `EtiquetaDeAsiento`, `Traductor`, `SalaDeAleph`, `AsientoDeSala`. De la Task 4 — `leerPreferencia`, `guardarPreferencia`. De las Tasks 8, 9 y 10 — `CartaEtapa`, `Friso`, `Mesa`, `Asientos`, `mmss`. De la Task 5 — `aleph.scene.title`, `.pause`, `.resume`.
- Produces: `Escena(props: { room: SalaDeAleph; now: number; destello: Destello | null; t: Traductor; etiquetaDe: (seat: AsientoDeSala) => EtiquetaDeAsiento; etiquetaDePorDireccion: (address: string) => string })`. La monta la página en la Task 13.

**Nota sobre el test:** sin test de render. Lo que decide sale de `modeloDeEscena` (tests 10 a 16) y de `movimiento.ts` (test de la Task 4). La compuerta es `typecheck` + `lint` (la build con los componentes montados se corre en el Step 3 de la Task 12, cuando ya están montados los siete componentes, y de nuevo en el cierre de la Task 14) más la verificación visual de la Task 14.

- [ ] **Step 1: Escribir el componente**

Crear `apps/web/app/components/aleph/Escena.tsx`:

```tsx
"use client";

// LA ESCENA. Arma la ventana, declara el contenedor del que cuelga el único
// corte (560 px) y lleva el botón de movimiento. No decide nada: todo lo que
// dibuja sale de `modeloDeEscena`.

import { useEffect, useState } from "react";
import { Asientos } from "./Asientos";
import { CartaEtapa } from "./CartaEtapa";
import { Friso } from "./Friso";
import { Mesa } from "./Mesa";
import { modeloDeEscena } from "./nucleo/escena";
import type { Destello, EtiquetaDeAsiento, Traductor } from "./nucleo/escena";
import type { AsientoDeSala, SalaDeAleph } from "./nucleo/estados";
import { guardarPreferencia, leerPreferencia } from "./nucleo/movimiento";
import { mmss } from "../../lib/tiempo";

export function Escena({
  room,
  now,
  destello,
  t,
  etiquetaDe,
  etiquetaDePorDireccion,
}: {
  room: SalaDeAleph;
  now: number;
  destello: Destello | null;
  t: Traductor;
  etiquetaDe: (seat: AsientoDeSala) => EtiquetaDeAsiento;
  etiquetaDePorDireccion: (address: string) => string;
}) {
  const modelo = modeloDeEscena(room);
  // La preferencia se lee en un efecto, nunca en el render: en el servidor no
  // hay `localStorage` y en la primera pintura puede haber un cuadro de
  // movimiento antes de que se apague. No hay salto de layout ni dato perdido,
  // así que no vale un script inline en el <head>.
  const [conMovimiento, setConMovimiento] = useState(true);
  useEffect(() => {
    setConMovimiento(leerPreferencia());
  }, []);
  useEffect(() => {
    document.body.classList.toggle("sin-movimiento", !conMovimiento);
    return () => document.body.classList.remove("sin-movimiento");
  }, [conMovimiento]);

  const alternar = () => {
    const proximo = !conMovimiento;
    setConMovimiento(proximo);
    guardarPreferencia(proximo);
  };

  return (
    <section className="win escena mt-6">
      <div className="win-title win-title--cyan">
        <span>{t("aleph.scene.title")}</span>
        {/* El único reloj que la barra se queda es el del lobby: los otros ya
            están en pantalla (la carta de etapa en `playing`, el encabezado en
            `funding`) y dos cuentas regresivas iguales a diez píxeles una de
            otra son el duplicado que este mismo rediseño vino a sacar. */}
        {modelo.reloj !== null && (
          <span className="font-mono text-(--color-muted-bright)">{mmss(modelo.reloj - now)}</span>
        )}
      </div>
      <div className="p-3">
        {modelo.carta && (
          <CartaEtapa
            carta={modelo.carta}
            now={now}
            t={t}
            etiquetaDePorDireccion={etiquetaDePorDireccion}
          />
        )}
        {modelo.friso && <Friso friso={modelo.friso} t={t} />}
        {modelo.mesa && <Mesa mesa={modelo.mesa} t={t} />}
        <Asientos modelo={modelo} destello={destello} t={t} etiquetaDe={etiquetaDe} />
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn3d btn3d--cyan btn3d--sm" onClick={alternar}>
            {t(conMovimiento ? "aleph.scene.pause" : "aleph.scene.resume")}
          </button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Comprobar que compila, pasa el lint y formatea**

Run: `npm run typecheck:web && npm run lint && npx prettier --write apps/web/app/components/aleph/Escena.tsx && npm run format:check`
Expected: PASS. Y la comprobación de mayúsculas, ahora que `Escena.tsx` convive con `nucleo/escena.ts`:

```bash
for d in apps/web/app/components/aleph apps/web/app/components/aleph/nucleo; do ls "$d" | tr 'A-Z' 'a-z' | sort | uniq -d; done
```

Expected: sin salida.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/components/aleph/Escena.tsx
git commit -m "feat(web): la escena de Aleph, con su contenedor y el botón de movimiento

La ventana ESCENA.EXE declara container-type: inline-size —de ahí cuelga el
único corte de 560px— y arma carta, friso, mesa y asientos. El botón pone
sin-movimiento en el body y guarda la preferencia; el reloj de la barra es el
del lobby, que es el único que no está en pantalla en ningún otro lado.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: `Liquidacion.tsx`, el fundido de la desclasificación y el vacío de `Charla.tsx`

**Files:**

- Create: `apps/web/app/components/aleph/Liquidacion.tsx`
- Modify: `apps/web/app/components/aleph/Charla.tsx:8-16` (el bloque de imports y la declaración de `Destello`, que se muda; arranca en `:8`, que es `import { Criatura }`, porque el bloque de reemplazo lo trae de nuevo), `:20-22` y `:27-30` (la prop `destello`, que se desestructura y estrena docstring), `:46-48` (el vacío de la terminal; `:48` es el `) : (` que el bloque también trae) y `:66` (la clase de la línea de susurro, que suma el fundido)

**Interfaces:**

- Consumes: de la Task 3 — `gruposDeVotos`, `EventoDeRegistro`. De la Task 2 — `Traductor`, `Destello`, `ResultadoDeEtapa`. De la Task 5 — `aleph.votes.*`; y las que ya existían, `aleph.room.stageHead` y `aleph.stage.*`.
- Produces: `Liquidacion(props: { eventos: EventoDeRegistro[] | null; etapas: ResultadoDeEtapa[]; t: Traductor; etiquetaDePorDireccion: (address: string) => string })`. La monta la página en la Task 13.

**Nota sobre el test:** sin test de render. La agrupación y los ausentes ya los prueba `gruposDeVotos` (Task 3), y el vacío de la terminal lo cubre `lineasDeCharla` (test 20 de PR1, que sigue en verde: el cambio es de marcado, no de modelo). La compuerta es `typecheck` + `lint` (la build con los componentes montados se corre en el Step 3 de la Task 12, cuando ya están montados los siete componentes, y de nuevo en el cierre de la Task 14) más la verificación visual de la Task 14.

- [ ] **Step 1: Escribir `Liquidacion.tsx`**

Crear `apps/web/app/components/aleph/Liquidacion.tsx`:

```tsx
// QUIEN_VOTO_A_QUIEN.TXT. Se abre cuando la sala liquida: hasta entonces el
// árbitro responde 400 al registro, y mostrar los votos en vivo sería filtrar
// el juego.
//
// NO PIDE NADA: la página trae los eventos una sola vez y se los pasa. Si el
// pedido falló, `eventos` llega en `null` y el bloque muestra una línea que
// apunta al registro firmado, que ya está enlazado abajo.

import { gruposDeVotos } from "./nucleo/escena";
import type { EventoDeRegistro, Traductor } from "./nucleo/escena";
import type { ResultadoDeEtapa } from "./nucleo/estados";

export function Liquidacion({
  eventos,
  etapas,
  t,
  etiquetaDePorDireccion,
}: {
  eventos: EventoDeRegistro[] | null;
  /** `results` entero: es lo único que sabe el `kind` de cada índice —
   *  `AlephEvent` solo trae el número— y los `votes` de cada etapa de Voto,
   *  que listan a todos los que estaban vivos. */
  etapas: ResultadoDeEtapa[];
  t: Traductor;
  etiquetaDePorDireccion: (address: string) => string;
}) {
  const grupos = eventos ? gruposDeVotos(eventos, etapas) : [];
  return (
    <section className="paper mt-6">
      <div className="paper-title">
        <span>{t("aleph.votes.title")}</span>
      </div>
      <div className="p-5 sm:p-6">
        {!eventos ? (
          <p className="leading-relaxed text-(--color-paper-muted)">
            {t("aleph.votes.unavailable")}
          </p>
        ) : grupos.length === 0 ? (
          <p className="leading-relaxed text-(--color-paper-muted)">{t("aleph.votes.empty")}</p>
        ) : (
          <ol className="flex flex-col gap-5">
            {grupos.map((g) => (
              <li key={g.n}>
                <h3 className="text-base font-bold text-(--color-paper-ink)">
                  {t("aleph.room.stageHead", { n: g.n, kind: t(`aleph.stage.${g.kind}`) })}
                </h3>
                <ul className="mt-1 flex flex-col gap-1">
                  {g.votos.map((v, i) => (
                    <li key={i} className="leading-relaxed text-(--color-paper-muted)">
                      {t("aleph.votes.line", {
                        voter: etiquetaDePorDireccion(v.voter),
                        target: etiquetaDePorDireccion(v.target),
                      })}
                    </li>
                  ))}
                  {/* El que no vota queda contado en contra de sí mismo al
                      resolver la etapa, y eso lo pone el motor, no una acción
                      firmada: no aparece en los eventos. Sin esta línea, una
                      etapa con dos ausentes muestra menos votos de los que el
                      relato de abajo ya cuenta, en la misma pantalla. */}
                  {g.ausentes.length > 0 && (
                    <li className="leading-relaxed text-(--color-paper-muted-2)">
                      {t("aleph.votes.implied", {
                        who: g.ausentes.map(etiquetaDePorDireccion).join(", "),
                      })}
                    </li>
                  )}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Los cuatro retoques de `Charla.tsx`**

Los cuatro números de línea son los del archivo en `main` y cada edición corre las siguientes: aplicarlas de arriba hacia abajo y buscar por el TEXTO del anclaje.

(a) El bloque `:8-16` —los imports más la declaración de `Destello`— queda así: el tipo se muda a `nucleo/escena` porque ahora lo usan la escena, la terminal y la página (nada más lo importaba: `grep -rn "Destello" apps/web` solo lo encuentra acá, más un comentario suelto de `FlappyGame.tsx` que no tiene nada que ver). **El rango arranca en `:8` y no en `:9`**: `:8` es `import { Criatura } from "./Criatura";` y el bloque de abajo la trae de nuevo, así que reemplazar desde `:9` la duplica (`TS2300`).

```tsx
import { Criatura } from "./Criatura";
import { lineasDeCharla } from "./nucleo/charla";
import type { Destello } from "./nucleo/escena";
import type { SalaDeAleph } from "./nucleo/estados";
```

(b) La prop `destello` **se desestructura** (el bloque `:20-22`, que va de `t,` hasta el `}: {`) y su docstring (`:27-30`) deja de contar la historia de PR1: ahora la terminal sí la consume.

<!-- prettier-ignore -->
```tsx
  t,
  etiquetaDePorDireccion,
  destello,
}: {
```

<!-- prettier-ignore -->
```tsx
  /** El destello que la página calculó comparando la vista nueva con la
   *  anterior. La terminal mira uno solo: `desclasifica`, que es el fundido con
   *  el que entran las líneas de susurro cuando la sala liquida. Los otros dos
   *  son de la escena y acá se ignoran sin ruido. */
  destello: Destello | null;
```

(c) El vacío de la terminal (`:46-48`) deja de mentir con la sala liquidada. **El rango llega hasta `:48`**, que es el `) : (` que el bloque de abajo también trae: cortando en `:47` queda duplicado.

<!-- prettier-ignore -->
```tsx
        {modelo.lineas.length === 0 ? (
          // Con la sala liquidada NO se dice "todavía no habló nadie en esta
          // etapa": no hay etapa en curso que nombrar, y el cartel de
          // desclasificación de arriba ya dice que acá está todo lo que se
          // dijo. Es la misma razón por la que la ventana no se monta en
          // `lobby`, `funding` ni `dissolved`.
          !modelo.desclasificada && <p className="charla-nota mt-3">{t("aleph.chat.empty")}</p>
        ) : (
```

(d) Y la clase de la línea de susurro (`:66`) suma el fundido. **Acá es donde `aleph-desclasifica` se aplica de verdad**: el spec dice "400 ms, las líneas de susurro entran, una vez, al liquidar", así que la clase va en cada `<li>` de susurro y no en el `div.charla`, que ya estaba en pantalla antes de liquidar. La página le pasa el mismo `destello` a la escena y a la terminal (Task 13, (j) y (j bis)), y el efecto de un segundo que lo limpia (Task 13 (f)) es lo que hace que entre una sola vez:

<!-- prettier-ignore -->
```tsx
                  className={`charla-linea${linea.susurro ? " charla-linea--susurro" : ""}${
                    linea.susurro && destello?.tipo === "desclasifica" ? " aleph-desclasifica" : ""
                  }`}
```

- [ ] **Step 3: Comprobar que compila, pasa el lint y formatea**

Run: `npm run typecheck:web && npm run lint && npx prettier --write apps/web/app/components/aleph/Liquidacion.tsx apps/web/app/components/aleph/Charla.tsx && npm run format:check && node --import tsx --test apps/web/test/aleph-secretos.test.ts && npm run build --workspace apps/web`
Expected: PASS en las cinco; los tests de secretos (17 a 20) siguen en verde. **Acá es donde la build mira por primera vez los componentes**, y es la única corrida que los mira antes del cierre: con los siete escritos y el CSS puesto, recién ahora hay algo que la build de la Task 6 no podía mirar (esa corrió cuando no existía ni un `.tsx` nuevo). Si algo del CSS o de un componente no compila, se entera acá y no ocho tareas después.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/aleph/Liquidacion.tsx apps/web/app/components/aleph/Charla.tsx
git commit -m "feat(web): la ventana de quién votó a quién, y la terminal que consume el destello

QUIEN_VOTO_A_QUIEN.TXT dibuja los grupos que arma escena.ts y no pide nada: la
página le pasa los eventos. La terminal estrena la prop destello que PR1 dejó
cableada: al liquidar, las líneas de susurro entran con aleph-desclasifica, el
fundido de 400 ms. Y con la sala liquidada deja de decir 'todavía no habló
nadie en esta etapa', que ahí nombra una etapa que no existe.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: `page.tsx` — montar la escena y sacar lo que quedó duplicado

**Files:**

- Modify: `apps/web/app/aleph/[roomId]/page.tsx` — `:12-25` (imports), `:39-42` (`mmss`, que se va a `lib/tiempo`), `:47-49` (el estado), `:62-82` (el `load` del sondeo), `:94-96` (`counting`), `:121-139` (las etiquetas y los derivados), `:164-261` (el `<div className="p-5">` del encabezado con su ternario de cuatro ramas y su `</div>`), `:264-277` (la ventana ASIENTOS, que se reemplaza por `<Escena>`), `:279-280` (el `<Charla>`, que pasa a recibir el destello), `:314-316` (dónde entra la liquidación), `:430-457` (`Money`, que se borra), `:459-524` (`SeatRow`, que se borra)
- Modify: `apps/web/app/lib/i18n/es.ts:555-560`, `en.ts:548-553`, `fr.ts:562-567`, `hi.ts:546-551` (las cuatro claves huérfanas)
- Test: `apps/web/test/i18n.test.ts` (agregar el test del borrado, y `:110`, el comentario que cita a `aleph.room.nowPlaying` como fuente de «फ़ेज़»)

**Interfaces:**

- Consumes: `Escena` (Task 11), `Liquidacion` (Task 12), `Charla` (PR1), `mmss` (Task 8), `Destello`, `EtiquetaDeAsiento`, `AsientoDeSala` (Task 2), `getAlephLog` y `AlephLog` (`apps/web/app/lib/arbiter.ts:348` y `:13`).
- Produces: nada que consuman otras tareas.

**Nota sobre el test:** la página no lleva test de render. Lo que sí tiene compuerta roja es el borrado de las cuatro claves huérfanas, y por eso el Step 1 escribe ese test primero. El resto es `npm run check`, `npm run build` y la verificación visual de la Task 14.

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `apps/web/test/i18n.test.ts`:

```ts
test("las cuatro claves huérfanas de la sala ya no están en ningún idioma", () => {
  // Las cuatro tenían UN solo uso cada una y los cuatro se fueron con los
  // bloques que la escena reemplaza (los tres Money del encabezado, la línea
  // de etapa con su mm:ss y la barra de la ventana ASIENTOS). El test de
  // paridad no avisa de esto: compara claves ENTRE idiomas, no uso.
  for (const k of [
    "aleph.room.potInitial",
    "aleph.room.nowPlaying",
    "aleph.room.deadline",
    "aleph.room.seats",
  ])
    for (const [lang, dict] of Object.entries(DICTS))
      assert.equal(dict[k], undefined, `${lang} todavía tiene ${k}`);
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `node --import tsx --test apps/web/test/i18n.test.ts`
Expected: FAIL con `AssertionError [ERR_ASSERTION]: en todavía tiene aleph.room.potInitial`.

- [ ] **Step 3: La página**

**Todos los números de línea de este Step son los del archivo en `main`** (`00c703c`), y están verificados uno por uno. Aplicar (a) a (m) **de arriba hacia abajo** y buscar por el TEXTO del anclaje, no por el número: cada edición corre las siguientes (la (a) cambia catorce líneas de import por dieciocho, la (b) borra cuatro, la (i) reemplaza noventa y ocho líneas por setenta y tres). Ese es el orden en que están escritas.

(a) El bloque de imports (`:12-25`) queda así. Se van `Criatura`, `chipDeAsiento`, `estadoDeAsiento` y el tipo `AlephSeatView` (los usaba `SeatRow`, que se borra) y entran `useRef`, `getAlephLog`, `AlephLog`, `mmss`, `Escena`, `Liquidacion` y los dos tipos de la escena:

```tsx
import { use, useEffect, useRef, useState } from "react";
import { LocaleLink as Link } from "@/app/components/LocaleLink";
import { useT } from "@/app/lib/i18n";
import { playerLabel, agentTag, shortAddress } from "@/app/lib/wallet";
import {
  getAlephLog,
  getAlephRoom,
  warmUpArbiter,
  type AlephLog,
  type AlephRoomView,
} from "@/app/lib/arbiter";
import { txUrl } from "@/app/lib/explorer";
import { mmss } from "@/app/lib/tiempo";
import { Charla } from "@/app/components/aleph/Charla";
import { Escena } from "@/app/components/aleph/Escena";
import { Liquidacion } from "@/app/components/aleph/Liquidacion";
import type { Destello, EtiquetaDeAsiento } from "@/app/components/aleph/nucleo/escena";
import type { AsientoDeSala } from "@/app/components/aleph/nucleo/estados";
```

(b) Borrar la función `mmss` (`:39-42`): ahora viene de `@/app/lib/tiempo`, con el mismo cuerpo y el mismo formato. El `type T` de `:37` se queda: lo sigue usando `stageLines`.

(c) Debajo de la línea `:49` (`const [now, setNow] = useState(() => Date.now());`), el estado nuevo:

<!-- prettier-ignore -->
```tsx
  const [destello, setDestello] = useState<Destello | null>(null);
  /** `null` mientras se pide; `{ eventos }` con la respuesta, y `eventos` en
   *  `null` si el pedido falló. Sin este tercer estado, la ventana diría "el
   *  registro no respondió" durante los segundos que tarda en responder. */
  const [registro, setRegistro] = useState<{ eventos: AlephLog["events"] | null } | null>(null);
  /** La vista del sondeo anterior: de la diferencia entre las dos sale el
   *  destello. Va en un ref y no en estado porque no se dibuja. */
  const anterior = useRef<AlephRoomView | null>(null);
  const pidioRegistro = useRef(false);
```

(d) Adentro de `load()`, justo después de `setRoom(r);` (`:68`):

<!-- prettier-ignore -->
```tsx
        setRoom(r);
        setDestello(destelloEntre(anterior.current, r));
        anterior.current = r;
```

(e) `counting` (`:94-96`) suma la rama del lobby: sin ella el mm:ss de la barra de la escena se congela en el valor del montaje y el sondeo de 10 s no lo mueve.

<!-- prettier-ignore -->
```tsx
  const counting =
    (room?.status === "playing" && room.deadline !== undefined) ||
    (room?.status === "funding" && room.fundingDeadline !== undefined) ||
    (room?.status === "lobby" && room.closesAt !== undefined);
```

(f) Después del `useEffect` del reloj (`:97-101`), tres efectos más:

<!-- prettier-ignore -->
```tsx
  // El destello se limpia solo al segundo: la clase tiene que salir del
  // marcado para que el próximo sondeo pueda volver a dispararla. La variable
  // se llama `limpiar` y no `t` porque `t` ya es el traductor de `useT()`.
  useEffect(() => {
    if (!destello) return;
    const limpiar = setTimeout(() => setDestello(null), 1000);
    return () => clearTimeout(limpiar);
  }, [destello]);

  // El registro solo existe con la sala `settled`: antes el árbitro responde
  // 400. Se pide UNA sola vez; si falla, la ventana muestra su línea y el
  // enlace al registro firmado que ya está abajo.
  useEffect(() => {
    if (room?.status !== "settled" || pidioRegistro.current) return;
    pidioRegistro.current = true;
    getAlephLog(roomId)
      .then((log) => setRegistro({ eventos: log.events }))
      .catch(() => setRegistro({ eventos: null }));
  }, [room?.status, roomId]);

  // Si la página cambiara de sala sin desmontarse, los dos refs y el registro
  // quedarían con lo de la sala anterior: el destello se calcularía contra una
  // vista ajena y la ventana de votos mostraría los votos de otra partida. Hoy
  // es inalcanzable (de sala a sala se pasa por `/aleph`, que desmonta), pero
  // cuesta cuatro líneas y saca la trampa de la mesa: por ese camino lo peor
  // que puede pasar es que la ventana de votos no se dibuje, nunca que muestre
  // los votos de otra sala.
  useEffect(() => {
    anterior.current = null;
    pidioRegistro.current = false;
    setRegistro(null);
    setDestello(null);
  }, [roomId]);
```

(g) Debajo de `etiquetaDePorDireccion` (`:121-124`, que no se toca), su hermana para los asientos:

<!-- prettier-ignore -->
```tsx
  // La etiqueta en sus dos formas. La ancha es el string plano de
  // `playerLabel`, que entra entero; la angosta son sus tres pedazos, porque a
  // 375 px el string entero no entra y no hay media query que parta un string.
  // Las dos las arma la página, que es la única que puede importar wallet.tsx.
  const etiquetaDe = (seat: AsientoDeSala): EtiquetaDeAsiento => {
    const tag = agentTag(seat, t);
    return {
      plana: playerLabel(seat.address, seat.name, seat.avatar, tag),
      perfil: seat.name ? `${seat.avatar ?? ""} ${seat.name}`.trim() : null,
      wallet: shortAddress(seat.address),
      tag: tag ?? null,
    };
  };
```

(h) Borrar `maxBolsillo`, `vivos` y `actuaron` (`:128-139`): los tres viven ahora adentro de `modeloDeEscena`. Queda solo `const live = …` y `const results = room.results ?? [];`, que siguen usándose en el encabezado, en el relato y en la liquidación.

(i) La rama `else` del encabezado (`:222-260`) se reduce a su única línea: **sin los tres `Money`, sin la línea de etapa y sin el contador**, lo que queda está todo bajo `live &&`, así que con la sala liquidada el `<div className="p-5">` quedaría vacío y de 40 px de alto justo arriba de la escena. Por eso el `<div className="p-5">` deja de envolver al ternario entero y pasa **adentro de cada rama**, y el encabezado solo lo renderiza cuando tiene algo que poner.

Reemplazar **`:164-261` entero** —el `<div className="p-5">` de `:164`, el ternario de cuatro ramas y el `</div>` de `:261`— por el bloque de abajo. Las tres primeras ramas van **verbatim**, tal cual están hoy: la de `lobby` es `:166-172`, la de `funding` es `:174-185` y la de `dissolved` es el contenido del fragmento de `:187-221`. Las dos primeras conservan su indentación de 12 espacios; la de `dissolved` **pierde dos** (hoy vive adentro de un `<>…</>` que acá desaparece, porque el `<div>` ya es su padre único):

<!-- prettier-ignore -->
```tsx
        {room.status === "lobby" ? (
          <div className="p-5">
            <p className="text-base leading-relaxed text-(--color-muted)">
              {t("aleph.room.lobbyIntro", {
                n: room.seats.length,
                min: room.min,
                max: room.max,
              })}
            </p>
          </div>
        ) : room.status === "funding" ? (
          <div className="p-5">
            <p className="text-base leading-relaxed text-(--color-muted)">
              {t("aleph.room.fundingIntro", {
                deposited: room.deposited?.length ?? 0,
                n: room.seats.length,
                stake: room.stake,
              })}{" "}
              {room.fundingDeadline ? (
                <span className="font-mono text-(--color-muted-bright)">
                  {t("aleph.room.fundingDeadline", { time: mmss(room.fundingDeadline - now) })}
                </span>
              ) : null}
            </p>
          </div>
        ) : room.status === "dissolved" ? (
          <div className="p-5">
            <p className="text-base leading-relaxed text-(--color-muted)">
              {room.fundingDeadline !== undefined
                ? t("aleph.room.dissolvedMoney", { n: room.seats.length })
                : t("aleph.room.dissolved", { min: room.min })}
            </p>
            {/* Reembolso de la mesa de plata: el punto de la nota en el brief
                de esta tarea. Simétrico al settleTx/settlePending de abajo:
                un depositante que se queda sin sala tiene que enterarse acá,
                no solo por su wallet. Se muestra solo si la sala llegó a
                fondear (si el lobby se disolvió antes, nunca hubo depósitos
                que devolver y `fundingDeadline` queda undefined). */}
            {room.stake > 0 && room.fundingDeadline !== undefined && (
              <p className="mt-3">
                {room.refundTx && /^0x[0-9a-f]{64}$/i.test(room.refundTx) ? (
                  <a
                    href={txUrl(room.refundTx)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-(--color-accent-2) hover:underline"
                  >
                    {t("aleph.room.refundTx")} ↗
                  </a>
                ) : room.refundOutcome === "none" ? (
                  <span className="text-sm text-(--color-muted-3)">
                    {t("aleph.room.refundNone")}
                  </span>
                ) : (
                  <span className="text-sm text-(--color-muted-3)">
                    {t("aleph.room.refundPending")}
                  </span>
                )}
              </p>
            )}
          </div>
        ) : (
          // Con la sala liquidada el encabezado queda reducido a su barra de
          // ventana con el chip LIQUIDADA y el de stake, que es lo único que
          // ahí sigue siendo verdad: el pozo, la caja y la etapa en curso ya
          // los dibuja la escena, y repetirlos era el duplicado que este
          // rediseño vino a sacar.
          live && (
            <div className="p-5">
              <p className="text-sm text-(--color-muted-3)">{t("aleph.room.liveNote")}</p>
            </div>
          )
        )}
```

Lo único que cambia adentro de las tres primeras ramas es esa indentación de la de `dissolved` y el fragmento `<>…</>` que se borra. Ni una palabra del contenido.

(j) Reemplazar la ventana `ASIENTOS` entera (`:264-277`, desde el comentario `{/* Asientos */}` hasta el `</section>`) por el montaje de la escena, que va **antes** de la charla:

<!-- prettier-ignore -->
```tsx
      {/* La escena: carta de etapa, friso, mesa y los asientos. Reemplaza a la
          ventana ASIENTOS, a los tres Money del encabezado y a la línea de
          etapa con su contador. */}
      <Escena
        room={room}
        now={now}
        destello={destello}
        t={t}
        etiquetaDe={etiquetaDe}
        etiquetaDePorDireccion={etiquetaDePorDireccion}
      />
```

(j bis) Y el montaje de la charla (`:279-280`) estrena el destello: es la **misma** prop, con el mismo valor, que la escena. Son ventanas hermanas y ninguna es hija de la otra, así que el fundido de la desclasificación y la revelación de los finalistas salen del mismo cálculo. Sin esta línea, `aleph-desclasifica` queda como CSS muerto: nadie más aplica esa clase, y ningún gate la caza (una prop declarada y no usada pasa typecheck y lint). Reemplazar `:279-280` por:

<!-- prettier-ignore -->
```tsx
      {/* La charla pública. Recibe el MISMO destello que la escena: al liquidar
          es la terminal la que se llena de golpe, y sus líneas de susurro
          entran con el fundido de `aleph-desclasifica`. */}
      <Charla
        room={room}
        t={t}
        etiquetaDePorDireccion={etiquetaDePorDireccion}
        destello={destello}
      />
```

(k) Entre el cierre del panel `QUE_PASO.TXT` (`:314`) y el bloque de la tabla de pagos (`:316`), la ventana de votos:

<!-- prettier-ignore -->
```tsx
      {/* Quién votó a quién: sale del registro firmado, que solo existe con la
          sala liquidada. La página lo pide una vez y el componente dibuja. */}
      {room.status === "settled" && registro && (
        <Liquidacion
          eventos={registro.eventos}
          etapas={results}
          t={t}
          etiquetaDePorDireccion={etiquetaDePorDireccion}
        />
      )}
```

(l) Borrar el componente `Money` entero (`:430-457`) y el componente `SeatRow` entero (`:459-524`). Los dos quedan sin un solo uso: lo que hacían vive ahora en `Mesa.tsx` y en `Asientos.tsx`, con las mismas claves y los mismos datos.

(m) Al final del archivo, después de `stageLines`, el cálculo del destello:

```tsx
/** Las animaciones reaccionan a DIFERENCIAS entre dos sondeos, no a eventos: no
 *  hay WebSocket ni SSE, y el árbitro dormido puede tardar 40 s en contestar.
 *  Sin vista anterior no se anima nada —si no, abrir una sala liquidada
 *  dispararía todo el teatro de golpe—. Y NO hay cola: si vuelven tres
 *  resultados juntos de un alt-tab de diez minutos, se anima solo el último y
 *  el resto aparece ya en su estado final, que es la misma disciplina que
 *  `CATCHUP_MAX_MS` en los juegos. */
function destelloEntre(antes: AlephRoomView | null, ahora: AlephRoomView): Destello | null {
  if (!antes) return null;
  const previos = antes.results?.length ?? 0;
  const cuantos = ahora.results?.length ?? 0;
  const ultimo = cuantos > previos ? ahora.results?.[cuantos - 1] : undefined;
  // EL ORDEN DE ESTAS TRES LÍNEAS ES LA DECISIÓN. La Final cierra y liquida en
  // el MISMO sondeo (`closePhase` llama a `settleRoom`, que pone `settled` en
  // el acto), así que todo sondeo con un `final` nuevo es también el de
  // `playing -> settled`: con la liquidación primera, `revela` no se dispara
  // NUNCA y la fila de los dos finalistas nunca se revela. Va primero la
  // Final, que es el caso raro; la liquidación SIN Final —el caso común, una
  // Oferta que deja un solo vivo— se queda con su fundido. Las dos animaciones
  // viven en elementos distintos (las líneas de la terminal y el <ol> de la
  // Final), así que no compiten por el mismo nodo.
  if (ultimo?.kind === "final") return { tipo: "revela" };
  if (antes.status === "playing" && ahora.status === "settled") return { tipo: "desclasifica" };
  if (ultimo?.kind === "lock" && ultimo.traitors?.length)
    return { tipo: "grieta", asientos: ultimo.traitors };
  return null;
}
```

**Las líneas en blanco que quedan de más.** Las ediciones que borran bloques —la (b), que se lleva `mmss`, y la (l), que se lleva `Money` y `SeatRow`— dejan uno o dos renglones vacíos pegados (en `main` son las líneas `:43`, `:458` y `:525`). No hay que contarlos a mano: `page.tsx` es el único archivo de PR2 que necesita el `prettier --write` del Step 5, y ese `--write` los junta antes de que corra `format:check`. Si se prefiere dejarlo prolijo a mano, se borran esas tres.

- [ ] **Step 4: Borrar las cuatro claves huérfanas (y el comentario del test que cita una)**

En los cuatro diccionarios, borrar las cuatro entradas (cada una ocupa una o dos líneas, según cómo la haya partido prettier):

- `apps/web/app/lib/i18n/es.ts`: `"aleph.room.potInitial"` (`:555`), `"aleph.room.nowPlaying"` (`:556`), `"aleph.room.deadline"` (`:557`) y `"aleph.room.seats"` (`:560`).
- `apps/web/app/lib/i18n/en.ts`: `:548`, `:549`, `:550` y `:553`.
- `apps/web/app/lib/i18n/fr.ts`: `:562`, `:563`, `:564` y `:567`.
- `apps/web/app/lib/i18n/hi.ts`: `:546`, `:547`, `:548` y `:551`.

Y una edición más, en el test: `apps/web/test/i18n.test.ts:110` cita a `aleph.room.nowPlaying` como la fuente de «फ़ेज़» (fase), y esa clave deja de existir en este mismo Step. El test no se rompe —`PALABRAS` está hardcodeado— pero el comentario queda mintiendo, y el `grep` de acá abajo lo esconde a propósito. Reemplazar esa línea por:

<!-- prettier-ignore -->
```ts
  // y «फ़ेज़» es fase. La clave que citaba este comentario
  // (`aleph.room.nowPlaying`) se borra en PR2; en hindi la palabra queda en
  // este mismo cartel y en `aleph.join.sdkBody`.
```

El archivo ya está en el `git add` del Step 6.

Comprobación de que no quedó ningún uso:

```bash
grep -rn "aleph.room.potInitial\|aleph.room.nowPlaying\|aleph.room.deadline\|aleph.room.seats" apps/web --include=*.ts --include=*.tsx | grep -v "test/i18n.test.ts"
```

Expected: sin salida (la única mención que queda es la lista del test que las declara muertas; la del comentario de `:110` ya se fue con la edición de arriba).

- [ ] **Step 5: Correr los tests y la compuerta**

Run: `node --import tsx --test apps/web/test/i18n.test.ts && npm run typecheck:web && npm run lint && npx prettier --write "apps/web/app/aleph/[roomId]/page.tsx" apps/web/app/lib/i18n/es.ts apps/web/app/lib/i18n/en.ts apps/web/app/lib/i18n/fr.ts apps/web/app/lib/i18n/hi.ts && npm run format:check`
Expected: PASS — 7 tests en `i18n.test.ts` (incluido el de paridad, que ahora cuenta 566 claves por idioma: 539 + 31 − 4), typecheck sin errores y lint sin warnings nuevos. Si el typecheck se queja de un import sin uso, es `AlephSeatView`, `Criatura`, `chipDeAsiento` o `estadoDeAsiento`: se van con `SeatRow`.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/aleph/[roomId]/page.tsx" apps/web/app/lib/i18n/es.ts apps/web/app/lib/i18n/en.ts apps/web/app/lib/i18n/fr.ts apps/web/app/lib/i18n/hi.ts apps/web/test/i18n.test.ts
git commit -m "feat(web): la sala de Aleph monta la escena y suelta lo que quedó duplicado

Entran <Escena> y <Liquidacion>; salen los tres Money del encabezado, la
ventana ASIENTOS con su SeatRow, la línea de etapa y el contador provisorio de
PR1 — todo eso vive ahora adentro de la escena, con las mismas claves. La
página calcula el destello comparando la vista nueva con la anterior y se lo
pasa igual a la escena y a la terminal, pide el registro firmado una sola vez
al liquidar y suma la rama de lobby al reloj.
Las cuatro claves de i18n que quedaron huérfanas se borran de los 4 idiomas.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: cierre — `npm run check`, la build y la verificación visual

**Files:** ninguno (salvo los arreglos que salgan de mirar).

**Interfaces:**

- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: La suite entera**

Run: `npm run check`
Expected: PASS — `typecheck` (web, server, mcp, packages), `lint` (0 errores; el único warning es el preexistente de `apps/web/app/game/[gameId]/match/page.tsx:265`, ajeno a esta rama), `format:check`, `test` (con `aleph-escena.test.ts` en 15, `aleph-criatura.test.ts` en 13 —uno menos que en `main`—, `aleph-secretos.test.ts` en 5 e `i18n.test.ts` en 7: **40 entre los cuatro**) y `selftest`.

- [ ] **Step 2: La build de la web**

Run: `npm run build --workspace apps/web`
Expected: PASS, sin warnings nuevos.

- [ ] **Step 3: Levantar el árbitro local y la web contra él**

**La web local contra Render NO sirve para esto**: el árbitro no manda `Access-Control-Allow-Origin` a `localhost`, así que la sala no carga. Va el árbitro local, que rellena las mesas gratis con los asientos de la casa y las juega solo. La receta está probada; los tiempos están acelerados para no esperar 40 minutos por una sala liquidada.

Terminal 1, el árbitro (sin `REQUIRE_AUTH`, con la clave #1 de anvil que usa `offline-env.ts`):

```bash
ARBITER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
ALEPH_LOBBY_MS=120000 ALEPH_HOUSE_FILL_LEAD_MS=115000 ALEPH_PHASE_MS=90000 \
ALEPH_TICK_MS=3000 ALEPH_HOUSE_TICK_MS=3000 \
RL_MAX=100000 RL_MAX_EXPENSIVE=100000 RL_MAX_LIVE=100000 \
npm run server
```

Expected: el log del árbitro arriba, escuchando en el 4000.

Terminal 2, la web apuntando ahí:

```bash
NEXT_PUBLIC_ARBITER_URL=http://localhost:4000 npm run dev --workspace apps/web
```

Expected: `Ready in …` y la web en `http://localhost:3000`.

Terminal 3, **dos agentes de prueba**. Sin ellos no hay nada que mirar: el relleno de la casa solo se dispara si ya hay al menos un agente de verdad sentado (`apps/server/src/aleph-house.ts:233`), así que sin esto la mesa no se arma; y la casa solo manda `say` (`aleph-house.ts:149`), así que sin esto **no hay un solo susurro** y el fundido `aleph-desclasifica` queda sin verificar. Guardar este archivo **fuera del repo**, en `/tmp/aleph-bots.mjs`:

```js
// DOS AGENTES DE PRUEBA contra el árbitro LOCAL. Hacen las dos cosas que la
// casa sola no hace: disparan el relleno (el lobby solo se rellena si ya hay
// al menos un agente de VERDAD sentado, `apps/server/src/aleph-house.ts:233`)
// y se SUSURRAN entre ellos, que es lo único que produce mensajes con `to` —la
// casa solo manda `say`, `aleph-house.ts:149`— y por lo tanto lo único que
// puede mostrar el fundido `aleph-desclasifica`.
//
// Va por HTTP pelado, sin SDK y sin firmas: en dev `REQUIRE_AUTH` no está
// seteado y `AUTH_REQUIRED` sale false (`apps/server/src/matchmaking.ts:185`),
// así que `/aleph/join` y `/aleph/:id/act` aceptan `{ address, ... }` a secas.
const BASE = "http://localhost:4000";
const AGENTES = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
];

const pedir = async (url, cuerpo) => {
  const r = await fetch(url, {
    method: cuerpo ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  });
  return r.json();
};

const vista = (agente, sala) => pedir(`${BASE}/aleph/${sala}?address=${agente}`);
const actuar = (agente, sala, stage, phase, action) =>
  pedir(`${BASE}/aleph/${sala}/act`, { address: agente, stage, phase, action });

const sentarse = async (agente) => {
  const r = await pedir(`${BASE}/aleph/join`, { stake: 0, address: agente });
  if (r.error) throw new Error(`join ${agente}: ${r.error}`);
  return r.roomId;
};

// Una decisión LEGAL para cada tipo de etapa. Aporta y NO acepta la Oferta a
// propósito: una mesa donde nadie acepta llega hasta la Final, que es el único
// caso en que se puede mirar `aleph-revela`.
function decidir(v, yo) {
  const st = v.stage;
  const otros = v.seats.filter((s) => s.status === "alive" && s.address !== yo);
  switch (st.kind) {
    case "share":
      return { type: "contribute" };
    case "offer":
      return { type: "decline" };
    case "vote":
      return otros.length ? { type: "vote", target: otros[0].address } : undefined;
    case "lock":
      return { type: "submit", code: "0".repeat(st.codeLength ?? otros.length + 1), intent: "all" };
    case "final":
      return { type: "split" };
    default:
      return undefined;
  }
}

const salas = [];
for (const agente of AGENTES) salas.push(await sentarse(agente));
console.log("sentados en", salas);
const sala = salas[0];

const hablaron = new Set();
const decidieron = new Set();
for (let vuelta = 0; vuelta < 600; vuelta++) {
  const publica = await pedir(`${BASE}/aleph/${sala}`);
  if (!publica.stage) {
    console.log("estado:", publica.status ?? publica.error);
    if (publica.status === "settled" || publica.status === "dissolved") break;
    await new Promise((r) => setTimeout(r, 1000));
    continue;
  }
  for (const yo of AGENTES) {
    const mia = await vista(yo, sala);
    const st = mia.stage;
    if (!st) continue;
    const clave = `${yo}|${st.index}|${st.phase}`;
    if (st.phase === "talk") {
      if (hablaron.has(clave)) continue;
      const otro = AGENTES.find((x) => x !== yo);
      const susurro = await actuar(yo, sala, st.index, st.phase, {
        type: "whisper",
        to: otro,
        text: `solo para vos: en la etapa ${st.index} te cubro si vos me cubrís`,
      });
      const enVozAlta = await actuar(yo, sala, st.index, st.phase, {
        type: "say",
        text: `etapa ${st.index}: propongo que aportemos todos`,
      });
      hablaron.add(clave);
      if (susurro.error || enVozAlta.error)
        console.log("charla", yo.slice(0, 6), susurro.error, enVozAlta.error);
    } else if (!decidieron.has(clave)) {
      const accion = decidir(mia, yo);
      if (accion) {
        const r = await actuar(yo, sala, st.index, st.phase, accion);
        if (r.error) console.log("acto", yo.slice(0, 6), accion.type, r.error);
      }
      decidieron.add(clave);
    }
  }
  const estado = await pedir(`${BASE}/aleph/${sala}`);
  process.stdout.write(
    `\r${estado.status} etapa ${estado.stage?.index ?? "-"} ${estado.stage?.phase ?? "-"}   `,
  );
  if (estado.status === "settled" || estado.status === "dissolved") {
    console.log(`\nfin: ${estado.status}`);
    break;
  }
  await new Promise((r) => setTimeout(r, 1500));
}
console.log("sala:", sala);
```

Y correrlo:

```bash
node /tmp/aleph-bots.mjs
```

Expected: imprime `sentados en [ '0x…', '0x…' ]` con **el mismo `roomId` dos veces** (si salen dos distintos, el lobby cerró entre los dos `join`: volver a correrlo), después la línea de estado que avanza etapa por etapa y al final `fin: settled`. Mientras tanto:

```bash
curl -s http://localhost:4000/aleph/lobbies
curl -s "http://localhost:4000/aleph/recent?limit=5"
curl -s "http://localhost:4000/aleph/<roomId>/log" | grep -c whisper
```

Expected: `lobbies` devuelve `{"lobbies":[…],"stakes":[0]}` con **2 asientos** al principio y **4** en cuanto la casa rellena (arranca a los 5 s con estos tiempos: `ALEPH_LOBBY_MS` − `ALEPH_HOUSE_FILL_LEAD_MS`); `recent` devuelve `{"rooms":[{"roomId":"…", …}]}` en cuanto la sala liquide; y el `log`, ya liquidada, trae **eventos `action` con `action.type === "whisper"`** (el `grep -c` tiene que dar más de 0). Abrir `http://localhost:3000/aleph/<roomId>`.

**Lo que se ve en la consola y NO es una falla:** a partir de la primera etapa de Voto la casa suele votar afuera a los dos bots, y desde ahí cada acción responde `seat not alive (voted_out)`. Da igual: los susurros de las etapas anteriores ya están en el registro, que es lo que hace falta para mirar el fundido, y la sala sigue jugándose sola hasta liquidar. Los bots **no aceptan la Oferta** a propósito (`decline`): una mesa donde nadie acepta llega hasta la Final, que es el único caso en que se puede mirar `aleph-revela`. Para conseguir la sala liquidada **SIN** Final, correrlo de nuevo y dejar que la casa sola la termine antes (o cambiar `decline` por `accept`).

- [ ] **Step 4: Mirar, a 375 px y en desktop**

Con el navegador a **375 px de ancho** y después en desktop, y en las dos una sala de **4** y una de **8**. Y en desktop, además, **una mesa de 6**: es el único tamaño que `columnasDe` manda a **tres** columnas (5 y 6 → 3; 4, 7 y 8 → 4) y el "Listo cuando" del spec nombra 4, 6 y 8. Tiene que dar tres columnas y dos filas, sin una tarjeta huérfana ni un hueco raro. Si la casa no llega a armar una mesa de 6, forzar `--cols-ancha: 3` sobre `.escena-asientos` desde el inspector y anotarlo así en el informe de cierre.

- **Una sala liquidada CON Final**: los dos finalistas arriba, grandes y enfrentados, con la olla en el medio; abajo, la grilla con los que ya salieron. La carta dice "La sala liquidó." más la línea del desenlace. El friso está completo, **sin un solo dorso** y sin carta actual. El mazo va apagado y **sin número**. No hay barra del invariante: en su lugar, la línea del reparto de la caja. Los montos y el oro de los cuerpos salen de `payouts`.
- **Una sala liquidada SIN Final** (pasa seguido: una Oferta en la que aceptan todos menos uno deja un solo vivo): no hay fila de finalistas, la carta dice "La sala terminó antes de la Final." y **no intenta ninguna línea de desenlace**; el único `finished` lleva corona.
- **Una sala en juego**: la carta con la etapa, el chip de fase, el mm:ss en dorado **moviéndose**, la regla de esa etapa en una línea y el contador subiendo. El friso con las jugadas, la actual con borde coral y los dorsos de las que faltan. La barra de tres segmentos con su marca en el 80 %, y abajo la línea que cierra la cuenta.
- **Lobby**: el mm:ss en la barra de la ventana, **moviéndose** (es la rama que suma `counting`), las criaturas de los que ya se sentaron y las sillas vacías punteadas con su dorso al 25 %. Sin mesa, sin friso, sin carta.
- **`funding`**: los asientos con su chip depositó/sin depositar, **ninguna silla vacía** y **sin reloj en la barra** (ese lo imprime el encabezado).
- **`dissolved`**: las criaturas al 34 % con el dorso puesto y el chip "la sala se disolvió", y el bloque de reembolso del encabezado intacto.
- **La ventana QUIEN_VOTO_A_QUIEN.TXT**: un grupo por etapa de Voto, una línea por voto y, debajo, la línea de los que no votaron. Si no hubo ninguna etapa de Voto, la línea del vacío.
- **Lo de abajo, intacto** (es la cuarta cláusula del "Listo cuando" del spec, y la Task 13 corta justo alrededor —`:314` y `:316`— así que hay que mirarlo): `QUE_PASO.TXT` con una entrada por etapa y sus frases, la tabla de pagos con su chip USDC/unidades, y el bloque de compromiso + semilla + enlace al registro firmado, **en ese orden** y **sin nada duplicado** entre la ventana de votos nueva y la tabla de pagos.
- **Las tres animaciones, en vivo.** Las tres hay que mirarlas con la pestaña ABIERTA mientras la sala avanza (si se abre la sala ya liquidada no se anima nada, y está bien: sin vista anterior no hay destello).
  - **La desclasificación** (`aleph-desclasifica`): en el sondeo en que la sala pasa de `playing` a `settled` **sin** Final, las líneas de susurro de la terminal entran con el fundido de 400 ms, **una sola vez** (al sondeo siguiente ya están puestas y no vuelven a entrar). Con el botón de movimiento apagado o con reduced-motion, aparecen ya puestas y **no falta una sola línea**. Si no se logró una sala que liquide sin Final **y con susurros** —depende de que la casa no vote afuera a los dos bots en la primera etapa de Voto—, forzar la clase `aleph-desclasifica` sobre un `<li class="charla-linea--susurro">` desde el inspector, mirar el fundido ahí y anotarlo así en el informe de cierre.
  - **La revelación** (`aleph-revela`): en la sala que liquida **con** Final, la fila de los dos finalistas entra con su escala. Es el caso que el orden de `destelloEntre` hace alcanzable; si no se ve, el orden se dio vuelta.
  - **La grieta** (`aleph-grieta`): en el sondeo en que cierra una Cerradura con traidor, la columna coral crece de arriba a abajo en ese cuerpo y solo en ese.
- **VoiceOver a 375 px**: cada tarjeta se anuncia **una sola vez** y completa — perfil, wallet abreviada y chip CASA/WEBHOOK incluidos. Ninguna de las dos formas de la etiqueta lleva `aria-hidden`: la esconde el `display: none` del corte, que ya la saca del árbol (desvío 15). En desktop, la misma prueba: se oye la etiqueta plana y no la angosta, sin nada repetido.
- **El botón de movimiento**: apaga la respiración de todas las criaturas, se acuerda al recargar, y el texto cambia entre PAUSAR y REANUDAR. Con el sistema en "reducir movimiento" (macOS: Accesibilidad → Pantalla → Reducir movimiento), nadie respira y **no se pierde ningún dato**: la grieta del traidor se ve entera igual.
- **Sin scroll lateral a 375 px.** Deslizar horizontalmente: no se mueve nada. Y la wallet abreviada entera al lado de cada criatura, también en una sala de la casa (sus asientos traen nombre y avatar, que es lo que hacía desaparecer la wallet cuando la etiqueta iba en un solo renglón).
- **El encabezado con la sala liquidada** no deja un bloque vacío de 40 px arriba de la escena.
- **El traidor votado, de cerca** (a 64 px en desktop): la columna coral de la grieta le tapa la mitad derecha del píxel central del dorso. Es cosmético, la marca va arriba a propósito y el ledger de PR1 lo dejó anotado para mirarlo justo acá. Si a este tamaño molesta, se anota; no se arregla en esta pasada.

- [ ] **Step 5: Arreglar lo que aparezca y cerrar**

Cualquier arreglo va con su propio commit (`fix(web): …`) y vuelve a pasar `npm run check`.

**Acá termina el plan.** No se hace `git push` ni se abre el PR: los pide el controlador con OK del dueño, y **el merge a `main` lo hace el dueño desde GitHub** (en modo auto, `gh pr merge` queda bloqueado como "Production Deploy").

---

### Task 15 (opcional): el probador `/aleph/criatura`

**Lo primero que se cae si falta tiempo**, y lo único de PR2 que se puede cortar sin que falte nada. Sirve para mirar criaturas contra direcciones reales antes de congelar el catálogo.

**Files:**

- Create: `apps/web/app/aleph/criatura/page.tsx`
- Create: `apps/web/app/aleph/criatura/layout.tsx`

**Interfaces:**

- Consumes: `Criatura` (Task 10), `ESTADOS` de `nucleo/criatura` (PR1), `useT` y `pageMeta` (`apps/web/app/lib/seo.ts:140`), y las cuatro claves `aleph.probe.*` de la Task 5.
- Produces: nada.

**Nota sobre el test:** sin test. La ruta no se enlaza desde ninguna navegación, no entra en el `sitemap.ts` y no hace falta tocar `proxy.ts` (su `matcher` es genérico) ni el test de `lang-routing`. La compuerta es `typecheck` + `lint` + `build`.

- [ ] **Step 1: El layout con `noindex`**

Crear `apps/web/app/aleph/criatura/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { pageMeta } from "@/app/lib/seo";

// El probador no se enlaza desde ninguna navegación y no entra en el sitemap:
// sirve para mirar criaturas contra direcciones reales antes de congelar el
// catálogo. Por eso va con noindex, que es lo que lo distingue de /aleph.
export const metadata: Metadata = {
  ...pageMeta({
    title: "Aleph creature probe",
    description: "Paste an address and see the creature it produces. Not linked from anywhere.",
    path: "/aleph/criatura",
  }),
  robots: { index: false, follow: false },
};

export default function ProbadorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

- [ ] **Step 2: La página**

Crear `apps/web/app/aleph/criatura/page.tsx`:

```tsx
"use client";

// EL PROBADOR DE CRIATURAS. Un input, la criatura a 128 px y los ocho estados
// en fila. Acepta `?address=0x…` para poder compartir un enlace.
//
// El query se lee de `window.location.search` adentro de un useEffect y NO con
// `useSearchParams()`. NO es por la build: el layout raíz lee `headers()` y
// `cookies()` (`app/layout.tsx:11` y `:145`, `lib/serverLang.ts:10` y `:14`,
// `components/SeoAlternates.tsx:10`), así que TODA ruta de `app/` sale
// dinámica —de ahí la ƒ— y el error de "suspense boundary" no se puede
// disparar; `app/games/_shared/ui.tsx:98` usa `useSearchParams` sin un solo
// <Suspense> alrededor y la build pasa. Es que el probador necesita el query
// UNA vez, al montar, y leerlo del window deja el componente sin depender de
// `next/navigation`.

import { useEffect, useState } from "react";
import { useT } from "@/app/lib/i18n";
import { Criatura } from "@/app/components/aleph/Criatura";
import { ESTADOS } from "@/app/components/aleph/nucleo/criatura";

export default function ProbadorDeCriaturas() {
  const { t } = useT();
  const [address, setAddress] = useState("");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("address");
    if (q) setAddress(q);
  }, []);
  // Con una dirección que no valida se muestra el aviso Y se dibuja igual la
  // criatura desconocida, que es lo que `rasgosDe` devuelve: el probador no
  // tiene un estado de error propio ni una rama vacía.
  const valida = /^0x[0-9a-f]{40}$/.test(address.toLowerCase());
  return (
    <div className="mx-auto max-w-2xl">
      <section className="win mt-3">
        <div className="win-title win-title--cyan">
          <span>{t("aleph.probe.title")}</span>
        </div>
        <div className="p-5">
          <p className="text-sm leading-relaxed text-(--color-muted)">{t("aleph.probe.intro")}</p>
          <label className="mt-4 block text-sm text-(--color-muted-3)" htmlFor="probe-address">
            {t("aleph.probe.label")}
          </label>
          <input
            id="probe-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            spellCheck={false}
            placeholder="0x…"
            className="mt-1 w-full rounded-lg border border-(--color-border) bg-(--color-ink) px-3 py-2 font-mono text-sm text-(--color-muted-bright)"
          />
          {address !== "" && !valida && (
            <p className="mt-2 text-sm text-(--color-lose)">{t("aleph.probe.bad")}</p>
          )}
          <div className="mt-5 flex justify-center">
            {/* Sin `etiquetaA11y`: va `aria-hidden`, porque la dirección está
                escrita en el input de arriba y el nombre de cada estado, abajo. */}
            <Criatura address={address} clase="criatura--probador" />
          </div>
          <ol className="mt-6 flex flex-wrap justify-center gap-4">
            {ESTADOS.map((estado) => (
              <li key={estado} className="flex flex-col items-center gap-1">
                <Criatura address={address} estado={estado} clase="criatura--mesa" />
                <span className="font-mono text-px10 text-(--color-muted-3)">{estado}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Comprobar que compila, construye y formatea**

Run: `npm run typecheck:web && npm run lint && npx prettier --write apps/web/app/aleph/criatura/page.tsx apps/web/app/aleph/criatura/layout.tsx && npm run format:check && npm run build --workspace apps/web`
Expected: PASS. En la salida de la build, `/aleph/criatura` aparece como **ƒ (Dynamic)**, igual que todas las rutas de `app/` en este repo (las saca dinámicas el `headers()` del layout raíz) — eso NO es una falla.

- [ ] **Step 4: Mirarlo**

Abrir `http://localhost:3000/aleph/criatura?address=0x` con el dev server de la Task 14 levantado:

- con el query vacío o inválido, se ve la criatura **desconocida** (gris, sin corona ni accesorio) y el aviso;
- pegando la dirección de un asiento real de una sala reciente, se ve su criatura a 128 px y los ocho estados abajo, cada uno distinto del anterior;
- el foco del input se ve (outline coral de 2 px);
- la página **no** está enlazada desde `/aleph` ni desde ningún lado.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/aleph/criatura/page.tsx apps/web/app/aleph/criatura/layout.tsx
git commit -m "feat(web): el probador de criaturas de Aleph, con noindex

Un input, la criatura a 128px y los ocho estados en fila. Lee ?address= del
query en un useEffect y no con useSearchParams, que obliga a envolver el
componente en un <Suspense> y en apps/web/app/ no hay uno solo. Sin enlace
desde ninguna navegación y fuera del sitemap.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Pulidos de PR1 que NO entran, y por qué

La dirección pidió repasar el ledger de PR1 (`.claude/sdd-ledgers/2026-09-20-aleph-etapa5-pr1.md`) y decidir uno por uno. Los que entran están arriba, cada uno en la tarea que toca su archivo: la regla "payouts antes que pocket" en un solo lugar (`bolsilloDe`, Task 2), el `estadoDeAsiento` que corría dos veces por asiento (Task 2), el `animationDelay` con ruido de punto flotante (Task 10), la franja `hw >= 4` que no cubría el índice 2 (Task 1, en el test, en el docstring de `SILUETAS` y en el spec), los dos guardas numéricos de `filasDoradas`/`nodosDe` (Task 1), el `case "base"` explícito con chequeo de exhaustividad en `capaDeEstado` (Task 1), la mudanza del test 13 al archivo de la escena (Task 1) y el `aleph.chat.empty` de una sala liquidada sin mensajes (Task 12). Estos quedan afuera:

- **La paridad entre `Criatura.tsx` y `svgDeCriatura`, y el mapeo del serializador, siguen sin test.** La revisión lo difirió con la idea de que "cuando PR2 estrene el probador, esto pasa a importar". No pasa: el probador de la Task 15 dibuja `<Criatura>`, no el string, así que `svgDeCriatura` sigue siendo solo de los tests. Cuando algo en producción consuma el string —una imagen para compartir, un `data:image/svg+xml`—, ahí entra, junto con el `xmlns` que le falta.
- **El `xmlns` de `svgDeCriatura`**, por lo mismo: hoy el string solo se usa con `innerHTML` adentro de un test.
- **`nodosDe` sigue partiendo cabeza y cuerpo por `n.y` y no por `n.y + n.h`.** Es hipotético: haría falta un overlay de cabeza que arranque en `y = 2` con altura 2, y hoy no existe ninguno; PR2 no agrega overlays.
- **El `<rect>` muerto cuando hay oro**: la fila del cuerpo del índice del borde queda tapada entera por el rect de ink de la regla D. Es un nodo de más por criatura sobre un tope de 40 que hoy cierra en 39, y sacarlo obliga a tocar el orden de dibujo de `capaDeIdentidad`, que es lo que más tests tiene.
- **`charla.ts:37` sigue filtrando el susurro por truthiness (`m.to`) y no por `!== undefined`**, y sigue sin test de que en vivo, con mensajes de varias etapas, no salga ningún separador. PR2 no toca `charla.ts`: su modelo quedó cerrado en PR1 y meterle mano acá agranda el diff sin cambiar un píxel.
- **Los huecos de test de `estados.ts`** (el `igual()` case-insensitive sin fixture que lo ejercite, el filtro `kind === "lock"` de `traidor` sin mutante que lo cace, las 14 claves de `chipDeAsiento` sin atar a los diccionarios, el `casos[3][2]` por índice posicional) y **la falta de un test que fije "hindi en devanagari"**. PR2 no los agranda, y el test nuevo de la Task 5 sí ata las 31 claves nuevas a los cuatro diccionarios. Son deuda de test, no de comportamiento.
- **Los dos `{linea.susurro && …}` seguidos de `Charla.tsx`.** Es gusto puro: unirlos en un solo guard con fragmento no le cambia nada al lector, y PR2 ya le toca a ese archivo el import de `Destello`, la prop, el fundido de la línea de susurro y el vacío de la terminal — cuatro cosas que sí importan. Una quinta de gusto no entra.
- **El cableado JSX sin guarda automática** (la evidencia RED/GREEN de la página vive en la corrida a mano, no en CI). Es la misma restricción de siempre: el repo no tiene harness de DOM, y montar uno es una decisión de infraestructura que no entra adentro de un PR visual.
- **El ruido que deja `next dev`** (`apps/web/AGENTS.md`, `apps/web/CLAUDE.md`, `next-env.d.ts` sin ignorar) y las frases del informe de PR1. No son de esta rama.

---

## Self-review (hecho al escribir el plan)

- **Cobertura del spec (PR2 — la escena completa).** Los once ítems de "Etapas de construcción → PR2" apuntan a una tarea: `escena.ts` → Tasks 2 y 3; `Escena.tsx` → Task 11; `Mesa.tsx` → Task 9; `Objetos.tsx` → Task 7; `CartaEtapa.tsx` y `Friso.tsx` → Task 8; `Asientos.tsx` → Task 10; la grilla en sus dos formas, las sillas vacías y lobby/`funding`/`dissolved` → Tasks 2 (el modelo, con los tests 11 y 12), 6 (el corte de contenedor) y 10 (el marcado); los dos arreglos de la página (`mmss` a `app/lib/tiempo.ts` y la rama de `lobby` en `counting`) → Tasks 8 y 13; pozo/caja/mazo, la barra del invariante y el sacar los tres `Money`, la ventana `ASIENTOS`, `aleph.room.nowPlaying` y el contador de PR1 → Tasks 9 y 13; la carta de etapa con la regla en una línea y el friso → Task 8; la Final con los dos finalistas más grandes y la revelación simultánea → Tasks 2 (finalistas), 6 (`criatura--final` y `aleph-revela`) y 10 (la fila y la clase); la liquidación con `Liquidacion.tsx` —que recibe UNA sola prop de etapas y no las dos del spec (desvío 17)—, el oro y los montos desde `payouts`, el friso sin dorsos y la carta de cierre → Tasks 2, 3, 12 y 13; las tres animaciones **se definen, se calculan Y se aplican**, cada una en un elemento distinto: `aleph-grieta` en el `<g>` de la grieta de `Criatura.tsx` (Tasks 1, 6 y 10), `aleph-revela` en el `<ol className="escena-final">` de `Asientos.tsx` (Tasks 6 y 10) y `aleph-desclasifica` en cada `<li>` de susurro de `Charla.tsx` (Tasks 6 y 12); las tres salen del mismo `destelloEntre` de la Task 13 (m), cuyo ORDEN es lo que hace que `revela` sea alcanzable (desvío 11), y la página le pasa el mismo `destello` a la escena y a la terminal (Task 13, (j) y (j bis)). El botón y `movimiento.ts` → Tasks 4, 11 y 13, y la Task 14 Step 4 mira las tres en vivo. Las 31 claves con el borrado de las 4 huérfanas → Tasks 5 y 13; `aleph-escena.test.ts` completo (10 a 16) → Tasks 1 a 4; el probador con su `noindex` → Task 15. El "Listo cuando" está en la Task 14, punto por punto, y su cuarta cláusula —el relato en texto, la tabla de pagos, el compromiso, la semilla y el enlace al registro firmado **donde estaban**— es el punto "Lo de abajo, intacto" del Step 4, que es justo por donde corta la Task 13 (`:314`/`:316`). Los siete agregados de la dirección también: la insignia `+{n}` con `!r.voided` y sin insignia si no hay `eachGot` (Task 2, con su test); `bolsilloDe` en un solo lugar (Task 2); los pulidos diferidos de PR1 (repartidos, con la lista de los que no entran arriba); `aleph.chat.empty` en una sala liquidada (Task 12); el probador como última tarea opcional (Task 15); las cuatro claves huérfanas borradas en la misma tarea que saca sus bloques (Task 13); y `mmss()` mudado más la rama de `lobby` en `counting` (Tasks 8 y 13). **Huecos conocidos, a propósito**: (a) los componentes no llevan test de render, porque el repo no tiene harness de DOM y el spec lo pide así — cada tarea de componente lo dice en su "Nota sobre el test"; (b) el CSS tampoco, y su compuerta es la build más la verificación visual de la Task 14; (c) los pulidos de PR1 que quedan afuera están enumerados arriba con su razón; (d) nada de "Más adelante" se coló: no hay perfil por agente, ni imagen para compartir, ni replay, ni modo claro, ni `noindex` de la sala, ni `feeBps` en la vista, y no se toca `apps/server` ni `packages/*`.
- **Scan de placeholders.** Ningún "TBD", "TODO", "implementar después" ni "similar a la tarea N": los píxeles de los objetos van con sus coordenadas exactas, las 31 claves con sus cuatro traducciones escritas de verdad (el hindi en devanagari, sin una sola secuencia backslash-u), el CSS entero con sus dos puntos de inserción anclados por texto, y cada Step de código lleva su bloque completo. **Ni una elipsis**: las tres ramas del encabezado de la Task 13 (i) —lobby, funding y dissolved— están escritas verbatim, con la de `dissolved` ya de-indentada dos espacios y sin su fragmento `<>…</>`, que es lo único que cambia adentro. El único Step que nombraba una acción sin bloque —"dos agentes de prueba por HTTP que susurran" de la Task 14— ahora trae el guion entero (`/tmp/aleph-bots.mjs`, 112 líneas, `node --check` y prettier en verde, adaptado del que se corrió de verdad contra el árbitro local). Los únicos valores que solo existen al ejecutar son el `roomId` de la Task 14 —que sale de ese guion y de los `curl`, los tres con su `Expected:` y la forma del JSON— y las direcciones de una sala real en el Step 4 de la Task 15.
- **Consistencia de tipos y nombres entre tareas.** `SalaDeAleph`, `AsientoDeSala` y `ResultadoDeEtapa` se declaran una sola vez, en `estados.ts`, y los ensancha la Task 2; `AlephRoomView` y `StageResult` del agent-sdk encajan por estructura, sin un solo cast (comprobado compilando el cableado de la página contra los tipos reales del paquete). `Estado` sigue siendo el de `criatura.ts`, con los ocho mismos identificadores. `Traductor`, `Destello` y `EtiquetaDeAsiento` se declaran en `escena.ts` (Task 2) y los importan `Asientos` (10), `Escena` (11), `Liquidacion` (12), `Charla` (12) y la página (13), siempre con la misma firma. `ModeloDeEscena` lo produce la Task 2 y lo consumen las Tasks 10 y 11. `EventoDeRegistro` lo declara la Task 3 y lo consumen la Task 12 y la página, que le pasa `AlephLog["events"]` tal cual. `etiquetaDe: (seat: AsientoDeSala) => EtiquetaDeAsiento` tiene la misma firma en las Tasks 10, 11 y 13 — anotada con `AsientoDeSala` y no con `AlephSeatView` a propósito: con `strictFunctionTypes`, una función que pide el tipo más ancho no es asignable donde se espera el más angosto. `nodosDeGrieta(estado)` se define en la Task 1, la prueba el test "3 bis" de esa misma tarea y la consume `Criatura.tsx` en la Task 10. `mmss(ms)` se crea en la Task 8 y la consumen `CartaEtapa` (8), `Escena` (11) y la página (13). Las 31 claves de la Task 5 son exactamente las que usan las Tasks 8 a 13 y 15, con los mismos nombres y las mismas variables.
- **Qué se corrió de verdad al escribir el plan (y de nuevo al corregirlo).** El código de `escena.ts` y `movimiento.ts`, los guardas de `criatura.ts` y los quince tests de `aleph-escena.test.ts` se extrajeron a copias fuera del repo, junto a los módulos reales de PR1, y se corrieron con `node --import tsx --test`: **15 pass / 0 fail** en `aleph-escena`, y **40 pass / 0 fail** contando los otros tres archivos (`aleph-criatura` 13, `aleph-secretos` 5, `i18n` 7). `tsc --noEmit` con el mismo `tsconfig` de `apps/web` en exit 0 —incluidos los `.tsx` nuevos y el `page.tsx` resultante—, `eslint` sin un solo error y `next build` en exit 0. Los dos guardas y `nodosDeGrieta` se comprobaron también en ROJO contra el `criatura.ts` de `main`, y los mensajes de falla que están escritos en la Task 1 Step 2 y en la Task 3 Step 2 son los que imprimió esa corrida (forma CJS: el repo no declara `"type": "module"` y `tsx` transpila a CommonJS, así que un export que falta da `TypeError`, no `SyntaxError`, y no voltea el resto del archivo). `destelloEntre` se barrió aparte contra las cuatro transiciones que importan —Final que cierra, liquidación sin Final, Cerradura con traidor y re-sondeo sin novedad— y devuelve `revela`, `desclasifica`, `grieta` y `null`. Los siete componentes nuevos, más los retoques de `Criatura.tsx` y `Charla.tsx` y el cableado de la página, compilan contra los tipos reales de `@arcade1v1/agent-sdk` y pasan prettier. Los píxeles de `Objetos.tsx` se verificaron con un script: los once dibujos entran en su grilla (16×16 la olla, las tres tapas del cofre y el mazo; 8×6 el dorso; 8×8 los cinco glifos) y ninguno pasa de 4 rects. Y las 31 claves se aplicaron a copias de los cuatro diccionarios reales: paridad en verde, las siete con variable conservan sus variables en los cuatro idiomas, las cuatro huérfanas desaparecen y prettier no mueve una línea. En la ronda 2 se rearmó el árbol entero desde `main` con los bloques ya corregidos —el efecto de reset de `roomId`, el `limpiar` que deja de tapar al traductor de `useT()` y el comentario de `i18n.test.ts:110`— y se volvió a correr: `tsc --noEmit -p apps/web/tsconfig.json` en exit 0, `eslint apps/web` con 0 errores (el único warning es el preexistente de `match/page.tsx:265`) y `prettier --check` limpio sobre el `page.tsx` resultante, los siete componentes, `lib/tiempo.ts`, el probador y el test de i18n. También se comprobó a mano lo que dice el Step 3 de la Task 13 sobre las líneas en blanco: dejarlas hace fallar `prettier --check`, y el `--write` del Step 5 las junta.
