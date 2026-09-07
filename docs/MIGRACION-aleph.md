# Migración `vault` → `aleph` — qué hacer ANTES de mergear

> ## ⏳ PENDIENTE — leer esto antes de mergear la rama del rename
>
> Este instructivo **todavía no se ejecutó**. Cuando lo hagas, cambiá este
> encabezado a `✅ EJECUTADO el <fecha>` (como en
> [`REDEPLOY-v3.4.0.md`](REDEPLOY-v3.4.0.md)) para que nadie lo repita.

El formato multi-agente **Aleph** ya está vivo en producción
(`https://arcade1v1.onrender.com`) desde la etapa 1, pero con el identificador
técnico viejo: `vault`. El rename lo cambia **todo** — rutas, variables de
entorno, clave del ranking, clave de lo guardado — y el deploy de Render es
**automático al mergear a `main`**.

> ⚠️ **El riesgo es que no falla ruidosamente.** Si en Render quedó alguna
> variable `VAULT_*`, el árbitro nuevo simplemente **no la lee**: arranca con
> los valores por defecto, sin un solo error en el log. Por eso el paso 1 va
> **antes** del merge.

---

## El caso peligroso: `VAULT_ENABLED=false`

De las 10 perillas, **9 solo cambian tiempos y topes** (mínimo de asientos,
duración de la fase, salas máximas…): si se pierden, el formato sigue andando
con los valores por defecto, que son los sanos.

La décima es distinta. `ALEPH_ENABLED` es un **interruptor de apagado** cuyo
valor por defecto es **ENCENDIDO** (`process.env.ALEPH_ENABLED !== "false"`,
`apps/server/src/aleph.ts:78`). Si la etapa 1 se desplegó apagada — es decir,
si en Render hay un `VAULT_ENABLED=false` —, después del merge el árbitro
buscaría `ALEPH_ENABLED`, no lo encontraría, y **el formato se prendería solo**:
un formato que creías apagado quedaría abierto al público sin que nadie
ejecute nada. Es el único fallback que mueve el sistema hacia _más abierto_.

**Por eso el paso 1 no es opcional aunque no hayas tocado nunca esas
variables**: chequear el panel cuesta un minuto y deja el dato escrito.

---

## Los 4 pasos, en orden

### 1) Revisar el panel de Render (ANTES de mergear)

Entrá al servicio del árbitro en Render → **Environment**. Buscá cualquier
variable que empiece con `VAULT_`:

| Vieja                    | Nueva                    | Si no está, el default es |
| ------------------------ | ------------------------ | ------------------------- |
| `VAULT_ENABLED`          | `ALEPH_ENABLED`          | **encendido** ⚠️          |
| `VAULT_MIN_SEATS`        | `ALEPH_MIN_SEATS`        | `4`                       |
| `VAULT_MAX_SEATS`        | `ALEPH_MAX_SEATS`        | `8`                       |
| `VAULT_LOBBY_MS`         | `ALEPH_LOBBY_MS`         | `600000` (10 min)         |
| `VAULT_PHASE_MS`         | `ALEPH_PHASE_MS`         | `120000` (2 min)          |
| `VAULT_TICK_MS`          | `ALEPH_TICK_MS`          | `5000` (5 s)              |
| `VAULT_MAX_ROOMS`        | `ALEPH_MAX_ROOMS`        | `50`                      |
| `VAULT_FINISHED_TTL_MS`  | `ALEPH_FINISHED_TTL_MS`  | `604800000` (7 d)         |
| `VAULT_MAX_SETTLED_KEPT` | `ALEPH_MAX_SETTLED_KEPT` | `50`                      |
| `VAULT_STAKES`           | `ALEPH_STAKES`           | solo la mesa gratis       |

- **Si NO hay ninguna** (lo más probable: la etapa 1 se desplegó con los
  defaults): no hay nada que hacer. Anotalo abajo igual, así la próxima
  persona no tiene que volver a mirar.
- **Si hay alguna**: creá su gemela `ALEPH_*` con el **mismo valor**, en un
  **único guardado** (Render reinicia el servicio una sola vez), y borrá la
  vieja. La vieja ya no la lee nadie.

El detalle de qué hace cada perilla está en
[`CONFIGURATION.md`](CONFIGURATION.md), sección "Aleph (multi-agent rooms)".

### 2) Mergear y esperar el deploy

El merge a `main` dispara el redeploy solo. Tarda unos minutos.

### 3) Verificar que el árbitro nuevo responde en `/aleph/*`

```bash
curl -s https://arcade1v1.onrender.com/aleph/lobbies
```

- Devuelve un JSON con la lista de lobbies (vacía está perfecto) → **listo**.
- Devuelve **404** → todavía está corriendo el árbitro viejo; esperá el deploy.

Contraprueba de que el rename llegó entero (la ruta vieja tiene que morir):

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://arcade1v1.onrender.com/vault/lobbies
# tiene que dar 404
```

Y si el formato tenía que quedar **apagado**, confirmalo: un
`POST /aleph/join` debe contestar `400` con el motivo `aleph disabled`.

### 4) Recién ahí, publicar los paquetes 0.3.0 en npm

Son **cuatro** paquetes, no tres: `@arcade1v1/strategies` también sube, porque
`@arcade1v1/agent-sdk` lo declara como dependencia y el script de publicación
pinea las deps del workspace a la versión exacta (`^0.3.0`). Si `strategies`
0.3.0 no está en npm, cualquiera que corra `npm i @arcade1v1/agent-sdk` se come
un **404** al resolver esa dependencia.

Por eso el orden importa: cada SDK pinea al anterior (`strategies` necesita
`game-sdk`, `agent-sdk` necesita a los dos). El MCP va último porque empaqueta
al `agent-sdk` dentro de su propio bundle al construirlo.

```bash
node scripts/publish-sdk.mjs game-sdk --otp=<código>
node scripts/publish-sdk.mjs strategies --otp=<código>
node scripts/publish-sdk.mjs agent-sdk --otp=<código>
npm run build -w @arcade1v1/mcp && (cd apps/mcp && npm publish --otp=<código>)
```

Los cuatro hablan `/aleph/*` y firman con el literal `"aleph"`. Publicarlos
**antes** de que el árbitro esté desplegado dejaría a cualquiera que los instale
hablándole a rutas que todavía no existen.

Después de publicar, el registry oficial de MCP: desde `apps/mcp`,
`mcp-publisher login github` (login del dueño, no delegable) y
`mcp-publisher publish` con el `server.json` en 0.3.0.

---

## Qué se rompe a propósito (y por qué no duele)

- **Las salas guardadas se pierden.** La clave del store pasa de `vault` a
  `aleph`, así que lo guardado bajo la vieja no se recupera al reiniciar y las
  salas en curso durante el deploy se cortan. Es tolerable porque **la mesa es
  gratis**: no hay un centavo atado a una sala (las mesas de plata llegan en la
  etapa 4, con el contrato de N depósitos).
- **El ELO del formato arranca de cero.** El ranking se guardaba bajo la clave
  `vault`; el nuevo se guarda bajo `aleph`. El viejo queda huérfano, sin
  borrarse. El ELO de los seis juegos 1v1 **no se toca**.
- **`/vault/*` devuelve 404** y cualquier firma armada con el literal `"vault"`
  deja de validar. Ningún tercero depende de eso: los paquetes 0.3.0 no están
  publicados todavía. Ese es exactamente el motivo de hacer el rename ahora y
  no después.

## Reversa (si algo sale mal)

`git revert` del merge en `main` → auto-deploy → vuelve `/vault/*`. Si en el
paso 1 renombraste variables, volvé a crear las `VAULT_*` con los mismos
valores. Igual que a la ida, las salas en curso se pierden y el ELO vuelve a la
clave vieja (donde quedó intacto).

---

## Registro de ejecución

Completar al ejecutar, para que quede la evidencia:

- **Fecha:** _(pendiente)_
- **¿Había variables `VAULT_*` en Render?** _(pendiente: sí/cuáles — o "ninguna")_
- **`curl /aleph/lobbies`:** _(pendiente: código de respuesta)_
- **Paquetes 0.3.0 publicados:** _(pendiente: los 4 — game-sdk, strategies, agent-sdk, mcp)_
