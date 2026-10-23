// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Escrow1v1} from "../../src/Escrow1v1.sol";
import {MockUSDC} from "../MockUSDC.sol";

/// @notice Minimal ERC-1967-style delegating proxy, same shape as Circle's
///         FiatTokenProxy `_delegate`: delegatecall(gas, impl, ...) and bubble
///         the result. The implementation's storage lives in the proxy.
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

/// @notice Token whose transfer to one address burns a configurable amount of
///         gas (stand-in for "an implementation whose transfer is expensive").
///         Designed to sit BEHIND DelegatingProxy.
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

/// @notice Token that rejects a flagged recipient by executing INVALID (0xfe),
///         which consumes ALL gas forwarded to it — the way a Solidity <0.8
///         `assert` fails (FiatTokenV2_2 is compiled with 0.6.12). Everything
///         else behaves like MockUSDC.
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

/// @notice Shared plumbing for the PoCs: arbiter key, seat/result signing,
///         funding a match on an arbitrary escrow/token pair.
abstract contract PocBase is Test {
    uint256 internal constant ARBITER_PK = 0xA11CE;
    address internal arbiter;
    address internal owner = address(0xABCD);
    address internal platform = address(0xFEE5);
    address internal p1 = address(0x1111);
    address internal p2 = address(0x2222);
    uint256 internal constant STAKE = 5_000_000;
    uint16 internal constant FEE = 1500;
    uint64 internal constant GRACE = 30 minutes;

    uint64 internal fundDl;
    uint64 internal playDl;

    function _initClock() internal {
        arbiter = vm.addr(ARBITER_PK);
        fundDl = uint64(block.timestamp + 70 minutes);
        playDl = uint64(block.timestamp + 2 hours);
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _seat(Escrow1v1 esc, bytes32 id, address who, uint256 st, uint64 f, uint64 p)
        internal
        view
        returns (bytes memory)
    {
        return _sig(ARBITER_PK, esc.seatDigest(id, who, st, f, p));
    }

    function _result(Escrow1v1 esc, bytes32 id, address winner, uint64 dl) internal view returns (bytes memory) {
        return _sig(ARBITER_PK, esc.resultDigest(id, winner, dl));
    }

    /// Mint + approve + open (p1) + join (p2) with the standard terms.
    function _fundMatch(Escrow1v1 esc, address tok, bytes32 id) internal {
        address[2] memory who = [p1, p2];
        for (uint256 i = 0; i < 2; i++) {
            MockUSDC(tok).mint(who[i], STAKE);
            vm.prank(who[i]);
            IERC20(tok).approve(address(esc), STAKE);
            bytes memory s = _seat(esc, id, who[i], STAKE, fundDl, playDl);
            vm.prank(who[i]);
            if (i == 0) esc.open(id, STAKE, fundDl, playDl, s);
            else esc.join(id, s);
        }
    }

    function _status(Escrow1v1 esc, bytes32 id) internal view returns (Escrow1v1.Status st) {
        (,,,,,,, st) = esc.matches(id);
    }
}
