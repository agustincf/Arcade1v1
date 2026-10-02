// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Test.sol";
import {Escrow1v1} from "../../src/Escrow1v1.sol";
import {BlacklistUSDC} from "../BlacklistUSDC.sol";
import {PocBase} from "./PocHelpers.sol";

/// F-04 (blast radius of the ARBITER key) and F-05/F-06 (OWNER).
contract PrivilegedRolesTest is PocBase {
    BlacklistUSDC tok;
    Escrow1v1 esc;

    uint256 constant ATTACKER_PK = 0xE7117;
    address attacker;

    address h1 = address(0x31);
    address h2 = address(0x32);
    address h3 = address(0x33);

    bytes32 constant OPEN1 = keccak256("open-1");
    bytes32 constant OPEN2 = keccak256("open-2");
    bytes32 constant OPEN3 = keccak256("open-3");
    bytes32 constant FUNDED = keccak256("funded");

    function setUp() public {
        _initClock();
        attacker = vm.addr(ATTACKER_PK);
        tok = new BlacklistUSDC();
        esc = new Escrow1v1(address(tok), arbiter, platform, FEE, owner);
        vm.startPrank(owner);
        esc.setAllowedStake(1_000_000, true);
        esc.setAllowedStake(5_000_000, true);
        esc.setAllowedStake(10_000_000, true);
        vm.stopPrank();

        // Three honest players each opened a match and are waiting for a rival.
        _openHonest(OPEN1, h1, 10_000_000);
        _openHonest(OPEN2, h2, 5_000_000);
        _openHonest(OPEN3, h3, 1_000_000);
        // One honest match already Funded between p1 and p2.
        _openHonest(FUNDED, p1, 10_000_000);
        _joinHonest(FUNDED, p2, 10_000_000);
    }

    function _openHonest(bytes32 id, address who, uint256 st) internal {
        tok.mint(who, st);
        vm.prank(who);
        tok.approve(address(esc), st);
        bytes memory s = _seat(esc, id, who, st, fundDl, playDl);
        vm.prank(who);
        esc.open(id, st, fundDl, playDl, s);
    }

    function _joinHonest(bytes32 id, address who, uint256 st) internal {
        tok.mint(who, st);
        vm.prank(who);
        tok.approve(address(esc), st);
        bytes memory s = _seat(esc, id, who, st, fundDl, playDl);
        vm.prank(who);
        esc.join(id, s);
    }

    /// Everything an attacker holding the arbiter key needs is public: the
    /// stored terms of every Open match are readable from `matches(id)`.
    function _stealOpen(bytes32 id, uint256 signerPk) internal returns (uint256 net) {
        uint64 p = _joinAsAttacker(id, signerPk);
        uint256 before = tok.balanceOf(attacker);
        uint64 dl = p + GRACE;
        bytes memory rs = _sig(signerPk, esc.resultDigest(id, attacker, dl));
        vm.prank(attacker);
        esc.settle(id, attacker, dl, rs);
        (,, uint256 st,,,,,) = esc.matches(id);
        net = tok.balanceOf(attacker) - before - st; // prize - own stake = profit
    }

    function _joinAsAttacker(bytes32 id, uint256 signerPk) internal returns (uint64 p) {
        (,, uint256 st,,, uint64 f, uint64 pd,) = esc.matches(id);
        p = pd;
        tok.mint(attacker, st); // attacker brings its own stake
        bytes memory seat = _sig(signerPk, esc.seatDigest(id, attacker, st, f, pd));
        vm.startPrank(attacker);
        tok.approve(address(esc), st);
        esc.join(id, seat);
        vm.stopPrank();
    }

    /// F-04: a leaked arbiter key takes the waiting player's stake in EVERY
    /// Open match (profit = stake - 2*stake*fee), right away, no waiting.
    function test_arbiterKey_drainsEveryOpenMatch() public {
        uint256 profit = _stealOpen(OPEN1, ARBITER_PK) + _stealOpen(OPEN2, ARBITER_PK) + _stealOpen(OPEN3, ARBITER_PK);
        uint256 victimsLoss = 10_000_000 + 5_000_000 + 1_000_000;
        console2.log("victims lost (micro-USDC):", victimsLoss);
        console2.log("attacker profit          :", profit);
        console2.log("fees to platform         :", victimsLoss - profit);
        assertEq(profit, victimsLoss - (2 * victimsLoss * FEE) / 10000);
        assertEq(tok.balanceOf(h1) + tok.balanceOf(h2) + tok.balanceOf(h3), 0, "victims got nothing back");
    }

    /// F-04 (bound): the same key can NOT pull a Funded match between two other
    /// players to itself — it can only pick p1 or p2, or cancel.
    function test_arbiterKey_cannotRedirectFundedMatch() public {
        uint64 dl = playDl + GRACE;
        bytes memory sig = _result(esc, FUNDED, attacker, dl);
        vm.expectRevert(bytes("bad winner"));
        esc.settle(FUNDED, attacker, dl, sig);
        // No seat can take a slot that is already filled.
        bytes memory seat = _seat(esc, FUNDED, attacker, 10_000_000, fundDl, playDl);
        vm.prank(attacker);
        vm.expectRevert(bytes("not open"));
        esc.join(FUNDED, seat);
    }

    /// F-04 (lock): a compromised/buggy arbiter can hand out seats with absurd
    /// terms; the contract accepts any playDeadline > fundDeadline. With
    /// playDeadline = uint64.max, refundExpired never opens; only the owner's
    /// cancelMatch gets the players out (and the compromised arbiter could also
    /// simply never settle).
    function test_arbiterKey_seatTermsCanLockUntilOwnerCancels() public {
        bytes32 id = keccak256("forever");
        uint64 f = uint64(block.timestamp + 1 hours);
        uint64 p = type(uint64).max;
        address[2] memory who = [address(0x41), address(0x42)];
        for (uint256 i = 0; i < 2; i++) {
            tok.mint(who[i], 1_000_000);
            vm.prank(who[i]);
            tok.approve(address(esc), 1_000_000);
            bytes memory s = _seat(esc, id, who[i], 1_000_000, f, p);
            vm.prank(who[i]);
            if (i == 0) esc.open(id, 1_000_000, f, p, s);
            else esc.join(id, s);
        }
        vm.warp(block.timestamp + 100 * 365 days);
        vm.expectRevert(bytes("not expired"));
        esc.refundExpired(id);
        vm.prank(owner);
        esc.cancelMatch(id);
        assertEq(tok.balanceOf(who[0]) + tok.balanceOf(who[1]), 2_000_000, "owner is the only backstop");
    }

    /// F-05: the owner can hand itself the arbiter role (instant, one tx) and
    /// then do everything in F-04; plus raise the fee on in-flight matches.
    function test_owner_becomesArbiter_andRaisesFeeInFlight() public {
        vm.startPrank(owner);
        esc.setArbiter(attacker);
        esc.setFeeBps(2000); // MAX, applies to the already-Funded match
        esc.setPlatformWallet(attacker);
        vm.stopPrank();

        uint256 profit = _stealOpen(OPEN1, ATTACKER_PK);
        assertGt(profit, 0);

        // Funded honest match: winner p1 gets 80% instead of the 85% it signed up for.
        uint64 dl = playDl + GRACE;
        esc.settle(FUNDED, p1, dl, _sig(ATTACKER_PK, esc.resultDigest(FUNDED, p1, dl)));
        assertEq(tok.balanceOf(p1), 16_000_000, "80% of the 20 USDC pot");
    }

    /// F-06 (Informational): nothing stops platformWallet == the escrow itself
    /// (or the USDC contract). Fees paid there are silently stranded: they are
    /// neither in `owed` nor in any match, and there is no sweep.
    function test_owner_platformWalletIsEscrow_strandsFees() public {
        vm.prank(owner);
        esc.setPlatformWallet(address(esc));
        uint64 dl = playDl + GRACE;
        esc.settle(FUNDED, p1, dl, _result(esc, FUNDED, p1, dl));
        uint256 fee = (uint256(20_000_000) * FEE) / 10000;
        // Remaining custody: 3 open stakes + the stranded fee, nothing owed.
        assertEq(tok.balanceOf(address(esc)), 16_000_000 + fee, "fee stuck inside the escrow");
        assertEq(esc.owed(address(esc)), 0, "not even withdrawable as a credit");
    }
}
