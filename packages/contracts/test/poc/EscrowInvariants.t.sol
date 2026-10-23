// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Escrow1v1} from "../../src/Escrow1v1.sol";
import {BlacklistUSDC} from "../BlacklistUSDC.sol";

/// Stateful fuzzing of the whole state machine with blacklist/pause toggles
/// (players, platform AND the escrow itself), fee/table/platform changes,
/// arbitrary result deadlines, tight-gas third-party calls and withdrawals.
contract EscrowHandler is Test {
    Escrow1v1 public esc;
    BlacklistUSDC public tok;
    uint256 constant ARB_PK = 0xA11CE;
    uint64 constant GRACE = 30 minutes;
    address public owner = address(0xABCD);
    address[2] public platforms = [address(0xFEE5), address(0xFEE6)];
    address[4] public actors = [address(0x1001), address(0x1002), address(0x1003), address(0x1004)];
    bytes32[] public ids;
    uint256[4] stakes = [uint256(1_000_000), 2_000_000, 5_000_000, 10_000_000];
    uint256 nonce;

    uint256 public minted;
    // Violations recorded by the handler (checked by the invariants).
    bool public statusWentBack;
    bool public healthyPaymentCredited;
    bool public owedDecreasedWithoutWithdraw;
    mapping(bytes4 => uint256) public okCount;
    uint256 public creditEvents;

    constructor() {
        tok = new BlacklistUSDC();
        esc = new Escrow1v1(address(tok), vm.addr(ARB_PK), platforms[0], 1500, owner);
        vm.startPrank(owner);
        for (uint256 i = 0; i < 4; i++) {
            esc.setAllowedStake(stakes[i], true);
        }
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- helpers
    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function accounts() public view returns (address[] memory a) {
        a = new address[](6);
        for (uint256 i = 0; i < 4; i++) a[i] = actors[i];
        a[4] = platforms[0];
        a[5] = platforms[1];
    }

    function _pick(uint256 s) internal view returns (bytes32) {
        if (ids.length == 0) return bytes32(0);
        return ids[s % ids.length];
    }

    /// Prefer a match in `want` status (3 of 4 times), to keep the lifecycle moving.
    function _pickIn(uint256 s, Escrow1v1.Status want) internal view returns (bytes32) {
        if (ids.length == 0) return bytes32(0);
        if (s % 4 == 3) return _pick(s);
        for (uint256 k = 0; k < ids.length; k++) {
            bytes32 id = ids[(s % ids.length + k) % ids.length];
            if (_st(id) == want) return id;
        }
        return _pick(s);
    }

    function _st(bytes32 id) internal view returns (Escrow1v1.Status s) {
        (,,,,,,, s) = esc.matches(id);
    }

    function _sign(bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ARB_PK, d);
        return abi.encodePacked(r, s, v);
    }

    function _rejects(address to) internal view returns (bool) {
        return tok.paused() || tok.blacklisted(address(esc)) || tok.blacklisted(to);
    }

    /// Wraps every state-changing call: status monotonic, owed only moves as
    /// allowed, and a credit only for a recipient the token was rejecting.
    function _checked(bytes memory data, address caller, uint256 gasLimit, bool isWithdraw) internal {
        address[] memory acc = accounts();
        uint256[] memory owedBefore = new uint256[](acc.length);
        bool[] memory rejBefore = new bool[](acc.length);
        for (uint256 i = 0; i < acc.length; i++) {
            owedBefore[i] = esc.owed(acc[i]);
            rejBefore[i] = _rejects(acc[i]);
        }
        uint8[] memory stBefore = new uint8[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) stBefore[i] = uint8(_st(ids[i]));

        vm.prank(caller);
        (bool ok,) = address(esc).call{gas: gasLimit}(data);

        for (uint256 i = 0; i < stBefore.length; i++) {
            uint8 a = stBefore[i];
            uint8 b = uint8(_st(ids[i]));
            // None(0)->Open(1)->Funded(2)->Settled(3)|Refunded(4); Open->Refunded
            if (b < a || (a >= 3 && b != a) || (a == 1 && b == 3)) statusWentBack = true;
        }
        if (!ok) return;
        okCount[bytes4(data)]++;
        for (uint256 i = 0; i < acc.length; i++) {
            uint256 nowOwed = esc.owed(acc[i]);
            if (nowOwed > owedBefore[i]) creditEvents++;
            if (nowOwed > owedBefore[i] && !rejBefore[i]) healthyPaymentCredited = true;
            if (nowOwed < owedBefore[i] && !isWithdraw) owedDecreasedWithoutWithdraw = true;
        }
    }

    // ---------------------------------------------------------------- actions
    function open(uint256 idS, uint256 aS, uint256 sS, uint256 fD, uint256 pD) external {
        bytes32 id;
        if (idS % 5 == 0 && ids.length > 0) {
            id = _pick(idS); // try to re-open an existing id
        } else {
            id = keccak256(abi.encode("inv", nonce++));
            ids.push(id);
        }
        address a = actors[aS % 4];
        uint256 st = stakes[sS % 4];
        uint64 f = uint64(block.timestamp + bound(fD, 1, 2 hours));
        uint64 p = uint64(uint256(f) + bound(pD, 1, 2 hours));
        deal(address(tok), a, tok.balanceOf(a) + st); // bypasses pause/blacklist
        minted += st;
        vm.prank(a);
        tok.approve(address(esc), st);
        bytes memory seat = _sign(esc.seatDigest(id, a, st, f, p));
        _checked(abi.encodeCall(Escrow1v1.open, (id, st, f, p, seat)), a, 1_000_000, false);
    }

    function join(uint256 idS, uint256 aS) external {
        bytes32 id = _pickIn(idS, Escrow1v1.Status.Open);
        address a = actors[aS % 4];
        (,, uint256 st,,, uint64 f, uint64 p,) = esc.matches(id);
        if (st == 0) return;
        deal(address(tok), a, tok.balanceOf(a) + st); // bypasses pause/blacklist
        minted += st;
        vm.prank(a);
        tok.approve(address(esc), st);
        bytes memory seat = _sign(esc.seatDigest(id, a, st, f, p));
        _checked(abi.encodeCall(Escrow1v1.join, (id, seat)), a, 1_000_000, false);
    }

    function settle(uint256 idS, bool firstWins, uint256 dlS, uint256 gasS, uint256 callerS) external {
        bytes32 id = _pickIn(idS, Escrow1v1.Status.Funded);
        (address a, address b,,,,, uint64 p,) = esc.matches(id);
        address w = firstWins ? a : b;
        // Mostly the arbiter's policy deadline; sometimes an arbitrary one.
        uint64 dl = dlS % 4 == 0 ? uint64(bound(dlS, block.timestamp, block.timestamp + 10 hours)) : p + GRACE;
        bytes memory sig = _sign(esc.resultDigest(id, w, dl));
        uint256 g = gasS % 3 == 0 ? bound(gasS, 30_000, 400_000) : 2_000_000; // tight-gas third party
        _checked(abi.encodeCall(Escrow1v1.settle, (id, w, dl, sig)), actors[callerS % 4], g, false);
    }

    function refundUnfunded(uint256 idS, uint256 gasS) external {
        uint256 g = gasS % 3 == 0 ? bound(gasS, 30_000, 300_000) : 2_000_000;
        _checked(abi.encodeCall(Escrow1v1.refundUnfunded, (_pickIn(idS, Escrow1v1.Status.Open))), address(0xCA11), g, false);
    }

    function refundExpired(uint256 idS, uint256 gasS) external {
        uint256 g = gasS % 3 == 0 ? bound(gasS, 30_000, 300_000) : 2_000_000;
        _checked(abi.encodeCall(Escrow1v1.refundExpired, (_pickIn(idS, Escrow1v1.Status.Funded))), address(0xCA11), g, false);
    }

    function cancel(uint256 idS, bool byOwner) external {
        if (idS % 4 != 0) return; // rare: it closes matches early
        _checked(abi.encodeCall(Escrow1v1.cancelMatch, (_pick(idS))), byOwner ? owner : vm.addr(ARB_PK), 2_000_000, false);
    }

    function withdraw(uint256 aS, bool forOther, uint256 callerS) external {
        address[] memory acc = accounts();
        address who = acc[aS % acc.length];
        if (forOther) {
            _checked(abi.encodeCall(Escrow1v1.withdrawFor, (who)), actors[callerS % 4], 2_000_000, true);
        } else {
            _checked(abi.encodeCall(Escrow1v1.withdraw, ()), who, 2_000_000, true);
        }
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 90 minutes));
    }

    function toggleBlacklist(uint256 aS) external {
        if (aS % 3 != 0) return; // keep the token mostly healthy
        address[] memory acc = accounts();
        uint256 k = (aS / 3) % (acc.length + 1);
        address who = k == acc.length ? address(esc) : acc[k];
        tok.blacklist(who, !tok.blacklisted(who));
    }

    function togglePause(uint256 s) external {
        if (s % 3 != 0 && !tok.paused()) return;
        tok.setPaused(!tok.paused());
    }

    function adminChurn(uint256 s, uint16 fee, bool ok) external {
        vm.startPrank(owner);
        esc.setFeeBps(uint16(bound(fee, 0, 2000)));
        esc.setAllowedStake(stakes[s % 4], ok || s % 4 != 0);
        esc.setPlatformWallet(platforms[s % 2]);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- views
    function locked() public view returns (uint256 sum) {
        for (uint256 i = 0; i < ids.length; i++) {
            (,, uint256 st,,,,, Escrow1v1.Status s) = esc.matches(ids[i]);
            if (s == Escrow1v1.Status.Open) sum += st;
            else if (s == Escrow1v1.Status.Funded) sum += 2 * st;
        }
    }

    function owedSum() public view returns (uint256 sum) {
        address[] memory acc = accounts();
        for (uint256 i = 0; i < acc.length; i++) sum += esc.owed(acc[i]);
    }

    function heldOutside() public view returns (uint256 sum) {
        address[] memory acc = accounts();
        for (uint256 i = 0; i < acc.length; i++) sum += tok.balanceOf(acc[i]);
    }
}

contract EscrowInvariantsTest is Test {
    EscrowHandler h;

    function setUp() public {
        h = new EscrowHandler();
        targetContract(address(h));
        bytes4[] memory sel = new bytes4[](13);
        sel[0] = EscrowHandler.open.selector;
        sel[1] = EscrowHandler.open.selector; // weight
        sel[2] = EscrowHandler.join.selector;
        sel[3] = EscrowHandler.join.selector; // weight
        sel[4] = EscrowHandler.settle.selector;
        sel[5] = EscrowHandler.refundUnfunded.selector;
        sel[6] = EscrowHandler.refundExpired.selector;
        sel[7] = EscrowHandler.cancel.selector;
        sel[8] = EscrowHandler.withdraw.selector;
        sel[9] = EscrowHandler.warp.selector;
        sel[10] = EscrowHandler.toggleBlacklist.selector;
        sel[11] = EscrowHandler.togglePause.selector;
        sel[12] = EscrowHandler.adminChurn.selector; // fee, table and platform-wallet churn
        targetSelector(FuzzSelector({addr: address(h), selectors: sel}));
    }

    /// Custody: the escrow holds EXACTLY what it owes (credits) plus what is
    /// locked in Open/Funded matches. No drift in either direction.
    function invariant_custodyEqualsOwedPlusLocked() public view {
        assertEq(h.tok().balanceOf(address(h.esc())), h.owedSum() + h.locked());
    }

    /// Conservation: nothing is created or destroyed.
    function invariant_conservation() public view {
        assertEq(h.heldOutside() + h.tok().balanceOf(address(h.esc())), h.minted());
    }

    function invariant_statusMonotonic() public view {
        assertFalse(h.statusWentBack());
    }

    /// Even with tight gas chosen by a third party, a payment the token would
    /// have accepted is never parked as a credit (mock token = no proxy; see
    /// PayGuardProxyBypass for the proxy case).
    function invariant_noHealthyCredit() public view {
        assertFalse(h.healthyPaymentCredited());
    }

    function invariant_owedOnlyLeavesByWithdraw() public view {
        assertFalse(h.owedDecreasedWithoutWithdraw());
    }

    /// Coverage of the LAST run (printed with -vv): the fuzzer reaches every exit.
    function afterInvariant() public view {
        console2.log("matches  ", h.idCount());
        console2.log("open   ok", h.okCount(Escrow1v1.open.selector));
        console2.log("join   ok", h.okCount(Escrow1v1.join.selector));
        console2.log("settle ok", h.okCount(Escrow1v1.settle.selector));
        console2.log("refUnf ok", h.okCount(Escrow1v1.refundUnfunded.selector));
        console2.log("refExp ok", h.okCount(Escrow1v1.refundExpired.selector));
        console2.log("cancel ok", h.okCount(Escrow1v1.cancelMatch.selector));
        console2.log("withdr ok", h.okCount(Escrow1v1.withdraw.selector) + h.okCount(Escrow1v1.withdrawFor.selector));
        console2.log("credits  ", h.creditEvents());
    }
}
