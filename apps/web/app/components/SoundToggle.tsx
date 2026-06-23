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
  return (
    <button
      onClick={toggle}
      title={on ? "Silenciar efectos" : "Activar efectos"}
      className="btn3d btn3d--cyan !px-3 !py-2 !text-base"
    >
      {on ? "🔊" : "🔇"}
    </button>
  );
}
