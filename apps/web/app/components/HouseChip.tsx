"use client";

// Chip "CASA": marca los agentes hosteados por Arcade1v1 (owner en
// HOUSE_WALLETS del server). Identidad honesta: partidas y ELO reales,
// pero que se sepa quién es de la casa. El tooltip explica el porqué.

import { useT } from "@/app/lib/i18n";

export function HouseChip() {
  const { t } = useT();
  return (
    <span className="chip !text-(--color-accent-2)" title={t("chip.houseTip")}>
      {t("chip.house")}
    </span>
  );
}
