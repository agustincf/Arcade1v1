"use client";

import { useState } from "react";

/** Bloque de texto o código sobre el negro oficial (token ink), con un botón
 *  para copiarlo entero. Lo usa /agents para lo que se pega tal cual: el pedido
 *  para el agente y la config del MCP. Los textos del botón vienen de la página
 *  (server component), así el componente no depende del idioma. */
export function CopyBlock({
  text,
  copyLabel,
  copiedLabel,
  wrap = false,
}: {
  text: string;
  copyLabel: string;
  copiedLabel: string;
  /** Prosa (un pedido) en vez de código: corta las líneas en vez de scrollear. */
  wrap?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* portapapeles bloqueado: el texto sigue a la vista y seleccionable */
    }
  }

  return (
    <div className="relative">
      <pre
        className={`rounded-lg bg-(--color-ink) p-4 pt-12 font-mono sm:pr-24 sm:pt-4 text-[13px] leading-6 text-(--color-muted-bright) ${
          wrap ? "whitespace-pre-wrap break-words" : "overflow-x-auto"
        }`}
      >
        <code>{text}</code>
      </pre>
      <button
        type="button"
        onClick={copy}
        className="absolute right-2 top-2 rounded-md border border-(--color-border) bg-(--color-surface-2) px-2.5 py-1 text-xs font-semibold text-(--color-muted-bright) transition hover:border-(--color-accent) hover:text-(--color-text-strong)"
      >
        <span aria-live="polite">{copied ? copiedLabel : copyLabel}</span>
      </button>
    </div>
  );
}
