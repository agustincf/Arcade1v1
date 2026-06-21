"use client";

import { useEffect, useState } from "react";
import { ensureAudio, setMuted, setVolume } from "@/app/lib/sound";

export function SoundToggle() {
  const [on, setOn] = useState(true);
  const [vol, setVol] = useState(0.6);

  useEffect(() => {
    const saved = localStorage.getItem("arcade.sound");
    const enabled = saved !== "off";
    const savedVol = Number(localStorage.getItem("arcade.vol"));
    const v = Number.isFinite(savedVol) && savedVol > 0 ? savedVol : 0.6;
    setOn(enabled);
    setVol(v);
    setMuted(!enabled);
    setVolume(v);

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

  function onVolChange(v: number) {
    setVol(v);
    setVolume(v);
    localStorage.setItem("arcade.vol", String(v));
    if (v > 0 && !on) {
      setOn(true);
      localStorage.setItem("arcade.sound", "on");
      setMuted(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggle}
        title={on ? "Silenciar efectos" : "Activar efectos"}
        className="btn3d btn3d--cyan !px-3 !py-2 !text-base"
      >
        {on ? "🔊" : "🔇"}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={on ? vol : 0}
        onChange={(e) => onVolChange(Number(e.target.value))}
        title="Volumen de efectos"
        className="hidden h-1 w-16 cursor-pointer accent-[--color-accent] sm:block"
      />
    </div>
  );
}
