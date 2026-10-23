// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Escrow1v1} from "../../src/Escrow1v1.sol";
import {MockUSDC} from "../MockUSDC.sol";
import {PocBase} from "./PocHelpers.sol";

/// F-03. The "result expires exactly when the refund opens" invariant is
/// arbiter POLICY only (`resultDeadlineOf` in matchmaking.ts). `settle` accepts
/// any signed `deadline`, so a Result signed with deadline > playDeadline +
/// REFUND_GRACE (clock skew, a config change of SUBMIT_WINDOW_MS vs frozen
/// terms, a restored match whose playDeadline was recomputed, a bug) re-opens
/// the race the grace period was added to close: after playDeadline + GRACE
/// both paths are valid and the LOSER can front-run the winner's (or the
/// arbiter's retried) settle with refundExpired and turn the loss into a
/// refund.
contract ResultDeadlineUnboundedTest is PocBase {
    bytes32 constant ID = keccak256("poc-deadline");
    MockUSDC tok;
    Escrow1v1 esc;

    function setUp() public {
        _initClock();
        tok = new MockUSDC();
        esc = new Escrow1v1(address(tok), arbiter, platform, FEE, owner);
        vm.prank(owner);
        esc.setAllowedStake(STAKE, true);
        _fundMatch(esc, address(tok), ID);
    }

    function test_contractAcceptsDeadlineBeyondRefundOpening() public {
        uint64 lateDl = playDl + GRACE + 7 days;
        bytes memory sig = _result(esc, ID, p1, lateDl);
        vm.warp(uint256(playDl) + GRACE + 1 days); // refund window already open
        esc.settle(ID, p1, lateDl, sig); // accepted: nothing ties deadline to playDeadline
        assertEq(uint8(_status(esc, ID)), uint8(Escrow1v1.Status.Settled));
    }

    function test_loserFrontRunsSettleWithRefund() public {
        uint64 lateDl = playDl + GRACE + 1 hours; // e.g. 1h of skew / misconfig
        bytes memory sig = _result(esc, ID, p1, lateDl);

        // Winner's (or arbiter's retried) settle lands after the refund opened.
        vm.warp(uint256(playDl) + GRACE + 1);

        // Loser p2 sees it in the mempool and front-runs.
        vm.prank(p2);
        esc.refundExpired(ID);

        vm.expectRevert(bytes("not funded"));
        esc.settle(ID, p1, lateDl, sig);

        assertEq(tok.balanceOf(p2), STAKE, "loser got its stake back");
        assertEq(tok.balanceOf(p1), STAKE, "winner only got its own stake");
    }
}
