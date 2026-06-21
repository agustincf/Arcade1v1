"use client";

import { useEffect, useState } from "react";
import {
  ensureAudio,
  startMusic,
  stopMusic,
  setMuted,
  setVolume,
} from "@/app/lib/sound";

export function SoundToggle() {
  const [on, setOn] = useState(true);
  const [vol, setVol] = useState(0.5);

  useEffect(() => {
    const saved = localStorage.getItem("arcade.sound");
    const enabled = saved !== "off";
    const savedVol = Number(localStorage.getItem("arcade.vol"));
    const v = Number.isFinite(savedVol) && savedVol > 0 ? savedVol : 0.5;
    setOn(enabled);
    setVol(v);
    setMuted(!enabled);
    setVolume(v);

    // La musica arranca con la primera interaccion (regla de los navegadores).
    function first() {
      ensureAudio();
      if (enabled) startMusic();
      window.removeEventListener("pointerdown", first);
    }
    window.addEventListener("pointerdown", first);
    return () => window.removeEventListener("pointerdown", first);
  }, []);

  // Pausa la musica cuando la pestaña queda en segundo plano; la retoma al volver.
  useEffect(() => {
    function onVis() {
      if (document.hidden) stopMusic();
      else if (on) {
        ensureAudio();
        startMusic();
      }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [on]);

  function toggle() {
    const next = !on;
    setOn(next);
    localStorage.setItem("arcade.sound", next ? "on" : "off");
    setMuted(!next);
    ensureAudio();
    if (next) startMusic();
    else stopMusic();
  }

  function onVolChange(v: number) {
    setVol(v);
    setVolume(v);
    localStorage.setItem("arcade.vol", String(v));
    if (v > 0 && !on) toggle(); // subir el volumen reactiva el sonido
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggle}
        title={on ? "Silenciar" : "Activar sonido"}
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
        title="Volumen"
        className="hidden h-1 w-16 cursor-pointer accent-[--color-accent] sm:block"
      />
    </div>
  );
}
