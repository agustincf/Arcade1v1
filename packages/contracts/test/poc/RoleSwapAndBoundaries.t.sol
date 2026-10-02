// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Escrow1v1} from "../../src/Escrow1v1.sol";
import {MockUSDC} from "../MockUSDC.sol";
import {PocBase} from "./PocHelpers.sol";

/// Role swap (seats don't encode p1/p2) and every time boundary.
contract RoleSwapAndBoundariesTest is PocBase {
    bytes32 constant ID = keccak256("poc-roles");
    MockUSDC tok;
    Escrow1v1 esc;

    function setUp() public {
        _initClock();
        tok = new MockUSDC();
        esc = new Escrow1v1(address(tok), arbiter, platform, FEE, owner);
        vm.prank(owner);
        esc.setAllowedStake(STAKE, true);
        address[2] memory who = [p1, p2];
        for (uint256 i = 0; i < 2; i++) {
            tok.mint(who[i], STAKE);
            vm.prank(who[i]);
            tok.approve(address(esc), STAKE);
        }
    }

    function _open(address who) internal {
        bytes memory s = _seat(esc, ID, who, STAKE, fundDl, playDl);
        vm.prank(who);
        esc.open(ID, STAKE, fundDl, playDl, s);
    }

    function _join(address who) internal {
        bytes memory s = _seat(esc, ID, who, STAKE, fundDl, playDl);
        vm.prank(who);
        esc.join(ID, s);
    }

    /// F-07 (off-chain, Informational): the off-chain p2 can `open` first with
    /// its own seat and becomes the on-chain p1. On-chain this is harmless
    /// (payouts are by address). But the web's "already paid?" shortcut
    /// (apps/web/app/game/[gameId]/match/page.tsx: `role === "p2" ? p2Paid :
    /// p1Paid`) now reads `p1Paid == true` for the off-chain p1 who has NOT
    /// paid -> it skips the deposit and lets the user play a match whose score
    /// the arbiter will reject ("no on-chain deposit").
    function test_offchainP2OpensFirst() public {
        _open(p2); // off-chain p2 opens
        (address a, address b,, bool p1Paid, bool p2Paid,,,) = esc.matches(ID);
        assertEq(a, p2, "on-chain p1 is the off-chain p2");
        assertEq(b, address(0));
        assertTrue(p1Paid && !p2Paid, "web predicate for off-chain p1 (p1Paid) is true although it never paid");

        // off-chain p1's `open` now fails; it must `join` with the SAME seat.
        bytes memory s1 = _seat(esc, ID, p1, STAKE, fundDl, playDl);
        vm.prank(p1);
        vm.expectRevert(bytes("match exists"));
        esc.open(ID, STAKE, fundDl, playDl, s1);
        vm.prank(p1);
        esc.join(ID, s1);

        // Settlement is by address, so either can win.
        uint64 dl = playDl + GRACE;
        esc.settle(ID, p1, dl, _result(esc, ID, p1, dl));
        assertEq(tok.balanceOf(p1), 2 * STAKE - (2 * STAKE * FEE) / 10000);
    }

    // ---- boundaries (HOLD) ----

    function test_joinAtExactFundDeadline_refundOneSecondLater() public {
        _open(p1);
        uint256 snap = vm.snapshotState();
        vm.warp(fundDl);
        vm.expectRevert(bytes("not expired"));
        esc.refundUnfunded(ID);
        _join(p2); // last valid second
        vm.revertToState(snap);

        vm.warp(uint256(fundDl) + 1);
        bytes memory s = _seat(esc, ID, p2, STAKE, fundDl, playDl);
        vm.prank(p2);
        vm.expectRevert(bytes("fund expired"));
        esc.join(ID, s);
        esc.refundUnfunded(ID);
        assertEq(tok.balanceOf(p1), STAKE);
    }

    function test_cancelThenSettle_andSettleThenCancel_noDoublePay() public {
        _open(p1);
        _join(p2);
        uint64 dl = playDl + GRACE;
        bytes memory sig = _result(esc, ID, p1, dl);
        uint256 snap = vm.snapshotState();

        vm.prank(arbiter);
        esc.cancelMatch(ID);
        vm.expectRevert(bytes("not funded"));
        esc.settle(ID, p1, dl, sig);
        assertEq(tok.balanceOf(address(esc)), 0);

        vm.revertToState(snap);
        esc.settle(ID, p1, dl, sig);
        vm.prank(owner);
        vm.expectRevert(bytes("cant cancel"));
        esc.cancelMatch(ID);
        vm.expectRevert(bytes("not funded"));
        esc.refundExpired(ID);
        assertEq(tok.balanceOf(address(esc)), 0);
    }

    function test_refundUnfundedNeverAfterFunded_refundExpiredNeverWhileOpen() public {
        _open(p1);
        vm.warp(uint256(playDl) + GRACE + 1);
        vm.expectRevert(bytes("not funded"));
        esc.refundExpired(ID); // Open match: only refundUnfunded applies
        esc.refundUnfunded(ID);
        vm.expectRevert(bytes("not open"));
        esc.refundUnfunded(ID); // no double refund
    }

    /// Seats and results are domain-separated by contract address: a seat
    /// signed for escrow A does not work on escrow B with the same arbiter.
    function test_crossContractReplay_rejected() public {
        Escrow1v1 other = new Escrow1v1(address(tok), arbiter, platform, FEE, owner);
        vm.prank(owner);
        other.setAllowedStake(STAKE, true);
        bytes memory s = _seat(esc, ID, p1, STAKE, fundDl, playDl);
        vm.prank(p1);
        tok.approve(address(other), STAKE);
        vm.prank(p1);
        vm.expectRevert(bytes("bad seat"));
        other.open(ID, STAKE, fundDl, playDl, s);
    }

    /// A Seat signature is never accepted as a Result (distinct typehashes).
    function test_seatSigIsNotAResult() public {
        _open(p1);
        _join(p2);
        bytes memory seatSig = _seat(esc, ID, p1, STAKE, fundDl, playDl);
        vm.expectRevert(bytes("bad signature"));
        esc.settle(ID, p1, playDl + GRACE, seatSig);
    }

    /// Old-key signatures come back to life if the owner rotates BACK to a key
    /// it used before (Informational; operational note for the runbook).
    function test_rotateBackRevivesOldSignatures() public {
        _open(p1);
        _join(p2);
        uint64 dl = playDl + GRACE;
        bytes memory oldSig = _result(esc, ID, p2, dl);
        vm.startPrank(owner);
        esc.setArbiter(address(0xB0B));
        esc.setArbiter(arbiter); // back to the old key
        vm.stopPrank();
        esc.settle(ID, p2, dl, oldSig);
        assertEq(uint8(_status(esc, ID)), uint8(Escrow1v1.Status.Settled));
    }
}
