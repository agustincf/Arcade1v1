// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Escrow1v1} from "../src/Escrow1v1.sol";

/**
 * Despliegue a Base MAINNET — DINERO REAL. No se corre a mano: lo corre
 * `deploy-base-mainnet.sh` (deploy-mainnet.ts), que antes chequea que el
 * código sea exactamente el aprobado, la red, la Safe y el saldo, y después
 * relee el contrato desplegado y verifica la fuente en Basescan.
 *
 * Lo que este script fija, sin variables que se puedan equivocar:
 *  - La red: Base mainnet (8453). En cualquier otra, se niega.
 *  - El USDC real de Circle en Base. Nunca un token de prueba.
 *  - La comisión: 15%, la que muestra la web (`PLATFORM_FEE` en
 *    apps/web/app/lib/config.ts). Un test las ata, con las mesas
 *    (packages/contracts/test/deploy-mainnet.test.ts).
 *  - Las mesas: 1, 2, 5 y 10 USDC.
 *
 * Lo que viene por entorno: ARBITER_ADDRESS (la llave del árbitro, resguardada),
 * PLATFORM_WALLET (cobra la comisión) y SAFE_ADDRESS (la Safe multisig que
 * queda de dueña). Firma la Ledger (`--ledger --sender`), que es la dueña
 * mientras habilita las mesas; al final le pasa el contrato a la Safe en dos
 * pasos (Ownable2Step): queda `pendingOwner` hasta que la Safe llama
 * `acceptOwnership()`.
 */
contract DeployMainnet is Script {
    uint256 internal constant BASE_CHAIN_ID = 8453;
    address internal constant USDC_BASE = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    uint16 internal constant FEE_BPS = 1500;

    function run() external {
        require(block.chainid == BASE_CHAIN_ID, "no es Base mainnet (8453)");
        require(USDC_BASE.code.length > 0, "no hay USDC en esta red");

        address arbiter = vm.envAddress("ARBITER_ADDRESS");
        address platform = vm.envAddress("PLATFORM_WALLET");
        address safe = vm.envAddress("SAFE_ADDRESS");
        // Quien firma (`--sender`, la Ledger) es la dueña mientras habilita las mesas.
        address deployer = msg.sender;
        require(deployer != DEFAULT_SENDER, "falta --sender (la Ledger que firma)");
        require(arbiter != address(0) && platform != address(0), "arbiter/platform requeridos");
        require(safe.code.length > 0, "SAFE_ADDRESS no es un contrato (tiene que ser la Safe)");

        vm.startBroadcast(deployer);

        Escrow1v1 escrow = new Escrow1v1(USDC_BASE, arbiter, platform, FEE_BPS, deployer);

        // Mesas del producto: 1, 2, 5 y 10 USDC (6 decimales).
        escrow.setAllowedStake(1_000_000, true);
        escrow.setAllowedStake(2_000_000, true);
        escrow.setAllowedStake(5_000_000, true);
        escrow.setAllowedStake(10_000_000, true);

        // Paso 1 de 2: la Safe queda como dueña pendiente. El paso 2 lo firma
        // la Safe (acceptOwnership); hasta entonces la dueña sigue siendo la Ledger.
        escrow.transferOwnership(safe);

        vm.stopBroadcast();

        // Se chequea en la simulación, antes de mandar nada a la red.
        require(escrow.owner() == deployer && escrow.pendingOwner() == safe, "traspaso a la Safe");
        require(address(escrow.usdc()) == USDC_BASE && escrow.feeBps() == FEE_BPS, "parametros");

        console2.log("Escrow1v1 (MAINNET) desplegado en:", address(escrow));
        console2.log("Duena: la Ledger %s; pendiente: la Safe %s", deployer, safe);
    }
}
