// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EscrowAleph} from "../src/EscrowAleph.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract EscrowAlephTest is Test {
    EscrowAleph escrow;
    MockUSDC usdc;

    address owner = address(0xABCD);
    address platform = address(0xFEE5);
    address notOwner = address(0x9999); // cualquiera sin permiso de owner, para los tests de admin
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

    // --- Administración -------------------------------------------------------
    // Superficie de autorización y configuración: sin esto, los 4 setters y las
    // guardas del constructor llegarían a un contrato que custodia USDC real sin
    // haberse ejercitado ni una vez (hallazgo de revisión de la Tarea 1).

    function test_SetArbiterRejectsNonOwner() public {
        vm.prank(notOwner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, notOwner));
        escrow.setArbiter(address(0x1234));
    }

    function test_SetPlatformWalletRejectsNonOwner() public {
        vm.prank(notOwner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, notOwner));
        escrow.setPlatformWallet(address(0x1234));
    }

    function test_SetFeeBpsRejectsNonOwner() public {
        vm.prank(notOwner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, notOwner));
        escrow.setFeeBps(100);
    }

    function test_SetAllowedStakeRejectsNonOwner() public {
        vm.prank(notOwner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, notOwner));
        escrow.setAllowedStake(stake, true);
    }

    // El tope de comisión (20%) rige también en caliente, no solo al desplegar.
    function test_SetFeeBpsRejectsOverCap() public {
        vm.prank(owner);
        vm.expectRevert(bytes("fee too high"));
        escrow.setFeeBps(2001);
    }

    function test_SetArbiterRejectsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(bytes("zero address"));
        escrow.setArbiter(address(0));
    }

    // El constructor no deja nacer una sala sin USDC, árbitro o wallet de
    // plataforma: cualquiera en address(0) y ni los depósitos ni la comisión
    // tendrían adónde ir.
    function test_ConstructorRejectsZeroAddress() public {
        vm.expectRevert(bytes("zero address"));
        new EscrowAleph(address(0), arbiter, platform, feeBps, owner);
    }

    // ...tampoco con una comisión por encima del tope, desde el día uno.
    function test_ConstructorRejectsFeeTooHigh() public {
        vm.expectRevert(bytes("fee too high"));
        new EscrowAleph(address(usdc), arbiter, platform, 2001, owner);
    }

    // --- Liquidación --------------------------------------------------------

    function _signPayout(bytes32 id, address[] memory seats, uint256[] memory amounts)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = escrow.payoutDigest(id, keccak256(abi.encode(seats, amounts)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(arbiterPk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Tabla "como la calcula el árbitro": unidades del motor -> USDC neto, con
    /// floor por asiento. pot = 8 USDC; fee 15 % = 1,2 USDC; neto = 6,8 USDC.
    function _table4() internal pure returns (uint256[] memory amounts) {
        // unidades del motor (suman 4000): 1700, 1100, 700, 500
        uint256 net = 6_800_000;
        amounts = new uint256[](4);
        amounts[0] = (1700 * net) / 4000; // 2_890_000
        amounts[1] = (1100 * net) / 4000; // 1_870_000
        amounts[2] = (700 * net) / 4000; // 1_190_000
        amounts[3] = (500 * net) / 4000; // 850_000
    }

    function test_SettleHappyPathPaysEveryoneInOneTx() public {
        _fundRoom(roomId, seats4);
        uint256[] memory amounts = _table4();
        bytes memory sig = _signPayout(roomId, seats4, amounts);
        escrow.settle(roomId, seats4, amounts, sig); // cualquiera puede presentarla

        for (uint256 i = 0; i < 4; i++) assertEq(usdc.balanceOf(seats4[i]), amounts[i], "pago del asiento");
        assertEq(usdc.balanceOf(platform), 1_200_000, "comision 15 % (sin polvo en esta tabla)");
        assertEq(usdc.balanceOf(address(escrow)), 0, "contrato vacio");
        (,,,,, EscrowAleph.Status status) = escrow.roomOf(roomId);
        assertEq(uint8(status), uint8(EscrowAleph.Status.Settled));
    }

    function test_SettleDustGoesToPlatform() public {
        _fundRoom(roomId, seats4);
        // Unidades 1333/1333/1333/1: neto 6.800.000 -> floor deja polvo.
        uint256 net = 6_800_000;
        uint256[] memory amounts = new uint256[](4);
        amounts[0] = (1333 * net) / 4000; // 2_266_100
        amounts[1] = amounts[0];
        amounts[2] = amounts[0];
        amounts[3] = (1 * net) / 4000; // 1_700
        uint256 sum = amounts[0] * 3 + amounts[3]; // 6_800_000 exacto acá; forzar polvo:
        amounts[3] -= 2; // 2 micro-USDC de polvo (< N = 4)
        sum -= 2;
        bytes memory sig = _signPayout(roomId, seats4, amounts);
        escrow.settle(roomId, seats4, amounts, sig);
        assertEq(usdc.balanceOf(platform), 8_000_000 - sum, "comision + polvo");
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_SettleZeroAmountDoesNotTransfer() public {
        _fundRoom(roomId, seats4);
        uint256[] memory amounts = new uint256[](4);
        amounts[0] = 6_800_000; // se lleva todo el neto (Final: robó)
        bytes memory sig = _signPayout(roomId, seats4, amounts);
        escrow.settle(roomId, seats4, amounts, sig);
        assertEq(usdc.balanceOf(seats4[0]), 6_800_000);
        assertEq(usdc.balanceOf(seats4[1]), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_SettleRejectsTableThatDoesNotAddUp() public {
        _fundRoom(roomId, seats4);
        uint256[] memory amounts = _table4();
        amounts[0] += 1; // un micro-USDC de más: pasa el neto
        bytes memory sig = _signPayout(roomId, seats4, amounts);
        vm.expectRevert(bytes("bad sum"));
        escrow.settle(roomId, seats4, amounts, sig);

        // Y por defecto: dejar N micro-USDC o más sin repartir tampoco vale
        // (la plataforma no puede quedarse con más que el polvo).
        uint256[] memory low = _table4();
        low[0] -= 4;
        bytes memory sig2 = _signPayout(roomId, seats4, low);
        vm.expectRevert(bytes("bad sum"));
        escrow.settle(roomId, seats4, low, sig2);
    }

    function test_SettleRejectsNonSeatAddress() public {
        _fundRoom(roomId, seats4);
        address[] memory tampered = new address[](4);
        for (uint256 i = 0; i < 4; i++) tampered[i] = seats4[i];
        tampered[1] = address(0x666); // firmada por el árbitro, pero no es asiento
        uint256[] memory amounts = _table4();
        bytes memory sig = _signPayout(roomId, tampered, amounts);
        vm.expectRevert(bytes("bad seat"));
        escrow.settle(roomId, tampered, amounts, sig);
    }

    function test_SettleRejectsReorderedSeats() public {
        _fundRoom(roomId, seats4);
        address[] memory swapped = new address[](4);
        swapped[0] = seats4[1];
        swapped[1] = seats4[0];
        swapped[2] = seats4[2];
        swapped[3] = seats4[3];
        uint256[] memory amounts = _table4();
        bytes memory sig = _signPayout(roomId, swapped, amounts);
        vm.expectRevert(bytes("bad seat"));
        escrow.settle(roomId, swapped, amounts, sig);
    }

    function test_SettleRejectsBadLength() public {
        _fundRoom(roomId, seats4);
        uint256[] memory three = new uint256[](3);
        bytes memory sig = _signPayout(roomId, seats4, three);
        vm.expectRevert(bytes("bad table"));
        escrow.settle(roomId, seats4, three, sig);
    }

    function test_SettleRejectsBadSignature() public {
        _fundRoom(roomId, seats4);
        uint256[] memory amounts = _table4();
        bytes32 digest = escrow.payoutDigest(roomId, keccak256(abi.encode(seats4, amounts)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBADBAD, digest);
        vm.expectRevert(bytes("bad signature"));
        escrow.settle(roomId, seats4, amounts, abi.encodePacked(r, s, v));
    }

    // Una tabla firmada para OTRA sala no liquida esta (la firma ata roomId).
    function test_SettleRejectsTableOfAnotherRoom() public {
        _fundRoom(roomId, seats4);
        uint256[] memory amounts = _table4();
        bytes memory sigOther = _signPayout(keccak256("room-2"), seats4, amounts);
        vm.expectRevert(bytes("bad signature"));
        escrow.settle(roomId, seats4, amounts, sigOther);
    }

    function test_CannotSettleTwice() public {
        _fundRoom(roomId, seats4);
        uint256[] memory amounts = _table4();
        bytes memory sig = _signPayout(roomId, seats4, amounts);
        escrow.settle(roomId, seats4, amounts, sig);
        vm.expectRevert(bytes("not funded"));
        escrow.settle(roomId, seats4, amounts, sig);
    }

    function test_SettleRejectsWhileStillFunding() public {
        _open(roomId, seats4);
        uint256[] memory amounts = _table4();
        bytes memory sig = _signPayout(roomId, seats4, amounts);
        vm.expectRevert(bytes("not funded"));
        escrow.settle(roomId, seats4, amounts, sig);
    }

    // El bucle aguanta la mesa máxima: 8 asientos, pozo 16 USDC.
    function test_SettleEightSeats() public {
        address[] memory eight = new address[](8);
        for (uint160 i = 1; i <= 8; i++) eight[i - 1] = address(0x2000 + i);
        _fund(eight);
        bytes32 id = keccak256("room-8");
        _fundRoom(id, eight);
        assertEq(usdc.balanceOf(address(escrow)), stake * 8);
        uint256 net = 16_000_000 - 2_400_000; // 13,6 USDC
        uint256[] memory amounts = new uint256[](8);
        for (uint256 i = 0; i < 8; i++) amounts[i] = (1000 * net) / 8000; // 1_700_000 cada uno
        bytes memory sig = _signPayout(id, eight, amounts);
        escrow.settle(id, eight, amounts, sig);
        for (uint256 i = 0; i < 8; i++) assertEq(usdc.balanceOf(eight[i]), 1_700_000);
        assertEq(usdc.balanceOf(platform), 2_400_000);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }
}
