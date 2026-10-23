// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Escrow1v1Fixed} from "./Escrow1v1Fixed.sol";
import {MockUSDC} from "../../MockUSDC.sol";
import {DelegatingProxy, HungryImpl, AllGasRejectUSDC} from "../PocHelpers.sol";

/// The suggested fixes for F-01/F-02 (fixed gas budget for the token call)
/// and F-03 (deadline <= playDeadline + REFUND_GRACE), applied to a COPY of
/// the contract (src/ untouched), re-running the PoC scenarios.
contract FixValidationTest is Test {
    uint256 constant ARB_PK = 0xA11CE;
    address arbiter;
    address owner = address(0xABCD);
    address platform = address(0xFEE5);
    address p1 = address(0x1111);
    address p2 = address(0x2222);
    uint256 constant STAKE = 5_000_000;
    uint16 constant FEE = 1500;
    uint64 constant GRACE = 30 minutes;
    bytes32 constant ID = keccak256("fix");
    uint64 fundDl;
    uint64 playDl;

    function setUp() public {
        arbiter = vm.addr(ARB_PK);
        fundDl = uint64(block.timestamp + 70 minutes);
        playDl = uint64(block.timestamp + 2 hours);
    }

    function _sig(bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ARB_PK, d);
        return abi.encodePacked(r, s, v);
    }

    function _deploy(address tok) internal returns (Escrow1v1Fixed esc) {
        esc = new Escrow1v1Fixed(tok, arbiter, platform, FEE, owner);
        vm.prank(owner);
        esc.setAllowedStake(STAKE, true);
        address[2] memory who = [p1, p2];
        for (uint256 i = 0; i < 2; i++) {
            MockUSDC(tok).mint(who[i], STAKE);
            vm.prank(who[i]);
            IERC20(tok).approve(address(esc), STAKE);
            bytes memory s = _sig(esc.seatDigest(ID, who[i], STAKE, fundDl, playDl));
            vm.prank(who[i]);
            if (i == 0) esc.open(ID, STAKE, fundDl, playDl, s);
            else esc.join(ID, s);
        }
    }

    /// F-01 fixed: behind a proxy, a transfer that fits the budget is never
    /// turned into a credit by a hand-picked gas limit.
    function test_fix_F01_proxyTokenWithinBudget_neverForcedCredit() public {
        HungryImpl impl = new HungryImpl();
        HungryImpl tok = HungryImpl(address(new DelegatingProxy(address(impl))));
        Escrow1v1Fixed esc = _deploy(address(tok));
        tok.setHungry(p1, 60_000); // expensive, but under PAY_GAS
        uint64 dl = playDl + GRACE;
        bytes memory data =
            abi.encodeCall(Escrow1v1Fixed.settle, (ID, p1, dl, _sig(esc.resultDigest(ID, p1, dl))));
        uint256 snap = vm.snapshotState();
        uint256 ok;
        for (uint256 g = 50_000; g <= 600_000; g += 250) {
            vm.revertToState(snap);
            (bool s,) = address(esc).call{gas: g}(data);
            if (!s) continue;
            ok++;
            assertEq(esc.owed(p1), 0, "no forced credit");
            assertEq(tok.balanceOf(p1), 2 * STAKE - (2 * STAKE * FEE) / 10000);
        }
        assertGt(ok, 0);
    }

    /// F-01 fixed (the trade-off, documented): a token that needs MORE than
    /// PAY_GAS is treated as rejecting -- deterministically, whatever gas the
    /// caller sends -- and the credit is still withdrawable (withdraw forwards
    /// all gas).
    function test_fix_F01_overBudgetIsDeterministicCredit() public {
        HungryImpl impl = new HungryImpl();
        HungryImpl tok = HungryImpl(address(new DelegatingProxy(address(impl))));
        Escrow1v1Fixed esc = _deploy(address(tok));
        tok.setHungry(p1, 900_000);
        uint64 dl = playDl + GRACE;
        esc.settle{gas: 5_000_000}(ID, p1, dl, _sig(esc.resultDigest(ID, p1, dl)));
        assertEq(esc.owed(p1), 2 * STAKE - (2 * STAKE * FEE) / 10000);
        esc.withdrawFor{gas: 5_000_000}(p1);
        assertEq(tok.balanceOf(p1), 2 * STAKE - (2 * STAKE * FEE) / 10000);
    }

    /// F-02 fixed: an all-gas rejection is credited; the other player's
    /// refund goes through.
    function test_fix_F02_allGasRejectionIsCredited() public {
        AllGasRejectUSDC tok = new AllGasRejectUSDC();
        Escrow1v1Fixed esc = _deploy(address(tok));
        tok.flag(p2, true);
        vm.warp(uint256(playDl) + GRACE + 1);
        esc.refundExpired(ID);
        assertEq(tok.balanceOf(p1), STAKE, "healthy player refunded");
        assertEq(esc.owed(p2), STAKE, "rejected player credited");
    }

    /// F-03 fixed: a result that would outlive the refund opening is refused.
    function test_fix_F03_lateDeadlineRejected() public {
        MockUSDC tok = new MockUSDC();
        Escrow1v1Fixed esc = _deploy(address(tok));
        uint64 lateDl = playDl + GRACE + 1;
        bytes memory sig = _sig(esc.resultDigest(ID, p1, lateDl));
        vm.expectRevert(bytes("deadline too late"));
        esc.settle(ID, p1, lateDl, sig);
        uint64 dl = playDl + GRACE; // the arbiter's policy value still works
        esc.settle(ID, p1, dl, _sig(esc.resultDigest(ID, p1, dl)));
    }
}

/// The fixed copy against the REAL USDC (Base fork): budget is enough for a
/// cold transfer to a fresh address, blacklist is still credited, no forced
/// credit at any gas limit. Skipped unless BASE_RPC_URL is set.
contract FixValidationForkTest is Test {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    uint256 constant ARB_PK = 0xA11CE;
    uint256 constant STAKE = 10_000_000;
    bytes32 constant ID = keccak256("fix-fork");
    Escrow1v1Fixed esc;
    address p1 = makeAddr("fp1");
    address p2 = makeAddr("fp2");
    address platform = makeAddr("fplatform");
    uint64 fundDl;
    uint64 playDl;
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc, 51_972_000);
        forked = true;
        esc = new Escrow1v1Fixed(USDC, vm.addr(ARB_PK), platform, 1500, address(0x5AFE));
        vm.prank(address(0x5AFE));
        esc.setAllowedStake(STAKE, true);
        fundDl = uint64(block.timestamp + 70 minutes);
        playDl = uint64(block.timestamp + 2 hours);
        address[2] memory who = [p1, p2];
        for (uint256 i = 0; i < 2; i++) {
            deal(USDC, who[i], STAKE);
            vm.prank(who[i]);
            IERC20(USDC).approve(address(esc), STAKE);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(ARB_PK, esc.seatDigest(ID, who[i], STAKE, fundDl, playDl));
            vm.prank(who[i]);
            if (i == 0) esc.open(ID, STAKE, fundDl, playDl, abi.encodePacked(r, s, v));
            else esc.join(ID, abi.encodePacked(r, s, v));
        }
    }

    function test_Fork_fix_realUsdc_sweep() public {
        if (!forked) vm.skip(true);
        uint64 dl = playDl + 30 minutes;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ARB_PK, esc.resultDigest(ID, p1, dl));
        bytes memory data = abi.encodeCall(Escrow1v1Fixed.settle, (ID, p1, dl, abi.encodePacked(r, s, v)));
        uint256 snap = vm.snapshotState();
        uint256 ok;
        for (uint256 g = 20_000; g <= 400_000; g += 50) {
            vm.revertToState(snap);
            (bool success,) = address(esc).call{gas: g}(data);
            if (!success) continue;
            ok++;
            assertEq(esc.owed(p1) + esc.owed(platform), 0, "no forced credit");
            assertEq(IERC20(USDC).balanceOf(p1), 17_000_000, "fresh address paid in full (cold path fits PAY_GAS)");
        }
        assertGt(ok, 0);
    }
}
