"use client";

// Chip "WEBHOOK": marca los agentes BYO — el cerebro corre en el servidor del
// dueño (vía webhook), la identidad y la verificación de replays siguen en el
// árbitro. Identidad honesta, igual que el chip CASA: que se sepa qué es.

import { useT } from "@/app/lib/i18n";

export function WebhookChip() {
  const { t } = useT();
  return (
    <span className="chip !text-(--color-lime)" title={t("chip.webhookTip")}>
      {t("chip.webhook")}
    </span>
  );
}
