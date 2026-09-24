"use client";

import { useT } from "@/app/lib/i18n";
import { PixelIcon } from "@/app/components/PixelIcon";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useT();
  return (
    <div className="mx-auto mt-10 max-w-md">
      <div className="win">
        <div className="win-title">
          <span>{t("err.title")}</span>
        </div>
        <div className="p-6 text-center">
          <PixelIcon name="boom" px={4} className="text-(--color-accent)" />
          <h2 className="font-pixel mt-4 text-px16 uppercase text-(--color-lose)">
            {t("err.head")}
          </h2>
          <p className="mt-2 text-base text-(--color-muted)">{t("err.body")}</p>
          <button onClick={reset} className="btn3d btn3d--magenta mt-5">
            {t("err.retry")}
            <PixelIcon name="play" className="ml-2" />
          </button>
        </div>
      </div>
    </div>
  );
}
