// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Escrow1v1} from "../src/Escrow1v1.sol";
import {BlacklistUSDC} from "./BlacklistUSDC.sol";
import {ReentrantUSDC} from "./ReentrantUSDC.sol";
import {GasHungryUSDC} from "./GasHungryUSDC.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract Escrow1v1Test is Test {
    Escrow1v1 escrow;
    // Se comporta como MockUSDC hasta que un test prende la blacklist o la
    // pausa: así todas las pruebas corren contra el mismo token.
    BlacklistUSDC usdc;

    address owner = address(0xABCD);
    address platform = address(0xFEE5);
    address notOwner = address(0x9999); // cualquiera sin permiso de owner
    address p1 = address(0x1111);
    address p2 = address(0x2222);

    uint256 arbiterPk = 0xA11CE; // clave privada del arbitro (para firmar en tests)
    address arbiter;

    uint256 stake = 5_000_000; // 5 USDC (6 decimales)
    uint16 feeBps = 1000; // 10%

    bytes32 matchId = keccak256("match-1");

    // Las condiciones que el árbitro ata al asiento, fijadas al arrancar (como
    // el árbitro: salen de la hora en que se creó la partida, no de la del
    // depósito).
    uint64 fundDl;
    uint64 playDl;

    // La gracia del contrato, como constante del test: leerla con
    // `escrow.REFUND_GRACE()` en medio de un `vm.expectRevert(...)` gastaría el
    // expectRevert en esa lectura. test_RefundGraceMatchesContract la ata.
    uint64 constant GRACE = 30 minutes;

    function setUp() public {
        arbiter = vm.addr(arbiterPk);
        usdc = new BlacklistUSDC();
        escrow = new Escrow1v1(address(usdc), arbiter, platform, feeBps, owner);

        vm.prank(owner);
        escrow.setAllowedStake(stake, true);

        // Dar USDC a los jugadores y que aprueben al contrato.
        _fund(p1);
        _fund(p2);

        fundDl = uint64(block.timestamp + 70 minutes);
        playDl = uint64(block.timestamp + 2 hours);
    }

    function _fund(address who) internal {
        usdc.mint(who, stake);
        vm.prank(who);
        usdc.approve(address(escrow), stake);
    }

    // Firma del arbitro que autoriza a `player` a depositar en `id` con esas
    // condiciones (asiento).
    function _signSeatTerms(bytes32 id, address player, uint256 st, uint64 fund, uint64 play)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = escrow.seatDigest(id, player, st, fund, play);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(arbiterPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signSeat(bytes32 id, address player) internal view returns (bytes memory) {
        return _signSeatTerms(id, player, stake, fundDl, playDl);
    }

    // p1 ABRE la partida depositando su apuesta (modelo asincronico).
    // Ojo: el asiento se firma ANTES del prank; _signSeat hace un staticcall a
    // seatDigest y consumiría el prank/expectRevert si se evaluara como argumento.
    function _open() internal {
        bytes memory seat = _signSeat(matchId, p1);
        vm.prank(p1);
        escrow.open(matchId, stake, fundDl, playDl, seat);
    }

    // p1 abre y p2 se UNE: partida lista (Funded).
    function _openAndJoin() internal {
        _open();
        bytes memory seat = _signSeat(matchId, p2);
        vm.prank(p2);
        escrow.join(matchId, seat);
    }

    // Vencimiento del resultado según la política del árbitro: vale hasta que
    // se abre el reembolso permissionless, ni un segundo más.
    function _resultDl() internal view returns (uint64) {
        return playDl + GRACE;
    }

    function _signResultDl(bytes32 id, address winner, uint64 dl) internal view returns (bytes memory) {
        bytes32 digest = escrow.resultDigest(id, winner, dl);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(arbiterPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signResult(address winner) internal view returns (bytes memory) {
        return _signResultDl(matchId, winner, _resultDl());
    }

    function test_RefundGraceMatchesContract() public view {
        assertEq(escrow.REFUND_GRACE(), GRACE);
    }

    function _status(bytes32 id) internal view returns (Escrow1v1.Status status) {
        (,,,,,,, status) = escrow.matches(id);
    }

    // --- Abrir bloquea el deposito de p1 y guarda las condiciones firmadas ---
    function test_OpenLocksStake() public {
        _open();
        assertEq(usdc.balanceOf(p1), 0, "p1 deposito");
        assertEq(usdc.balanceOf(address(escrow)), stake, "escrow tiene 1 stake");
        (address a, address b, uint256 st, bool paid1, bool paid2, uint64 fund, uint64 play, Escrow1v1.Status s) =
            escrow.matches(matchId);
        assertEq(a, p1);
        assertEq(b, address(0));
        assertEq(st, stake);
        assertTrue(paid1 && !paid2);
        assertEq(fund, fundDl, "plazo de fondeo del asiento");
        assertEq(play, playDl, "plazo de juego del asiento");
        assertEq(uint8(s), uint8(Escrow1v1.Status.Open));
    }

    // --- Camino feliz: ganador cobra, plataforma cobra comision ---
    function test_SettleHappyPath() public {
        _openAndJoin();

        bytes memory sig = _signResult(p1);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit Escrow1v1.Settled(matchId, p1, 9_000_000, 1_000_000);
        escrow.settle(matchId, p1, _resultDl(), sig);

        // Pozo = 10 USDC; comision 10% = 1 USDC; premio = 9 USDC.
        assertEq(usdc.balanceOf(p1), 9_000_000, "premio ganador");
        assertEq(usdc.balanceOf(platform), 1_000_000, "comision plataforma");
        assertEq(usdc.balanceOf(address(escrow)), 0, "contrato vacio");
        assertEq(uint8(_status(matchId)), uint8(Escrow1v1.Status.Settled));
    }

    // --- Firma invalida (no es el arbitro) debe fallar ---
    function test_SettleRejectsBadSignature() public {
        _openAndJoin();

        uint256 fakePk = 0xBADBAD;
        bytes32 digest = escrow.resultDigest(matchId, p1, _resultDl());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fakePk, digest);
        bytes memory badSig = abi.encodePacked(r, s, v);

        vm.expectRevert(bytes("bad signature"));
        escrow.settle(matchId, p1, _resultDl(), badSig);
    }

    // --- La firma ata al ganador: la de p1 no sirve para cobrar p2 ---
    function test_SettleRejectsSignatureForTheOtherWinner() public {
        _openAndJoin();
        bytes memory sig = _signResult(p1);
        vm.expectRevert(bytes("bad signature"));
        escrow.settle(matchId, p2, _resultDl(), sig);
    }

    // --- El ganador tiene que ser uno de los dos jugadores ---
    function test_SettleRejectsWinnerThatDidNotPlay() public {
        _openAndJoin();
        address stranger = address(0x777);
        bytes memory sig = _signResultDl(matchId, stranger, _resultDl());
        vm.expectRevert(bytes("bad winner"));
        escrow.settle(matchId, stranger, _resultDl(), sig);
    }

    // --- No se puede liquidar dos veces ---
    function test_CannotSettleTwice() public {
        _openAndJoin();
        bytes memory sig = _signResult(p1);
        escrow.settle(matchId, p1, _resultDl(), sig);

        vm.expectRevert(bytes("not funded"));
        escrow.settle(matchId, p1, _resultDl(), sig);
    }

    // --- Ni liquidar una partida a la que todavia le falta el rival ---
    function test_SettleRejectsOpenMatch() public {
        _open();
        bytes memory sig = _signResult(p1);
        vm.expectRevert(bytes("not funded"));
        escrow.settle(matchId, p1, _resultDl(), sig);
    }

    // --- Reembolso si nadie se unio a tiempo (partida abierta sin rival) ---
    function test_RefundUnfunded() public {
        _open(); // solo p1 abrio (deposito)

        vm.warp(uint256(fundDl) + 1);
        escrow.refundUnfunded(matchId);

        assertEq(usdc.balanceOf(p1), stake, "p1 recupera su deposito");
        assertEq(uint8(_status(matchId)), uint8(Escrow1v1.Status.Refunded));
    }

    function test_RefundUnfundedRejectsBeforeFundDeadline() public {
        _open();
        vm.warp(fundDl);
        vm.expectRevert(bytes("not expired"));
        escrow.refundUnfunded(matchId);
    }

    // --- Reembolso si vencio el plazo de juego sin resultado (rival no jugo) ---
    function test_RefundExpired() public {
        _openAndJoin();

        // Pasado el plazo de juego + la gracia (el borde exacto lo cubre
        // test_RefundExpiredRespectsGrace): se reembolsa a ambos.
        vm.warp(uint256(playDl) + GRACE + 1);
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

    // --- El dueño tambien cancela; un extraño no, ni una partida cerrada ---
    function test_CancelPermissions() public {
        _open();
        vm.prank(notOwner);
        vm.expectRevert(bytes("not allowed"));
        escrow.cancelMatch(matchId);

        vm.prank(owner);
        escrow.cancelMatch(matchId);
        assertEq(usdc.balanceOf(p1), stake, "p1 reembolsado por el duenio");

        vm.prank(arbiter);
        vm.expectRevert(bytes("cant cancel"));
        escrow.cancelMatch(matchId);
    }

    // --- No se permite abrir una mesa no habilitada ---
    function test_RejectsDisallowedStake() public {
        bytes32 x = keccak256("x");
        bytes memory seat = _signSeatTerms(x, p1, 999, fundDl, playDl);
        vm.prank(p1);
        vm.expectRevert(bytes("stake not allowed"));
        escrow.open(x, 999, fundDl, playDl, seat); // monto no permitido
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
        bytes32 digest = escrow.seatDigest(matchId, p1, stake, fundDl, playDl);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fakePk, digest);
        vm.prank(p1);
        vm.expectRevert(bytes("bad seat"));
        escrow.open(matchId, stake, fundDl, playDl, abi.encodePacked(r, s, v));
    }

    // --- GRIEFING: un tercero no puede secuestrar el slot de p2 sin asiento ---
    function test_JoinRejectsAttackerWithoutSeat() public {
        _open();
        address attacker = address(0x666);
        _fund(attacker);

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
        escrow.open(other, stake, fundDl, playDl, wrongSeat);
    }

    // --- refundExpired respeta el período de gracia ---
    function test_RefundExpiredRespectsGrace() public {
        _openAndJoin();

        // Justo pasado playDeadline pero DENTRO de la gracia: aún no se puede.
        vm.warp(uint256(playDl) + 1);
        vm.expectRevert(bytes("not expired"));
        escrow.refundExpired(matchId);

        // Pasada la gracia: sí reembolsa a ambos.
        vm.warp(uint256(playDl) + GRACE + 1);
        escrow.refundExpired(matchId);
        assertEq(usdc.balanceOf(p1), stake, "p1 reembolsado tras la gracia");
        assertEq(usdc.balanceOf(p2), stake, "p2 reembolsado tras la gracia");
    }

    // --- ANTI-GRIEFING: dentro de la gracia, un settle tardío GANA al reembolso ---
    function test_SettleWinsInsideGraceWindow() public {
        _openAndJoin();

        // Pasó el plazo de juego (settle "tardío"), pero seguimos en la gracia.
        vm.warp(uint256(playDl) + 1);

        // El perdedor NO puede escaparse con refundExpired todavía...
        vm.expectRevert(bytes("not expired"));
        escrow.refundExpired(matchId);

        // ...y el settle legítimo del ganador se liquida normalmente.
        bytes memory sig = _signResult(p1);
        escrow.settle(matchId, p1, _resultDl(), sig);
        assertEq(usdc.balanceOf(p1), 9_000_000, "el ganador cobra pese al settle tardio");
    }

    // --- Condiciones atadas al asiento (v2) -----------------------------------
    // En la v1 el asiento ataba solo (matchId, player): el stake y los plazos
    // los elegía quien abría, y el que se unía los revisaba por su cuenta.

    // Quien abre no puede cambiar ni una de las condiciones que le firmaron.
    function test_OpenRejectsTermsOtherThanSigned() public {
        uint256 bigStake = 10_000_000;
        vm.prank(owner);
        escrow.setAllowedStake(bigStake, true);
        usdc.mint(p1, bigStake);
        vm.prank(p1);
        usdc.approve(address(escrow), bigStake);
        bytes memory seat = _signSeat(matchId, p1);

        vm.startPrank(p1);
        vm.expectRevert(bytes("bad seat"));
        escrow.open(matchId, bigStake, fundDl, playDl, seat); // otra mesa
        vm.expectRevert(bytes("bad seat"));
        escrow.open(matchId, stake, fundDl + 10 minutes, playDl, seat); // fondeo mas largo
        vm.expectRevert(bytes("bad seat"));
        escrow.open(matchId, stake, fundDl, playDl + 7 days, seat); // juego mas largo
        escrow.open(matchId, stake, fundDl, playDl, seat); // las firmadas: entra
        vm.stopPrank();
    }

    // El asiento del que se une verifica contra las condiciones GUARDADAS: si
    // el árbitro le firmó otras (un bug, un árbitro reiniciado), no entra.
    function test_JoinRejectsSeatSignedForOtherTerms() public {
        _open();
        bytes memory otherPlay = _signSeatTerms(matchId, p2, stake, fundDl, playDl + 1);
        bytes memory otherFund = _signSeatTerms(matchId, p2, stake, fundDl - 1, playDl);
        bytes memory otherStake = _signSeatTerms(matchId, p2, stake * 2, fundDl, playDl);
        vm.startPrank(p2);
        vm.expectRevert(bytes("bad seat"));
        escrow.join(matchId, otherPlay);
        vm.expectRevert(bytes("bad seat"));
        escrow.join(matchId, otherFund);
        vm.expectRevert(bytes("bad seat"));
        escrow.join(matchId, otherStake);
        vm.stopPrank();
        assertEq(uint8(_status(matchId)), uint8(Escrow1v1.Status.Open), "sigue esperando rival");
    }

    // Unos plazos imposibles no entran aunque el árbitro los haya firmado.
    function test_OpenRejectsBadDeadlines() public {
        uint64 past = uint64(block.timestamp);
        bytes memory seatPast = _signSeatTerms(matchId, p1, stake, past, playDl);
        bytes memory seatInverted = _signSeatTerms(matchId, p1, stake, fundDl, fundDl);
        vm.startPrank(p1);
        vm.expectRevert(bytes("bad deadlines"));
        escrow.open(matchId, stake, past, playDl, seatPast);
        vm.expectRevert(bytes("bad deadlines"));
        escrow.open(matchId, stake, fundDl, fundDl, seatInverted);
        vm.stopPrank();
    }

    function test_JoinRejectsAfterFundDeadline() public {
        _open();
        bytes memory seat = _signSeat(matchId, p2);
        vm.warp(uint256(fundDl) + 1);
        vm.prank(p2);
        vm.expectRevert(bytes("fund expired"));
        escrow.join(matchId, seat);
    }

    // FRENO DE ENTRADAS: con la mesa deshabilitada tampoco se completa una
    // partida ya abierta; lo de p1 vuelve igual.
    function test_JoinRejectsDisabledTable() public {
        _open();
        vm.prank(owner);
        escrow.setAllowedStake(stake, false);
        bytes memory seat = _signSeat(matchId, p2);
        vm.prank(p2);
        vm.expectRevert(bytes("stake not allowed"));
        escrow.join(matchId, seat);

        vm.warp(uint256(fundDl) + 1);
        escrow.refundUnfunded(matchId);
        assertEq(usdc.balanceOf(p1), stake, "la salida no se frena");
    }

    // Y deshabilitarla no frena ninguna salida de una partida ya fondeada.
    function test_DisabledTableStillSettlesAndRefunds() public {
        _openAndJoin();
        vm.prank(owner);
        escrow.setAllowedStake(stake, false);
        bytes memory sig = _signResult(p2);
        escrow.settle(matchId, p2, _resultDl(), sig);
        assertEq(usdc.balanceOf(p2), 9_000_000, "liquida igual");
    }

    // --- Vencimiento del resultado firmado (v2) ---------------------------------

    function test_SettleRejectsExpiredResult() public {
        _openAndJoin();
        uint64 dl = uint64(block.timestamp + 15 minutes);
        bytes memory sig = _signResultDl(matchId, p1, dl);
        vm.warp(uint256(dl) + 1);
        vm.expectRevert(bytes("result expired"));
        escrow.settle(matchId, p1, dl, sig);
    }

    function test_SettleAcceptsAtExactDeadline() public {
        _openAndJoin();
        uint64 dl = uint64(block.timestamp + 15 minutes);
        bytes memory sig = _signResultDl(matchId, p1, dl);
        vm.warp(dl);
        escrow.settle(matchId, p1, dl, sig);
        assertEq(usdc.balanceOf(p1), 9_000_000);
    }

    // El vencimiento va DENTRO de la firma: presentarla con otro plazo (para
    // estirarle la vida) no verifica.
    function test_SettleRejectsDeadlineThatWasNotSigned() public {
        _openAndJoin();
        bytes memory sig = _signResult(p1);
        vm.expectRevert(bytes("bad signature"));
        escrow.settle(matchId, p1, _resultDl() + 1 days, sig);
    }

    // La política del árbitro: el resultado vence justo cuando se abre el
    // reembolso. En ningún segundo valen los dos caminos, y en ninguno falta uno.
    function test_ResultExpiresExactlyWhenRefundOpens() public {
        _openAndJoin();
        uint64 dl = _resultDl();
        bytes memory sig = _signResult(p1);
        uint256 snap = vm.snapshotState();

        vm.warp(dl); // último segundo del resultado
        vm.expectRevert(bytes("not expired"));
        escrow.refundExpired(matchId);
        escrow.settle(matchId, p1, dl, sig);
        assertEq(usdc.balanceOf(p1), 9_000_000, "en el borde, liquida");

        vm.revertToState(snap);
        vm.warp(uint256(dl) + 1); // primer segundo del reembolso
        vm.expectRevert(bytes("result expired"));
        escrow.settle(matchId, p1, dl, sig);
        escrow.refundExpired(matchId);
        assertEq(usdc.balanceOf(p1), stake, "un segundo despues, reembolsa");
        assertEq(usdc.balanceOf(p2), stake);
    }

    // Rotar la llave del árbitro (la respuesta a una filtración) invalida lo
    // que firmó la vieja: asientos y resultados. La nueva firma de nuevo.
    function test_RotatedArbiterInvalidatesOldSignatures() public {
        _openAndJoin();
        bytes memory oldSig = _signResult(p1);
        uint256 newPk = 0xB0B;
        vm.prank(owner);
        escrow.setArbiter(vm.addr(newPk));

        vm.expectRevert(bytes("bad signature"));
        escrow.settle(matchId, p1, _resultDl(), oldSig);

        bytes32 digest = escrow.resultDigest(matchId, p2, _resultDl());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(newPk, digest);
        escrow.settle(matchId, p2, _resultDl(), abi.encodePacked(r, s, v));
        assertEq(usdc.balanceOf(p2), 9_000_000, "vale lo que firma la llave nueva");
    }

    // --- Pagos que el USDC rechaza (v2) ---------------------------------------
    // Circle puede poner una dirección en su blacklist DESPUÉS de que depositó, o
    // pausar el token entero. En la v1 cualquiera de las dos trababa la partida:
    // el premio y los reembolsos se empujaban juntos y uno que revertía revertía
    // todo. Ahora cada pago va por su cuenta y el rechazado queda acreditado en
    // `owed`.

    /// Liquidez del contrato: lo que tiene que custodiar es exactamente lo
    /// acreditado más lo de las partidas abiertas que se le pasan.
    function _assertHolds(uint256 openStakes) internal view {
        uint256 credited = escrow.owed(p1) + escrow.owed(p2) + escrow.owed(platform);
        assertEq(usdc.balanceOf(address(escrow)), credited + openStakes, "custodia = acreditado + abiertas");
    }

    function test_SettleCreditsBlacklistedWinner() public {
        _openAndJoin();
        usdc.blacklist(p1, true); // después de depositar
        bytes memory sig = _signResult(p1);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit Escrow1v1.Credited(matchId, p1, 9_000_000);
        escrow.settle(matchId, p1, _resultDl(), sig);

        assertEq(uint8(_status(matchId)), uint8(Escrow1v1.Status.Settled), "liquidada igual");
        assertEq(usdc.balanceOf(p1), 0, "en blacklist: no recibe");
        assertEq(escrow.owed(p1), 9_000_000, "el premio queda acreditado");
        assertEq(usdc.balanceOf(platform), 1_000_000, "la comision sale");
        _assertHolds(0);
    }

    function test_SettleCreditsBlacklistedPlatform() public {
        _openAndJoin();
        usdc.blacklist(platform, true);
        bytes memory sig = _signResult(p2);
        escrow.settle(matchId, p2, _resultDl(), sig);
        assertEq(usdc.balanceOf(p2), 9_000_000, "el ganador cobra igual");
        assertEq(escrow.owed(platform), 1_000_000, "la comision queda acreditada");
        _assertHolds(0);
    }

    // El perdedor en la blacklist no traba nada: no recibe pago.
    function test_SettleIgnoresBlacklistedLoser() public {
        _openAndJoin();
        usdc.blacklist(p2, true);
        bytes memory sig = _signResult(p1);
        escrow.settle(matchId, p1, _resultDl(), sig);
        assertEq(usdc.balanceOf(p1), 9_000_000);
        assertEq(escrow.owed(p2), 0);
        _assertHolds(0);
    }

    function test_RefundUnfundedCreditsBlacklistedOpener() public {
        _open();
        usdc.blacklist(p1, true);
        vm.warp(uint256(fundDl) + 1);
        escrow.refundUnfunded(matchId);
        assertEq(uint8(_status(matchId)), uint8(Escrow1v1.Status.Refunded));
        assertEq(escrow.owed(p1), stake, "acreditado");
        _assertHolds(0);
    }

    // El caso que en la v1 trababa la plata del OTRO para siempre.
    function test_RefundExpiredPaysTheOtherDespiteBlacklist() public {
        _openAndJoin();
        usdc.blacklist(p2, true);
        vm.warp(uint256(playDl) + GRACE + 1);
        escrow.refundExpired(matchId);
        assertEq(usdc.balanceOf(p1), stake, "p1 recupera lo suyo");
        assertEq(escrow.owed(p2), stake, "p2 queda acreditado");
        _assertHolds(0);
    }

    function test_CancelPaysTheOtherDespiteBlacklist() public {
        _openAndJoin();
        usdc.blacklist(p1, true);
        vm.prank(arbiter);
        escrow.cancelMatch(matchId);
        assertEq(usdc.balanceOf(p2), stake, "p2 recupera lo suyo");
        assertEq(escrow.owed(p1), stake, "p1 queda acreditado");
        _assertHolds(0);
    }

    // Con el USDC en pausa no sale nada: todo queda acreditado, la partida se
    // cierra igual y, al levantarse la pausa, cualquiera entrega cada crédito a
    // su dueño.
    function test_TokenPausedCreditsEverythingAndWithdrawForDelivers() public {
        _openAndJoin();
        usdc.setPaused(true);
        bytes memory sig = _signResult(p1);
        escrow.settle(matchId, p1, _resultDl(), sig);
        assertEq(uint8(_status(matchId)), uint8(Escrow1v1.Status.Settled), "liquidada aunque no salio un centavo");
        assertEq(escrow.owed(p1), 9_000_000);
        assertEq(escrow.owed(platform), 1_000_000);
        _assertHolds(0);

        usdc.setPaused(false);
        address courier = address(0xC0FFEE); // no es jugador ni plataforma
        vm.expectEmit(true, true, true, true, address(escrow));
        emit Escrow1v1.Withdrawn(p1, 9_000_000);
        vm.prank(courier);
        escrow.withdrawFor(p1);
        vm.prank(platform);
        escrow.withdraw();
        assertEq(usdc.balanceOf(p1), 9_000_000, "llega a su duenio");
        assertEq(usdc.balanceOf(platform), 1_000_000);
        assertEq(usdc.balanceOf(courier), 0, "quien entrega no se queda con nada");
        assertEq(usdc.balanceOf(address(escrow)), 0, "contrato vacio");
    }

    function test_WithdrawAfterLeavingBlacklist() public {
        _openAndJoin();
        usdc.blacklist(p1, true);
        bytes memory sig = _signResult(p1);
        escrow.settle(matchId, p1, _resultDl(), sig);

        // Mientras siga en la blacklist, retirar revierte y el crédito no se toca.
        vm.prank(p1);
        vm.expectRevert(bytes("Blacklistable: account is blacklisted"));
        escrow.withdraw();
        assertEq(escrow.owed(p1), 9_000_000, "credito intacto");

        usdc.blacklist(p1, false);
        vm.prank(p1);
        escrow.withdraw();
        assertEq(usdc.balanceOf(p1), 9_000_000, "cobra al salir de la blacklist");
        assertEq(escrow.owed(p1), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_WithdrawRevertsWhenNothingOwed() public {
        vm.prank(p1);
        vm.expectRevert(bytes("nothing owed"));
        escrow.withdraw();
        vm.expectRevert(bytes("nothing owed"));
        escrow.withdrawFor(p2);
    }

    // Lo acreditado es un saldo por dirección: suma lo de todas sus partidas y
    // un solo retiro lo cobra entero.
    function test_OwedAccumulatesAcrossMatches() public {
        bytes32 second = keccak256("match-2");
        _openAndJoin();
        _fund(p1);
        _fund(p2);
        bytes memory s1 = _signSeat(second, p1);
        vm.prank(p1);
        escrow.open(second, stake, fundDl, playDl, s1);
        bytes memory s2 = _signSeat(second, p2);
        vm.prank(p2);
        escrow.join(second, s2);

        usdc.blacklist(platform, true);
        bytes memory r1 = _signResult(p1);
        escrow.settle(matchId, p1, _resultDl(), r1);
        bytes memory r2 = _signResultDl(second, p2, _resultDl());
        escrow.settle(second, p2, _resultDl(), r2);
        assertEq(escrow.owed(platform), 2_000_000, "dos comisiones acreditadas");

        usdc.blacklist(platform, false);
        vm.prank(platform);
        escrow.withdraw();
        assertEq(usdc.balanceOf(platform), 2_000_000, "un retiro cobra las dos");
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // Propiedad: con cualquier combinación de blacklist (jugadores, plataforma)
    // y de pausa, por cualquier camino de salida, nada se pierde ni se inventa.
    // Lo que no salió está acreditado a quien le tocaba, y el contrato custodia
    // exactamente eso.
    function testFuzz_EveryExitConservesFunds(uint8 mask, uint8 path) public {
        path = uint8(bound(path, 0, 4));
        if (path == 3) _open(); // refundUnfunded
        else _openAndJoin();
        if (mask & 1 != 0) usdc.blacklist(p1, true);
        if (mask & 2 != 0) usdc.blacklist(p2, true);
        if (mask & 4 != 0) usdc.blacklist(platform, true);
        if (mask & 8 != 0) usdc.setPaused(true);

        uint256 p1Gets;
        uint256 p2Gets;
        uint256 platformGets;
        if (path <= 1) {
            address winner = path == 0 ? p1 : p2;
            bytes memory sig = _signResult(winner);
            escrow.settle(matchId, winner, _resultDl(), sig);
            (p1Gets, p2Gets) = path == 0 ? (uint256(9_000_000), uint256(0)) : (uint256(0), uint256(9_000_000));
            platformGets = 1_000_000;
        } else if (path == 2) {
            vm.warp(uint256(playDl) + GRACE + 1);
            escrow.refundExpired(matchId);
            (p1Gets, p2Gets) = (stake, stake);
        } else if (path == 3) {
            vm.warp(uint256(fundDl) + 1);
            escrow.refundUnfunded(matchId);
            // p2 nunca depositó: conserva lo suyo, y el contrato no le debe nada.
            (p1Gets, p2Gets) = (stake, stake);
        } else {
            vm.prank(arbiter);
            escrow.cancelMatch(matchId);
            (p1Gets, p2Gets) = (stake, stake);
        }

        assertEq(usdc.balanceOf(p1) + escrow.owed(p1), p1Gets, "p1: cobrado o acreditado");
        assertEq(usdc.balanceOf(p2) + escrow.owed(p2), p2Gets, "p2: cobrado o acreditado");
        assertEq(usdc.balanceOf(platform) + escrow.owed(platform), platformGets, "plataforma");
        _assertHolds(0);
    }

    // --- Gas justo -------------------------------------------------------------
    // settle es permissionless, así que cualquiera elige con cuánto gas llamarlo.
    // Si el envío del premio se queda sin gas mientras settle todavía tiene para
    // seguir, sin la guarda de `_pay` ese pago sano se volvía un crédito (y el
    // ganador tenía que retirarlo a mano). Con el USDC real la ventana no se
    // abre; con un token de pago caro sí, así que el test la abre a propósito y
    // barre límites de gas: con cualquiera, o la liquidación revierte entera o
    // paga, y nunca acredita a quien el token no rechazó.
    function test_SettleWithTightGasNeverCreditsHealthyWinner() public {
        GasHungryUSDC tok = new GasHungryUSDC();
        Escrow1v1 esc = new Escrow1v1(address(tok), arbiter, platform, feeBps, owner);
        _fundMatchOn(esc, tok, matchId);
        tok.setHungry(p1, 2_000_000); // el premio es el último pago y es caro
        uint64 dl = _resultDl();
        bytes32 rd = esc.resultDigest(matchId, p1, dl);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(arbiterPk, rd);
        bytes memory callData = abi.encodeCall(Escrow1v1.settle, (matchId, p1, dl, abi.encodePacked(r, s, v)));

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
            assertEq(esc.owed(p1), 0, "ningun credito forzado");
            assertEq(tok.balanceOf(p1), 9_000_000, "cobro entero");
            assertEq(esc.owed(platform), 0, "ni a la plataforma");
        }
        assertGt(revertedRuns, 0, "el barrido paso por la ventana de gas justo");
        assertGt(okRuns, 0, "el barrido llego a liquidar");
    }

    /// Una partida fondeada sobre otro escrow y otro token (para los tests que
    /// necesitan un USDC con mañas propias).
    function _fundMatchOn(Escrow1v1 esc, MockUSDC tok, bytes32 id) internal {
        vm.prank(owner);
        esc.setAllowedStake(stake, true);
        address[2] memory players = [p1, p2];
        for (uint256 i = 0; i < 2; i++) {
            tok.mint(players[i], stake);
            vm.prank(players[i]);
            tok.approve(address(esc), stake);
            bytes32 digest = esc.seatDigest(id, players[i], stake, fundDl, playDl);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(arbiterPk, digest);
            bytes memory sig = abi.encodePacked(r, s, v);
            vm.prank(players[i]);
            if (i == 0) esc.open(id, stake, fundDl, playDl, sig);
            else esc.join(id, sig);
        }
    }

    function test_WithdrawForNeverPaysTheCaller() public {
        _openAndJoin();
        usdc.setPaused(true);
        bytes memory sig = _signResult(p1);
        escrow.settle(matchId, p1, _resultDl(), sig);
        usdc.setPaused(false);
        // El perdedor intenta cobrar lo del ganador: le llega al ganador.
        vm.prank(p2);
        escrow.withdrawFor(p1);
        assertEq(usdc.balanceOf(p1), 9_000_000);
        assertEq(usdc.balanceOf(p2), 0, "no se lleva lo ajeno");
    }

    // --- Reentrancy --------------------------------------------------------------

    function test_SettleIsGuardedAgainstReentrancy() public {
        // Escrow aparte, con el token que reentra.
        ReentrantUSDC evil = new ReentrantUSDC();
        Escrow1v1 esc = new Escrow1v1(address(evil), arbiter, platform, feeBps, owner);
        _fundMatchOn(esc, evil, matchId);
        uint64 dl = _resultDl();
        bytes32 rd = esc.resultDigest(matchId, p1, dl);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(arbiterPk, rd);
        bytes memory sig = abi.encodePacked(r, s, v);

        // En cada envío, el token intenta cancelar la partida: el guard corta la
        // reentrada ANTES de mirar quién llama. El revert también deshace el
        // `armed = false` del token, así que lo intenta en los dos envíos, y
        // cada uno falla y queda ACREDITADO. Lo que importa: la partida quedó
        // liquidada (la cancelación nunca entró) y no se perdió un centavo.
        evil.arm(address(esc), abi.encodeWithSelector(Escrow1v1.cancelMatch.selector, matchId));
        esc.settle(matchId, p1, dl, sig);
        (,,,,,,, Escrow1v1.Status status) = esc.matches(matchId);
        assertEq(uint8(status), uint8(Escrow1v1.Status.Settled), "la reentrada no la cancelo");
        assertEq(esc.owed(platform), 1_000_000, "comision acreditada");
        assertEq(esc.owed(p1), 9_000_000, "premio acreditado");
        assertEq(evil.balanceOf(address(esc)), 10_000_000, "custodia lo acreditado entero");

        // Y el retiro tampoco se deja reentrar: el token intenta retirar de
        // nuevo mientras paga lo acreditado, y el retiro entero revierte (el
        // crédito queda intacto).
        evil.arm(address(esc), abi.encodeWithSelector(Escrow1v1.withdraw.selector));
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        esc.withdrawFor(p1);
        assertEq(esc.owed(p1), 9_000_000, "credito intacto tras el revert");
    }

    // --- Administración ---------------------------------------------------------

    function test_AdminRejectsNonOwner() public {
        vm.startPrank(notOwner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, notOwner));
        escrow.setArbiter(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, notOwner));
        escrow.setPlatformWallet(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, notOwner));
        escrow.setFeeBps(100);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, notOwner));
        escrow.setAllowedStake(1, true);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, notOwner));
        escrow.transferOwnership(notOwner);
        vm.stopPrank();
    }

    function test_AdminGuards() public {
        vm.startPrank(owner);
        vm.expectRevert(bytes("zero address"));
        escrow.setArbiter(address(0));
        vm.expectRevert(bytes("zero address"));
        escrow.setPlatformWallet(address(0));
        vm.expectRevert(bytes("fee too high"));
        escrow.setFeeBps(2001);
        vm.stopPrank();
    }

    function test_ConstructorGuards() public {
        vm.expectRevert(bytes("zero address"));
        new Escrow1v1(address(0), arbiter, platform, feeBps, owner);
        vm.expectRevert(bytes("zero address"));
        new Escrow1v1(address(usdc), address(0), platform, feeBps, owner);
        vm.expectRevert(bytes("zero address"));
        new Escrow1v1(address(usdc), arbiter, address(0), feeBps, owner);
        vm.expectRevert(bytes("fee too high"));
        new Escrow1v1(address(usdc), arbiter, platform, 2001, owner);
    }

    // DUEÑO EN DOS PASOS (v2): transferir no cambia nada hasta que el nuevo
    // acepta, así una dirección con un error nunca se queda con el contrato.
    function test_OwnershipTransferIsTwoStep() public {
        address typo = address(0xDEAD);
        address safe = address(0x5AFE);

        vm.prank(owner);
        escrow.transferOwnership(typo);
        assertEq(escrow.owner(), owner, "nada cambia hasta aceptar");
        assertEq(escrow.pendingOwner(), typo);

        // El error se corrige pisando el pendiente; el de la dirección mala ya
        // no puede aceptar.
        vm.prank(owner);
        escrow.transferOwnership(safe);
        vm.prank(typo);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, typo));
        escrow.acceptOwnership();

        vm.prank(safe);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), safe, "el nuevo acepto");
        assertEq(escrow.pendingOwner(), address(0));

        // El viejo ya no administra; el nuevo sí.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        escrow.setFeeBps(0);
        vm.prank(safe);
        escrow.setFeeBps(0);
        assertEq(escrow.feeBps(), 0);
    }

    function test_RenounceOwnershipIsDisabled() public {
        vm.prank(owner);
        vm.expectRevert(bytes("renounce disabled"));
        escrow.renounceOwnership();
        assertEq(escrow.owner(), owner, "sigue teniendo duenio");
    }
}
