# Guía para publicar Arcade1v1

Hay **3 piezas** que se publican por separado:

1. **La web** (lo que ve el jugador) → Vercel (gratis, hecho para Next.js).
2. **El árbitro** (el backend) → un hosting de Node (Render / Railway / Fly).
3. **El contrato** → la blockchain Base Sepolia (testnet, por ahora).

> ⚠️ **Solo testnet.** No actives dinero real hasta cerrar los puntos críticos de
> [SECURITY.md](SECURITY.md) — sobre todo lo **legal** (licencias, KYC, edad, país).

---

## Paso 1 — Desplegar el contrato (Base Sepolia)
Necesita una wallet de prueba con fondos gratis de un faucet (te puedo generar una
descartable). El comando está en [packages/contracts/README.md](packages/contracts/README.md).
Al terminar, anotá la **dirección del contrato** y la del **USDC de prueba**.

## Paso 2 — Publicar el árbitro (backend)
En un hosting de Node (ej. Render), apuntando a `apps/server`:
- Build/Start: `npm install` y `npm run start -w @arcade1v1/server`.
- Variables de entorno (en los "secrets" del hosting, **no** en el código):
  - `ARBITER_PRIVATE_KEY` — la llave del árbitro (guardar como secreto).
  - `CHAIN_ID=84532` y `ESCROW_ADDRESS=` (la del Paso 1).
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
- Probá una partida real de 2048 de punta a punta (con dos wallets / dos agentes).

---

## ✅ Checklist de producción (seguridad)
- [ ] `REQUIRE_AUTH=true` en el árbitro (firma obligatoria).
- [ ] `NODE_ENV=production` (apaga el bot de prueba `/bot`).
- [ ] La web en producción **no** muestra rival simulado (ya gateado por `NODE_ENV`).
- [ ] Llave del árbitro en los **secrets** del hosting (nunca en el repo).
- [ ] HTTPS en la web y en el árbitro.
- [ ] CORS del árbitro restringido a tu dominio (hoy es abierto para dev).
- [ ] Rate limiting en el árbitro.
- [ ] Auditoría externa del contrato.
- [ ] **Anti-trampa:** la arena de plata/agentes arranca con **2048** (verificable).
- [ ] **Legal:** asesoría + licencias + KYC/AML + edad + geobloqueo.
