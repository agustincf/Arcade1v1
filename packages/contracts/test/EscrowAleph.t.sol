// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EscrowAleph} from "../src/EscrowAleph.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract EscrowAlephTest is Test {
    EscrowAleph escrow;
    MockUSDC usdc;

    address owner = address(0xABCD);
    address platform = address(0xFEE5);
    uint256 arbiterPk = 0xA11CE; // clave del árbitro (para firmar en tests)
    address arbiter;

    uint256 stake = 2_000_000; // 2 USDC (6 decimales), la mesa de la etapa 4
    uint16 feeBps = 1500; // 15 %, como en producción

    bytes32 roomId = keccak256("room-1");
    address[] seats4;

    function setUp() public {
        arbiter = vm.addr(arbiterPk);
        usdc = new MockUSDC();
        escrow = new EscrowAleph(address(usdc), arbiter, platform, feeBps, owner);
        vm.prank(owner);
        escrow.setAllowedStake(stake, true);
        for (uint160 i = 1; i <= 4; i++) seats4.push(address(0x1000 + i));
        _fund(seats4);
    }

    // Dar USDC a cada asiento y que apruebe al contrato.
    function _fund(address[] memory seats) internal {
        for (uint256 i = 0; i < seats.length; i++) {
            usdc.mint(seats[i], stake);
            vm.prank(seats[i]);
            usdc.approve(address(escrow), stake);
        }
    }

    function _deadlines() internal view returns (uint64 fund, uint64 play) {
        fund = uint64(block.timestamp + 10 minutes);
        play = uint64(fund + 3 hours);
    }

    // Pase del árbitro para `player` en la sala (id, seats, stake, plazos).
    // Se firma ANTES de cualquier prank: seatDigest es un staticcall y consumiría
    // el prank/expectRevert si se evaluara como argumento (misma nota que en
    // Escrow1v1.t.sol).
    function _signSeat(bytes32 id, address[] memory seats, address player)
        internal
        view
        returns (bytes memory)
    {
        (uint64 fund, uint64 play) = _deadlines();
        bytes32 digest = escrow.seatDigest(id, keccak256(abi.encode(seats)), stake, fund, play, player);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(arbiterPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _open(bytes32 id, address[] memory seats) internal {
        (uint64 fund, uint64 play) = _deadlines();
        bytes memory sig = _signSeat(id, seats, seats[0]);
        vm.prank(seats[0]);
        escrow.open(id, seats, stake, fund, play, sig);
    }

    function _deposit(bytes32 id, address[] memory seats, uint256 i) internal {
        bytes memory sig = _signSeat(id, seats, seats[i]);
        vm.prank(seats[i]);
        escrow.deposit(id, sig);
    }

    /// Abre con seats[0] y deposita el resto: sala Funded.
    function _fundRoom(bytes32 id, address[] memory seats) internal {
        _open(id, seats);
        for (uint256 i = 1; i < seats.length; i++) _deposit(id, seats, i);
    }

    // --- Fondeo -----------------------------------------------------------

    function test_OpenLocksFirstStakeAndFreezesSeats() public {
        _open(roomId, seats4);
        (address[] memory s, uint256 st, uint8 paidCount,,, EscrowAleph.Status status) = escrow.roomOf(roomId);
        assertEq(s.length, 4, "lista congelada");
        assertEq(s[2], seats4[2]);
        assertEq(st, stake);
        assertEq(paidCount, 1);
        assertEq(uint8(status), uint8(EscrowAleph.Status.Funding));
        assertTrue(escrow.paid(roomId, seats4[0]));
        assertFalse(escrow.paid(roomId, seats4[1]));
        assertEq(usdc.balanceOf(address(escrow)), stake);
        address[] memory d = escrow.depositors(roomId);
        assertEq(d.length, 1);
        assertEq(d[0], seats4[0]);
    }

    function test_FundedWhenEveryoneDeposited() public {
        _fundRoom(roomId, seats4);
        (,, uint8 paidCount,,, EscrowAleph.Status status) = escrow.roomOf(roomId);
        assertEq(paidCount, 4);
        assertEq(uint8(status), uint8(EscrowAleph.Status.Funded));
        assertEq(usdc.balanceOf(address(escrow)), stake * 4, "los 4 stakes adentro");
        assertEq(escrow.depositors(roomId).length, 4);
    }

    function test_OpenRejectsDisallowedStake() public {
        (uint64 fund, uint64 play) = _deadlines();
        bytes32 digest = escrow.seatDigest(roomId, keccak256(abi.encode(seats4)), 999, fund, play, seats4[0]);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(arbiterPk, digest);
        vm.prank(seats4[0]);
        vm.expectRevert(bytes("stake not allowed"));
        escrow.open(roomId, seats4, 999, fund, play, abi.encodePacked(r, s, v));
    }

    function test_OpenRejectsBadSeatCount() public {
        address[] memory three = new address[](3);
        for (uint256 i = 0; i < 3; i++) three[i] = seats4[i];
        (uint64 fund, uint64 play) = _deadlines();
        bytes memory sig = _signSeat(roomId, three, three[0]);
        vm.prank(three[0]);
        vm.expectRevert(bytes("bad seat count"));
        escrow.open(roomId, three, stake, fund, play, sig);
    }

    function test_OpenRejectsDuplicateSeat() public {
        address[] memory dup = new address[](4);
        dup[0] = seats4[0];
        dup[1] = seats4[1];
        dup[2] = seats4[1];
        dup[3] = seats4[3];
        (uint64 fund, uint64 play) = _deadlines();
        bytes memory sig = _signSeat(roomId, dup, dup[0]);
        vm.prank(dup[0]);
        vm.expectRevert(bytes("duplicate seat"));
        escrow.open(roomId, dup, stake, fund, play, sig);
    }

    // El pase ata la LISTA: abrir con otra lista (aunque incluya al firmante) falla.
    function test_OpenRejectsAlteredSeatList() public {
        address[] memory altered = new address[](4);
        for (uint256 i = 0; i < 4; i++) altered[i] = seats4[i];
        altered[3] = address(0x666);
        (uint64 fund, uint64 play) = _deadlines();
        bytes memory sigForOriginal = _signSeat(roomId, seats4, seats4[0]);
        vm.prank(seats4[0]);
        vm.expectRevert(bytes("bad seat"));
        escrow.open(roomId, altered, stake, fund, play, sigForOriginal);
    }

    // El pase ata el STAKE y los PLAZOS: cambiarlos invalida la firma.
    function test_OpenRejectsAlteredDeadlines() public {
        (uint64 fund, uint64 play) = _deadlines();
        bytes memory sig = _signSeat(roomId, seats4, seats4[0]);
        vm.prank(seats4[0]);
        vm.expectRevert(bytes("bad seat"));
        escrow.open(roomId, seats4, stake, fund, play + 1 days, sig);
    }

    function test_OpenRejectsNonMemberEvenWithArbiterPass() public {
        // Un pase firmado por el árbitro para alguien que NO está en la lista.
        address outsider = address(0x777);
        usdc.mint(outsider, stake);
        vm.prank(outsider);
        usdc.approve(address(escrow), stake);
        (uint64 fund, uint64 play) = _deadlines();
        bytes memory sig = _signSeat(roomId, seats4, outsider);
        vm.prank(outsider);
        vm.expectRevert(bytes("not a seat"));
        escrow.open(roomId, seats4, stake, fund, play, sig);
    }

    function test_DepositRejectsWrongRoomPass() public {
        _open(roomId, seats4);
        bytes32 other = keccak256("room-2");
        bytes memory sigOther = _signSeat(other, seats4, seats4[1]);
        vm.prank(seats4[1]);
        vm.expectRevert(bytes("bad seat"));
        escrow.deposit(roomId, sigOther);
    }

    function test_DepositRejectsSomeoneElsesPass() public {
        _open(roomId, seats4);
        bytes memory sigOf2 = _signSeat(roomId, seats4, seats4[2]);
        vm.prank(seats4[1]);
        vm.expectRevert(bytes("bad seat"));
        escrow.deposit(roomId, sigOf2);
    }

    function test_DepositRejectsTwice() public {
        _open(roomId, seats4);
        _deposit(roomId, seats4, 1);
        bytes memory sig = _signSeat(roomId, seats4, seats4[1]);
        vm.prank(seats4[1]);
        vm.expectRevert(bytes("already paid"));
        escrow.deposit(roomId, sig);
    }

    function test_DepositRejectsAfterFundDeadline() public {
        _open(roomId, seats4);
        bytes memory sig = _signSeat(roomId, seats4, seats4[1]);
        vm.warp(block.timestamp + 10 minutes + 1);
        vm.prank(seats4[1]);
        vm.expectRevert(bytes("fund expired"));
        escrow.deposit(roomId, sig);
    }

    function test_DepositRejectsBadSignature() public {
        _open(roomId, seats4);
        (uint64 fund, uint64 play) = _deadlines();
        bytes32 digest = escrow.seatDigest(roomId, keccak256(abi.encode(seats4)), stake, fund, play, seats4[1]);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBADBAD, digest);
        vm.prank(seats4[1]);
        vm.expectRevert(bytes("bad seat"));
        escrow.deposit(roomId, abi.encodePacked(r, s, v));
    }
}
