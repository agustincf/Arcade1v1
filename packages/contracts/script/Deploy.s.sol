// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Escrow1v1} from "../src/Escrow1v1.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

/**
 * Despliega el escrow (y, si hace falta, un USDC de prueba) en Base Sepolia.
 * Variables de entorno (ver .env.example):
 *   PRIVATE_KEY, ARBITER_ADDRESS, PLATFORM_WALLET, FEE_BPS
 *   USDC_ADDRESS (opcional: si no se setea, se despliega un TestUSDC con mint abierto)
 */
contract Deploy is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address arbiter = vm.envAddress("ARBITER_ADDRESS");
        address platform = vm.envAddress("PLATFORM_WALLET");
        uint16 feeBps = uint16(vm.envUint("FEE_BPS"));
        address owner = vm.addr(deployerPk);
        address usdc = vm.envOr("USDC_ADDRESS", address(0));

        vm.startBroadcast(deployerPk);

        // Si no hay un USDC dado, desplegamos uno de prueba (mint abierto).
        if (usdc == address(0)) {
            TestUSDC mock = new TestUSDC();
            usdc = address(mock);
            console2.log("TestUSDC (mint abierto) desplegado en:", usdc);
        }

        Escrow1v1 escrow = new Escrow1v1(usdc, arbiter, platform, feeBps, owner);

        // Habilitar las mesas del producto: 1, 2, 5 y 10 USDC (6 decimales).
        escrow.setAllowedStake(1_000_000, true);
        escrow.setAllowedStake(2_000_000, true);
        escrow.setAllowedStake(5_000_000, true);
        escrow.setAllowedStake(10_000_000, true);

        vm.stopBroadcast();

        console2.log("Escrow1v1 desplegado en:", address(escrow));
        console2.log("");
        console2.log("=== Pega esto en apps/web/.env.local ===");
        console2.log("NEXT_PUBLIC_ESCROW_ADDRESS=%s", address(escrow));
        console2.log("NEXT_PUBLIC_USDC_ADDRESS=%s", usdc);
        console2.log("=== y esto en apps/server/.env ===");
        console2.log("ESCROW_ADDRESS=%s", address(escrow));
        console2.log("CHAIN_ID=84532");
    }
}
