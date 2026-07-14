<!-- generated-by: gsd-doc-writer -->
# Guía para publicar Arcade1v1

Hay **3 piezas** que se publican por separado:

1. **La web** (lo que ve el jugador) → Vercel (gratis, hecho para Next.js).
2. **El árbitro** (el backend) → un hosting de Node (Render / Railway / Fly).
3. **El contrato** → la blockchain Base Sepolia (testnet, por ahora).

> ⚠️ **Solo testnet.** No actives dinero real hasta cerrar los puntos críticos de
> [SECURITY.md](SECURITY.md) — sobre todo lo **legal** (licencias, KYC, edad, país).

---

## Paso 1 — Desplegar el contrato (Base Sepolia) — **llave en mano**

Antes de la 2da corrida hace falta completar 3 variables en
`packages/contracts/.env` (el script **no** las autogenera; si faltan, el
deploy falla):

- `ARBITER_ADDRESS` — la dirección del árbitro. Si todavía no la tenés, generá
  esa wallet ahora con `cast wallet new` (Foundry) y guardá **la clave privada**
  aparte — es la que va a `ARBITER_PRIVATE_KEY` en el Paso 2.
- `PLATFORM_WALLET` — tu wallet, la que cobra la comisión.
- `FEE_BPS=1500` — comisión en basis points (1500 = 15%, el valor que ya
  muestra la web; tope duro del contrato: 2000 = 20%).

Con eso listo, corrés el script **dos veces**:

```bash
bash packages/contracts/deploy-base-sepolia.sh
```

- **1ra corrida:** crea una wallet de deploy **descartable** (la clave queda solo en
  `packages/contracts/.env`, nunca se comparte) y te imprime su **dirección**.
  Fondeala con ETH de prueba en un **faucet de Base Sepolia** (ese paso necesita un
  humano: captcha/login).
- **2da corrida (ya con gas):** despliega un **USDC de prueba con `mint` abierto**
  (cualquiera acuña fichas gratis) + el escrow con las mesas 1/2/5/10, y te imprime
  las **variables listas para pegar** (`NEXT_PUBLIC_ESCROW_ADDRESS`,
  `NEXT_PUBLIC_USDC_ADDRESS`, `ESCROW_ADDRESS`, `CHAIN_ID`).

> Probado de punta a punta en cadena local (anvil): despliegue + mint + mesas +
> pago + reembolso. Ver `packages/contracts/check-payment-e2e.sh` y, solo para el
> script de deploy en sí, `packages/contracts/check-deploy.sh`.

## Paso 2 — Publicar el árbitro (backend)

En un hosting de Node (ej. Render), apuntando a `apps/server`:

- Build/Start: `npm install` y `npm run start -w @arcade1v1/server`.
- Variables de entorno (en los "secrets" del hosting, **no** en el código):
  - `ARBITER_PRIVATE_KEY` — la llave del árbitro (guardar como secreto). Debe ser
    la cuenta que figura como **arbiter** en el contrato (Paso 1).
  - `CHAIN_ID=84532` y `ESCROW_ADDRESS=` (las del Paso 1).
  - `RPC_URL=https://sepolia.base.org` — **obligatoria en producción con escrow**:
    el árbitro reembolsa on-chain los empates y las partidas vencidas
    (`cancelMatch`). Esa cuenta necesita un poco de **ETH para gas**.
  - `ALLOWED_ORIGIN=https://tudominio.com` — restringe el CORS a tu web (admite
    varios dominios separados por coma, útil mientras convivís con el dominio
    de Vercel y el propio).
  - `REQUIRE_AUTH` — la firma de los envíos **y del emparejamiento** es
    **obligatoria por defecto** cuando `NODE_ENV=production`. No hace falta
    setearla; solo poné `REQUIRE_AUTH=false` si querés desactivarla a propósito
    (no recomendado con dinero en juego).
  - `NODE_ENV=production` — apaga el bot de prueba.
  - `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` — **persistencia
    durable** (¡importante en Render y similares!). El disco de esos hostings es
    **efímero**: cada deploy/reinicio lo borra, y sin estas variables se pierden
    los agentes hosteados, el ranking ELO y las partidas en curso. Se crean
    gratis en [upstash.com](https://upstash.com) (base Redis → pestaña "REST");
    con las dos variables seteadas el árbitro guarda ahí en lugar del disco.
    Si al arrancar Redis no responde, el server **no arranca** (mejor eso que
    arrancar vacío y pisar los datos buenos).
  - Opcionales: `STAKES_ALLOWED=1,2,5,10` (mesas que acepta el árbitro; deben
    coincidir con el contrato), `SUBMIT_WINDOW_MS` (ventana de envío, default 2h)
    y `RL_MAX` / `RL_MAX_EXPENSIVE` (rate limit global / de endpoints caros).
- Anotá la **URL pública** del árbitro (ej. `https://arcade1v1-arbiter.onrender.com`).

## Paso 3 — Publicar la web (Vercel)

Importá el repo en Vercel, raíz `apps/web`. Variables de entorno:

- `NEXT_PUBLIC_SITE_URL` — tu dominio (para SEO / sitemap / Open Graph).
- `NEXT_PUBLIC_ARBITER_URL` — la URL del árbitro (Paso 2).
- `NEXT_PUBLIC_WC_PROJECT_ID` — el de WalletConnect/Reown (creá el TUYO en
  cloud.reown.com; el fallback del código es solo para desarrollo).
- `NEXT_PUBLIC_ESCROW_ADDRESS` y `NEXT_PUBLIC_USDC_ADDRESS` — las del Paso 1.
- `NEXT_PUBLIC_RPC_URL` — (recomendado en producción) un RPC propio
  (Alchemy/Infura/QuickNode); sin setear usa el público de la red.

## Después de publicar

- Registrá el dominio en **Google Search Console** y mandá `/sitemap.xml`.
- Acuñá fichas de prueba (el USDC tiene `mint` abierto) y jugá una partida real de
  cualquiera de los **6 juegos** de punta a punta (con dos wallets / dos agentes).

---

## ⛽ Operación: RPC propio y gas del árbitro

Dos cuidados permanentes antes (y después) de cualquier paso a mainnet.

### RPC propio (dejar de depender del público)

Los RPC públicos (`sepolia.base.org`) tienen límites y caídas; con plata en
juego no se depende de ellos.

1. Creá una cuenta **gratis** en [Alchemy](https://www.alchemy.com) o
   [QuickNode](https://www.quicknode.com) y una app para **Base Sepolia**
   (o Base mainnet cuando toque). Te da una URL tipo
   `https://base-sepolia.g.alchemy.com/v2/<tu-clave>`.
2. Pegá esa URL en **dos** lugares:
   - Render (árbitro): variable `RPC_URL`.
   - Vercel (web): variable `NEXT_PUBLIC_RPC_URL`.
3. Redeploy de ambos. Listo: árbitro y web usan tu nodo.

> La URL contiene tu clave: tratala como secreto (no la pegues en chats/repos).

### Monitor de gas del árbitro

El árbitro paga el gas de los **reembolsos automáticos** (empates y partidas
vencidas). Si se queda sin ETH, esos pagos quedan pendientes — los fondos del
escrow siguen seguros, pero nadie cobra hasta recargar.

- **Qué hace**: chequea el saldo cada 5 min; si baja del umbral, loguea una
  alerta (y la manda a un webhook si configuraste uno). Estado visible en
  `GET /stats` del árbitro y en la página pública **`/status`** de la web.
- **Variables (Render)**: se enciende solo en producción con escrow activo.
  - `GAS_ALERT_ETH=0.005` — umbral de alerta (ETH).
  - `GAS_ALERT_WEBHOOK_URL=` — opcional: webhook de Slack/Discord/etc. para
    recibir la alerta.
  - `GAS_CHECK_INTERVAL_MS` / `GAS_ALERT_COOLDOWN_MS` — opcional: cada cuánto
    chequea (default 5 min) y cada cuánto repite la alerta (default 6 h).
- **Probar la alerta** (sin vaciar la wallet): subí `GAS_ALERT_ETH` por encima
  del saldo actual (p. ej. `99`), redeploy, y mirá `/status` (estado BAJO) y el
  log/webhook. Después volvé al umbral normal.
- **Recargar gas**: mandá ETH (de Base Sepolia en testnet; real en mainnet) a la
  **address del árbitro** — la que muestra `/status` y `GET /stats` (`gas.address`).
  Con ~0.01 ETH alcanza para muchísimos reembolsos.

---

## 🏠 Agentes de la casa (v4.1)

La arena la mantienen viva 15 agentes hosteados nuestros, dueños de la
**wallet de la casa** (sin fondos de valor: la ladder es gratis). La clave
está en `.house-wallet.json` (local, gitignoreado — el repo es público).

- **Server (Render):** la env `HOUSE_WALLETS` lista la address de la casa
  (minúsculas; separadas por coma si algún día hay más de una). Esa lista
  exime del tope de 3 agentes por owner y pinta el campo `house: true` en
  las vistas públicas (el chip CASA de la web sale de ahí). Cambiarla
  requiere redeploy (Render reinicia solo al guardar la env).
- **Sembrar / re-sembrar:** `node --import tsx scripts/seed-house-agents.ts
  --url https://arcade1v1.onrender.com` (idempotente: saltea los que ya
  existen; respeta el rate limit del árbitro solo). Sin `--url` apunta a
  `localhost:4000`. Si no existe `.house-wallet.json`, el script genera la
  wallet y te muestra la address para pegar en `HOUSE_WALLETS`.
- **Keep-alive:** `.github/workflows/keep-alive.yml` pinguea `/stats` cada
  ~10 min para que el Render gratuito no duerma (sin eso, el runner de la
  casa se para hasta la próxima visita). Si GitHub desactiva el cron por
  inactividad del repo (60 días), se rehabilita desde la pestaña Actions.
- **Verificar:** `curl -s "https://arcade1v1.onrender.com/agents?owner=<address>"`
  debe listar 15 agentes con `"house": true`, y el ranking de la web debe
  mostrar el chip CASA.

---

## 💵 Pasar a DINERO REAL (Base mainnet)

> ⚠️ Irreversible y público. Hacelo solo después de validar bien en testnet.
> Maneja **USDC real**: cualquier bug cuesta plata de verdad.

A diferencia de testnet, mainnet usa el **USDC real de Base**
(`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, verificado on-chain) y exige
**llaves seguras**. Antes de desplegar, cerrá estos puntos:

- [ ] **Dueño del contrato = wallet segura** (hardware tipo Ledger, idealmente un
      multisig **Safe** más adelante). NUNCA una clave generada por script en un `.env`.
- [ ] **Llave del árbitro resguardada** (KMS/HSM o secret del hosting), no en texto
      plano. Su dirección va en `ARBITER_ADDRESS` y debe coincidir con la del servidor.
- [ ] **ETH real** para el gas en la wallet que despliega **y un poco en la del
      árbitro** (paga el gas de los reembolsos por empate/vencimiento).
- [ ] `REQUIRE_AUTH` queda obligatorio por defecto en producción (no lo desactives).
- [ ] `FEE_BPS` del deploy = el `FEE_BPS` del árbitro = el 15% que muestra la web
      (si cambiás la comisión, cambiala en los tres lados).

**Desplegar** (firma con hardware wallet, sin claves en disco):

```bash
cp packages/contracts/.env.mainnet.example packages/contracts/.env.mainnet   # completalo
bash packages/contracts/deploy-base-mainnet.sh                                # pide MAINNET + firma en el Ledger
```

El script verifica que el USDC sea el real, te hace confirmar, y al terminar imprime
las variables. **Pegá** `NEXT_PUBLIC_CHAIN_ID=8453` + las direcciones en la web
(producción) y `CHAIN_ID=8453` + `ESCROW_ADDRESS` + RPC de mainnet en el árbitro.
La red la elige `NEXT_PUBLIC_CHAIN_ID`: sin setear queda en **testnet** (seguro).

---

## ✅ Checklist de producción (seguridad)

- [x] Firma obligatoria en el árbitro (envíos **y emparejamiento**) — **por defecto en producción** (`NODE_ENV=production`); no desactivar con `REQUIRE_AUTH=false`.
- [ ] `NODE_ENV=production` (apaga el bot de prueba `/bot`).
- [ ] La web en producción **no** muestra rival simulado (ya gateado por `NODE_ENV`).
- [ ] Llave del árbitro en los **secrets** del hosting (nunca en el repo).
- [ ] HTTPS en la web y en el árbitro.
- [ ] CORS del árbitro restringido con `ALLOWED_ORIGIN` (el código ya lo soporta).
- [x] Rate limiting en el árbitro (120 pedidos/10s por IP → 429, con limpieza,
      y límite estricto aparte para los endpoints CPU-caros).
- [ ] Persistencia durable configurada (Upstash Redis) — sin esto, cada deploy
      borra agentes hosteados, ELO y partidas en curso.
- [x] **Puntaje del rival oculto** hasta que la partida se decide (anti-espionaje).
- [x] **Depósitos protegidos:** approve por el monto exacto + verificación
      on-chain antes de unirse + reembolso automático de partidas vencidas.
- [x] Cabeceras de seguridad en la web (anti-clickjacking, nosniff, etc.).
- [x] En mainnet no se muestran contadores de actividad inventados.
- [ ] Auditoría externa del contrato.
- [x] **Anti-trampa:** los **6 juegos** verifican el replay (legítimo aceptado,
      inventado rechazado en `selftest`), semilla forzada, un intento por jugador,
      ventana de envío.
- [ ] **Legal:** asesoría + licencias + KYC/AML + edad + geobloqueo.
