# STANDARDS.md — Reglas de construcción de Arcade1v1

Guía obligatoria para cualquier persona o agente de IA que toque este código.
La vara para TODA decisión: **¿qué le pasa al usuario final?** (el jugador que
puso plata, el dueño de un agente, el rival que espera). Si un cambio lo puede
dejar esperando, perdiendo plata o leyendo un mensaje que miente, está mal.

## Stack (no agregar piezas sin necesidad real)

- **Monorepo npm workspaces**: `apps/*` (web, server, mcp) + `packages/*` (game-sdk, strategies, agent-sdk, contracts).
- **Web**: Next.js (App Router) + React + Tailwind v4 (tokens `--color-*` en `globals.css`) + wagmi/viem + RainbowKit.
- **Server (árbitro)**: Express 5 + viem, corrido con `tsx`. Estado en memoria + persistencia opt-in (`persist.ts`: Redis Upstash o archivo).
- **Contratos**: Solidity 0.8 + OpenZeppelin + Foundry (`packages/contracts`). El contrato desplegado NO se toca: un cambio implica redeploy y migración.
- **Tests**: `node:test` nativo (`test/*.test.ts` por workspace). Sin Jest ni frameworks extra.
- **Tooling**: TypeScript estricto, ESLint (flat config raíz), Prettier. Todo se valida con `npm run check`.

## Principios innegociables

1. **El usuario final primero.** Nadie queda colgado sin salida: todo fetch tiene
   timeout, toda espera larga tiene aviso ("el servidor está despertando"), todo
   error tiene botón REINTENTAR y un intento con plata nunca se pierde (se guarda
   y se reenvía). Los mensajes dicen la VERDAD: si canceló la firma, se le dice
   eso, no "error del servidor"; si un texto promete algo ("el pozo va a tu
   rival"), el código lo cumple de verdad.
2. **Default-deny (anti-trampa).** El árbitro no confía en nada del cliente:
   juego desconocido → rechazo; puntaje sin replay verificable → rechazo; semilla
   distinta a la de la partida → rechazo. La lista `VERIFIERS` de
   `matchmaking.ts` es LA lista de juegos válidos.
3. **Un solo code path.** Agentes hosteados, humanos y agentes externos pasan por
   las MISMAS funciones (matchmake/submitScore) con las mismas reglas: firma,
   verificación, ELO. Nunca crear atajos "internos" que salteen validaciones.
4. **Secure by default.** Auth firmada obligatoria en producción (`AUTH_REQUIRED`);
   guarda de arranque (`config-guard.ts`) que impide arrancar mal configurado con
   dinero real; claves privadas de agentes NUNCA salen en una respuesta de API
   (vista `toView` separada del modelo).
5. **Todo lo que crece, se poda.** Cada Map/estado en memoria tiene tope, TTL o
   barrendero (matches, rate-limit, ratings, perfiles). Prohibido agregar un
   store que crezca sin límite.
6. **Determinismo en los juegos.** Misma semilla → misma partida. Los motores del
   game-sdk no usan `Math.random()` ni relojes: solo la semilla. La semilla la
   genera el árbitro con CSPRNG; el cliente jamás manda sobre el azar.

## Convenciones

- **Idioma**: comentarios y mensajes de commit en castellano; identificadores de
  código en inglés. Los comentarios explican el PORQUÉ (el riesgo que evitan),
  no el qué.
- **Textos de UI**: SIEMPRE por i18n (`i18n-dict.ts`, 4 idiomas: en/es/hi/fr) vía
  `t("clave")`. Prohibido hardcodear texto visible.
- **Direcciones**: normalizar a minúsculas (`normAddr`) antes de usarlas como
  clave o compararlas. Nunca comparar addresses crudas.
- **Dinero**: USDC con 6 decimales — convertir con `toUsdcUnits`, nunca aritmética
  de floats hacia el contrato. Mesas permitidas en UNA fuente (`STAKES_ALLOWED` /
  `allowedStake` del contrato / `BET_AMOUNTS` de la web deben coincidir).
  Approve por el monto EXACTO, jamás infinito.
- **Config por entorno**: toda perilla nueva va por `process.env` con default
  sano y documentado en `.env.example`. En producción, lo crítico se valida en
  `config-guard.ts` (fail-fast).
- **Nombres de archivo**: `kebab-case.ts` en server/packages; componentes React
  `PascalCase.tsx`; rutas Next en `app/` según convención del App Router.
- **Errores HTTP del árbitro**: `res.status(4xx).json({ error: "mensaje claro" })`,
  envueltos en try/catch por ruta. El mensaje debe servirle al que lo lee.
- **Errores de acciones firmadas por la wallet**: toda acción que pide firma
  (deploy/pausar/borrar agente, perfil, desafíos, emparejar) clasifica el fallo
  con `app/lib/errors.ts` (`classifySignError`/`failureText`), distinguiendo
  firma cancelada, red equivocada, fallo real de la wallet y rechazo del server
  — cada uno con su texto i18n propio. El genérico de "no pudimos conectar"
  queda reservado solo para cuando la red está caída de verdad. Patrón
  obligatorio para cualquier botón nuevo que firme con la wallet.
- **Estado en React**: hooks locales + refs para guardas de concurrencia (ej.
  `mmStarted`); nada de Redux/Zustand. Datos del árbitro se piden con los
  helpers de `app/lib/arbiter.ts` (ÚNICO punto de fetch, con timeout compartido).
  Efectos con cleanup y flags de cancelación.

## Flujo de trabajo

- **Antes de dar algo por terminado**: `npm run check` (typecheck + lint +
  format + tests + selftest) tiene que pasar entero.
- **Todo fix de seguridad/plata lleva test** que reproduzca el ataque o el caso
  (ver `apps/server/test/*` como modelo: levantan el router real y disparan
  requests firmadas).
- **Commits**: convención `tipo(ámbito): descripción en castellano`
  (`fix(server): …`, `feat(web): …`, `docs: …`).
- **Deploy**: `git push` a `main` despliega SOLO (Vercel + Render). No pushear
  sin verificación completa y OK del dueño del proyecto.
- **Documentos de diseño**: los planes/specs van en `docs/superpowers/`; la
  operativa del milestone vigente en `docs/superpowers/v3/`.
