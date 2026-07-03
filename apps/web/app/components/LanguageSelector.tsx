"use client";

import { useT, LANGS, LANG_LABELS } from "@/app/lib/i18n";

export function LanguageSelector() {
  const { lang, setLang } = useT();
  return (
    <select
      value={lang}
      onChange={(e) => setLang(e.target.value as (typeof LANGS)[number])}
      title="Idioma / Language"
      className="cursor-pointer rounded-md bg-transparent p-1.5 text-sm font-semibold text-(--color-muted-2) transition hover:bg-(--color-surface-2) hover:text-(--color-text)"
    >
      {LANGS.map((l) => (
        <option key={l} value={l} className="bg-(--color-surface) text-white">
          {LANG_LABELS[l]}
        </option>
      ))}
    </select>
  );
}
