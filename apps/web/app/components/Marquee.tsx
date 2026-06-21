"use client";

import { useT } from "@/app/lib/i18n";

export function Marquee() {
  const { t } = useT();
  return (
    <div className="marquee">
      <span>{t("marquee")}</span>
    </div>
  );
}
