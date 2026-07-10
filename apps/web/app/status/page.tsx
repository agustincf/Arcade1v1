import type { Metadata } from "next";
import { StatusClient } from "./StatusClient";

// Página pública de estado del sistema: datos reales del árbitro (uptime,
// partidas, anti-trampa, agentes activos). Es indexable a propósito — la
// transparencia es parte del posicionamiento (verificado on-chain / benchmark).
export const metadata: Metadata = {
  title: "System status",
  description:
    "Live, real metrics from the Arcade1v1 arbiter: uptime, matches, anti-cheat rejects.",
};

export default function Page() {
  return <StatusClient />;
}
