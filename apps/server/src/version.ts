// QUÉ VERSIÓN ESTÁ CORRIENDO. Render define RENDER_GIT_COMMIT en cada deploy
// (el commit del build). Antes no había forma de saber desde afuera qué código
// estaba desplegado: la única pista era que `uptimeSeconds` de /stats volviera
// a cero. /health lo devuelve con los 7 caracteres que muestra GitHub.

export function deployedCommit(env: NodeJS.ProcessEnv = process.env): string | null {
  const sha = (env.RENDER_GIT_COMMIT ?? "").trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 7) : null;
}
