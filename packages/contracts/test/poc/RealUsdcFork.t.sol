// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Escrow1v1} from "../../src/Escrow1v1.sol";

interface IFiatToken {
    function blacklist(address) external;
    function unBlacklist(address) external;
    function pause() external;
    function unpause() external;
    function blacklister() external view returns (address);
    function pauser() external view returns (address);
    function isBlacklisted(address) external view returns (bool);
}

/// Forwards EXACTLY `x` gas to the token and reports how much this frame
/// spent. For an OOG in the frame we called, spent = overhead + x. If the OOG
/// happens one level deeper (FiatTokenProxy -> DELEGATECALL implementation),
/// the proxy survives with 1/64 of its gas and hands it back, so spent drops
/// below overhead + x. The difference is the gas a caller gets back from a
/// failed transfer that `_pay`'s 1/63 guard assumes it never gets.
contract GasReturnProbe {
    function measure(address token, bytes calldata data, uint256 x) external returns (bool ok, uint256 spent) {
        bytes memory d = data;
        uint256 g0 = gasleft();
        assembly {
            ok := call(x, token, 0, add(d, 32), mload(d), 0, 0)
        }
        spent = g0 - gasleft();
    }
}

/// Everything against Circle's REAL USDC on a Base mainnet fork
/// (FiatTokenProxy 0x8335...2913 -> FiatTokenV2_2). Skipped unless
/// BASE_RPC_URL is set:  BASE_RPC_URL=https://mainnet.base.org forge test --mt Fork
contract RealUsdcForkTest is Test {
    using SafeERC20 for IERC20;

    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    uint256 constant FORK_BLOCK = 51_972_000;
    uint256 constant ARB_PK = 0xA11CE;
    uint64 constant GRACE = 30 minutes;
    uint256 constant STAKE = 10_000_000; // the biggest table
    uint16 constant FEE = 1500;

    Escrow1v1 esc;
    IERC20 usdc = IERC20(USDC);
    IFiatToken fiat = IFiatToken(USDC);
    address arbiter;
    address owner = address(0x5AFE);
    address platform = makeAddr("platform");
    address p1 = makeAddr("p1");
    address p2 = makeAddr("p2");
    bytes32 constant ID = keccak256("fork-match");
    uint64 fundDl;
    uint64 playDl;
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc, FORK_BLOCK);
        forked = true;
        arbiter = vm.addr(ARB_PK);
        esc = new Escrow1v1(USDC, arbiter, platform, FEE, owner);
        vm.prank(owner);
        esc.setAllowedStake(STAKE, true);
        fundDl = uint64(block.timestamp + 70 minutes);
        playDl = uint64(block.timestamp + 2 hours);
        deal(USDC, p1, STAKE);
        deal(USDC, p2, STAKE);
        vm.prank(p1);
        usdc.approve(address(esc), STAKE);
        vm.prank(p2);
        usdc.approve(address(esc), STAKE);
    }

    modifier onFork() {
        if (!forked) vm.skip(true);
        _;
    }

    function _sig(bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ARB_PK, d);
        return abi.encodePacked(r, s, v);
    }

    function _openJoin() internal {
        bytes memory s1 = _sig(esc.seatDigest(ID, p1, STAKE, fundDl, playDl));
        vm.prank(p1);
        esc.open(ID, STAKE, fundDl, playDl, s1);
        bytes memory s2 = _sig(esc.seatDigest(ID, p2, STAKE, fundDl, playDl));
        vm.prank(p2);
        esc.join(ID, s2);
    }

    function _blacklist(address a) internal {
        vm.prank(fiat.blacklister());
        fiat.blacklist(a);
    }

    function _unBlacklist(address a) internal {
        vm.prank(fiat.blacklister());
        fiat.unBlacklist(a);
    }

    uint256 constant PRIZE = 2 * STAKE - (2 * STAKE * FEE) / 10000;
    uint256 constant FEE_AMT = (2 * STAKE * FEE) / 10000;

    function test_Fork_happyPath() public onFork {
        _openJoin();
        uint64 dl = playDl + GRACE;
        esc.settle(ID, p1, dl, _sig(esc.resultDigest(ID, p1, dl)));
        assertEq(usdc.balanceOf(p1), PRIZE);
        assertEq(usdc.balanceOf(platform), FEE_AMT);
        assertEq(usdc.balanceOf(address(esc)), 0);
    }

    function test_Fork_blacklistedWinnerCredited_thenWithdraw() public onFork {
        _openJoin();
        _blacklist(p1);
        uint64 dl = playDl + GRACE;
        esc.settle(ID, p1, dl, _sig(esc.resultDigest(ID, p1, dl)));
        assertEq(esc.owed(p1), PRIZE, "credited");
        assertEq(usdc.balanceOf(platform), FEE_AMT, "fee still paid");
        vm.expectRevert(); // real USDC: "Blacklistable: account is blacklisted"
        esc.withdrawFor(p1);
        _unBlacklist(p1);
        esc.withdrawFor(p1);
        assertEq(usdc.balanceOf(p1), PRIZE);
        assertEq(usdc.balanceOf(address(esc)), 0);
    }

    function test_Fork_blacklistedPlayerCannotDeposit() public onFork {
        _blacklist(p1);
        bytes memory s1 = _sig(esc.seatDigest(ID, p1, STAKE, fundDl, playDl));
        vm.prank(p1);
        vm.expectRevert();
        esc.open(ID, STAKE, fundDl, playDl, s1);
    }

    function test_Fork_refundWithBlacklistedPlayerPaysTheOther() public onFork {
        _openJoin();
        _blacklist(p2);
        vm.warp(uint256(playDl) + GRACE + 1);
        esc.refundExpired(ID);
        assertEq(usdc.balanceOf(p1), STAKE);
        assertEq(esc.owed(p2), STAKE);
    }

    function test_Fork_pausedCreditsEverything_thenWithdrawFor() public onFork {
        _openJoin();
        vm.prank(fiat.pauser());
        fiat.pause();
        uint64 dl = playDl + GRACE;
        esc.settle(ID, p2, dl, _sig(esc.resultDigest(ID, p2, dl)));
        assertEq(esc.owed(p2), PRIZE);
        assertEq(esc.owed(platform), FEE_AMT);
        vm.expectRevert(); // "Pausable: paused"
        esc.withdrawFor(p2);
        vm.prank(fiat.pauser());
        fiat.unpause();
        esc.withdrawFor(p2);
        esc.withdrawFor(platform);
        assertEq(usdc.balanceOf(p2), PRIZE);
        assertEq(usdc.balanceOf(platform), FEE_AMT);
        assertEq(usdc.balanceOf(address(esc)), 0);
    }

    /// Circle blacklists the ESCROW itself: no deposits, every exit becomes a
    /// credit, no withdrawal works; nothing is lost and it all flows again the
    /// moment the escrow is un-blacklisted. (No migration path exists.)
    function test_Fork_blacklistedEscrow() public onFork {
        _openJoin();
        _blacklist(address(esc));
        uint64 dl = playDl + GRACE;
        esc.settle(ID, p1, dl, _sig(esc.resultDigest(ID, p1, dl)));
        assertEq(esc.owed(p1), PRIZE);
        assertEq(esc.owed(platform), FEE_AMT);
        vm.expectRevert();
        esc.withdrawFor(p1);
        _unBlacklist(address(esc));
        esc.withdrawFor(p1);
        assertEq(usdc.balanceOf(p1), PRIZE);
    }

    /// Third party calls `settle` / refunds with every gas limit in a range:
    /// with the REAL token the result is always "revert" or "paid in full",
    /// never a healthy payment parked as a credit.
    function _sweepNoForcedCredit(bytes memory data, address caller, uint256 lo, uint256 hi, uint256 step)
        internal
        returns (uint256 ok, uint256 guardReverts, uint256 otherReverts)
    {
        uint256 snap = vm.snapshotState();
        for (uint256 g = lo; g <= hi; g += step) {
            vm.revertToState(snap);
            vm.prank(caller);
            (bool success, bytes memory ret) = address(esc).call{gas: g}(data);
            if (!success) {
                if (ret.length > 4 && keccak256(ret) == keccak256(abi.encodeWithSignature("Error(string)", "insufficient gas"))) {
                    guardReverts++;
                } else {
                    otherReverts++;
                }
                continue;
            }
            ok++;
            assertEq(esc.owed(p1) + esc.owed(p2) + esc.owed(platform), 0, "forced credit with real USDC");
        }
        vm.revertToState(snap);
    }

    function test_Fork_gasSweep_settle() public onFork {
        _openJoin();
        uint64 dl = playDl + GRACE;
        bytes memory data = abi.encodeCall(Escrow1v1.settle, (ID, p1, dl, _sig(esc.resultDigest(ID, p1, dl))));
        (uint256 ok, uint256 guard, uint256 other) = _sweepNoForcedCredit(data, address(0xBAD), 20_000, 200_000, 25);
        console2.log("settle sweep: ok / guard-revert / other-revert", ok, guard, other);
        assertGt(ok, 0);
        assertGt(guard, 0, "the guard fired in the tight band");
    }

    function test_Fork_gasSweep_refundExpired() public onFork {
        _openJoin();
        vm.warp(uint256(playDl) + GRACE + 1);
        bytes memory data = abi.encodeCall(Escrow1v1.refundExpired, (ID));
        (uint256 ok, uint256 guard, uint256 other) = _sweepNoForcedCredit(data, address(0xBAD), 20_000, 200_000, 25);
        console2.log("refundExpired sweep: ok / guard-revert / other-revert", ok, guard, other);
        assertGt(ok, 0);
    }

    /// The 1/63 guard's premise ("an OOG inside the token leaves the caller
    /// < 1/64") does not hold for the REAL FiatTokenProxy: an OOG in the
    /// implementation gives ~x/64 back. But with USDC's cheap transfer the
    /// amount is tiny: nowhere near the ~5k (warm, non-zero owed) to ~25k (cold,
    /// fresh owed) that Escrow1v1's credit branch needs.
    function test_Fork_proxyReturnsGasOnNestedOOG_butTooLittle() public onFork {
        GasReturnProbe probe = new GasReturnProbe();
        address to = makeAddr("healthy");
        deal(USDC, address(probe), 1_000_000);
        bytes memory data = abi.encodeCall(IERC20.transfer, (to, 1));
        uint256 snap = vm.snapshotState();
        int256 overhead = type(int256).max;
        uint256 maxReturned;
        uint256 atX;
        uint256 firstOk;
        for (uint256 x = 200; x <= 60_000; x += 20) {
            vm.revertToState(snap);
            (bool ok, uint256 spent) = probe.measure{gas: 1_000_000}(USDC, data, x);
            if (ok) {
                firstOk = x;
                break;
            }
            int256 d = int256(spent) - int256(x); // overhead - returned
            if (d < overhead && x < 1_000) overhead = d; // proxy-frame OOG: nothing returned
            if (overhead != type(int256).max && overhead > d && uint256(overhead - d) > maxReturned) {
                maxReturned = uint256(overhead - d);
                atX = x;
            }
        }
        console2.log("transfer succeeds from x =", firstOk);
        console2.log("max gas handed back after an OOG:", maxReturned);
        console2.log("  at forwarded x =", atX);
        assertGt(maxReturned, 0, "proxy returns gas after an implementation OOG");
        assertLt(maxReturned, 2_000, "...but far less than any credit branch costs");
    }
}
