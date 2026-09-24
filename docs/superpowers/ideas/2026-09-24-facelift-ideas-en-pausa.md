# Ideas del facelift — en pausa

Fecha: 2026-09-24
Estado: **en pausa**. Salieron de la auditoría visual que dio lugar al facelift
(enmienda 2026-09-24 del spec `2026-07-03-rediseno-profesional-ui-design.md`).
Al usuario le gustaron, pero quiere ajustarlas antes de decidir. No son
compromisos del roadmap, y ninguna se implementó.

Las cuatro cambian lo que el sitio HACE, no solo cómo se ve. Por eso quedaron
fuera del facelift.

## 1. Ticker con resultados reales

**Qué.** La marquesina deja de repetir los slogans que la página ya dice y
muestra las últimas partidas decididas: "0x3f…a1 le ganó a CASA en SNAKE ·
1.532 ELO · +12".

**Por qué encaja.** La promesa del sitio es "números reales, sin contadores
inventados" (lo dice `/status`). Un ticker de datos verificables es lo opuesto
a una plantilla: nadie lo puede generar.

**Qué ya existe.** `GET /matches/recent` (lo usa `/watch`) y el componente
`Marquee`, que ya separa frases con el rombo pixel.

**A decidir.** Qué pasa cuando hay pocas partidas (¿se mezclan con los
slogans?), cada cuánto se refresca y si las partidas de la casa entran o no.

## 2. Modo "attract" en el hero

**Qué.** Junto al título, un replay real de la última partida del #1 del
ranking, en loop, como los arcades cuando nadie juega.

**Por qué encaja.** Muestra el producto en la primera pantalla (hoy el hero es
solo texto) y a la vez prueba lo de "verificado por replay": el replay corre
con el mismo motor que usa el árbitro.

**Qué ya existe.** `ReplayPlayer`, `GET /match/:id/replay` y el ranking por
juego.

**A decidir.** Qué juego se muestra (¿rota?), cuánto pesa cargar el motor en
la home y cómo se ve en el celular sin empujar los CTA para abajo.

## 3. Una criatura para cada wallet

**Qué.** El generador de criaturas de Aleph (`svgDeCriatura`, derivado de la
dirección) como avatar de cada wallet en el ranking, el espectador y "Mis
agentes", en vez de `0x12…ab`.

**Por qué encaja.** Da identidad sin pedir nada al usuario, y es algo que
ningún otro sitio tiene. La criatura sale de la dirección y no cambia nunca.

**Qué ya existe.** Todo el generador (`components/aleph/nucleo/criatura.ts`),
con tests.

**A decidir.** Convivencia con los avatares emoji que eligen los dueños de
agentes (¿la criatura solo para humanos sin perfil?) y el tamaño mínimo en
una fila de ranking.

## 4. Números de marcador = verificado

**Qué.** Los números que firmó el árbitro (ELO, puntajes, premios) van en un
estilo de marcador propio (la pixel en oro, o un dot-matrix tipo LED). Si un
número está en ese estilo, lo verificó el árbitro.

**Por qué encaja.** Convierte la tipografía en una señal de confianza,
coherente con el anti-trampa, que es el corazón del producto.

**Qué ya existe.** La escala de la pixel (`text-px8/16/24/32`) y el oro como
color de "dinero / premios".

**A decidir.** La regla exacta (qué números entran y cuáles no) y si hace
falta una segunda fuente para el LED o alcanza con la pixel.
