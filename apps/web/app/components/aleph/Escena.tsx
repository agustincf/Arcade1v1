"use client";

// LA ESCENA. Arma la ventana, declara el contenedor del que cuelga el único
// corte (560 px) y lleva el botón de movimiento. No decide nada: todo lo que
// dibuja sale de `modeloDeEscena`.

import { useEffect, useState } from "react";
import { Asientos } from "./Asientos";
import { CartaEtapa } from "./CartaEtapa";
import { Friso } from "./Friso";
import { Mesa } from "./Mesa";
import { modeloDeEscena } from "./nucleo/escena";
import type { Destello, EtiquetaDeAsiento, Traductor } from "./nucleo/escena";
import type { AsientoDeSala, SalaDeAleph } from "./nucleo/estados";
import { guardarPreferencia, leerPreferencia } from "./nucleo/movimiento";
import { mmss } from "../../lib/tiempo";

export function Escena({
  room,
  now,
  destello,
  t,
  etiquetaDe,
  etiquetaDePorDireccion,
}: {
  room: SalaDeAleph;
  now: number;
  destello: Destello | null;
  t: Traductor;
  etiquetaDe: (seat: AsientoDeSala) => EtiquetaDeAsiento;
  etiquetaDePorDireccion: (address: string) => string;
}) {
  const modelo = modeloDeEscena(room);
  // La preferencia se lee en un efecto, nunca en el render: en el servidor no
  // hay `localStorage` y en la primera pintura puede haber un cuadro de
  // movimiento antes de que se apague. No hay salto de layout ni dato perdido,
  // así que no vale un script inline en el <head>.
  const [conMovimiento, setConMovimiento] = useState(true);
  useEffect(() => {
    setConMovimiento(leerPreferencia());
  }, []);
  useEffect(() => {
    document.body.classList.toggle("sin-movimiento", !conMovimiento);
    return () => document.body.classList.remove("sin-movimiento");
  }, [conMovimiento]);

  const alternar = () => {
    const proximo = !conMovimiento;
    setConMovimiento(proximo);
    guardarPreferencia(proximo);
  };

  return (
    <section className="win escena mt-6">
      <div className="win-title win-title--cyan">
        <span>{t("aleph.scene.title")}</span>
        {/* El único reloj que la barra se queda es el del lobby: los otros ya
            están en pantalla (la carta de etapa en `playing`, el encabezado en
            `funding`) y dos cuentas regresivas iguales a diez píxeles una de
            otra son el duplicado que este mismo rediseño vino a sacar. */}
        {modelo.reloj !== null && (
          <span className="font-mono text-(--color-muted-bright)">{mmss(modelo.reloj - now)}</span>
        )}
      </div>
      <div className="p-3">
        {modelo.carta && (
          <CartaEtapa
            carta={modelo.carta}
            now={now}
            t={t}
            etiquetaDePorDireccion={etiquetaDePorDireccion}
          />
        )}
        {modelo.friso && <Friso friso={modelo.friso} t={t} />}
        {modelo.mesa && <Mesa mesa={modelo.mesa} t={t} />}
        <Asientos modelo={modelo} destello={destello} t={t} etiquetaDe={etiquetaDe} />
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn3d btn3d--cyan btn3d--sm" onClick={alternar}>
            {t(conMovimiento ? "aleph.scene.pause" : "aleph.scene.resume")}
          </button>
        </div>
      </div>
    </section>
  );
}
