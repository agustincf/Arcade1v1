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

    // p1 ABRE la partida depositando su apuesta (modelo asincronico).
    function _open() internal {
        vm.prank(p1);
        escrow.open(
            matchId,
            stake,
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours)
        );
    }

    // p1 abre y p2 se UNE: partida lista (Funded).
    function _openAndJoin() internal {
        _open();
        vm.prank(p2);
        escrow.join(matchId);
    }

    function _signResult(address winner) internal view returns (bytes memory) {
        bytes32 digest = escrow.resultDigest(matchId, winner);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(arbiterPk, digest);
        return abi.encodePacked(r, s, v);
    }

    // --- Abrir bloquea el deposito de p1 ---
    function test_OpenLocksStake() public {
        _open();
        assertEq(usdc.balanceOf(p1), 0, "p1 deposito");
        assertEq(usdc.balanceOf(address(escrow)), stake, "escrow tiene 1 stake");
    }

    // --- Camino feliz: ganador cobra, plataforma cobra comision ---
    function test_SettleHappyPath() public {
        _openAndJoin();

        bytes memory sig = _signResult(p1);
        escrow.settle(matchId, p1, sig);

        // Pozo = 10 USDC; comision 10% = 1 USDC; premio = 9 USDC.
        assertEq(usdc.balanceOf(p1), 9_000_000, "premio ganador");
        assertEq(usdc.balanceOf(platform), 1_000_000, "comision plataforma");
        assertEq(usdc.balanceOf(address(escrow)), 0, "contrato vacio");
    }

    // --- Firma invalida (no es el arbitro) debe fallar ---
    function test_SettleRejectsBadSignature() public {
        _openAndJoin();

        uint256 fakePk = 0xBADBAD;
        bytes32 digest = escrow.resultDigest(matchId, p1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fakePk, digest);
        bytes memory badSig = abi.encodePacked(r, s, v);

        vm.expectRevert(bytes("bad signature"));
        escrow.settle(matchId, p1, badSig);
    }

    // --- No se puede liquidar dos veces ---
    function test_CannotSettleTwice() public {
        _openAndJoin();
        bytes memory sig = _signResult(p1);
        escrow.settle(matchId, p1, sig);

        vm.expectRevert(bytes("not funded"));
        escrow.settle(matchId, p1, sig);
    }

    // --- Reembolso si nadie se unio a tiempo (partida abierta sin rival) ---
    function test_RefundUnfunded() public {
        _open(); // solo p1 abrio (deposito)

        vm.warp(block.timestamp + 1 hours + 1);
        escrow.refundUnfunded(matchId);

        assertEq(usdc.balanceOf(p1), stake, "p1 recupera su deposito");
    }

    // --- Reembolso si vencio el plazo de juego sin resultado (rival no jugo) ---
    function test_RefundExpired() public {
        _openAndJoin();

        vm.warp(block.timestamp + 2 hours + 1);
        escrow.refundExpired(matchId);

        assertEq(usdc.balanceOf(p1), stake, "p1 reembolsado");
        assertEq(usdc.balanceOf(p2), stake, "p2 reembolsado");
    }

    // --- El arbitro puede cancelar (empate) y reembolsa a ambos ---
    function test_CancelRefundsBoth() public {
        _openAndJoin();

        vm.prank(arbiter);
        escrow.cancelMatch(matchId);

        assertEq(usdc.balanceOf(p1), stake, "p1 reembolsado");
        assertEq(usdc.balanceOf(p2), stake, "p2 reembolsado");
    }

    // --- No se permite abrir una mesa no habilitada ---
    function test_RejectsDisallowedStake() public {
        vm.prank(p1);
        vm.expectRevert(bytes("stake not allowed"));
        escrow.open(
            keccak256("x"),
            999, // monto no permitido
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours)
        );
    }

    // --- Un jugador no puede unirse a su propia partida ---
    function test_JoinRejectsSamePlayer() public {
        _open();
        vm.prank(p1);
        vm.expectRevert(bytes("same player"));
        escrow.join(matchId);
    }
}
