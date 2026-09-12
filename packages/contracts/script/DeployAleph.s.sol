// packages/contracts/script/DeployAleph.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {EscrowAleph} from "../src/EscrowAleph.sol";

/**
 * Despliega EscrowAleph (mesas de plata de Aleph) sobre un USDC YA existente y
 * habilita la unica mesa de la etapa 4 (2 USDC). Variables de entorno:
 *   PRIVATE_KEY, USDC_ADDRESS (obligatoria: el TestUSDC ya desplegado),
 *   ARBITER_ADDRESS, PLATFORM_WALLET, FEE_BPS
 *   ALEPH_STAKE (opcional, en unidades de 6 decimales; default 2_000_000)
 */
contract DeployAleph is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address arbiter = vm.envAddress("ARBITER_ADDRESS");
        address platform = vm.envAddress("PLATFORM_WALLET");
        uint16 feeBps = uint16(vm.envUint("FEE_BPS"));
        uint256 stake = vm.envOr("ALEPH_STAKE", uint256(2_000_000));
        address owner = vm.addr(deployerPk);

        vm.startBroadcast(deployerPk);
        EscrowAleph escrow = new EscrowAleph(usdc, arbiter, platform, feeBps, owner);
        escrow.setAllowedStake(stake, true);
        vm.stopBroadcast();

        console2.log("EscrowAleph desplegado en:", address(escrow));
        console2.log("USDC:", usdc);
        console2.log("mesa habilitada (unidades):", stake);
        console2.log("");
        // La web NO necesita variable nueva: la direccion del escrow viaja en la
        // vista de cada sala (`escrow`) y el link al explorador sale de CHAIN_ID.
        console2.log("=== Pega esto en apps/server (Render) ===");
        console2.log("ALEPH_ESCROW_ADDRESS=%s", address(escrow));
        console2.log("ALEPH_STAKES=0,2");
    }
}
