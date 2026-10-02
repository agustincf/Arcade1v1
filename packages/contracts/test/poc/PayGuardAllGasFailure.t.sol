// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Escrow1v1} from "../../src/Escrow1v1.sol";
import {PocBase, AllGasRejectUSDC} from "./PocHelpers.sol";

/// F-02. The other side of the same heuristic: a token REJECTION that burns all
/// the gas forwarded to it (INVALID opcode — how a Solidity <0.8 `assert`
/// fails, and FiatTokenV2_2 is 0.6.12 — or any loop that runs out) always
/// leaves the escrow with < 1/64, so `_pay` reverts "insufficient gas" at ANY
/// gas limit. The payment is never credited, and because `_refundPaid` pays
/// both players in one transaction, the OTHER player's refund is blocked too.
/// Every exit that pays the affected address is dead: refundExpired,
/// cancelMatch (owner included), and settle-in-its-favour. Only settle with the
/// other player as winner still works. Nobody (owner included) can rescue it.
///
/// Today's FiatTokenV2_2 rejects with `require` (clean revert), so this is not
/// reachable with the current implementation; it is an upgrade-risk
/// fragility: the v2 fix (credit instead of revert) silently turns back into
/// the v1 lock for this class of failure.
contract PayGuardAllGasFailureTest is PocBase {
    bytes32 constant ID = keccak256("poc-allgas");
    AllGasRejectUSDC tok;
    Escrow1v1 esc;

    function setUp() public {
        _initClock();
        tok = new AllGasRejectUSDC();
        esc = new Escrow1v1(address(tok), arbiter, platform, FEE, owner);
        vm.prank(owner);
        esc.setAllowedStake(STAKE, true);
        _fundMatch(esc, address(tok), ID);
        tok.flag(p2, true); // the token now rejects p2 by burning all gas
    }

    function _alwaysReverts(bytes memory data, address caller) internal returns (bool) {
        uint256 snap = vm.snapshotState();
        for (uint256 g = 100_000; g <= 30_000_000; g = g * 3 / 2) {
            vm.revertToState(snap);
            vm.prank(caller);
            (bool ok,) = address(esc).call{gas: g}(data);
            if (ok) return false;
        }
        vm.revertToState(snap);
        return true;
    }

    function test_refundExpired_lockedForBoth() public {
        vm.warp(uint256(playDl) + GRACE + 1);
        assertTrue(_alwaysReverts(abi.encodeCall(Escrow1v1.refundExpired, (ID)), address(0xBEEF)));
        // and a normal call reverts with the guard's message
        vm.expectRevert(bytes("insufficient gas"));
        esc.refundExpired{gas: 5_000_000}(ID);
        assertEq(uint8(_status(esc, ID)), uint8(Escrow1v1.Status.Funded), "still locked");
        assertEq(tok.balanceOf(p1), 0, "p1 (healthy) cannot get its stake back either");
    }

    function test_cancel_byOwnerAndArbiter_locked() public {
        assertTrue(_alwaysReverts(abi.encodeCall(Escrow1v1.cancelMatch, (ID)), owner));
        assertTrue(_alwaysReverts(abi.encodeCall(Escrow1v1.cancelMatch, (ID)), arbiter));
    }

    function test_settleForAffectedWinner_locked() public {
        uint64 dl = playDl + GRACE;
        bytes memory sig = _result(esc, ID, p2, dl);
        assertTrue(_alwaysReverts(abi.encodeCall(Escrow1v1.settle, (ID, p2, dl, sig)), arbiter));
    }

    function test_onlyExit_isSettleAgainstAffected() public {
        uint64 dl = playDl + GRACE;
        bytes memory sig = _result(esc, ID, p1, dl);
        esc.settle(ID, p1, dl, sig);
        assertEq(tok.balanceOf(p1), 2 * STAKE - (2 * STAKE * FEE) / 10000);
    }
}
