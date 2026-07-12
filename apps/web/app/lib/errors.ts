// Clasificación de fallos en acciones FIRMADAS con la wallet (deploy de
// agentes, pausar/borrar, perfil). Dos verdades que la UI debe distinguir:
// (1) el usuario canceló la firma → no es un error, se avisa suave;
// (2) el server lo rechazó → se muestra el motivo REAL. Nunca culpar a la
// conexión cuando el server respondió (eso convierte un límite claro en un
// botón que "no anda").

/** true si el error es el usuario cancelando/rechazando la firma en su wallet.
 *  Cubre el código EIP-1193 (4001) y los textos de las wallets comunes, mirando
 *  también la cadena de `cause` (wagmi/viem envuelven el error original). */
export function isSignCancelled(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; cur && depth < 10; depth++) {
    const { code, message, cause } = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (code === 4001) return true;
    if (
      typeof message === "string" &&
      /user rejected|user denied|rejected the request|user cancel/i.test(message)
    ) {
      return true;
    }
    if (cause === cur) break;
    cur = cause;
  }
  return false;
}

export type ArbiterRejection =
  | { kind: "agent-limit"; max: number } // tope de agentes por wallet (lo dice el server)
  | { kind: "network" } // no hubo respuesta: acá SÍ vale el genérico de conexión
  | { kind: "server"; reason: string }; // cualquier otro motivo, tal cual llegó

/** Mensaje (clave i18n + variables) para el fallo de una acción firmada, según
 *  la etapa donde murió: "sign" (la wallet) o "server" (el árbitro). Es lo que
 *  los botones muestran en vez de fallar en silencio. */
export function failureText(
  stage: "sign" | "server",
  e: unknown,
): { key: string; vars?: Record<string, string | number> } {
  if (stage === "sign") {
    if (isSignCancelled(e)) return { key: "err.signCancelled" };
    return { key: "err.rejected", vars: { reason: e instanceof Error ? e.message : String(e) } };
  }
  const rejection = classifyArbiterError(e);
  if (rejection.kind === "network") return { key: "match.error" };
  if (rejection.kind === "agent-limit") return { key: "build.limit", vars: { n: rejection.max } };
  return { key: "err.rejected", vars: { reason: rejection.reason } };
}

/** Interpreta el rechazo del árbitro en la administración de agentes. */
export function classifyArbiterError(e: unknown): ArbiterRejection {
  const reason = e instanceof Error ? e.message : String(e);
  const limit = /max\s+(\d+)\s+agents?\s+per\s+owner/i.exec(reason);
  if (limit) return { kind: "agent-limit", max: Number(limit[1]) };
  if (
    e instanceof TypeError || // fetch: "Failed to fetch" / "Load failed"
    (e instanceof Error && e.name === "AbortError") || // AbortSignal.timeout
    /failed to fetch|load failed|network|timed? ?out|aborted/i.test(reason)
  ) {
    return { kind: "network" };
  }
  return { kind: "server", reason };
}
