// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Escrow1v1} from "../src/Escrow1v1.sol";

/**
 * Despliegue a Base MAINNET — DINERO REAL.
 *
 * Diferencias clave con el de testnet (Deploy.s.sol):
 *  - USA EL USDC REAL de Base (USDC_ADDRESS obligatorio). NUNCA despliega un token
 *    de prueba: si falta, revierte.
 *  - El firmante lo provee `forge` por fuera con una WALLET DE HARDWARE
 *    (--ledger / --trezor) o un keystore (--account). NO hay PRIVATE_KEY en .env.
 *  - El dueño del contrato (admin) es OWNER_ADDRESS, que debe ser esa misma wallet
 *    segura (la que firma). Más adelante se puede transferir a un multisig (Safe).
 *
 * Variables de entorno (ver .env.mainnet.example):
 *   USDC_ADDRESS      = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913  (USDC real de Base)
 *   ARBITER_ADDRESS   = dirección del backend que firma resultados (su llave, resguardada)
 *   PLATFORM_WALLET   = wallet que cobra la comisión
 *   FEE_BPS           = 1500  (15%)
 *   OWNER_ADDRESS     = la wallet segura que despliega y queda como dueña (== --sender)
 *
 * Uso (con Ledger):
 *   forge script script/DeployMainnet.s.sol:DeployMainnet \
 *     --rpc-url "$BASE_MAINNET_RPC_URL" --ledger --sender "$OWNER_ADDRESS" --broadcast
 */
contract DeployMainnet is Script {
    function run() external {
        address usdc = vm.envAddress("USDC_ADDRESS");
        address arbiter = vm.envAddress("ARBITER_ADDRESS");
        address platform = vm.envAddress("PLATFORM_WALLET");
        uint16 feeBps = uint16(vm.envUint("FEE_BPS"));
        address owner = vm.envAddress("OWNER_ADDRESS");

        // Guardas de seguridad: nada de tokens de prueba ni dueños vacíos en mainnet.
        require(usdc != address(0), "USDC_ADDRESS requerido (USDC real de Base)");
        require(owner != address(0), "OWNER_ADDRESS requerido (wallet segura)");
        require(arbiter != address(0) && platform != address(0), "arbiter/platform requeridos");

        vm.startBroadcast(); // firma = el firmante de forge (--ledger / --account)

        Escrow1v1 escrow = new Escrow1v1(usdc, arbiter, platform, feeBps, owner);

        // Mesas del producto: 1, 2, 5 y 10 USDC (6 decimales). Requiere que quien
        // firma sea el dueño (por eso OWNER_ADDRESS debe ser == --sender).
        escrow.setAllowedStake(1_000_000, true);
        escrow.setAllowedStake(2_000_000, true);
        escrow.setAllowedStake(5_000_000, true);
        escrow.setAllowedStake(10_000_000, true);

        vm.stopBroadcast();

        console2.log("Escrow1v1 (MAINNET) desplegado en:", address(escrow));
        console2.log("USDC (real):", usdc);
        console2.log("Owner (admin):", owner);
        console2.log("");
        console2.log("=== Pega en apps/web/.env.local (produccion) ===");
        console2.log("NEXT_PUBLIC_CHAIN_ID=8453");
        console2.log("NEXT_PUBLIC_ESCROW_ADDRESS=%s", address(escrow));
        console2.log("NEXT_PUBLIC_USDC_ADDRESS=%s", usdc);
        console2.log("=== y en apps/server/.env (produccion) ===");
        console2.log("CHAIN_ID=8453");
        console2.log("ESCROW_ADDRESS=%s", address(escrow));
    }
}
