"use client";

// Página "Conseguí fichas" (faucet integrado, solo testnet). El USDC de PRUEBA
// tiene mint abierto (TestUSDC.sol): esta página acuña fichas gratis en un clic
// para que probar las mesas pagas no requiera saber qué es un faucet. También
// enlaza a un faucet de gas de Base Sepolia (hace falta un poco de ETH de prueba
// para pagar el gas del mint) y muestra el saldo, que se actualiza al acuñar.
// En mainnet no existe: el USDC real no tiene mint. Se bloquea con IS_MAINNET.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/app/lib/i18n";
import { useWallet } from "@/app/lib/wallet";
import { useEscrow } from "@/app/lib/useEscrow";
import { onchainEnabled } from "@/app/lib/escrow";
import { IS_MAINNET } from "@/app/lib/config";

// Cantidad que se acuña por clic. 100 USDC de prueba alcanza para varias mesas
// de hasta 10 USDC sin volver a pasar por acá.
const MINT_AMOUNT = 100;

// Lista curada de faucets de gas de Base (testnet ETH para pagar el gas).
const GAS_FAUCET_URL = "https://docs.base.org/tools/network-faucets";

/** Formatea unidades de USDC (6 decimales) a un monto legible, sin decimales
 *  colgando: 100000000n -> "100". */
function fmtUsdc(units: bigint): string {
  const whole = units / 1_000_000n;
  const frac = units % 1_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

export function FaucetClient() {
  const { t } = useT();
  const { address, connected, connect } = useWallet();
  const escrow = useEscrow();

  const [balance, setBalance] = useState<bigint | null>(null);
  const [minting, setMinting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);

  const refreshBalance = useCallback(async () => {
    if (!address || !onchainEnabled) return;
    try {
      setBalance(await escrow.readUsdcBalance(address as `0x${string}`));
    } catch {
      /* la lectura puede fallar si la red no responde; se reintenta al acuñar */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  useEffect(() => {
    if (connected && onchainEnabled) refreshBalance();
    else setBalance(null);
  }, [connected, refreshBalance]);

  async function doMint() {
    if (!address) return;
    setError(false);
    setDone(false);
    setMinting(true);
    try {
      await escrow.mintTestUsdc(address as `0x${string}`, MINT_AMOUNT);
      setDone(true);
      await refreshBalance();
    } catch {
      setError(true);
    } finally {
      setMinting(false);
    }
  }

  // Fuera de testnet (o sin contrato configurado) el faucet no aplica.
  const unavailable = IS_MAINNET || !onchainEnabled;

  return (
    <div className="mx-auto max-w-2xl pb-12">
      <Link href="/" className="text-sm font-medium text-(--color-accent-2) hover:underline">
        {t("back")}
      </Link>

      <h1 className="mt-3 font-pixel text-xl leading-relaxed text-(--color-text-strong)">
        {t("faucet.title")}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-(--color-muted)">{t("faucet.intro")}</p>

      {unavailable ? (
        <div className="win mt-6">
          <div className="win-title">
            <span>{t("faucet.title")}</span>
          </div>
          <p className="p-5 text-center text-base text-(--color-muted)">{t("faucet.mainnet")}</p>
        </div>
      ) : !connected ? (
        <div className="win mt-6">
          <div className="win-title">
            <span>{t("faucet.title")}</span>
          </div>
          <div className="p-6 text-center">
            <p className="text-base text-(--color-muted)">{t("faucet.connectPrompt")}</p>
            <button onClick={connect} className="btn3d btn3d--magenta mt-5 w-full">
              {t("connect")}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Paso 1: gas. Sin un poco de ETH de prueba el mint no se puede firmar. */}
          <div className="win mt-6">
            <div className="win-title win-title--cyan">
              <span>{t("faucet.gasTitle")}</span>
            </div>
            <div className="p-5">
              <p className="text-base leading-relaxed text-(--color-muted)">
                {t("faucet.gasBody")}
              </p>
              <a
                href={GAS_FAUCET_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block text-sm font-medium text-(--color-accent-2) hover:underline"
              >
                {t("faucet.gasLink")} ↗
              </a>
            </div>
          </div>

          {/* Paso 2: acuñar USDC de prueba. */}
          <div className="win mt-4">
            <div className="win-title">
              <span>{t("faucet.mintTitle")}</span>
              <span className="chip !text-(--color-gold)">
                {balance === null ? "…" : `${fmtUsdc(balance)} USDC`}
              </span>
            </div>
            <div className="p-5 text-center">
              <p className="text-base leading-relaxed text-(--color-muted)">
                {t("faucet.mintBody", { n: MINT_AMOUNT })}
              </p>
              <button
                onClick={doMint}
                disabled={minting}
                className="btn3d btn3d--magenta mt-5 w-full disabled:opacity-60"
              >
                {minting ? t("faucet.minting") : t("faucet.mintBtn", { n: MINT_AMOUNT })}
              </button>
              {minting ? (
                <p className="mt-3 text-sm text-(--color-muted-2)">{t("faucet.mintingNote")}</p>
              ) : done ? (
                <p className="mt-3 text-base font-medium text-(--color-win)">{t("faucet.done")}</p>
              ) : error ? (
                <p className="mt-3 text-sm text-(--color-lose)">{t("faucet.error")}</p>
              ) : null}

              {done && (
                <Link
                  href="/"
                  className="mt-4 inline-block text-sm font-medium text-(--color-accent-2) hover:underline"
                >
                  {t("faucet.play")} →
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
