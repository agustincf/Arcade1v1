# Fase 6 — i18n servido por idioma (diseño)

> Spec de diseño de la Fase 6 del milestone v3. Estructura y criterios en
> [../v3/PLAN.md](../v3/PLAN.md) (Fase 6). Protocolo en
> [../v3/OPERATIVA.md](../v3/OPERATIVA.md). Aprobada por el dueño el 2026-07-11.

## Objetivo

Que cada visitante reciba **solo su idioma** (menos peso) y que el sitio tenga
**SEO real** en español, hindi y francés (URLs propias por idioma que Google
indexa por separado).

**Hallazgo que reencuadra la fase:** el "primer render ya traducido" del objetivo
original **ya funciona** — `layout.tsx` llama `getLang()` (cookie →
Accept-Language → "en") y pasa `initialLang` al provider, así el HTML del primer
render sale en el idioma del usuario (verificado: `curl -H "Accept-Language: es"`
devuelve `<html lang="es">` y textos en español). Por eso la fase se concentra en
las **dos patas restantes**: peso y SEO por idioma.

**Medición base (para el criterio "medible"):** `i18n-dict.ts` pesa ~107 KB con
los 4 idiomas inline; hoy el cliente los descarga todos, ~86 KB crudos
(~15-25 KB gzip) de idiomas que no son el activo, por visitante.

## Decisiones de diseño (aprobadas)

- **Inglés se queda en las URLs de hoy** (`/build`), sin prefijo → no rompe lo
  indexado ni los links existentes. Los otros tres ganan prefijo: `/es/build`,
  `/hi/build`, `/fr/build`.
- **Dos etapas** para acotar el riesgo (es el refactor más grande de v3):
  1. **Aligerar** — cargar y servir solo el idioma activo. Independiente,
     publicable sola.
  2. **URLs por idioma** — ruteo, redirección por preferencia, hreflang, sitemap.
- **Los flujos on-chain no se tocan**: hablan con el árbitro por su URL absoluta,
  ajenos al prefijo de idioma.

## Etapa 1 — Aligerar (el diccionario deja de viajar entero al cliente)

**Idea central:** hoy el bundle del cliente importa `translate` desde
`i18n-dict.ts`, que trae los 4 diccionarios inline. Se invierte: el **servidor**
carga solo el diccionario del idioma activo y lo **pasa como prop** al provider;
el cliente ya no importa datos de idioma, solo la función `translate` pura (chica)
y renderiza con el diccionario recibido. El diccionario activo viaja una sola vez
en el payload del render (~20 KB), no como los 4 en el JS.

**Cambios:**

- Partir los datos en un archivo por idioma: `app/lib/i18n/en.ts`, `es.ts`,
  `hi.ts`, `fr.ts`, cada uno `export const dict: Dict = { … }` (mover los bloques
  actuales tal cual, sin re-traducir).
- [i18n-dict.ts](../../../apps/web/app/lib/i18n-dict.ts) queda con lo compartido:
  `Lang`, `LANGS`, `LANG_LABELS`, y `translate(dict: Dict, key, vars)` **puro**
  (toma un diccionario, ya no un `lang` que indexa el mapa de los 4). Sin imports
  de datos de idioma → no arrastra los 4 al cliente.
- `loadDict(lang): Promise<Dict>` — import dinámico del archivo del locale (server).
- Server: helper `getT(lang)` = `translate(await loadDict(lang), …)` para los
  Server Components que hoy usan `getLang()`
  ([terms](../../../apps/web/app/terms/page.tsx),
  [agents](../../../apps/web/app/agents/page.tsx), agents/start, unavailable).
- Provider [i18n.tsx](../../../apps/web/app/lib/i18n.tsx): recibe `dict` + `lang`
  como props (los pasa `Providers` desde `layout`), y `t(key) =
translate(dict, key, vars)`. `useT()` no cambia su interfaz pública
  (`{ t, lang, setLang }`), así ningún consumidor cliente se toca.
- `setLang` (Etapa 1): import dinámico del diccionario nuevo en el cliente, swap
  del `dict` en estado + cookie/localStorage + `<html lang>`. (En la Etapa 2 esto
  pasa a ser una navegación a la URL del idioma.)

**Completitud (habilita el aligerado con red):** hoy `translate` cae a inglés si
una clave falta. Si el cliente solo tiene el diccionario activo, una clave
faltante mostraría el nombre crudo. Se agrega un **test de completitud** (los 4
locales exponen exactamente el mismo conjunto de claves) y se **llenan los
huecos** que aparezcan. Esto además cumple el criterio "ningún idioma pierde
textos". Con completitud garantizada, servir solo el activo es seguro.

**Medición (criterio):** después de la Etapa 1, los chunks de JS del cliente
(`.next/static/chunks/*.js`) **no contienen** cadenas en devanagari (hindi) ni
los otros idiomas no activos; se reporta el delta de tamaño del bundle
(antes/después), medido, no estimado.

## Etapa 2 — URLs por idioma (SEO real)

**Esquema:** inglés en `/…` (sin prefijo, x-default); español/hindi/francés en
`/es/…`, `/hi/…`, `/fr/…`.

**Portero — [apps/web/middleware.ts](../../../apps/web/middleware.ts) (nuevo):**

- Ruta con prefijo de locale conocido (`/es`, `/hi`, `/fr`): **rewrite** a la ruta
  sin prefijo (la URL visible no cambia) seteando el header de request
  `x-lang=<locale>` para que el render sepa el idioma. Así **no hace falta mover
  el árbol de rutas** bajo un segmento `[lang]`: las páginas actuales
  (`app/build`, etc.) se reusan tal cual.
- Ruta sin prefijo: detectar idioma (cookie `arcade.lang` → `Accept-Language`).
  Si es `es/hi/fr` → **redirect 307** a `/<lang><path>` (preserva la experiencia
  de hoy: un hispanohablante cae en `/es`). Si es inglés/ninguno → pasar como
  inglés (`x-lang=en`), sirviendo `/` como x-default para los buscadores.
- Excluir `/_next`, assets, imágenes, `sitemap.xml`, `robots.txt`, `llms.txt`,
  `manifest.webmanifest` y las rutas de OG/icon (no llevan prefijo de idioma).

**Idioma en el servidor — [serverLang.ts](../../../apps/web/app/lib/serverLang.ts):**
`getLang()` lee primero el header `x-lang` (lo pone el portero), y si no está,
cae a cookie → `Accept-Language` → `"en"` (comportamiento de hoy para `/`).

**Links con idioma:** un helper `localePath(lang, path)` (prefija salvo inglés) y
un hook `useLocalePath()` en el cliente; se actualizan los `<Link href>` y
`router.push` internos para respetar el locale activo. La navegación cliente en
`/es/*` sigue dentro de `/es/*`.

**Selector de idioma —
[LanguageSelector.tsx](../../../apps/web/app/components/LanguageSelector.tsx):**
`setLang(l)` pasa a **navegar** a la versión del path actual en ese idioma
(`router.push(localePath(l, currentPath))`) y setear la cookie de preferencia; el
servidor manda el diccionario del nuevo idioma. Reemplaza el swap client-only de
la Etapa 1.

**SEO — metadata y sitemap:**

- Alternates hreflang: cada página indexable declara sus hermanas
  (`en` en `/…`, `es` en `/es/…`, `hi`, `fr`) + `x-default` = la inglesa. Se
  resuelve en `generateMetadata`/metadata del layout usando el `lang` y el path
  actual (`alternates.languages` de Next). `canonical` por locale.
- [sitemap.ts](../../../apps/web/app/sitemap.ts): cada ruta indexable × 4 locales,
  con `alternates.languages`.
- `<html lang>`: ya sale de `getLang()` (ahora header-aware), sin cambio extra.

**Medición (criterios):** `curl /es/build` → `<html lang="es">`, textos en español
y tags hreflang; `curl /build` → inglés; el sitemap incluye las URLs por idioma.

## Qué NO cambia (acotar riesgo)

- Las rutas siguen en `app/*` (el portero hace rewrite; no se mueve el árbol a un
  segmento `[lang]`).
- La interfaz de `useT()` (consumidores cliente intactos).
- Los flujos on-chain (depósitos, duelos, crear/administrar agente): la URL del
  árbitro es absoluta; el prefijo de idioma no los afecta.
- Los 4 idiomas sirven exactamente los mismos textos (test de completitud).

## Testing

**Etapa 1:**

- Completitud: los 4 locales tienen el mismo conjunto de claves (falla si a algún
  idioma le falta una).
- `translate(dict, key, vars)` puro: interpola `{vars}` y devuelve la clave cruda
  si no existe (contrato explícito).
- Bundle: un chequeo que afirme que los chunks de cliente no incluyen los
  diccionarios no activos (grep de una cadena devanagari conocida en
  `.next/static/chunks`), corrido tras `next build`.

**Etapa 2:**

- Portero (unit, sobre la función pura de decisión): `/es/x` → rewrite con
  `x-lang=es`; `/x` con cookie `es` → redirect `/es/x`; `/x` sin preferencia →
  inglés; `/_next`, `/sitemap.xml`, assets → intactos.
- `getLang()` prioriza `x-lang` sobre cookie/Accept-Language.
- E2E con `curl` contra el build local: `/build` inglés; `/es/build` español con
  `<html lang="es">` y hreflang; sitemap con las 4 variantes.

## Verificación real (no solo tests)

Levantar la web y: entrar a `/` en inglés; cambiar idioma con el selector y ver
que navega a `/es/…` y todo queda en español; entrar directo a `/hi/build` y ver
hindi; `curl` de `/build` y `/es/build` para confirmar el HTML por idioma y los
hreflang; medir el peso del bundle antes/después. En producción tras el deploy:
las mismas comprobaciones sobre `arcade1v1.com`.

## Archivos

Nuevos:

- `apps/web/app/lib/i18n/en.ts`, `es.ts`, `hi.ts`, `fr.ts` — diccionarios partidos
- `apps/web/middleware.ts` — portero de idioma (Etapa 2)
- `apps/web/app/lib/localePath.ts` — helper + hook de links con idioma (Etapa 2)
- Tests: completitud de diccionarios, decisión del portero, translate puro

Modificados:

- `apps/web/app/lib/i18n-dict.ts` — solo `Lang`/`LANGS`/`LANG_LABELS` +
  `translate(dict, …)` puro + `loadDict(lang)`; sin datos inline
- `apps/web/app/lib/i18n.tsx` — provider recibe `dict` por prop; `setLang` navega
  (Etapa 2)
- `apps/web/app/providers.tsx` y `apps/web/app/layout.tsx` — cargar y pasar el
  `dict` activo; metadata con hreflang (Etapa 2)
- `apps/web/app/lib/serverLang.ts` — `getLang()` lee `x-lang` primero (Etapa 2)
- `apps/web/app/components/LanguageSelector.tsx` — navegar al cambiar (Etapa 2)
- `apps/web/app/sitemap.ts` — variantes por idioma (Etapa 2)
- Los `<Link href>`/`router.push` internos → locale-aware (Etapa 2)
- Server Components con `getLang()` (terms, agents, agents/start, unavailable) →
  usar `getT(lang)`

## Reglas de la casa respetadas

- **4 idiomas de primera:** el test de completitud lo vuelve mecánico; nada sale
  "solo en inglés".
- **Honestidad/SEO:** hreflang y x-default correctos; nada de contenido oculto ni
  cloaking (el portero decide por preferencia real, igual para todos).
- **Cambios medibles:** peso del bundle y HTML por idioma se verifican con datos,
  no estimaciones.
- **Riesgo acotado:** dos etapas; la Etapa 1 se publica y verifica antes de tocar
  el ruteo; el inglés conserva sus URLs.
