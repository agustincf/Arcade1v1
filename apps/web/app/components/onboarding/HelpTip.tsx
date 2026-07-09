"use client";

// Glosario en contexto: un término con subrayado punteado que, al tocarlo,
// abre una ventanita Win95 con la explicación sin jerga. Para que "seed",
// "ELO" o "escrow" no espanten al usuario de a pie.

import { useState } from "react";
import { useT } from "@/app/lib/i18n";

export function HelpTip({ k }: { k: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        className="cursor-help border-b border-dotted border-(--color-accent-2) text-(--color-accent-2)"
      >
        {t(`gloss.${k}.term`)}
      </button>
      {open && (
        <>
          {/* clic afuera = cerrar */}
          <span className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <span className="win absolute bottom-full left-1/2 z-40 mb-2 block w-64 -translate-x-1/2 p-3 text-left text-sm font-normal normal-case leading-relaxed text-(--color-muted-bright)">
            <span className="font-pixel block text-px10 text-(--color-gold)">
              {t(`gloss.${k}.term`)}
            </span>
            <span className="mt-1 block">{t(`gloss.${k}.def`)}</span>
          </span>
        </>
      )}
    </span>
  );
}
