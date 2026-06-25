# Guía para publicar Arcade1v1

Hay **3 piezas** que se publican por separado:

1. **La web** (lo que ve el jugador) → Vercel (gratis, hecho para Next.js).
2. **El árbitro** (el backend) → un hosting de Node (Render / Railway / Fly).
3. **El contrato** → la blockchain Base Sepolia (testnet, por ahora).

> ⚠️ **Solo testnet.** No actives dinero real hasta cerrar los puntos críticos de
> [SECURITY.md](SECURITY.md) — sobre todo lo **legal** (licencias, KYC, edad, país).

---

## Paso 1 — Desplegar el contrato (Base Sepolia) — **llave en mano**

Un solo script hace todo. Corrés **dos veces**:

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
> pago + reembolso. Ver `packages/contracts/check-payment-e2e.sh`.

## Paso 2 — Publicar el árbitro (backend)

En un hosting de Node (ej. Render), apuntando a `apps/server`:

- Build/Start: `npm install` y `npm run start -w @arcade1v1/server`.
- Variables de entorno (en los "secrets" del hosting, **no** en el código):
  - `ARBITER_PRIVATE_KEY` — la llave del árbitro (guardar como secreto). Debe ser
    la cuenta que figura como **arbiter** en el contrato (Paso 1).
  - `CHAIN_ID=84532` y `ESCROW_ADDRESS=` (las del Paso 1).
  - `RPC_URL=https://sepolia.base.org` — para que el árbitro cree las partidas on-chain.
  - `ALLOWED_ORIGIN=https://tudominio.com` — restringe el CORS a tu web.
  - `REQUIRE_AUTH=true` — exige que jugadores/agentes firmen.
  - `NODE_ENV=production` — apaga el bot de prueba.
- Anotá la **URL pública** del árbitro (ej. `https://arcade1v1-arbiter.onrender.com`).

## Paso 3 — Publicar la web (Vercel)

Importá el repo en Vercel, raíz `apps/web`. Variables de entorno:

- `NEXT_PUBLIC_SITE_URL` — tu dominio (para SEO / sitemap / Open Graph).
- `NEXT_PUBLIC_ARBITER_URL` — la URL del árbitro (Paso 2).
- `NEXT_PUBLIC_WC_PROJECT_ID` — el de WalletConnect/Reown.
- `NEXT_PUBLIC_ESCROW_ADDRESS` y `NEXT_PUBLIC_USDC_ADDRESS` — las del Paso 1.

## Después de publicar

- Registrá el dominio en **Google Search Console** y mandá `/sitemap.xml`.
- Acuñá fichas de prueba (el USDC tiene `mint` abierto) y jugá una partida real de
  cualquiera de los **6 juegos** de punta a punta (con dos wallets / dos agentes).

---

## ✅ Checklist de producción (seguridad)

- [ ] `REQUIRE_AUTH=true` en el árbitro (firma obligatoria).
- [ ] `NODE_ENV=production` (apaga el bot de prueba `/bot`).
- [ ] La web en producción **no** muestra rival simulado (ya gateado por `NODE_ENV`).
- [ ] Llave del árbitro en los **secrets** del hosting (nunca en el repo).
- [ ] HTTPS en la web y en el árbitro.
- [ ] CORS del árbitro restringido con `ALLOWED_ORIGIN` (el código ya lo soporta).
- [x] Rate limiting en el árbitro (ya implementado: 120 pedidos/10s por IP → 429).
- [ ] Auditoría externa del contrato.
- [x] **Anti-trampa:** los **6 juegos** verifican el replay (legítimo aceptado,
      inventado rechazado en `selftest`).
- [ ] **Legal:** asesoría + licencias + KYC/AML + edad + geobloqueo.
