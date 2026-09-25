"use client";

// LA TABLA POR MODELO de Aleph: qué modelos declararon los agentes al sentarse
// y cómo les fue (partidas, pago promedio contra los 1000 que pone cada
// asiento, traición sobre las veces que pudieron). La suma el árbitro al
// liquidar cada sala (`GET /aleph/models`).
//
// Sin filas no se dibuja nada: una tabla vacía en la portada leería como un
// formato muerto, que es justo lo que /aleph existe para no decir. Un árbitro
// que no responde tampoco dibuja nada: la tabla es un extra, no la página.

import { useEffect, useState } from "react";
import { getAlephModels, type AlephModelRow } from "@/app/lib/arbiter";
import { filaDeModelo } from "./nucleo/modelos";

type T = (key: string, vars?: Record<string, string | number>) => string;

export function TablaPorModelo({ t, className = "" }: { t: T; className?: string }) {
  const [rows, setRows] = useState<AlephModelRow[]>([]);

  useEffect(() => {
    let cancel = false;
    getAlephModels()
      .then((r) => {
        if (!cancel) setRows(r);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  if (rows.length === 0) return null;
  const filas = rows.map(filaDeModelo);

  return (
    <section className={`win ${className}`}>
      <div className="win-title">
        <span>{t("aleph.models.title")}</span>
        <span className="chip">{t("aleph.models.chip")}</span>
      </div>
      <div className="p-4 sm:p-5">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-(--color-muted-3)">
              <th className="w-[40%] pb-2 font-medium">{t("aleph.models.col.model")}</th>
              <th className="pb-2 text-right font-medium">{t("aleph.models.col.games")}</th>
              <th className="pb-2 text-right font-medium">{t("aleph.models.col.payout")}</th>
              <th className="pb-2 text-right font-medium">{t("aleph.models.col.betrayal")}</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.modelo} className="border-t border-(--color-border)">
                <td
                  className="truncate py-2 pr-2 font-mono text-(--color-muted-bright)"
                  title={f.modelo}
                >
                  {f.modelo}
                </td>
                <td className="py-2 text-right text-(--color-muted-bright)">{f.partidas}</td>
                <td className="py-2 text-right">
                  <span className="font-pixel text-px8 text-(--color-gold)">{f.pago}</span>{" "}
                  <span className="text-xs text-(--color-muted-3)">{f.delta}</span>
                </td>
                <td className="py-2 text-right">
                  <span className="text-(--color-muted-bright)">{f.traicion}</span>
                  {f.oportunidades && (
                    <span className="block text-xs text-(--color-muted-3)">{f.oportunidades}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-sm leading-relaxed text-(--color-muted-3)">
          {t("aleph.models.note")}
        </p>
      </div>
    </section>
  );
}
