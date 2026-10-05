// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {console2} from "forge-std/console2.sol";
import {Escrow1v1} from "../../src/Escrow1v1.sol";
import {ChaosUSDC} from "./ChaosUSDC.sol";
import {Escrow1v1Handler} from "./Escrow1v1Handler.sol";

/// @notice Invariantes de `Escrow1v1`: reglas que tienen que valer después de
///         CUALQUIER secuencia de operaciones, no solo en los casos que alguien
///         pensó. El fuzzer arma miles de secuencias al azar con el handler
///         (jugadores, árbitro, dueño, USDC caprichoso, reloj y un atacante) y
///         después de cada paso se chequea todo esto.
///
///         Correr más profundo (lo que se hizo para el paquete de auditoría):
///         `FOUNDRY_PROFILE=deep forge test --match-path 'test/invariant/*'`.
contract Escrow1v1InvariantTest is StdInvariant, Test {
    Escrow1v1 escrow;
    ChaosUSDC usdc;
    Escrow1v1Handler handler;

    address owner = makeAddr("owner");
    address platformA = makeAddr("platformA");
    address platformB = makeAddr("platformB");
    address attacker = makeAddr("attacker");
    address[] players;

    function setUp() public {
        usdc = new ChaosUSDC();
        uint256 arbiterPk = 0xA11CE;
        escrow = new Escrow1v1(address(usdc), vm.addr(arbiterPk), platformA, 1500, owner);

        vm.startPrank(owner);
        escrow.setAllowedStake(1_000_000, true);
        escrow.setAllowedStake(2_000_000, true);
        escrow.setAllowedStake(5_000_000, true);
        escrow.setAllowedStake(10_000_000, true);
        vm.stopPrank();

        players.push(makeAddr("p0"));
        players.push(makeAddr("p1"));
        players.push(makeAddr("p2"));
        players.push(makeAddr("p3"));
        players.push(makeAddr("p4"));
        handler = new Escrow1v1Handler(escrow, usdc, arbiterPk, owner, platformA, platformB, players, attacker);

        // Cobrarle a p3 cuesta 150k de gas: entra en el presupuesto de cada
        // pago (PAY_GAS = 300k), así que se le TIENE que pagar, con cualquier
        // gas con el que la transacción salga bien. A p4 le cuesta 400k: no
        // entra, así que se le acredita SIEMPRE y cobra con `withdraw`.
        usdc.setBurn(players[3], 150_000);
        usdc.setBurn(players[4], 400_000);

        bytes4[] memory selectors = new bytes4[](15);
        selectors[0] = Escrow1v1Handler.open.selector;
        selectors[1] = Escrow1v1Handler.join.selector;
        selectors[2] = Escrow1v1Handler.openAndJoin.selector;
        selectors[3] = Escrow1v1Handler.settle.selector;
        selectors[4] = Escrow1v1Handler.refundUnfunded.selector;
        selectors[5] = Escrow1v1Handler.refundExpired.selector;
        selectors[6] = Escrow1v1Handler.cancel.selector;
        selectors[7] = Escrow1v1Handler.withdraw.selector;
        selectors[8] = Escrow1v1Handler.settleTightGas.selector;
        selectors[9] = Escrow1v1Handler.refundTightGas.selector;
        selectors[10] = Escrow1v1Handler.warp.selector;
        selectors[11] = Escrow1v1Handler.attack.selector;
        selectors[12] = Escrow1v1Handler.chaos.selector;
        selectors[13] = Escrow1v1Handler.ownerAction.selector;
        selectors[14] = Escrow1v1Handler.warpToDeadline.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @notice CANARIO: las invariantes solo prueban algo si el handler llega a
    ///         jugar partidas de verdad. Esto corre el mismo handler en una
    ///         secuencia fija de 1500 pasos pseudoaleatorios y exige que cada
    ///         camino se haya ejercitado: si un cambio al handler lo deja
    ///         girando en falso (todo revierte antes de llegar al contrato), las
    ///         invariantes seguirían en verde sin probar nada, y este test no.
    function test_handlerExercisesEveryPath() public {
        uint256 r = 0xC0FFEE;
        for (uint256 i = 0; i < 1500; i++) {
            r = uint256(keccak256(abi.encode(r, i)));
            uint256 a = r >> 16;
            uint256 b = r >> 80;
            uint256 c = r >> 144;
            uint256 d = r >> 208;
            uint256 k = r % 15;
            if (k == 0) handler.open(a, b, c, d);
            else if (k == 1) handler.join(a, b);
            else if (k == 2) handler.openAndJoin(a, b, c, d, r >> 40);
            else if (k == 3) handler.settle(a, b % 2 == 0, c);
            else if (k == 4) handler.refundUnfunded(a, b);
            else if (k == 5) handler.refundExpired(a, b);
            else if (k == 6) handler.cancel(a, b % 2 == 0, c % 3 == 0);
            else if (k == 7) handler.withdraw(a, b % 2 == 0, c);
            else if (k == 8) handler.settleTightGas(a, b % 2 == 0, c, d);
            else if (k == 9) handler.refundTightGas(a, b, c);
            else if (k == 10) handler.warp(a);
            else if (k == 11) handler.attack(a, b, c, d % 2 == 0);
            else if (k == 12) handler.chaos(a, b);
            else if (k == 13) handler.ownerAction(a, b, c % 2 == 0);
            else handler.warpToDeadline(a, b);
        }
        emit log_named_uint("aperturas", handler.opens());
        emit log_named_uint("uniones", handler.joins());
        emit log_named_uint("liquidaciones", handler.settles());
        emit log_named_uint("reembolsos", handler.refunds());
        emit log_named_uint("cancelaciones", handler.cancels());
        emit log_named_uint("retiros", handler.withdrawals());
        emit log_named_uint("pagos acreditados", handler.creditsSeen());
        emit log_named_uint("gas justo que salio bien", handler.tightGasOk());
        assertGt(handler.settles(), 15, "liquidaciones");
        assertGt(handler.refunds(), 15, "reembolsos");
        assertGt(handler.cancels(), 5, "cancelaciones");
        assertGt(handler.withdrawals(), 2, "retiros");
        assertGt(handler.creditsSeen(), 5, "pagos acreditados");
        assertGt(handler.tightGasOk(), 5, "gas justo");
        assertEq(handler.violations(), 0, handler.firstViolation());
        invariant_solvency();
        invariant_matchesFollowTheRules();
        invariant_creditsOnlyToPlayersAndPlatform();
        afterInvariant();
    }

    /// @notice SOLVENCIA: el USDC del contrato es exactamente lo depositado en
    ///         partidas abiertas + lo acreditado a cada uno + lo que alguien
    ///         mandó por fuera. Ni un centavo de más (plata que nadie puede
    ///         sacar) ni de menos (se pagó algo que no se debía).
    function invariant_solvency() public view {
        uint256 owedSum = escrow.owed(platformA) + escrow.owed(platformB);
        for (uint256 i = 0; i < players.length; i++) owedSum += escrow.owed(players[i]);
        assertEq(
            usdc.balanceOf(address(escrow)),
            handler.ghostLocked() + owedSum + handler.ghostDonations(),
            "el saldo del escrow no cuadra con lo depositado + lo acreditado"
        );
    }

    /// @notice Cada operación pagó exactamente lo que dicen las reglas, nada
    ///         que no debía andar anduvo, y nada que debía andar revirtió.
    function invariant_noViolations() public view {
        assertEq(handler.violations(), 0, handler.firstViolation());
    }

    /// @notice El estado de cada partida en el contrato es el que dicen las
    ///         reglas, y lo que se guardó al abrir (jugadores, stake, plazos)
    ///         no cambia nunca.
    function invariant_matchesFollowTheRules() public view {
        uint256 n = handler.idsLength();
        for (uint256 i = 0; i < n; i++) {
            bytes32 id = handler.ids(i);
            Escrow1v1Handler.Ghost memory g = handler.ghostOf(id);
            (
                address p1,
                address p2,
                uint256 st,
                bool paid1,
                bool paid2,
                uint64 fund,
                uint64 play,
                Escrow1v1.Status status,
                uint16 fee
            ) = escrow.matches(id);
            assertEq(uint8(status), uint8(g.status), "estado de la partida");
            assertEq(p1, g.p1, "p1");
            assertEq(p2, g.p2, "p2");
            assertEq(st, g.stake, "stake");
            assertEq(fund, g.fundDl, "plazo de fondeo");
            assertEq(play, g.playDl, "plazo de juego");
            assertTrue(paid1, "p1 siempre pago al abrir");
            assertEq(paid2, g.p2 != address(0), "p2 pago si y solo si se unio");
            assertEq(fee, g.feeBps, "la comision quedo congelada al abrir");
        }
    }

    /// @notice Solo los jugadores y la plataforma pueden tener crédito: nadie
    ///         más recibe plata del escrow.
    function invariant_creditsOnlyToPlayersAndPlatform() public view {
        assertEq(escrow.owed(attacker), 0, "atacante");
        assertEq(escrow.owed(owner), 0, "dueno");
        assertEq(escrow.owed(handler.currentArbiter()), 0, "arbitro");
        assertEq(escrow.owed(address(escrow)), 0, "el propio escrow");
    }

    /// @notice NADA QUEDA TRABADO: al final de cada secuencia, con el USDC de
    ///         vuelta a la normalidad y pasados los plazos, un tercero sin
    ///         ningún permiso cierra todo y cada uno recupera lo suyo. En el
    ///         contrato queda solo lo que alguien mandó por fuera.
    function afterInvariant() public {
        // Cuánto se ejercitó de verdad en esta secuencia (con -vv).
        console2.log("aperturas", handler.opens(), "uniones", handler.joins());
        console2.log("liquidaciones", handler.settles(), "reembolsos", handler.refunds());
        console2.log("cancelaciones", handler.cancels(), "retiros", handler.withdrawals());
        console2.log("pagos acreditados", handler.creditsSeen(), "gas justo que salio bien", handler.tightGasOk());
        handler.drainAll();
        assertEq(handler.violations(), 0, handler.firstViolation());
        assertEq(usdc.balanceOf(address(escrow)), handler.ghostDonations(), "quedo plata trabada en el escrow");
        assertEq(handler.ghostLocked(), 0, "quedaron partidas sin cerrar");
    }
}
