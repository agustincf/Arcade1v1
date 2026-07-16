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

    // Firma del arbitro que autoriza a `player` a depositar en `id` (asiento).
    function _signSeat(bytes32 id, address player) internal view returns (bytes memory) {
        bytes32 digest = escrow.seatDigest(id, player);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(arbiterPk, digest);
        return abi.encodePacked(r, s, v);
    }

    // p1 ABRE la partida depositando su apuesta (modelo asincronico).
    // Ojo: el asiento se firma ANTES del prank; _signSeat hace un staticcall a
    // seatDigest y consumiría el prank/expectRevert si se evaluara como argumento.
    function _open() internal {
        bytes memory seat = _signSeat(matchId, p1);
        vm.prank(p1);
        escrow.open(
            matchId,
            stake,
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours),
            seat
        );
    }

    // p1 abre y p2 se UNE: partida lista (Funded).
    function _openAndJoin() internal {
        _open();
        bytes memory seat = _signSeat(matchId, p2);
        vm.prank(p2);
        escrow.join(matchId, seat);
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

        // Pasado el plazo de juego + la gracia (el borde exacto lo cubre
        // test_RefundExpiredRespectsGrace): se reembolsa a ambos.
        vm.warp(block.timestamp + 2 hours + 30 minutes + 1);
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
        bytes32 x = keccak256("x");
        bytes memory seat = _signSeat(x, p1);
        vm.prank(p1);
        vm.expectRevert(bytes("stake not allowed"));
        escrow.open(
            x,
            999, // monto no permitido
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours),
            seat
        );
    }

    // --- Un jugador no puede unirse a su propia partida ---
    function test_JoinRejectsSamePlayer() public {
        _open();
        bytes memory seat = _signSeat(matchId, p1);
        vm.prank(p1);
        vm.expectRevert(bytes("same player"));
        escrow.join(matchId, seat);
    }

    // --- open() exige el asiento firmado por el arbitro ---
    function test_OpenRejectsBadSeat() public {
        // Asiento firmado por otra clave (no el arbitro): rechazado.
        uint256 fakePk = 0xBADBAD;
        bytes32 digest = escrow.seatDigest(matchId, p1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fakePk, digest);
        vm.prank(p1);
        vm.expectRevert(bytes("bad seat"));
        escrow.open(
            matchId,
            stake,
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours),
            abi.encodePacked(r, s, v)
        );
    }

    // --- GRIEFING: un tercero no puede secuestrar el slot de p2 sin asiento ---
    function test_JoinRejectsAttackerWithoutSeat() public {
        _open();
        address attacker = address(0x666);
        usdc.mint(attacker, stake);
        vm.prank(attacker);
        usdc.approve(address(escrow), stake);

        // El atacante intenta con el asiento de p2 (que no es suyo): la firma ata
        // matchId + player, así que verifica contra `attacker`, no contra p2 -> falla.
        bytes memory p2seat = _signSeat(matchId, p2);
        vm.prank(attacker);
        vm.expectRevert(bytes("bad seat"));
        escrow.join(matchId, p2seat);

        // Y con su PROPIO asiento (que el arbitro nunca firmó porque no lo emparejó)
        // tampoco: el atacante no tiene forma de fabricar la firma del arbitro.
        // Aquí simulamos "sin asiento válido" con una firma vacía-inválida.
        vm.prank(attacker);
        vm.expectRevert();
        escrow.join(matchId, hex"00");
    }

    // --- El asiento no se puede reusar en OTRA partida (ata matchId) ---
    function test_SeatCannotBeReplayedAcrossMatches() public {
        bytes32 other = keccak256("match-2");

        // Un asiento firmado para `matchId` no autoriza abrir `other`.
        bytes memory wrongSeat = _signSeat(matchId, p1); // asiento de la partida equivocada
        vm.prank(p1);
        vm.expectRevert(bytes("bad seat"));
        escrow.open(
            other,
            stake,
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours),
            wrongSeat
        );
    }

    // --- refundExpired respeta el período de gracia ---
    function test_RefundExpiredRespectsGrace() public {
        _openAndJoin();

        // Justo pasado playDeadline pero DENTRO de la gracia: aún no se puede.
        vm.warp(block.timestamp + 2 hours + 1);
        vm.expectRevert(bytes("not expired"));
        escrow.refundExpired(matchId);

        // Pasada la gracia: sí reembolsa a ambos.
        vm.warp(block.timestamp + escrow.REFUND_GRACE());
        escrow.refundExpired(matchId);
        assertEq(usdc.balanceOf(p1), stake, "p1 reembolsado tras la gracia");
        assertEq(usdc.balanceOf(p2), stake, "p2 reembolsado tras la gracia");
    }

    // --- ANTI-GRIEFING: dentro de la gracia, un settle tardío GANA al reembolso ---
    function test_SettleWinsInsideGraceWindow() public {
        _openAndJoin();

        // Pasó el plazo de juego (settle "tardío"), pero seguimos en la gracia.
        vm.warp(block.timestamp + 2 hours + 1);

        // El perdedor NO puede escaparse con refundExpired todavía...
        vm.expectRevert(bytes("not expired"));
        escrow.refundExpired(matchId);

        // ...y el settle legítimo del ganador se liquida normalmente.
        bytes memory sig = _signResult(p1);
        escrow.settle(matchId, p1, sig);
        assertEq(usdc.balanceOf(p1), 9_000_000, "el ganador cobra pese al settle tardio");
    }
}
