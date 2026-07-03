"use client";

import { useT, LANGS, LANG_LABELS } from "@/app/lib/i18n";

export function LanguageSelector() {
  const { lang, setLang } = useT();
  return (
    <select
      value={lang}
      onChange={(e) => setLang(e.target.value as (typeof LANGS)[number])}
      title="Idioma / Language"
      className="btn3d btn3d--cyan cursor-pointer !px-2 !py-2 !text-px10"
    >
      {LANGS.map((l) => (
        <option key={l} value={l} className="bg-(--color-surface) text-white">
          {LANG_LABELS[l]}
        </option>
      ))}
    </select>
  );
}
