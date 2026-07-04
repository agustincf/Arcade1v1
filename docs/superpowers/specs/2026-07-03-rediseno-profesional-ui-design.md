# Rediseño profesional de la UI — "Arcade editorial"

Fecha: 2026-07-03
Estado: aprobado por delegación (el usuario pidió "te encargás de diseñar algo mejorado y aplicar tu trabajo a todo el flujo del usuario").

## Problema

La estética actual se percibe amateur. Diagnóstico concreto:

1. **Seis colores saturados compitiendo** (magenta, cyan, lima, dorado, verde, rojo) sin roles asignados: todo grita, nada ordena.
2. **Glow neón en casi todos los títulos**: el efecto pierde valor y ensucia la lectura.
3. **VT323 como tipografía de cuerpo**: fuente de "pantalla CRT" usada para párrafos enteros; difícil de leer y el mayor responsable del aspecto de juguete.
4. **Fondo recargado**: dos radiales neón + grilla + scanlines superpuestas bajan el contraste real del texto.
5. **Biseles pesados** (doble inset + gradiente + anillo magenta) en cada caja y botón.
6. **Emojis como iconografía funcional** (💰 🟢 👥 🏆) en header, chips y tablas.
7. **Sin ritmo de secciones**: toda la página es la misma ventana violeta repetida.

## Dirección: "Arcade editorial"

Combinar tres fuentes, cada una aporta algo puntual:

- **Del retro actual (identidad, se conserva):** tipografía pixel (Press Start 2P) en momentos de identidad (logo, títulos de página, marcadores, botones), el concepto de "ventana" con barra de título, botones con sensación "apretable", el ticker.
- **De la estética Claude/Anthropic (calidez, calma):** paleta cálida — marfil/crema para el texto, coral/terracota como acento primario — y generosidad de espacio en blanco.
- **De btcpolicy.org (contraste, legibilidad):** bloques de secciones alternados (zonas de juego oscuras vs. paneles claros "de papel" para lectura), jerarquía tipográfica clara, una sola familia sans legible para el cuerpo.

## Tokens (globals.css)

Se conservan los NOMBRES de las variables (así el 90 % de la app se re-tematiza sola). Cambian los valores:

| Token                          | Antes                  | Ahora                            | Rol                     |
| ------------------------------ | ---------------------- | -------------------------------- | ----------------------- |
| `--color-bg`                   | `#140a2e` violeta      | `#15111b` ciruela-tinta profundo | fondo de página         |
| `--color-surface`              | `#241a44`              | `#1f1a29`                        | tarjetas                |
| `--color-surface-2`            | `#2f2358`              | `#292236`                        | elevación 2             |
| `--color-border`               | `#4b3b80`              | `#3a3150`                        | bordes                  |
| `--color-accent`               | `#ff3df0` magenta neón | `#e8845e` coral                  | acción primaria / marca |
| `--color-accent-2`             | `#27e8ff` cyan neón    | `#6cc9da` cyan calmo             | info / secundario       |
| `--color-gold`                 | `#ffd23d`              | `#f2c14e`                        | dinero / premios        |
| `--color-lime`                 | `#b6ff3d`              | `#b8e08a`                        | estado "vivo"           |
| `--color-text`                 | `#efeaff`              | `#f0ece1` marfil                 | texto base              |
| `--color-win` / `--color-lose` | neón                   | `#5fd68a` / `#f0716f`            | resultado               |
| muted 1-3                      | grises violáceos       | cremas apagadas                  | texto secundario        |

Nuevos tokens **paper** (bloques claros estilo btcpolicy/Claude): `--color-paper #f0eee6`, `--color-paper-2 #e7e3d7`, `--color-paper-border #d8d2c2`, `--color-paper-ink #221d26`, `--color-paper-muted #5c554d`.

## Tipografía

- **Press Start 2P**: solo identidad — logo, h1 de página, títulos de ventana, cifras de marcador, botones. Nunca párrafos.
- **Inter** (nueva, reemplaza a VT323 y Tahoma): todo el cuerpo. La clase existente `.font-screen` pasa a mapear a Inter, con lo cual todos los párrafos del sitio se vuelven legibles sin tocar su markup.
- VT323 se elimina del `<link>` de fuentes.
- `.neon` / `.neon-cyan` quedan casi sin glow (sombra sutil) para no editar cada uso.

## Componentes (redefinidos centralmente)

- **`.win`**: tarjeta plana — fondo surface, borde 1px, radio 10px, sombra difusa única. Sin biseles ni anillo magenta.
- **`.win-title`**: barra sobria en tinta (`--color-ink`), texto pixel 10px marfil, borde inferior 1px; la variante `--cyan` cambia solo el color del texto/acento. Sin gradientes. Los `win-dot` quedan como cuadraditos apagados (guiño retro).
- **`.btn3d`**: se mantiene pixel + "apretable", pero limpio: color pleno, borde tinta 1px, radio 6px, una sola sombra inferior dura (`0 3px 0`), sin gradientes ni text-shadow. Variantes: `--magenta` → coral (primaria), `--cyan` → outline secundaria, default → dorado (dinero).
- **`.chip`**: píldora fina — borde 1px, fondo tinta translúcido, texto pequeño en Inter.
- **`.marquee`**: ticker fino y discreto (14px, mono-espaciada no; Inter, dorado apagado sobre tinta), animación más lenta.
- **`.paper`** (nuevo): panel marfil con texto tinta para secciones de lectura ("Cómo funciona", FAQ, Términos, Agents). Es el contraste de bloques de btcpolicy.
- **Foco visible** (`:focus-visible`) con anillo coral en todo el sitio (accesibilidad).

## Fondo

Sólido con grilla ultra-sutil única. Se eliminan: radiales magenta/cyan, scanlines (`body::after`).

## Aplicación por página

- **Home**: hero más sobrio (título pixel coral sin glow fuerte, sub en Inter), tarjetas de juego con el nuevo chrome; "Cómo funciona" y FAQ pasan a paneles **paper**.
- **Header**: logo pixel coral sin glow, chip de red discreto, botón conectar coral.
- **Footer**: ordenado con borde superior, menos emojis.
- **Mesa (TableClient)**: misma estructura; selección de mesa con anillo coral; desglose del pozo igual.
- **Partida / resultado**: heredan por clases; se limpian emojis decorativos redundantes.
- **Leaderboard**: tabs de juego más livianas (secundaria/primaria), tabla igual.
- **Agents**: los bloques explicativos pasan a paper con código en tinta (estilo docs); endpoints igual.
- **Terms**: artículo dentro de panel paper.
- **Emojis**: se quitan los funcionales (💰 en chips de apuesta, 🟢/👥 de actividad, 🌐 del selector); se conservan los expresivos de resultado (🏆 💀 🤝) y el 🕹️ del logo.
- **Juegos (canvas)**: el arte interno no se toca; los overlays compartidos heredan.
- **OG image / icon**: se actualizan al coral para que la marca sea coherente al compartir.

## Fuera de alcance

- Rediseño del arte de los juegos (canvas).
- Cambios de copy/i18n salvo los mínimos que pida el markup.
- Modo claro completo (los paneles paper cumplen ese rol por sección).

## Criterio de éxito

- `npm run build` (o equivalente del monorepo) pasa.
- Recorrida visual del flujo completo: home → mesa → partida gratis → resultado → leaderboard → agents → terms, coherente en desktop y mobile.
- Menos de 3 acentos visibles por pantalla; cuerpo 100 % Inter; sin scanlines ni glows fuertes.
