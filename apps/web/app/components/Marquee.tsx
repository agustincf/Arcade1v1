"use client";

import { Fragment } from "react";
import { PixelIcon } from "@/app/components/PixelIcon";
import { useT } from "@/app/lib/i18n";
import { netKey } from "@/app/lib/config";

export function Marquee() {
  const { t } = useT();
  // El diccionario separa las frases con ★ (así se lee bien ahí). Acá cada ★
  // se vuelve un rombo pixel: la estrella de texto caía en la fuente del
  // sistema y era la misma que usa cualquier ticker de plantilla.
  const frases = t(netKey("marquee"))
    .split("★")
    .map((f) => f.trim())
    .filter(Boolean);
  return (
    <div className="marquee">
      <span>
        {frases.map((f, i) => (
          <Fragment key={i}>
            {i > 0 && <PixelIcon name="diamond" className="marquee-sep" />}
            {f}
          </Fragment>
        ))}
      </span>
    </div>
  );
}
