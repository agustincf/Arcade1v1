# Fase 3 — Perfiles humanos (diseño)

> Spec de diseño de la Fase 3 del milestone v3. Estructura y criterios en
> [../v3/PLAN.md](../v3/PLAN.md) (Fase 3). Protocolo en
> [../v3/OPERATIVA.md](../v3/OPERATIVA.md). Aprobada por el dueño el 2026-07-10.

## Objetivo

Que los jugadores humanos dejen de aparecer como `0x1234…abcd`: que puedan
elegir **nombre + avatar** (misma validación default-deny que los agentes) y que
eso se vea en el ranking, en las partidas que se miran y en el historial de
rivales. Fallback al address corto cuando no hay perfil.

## Decisión de UX (la abierta del plan)

La edición del perfil vive **dentro de `/my-agents`** (el hub del humano
logueado que ya existe), como una tarjeta "Tu perfil" arriba de la lista de
agentes. No se crea página ni entrada de menú nueva. Una sola acción principal
por zona (regla de la casa).

## Arquitectura

### Servidor

**Almacén** — `apps/server/src/profiles.ts`, nuevo, con `jsonStore("profiles")`
(mismo backend Redis/archivo que ratings/agentes; sobrevive redeploys):

```
address (lowercase) -> { name: string, avatar: string, updatedAt: number }
```

- Es **opt-in**: solo se crea al firmar. Aun así, tope `MAX_PROFILES`
  (env, default 5000, como `MAX_RATED_ADDRESSES`) con desalojo del menos
  recientemente actualizado — un spammer no puede hacerlo crecer sin fin.
- **Reusa** (no duplica): `sanitizeName` y `AGENT_AVATARS` de `agents.ts`
  (se exporta `sanitizeName`, hoy privada). Avatar fuera de la allowlist cae
  al default; nombre vacío/solo-control se rechaza (mismo criterio que agentes).
- API del módulo:
  - `setProfile({ address, name, avatar }): Profile` — sanea y guarda.
  - `getProfile(address): Profile | undefined`.
  - `resolveDisplay(address): { name?: string; avatar?: string }` — resuelve en
    orden: **1)** agente hosteado (`hostedAgentByAddress`) → su name/avatar;
    **2)** perfil humano; **3)** `{}` (la web cae al address corto). `profiles.ts`
    puede importar `agents.ts` sin ciclo (nada importa `profiles`).
  - `restoreProfiles()` — la llama `index.ts` antes de escuchar.

**Firma anti-replay** — nuevo `profileAuthMessage(action, address, ts)` en
[packages/game-sdk/src/auth.ts](../../../packages/game-sdk/src/auth.ts), mismo
formato que `agentAuthMessage`, TTL `AGENT_AUTH_TTL_MS` (10 min). Ata la acción
("set") + la propia address + `ts`. El firmante debe ser la address del perfil
(nadie edita ajeno; address normalizada a minúsculas).

**Rutas** — en `apps/server/src/profiles-routes.ts` (nuevo, mismo patrón que
`agents-routes.ts`), montado en `index.ts`:

- `POST /profile` — `{ address, name, avatar, signature, ts }` → verifica firma
  (o la exige en prod vía `AUTH_REQUIRED`) → `setProfile` → devuelve el perfil.
  Pasa por el `strictLimit` (recupera una firma), igual que `POST /agents`.
- `GET /profile/:address` — `{ profile: Profile | null }` con HTTP 200 siempre
  (null si no hay). Sin perfil no es un error; el cliente pinta "Sin nombre".
  Público: la web lo usa para la tarjeta "Tu perfil".

**Resolución en las respuestas** — se hace en la **capa de rutas** (que ya
importa todo), NO dentro de `matchmaking.ts` (importar `agents` ahí sería
ciclo). Se enriquecen, sin romper el shape actual (campos `name?`/`avatar?`
opcionales por jugador):

- `GET /leaderboard/:game` (index.ts) — cada fila suma name/avatar.
- `GET /matches/recent` y `GET /match/:id/replay` (index.ts) — cada player.
- `GET /agents/:id/matches` (agents-routes.ts) — el `opponent` de cada entrada.

### Web

**Editar (dentro de `/my-agents`)** — tarjeta "Tu perfil" arriba de la lista:
avatar + nombre actual (o "Sin nombre") + botón "Editar". Editar abre un
mini-form que **reusa el patrón del paso 3 del builder** (input de nombre de 24
chars + grilla de `AGENT_AVATARS`); "Guardar" firma `profileAuthMessage` y hace
`POST /profile`. Se extrae un componente `ProfileEditor` para no engordar la
página. Cliente en `arbiter.ts`: `getProfile(address)` y `setProfile(...)`.

**Mostrar (resolución en lectura)** — donde hoy se pinta el address crudo, si
viene `name`/`avatar` se muestra **`avatar nombre` con el address corto al
lado**; si no, solo el address corto (comportamiento actual):

- [leaderboard/page.tsx](../../../apps/web/app/leaderboard/page.tsx)
- [watch/page.tsx](../../../apps/web/app/watch/page.tsx) y
  [watch/[matchId]/page.tsx](../../../apps/web/app/watch/%5BmatchId%5D/page.tsx)
- [my-agents/[agentId]/page.tsx](../../../apps/web/app/my-agents/%5BagentId%5D/page.tsx)
  (rival en el historial)

Los tipos del cliente (`LeaderRow`, `RecentMatch`, `PublicReplay`,
`AgentMatchSummary`) suman `name?`/`avatar?` opcionales.

## Anti-suplantación / honestidad

- Nombres **no únicos** (igual que agentes) → por eso el nombre **nunca**
  reemplaza del todo la identidad: **siempre** se muestra el address corto al
  lado. Un nombre no alcanza para hacerse pasar por otro.
- Misma sanitización y misma allowlist de avatares que agentes (default-deny).
- Firma con `ts` anti-replay; address en minúsculas; el firmante == la address
  del perfil.

## Testing

**TDD (server, hermético, sin persistencia)** — `apps/server/test/profiles.test.ts`:

- `setProfile` sanea el nombre y rechaza el vacío; avatar fuera de allowlist cae
  al default.
- `getProfile` devuelve lo guardado; ausente → `undefined`.
- `resolveDisplay`: agente gana sobre perfil; perfil sobre nada; nada → `{}`.
- Verificación de firma en la ruta: válida acepta, ajena/otra-address rechaza,
  `ts` vencido rechaza (test de `profiles-routes` como `agents-routes.test.ts`).
- Tope `MAX_PROFILES` con desalojo del menos reciente.

**E2E real local** — levantar el árbitro, `POST /profile` firmado por HTTP, y
confirmar que `GET /leaderboard/:game` devuelve el name/avatar para esa address;
comprobar en la web que la tarjeta y el ranking lo muestran.

## Archivos

Nuevos:

- `apps/server/src/profiles.ts`, `apps/server/src/profiles-routes.ts`
- `apps/server/test/profiles.test.ts` (+ casos en un test de rutas)
- `apps/web/app/my-agents/ProfileEditor.tsx`

Modificados:

- `packages/game-sdk/src/auth.ts` — `profileAuthMessage`
- `apps/server/src/agents.ts` — exportar `sanitizeName`
- `apps/server/src/index.ts` — montar rutas, `restoreProfiles`, enriquecer
  leaderboard/recent/replay
- `apps/server/src/agents-routes.ts` — enriquecer historial (opponent)
- `apps/web/app/lib/arbiter.ts` — `getProfile`/`setProfile` + `name?`/`avatar?`
  en los tipos
- `apps/web/app/my-agents/page.tsx` — tarjeta "Tu perfil"
- `apps/web/app/leaderboard/page.tsx`, `apps/web/app/watch/page.tsx`,
  `apps/web/app/watch/[matchId]/page.tsx`,
  `apps/web/app/my-agents/[agentId]/page.tsx` — mostrar name/avatar
- `apps/web/app/lib/i18n-dict.ts` — textos nuevos en los 4 idiomas

## Fuera de alcance (YAGNI)

Nombres únicos/verificados, foto de perfil subida, bio, y tocar los agentes
(ya tienen nombre/avatar propios).
