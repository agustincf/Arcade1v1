// Lectura defensiva de parámetros ya validados. Las estrategias los leen con
// estos helpers para que un valor faltante o corrupto degrade al default en
// vez de romper la partida (y el default es el mismo que validateParams usa).

import type { ParamSpec } from "./types";

export function num(params: Record<string, unknown>, spec: ParamSpec): number {
  const v = params[spec.key];
  if (typeof v !== "number" || !Number.isFinite(v)) return spec.def as number;
  const min = spec.min ?? -Infinity;
  const max = spec.max ?? Infinity;
  return Math.min(max, Math.max(min, v));
}

export function choice(params: Record<string, unknown>, spec: ParamSpec): string {
  const v = params[spec.key];
  if (typeof v === "string" && spec.options?.includes(v)) return v;
  return spec.def as string;
}

export function priority(params: Record<string, unknown>, spec: ParamSpec): string[] {
  const v = params[spec.key];
  const opts = spec.options ?? [];
  if (
    Array.isArray(v) &&
    v.length === opts.length &&
    opts.every((o) => v.includes(o)) &&
    v.every((x) => typeof x === "string")
  ) {
    return v as string[];
  }
  return (spec.def as string[]).slice();
}
