// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockUSDC} from "./MockUSDC.sol";

/// @notice USDC de prueba que, UNA vez, llama al contrato objetivo en medio de
///         un `transfer` (como haría un token malicioso o con hooks). Sirve para
///         comprobar que `nonReentrant` corta la reentrada.
contract ReentrantUSDC is MockUSDC {
    address public target;
    bytes public payload;
    bool public armed;

    function arm(address t, bytes calldata p) external {
        target = t;
        payload = p;
        armed = true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (armed) {
            armed = false;
            (bool ok, bytes memory ret) = target.call(payload);
            // Propagar el revert del objetivo tal cual (asi el test ve el error
            // del guard y no un "transfer failed" generico).
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
        return super.transfer(to, amount);
    }
}
