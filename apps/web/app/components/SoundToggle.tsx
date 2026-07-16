"use client";

import { useEffect, useState } from "react";
import { ensureAudio, setMuted } from "@/app/lib/sound";

export function SoundToggle() {
  const [on, setOn] = useState(true);

  useEffect(() => {
    const enabled = localStorage.getItem("arcade.sound") !== "off";
    setOn(enabled);
    setMuted(!enabled);

    // Desbloquea el audio con la primera interaccion (regla de los navegadores).
    function first() {
      ensureAudio();
      window.removeEventListener("pointerdown", first);
    }
    window.addEventListener("pointerdown", first);
    return () => window.removeEventListener("pointerdown", first);
  }, []);

  function toggle() {
    const next = !on;
    setOn(next);
    localStorage.setItem("arcade.sound", next ? "on" : "off");
    setMuted(!next);
    ensureAudio();
  }

  // Sin slider: el volumen lo regula el usuario desde su SO (PC/celular).
  // Control "fantasma": el único CTA del header es conectar la wallet.
  return (
    <button
      onClick={toggle}
      title={on ? "Silenciar efectos" : "Activar efectos"}
      aria-label={on ? "Silenciar efectos de sonido" : "Activar efectos de sonido"}
      aria-pressed={on}
      className="rounded-md p-1.5 text-base opacity-60 transition hover:bg-(--color-surface-2) hover:opacity-100"
    >
      <span aria-hidden="true">{on ? "🔊" : "🔇"}</span>
    </button>
  );
}
