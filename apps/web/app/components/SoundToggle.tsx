"use client";

import { useEffect, useState } from "react";
import { ensureAudio, startMusic, stopMusic, setMuted } from "@/app/lib/sound";

export function SoundToggle() {
  const [on, setOn] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("arcade.sound");
    const enabled = saved !== "off";
    setOn(enabled);
    setMuted(!enabled);

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

  return (
    <button
      onClick={toggle}
      title={on ? "Silenciar" : "Activar sonido"}
      className="btn3d btn3d--cyan !px-3 !py-2 !text-base"
    >
      {on ? "🔊" : "🔇"}
    </button>
  );
}
