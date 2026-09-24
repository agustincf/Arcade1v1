"use client";

// EL PROBADOR DE CRIATURAS. Un input, la criatura a 128 px y los ocho estados
// en fila. Acepta `?address=0x…` para poder compartir un enlace.
//
// El query se lee de `window.location.search` adentro de un useEffect y NO con
// `useSearchParams()`. NO es por la build: el layout raíz lee `headers()` y
// `cookies()` (`app/layout.tsx:11` y `:145`, `lib/serverLang.ts:10` y `:14`,
// `components/SeoAlternates.tsx:10`), así que TODA ruta de `app/` sale
// dinámica —de ahí la ƒ— y el error de "suspense boundary" no se puede
// disparar; `app/games/_shared/ui.tsx:98` usa `useSearchParams` sin un solo
// <Suspense> alrededor y la build pasa. Es que el probador necesita el query
// UNA vez, al montar, y leerlo del window deja el componente sin depender de
// `next/navigation`.

import { useEffect, useState } from "react";
import { useT } from "@/app/lib/i18n";
import { Criatura } from "@/app/components/aleph/Criatura";
import { ESTADOS } from "@/app/components/aleph/nucleo/criatura";

export default function ProbadorDeCriaturas() {
  const { t } = useT();
  const [address, setAddress] = useState("");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("address");
    if (q) setAddress(q);
  }, []);
  // Con una dirección que no valida se muestra el aviso Y se dibuja igual la
  // criatura desconocida, que es lo que `rasgosDe` devuelve: el probador no
  // tiene un estado de error propio ni una rama vacía.
  const valida = /^0x[0-9a-f]{40}$/.test(address.toLowerCase());
  return (
    <div className="mx-auto max-w-2xl">
      <section className="win mt-3">
        <div className="win-title win-title--cyan">
          <span>{t("aleph.probe.title")}</span>
        </div>
        <div className="p-5">
          <p className="text-sm leading-relaxed text-(--color-muted)">{t("aleph.probe.intro")}</p>
          <label className="mt-4 block text-sm text-(--color-muted-3)" htmlFor="probe-address">
            {t("aleph.probe.label")}
          </label>
          <input
            id="probe-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            spellCheck={false}
            placeholder="0x…"
            className="mt-1 w-full rounded-lg border border-(--color-border) bg-(--color-ink) px-3 py-2 font-mono text-sm text-(--color-muted-bright)"
          />
          {address !== "" && !valida && (
            <p className="mt-2 text-sm text-(--color-lose)">{t("aleph.probe.bad")}</p>
          )}
          <div className="mt-5 flex justify-center">
            {/* Sin `etiquetaA11y`: va `aria-hidden`, porque la dirección está
                escrita en el input de arriba y el nombre de cada estado, abajo. */}
            <Criatura address={address} clase="criatura--probador" />
          </div>
          <ol className="mt-6 flex flex-wrap justify-center gap-4">
            {ESTADOS.map((estado) => (
              <li key={estado} className="flex flex-col items-center gap-1">
                <Criatura address={address} estado={estado} clase="criatura--mesa" />
                <span className="font-mono text-px10 text-(--color-muted-3)">{estado}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
