"use client";

// "Tu wallet está en otra red": la ventana que abre el encabezado cuando la
// wallet está en una red que la app no usa. Reemplaza la de RainbowKit, que
// decía "Confirmar en la cartera" para siempre si el pedido no llegaba al
// celular (conectado con el QR de MetaMask). Esta, pasados SWITCH_STUCK_MS sin
// respuesta, explica cómo cambiar la red a mano en la wallet y deja
// desconectar. Las fases viven en lib/cambio-de-red.ts.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDisconnect, useSwitchChain } from "wagmi";
import { CHAIN } from "@/app/lib/wagmi";
import { useT } from "@/app/lib/i18n";
import { isSignCancelled } from "@/app/lib/errors";
import {
  canRequestSwitch,
  nextSwitchPhase,
  showsManualHelp,
  SWITCH_STUCK_MS,
  type SwitchEvent,
  type SwitchPhase,
} from "@/app/lib/cambio-de-red";

/** `initialPhase`: "failed" cuando se abre sola al conectar, porque el cambio
 *  de red que pidió la conexión no llegó a tiempo (ya explica cómo hacerlo a
 *  mano); "idle" cuando la abre el usuario. */
export function WrongNetworkDialog({
  onClose,
  initialPhase = "idle",
}: {
  onClose: () => void;
  initialPhase?: SwitchPhase;
}) {
  const { t } = useT();
  const { switchChainAsync } = useSwitchChain();
  const { disconnectAsync } = useDisconnect();
  const [phase, setPhase] = useState<SwitchPhase>(initialPhase);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const send = (e: SwitchEvent) => setPhase((p) => nextSwitchPhase(p, e));
  // El encabezado pasa un onClose nuevo en cada render: por ref, para que el
  // efecto corra una sola vez y no corte el tope de espera a cada render.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    primary.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function doSwitch() {
    if (!canRequestSwitch(phase)) return;
    send("start");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => send("timeout"), SWITCH_STUCK_MS);
    try {
      // Si la wallet cambia, el encabezado deja de estar en "otra red" y esta
      // ventana se cierra sola (también si el usuario cambia a mano en la app).
      await switchChainAsync({ chainId: CHAIN.id });
    } catch (e) {
      send(isSignCancelled(e) ? "rejected" : "failed");
    } finally {
      if (timer.current) clearTimeout(timer.current);
    }
  }

  async function doDisconnect() {
    try {
      await disconnectAsync();
    } catch {
      /* la sesión ya estaba cortada */
    }
    onClose();
  }

  const pending = !canRequestSwitch(phase);

  // Portal al <body>: el encabezado tiene backdrop-blur, y un `fixed` adentro
  // de un elemento con filtro queda atado a él (la ventana salía recortada
  // dentro del encabezado).
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-(--color-scrim) p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="net-title"
        className="win my-auto w-full max-w-sm"
      >
        <div className="win-title">
          <span id="net-title">{t("net.title")}</span>
          <button
            onClick={onClose}
            aria-label={t("close")}
            className="text-(--color-muted-2) transition hover:text-(--color-text)"
          >
            ✕
          </button>
        </div>
        <div className="p-6 text-center">
          <p className="text-base leading-relaxed text-(--color-muted)">
            {t("net.body", { chain: CHAIN.name })}
          </p>
          <button
            ref={primary}
            onClick={doSwitch}
            disabled={pending}
            className="btn3d btn3d--magenta mt-5 w-full disabled:opacity-60"
          >
            {pending ? t("net.switching") : t("net.switch", { chain: CHAIN.name })}
          </button>
          {/* aria-live: el lector de pantalla avisa cuando cambia la fase */}
          <div aria-live="polite">
            {pending && (
              <p className="mx-auto mt-3 max-w-sm text-sm text-(--color-muted-2)">
                {t("net.waiting")}
              </p>
            )}
            {phase === "rejected" && (
              <p className="mt-3 text-sm text-(--color-lose)">{t("net.rejected")}</p>
            )}
            {phase === "failed" && (
              <p className="mt-3 text-sm text-(--color-lose)">
                {t("net.failed", { chain: CHAIN.name })}
              </p>
            )}
            {showsManualHelp(phase) && (
              <p className="mx-auto mt-3 max-w-sm text-sm font-medium text-(--color-accent-2)">
                {t("net.manual", { chain: CHAIN.name })}
              </p>
            )}
          </div>
          <button
            onClick={doDisconnect}
            className="mt-5 text-sm font-medium text-(--color-muted-2) underline underline-offset-4 transition hover:text-(--color-text)"
          >
            {t("net.disconnect")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
