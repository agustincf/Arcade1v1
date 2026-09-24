// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EscrowAleph} from "../src/EscrowAleph.sol";
import {BlacklistUSDC} from "./BlacklistUSDC.sol";
import {ReentrantUSDC} from "./ReentrantUSDC.sol";
import {GasHungryUSDC} from "./GasHungryUSDC.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract EscrowAlephTest is Test {
    EscrowAleph escrow;
    // Se comporta como MockUSDC hasta que un test prende la blacklist o la
    // pausa: así todas las pruebas corren contra el mismo token.
    BlacklistUSDC usdc;

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
        usdc = new BlacklistUSDC();
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

    // Vencimiento de la tabla firmada: el árbitro firma con 15 min de vida.
    // `vm.getBlockTimestamp()` y no `block.timestamp`: varios tests lo llaman
    // después de un `vm.warp`, y así se lee el reloj movido, siempre.
    function _dl() internal view returns (uint64) {
        return uint64(vm.getBlockTimestamp() + 15 minutes);
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
        // La vista que firma el árbitro coincide con el hash rehecho a mano.
        assertEq(escrow.seatsHashOf(seats4), keccak256(abi.encode(seats4)), "seatsHashOf vs hash manual");
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
        // tableHash sale de la vista del contrato (no de un keccak256 rehecho a
        // mano): así cada test de settle también ejercita `tableHashOf`, que es
        // justo lo que el árbitro off-chain va a llamar para validar su encoder.
        bytes32 tableHash = escrow.tableHashOf(seats, amounts);
        bytes32 digest = escrow.payoutDigest(id, tableHash, _dl());
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

        // Settled es la única publicación on-chain del reparto: tableHash (qué
        // tabla se pagó), paidOut (suma a los asientos) y house (comisión +
        // polvo) tienen que salir exactos.
        bytes32 tableHash = escrow.tableHashOf(seats4, amounts);
        vm.expectEmit(true, true, true, true);
        emit EscrowAleph.Settled(roomId, tableHash, 6_800_000, 1_200_000);
        escrow.settle(roomId, seats4, amounts, _dl(), sig); // cualquiera puede presentarla

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
        escrow.settle(roomId, seats4, amounts, _dl(), sig);
        assertEq(usdc.balanceOf(platform), 8_000_000 - sum, "comision + polvo");
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_SettleZeroAmountDoesNotTransfer() public {
        _fundRoom(roomId, seats4);
        uint256[] memory amounts = new uint256[](4);
        amounts[0] = 6_800_000; // se lleva todo el neto (Final: robó)
        bytes memory sig = _signPayout(roomId, seats4, amounts);
        escrow.settle(roomId, seats4, amounts, _dl(), sig);
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
        escrow.settle(roomId, seats4, amounts, _dl(), sig);

        // Y por defecto: dejar N micro-USDC o más sin repartir tampoco vale
        // (la plataforma no puede quedarse con más que el polvo).
        uint256[] memory low = _table4();
        low[0] -= 4;
        bytes memory sig2 = _signPayout(roomId, seats4, low);
        vm.expectRevert(bytes("bad sum"));
        escrow.settle(roomId, seats4, low, _dl(), sig2);
    }

    function test_SettleRejectsNonSeatAddress() public {
        _fundRoom(roomId, seats4);
        address[] memory tampered = new address[](4);
        for (uint256 i = 0; i < 4; i++) tampered[i] = seats4[i];
        tampered[1] = address(0x666); // firmada por el árbitro, pero no es asiento
        uint256[] memory amounts = _table4();
        bytes memory sig = _signPayout(roomId, tampered, amounts);
        vm.expectRevert(bytes("bad seat"));
        escrow.settle(roomId, tampered, amounts, _dl(), sig);
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
        escrow.settle(roomId, swapped, amounts, _dl(), sig);
    }

    function test_SettleRejectsBadLength() public {
        _fundRoom(roomId, seats4);
        uint256[] memory three = new uint256[](3);
        bytes memory sig = _signPayout(roomId, seats4, three);
        vm.expectRevert(bytes("bad table"));
        escrow.settle(roomId, seats4, three, _dl(), sig);
    }

    function test_SettleRejectsBadSignature() public {
        _fundRoom(roomId, seats4);
        uint256[] memory amounts = _table4();
        bytes32 digest = escrow.payoutDigest(roomId, keccak256(abi.encode(seats4, amounts)), _dl());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBADBAD, digest);
        vm.expectRevert(bytes("bad signature"));
        escrow.settle(roomId, seats4, amounts, _dl(), abi.encodePacked(r, s, v));
    }

    // Una tabla firmada para OTRA sala no liquida esta (la firma ata roomId).
    function test_SettleRejectsTableOfAnotherRoom() public {
        _fundRoom(roomId, seats4);
        uint256[] memory amounts = _table4();
        bytes memory sigOther = _signPayout(keccak256("room-2"), seats4, amounts);
        vm.expectRevert(bytes("bad signature"));
        escrow.settle(roomId, seats4, amounts, _dl(), sigOther);
    }

    function test_CannotSettleTwice() public {
        _fundRoom(roomId, seats4);
        uint256[] memory amounts = _table4();
        bytes memory sig = _signPayout(roomId, seats4, amounts);
        escrow.settle(roomId, seats4, amounts, _dl(), sig);
        vm.expectRevert(bytes("not funded"));
        escrow.settle(roomId, seats4, amounts, _dl(), sig);
    }

    function test_SettleRejectsWhileStillFunding() public {
        _open(roomId, seats4);
        uint256[] memory amounts = _table4();
        bytes memory sig = _signPayout(roomId, seats4, amounts);
        vm.expectRevert(bytes("not funded"));
        escrow.settle(roomId, seats4, amounts, _dl(), sig);
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
        escrow.settle(id, eight, amounts, _dl(), sig);
        for (uint256 i = 0; i < 8; i++) assertEq(usdc.balanceOf(eight[i]), 1_700_000);
        assertEq(usdc.balanceOf(platform), 2_400_000);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // --- Reembolsos ----------------------------------------------------------

    function test_RefundUnfundedReturnsExactlyToThoseWhoPaid() public {
        _open(roomId, seats4);
        _deposit(roomId, seats4, 1); // 2 de 4 depositaron
        vm.expectRevert(bytes("not expired"));
        escrow.refundUnfunded(roomId);

        vm.warp(block.timestamp + 10 minutes + 1);
        escrow.refundUnfunded(roomId);
        assertEq(usdc.balanceOf(seats4[0]), stake, "recupera lo suyo");
        assertEq(usdc.balanceOf(seats4[1]), stake, "recupera lo suyo");
        assertEq(usdc.balanceOf(seats4[2]), stake, "nunca deposito: sigue con su USDC");
        assertEq(usdc.balanceOf(address(escrow)), 0);
        (,,,,, EscrowAleph.Status status) = escrow.roomOf(roomId);
        assertEq(uint8(status), uint8(EscrowAleph.Status.Refunded));
        // Reembolsada: ya no se puede depositar ni reembolsar de nuevo.
        vm.expectRevert(bytes("not funding"));
        escrow.refundUnfunded(roomId);
    }

    function test_RefundUnfundedRejectsFundedRoom() public {
        _fundRoom(roomId, seats4);
        vm.warp(block.timestamp + 10 minutes + 1);
        vm.expectRevert(bytes("not funding"));
        escrow.refundUnfunded(roomId);
    }

    function test_RefundExpiredRespectsGrace() public {
        _fundRoom(roomId, seats4);
        (, uint64 play) = _deadlines();
        // Justo pasado playDeadline, dentro de la gracia: todavia no.
        vm.warp(uint256(play) + 1);
        vm.expectRevert(bytes("not expired"));
        escrow.refundExpired(roomId);
        // Pasada la gracia: devuelve el stake a los 4.
        vm.warp(uint256(play) + escrow.REFUND_GRACE() + 1);
        escrow.refundExpired(roomId);
        for (uint256 i = 0; i < 4; i++) assertEq(usdc.balanceOf(seats4[i]), stake);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // ANTI-GRIEFING: dentro de la gracia, un settle tardio GANA al reembolso.
    function test_SettleWinsInsideGraceWindow() public {
        _fundRoom(roomId, seats4);
        (, uint64 play) = _deadlines();
        vm.warp(uint256(play) + 1);
        vm.expectRevert(bytes("not expired"));
        escrow.refundExpired(roomId);
        uint256[] memory amounts = _table4();
        bytes memory sig = _signPayout(roomId, seats4, amounts);
        escrow.settle(roomId, seats4, amounts, _dl(), sig);
        assertEq(usdc.balanceOf(seats4[0]), amounts[0], "cobra pese al settle tardio");
    }

    function test_RefundExpiredRejectsAfterSettle() public {
        _fundRoom(roomId, seats4);
        uint256[] memory amounts = _table4();
        escrow.settle(roomId, seats4, amounts, _dl(), _signPayout(roomId, seats4, amounts));
        (, uint64 play) = _deadlines();
        vm.warp(uint256(play) + escrow.REFUND_GRACE() + 1);
        vm.expectRevert(bytes("not funded"));
        escrow.refundExpired(roomId);
    }

    function test_CancelByArbiterRefundsPaidOnly() public {
        _open(roomId, seats4);
        _deposit(roomId, seats4, 1);
        _deposit(roomId, seats4, 2);
        vm.prank(arbiter);
        escrow.cancelRoom(roomId);
        assertEq(usdc.balanceOf(seats4[0]), stake);
        assertEq(usdc.balanceOf(seats4[1]), stake);
        assertEq(usdc.balanceOf(seats4[2]), stake);
        assertEq(usdc.balanceOf(seats4[3]), stake, "no deposito, no recibe de mas");
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_CancelByOwnerOnFundedRoom() public {
        _fundRoom(roomId, seats4);
        vm.prank(owner);
        escrow.cancelRoom(roomId);
        for (uint256 i = 0; i < 4; i++) assertEq(usdc.balanceOf(seats4[i]), stake);
    }

    function test_CancelRejectsStrangerAndSettledRoom() public {
        _fundRoom(roomId, seats4);
        vm.prank(address(0x999));
        vm.expectRevert(bytes("not allowed"));
        escrow.cancelRoom(roomId);

        uint256[] memory amounts = _table4();
        escrow.settle(roomId, seats4, amounts, _dl(), _signPayout(roomId, seats4, amounts));
        vm.prank(arbiter);
        vm.expectRevert(bytes("cant cancel"));
        escrow.cancelRoom(roomId);
    }

    function test_CancelRejectsUnknownRoom() public {
        vm.prank(arbiter);
        vm.expectRevert(bytes("cant cancel"));
        escrow.cancelRoom(keccak256("nope"));
    }

    // --- Reentrancy -----------------------------------------------------------

    function test_SettleIsGuardedAgainstReentrancy() public {
        // Escrow aparte, con el token que reentra.
        ReentrantUSDC evil = new ReentrantUSDC();
        EscrowAleph esc = new EscrowAleph(address(evil), arbiter, platform, feeBps, owner);
        vm.prank(owner);
        esc.setAllowedStake(stake, true);
        for (uint256 i = 0; i < 4; i++) {
            evil.mint(seats4[i], stake);
            vm.prank(seats4[i]);
            evil.approve(address(esc), stake);
        }
        (uint64 fund, uint64 play) = _deadlines();
        bytes32 seatsHash = keccak256(abi.encode(seats4));
        for (uint256 i = 0; i < 4; i++) {
            bytes32 digest = esc.seatDigest(roomId, seatsHash, stake, fund, play, seats4[i]);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(arbiterPk, digest);
            bytes memory sig = abi.encodePacked(r, s, v);
            vm.prank(seats4[i]);
            if (i == 0) esc.open(roomId, seats4, stake, fund, play, sig);
            else esc.deposit(roomId, sig);
        }
        uint256[] memory amounts = _table4();
        bytes32 pd = esc.payoutDigest(roomId, keccak256(abi.encode(seats4, amounts)), _dl());
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(arbiterPk, pd);
        bytes memory paySig = abi.encodePacked(r2, s2, v2);

        // En cada envío, el token intenta cancelar la sala: el guard corta la
        // reentrada ANTES de mirar quién llama. El revert también deshace el
        // `armed = false` del token, así que lo intenta en TODOS los envíos, y
        // cada uno falla y queda ACREDITADO. Lo que importa: la sala quedó
        // liquidada (la cancelación nunca entró) y no se perdió un centavo.
        evil.arm(address(esc), abi.encodeWithSelector(EscrowAleph.cancelRoom.selector, roomId));
        vm.expectEmit(true, true, true, true, address(esc));
        emit EscrowAleph.Credited(roomId, platform, 1_200_000);
        esc.settle(roomId, seats4, amounts, _dl(), paySig);
        (,,,,, EscrowAleph.Status status) = esc.roomOf(roomId);
        assertEq(uint8(status), uint8(EscrowAleph.Status.Settled), "la reentrada no la cancelo");
        assertEq(esc.owed(platform), 1_200_000, "comision acreditada");
        for (uint256 i = 0; i < 4; i++) assertEq(esc.owed(seats4[i]), amounts[i], "pagos acreditados");
        assertEq(evil.balanceOf(address(esc)), 8_000_000, "custodia lo acreditado entero");

        // Y el retiro tampoco se deja reentrar: el token intenta liquidar de
        // nuevo mientras paga lo acreditado, y el retiro entero revierte (el
        // crédito queda intacto).
        evil.arm(address(esc), abi.encodeWithSelector(EscrowAleph.withdraw.selector));
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        esc.withdrawFor(platform);
        assertEq(esc.owed(platform), 1_200_000, "credito intacto tras el revert");
    }

    // --- Pagos que el USDC rechaza (v2) ---------------------------------------
    // Circle puede poner una dirección en su blacklist DESPUÉS de que depositó, o
    // pausar el token entero. En la v1 cualquiera de las dos trababa la sala: los
    // pagos se empujaban juntos y uno que revertía revertía todos, también en los
    // tres reembolsos. Ahora cada pago va por su cuenta y el rechazado queda
    // acreditado en `owed`.

    /// Liquidez del contrato: lo que tiene que custodiar es exactamente lo
    /// acreditado más lo de las salas abiertas que se le pasan.
    function _assertHolds(uint256 openStakes, address[] memory creditors) internal view {
        uint256 credited = 0;
        for (uint256 i = 0; i < creditors.length; i++) credited += escrow.owed(creditors[i]);
        assertEq(usdc.balanceOf(address(escrow)), credited + openStakes, "custodia = acreditado + salas abiertas");
    }

    function _withPlatform(address[] memory seats) internal view returns (address[] memory all) {
        all = new address[](seats.length + 1);
        for (uint256 i = 0; i < seats.length; i++) all[i] = seats[i];
        all[seats.length] = platform;
    }

    function test_SettlePaysAroundBlacklistedSeat() public {
        _fundRoom(roomId, seats4);
        usdc.blacklist(seats4[2], true); // después de depositar
        uint256[] memory amounts = _table4();
        bytes memory sig = _signPayout(roomId, seats4, amounts);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit EscrowAleph.Credited(roomId, seats4[2], amounts[2]);
        escrow.settle(roomId, seats4, amounts, _dl(), sig);

        assertEq(usdc.balanceOf(seats4[0]), amounts[0], "cobra");
        assertEq(usdc.balanceOf(seats4[1]), amounts[1], "cobra");
        assertEq(usdc.balanceOf(seats4[2]), 0, "en blacklist: no recibe");
        assertEq(usdc.balanceOf(seats4[3]), amounts[3], "cobra");
        assertEq(usdc.balanceOf(platform), 1_200_000, "comision");
        assertEq(escrow.owed(seats4[2]), amounts[2], "su parte queda acreditada");
        _assertHolds(0, _withPlatform(seats4));
    }

    function test_SettleCreditsBlacklistedPlatform() public {
        _fundRoom(roomId, seats4);
        usdc.blacklist(platform, true);
        uint256[] memory amounts = _table4();
        escrow.settle(roomId, seats4, amounts, _dl(), _signPayout(roomId, seats4, amounts));
        for (uint256 i = 0; i < 4; i++) assertEq(usdc.balanceOf(seats4[i]), amounts[i], "los asientos cobran igual");
        assertEq(escrow.owed(platform), 1_200_000, "la comision queda acreditada");
        _assertHolds(0, _withPlatform(seats4));
    }

    function test_RefundUnfundedCreditsBlacklistedDepositor() public {
        _open(roomId, seats4);
        _deposit(roomId, seats4, 1);
        usdc.blacklist(seats4[0], true);
        vm.warp(block.timestamp + 10 minutes + 1);
        escrow.refundUnfunded(roomId);
        assertEq(usdc.balanceOf(seats4[1]), stake, "el otro depositante recupera lo suyo");
        assertEq(escrow.owed(seats4[0]), stake, "el de la blacklist queda acreditado");
        (,,,,, EscrowAleph.Status status) = escrow.roomOf(roomId);
        assertEq(uint8(status), uint8(EscrowAleph.Status.Refunded));
        _assertHolds(0, seats4);
    }

    function test_RefundExpiredCreditsBlacklistedSeat() public {
        _fundRoom(roomId, seats4);
        usdc.blacklist(seats4[3], true);
        (, uint64 play) = _deadlines();
        vm.warp(uint256(play) + escrow.REFUND_GRACE() + 1);
        escrow.refundExpired(roomId);
        for (uint256 i = 0; i < 3; i++) assertEq(usdc.balanceOf(seats4[i]), stake, "recuperan su stake");
        assertEq(escrow.owed(seats4[3]), stake, "acreditado");
        _assertHolds(0, seats4);
    }

    function test_CancelCreditsBlacklistedSeat() public {
        _fundRoom(roomId, seats4);
        usdc.blacklist(seats4[1], true);
        vm.prank(arbiter);
        escrow.cancelRoom(roomId);
        assertEq(usdc.balanceOf(seats4[0]), stake);
        assertEq(usdc.balanceOf(seats4[2]), stake);
        assertEq(usdc.balanceOf(seats4[3]), stake);
        assertEq(escrow.owed(seats4[1]), stake, "acreditado");
        _assertHolds(0, seats4);
    }

    // Con el USDC en pausa no sale nada: todo queda acreditado, la sala se
    // cierra igual y, al levantarse la pausa, cualquiera entrega cada crédito a
    // su dueño.
    function test_TokenPausedCreditsEveryoneAndWithdrawForDelivers() public {
        _fundRoom(roomId, seats4);
        usdc.setPaused(true);
        uint256[] memory amounts = _table4();
        escrow.settle(roomId, seats4, amounts, _dl(), _signPayout(roomId, seats4, amounts));
        (,,,,, EscrowAleph.Status status) = escrow.roomOf(roomId);
        assertEq(uint8(status), uint8(EscrowAleph.Status.Settled), "liquidada aunque no salio un centavo");
        for (uint256 i = 0; i < 4; i++) assertEq(escrow.owed(seats4[i]), amounts[i]);
        assertEq(escrow.owed(platform), 1_200_000);
        _assertHolds(0, _withPlatform(seats4));

        usdc.setPaused(false);
        address courier = address(0xC0FFEE); // no es asiento ni plataforma
        for (uint256 i = 0; i < 4; i++) {
            vm.expectEmit(true, true, true, true, address(escrow));
            emit EscrowAleph.Withdrawn(seats4[i], amounts[i]);
            vm.prank(courier);
            escrow.withdrawFor(seats4[i]);
            assertEq(usdc.balanceOf(seats4[i]), amounts[i], "llega a su duenio");
            assertEq(escrow.owed(seats4[i]), 0);
        }
        vm.prank(platform);
        escrow.withdraw();
        assertEq(usdc.balanceOf(platform), 1_200_000);
        assertEq(usdc.balanceOf(courier), 0, "quien entrega no se queda con nada");
        assertEq(usdc.balanceOf(address(escrow)), 0, "contrato vacio");
    }

    function test_WithdrawAfterLeavingBlacklist() public {
        _fundRoom(roomId, seats4);
        usdc.blacklist(seats4[0], true);
        uint256[] memory amounts = _table4();
        escrow.settle(roomId, seats4, amounts, _dl(), _signPayout(roomId, seats4, amounts));

        // Mientras siga en la blacklist, retirar revierte y el crédito no se toca.
        vm.prank(seats4[0]);
        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        escrow.withdraw();
        assertEq(escrow.owed(seats4[0]), amounts[0], "credito intacto");

        usdc.blacklist(seats4[0], false);
        vm.prank(seats4[0]);
        escrow.withdraw();
        assertEq(usdc.balanceOf(seats4[0]), amounts[0], "cobra al salir de la blacklist");
        assertEq(escrow.owed(seats4[0]), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_WithdrawRevertsWhenNothingOwed() public {
        vm.prank(seats4[0]);
        vm.expectRevert(bytes("nothing owed"));
        escrow.withdraw();
        vm.expectRevert(bytes("nothing owed"));
        escrow.withdrawFor(seats4[1]);
    }

    // Lo acreditado es un saldo por dirección: suma lo de todas sus salas y un
    // solo retiro lo cobra entero.
    function test_OwedAccumulatesAcrossRooms() public {
        address[] memory other = new address[](4);
        for (uint160 i = 1; i <= 4; i++) other[i - 1] = address(0x3000 + i);
        _fund(other);
        bytes32 room2 = keccak256("room-2");
        _fundRoom(roomId, seats4);
        _fundRoom(room2, other);
        usdc.blacklist(platform, true);
        uint256[] memory amounts = _table4();
        escrow.settle(roomId, seats4, amounts, _dl(), _signPayout(roomId, seats4, amounts));
        escrow.settle(room2, other, amounts, _dl(), _signPayout(room2, other, amounts));
        assertEq(escrow.owed(platform), 2_400_000, "dos comisiones acreditadas");

        usdc.blacklist(platform, false);
        vm.prank(platform);
        escrow.withdraw();
        assertEq(usdc.balanceOf(platform), 2_400_000, "un retiro cobra las dos");
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // Propiedad: con cualquier tabla válida y cualquier subconjunto de asientos
    // en blacklist, nada se pierde ni se inventa. Lo que no salió está
    // acreditado a quien le tocaba, y el contrato custodia exactamente eso.
    function testFuzz_SettleConservesFundsWithAnyBlacklist(uint16[4] memory units, uint8 mask) public {
        _fundRoom(roomId, seats4);
        uint256 total = 0;
        for (uint256 i = 0; i < 4; i++) {
            units[i] = uint16(bound(units[i], 0, 4000));
            total += units[i];
        }
        vm.assume(total > 0);
        uint256 net = 6_800_000;
        uint256[] memory amounts = new uint256[](4);
        uint256 sum = 0;
        for (uint256 i = 0; i < 4; i++) {
            amounts[i] = (uint256(units[i]) * net) / total; // floor, como el árbitro
            sum += amounts[i];
        }
        for (uint256 i = 0; i < 4; i++) {
            if (mask & (1 << i) != 0) usdc.blacklist(seats4[i], true);
        }
        if (mask & 16 != 0) usdc.blacklist(platform, true);

        escrow.settle(roomId, seats4, amounts, _dl(), _signPayout(roomId, seats4, amounts));

        for (uint256 i = 0; i < 4; i++) {
            assertEq(usdc.balanceOf(seats4[i]) + escrow.owed(seats4[i]), amounts[i], "cada asiento: cobrado o acreditado");
        }
        assertEq(usdc.balanceOf(platform) + escrow.owed(platform), 8_000_000 - sum, "comision + polvo");
        _assertHolds(0, _withPlatform(seats4));
    }

    /// Una sala fondeada sobre otro escrow y otro token (para los tests que
    /// necesitan un USDC con mañas propias).
    function _fundRoomOn(EscrowAleph esc, MockUSDC tok, bytes32 id, address[] memory seats) internal {
        vm.prank(owner);
        esc.setAllowedStake(stake, true);
        (uint64 fund, uint64 play) = _deadlines();
        bytes32 seatsHash = keccak256(abi.encode(seats));
        for (uint256 i = 0; i < seats.length; i++) {
            tok.mint(seats[i], stake);
            vm.prank(seats[i]);
            tok.approve(address(esc), stake);
            bytes32 digest = esc.seatDigest(id, seatsHash, stake, fund, play, seats[i]);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(arbiterPk, digest);
            bytes memory sig = abi.encodePacked(r, s, v);
            vm.prank(seats[i]);
            if (i == 0) esc.open(id, seats, stake, fund, play, sig);
            else esc.deposit(id, sig);
        }
    }

    // GAS JUSTO: settle es permissionless, así que cualquiera elige con cuánto
    // gas llamarlo. Si el envío a un asiento se queda sin gas mientras settle
    // todavía tiene para seguir, sin la guarda de `_pay` ese pago sano se volvía
    // un crédito (y su dueño tenía que retirarlo a mano). Con el USDC real la
    // ventana no se abre; con un token de pago caro sí, así que el test la abre a
    // propósito y barre límites de gas: con cualquiera, o la liquidación revierte
    // entera o paga a todos, y nunca acredita a quien el token no rechazó.
    function test_SettleWithTightGasNeverCreditsHealthySeats() public {
        GasHungryUSDC tok = new GasHungryUSDC();
        EscrowAleph esc = new EscrowAleph(address(tok), arbiter, platform, feeBps, owner);
        _fundRoomOn(esc, tok, roomId, seats4);
        tok.setHungry(seats4[3], 2_000_000); // el último pago de la tabla es caro
        uint256[] memory amounts = _table4();
        uint64 dl = _dl();
        bytes32 pd = esc.payoutDigest(roomId, esc.tableHashOf(seats4, amounts), dl);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(arbiterPk, pd);
        bytes memory callData =
            abi.encodeCall(EscrowAleph.settle, (roomId, seats4, amounts, dl, abi.encodePacked(r, s, v)));

        uint256 snap = vm.snapshotState();
        uint256 okRuns = 0;
        uint256 revertedRuns = 0;
        for (uint256 g = 1_500_000; g <= 2_600_000; g += 10_000) {
            vm.revertToState(snap);
            (bool ok,) = address(esc).call{gas: g}(callData);
            if (!ok) {
                revertedRuns++;
                continue;
            }
            okRuns++;
            for (uint256 i = 0; i < 4; i++) {
                assertEq(esc.owed(seats4[i]), 0, "ningun credito forzado");
                assertEq(tok.balanceOf(seats4[i]), amounts[i], "cobro entero");
            }
            assertEq(esc.owed(platform), 0, "ni a la plataforma");
        }
        assertGt(revertedRuns, 0, "el barrido paso por la ventana de gas justo");
        assertGt(okRuns, 0, "el barrido llego a liquidar");
    }

    function test_WithdrawForNeverPaysTheCaller() public {
        _fundRoom(roomId, seats4);
        usdc.setPaused(true);
        uint256[] memory amounts = _table4();
        escrow.settle(roomId, seats4, amounts, _dl(), _signPayout(roomId, seats4, amounts));
        usdc.setPaused(false);
        // Un asiento intenta cobrar lo de otro: le llega al otro.
        vm.prank(seats4[1]);
        escrow.withdrawFor(seats4[0]);
        assertEq(usdc.balanceOf(seats4[0]), amounts[0]);
        assertEq(usdc.balanceOf(seats4[1]), 0, "no se lleva lo ajeno");
        assertEq(escrow.owed(seats4[1]), amounts[1], "lo suyo sigue acreditado");
    }

    // --- Vencimiento de la tabla firmada (v2) -----------------------------------

    function test_SettleRejectsExpiredPayout() public {
        _fundRoom(roomId, seats4);
        uint256[] memory amounts = _table4();
        uint64 dl = _dl();
        bytes memory sig = _signPayout(roomId, seats4, amounts);
        vm.warp(uint256(dl) + 1);
        vm.expectRevert(bytes("payout expired"));
        escrow.settle(roomId, seats4, amounts, dl, sig);
    }

    function test_SettleAcceptsAtExactDeadline() public {
        _fundRoom(roomId, seats4);
        uint256[] memory amounts = _table4();
        uint64 dl = _dl();
        bytes memory sig = _signPayout(roomId, seats4, amounts);
        vm.warp(dl);
        escrow.settle(roomId, seats4, amounts, dl, sig);
        assertEq(usdc.balanceOf(seats4[0]), amounts[0]);
    }

    // El vencimiento va DENTRO de la firma: presentarla con otro plazo (para
    // estirarle la vida) no verifica.
    function test_SettleRejectsDeadlineThatWasNotSigned() public {
        _fundRoom(roomId, seats4);
        uint256[] memory amounts = _table4();
        uint64 dl = _dl();
        bytes memory sig = _signPayout(roomId, seats4, amounts);
        vm.expectRevert(bytes("bad signature"));
        escrow.settle(roomId, seats4, amounts, dl + 1 days, sig);
    }

    // Vencida una tabla, el árbitro firma de nuevo la MISMA con otro plazo: la
    // nueva paga, y la vieja ya no sirve para nada.
    function test_ResignedTablePaysAndOldSignatureIsDead() public {
        _fundRoom(roomId, seats4);
        uint256[] memory amounts = _table4();
        uint64 dl1 = _dl();
        bytes memory sig1 = _signPayout(roomId, seats4, amounts);
        vm.warp(uint256(dl1) + 1);
        uint64 dl2 = _dl();
        bytes memory sig2 = _signPayout(roomId, seats4, amounts);
        vm.expectRevert(bytes("payout expired"));
        escrow.settle(roomId, seats4, amounts, dl1, sig1);
        escrow.settle(roomId, seats4, amounts, dl2, sig2);
        assertEq(usdc.balanceOf(seats4[0]), amounts[0]);
    }
}
