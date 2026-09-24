// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockUSDC} from "./MockUSDC.sol";

/// @notice USDC de prueba con las dos palancas del USDC real de Circle que
///         hacen revertir un pago sin que nadie haga nada mal: la BLACKLIST (la
///         dirección no puede enviar ni recibir) y la PAUSA del token entero.
///         Mientras no se toquen, se comporta igual que MockUSDC.
contract BlacklistUSDC is MockUSDC {
    mapping(address => bool) public blacklisted;
    bool public paused;

    function blacklist(address account, bool on) external {
        blacklisted[account] = on;
    }

    function setPaused(bool on) external {
        paused = on;
    }

    function _update(address from, address to, uint256 value) internal override {
        require(!paused, "Pausable: paused");
        require(!blacklisted[from] && !blacklisted[to], "Blacklistable: account is blacklisted");
        super._update(from, to, value);
    }
}
