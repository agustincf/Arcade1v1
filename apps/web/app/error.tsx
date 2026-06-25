"use client";

import { useT } from "@/app/lib/i18n";

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
          <span className="win-dots">
            <span className="win-dot" />
          </span>
        </div>
        <div className="p-6 text-center">
          <div className="text-5xl">💾💥</div>
          <h2 className="font-pixel mt-3 text-sm text-[--color-lose]">{t("err.head")}</h2>
          <p className="font-screen mt-2 text-lg text-slate-300">{t("err.body")}</p>
          <button onClick={reset} className="btn3d btn3d--magenta mt-5">
            {t("err.retry")}
          </button>
        </div>
      </div>
    </div>
  );
}
