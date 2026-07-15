// Fetch SALIENTE a webhooks de agentes BYO. Este módulo es la frontera de
// seguridad: el árbitro hace POST a URLs escritas por extraños, así que acá
// vive el guard anti-SSRF (https only, DNS resuelto con rechazo de rangos
// privados/reservados, sin redirects, timeout corto, respuesta ignorada) y la
// firma HMAC con la que el dev verifica que el aviso es nuestro.
//
// RIESGO RESIDUAL documentado (v2): DNS rebinding TOCTOU — resolvemos y
// validamos el host, pero el fetch re-resuelve; un DNS malicioso podría
// cambiar la IP entre ambos. Mitigado porque: solo https, redirect manual,
// la respuesta se ignora (nada que exfiltrar hacia nosotros), el payload es
// de forma fija sin secretos, y el timeout es corto. Pinear la IP resuelta
// (dispatcher de undici) queda para una v2 si aparecen agentes BYO masivos.

import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const NOTIFY_TIMEOUT_MS = Number(process.env.WEBHOOK_NOTIFY_TIMEOUT_MS ?? 10_000);
const MAX_URL_LEN = 512;

/** Kill switch de agentes BYO. Se relee por llamada (patrón isHouseWallet)
 *  para que los tests puedan togglearlo sin reimportar el módulo. */
export function webhookAgentsEnabled(): boolean {
  return process.env.WEBHOOK_AGENTS_ENABLED !== "false";
}

/** SOLO dev/tests: permite http y hosts privados (E2E local contra 127.0.0.1). */
function allowPrivate(): boolean {
  return process.env.WEBHOOK_ALLOW_PRIVATE === "true";
}

/** ¿IP privada/reservada? (la lista que un SSRF querría alcanzar). Pura para
 *  poder testearla con una matriz de casos. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true; // 0/8, 10/8, 127/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 (CGNAT)
    if (a === 169 && b === 254) return true; // 169.254/16 (link-local, metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 (bench)
    if (a >= 224) return true; // 224/4 multicast + 240/4 reservado + broadcast
    return false;
  }
  if (kind === 6) {
    const low = ip.toLowerCase();
    // IPv4 embebida en IPv6: decide la IPv4. Cubre la forma con puntos
    // (::ffff:10.0.0.1) y la hexadecimal (::ffff:a00:1 = ::ffff:10.0.0.1).
    const mapped = low.match(/^::ffff:(.+)$/);
    if (mapped) {
      const tail = mapped[1];
      if (tail.includes(".")) return isPrivateAddress(tail);
      const groups = tail.split(":");
      if (groups.length === 2 && groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) {
        const hex = groups.map((g) => g.padStart(4, "0")).join("");
        const oct = [0, 2, 4, 6].map((i) => parseInt(hex.slice(i, i + 2), 16));
        return isPrivateAddress(oct.join("."));
      }
    }
    if (low === "::" || low === "::1") return true; // no especificada / loopback
    // fe80::/10 link-local + fec0::/10 site-local (deprecado pero enruta en LANs).
    if (/^fe[89a-f]/.test(low)) return true;
    if (low.startsWith("fc") || low.startsWith("fd")) return true; // fc00::/7 ULA
    if (low.startsWith("2002:")) return true; // 6to4: embebe una IPv4 arbitraria
    if (low.startsWith("64:ff9b:")) return true; // NAT64 well-known (embebe IPv4)
    return false;
  }
  return true; // no es una IP válida: rechazar por las dudas
}

/** Validación SINTÁCTICA de la URL (para el registro; sync a propósito:
 *  createHostedAgent es sync). El guard autoritativo con DNS corre en cada
 *  notificación (notifyWebhook), que además cubre cambios de DNS posteriores. */
export function validateWebhookUrl(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) throw new Error("webhookUrl required");
  if (s.length > MAX_URL_LEN) throw new Error(`webhookUrl too long (max ${MAX_URL_LEN})`);
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new Error("webhookUrl inválida");
  }
  const okProtocols = allowPrivate() ? ["https:", "http:"] : ["https:"];
  if (!okProtocols.includes(url.protocol)) throw new Error("webhookUrl must be https");
  if (url.username || url.password) throw new Error("webhookUrl must not contain credentials");
  const host = url.hostname.toLowerCase();
  if (!host) throw new Error("webhookUrl inválida");
  if (!allowPrivate()) {
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
      throw new Error("webhookUrl host not allowed");
    }
    if (isIP(host.replace(/^\[|\]$/g, "")) && isPrivateAddress(host.replace(/^\[|\]$/g, ""))) {
      throw new Error("webhookUrl host not allowed");
    }
  }
  return url.toString();
}

/** Firma HMAC-SHA256 del body (hex). El dev la verifica con su secreto para
 *  saber que el aviso vino del árbitro y no de un tercero. */
export function webhookSignature(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** Acota una promesa a un presupuesto de tiempo (dns.lookup no acepta signal:
 *  un nameserver que no responde colgaría el tick del runner sin cota). */
async function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(msg)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(t!);
  }
}

/** Notifica al webhook del dev. Guard AUTORITATIVO: re-valida la URL,
 *  resuelve DNS y rechaza si CUALQUIER address es privada, POST con timeout
 *  corto y sin seguir redirects. Tira si algo falla (el runner cuenta la
 *  falla); la respuesta se ignora salvo el status. */
export async function notifyWebhook(
  hook: { url: string; secret: string },
  payload: object,
): Promise<void> {
  const url = new URL(validateWebhookUrl(hook.url));
  if (!allowPrivate()) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    // Host con IP literal ya validado arriba; los nombres se resuelven acá.
    if (!isIP(host)) {
      const addrs = await withTimeout(
        lookup(host, { all: true }),
        NOTIFY_TIMEOUT_MS,
        "webhook dns lookup timeout",
      );
      if (addrs.length === 0) throw new Error("webhook host did not resolve");
      for (const { address } of addrs) {
        if (isPrivateAddress(address)) throw new Error("webhook host resolves to private address");
      }
    }
  }
  const body = JSON.stringify(payload);
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-arcade-signature": `sha256=${webhookSignature(hook.secret, body)}`,
    },
    body,
    redirect: "manual", // un 3xx cae al !r.ok de abajo: no seguimos redirects
    signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`webhook responded ${r.status}`);
}
