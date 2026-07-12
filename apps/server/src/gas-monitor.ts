// Monitor operativo del saldo de gas del árbitro. El árbitro paga las
// cancelaciones/reembolsos automáticos, así que quedarse sin ETH dejaría esas
// salidas pendientes aunque los fondos del escrow sigan seguros.
//
// No persiste nada ni expone secretos: publica solo dirección, saldo, umbral y
// el último chequeo en GET /stats. En producción, con escrow activo, se enciende
// por defecto; en desarrollo se activa solo con GAS_MONITOR_ENABLED=true.

import { createPublicClient, formatEther, http, parseEther, type Address } from "viem";
import { arbiterAddress } from "./sign.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const DEFAULT_THRESHOLD_ETH = "0.005";
const DEFAULT_INTERVAL_MS = 5 * 60_000;
const DEFAULT_ALERT_COOLDOWN_MS = 6 * 60 * 60_000;

export interface GasMonitorConfig {
  address: Address;
  rpcUrl: string;
  thresholdWei: bigint;
  intervalMs: number;
  alertCooldownMs: number;
  webhookUrl?: string;
}

export interface GasSnapshot {
  /** false cuando el entorno no tiene escrow/monitor configurado. */
  enabled: boolean;
  address?: Address;
  balanceWei?: string;
  balanceEth?: string;
  thresholdWei?: string;
  thresholdEth?: string;
  low?: boolean;
  checkedAt?: number;
  lastAlertAt?: number;
  /** Mensaje seguro para mostrar públicamente; nunca incluye URL ni secretos. */
  error?: string;
}

export interface GasAlert {
  address: Address;
  balanceWei: string;
  balanceEth: string;
  thresholdWei: string;
  thresholdEth: string;
  checkedAt: number;
}

export type GasBalanceClient = {
  getBalance(args: { address: Address }): Promise<bigint>;
};
export type GasAlertReporter = (alert: GasAlert) => Promise<void>;

function positiveMs(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 60_000) {
    throw new Error(`${name} debe ser un entero de al menos 60000 ms`);
  }
  return value;
}

/** Construye la config sin guardar ni devolver la clave privada. */
export function gasMonitorConfig(env: NodeJS.ProcessEnv = process.env): GasMonitorConfig | null {
  const escrow = (env.ESCROW_ADDRESS || "").toLowerCase();
  const onchain = !!escrow && escrow !== ZERO;
  const forced = env.GAS_MONITOR_ENABLED;
  if (forced !== undefined && forced !== "true" && forced !== "false") {
    throw new Error("GAS_MONITOR_ENABLED debe ser true o false");
  }
  const enabled =
    forced === "true" || (forced !== "false" && env.NODE_ENV === "production" && onchain);
  if (!enabled) return null;

  if (!env.RPC_URL) throw new Error("Falta RPC_URL para monitorear el gas del árbitro");
  const thresholdEth = env.GAS_ALERT_ETH || DEFAULT_THRESHOLD_ETH;
  let thresholdWei: bigint;
  try {
    thresholdWei = parseEther(thresholdEth);
  } catch {
    throw new Error("GAS_ALERT_ETH debe ser un monto ETH decimal válido");
  }
  if (thresholdWei <= 0n) throw new Error("GAS_ALERT_ETH debe ser mayor que 0");

  return {
    address: arbiterAddress(),
    rpcUrl: env.RPC_URL,
    thresholdWei,
    intervalMs: positiveMs(env.GAS_CHECK_INTERVAL_MS, DEFAULT_INTERVAL_MS, "GAS_CHECK_INTERVAL_MS"),
    alertCooldownMs: positiveMs(
      env.GAS_ALERT_COOLDOWN_MS,
      DEFAULT_ALERT_COOLDOWN_MS,
      "GAS_ALERT_COOLDOWN_MS",
    ),
    webhookUrl: env.GAS_ALERT_WEBHOOK_URL || undefined,
  };
}

/** Estado + política de alerta, separado del scheduler para poder probarlo sin red. */
export class GasMonitor {
  private state: GasSnapshot;

  constructor(
    private readonly config: GasMonitorConfig,
    private readonly client: GasBalanceClient,
    private readonly report: GasAlertReporter,
    private readonly now: () => number = Date.now,
  ) {
    this.state = {
      enabled: true,
      address: config.address,
      thresholdWei: config.thresholdWei.toString(),
      thresholdEth: formatEther(config.thresholdWei),
    };
  }

  snapshot(): GasSnapshot {
    return { ...this.state };
  }

  async check(): Promise<GasSnapshot> {
    const checkedAt = this.now();
    try {
      const balance = await this.client.getBalance({ address: this.config.address });
      const low = balance < this.config.thresholdWei;
      this.state = {
        ...this.state,
        balanceWei: balance.toString(),
        balanceEth: formatEther(balance),
        low,
        checkedAt,
        error: undefined,
      };

      const due =
        low &&
        (this.state.lastAlertAt === undefined ||
          checkedAt - this.state.lastAlertAt >= this.config.alertCooldownMs);
      if (due) {
        // Se registra antes del await para no duplicar alertas si el intervalo se
        // dispara de nuevo mientras el webhook sigue en vuelo.
        this.state.lastAlertAt = checkedAt;
        try {
          await this.report({
            address: this.config.address,
            balanceWei: balance.toString(),
            balanceEth: formatEther(balance),
            thresholdWei: this.config.thresholdWei.toString(),
            thresholdEth: formatEther(this.config.thresholdWei),
            checkedAt,
          });
        } catch {
          this.state.error = "No se pudo enviar la alerta de gas";
        }
      }
    } catch {
      this.state = {
        ...this.state,
        checkedAt,
        error: "No se pudo consultar el saldo de gas del árbitro",
      };
    }
    return this.snapshot();
  }
}

function reporter(webhookUrl: string | undefined): GasAlertReporter {
  return async (alert) => {
    const message =
      `⚠️ Arcade1v1: gas bajo para el árbitro ${alert.address}. ` +
      `Saldo: ${alert.balanceEth} ETH; umbral: ${alert.thresholdEth} ETH.`;
    console.error(message);
    if (!webhookUrl) return;
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message, ...alert }),
    });
    if (!response.ok) throw new Error(`webhook respondió HTTP ${response.status}`);
  };
}

let monitor: GasMonitor | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

/** Arranca un chequeo inmediato y luego periódico. No bloquea el arranque HTTP. */
export function startGasMonitor() {
  if (monitor || timer) return gasSnapshot();
  const config = gasMonitorConfig();
  if (!config) return gasSnapshot();

  const client = createPublicClient({ transport: http(config.rpcUrl) });
  monitor = new GasMonitor(config, client, reporter(config.webhookUrl));
  void monitor.check();
  timer = setInterval(() => void monitor?.check(), config.intervalMs);
  timer.unref?.();
  return monitor.snapshot();
}

/** Foto segura y JSON-friendly para GET /stats. */
export function gasSnapshot(): GasSnapshot {
  return monitor?.snapshot() ?? { enabled: false };
}
