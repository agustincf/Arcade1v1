// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockUSDC} from "./MockUSDC.sol";

/// @notice USDC de prueba cuyo pago a UNA dirección cuesta mucho gas (como un
///         token con hooks caros). Abre la ventana en la que un envío se queda
///         sin gas mientras el contrato que lo mandó todavía tiene para seguir:
///         la que cierra la guarda de gas de `EscrowAleph._pay`. Con el USDC
///         real esa ventana no se abre (su `transfer` es barato), pero la guarda
///         no depende de cuánto cueste el token.
contract GasHungryUSDC is MockUSDC {
    address public hungry;
    uint256 public burn;

    function setHungry(address to, uint256 gasToBurn) external {
        hungry = to;
        burn = gasToBurn;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (to == hungry) {
            uint256 start = gasleft();
            while (start - gasleft() < burn) {}
        }
        return super.transfer(to, amount);
    }
}
