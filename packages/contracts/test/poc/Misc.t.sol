// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Escrow1v1} from "../../src/Escrow1v1.sol";
import {MockUSDC} from "../MockUSDC.sol";
import {PocBase} from "./PocHelpers.sol";

contract MiscTest is PocBase {
    bytes32 constant ID = keccak256("poc-misc");
    MockUSDC tok;
    Escrow1v1 esc;

    uint256 constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    function setUp() public {
        _initClock();
        tok = new MockUSDC();
        esc = new Escrow1v1(address(tok), arbiter, platform, FEE, owner);
        vm.prank(owner);
        esc.setAllowedStake(STAKE, true);
        tok.mint(p1, STAKE);
        vm.prank(p1);
        tok.approve(address(esc), STAKE);
    }

    /// F-09 (Informational, ops): OZ v5 ECDSA rejects high-s signatures. A KMS
    /// signer (docs/MAINNET.md C12) that does not normalise s to the lower half
    /// makes ~50% of seats/results revert -- fail-closed, but an outage.
    /// Also: only 65-byte signatures are accepted (EIP-2098 64-byte ones revert).
    function test_highS_andCompactSignaturesRejected() public {
        bytes32 d = esc.seatDigest(ID, p1, STAKE, fundDl, playDl);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ARBITER_PK, d);
        bytes32 highS = bytes32(N - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;
        bytes memory malleated = abi.encodePacked(r, highS, flippedV);
        assertEq(ecrecover(d, flippedV, r, highS), arbiter, "same signer at the EVM level");

        vm.prank(p1);
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureS.selector, highS));
        esc.open(ID, STAKE, fundDl, playDl, malleated);

        bytes32 vs = bytes32(uint256(s) | (uint256(v - 27) << 255));
        vm.prank(p1);
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, 64));
        esc.open(ID, STAKE, fundDl, playDl, abi.encodePacked(r, vs));

        vm.prank(p1);
        esc.open(ID, STAKE, fundDl, playDl, abi.encodePacked(r, s, v)); // canonical one works
    }

    /// F-10 (Informational, deploy script): DeployMainnet.s.sol does
    /// `uint16(vm.envUint("FEE_BPS"))`, a silent truncation. A typo such as
    /// 67036 deploys with fee 1500 (or 66536 -> 1000) and passes the
    /// constructor's `<= MAX_FEE_BPS` check.
    function test_deployScriptFeeTruncation() public pure {
        uint256 typo = 67_036;
        assertEq(uint16(typo), 1500);
        assertEq(uint16(uint256(66_536)), 1000);
    }

    /// HOLDS: the contract never pulls from anyone but msg.sender, so a
    /// third party cannot spend a player's (possibly larger) allowance.
    function test_cannotSpendSomeoneElsesAllowance() public {
        vm.prank(p1);
        tok.approve(address(esc), type(uint256).max);
        address thief = address(0x7777);
        bytes memory seat = _seat(esc, ID, thief, STAKE, fundDl, playDl);
        vm.prank(thief);
        vm.expectRevert(); // ERC20InsufficientAllowance / balance of the thief, never p1's
        esc.open(ID, STAKE, fundDl, playDl, seat);
        assertEq(tok.balanceOf(p1), STAKE);
    }

    /// HOLDS: USDC donated straight to the escrow changes nothing (the
    /// contract never reads its own balance); it is just unrecoverable.
    function test_donationIsInert() public {
        tok.mint(address(esc), 123);
        bytes memory seat = _seat(esc, ID, p1, STAKE, fundDl, playDl);
        vm.prank(p1);
        esc.open(ID, STAKE, fundDl, playDl, seat);
        vm.warp(uint256(fundDl) + 1);
        esc.refundUnfunded(ID);
        assertEq(tok.balanceOf(p1), STAKE);
        assertEq(tok.balanceOf(address(esc)), 123);
    }
}
