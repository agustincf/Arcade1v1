// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Escrow1v1} from "../src/Escrow1v1.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {GasHungryUSDC} from "./GasHungryUSDC.sol";
import {DelegatingProxy, HungryImpl, AllGasRejectUSDC, ReturnBombUSDC} from "./ProxyUSDC.sol";

/// @notice La pre-auditoría de Escrow1v1 (2026-10), en tests: los cambios que
///         entraron antes de la auditoría externa, los hallazgos que cierran, y
///         la confianza que queda (riesgos aceptados), dicha con un test que la
///         ejercita. Informe: docs/auditorias/2026-10-02-preauditoria-escrow1v1.md;
///         paquete para el auditor: packages/contracts/AUDIT.md.
contract Escrow1v1PreauditoriaTest is Test {
    uint256 constant ARBITER_PK = 0xA11CE;
    address arbiter;
    address owner = address(0xABCD);
    address platform = address(0xFEE5);
    address p1 = address(0x1111);
    address p2 = address(0x2222);
    uint256 constant STAKE = 5_000_000;
    uint16 constant FEE = 1500;
    uint64 constant GRACE = 30 minutes;
    bytes32 constant ID = keccak256("preauditoria");
    uint256 constant PRIZE = 2 * STAKE - (2 * STAKE * FEE) / 10_000; // 8.5 USDC

    uint64 fundDl;
    uint64 playDl;

    function setUp() public {
        arbiter = vm.addr(ARBITER_PK);
        fundDl = uint64(block.timestamp + 70 minutes);
        playDl = uint64(block.timestamp + 2 hours);
    }

    // ===================================================================== //
    // 1. El resultado no sobrevive a la apertura del reembolso (F-03)       //
    // ===================================================================== //
    // Antes era solo política del árbitro: un resultado firmado con un
    // vencimiento posterior (un bug, un reloj corrido) volvía a abrir la
    // carrera que la gracia cerró: pasada la gracia valían settle y
    // refundExpired, y el PERDEDOR se adelantaba con el reembolso.

    function test_SettleRechazaUnVencimientoPosteriorAlReembolso() public {
        (Escrow1v1 esc,) = _fundedOnMock();
        uint64 tarde = playDl + GRACE + 1;
        bytes memory sig = _result(esc, ID, p1, tarde);
        vm.expectRevert(bytes("deadline too late"));
        esc.settle(ID, p1, tarde, sig);
        // Ni siquiera en un segundo en que la firma "todavía valdría".
        vm.warp(uint256(playDl) + GRACE);
        vm.expectRevert(bytes("deadline too late"));
        esc.settle(ID, p1, tarde, sig);
    }

    function testFuzz_NingunVencimientoPasaElTope(uint64 extra) public {
        (Escrow1v1 esc,) = _fundedOnMock();
        extra = uint64(bound(extra, 1, type(uint64).max - playDl - GRACE));
        uint64 tarde = playDl + GRACE + extra;
        bytes memory sig = _result(esc, ID, p2, tarde);
        vm.expectRevert(bytes("deadline too late"));
        esc.settle(ID, p2, tarde, sig);
    }

    // ===================================================================== //
    // 2. Presupuesto fijo de gas por pago (F-01, F-02 y su variante sin      //
    //    atacante: la estimación de gas del propio árbitro)                 //
    // ===================================================================== //
    // La guarda anterior ("si me quedó menos de 1/63, el envío se quedó sin
    // gas") no vale detrás de un proxy como el del USDC. Con un transfer caro
    // (un USDC futuro) un tercero, o el propio árbitro estimando el gas,
    // convertía el pago de un ganador sano en un crédito. Y un rechazo que se
    // come todo el gas trababa todas las salidas que le pagaban a esa dirección.

    function test_PayGasEsPublicoYDeja7xDeMargen() public {
        (Escrow1v1 esc,) = _fundedOnMock();
        assertEq(esc.PAY_GAS(), 300_000);
        // Medido contra el USDC real (test/fork/): ~41k a una dirección nueva.
        assertGe(esc.PAY_GAS(), 7 * 41_060);
    }

    function test_PagoQueEntraEnElPresupuestoSeCobraConCualquierGas() public {
        GasHungryUSDC tok = new GasHungryUSDC();
        Escrow1v1 esc = _deploy(address(tok));
        _fund(esc, address(tok));
        tok.setHungry(p1, 150_000);
        (uint256 paid, uint256 credited,) = _sweepSettle(esc, 100_000, 1_500_000, 10_000);
        assertGt(paid, 0, "liquido");
        assertEq(credited, 0, "nunca acredita a un ganador que el token acepta");
    }

    function test_PagoFueraDelPresupuestoSeAcreditaSiempreYWithdrawLoCobra() public {
        GasHungryUSDC tok = new GasHungryUSDC();
        Escrow1v1 esc = _deploy(address(tok));
        _fund(esc, address(tok));
        tok.setHungry(p1, 400_000);
        (uint256 paid, uint256 credited,) = _sweepSettle(esc, 100_000, 1_500_000, 10_000);
        assertEq(paid, 0, "nunca lo empuja");
        assertGt(credited, 0, "lo acredita, con cualquier gas que alcance");
        _settleFull(esc, p1);
        assertEq(esc.owed(p1), PRIZE);
        esc.withdrawFor(p1); // withdraw no tiene tope de gas
        assertEq(tok.balanceOf(p1), PRIZE);
    }

    function test_GasInsuficienteRevierteEnteroYSinTocarNada() public {
        (Escrow1v1 esc, MockUSDC tok) = _fundedOnMock();
        uint64 dl = playDl + GRACE;
        bytes memory data = abi.encodeCall(Escrow1v1.settle, (ID, p1, dl, _result(esc, ID, p1, dl)));
        (bool ok, bytes memory ret) = address(esc).call{gas: 150_000}(data);
        assertFalse(ok);
        assertEq(keccak256(ret), keccak256(abi.encodeWithSignature("Error(string)", "insufficient gas")));
        assertEq(uint8(_status(esc)), uint8(Escrow1v1.Status.Funded), "la partida sigue lista");
        assertEq(tok.balanceOf(address(esc)), 2 * STAKE, "nada salio");
    }

    /// F-01: el mismo token caro DETRÁS de un proxy. Con la guarda anterior,
    /// a 900k de costo un tercero forzaba créditos de ganadores sanos.
    function test_ProxyConTransferCaroNuncaFuerzaUnCredito() public {
        (Escrow1v1 esc, HungryImpl tok) = _deployProxied();
        tok.setHungry(p1, 150_000);
        (uint256 paid, uint256 credited,) = _sweepSettle(esc, 100_000, 1_500_000, 10_000);
        assertGt(paid, 0);
        assertEq(credited, 0, "detras del proxy tampoco");

        (esc, tok) = _deployProxied();
        tok.setHungry(p1, 900_000);
        (paid, credited,) = _sweepSettle(esc, 100_000, 2_000_000, 10_000);
        assertEq(paid, 0);
        assertGt(credited, 0, "fuera del presupuesto: credito determinista, no forzado");
    }

    /// F-02: el token rechaza a p2 quemando TODO el gas que recibe. Antes,
    /// ninguna salida que le pagara a p2 andaba con ningún gas: ni el
    /// reembolso de p1. Ahora p2 queda acreditado y p1 cobra.
    function test_RechazoQueQuemaTodoElGasSeAcreditaYNoTrabaAlOtro() public {
        AllGasRejectUSDC tok = new AllGasRejectUSDC();
        Escrow1v1 esc = _deploy(address(tok));
        _fund(esc, address(tok));
        tok.flag(p2, true);
        uint256 snap = vm.snapshotState();

        vm.warp(uint256(playDl) + GRACE + 1);
        esc.refundExpired(ID);
        assertEq(tok.balanceOf(p1), STAKE, "p1 recupera lo suyo");
        assertEq(esc.owed(p2), STAKE, "p2 queda acreditado");

        vm.revertToState(snap);
        vm.prank(arbiter);
        esc.cancelMatch(ID);
        assertEq(tok.balanceOf(p1), STAKE);
        assertEq(esc.owed(p2), STAKE);

        vm.revertToState(snap);
        _settleFull(esc, p2);
        assertEq(esc.owed(p2), PRIZE, "gana p2: su premio queda acreditado");
        assertEq(tok.balanceOf(platform), 2 * STAKE - PRIZE, "la comision se cobra igual");
    }

    /// Slither (return-bomb): el escrow copia a lo sumo 32 bytes de la
    /// respuesta del token, como `SafeERC20`. Una respuesta enorme no le
    /// encarece la salida a quien llama: el gas extra lo paga el token, dentro
    /// de su presupuesto.
    function test_UnaRespuestaEnormeDelTokenNoLaPagaQuienLlama() public {
        (Escrow1v1 normal,) = _fundedOnMock();
        uint64 dl = playDl + GRACE;
        bytes memory sig = _result(normal, ID, p1, dl);
        uint256 g0 = gasleft();
        normal.settle(ID, p1, dl, sig);
        uint256 gasNormal = g0 - gasleft();

        ReturnBombUSDC tok = new ReturnBombUSDC();
        Escrow1v1 esc = _deploy(address(tok));
        _fund(esc, address(tok));
        sig = _result(esc, ID, p1, dl);
        g0 = gasleft();
        esc.settle(ID, p1, dl, sig);
        uint256 gasBomba = g0 - gasleft();
        assertEq(tok.balanceOf(p1), PRIZE, "pago bien (la primera palabra es true)");
        // Generar 2 x 250 KB le cuesta al token ~2 x 140k; copiarlas costaría
        // otro tanto. Lo que se mide es solo lo que paga el token.
        emit log_named_uint("settle normal", gasNormal);
        emit log_named_uint("settle con respuestas de 250 KB", gasBomba);
        assertLt(gasBomba, gasNormal + 2 * 160_000, "copiar la respuesta no la paga quien llama");
    }

    // ===================================================================== //
    // 3. Una partida no dura más que MAX_MATCH_DURATION (F-04, parte)        //
    // ===================================================================== //

    function test_OpenRechazaUnaPartidaMasLargaQueElTope() public {
        MockUSDC tok = new MockUSDC();
        Escrow1v1 esc = _deploy(address(tok));
        uint64 lejos = uint64(block.timestamp + esc.MAX_MATCH_DURATION() + 1);
        bytes memory seat = _seat(esc, ID, p1, STAKE, fundDl, lejos);
        _mintApprove(address(tok), address(esc), p1);
        vm.prank(p1);
        vm.expectRevert(bytes("deadlines too far"));
        esc.open(ID, STAKE, fundDl, lejos, seat);
    }

    /// Lo peor que puede hacer un asiento mal firmado (un bug o una llave
    /// comprometida): trabar el depósito hasta el tope + la gracia. Después,
    /// cualquiera lo devuelve. Antes, con playDeadline = uint64 máximo, solo el
    /// `cancelMatch` del dueño lo liberaba.
    function test_ElPeorAsientoTrabaComoMuchoElTopeMasLaGracia() public {
        MockUSDC tok = new MockUSDC();
        Escrow1v1 esc = _deploy(address(tok));
        uint64 alTope = uint64(block.timestamp + esc.MAX_MATCH_DURATION());
        _openOn(esc, address(tok), p1, fundDl, alTope);
        _joinOn(esc, address(tok), p2, fundDl, alTope);
        vm.warp(uint256(alTope) + GRACE + 1);
        vm.prank(address(0xBEEF)); // un tercero cualquiera
        esc.refundExpired(ID);
        assertEq(tok.balanceOf(p1) + tok.balanceOf(p2), 2 * STAKE);
    }

    // ===================================================================== //
    // 4. La wallet de la plataforma (F-06)                                   //
    // ===================================================================== //

    function test_ConstructorRechazaLaWalletEnElPropioEscrowOEnElToken() public {
        MockUSDC tok = new MockUSDC();
        address futuro = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        vm.expectRevert(bytes("bad wallet"));
        new Escrow1v1(address(tok), arbiter, futuro, FEE, owner);
        vm.expectRevert(bytes("bad wallet"));
        new Escrow1v1(address(tok), arbiter, address(tok), FEE, owner);
    }

    function test_SetPlatformWalletRechazaElEscrowYElToken() public {
        MockUSDC tok = new MockUSDC();
        Escrow1v1 esc = _deploy(address(tok));
        vm.startPrank(owner);
        vm.expectRevert(bytes("bad wallet"));
        esc.setPlatformWallet(address(esc));
        vm.expectRevert(bytes("bad wallet"));
        esc.setPlatformWallet(address(tok));
        vm.stopPrank();
    }

    function test_SetPlatformWalletCambiaQuienCobraLaComision() public {
        (Escrow1v1 esc, MockUSDC tok) = _fundedOnMock();
        address nueva = address(0xFEE6);
        vm.expectEmit(true, false, false, false, address(esc));
        emit Escrow1v1.PlatformWalletUpdated(nueva);
        vm.prank(owner);
        esc.setPlatformWallet(nueva);
        _settleFull(esc, p1);
        assertEq(tok.balanceOf(nueva), 2 * STAKE - PRIZE, "la comision va a la wallet nueva");
        assertEq(tok.balanceOf(platform), 0);
    }

    // ===================================================================== //
    // 5. La comisión queda congelada al abrir (F-05, parte)                  //
    // ===================================================================== //

    function test_SubirLaComisionNoAfectaLasPartidasYaAbiertas() public {
        (Escrow1v1 esc, MockUSDC tok) = _fundedOnMock();
        vm.prank(owner);
        esc.setFeeBps(2000); // el máximo, con la partida ya en juego
        _settleFull(esc, p1);
        assertEq(tok.balanceOf(p1), PRIZE, "cobra con la comision con la que entro (15%)");

        // Una partida que se abre DESPUÉS sí cobra la nueva.
        bytes32 otra = keccak256("despues");
        _mintApprove(address(tok), address(esc), p1);
        _mintApprove(address(tok), address(esc), p2);
        bytes memory s1 = _seat(esc, otra, p1, STAKE, fundDl, playDl);
        vm.prank(p1);
        esc.open(otra, STAKE, fundDl, playDl, s1);
        bytes memory s2 = _seat(esc, otra, p2, STAKE, fundDl, playDl);
        vm.prank(p2);
        esc.join(otra, s2);
        (,,,,,,,, uint16 fee) = esc.matches(otra);
        assertEq(fee, 2000);
        uint64 dl = playDl + GRACE;
        bytes memory sig = _result(esc, otra, p2, dl);
        esc.settle(otra, p2, dl, sig);
        assertEq(tok.balanceOf(p2), 2 * STAKE - (2 * STAKE * 2000) / 10_000);
    }

    // ===================================================================== //
    // 6. Higiene que pide un auditor                                         //
    // ===================================================================== //

    function test_UnaMesaDeCeroSeRechaza() public {
        Escrow1v1 esc = _deploy(address(new MockUSDC()));
        vm.prank(owner);
        vm.expectRevert(bytes("zero stake"));
        esc.setAllowedStake(0, true);
    }

    /// La configuración inicial queda en los logs, igual que cada cambio: un
    /// indexador reconstruye quién cobra la comisión desde los eventos.
    function test_ElConstructorDejaLaConfiguracionEnLosEventos() public {
        MockUSDC tok = new MockUSDC();
        vm.recordLogs();
        Escrow1v1 esc = new Escrow1v1(address(tok), arbiter, platform, FEE, owner);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool sawArbiter;
        bool sawWallet;
        bool sawFee;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter != address(esc)) continue;
            bytes32 t0 = logs[i].topics[0];
            if (t0 == keccak256("ArbiterUpdated(address)")) {
                sawArbiter = address(uint160(uint256(logs[i].topics[1]))) == arbiter;
            } else if (t0 == keccak256("PlatformWalletUpdated(address)")) {
                sawWallet = address(uint160(uint256(logs[i].topics[1]))) == platform;
            } else if (t0 == keccak256("FeeUpdated(uint16)")) {
                sawFee = abi.decode(logs[i].data, (uint16)) == FEE;
            }
        }
        assertTrue(sawArbiter && sawWallet && sawFee, "arbitro, wallet y comision iniciales");
    }

    /// Los jugadores van indexados: el historial de una dirección se filtra
    /// por tópico, sin leer storage.
    function test_LosJugadoresVanIndexadosEnLosEventos() public {
        MockUSDC tok = new MockUSDC();
        Escrow1v1 esc = _deploy(address(tok));
        _mintApprove(address(tok), address(esc), p1);
        bytes memory seat = _seat(esc, ID, p1, STAKE, fundDl, playDl);
        vm.expectEmit(true, true, false, true, address(esc));
        emit Escrow1v1.MatchOpened(ID, p1, STAKE);
        vm.expectEmit(true, true, false, false, address(esc));
        emit Escrow1v1.Deposited(ID, p1);
        vm.prank(p1);
        esc.open(ID, STAKE, fundDl, playDl, seat);
        _joinOn(esc, address(tok), p2, fundDl, playDl);
        uint64 dl = playDl + GRACE;
        bytes memory sig = _result(esc, ID, p2, dl);
        vm.expectEmit(true, true, false, true, address(esc));
        emit Escrow1v1.Settled(ID, p2, PRIZE, 2 * STAKE - PRIZE);
        esc.settle(ID, p2, dl, sig);
    }

    // ===================================================================== //
    // 7. La confianza que queda (riesgos aceptados, documentados en AUDIT.md) //
    // ===================================================================== //

    /// RIESGO ACEPTADO: una llave del árbitro filtrada se sienta en cada
    /// partida ABIERTA (todo lo que necesita es público en `matches(id)`) y se
    /// firma la victoria. Pierde la víctima su stake; el atacante gana el stake
    /// ajeno menos la comisión. Por eso la llave del árbitro va resguardada
    /// (docs/MAINNET.md C12/O2) y el dueño la rota con `setArbiter`.
    function test_RiesgoAceptado_UnaLlaveDelArbitroFiltradaTomaLasPartidasAbiertas() public {
        MockUSDC tok = new MockUSDC();
        Escrow1v1 esc = _deploy(address(tok));
        _openOn(esc, address(tok), p1, fundDl, playDl);

        address ladron = address(0x7777);
        (,, uint256 st,,, uint64 f, uint64 pd,,) = esc.matches(ID);
        tok.mint(ladron, st);
        vm.prank(ladron);
        tok.approve(address(esc), st);
        bytes memory seat = _seat(esc, ID, ladron, st, f, pd);
        vm.prank(ladron);
        esc.join(ID, seat);
        uint64 dl = pd + GRACE;
        bytes memory sig = _result(esc, ID, ladron, dl);
        esc.settle(ID, ladron, dl, sig);
        assertEq(tok.balanceOf(ladron), PRIZE, "se lleva el pozo menos la comision");
        assertEq(tok.balanceOf(p1), 0, "la victima pierde su stake");
    }

    /// El límite de ese riesgo: una partida LLENA entre otros dos no la puede
    /// desviar a sí misma (solo elegir entre p1 y p2, o cancelar).
    function test_UnaLlaveDelArbitroNoDesviaUnaPartidaLlenaEntreOtros() public {
        (Escrow1v1 esc,) = _fundedOnMock();
        address ladron = address(0x7777);
        uint64 dl = playDl + GRACE;
        bytes memory sig = _result(esc, ID, ladron, dl);
        vm.expectRevert(bytes("bad winner"));
        esc.settle(ID, ladron, dl, sig);
        bytes memory seat = _seat(esc, ID, ladron, STAKE, fundDl, playDl);
        vm.prank(ladron);
        vm.expectRevert(bytes("not open"));
        esc.join(ID, seat);
    }

    /// RIESGO ACEPTADO (operativo): volver a una llave de árbitro ya usada
    /// revive sus firmas viejas. El runbook de rotación lo prohíbe.
    function test_RiesgoAceptado_VolverAUnaLlaveViejaReviveSusFirmas() public {
        (Escrow1v1 esc,) = _fundedOnMock();
        uint64 dl = playDl + GRACE;
        bytes memory vieja = _result(esc, ID, p2, dl);
        vm.startPrank(owner);
        esc.setArbiter(address(0xB0B));
        esc.setArbiter(arbiter); // de vuelta a la anterior
        vm.stopPrank();
        esc.settle(ID, p2, dl, vieja);
        assertEq(uint8(_status(esc)), uint8(Escrow1v1.Status.Settled));
    }

    // ===================================================================== //
    // 8. Propiedades que la revisión chequeó y valen                         //
    // ===================================================================== //

    /// Los asientos no dicen si sos p1 o p2: el que se une puede abrir primero.
    /// En cadena no cambia nada (se paga por dirección); el atajo de la web
    /// que miraba el rol en vez de la dirección es un arreglo aparte (tanda 3).
    function test_CambioDeRolEsInofensivoEnCadena() public {
        MockUSDC tok = new MockUSDC();
        Escrow1v1 esc = _deploy(address(tok));
        _openOn(esc, address(tok), p2, fundDl, playDl); // el "p2" del árbitro abre
        bytes memory s1 = _seat(esc, ID, p1, STAKE, fundDl, playDl);
        _mintApprove(address(tok), address(esc), p1);
        vm.prank(p1);
        vm.expectRevert(bytes("match exists"));
        esc.open(ID, STAKE, fundDl, playDl, s1);
        vm.prank(p1);
        esc.join(ID, s1); // con el MISMO asiento
        _settleFull(esc, p1);
        assertEq(tok.balanceOf(p1), PRIZE);
    }

    function test_UnirseEnElUltimoSegundoYReembolsarRecienAlSiguiente() public {
        MockUSDC tok = new MockUSDC();
        Escrow1v1 esc = _deploy(address(tok));
        _openOn(esc, address(tok), p1, fundDl, playDl);
        uint256 snap = vm.snapshotState();
        vm.warp(fundDl);
        vm.expectRevert(bytes("not expired"));
        esc.refundUnfunded(ID);
        _joinOn(esc, address(tok), p2, fundDl, playDl); // último segundo válido
        vm.revertToState(snap);

        vm.warp(uint256(fundDl) + 1);
        bytes memory s = _seat(esc, ID, p2, STAKE, fundDl, playDl);
        _mintApprove(address(tok), address(esc), p2);
        vm.prank(p2);
        vm.expectRevert(bytes("fund expired"));
        esc.join(ID, s);
        esc.refundUnfunded(ID);
        assertEq(tok.balanceOf(p1), STAKE);
    }

    function test_CancelarYLiquidarNuncaPaganDosVeces() public {
        (Escrow1v1 esc, MockUSDC tok) = _fundedOnMock();
        uint64 dl = playDl + GRACE;
        bytes memory sig = _result(esc, ID, p1, dl);
        uint256 snap = vm.snapshotState();

        vm.prank(arbiter);
        esc.cancelMatch(ID);
        vm.expectRevert(bytes("not funded"));
        esc.settle(ID, p1, dl, sig);
        assertEq(tok.balanceOf(address(esc)), 0);

        vm.revertToState(snap);
        esc.settle(ID, p1, dl, sig);
        vm.prank(owner);
        vm.expectRevert(bytes("cant cancel"));
        esc.cancelMatch(ID);
        vm.expectRevert(bytes("not funded"));
        esc.refundExpired(ID);
        assertEq(tok.balanceOf(address(esc)), 0);
    }

    /// Las firmas llevan el dominio EIP-712 (cadena + dirección del contrato):
    /// un asiento para un escrow no sirve en otro con el mismo árbitro.
    function test_UnaFirmaNoSirveEnOtroEscrow() public {
        MockUSDC tok = new MockUSDC();
        Escrow1v1 esc = _deploy(address(tok));
        Escrow1v1 otro = _deploy(address(tok));
        bytes memory s = _seat(esc, ID, p1, STAKE, fundDl, playDl);
        _mintApprove(address(tok), address(otro), p1);
        vm.prank(p1);
        vm.expectRevert(bytes("bad seat"));
        otro.open(ID, STAKE, fundDl, playDl, s);
    }

    /// Un asiento nunca vale como resultado (tipos EIP-712 distintos).
    function test_UnAsientoNoEsUnResultado() public {
        (Escrow1v1 esc,) = _fundedOnMock();
        bytes memory seatSig = _seat(esc, ID, p1, STAKE, fundDl, playDl);
        vm.expectRevert(bytes("bad signature"));
        esc.settle(ID, p1, playDl + GRACE, seatSig);
    }

    /// NOTA OPERATIVA (C12): OpenZeppelin rechaza firmas con `s` alto y las de
    /// 64 bytes. Un firmante KMS/HSM tiene que normalizar `s` y entregar 65
    /// bytes, o la mitad de los asientos y resultados revierten.
    function test_SoloFirmasCanonicasDe65Bytes() public {
        MockUSDC tok = new MockUSDC();
        Escrow1v1 esc = _deploy(address(tok));
        _mintApprove(address(tok), address(esc), p1);
        bytes32 d = esc.seatDigest(ID, p1, STAKE, fundDl, playDl);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ARBITER_PK, d);
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 sAlto = bytes32(n - uint256(s));
        uint8 vOtro = v == 27 ? 28 : 27;
        assertEq(ecrecover(d, vOtro, r, sAlto), arbiter, "para la EVM es la misma firma");

        vm.prank(p1);
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureS.selector, sAlto));
        esc.open(ID, STAKE, fundDl, playDl, abi.encodePacked(r, sAlto, vOtro));

        bytes32 vs = bytes32(uint256(s) | (uint256(v - 27) << 255));
        vm.prank(p1);
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, 64));
        esc.open(ID, STAKE, fundDl, playDl, abi.encodePacked(r, vs));

        vm.prank(p1);
        esc.open(ID, STAKE, fundDl, playDl, abi.encodePacked(r, s, v));
    }

    /// El contrato solo cobra a `msg.sender`: nadie gasta el allowance de otro.
    function test_NadieGastaElAllowanceDeOtro() public {
        MockUSDC tok = new MockUSDC();
        Escrow1v1 esc = _deploy(address(tok));
        tok.mint(p1, STAKE);
        vm.prank(p1);
        tok.approve(address(esc), type(uint256).max);
        address ladron = address(0x7777);
        bytes memory seat = _seat(esc, ID, ladron, STAKE, fundDl, playDl);
        vm.prank(ladron);
        vm.expectRevert();
        esc.open(ID, STAKE, fundDl, playDl, seat);
        assertEq(tok.balanceOf(p1), STAKE);
    }

    /// USDC mandado directo al contrato no cambia nada (el contrato nunca mira
    /// su propio saldo); queda varado (no hay barrido, decisión aceptada).
    function test_UnaDonacionEsInerte() public {
        MockUSDC tok = new MockUSDC();
        Escrow1v1 esc = _deploy(address(tok));
        tok.mint(address(esc), 123);
        _openOn(esc, address(tok), p1, fundDl, playDl);
        vm.warp(uint256(fundDl) + 1);
        esc.refundUnfunded(ID);
        assertEq(tok.balanceOf(p1), STAKE);
        assertEq(tok.balanceOf(address(esc)), 123);
    }

    // --------------------------------------------------------------------- //
    //                                AYUDAS                                 //
    // --------------------------------------------------------------------- //

    function _deploy(address tok) internal returns (Escrow1v1 esc) {
        esc = new Escrow1v1(tok, arbiter, platform, FEE, owner);
        vm.prank(owner);
        esc.setAllowedStake(STAKE, true);
    }

    function _deployProxied() internal returns (Escrow1v1 esc, HungryImpl tok) {
        HungryImpl impl = new HungryImpl();
        tok = HungryImpl(address(new DelegatingProxy(address(impl))));
        esc = _deploy(address(tok));
        _fund(esc, address(tok));
    }

    function _fundedOnMock() internal returns (Escrow1v1 esc, MockUSDC tok) {
        tok = new MockUSDC();
        esc = _deploy(address(tok));
        _fund(esc, address(tok));
    }

    function _fund(Escrow1v1 esc, address tok) internal {
        _openOn(esc, tok, p1, fundDl, playDl);
        _joinOn(esc, tok, p2, fundDl, playDl);
    }

    function _mintApprove(address tok, address esc, address who) internal {
        MockUSDC(tok).mint(who, STAKE);
        vm.prank(who);
        IERC20(tok).approve(esc, STAKE);
    }

    function _openOn(Escrow1v1 esc, address tok, address who, uint64 f, uint64 p) internal {
        _mintApprove(tok, address(esc), who);
        bytes memory s = _seat(esc, ID, who, STAKE, f, p);
        vm.prank(who);
        esc.open(ID, STAKE, f, p, s);
    }

    function _joinOn(Escrow1v1 esc, address tok, address who, uint64 f, uint64 p) internal {
        _mintApprove(tok, address(esc), who);
        bytes memory s = _seat(esc, ID, who, STAKE, f, p);
        vm.prank(who);
        esc.join(ID, s);
    }

    function _settleFull(Escrow1v1 esc, address winner) internal {
        uint64 dl = playDl + GRACE;
        bytes memory sig = _result(esc, ID, winner, dl);
        esc.settle(ID, winner, dl, sig);
    }

    /// Barre el gas con el que un TERCERO presenta el `settle` (gana p1). Cada
    /// corrida arranca del mismo estado. El resultado tiene que ser monótono:
    /// una vez que alcanza, con más gas nunca vuelve a revertir.
    function _sweepSettle(Escrow1v1 esc, uint256 from, uint256 to, uint256 step)
        internal
        returns (uint256 paid, uint256 credited, uint256 reverted)
    {
        uint64 dl = playDl + GRACE;
        bytes memory data = abi.encodeCall(Escrow1v1.settle, (ID, p1, dl, _result(esc, ID, p1, dl)));
        uint256 snap = vm.snapshotState();
        for (uint256 g = from; g <= to; g += step) {
            vm.revertToState(snap);
            vm.prank(address(0xBAD));
            (bool ok,) = address(esc).call{gas: g}(data);
            if (!ok) {
                assertEq(paid + credited, 0, "con mas gas nunca vuelve a revertir");
                reverted++;
                continue;
            }
            if (esc.owed(p1) > 0) credited++;
            else paid++;
        }
        vm.revertToState(snap);
    }

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _seat(Escrow1v1 esc, bytes32 id, address who, uint256 st, uint64 f, uint64 p)
        internal
        view
        returns (bytes memory)
    {
        return _sig(ARBITER_PK, esc.seatDigest(id, who, st, f, p));
    }

    function _result(Escrow1v1 esc, bytes32 id, address winner, uint64 dl) internal view returns (bytes memory) {
        return _sig(ARBITER_PK, esc.resultDigest(id, winner, dl));
    }

    function _status(Escrow1v1 esc) internal view returns (Escrow1v1.Status st) {
        (,,,,,,, st,) = esc.matches(ID);
    }
}
