"use client";

// Aviso de que los agentes hosteados están en pausa (ver HOSTED_AGENTS_PAUSED
// en lib/config.ts). Con el interruptor en false no se muestra nada.

import { useT } from "@/app/lib/i18n";
import { HOSTED_AGENTS_PAUSED } from "@/app/lib/config";

export function HostedPausedNotice({ className = "" }: { className?: string }) {
  const { t } = useT();
  if (!HOSTED_AGENTS_PAUSED) return null;
  return (
    <p
      role="status"
      className={`win border-(--color-gold) p-4 text-sm leading-relaxed text-(--color-gold) ${className}`}
    >
      {t("hosted.paused")}
    </p>
  );
}
