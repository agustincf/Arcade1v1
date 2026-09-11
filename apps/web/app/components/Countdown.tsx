"use client";

// Cuenta regresiva a un instante (epoch ms) que manda el árbitro: el cierre de
// un lobby o el plazo de una fase. El reloj es el del visitante, así que el
// primer render (el del servidor) NO muestra número: si calculara la hora acá,
// React marcaría desajuste de hidratación.
import { useEffect, useState } from "react";

/** mm:ss, con piso en 0: un plazo vencido muestra 0:00, nunca -1:-3. */
export function formatLeft(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** `onZero` se llama UNA vez al llegar a cero: la página lo usa para refrescar
 *  sin esperar al próximo sondeo (la fase ya cambió del lado del árbitro). */
export function Countdown({ to, onZero }: { to: number; onZero?: () => void }) {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    let fired = false;
    const tick = () => {
      const ms = to - Date.now();
      setLeft(ms);
      if (ms <= 0 && !fired) {
        fired = true;
        onZero?.();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [to, onZero]);

  if (left === null) return null;
  return <span className="font-mono tabular-nums">{formatLeft(left)}</span>;
}
