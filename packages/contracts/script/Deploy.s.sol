// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Escrow1v1} from "../src/Escrow1v1.sol";

/**
 * Despliega el contrato de escrow en Base Sepolia (testnet).
 * Lee la configuracion de variables de entorno (ver .env.example):
 *   PRIVATE_KEY, USDC_ADDRESS, ARBITER_ADDRESS, PLATFORM_WALLET, FEE_BPS
 */
contract Deploy is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address arbiter = vm.envAddress("ARBITER_ADDRESS");
        address platform = vm.envAddress("PLATFORM_WALLET");
        uint16 feeBps = uint16(vm.envUint("FEE_BPS"));
        address owner = vm.addr(deployerPk);

        vm.startBroadcast(deployerPk);

        Escrow1v1 escrow = new Escrow1v1(usdc, arbiter, platform, feeBps, owner);

        // Habilitar las mesas: 5, 10, 20, 50 y 100 USDC (6 decimales).
        escrow.setAllowedStake(5_000_000, true);
        escrow.setAllowedStake(10_000_000, true);
        escrow.setAllowedStake(20_000_000, true);
        escrow.setAllowedStake(50_000_000, true);
        escrow.setAllowedStake(100_000_000, true);

        vm.stopBroadcast();

        console2.log("Escrow1v1 desplegado en:", address(escrow));
    }
}
