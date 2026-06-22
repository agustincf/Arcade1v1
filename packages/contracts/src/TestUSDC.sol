// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice USDC de PRUEBA para testnet (6 decimales, como el real) con `mint`
///         ABIERTO: cualquiera puede acuñar fichas de juego. SOLO para Base
///         Sepolia / demo — NUNCA para producción con dinero real.
contract TestUSDC is ERC20 {
    constructor() ERC20("Test USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Acuña fichas de prueba (gratis) para jugar.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
