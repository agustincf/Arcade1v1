// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockUSDC} from "./MockUSDC.sol";

/// @notice Proxy mínimo con la misma forma que el `FiatTokenProxy` del USDC
///         real: `delegatecall(gas, impl, ...)` y devuelve lo que devuelva. El
///         storage de la implementación vive en el proxy. Importa para el gas:
///         si la implementación se queda sin gas, el proxy sobrevive con 1/64
///         y lo devuelve, cosa que una guarda basada en "cuánto gas me queda
///         después" no distingue (hallazgo F-01 de la pre-auditoría).
contract DelegatingProxy {
    address public immutable impl;

    constructor(address _impl) {
        impl = _impl;
    }

    fallback() external payable {
        address i = impl;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let r := delegatecall(gas(), i, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch r
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }
}

/// @notice Implementación cuyo `transfer` a UNA dirección quema el gas que se
///         le pida: "un USDC futuro cuyo transfer es caro". Va DETRÁS de
///         `DelegatingProxy`.
contract HungryImpl is MockUSDC {
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

/// @notice Token que rechaza a una dirección marcada con INVALID (0xfe): se
///         come TODO el gas que recibe, como falla un `assert` de Solidity <0.8
///         (el FiatTokenV2_2 está compilado con 0.6.12). Con la guarda anterior
///         de `_pay` eso hacía revertir cualquier salida que le pagara a esa
///         dirección, también el reembolso del otro jugador (hallazgo F-02).
contract AllGasRejectUSDC is MockUSDC {
    mapping(address => bool) public flagged;

    function flag(address a, bool on) external {
        flagged[a] = on;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (flagged[to]) {
            assembly {
                invalid()
            }
        }
        return super.transfer(to, amount);
    }
}

/// @notice Token cuyo `transfer` paga bien pero responde ~250 KB (la primera
///         palabra es `true`). Generar esa respuesta lo paga el token, dentro
///         de su presupuesto de gas; COPIARLA, si el escrow la copiara entera,
///         lo pagaría quien llama: un "return bomb".
contract ReturnBombUSDC is MockUSDC {
    function transfer(address to, uint256 amount) public override returns (bool) {
        super.transfer(to, amount);
        assembly {
            mstore(0, 1)
            return(0, 250000)
        }
    }
}

/// @notice Token sonda: anota con cuánto gas entró a cada `transfer` (por
///         destinatario). Sirve para probar que el escrow le da SIEMPRE el
///         mismo presupuesto, mande quien llama el gas que mande.
contract GasProbeUSDC is MockUSDC {
    mapping(address => uint256) public seen;

    function transfer(address to, uint256 amount) public override returns (bool) {
        seen[to] = gasleft();
        return super.transfer(to, amount);
    }
}
