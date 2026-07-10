# v3 — Instrucción operativa

> Protocolo de trabajo para ejecutar el milestone v3, fase por fase. La
> estructura del milestone (fases, criterios, estado) está en
> [PLAN.md](PLAN.md). Este documento existe para que cualquier sesión futura
> sepa exactamente cómo continuar sin re-derivar contexto.

## Contexto fijo del proyecto

- El dueño del proyecto **no es técnico**: delega git, código y decisiones
  técnicas. Todo se le explica en simple, sin jerga.
- El repositorio despliega automático con cada push: la web a **Vercel**, el
  árbitro a **Render**. Por lo tanto **push = publicar**.
- Estado actual: **v2.1 en testnet** (Base Sepolia, dinero de juego).

## Al abrir una sesión de trabajo

1. Leer [PLAN.md](PLAN.md) → sección **Estado**.
2. Tomar la **primera fase sin marcar** (o la que pida el usuario
   explícitamente).
3. Anunciar en simple qué fase se va a trabajar y qué va a poder hacer el
   usuario cuando termine.

## Protocolo por fase

Cada fase sigue estos pasos, en orden:

1. **Diseño** — si la fase tiene decisiones de producto o UX abiertas
   (marcadas en su alcance como "se decide en el diseño de la fase"),
   brainstormear primero y dejar la decisión escrita en una spec en
   [docs/superpowers/specs/](../specs/) (`AAAA-MM-DD-<tema>-design.md`).
   Fases sin decisiones abiertas saltan a (2).
2. **Plan de implementación** — escribir el plan detallado en
   [docs/superpowers/plans/](../plans/) con el nombre
   `AAAA-MM-DD-<fase>.md`, siguiendo el formato de los planes existentes
   (tasks con checkboxes, archivos, interfaces, constraints).
3. **Implementación con TDD** — test primero donde haya lógica; el código
   nuevo reusa lo que ya existe (validaciones, firmas, stores, hooks) antes de
   crear nada paralelo.
4. **Chequeo completo** — `npm run check` (tipos de todos los workspaces +
   eslint + prettier + tests + selftest) en verde.
5. **Verificación real** — ejercitar la feature de punta a punta (levantar la
   app, recorrer el flujo), no solo tests. Lo que toca on-chain se prueba
   contra Base Sepolia como se hizo en el E2E de v2.
6. **Idiomas** — todo texto nuevo de la web va traducido a los 4 idiomas
   (en/es/hi/fr). Sin excepciones ni "TODO traducir".
7. **Registro** — entrada en [CHANGELOG.md](../../../CHANGELOG.md) (formato
   Keep a Changelog, en español) + bump de versión.
8. **Commits atómicos** — mensajes convencionales como los del historial
   (`feat(web): ...`, `feat(server): ...`, `docs: ...`).
9. **Publicar solo con OK** — mostrar al usuario qué se hizo, en simple, y
   pedir su OK explícito antes de `git push`. Nunca publicar sin ese OK.
10. **Cerrar la fase** — tras verificar en producción: marcar la fase en
    [PLAN.md](PLAN.md) → Estado, y actualizar la memoria persistente si dejó
    algo no-obvio para sesiones futuras.

## Reglas de la casa (no negociables)

- **No pushear sin OK explícito del usuario** — push despliega a producción.
- **Honestidad en la UI**: nada de contadores sintéticos, actividad falsa ni
  tono de casino. El posicionamiento es agent-first / verificado on-chain /
  benchmark de IA.
- **Jerarquía de CTAs**: una acción primaria + una secundaria por zona; el
  resto a su lugar natural.
- **Default-deny**: validaciones nuevas siguen el patrón existente (allowlist,
  sanitización, firmas con `ts` anti-replay).
- **Sin KYC/legal por decisión del usuario** (ya advertido): no re-abrir ese
  tema en cada fase.
- Los 4 idiomas son ciudadanos de primera: ninguna feature sale "solo en
  inglés".

## Versionado y cierre

- Cada fase publicada = un release menor incremental: **2.2.0, 2.3.0, …** con
  su entrada de changelog.
- La fase que completa las 7 se publica como **3.0.0**.
- Al cerrar 3.0.0: actualizar [docs/ROADMAP.md](../../ROADMAP.md) (v3 pasa al
  estado actual, v4 queda como próximo acto), tag de release en GitHub como
  los anteriores, y este directorio queda como registro histórico.

## Definición de v3 cerrada

- [ ] Las 7 fases de [PLAN.md](PLAN.md) marcadas, cada una con sus criterios
      de aceptación cumplidos.
- [ ] `npm run check` en verde en `main`.
- [ ] Cada feature verificada en producción (Vercel + Render + Base Sepolia),
      no solo en local.
- [ ] Changelog al día y release 3.0.0 etiquetado.
- [ ] ROADMAP.md actualizado.
