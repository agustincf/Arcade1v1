// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice USDC de prueba para las invariantes: junta en un solo token las tres
///         cosas que pueden hacer fallar un pago del escrow sin que nadie haga
///         nada mal — la BLACKLIST de Circle (la dirección no envía ni recibe),
///         la PAUSA del token entero y un destinatario cuyo cobro cuesta mucho
///         gas (abre la ventana de la guarda de gas de `_pay`). El fuzzer las
///         prende y apaga en cualquier orden, en medio de las partidas.
///
///         A diferencia del real, `mint` no mira ni la pausa ni la blacklist:
///         es solo la forma de darle saldo a un jugador en el test, no una
///         transferencia que el escrow tenga que sobrevivir.
contract ChaosUSDC is ERC20 {
    mapping(address => bool) public blacklisted;
    bool public paused;
    address public hungry;
    uint256 public burn;

    constructor() ERC20("Chaos USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlacklisted(address account, bool on) external {
        blacklisted[account] = on;
    }

    function setPaused(bool on) external {
        paused = on;
    }

    function setHungry(address to, uint256 gasToBurn) external {
        hungry = to;
        burn = gasToBurn;
    }

    function _update(address from, address to, uint256 value) internal override {
        // Acuñar no es una transferencia: no pasa por la pausa ni la blacklist.
        if (from != address(0) && to != address(0)) {
            require(!paused, "Pausable: paused");
            require(!blacklisted[from] && !blacklisted[to], "Blacklistable: account is blacklisted");
            if (to == hungry) {
                uint256 start = gasleft();
                while (start - gasleft() < burn) {}
            }
        }
        super._update(from, to, value);
    }
}
