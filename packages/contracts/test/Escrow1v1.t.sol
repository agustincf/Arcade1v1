// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Escrow1v1} from "../src/Escrow1v1.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract Escrow1v1Test is Test {
    Escrow1v1 escrow;
    MockUSDC usdc;

    address owner = address(0xABCD);
    address platform = address(0xFEE5);
    address p1 = address(0x1111);
    address p2 = address(0x2222);

    uint256 arbiterPk = 0xA11CE; // clave privada del arbitro (para firmar en tests)
    address arbiter;

    uint256 stake = 5_000_000; // 5 USDC (6 decimales)
    uint16 feeBps = 1000; // 10%

    bytes32 matchId = keccak256("match-1");

    function setUp() public {
        arbiter = vm.addr(arbiterPk);
        usdc = new MockUSDC();
        escrow = new Escrow1v1(address(usdc), arbiter, platform, feeBps, owner);

        vm.prank(owner);
        escrow.setAllowedStake(stake, true);

        // Dar USDC a los jugadores y que aprueben al contrato.
        usdc.mint(p1, stake);
        usdc.mint(p2, stake);
        vm.prank(p1);
        usdc.approve(address(escrow), stake);
        vm.prank(p2);
        usdc.approve(address(escrow), stake);
    }

    function _createMatch() internal {
        vm.prank(arbiter);
        escrow.createMatch(
            matchId,
            p1,
            p2,
            stake,
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours)
        );
    }

    function _bothDeposit() internal {
        vm.prank(p1);
        escrow.deposit(matchId);
        vm.prank(p2);
        escrow.deposit(matchId);
    }

    function _signResult(address winner) internal view returns (bytes memory) {
        bytes32 digest = escrow.resultDigest(matchId, winner);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(arbiterPk, digest);
        return abi.encodePacked(r, s, v);
    }

    // --- Camino feliz: ganador cobra, plataforma cobra comision ---
    function test_SettleHappyPath() public {
        _createMatch();
        _bothDeposit();

        bytes memory sig = _signResult(p1);
        escrow.settle(matchId, p1, sig);

        // Pozo = 10 USDC; comision 10% = 1 USDC; premio = 9 USDC.
        assertEq(usdc.balanceOf(p1), 9_000_000, "premio ganador");
        assertEq(usdc.balanceOf(platform), 1_000_000, "comision plataforma");
        assertEq(usdc.balanceOf(address(escrow)), 0, "contrato vacio");
    }

    // --- Firma invalida (no es el arbitro) debe fallar ---
    function test_SettleRejectsBadSignature() public {
        _createMatch();
        _bothDeposit();

        uint256 fakePk = 0xBADBAD;
        bytes32 digest = escrow.resultDigest(matchId, p1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fakePk, digest);
        bytes memory badSig = abi.encodePacked(r, s, v);

        vm.expectRevert(bytes("bad signature"));
        escrow.settle(matchId, p1, badSig);
    }

    // --- No se puede liquidar dos veces ---
    function test_CannotSettleTwice() public {
        _createMatch();
        _bothDeposit();
        bytes memory sig = _signResult(p1);
        escrow.settle(matchId, p1, sig);

        vm.expectRevert(bytes("not funded"));
        escrow.settle(matchId, p1, sig);
    }

    // --- Reembolso si no se lleno a tiempo ---
    function test_RefundUnfunded() public {
        _createMatch();
        vm.prank(p1);
        escrow.deposit(matchId); // solo p1 deposita

        vm.warp(block.timestamp + 1 hours + 1);
        escrow.refundUnfunded(matchId);

        assertEq(usdc.balanceOf(p1), stake, "p1 recupera su deposito");
    }

    // --- Reembolso si vencio el plazo de juego sin resultado (rival no jugo) ---
    function test_RefundExpired() public {
        _createMatch();
        _bothDeposit();

        vm.warp(block.timestamp + 2 hours + 1);
        escrow.refundExpired(matchId);

        assertEq(usdc.balanceOf(p1), stake, "p1 reembolsado");
        assertEq(usdc.balanceOf(p2), stake, "p2 reembolsado");
    }

    // --- El arbitro puede cancelar (empate) y reembolsa a ambos ---
    function test_CancelRefundsBoth() public {
        _createMatch();
        _bothDeposit();

        vm.prank(arbiter);
        escrow.cancelMatch(matchId);

        assertEq(usdc.balanceOf(p1), stake, "p1 reembolsado");
        assertEq(usdc.balanceOf(p2), stake, "p2 reembolsado");
    }

    // --- No se permite una mesa no habilitada ---
    function test_RejectsDisallowedStake() public {
        vm.prank(arbiter);
        vm.expectRevert(bytes("stake not allowed"));
        escrow.createMatch(
            keccak256("x"),
            p1,
            p2,
            999, // monto no permitido
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours)
        );
    }

    // --- Solo el arbitro puede crear partidas ---
    function test_OnlyArbiterCreates() public {
        vm.prank(p1);
        vm.expectRevert(bytes("only arbiter"));
        escrow.createMatch(
            keccak256("y"),
            p1,
            p2,
            stake,
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours)
        );
    }
}
