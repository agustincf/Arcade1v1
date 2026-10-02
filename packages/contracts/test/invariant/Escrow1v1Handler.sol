// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Escrow1v1} from "../../src/Escrow1v1.sol";
import {ChaosUSDC} from "./ChaosUSDC.sol";

/// @notice El actor que maneja el fuzzer en las invariantes de `Escrow1v1`.
///
/// Cada función es algo que puede pasar en la vida real, en cualquier orden:
/// jugadores que abren, se unen y cobran; el árbitro que liquida o cancela;
/// el dueño que cambia la comisión, cierra mesas o rota la llave del árbitro;
/// el USDC que entra en pausa o bloquea direcciones; el reloj que avanza; y un
/// atacante que prueba todo lo que no debería funcionar.
///
/// El handler lleva su propia contabilidad ("ghost") de cada partida y, en
/// cada operación que sale bien, compara al centavo lo que cobró cada uno
/// contra lo que dicen las reglas. Lo que no cuadra no revierte (el fuzzer
/// corre con `fail_on_revert = false`): queda anotado en `violations`, que la
/// invariante `invariant_noViolations` exige en cero.
contract Escrow1v1Handler is Test {
    Escrow1v1 public immutable escrow;
    ChaosUSDC public immutable usdc;
    address public immutable owner;
    /// @notice Las dos wallets entre las que el dueño mueve la comisión.
    address public immutable platformA;
    address public immutable platformB;
    address public immutable attacker;

    /// @notice La llave del árbitro vigente (el fuzzer la puede rotar).
    uint256 public arbiterPk;
    uint256[] internal oldArbiterPks;

    address[] internal players;

    uint64 internal constant GRACE = 30 minutes;
    uint256 internal constant MAX_MATCHES = 150;
    uint256 internal constant SECP256K1_N =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    struct Ghost {
        address p1;
        address p2;
        uint256 stake;
        uint64 fundDl;
        uint64 playDl;
        Escrow1v1.Status status;
        uint16 feeBps; // la comisión vigente al abrir: la que se cobra al liquidar
    }

    bytes32[] public ids;
    mapping(bytes32 => Ghost) internal ghost;

    /// @notice Stakes depositados en partidas que todavía no cerraron.
    uint256 public ghostLocked;
    /// @notice USDC que alguien mandó directo al contrato (no es de ninguna partida).
    uint256 public ghostDonations;

    uint256 public violations;
    string public firstViolation;
    uint256 internal nonce;

    // Cuántas veces salió bien cada camino: sin esto, una invariante "verde"
    // podría no haber ejercitado nada.
    uint256 public opens;
    uint256 public joins;
    uint256 public settles;
    uint256 public refunds;
    uint256 public cancels;
    uint256 public withdrawals;
    uint256 public creditsSeen;
    uint256 public tightGasOk;

    constructor(
        Escrow1v1 _escrow,
        ChaosUSDC _usdc,
        uint256 _arbiterPk,
        address _owner,
        address _platformA,
        address _platformB,
        address[] memory _players,
        address _attacker
    ) {
        escrow = _escrow;
        usdc = _usdc;
        arbiterPk = _arbiterPk;
        owner = _owner;
        platformA = _platformA;
        platformB = _platformB;
        attacker = _attacker;
        players = _players;
        // Cada jugador (y el atacante) aprueba una vez; el approve exacto de la
        // web no cambia nada de lo que se prueba acá.
        for (uint256 i = 0; i < _players.length; i++) {
            vm.prank(_players[i]);
            _usdc.approve(address(_escrow), type(uint256).max);
        }
        vm.prank(_attacker);
        _usdc.approve(address(_escrow), type(uint256).max);
    }

    // --------------------------------------------------------------------- //
    //                         JUGADORES Y ÁRBITRO                           //
    // --------------------------------------------------------------------- //

    function open(uint256 actorSeed, uint256 stakeSeed, uint256 fundDelta, uint256 playDelta) external {
        if (ids.length >= MAX_MATCHES) return;
        address p = _player(actorSeed);
        uint256 st = _stake(stakeSeed);
        uint64 f = uint64(block.timestamp + bound(fundDelta, 1, 2 hours));
        uint64 pl = uint64(f + bound(playDelta, 1, 3 hours));
        bytes32 id = keccak256(abi.encode("partida", nonce++));
        _ensureBalance(p, st);
        bytes memory seat = _seat(arbiterPk, id, p, st, f, pl);
        bool expectOk = escrow.allowedStake(st) && _canMove(p);
        uint256 before = usdc.balanceOf(address(escrow));
        uint16 feeAtOpen = escrow.feeBps();

        vm.prank(p);
        try escrow.open(id, st, f, pl, seat) {
            if (!expectOk) _violation("open: entro plata con la mesa cerrada, el token en pausa o una direccion bloqueada");
            if (usdc.balanceOf(address(escrow)) != before + st) _violation("open: el escrow no recibio exactamente el stake");
            ids.push(id);
            ghost[id] = Ghost(p, address(0), st, f, pl, Escrow1v1.Status.Open, feeAtOpen);
            ghostLocked += st;
            opens++;
        } catch {
            if (expectOk) _violation("open: revirtio con todo en regla");
        }
    }

    function join(uint256 matchSeed, uint256 actorSeed) external {
        bytes32 id = _pick(matchSeed, Escrow1v1.Status.Open);
        if (id == bytes32(0)) return;
        _join(id, _player(actorSeed));
    }

    /// @notice El caso más común: uno abre y el rival se une enseguida.
    function openAndJoin(uint256 a, uint256 b, uint256 stakeSeed, uint256 fundDelta, uint256 playDelta) external {
        uint256 n = ids.length;
        this.open(a, stakeSeed, fundDelta, playDelta);
        if (ids.length == n) return;
        address p2 = _player(b);
        if (p2 == ghost[ids[n]].p1) p2 = _player((b % players.length) + 1);
        _join(ids[n], p2);
    }

    function _join(bytes32 id, address p) internal {
        Ghost storage g = ghost[id];
        _ensureBalance(p, g.stake);
        bytes memory seat = _seat(arbiterPk, id, p, g.stake, g.fundDl, g.playDl);
        bool expectOk = p != g.p1 && block.timestamp <= g.fundDl && escrow.allowedStake(g.stake) && _canMove(p);
        uint256 before = usdc.balanceOf(address(escrow));

        vm.prank(p);
        try escrow.join(id, seat) {
            if (!expectOk) _violation("join: entro plata cuando no correspondia");
            if (usdc.balanceOf(address(escrow)) != before + g.stake) _violation("join: el escrow no recibio exactamente el stake");
            g.p2 = p;
            g.status = Escrow1v1.Status.Funded;
            ghostLocked += g.stake;
            joins++;
        } catch {
            if (expectOk) _violation("join: revirtio con todo en regla");
        }
    }

    /// @notice El árbitro firma el resultado con su política (vence en
    ///         playDeadline + gracia) y cualquiera lo presenta.
    function settle(uint256 matchSeed, bool p1Wins, uint256 callerSeed) external {
        bytes32 id = _pick(matchSeed, Escrow1v1.Status.Funded);
        if (id == bytes32(0)) return;
        _settleAndCheck(_settleCall(id, p1Wins, _anyone(callerSeed), 0));
    }

    function refundUnfunded(uint256 matchSeed, uint256 callerSeed) external {
        bytes32 id = _pick(matchSeed, Escrow1v1.Status.Open);
        if (id == bytes32(0)) return;
        _refundAndCheck(
            id,
            abi.encodeCall(Escrow1v1.refundUnfunded, (id)),
            _anyone(callerSeed),
            block.timestamp > ghost[id].fundDl,
            0,
            "refundUnfunded"
        );
    }

    function refundExpired(uint256 matchSeed, uint256 callerSeed) external {
        bytes32 id = _pick(matchSeed, Escrow1v1.Status.Funded);
        if (id == bytes32(0)) return;
        _refundAndCheck(
            id,
            abi.encodeCall(Escrow1v1.refundExpired, (id)),
            _anyone(callerSeed),
            block.timestamp > uint256(ghost[id].playDl) + GRACE,
            0,
            "refundExpired"
        );
    }

    /// @notice El árbitro (empate) o el dueño cancelan: siempre se puede, con
    ///         la partida abierta o lista.
    function cancel(uint256 matchSeed, bool funded, bool byOwner) external {
        bytes32 id = _pick(matchSeed, funded ? Escrow1v1.Status.Funded : Escrow1v1.Status.Open);
        if (id == bytes32(0)) return;
        address caller = byOwner ? owner : vm.addr(arbiterPk);
        uint256 before = refunds;
        _refundAndCheck(id, abi.encodeCall(Escrow1v1.cancelMatch, (id)), caller, true, 0, "cancelMatch");
        if (refunds > before) cancels++;
    }

    /// @notice Cobrar lo acreditado: el dueño del crédito, o cualquiera por él.
    function withdraw(uint256 accountSeed, bool forOther, uint256 callerSeed) external {
        // Casi siempre alguien que tiene crédito (si hay); a veces cualquiera,
        // para probar también el retiro sin nada acreditado.
        address a = accountSeed % 4 == 0 ? _eligible(accountSeed / 4) : _withCredit(accountSeed / 4);
        uint256 amt = escrow.owed(a);
        // `withdraw` no tiene presupuesto de gas: un destinatario caro también cobra.
        bool expectOk = amt > 0 && _canMove(a);
        address caller = forOther ? _anyone(callerSeed) : a;
        uint256 bal = usdc.balanceOf(a);
        uint256 callerBal = usdc.balanceOf(caller);

        vm.prank(caller);
        (bool ok,) = forOther
            ? address(escrow).call(abi.encodeCall(Escrow1v1.withdrawFor, (a)))
            : address(escrow).call(abi.encodeCall(Escrow1v1.withdraw, ()));
        if (!ok) {
            if (expectOk) _violation("withdraw: revirtio con credito y el USDC dispuesto");
            return;
        }
        if (!expectOk) _violation("withdraw: pago sin credito o a una direccion bloqueada");
        if (usdc.balanceOf(a) != bal + amt) _violation("withdraw: no llego exactamente lo acreditado");
        if (escrow.owed(a) != 0) _violation("withdraw: el credito no quedo en cero");
        if (caller != a && usdc.balanceOf(caller) != callerBal) _violation("withdraw: cobro alguien que no era el dueno del credito");
        withdrawals++;
    }

    // --------------------------------------------------------------------- //
    //                       GAS JUSTO (permissionless)                      //
    // --------------------------------------------------------------------- //
    // settle y dos de los reembolsos los puede mandar cualquiera, con el gas
    // que quiera. Cada pago le da al USDC exactamente `PAY_GAS`: con gas justo
    // la transacción entera revierte, y con gas de sobra el resultado es el
    // mismo que con todo el gas. Nunca un pago que entra en el presupuesto
    // queda acreditado, y uno que no entra queda acreditado siempre (ver
    // ChaosUSDC.burnOf: p3 cobra caro pero entra, p4 no entra).

    function settleTightGas(uint256 matchSeed, bool p1Wins, uint256 gasSeed, uint256 callerSeed) external {
        bytes32 id = _pick(matchSeed, Escrow1v1.Status.Funded);
        if (id == bytes32(0)) return;
        uint256 before = settles;
        _settleAndCheck(_settleCall(id, p1Wins, _anyone(callerSeed), bound(gasSeed, 25_000, 5_000_000)));
        if (settles > before) tightGasOk++;
    }

    function refundTightGas(uint256 matchSeed, uint256 gasSeed, uint256 callerSeed) external {
        uint256 gasLimit = bound(gasSeed, 25_000, 5_000_000);
        bytes32 id = _pick(matchSeed, Escrow1v1.Status.Funded);
        uint256 before = refunds;
        if (id != bytes32(0) && block.timestamp > uint256(ghost[id].playDl) + GRACE) {
            _refundAndCheck(
                id, abi.encodeCall(Escrow1v1.refundExpired, (id)), _anyone(callerSeed), true, gasLimit, "refundExpired"
            );
        } else {
            id = _pick(matchSeed, Escrow1v1.Status.Open);
            if (id == bytes32(0) || block.timestamp <= ghost[id].fundDl) return;
            _refundAndCheck(
                id, abi.encodeCall(Escrow1v1.refundUnfunded, (id)), _anyone(callerSeed), true, gasLimit, "refundUnfunded"
            );
        }
        if (refunds > before) tightGasOk++;
    }

    // --------------------------------------------------------------------- //
    //                        EL MUNDO: RELOJ Y USDC                         //
    // --------------------------------------------------------------------- //

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 3 hours));
    }

    /// @notice El reloj cae justo en un plazo de alguna partida (o un segundo
    ///         antes o después): ahí es donde dos caminos podrían superponerse
    ///         (unirse y reembolsar; liquidar y reembolsar por vencimiento).
    function warpToDeadline(uint256 matchSeed, uint256 which) external {
        uint256 n = ids.length;
        if (n == 0) return;
        Ghost storage g = ghost[ids[matchSeed % n]];
        uint256 t = which % 2 == 0 ? g.fundDl : uint256(g.playDl) + GRACE;
        t = t + (which / 2) % 3; // justo, +1 o +2
        if (t > 0) t -= 1; //      -1, justo o +1
        if (t > block.timestamp) vm.warp(t);
    }

    /// @notice Circle bloquea (o libera) a un jugador o a la plataforma.
    function toggleBlacklist(uint256 accountSeed) public {
        address a = _eligible(accountSeed);
        usdc.setBlacklisted(a, (accountSeed / 7) % 3 == 0);
    }

    /// @notice Circle bloquea al propio escrow: no entra ni sale nada.
    function toggleBlacklistEscrow(uint256 seed) public {
        usdc.setBlacklisted(address(escrow), seed % 8 == 0);
    }

    function togglePause(uint256 seed) public {
        usdc.setPaused(seed % 5 == 0);
    }

    /// @notice Alguien le manda USDC directo al contrato, por fuera de toda partida.
    function donate(uint256 amount) public {
        amount = bound(amount, 1, 100_000_000);
        usdc.mint(address(escrow), amount);
        ghostDonations += amount;
    }

    // --------------------------------------------------------------------- //
    //                                EL DUEÑO                               //
    // --------------------------------------------------------------------- //

    function setAllowedStake(uint256 stakeSeed, bool on) public {
        uint256 st = _stake(stakeSeed);
        vm.prank(owner);
        escrow.setAllowedStake(st, on);
    }

    function setFeeBps(uint256 f) public {
        uint16 fee = uint16(bound(f, 0, escrow.MAX_FEE_BPS()));
        vm.prank(owner);
        escrow.setFeeBps(fee);
    }

    /// @notice El dueño manda la comisión a la otra wallet (de lo que se
    ///         liquide desde ahora).
    function switchPlatform() public {
        address next = escrow.platformWallet() == platformA ? platformB : platformA;
        vm.prank(owner);
        escrow.setPlatformWallet(next);
    }

    /// @notice Configuraciones que ni el dueño puede poner: la comisión al
    ///         propio escrow o al token (quedaría varada) y una mesa de 0.
    function badOwnerConfig(uint256 which) public {
        uint256 k = which % 3;
        bool ok;
        vm.prank(owner);
        if (k == 0) {
            try escrow.setPlatformWallet(address(escrow)) {
                ok = true;
            } catch {}
        } else if (k == 1) {
            try escrow.setPlatformWallet(address(usdc)) {
                ok = true;
            } catch {}
        } else {
            try escrow.setAllowedStake(0, true) {
                ok = true;
            } catch {}
        }
        if (ok) _violation("dueno: puso una configuracion que el contrato tiene que rechazar");
    }

    /// @notice El dueño rota la llave del árbitro (se filtró, o se cambia de
    ///         proveedor). Desde ahí, lo firmado con la vieja no vale.
    function rotateArbiter(uint256 pkSeed) public {
        uint256 pk = bound(pkSeed, 1, SECP256K1_N - 1);
        if (pk == arbiterPk) return;
        address a = vm.addr(pk);
        if (a == attacker || a == owner || a == platformA || a == platformB || _isPlayer(a)) return;
        oldArbiterPks.push(arbiterPk);
        arbiterPk = pk;
        vm.prank(owner);
        escrow.setArbiter(a);
    }

    // --------------------------------------------------------------------- //
    //                  EL ATACANTE: NADA DE ESTO PUEDE ANDAR                //
    // --------------------------------------------------------------------- //

    /// @notice Un resultado firmado por cualquier otra llave (incluida una
    ///         vieja del árbitro) no liquida.
    function attackForgedResult(uint256 matchSeed, uint256 pkSeed, bool p1Wins) public {
        bytes32 id = _pick(matchSeed, Escrow1v1.Status.Funded);
        if (id == bytes32(0)) return;
        uint256 pk = bound(pkSeed, 1, SECP256K1_N - 1);
        if (pk == arbiterPk) return;
        _expectSettleFails(id, p1Wins, pk, "ataque: liquido con una firma que no es del arbitro vigente");
    }

    function attackOldArbiterKey(uint256 matchSeed, uint256 idx, bool p1Wins) public {
        if (oldArbiterPks.length == 0) return;
        uint256 pk = oldArbiterPks[idx % oldArbiterPks.length];
        if (pk == arbiterPk) return;
        bytes32 id = _pick(matchSeed, Escrow1v1.Status.Funded);
        if (id == bytes32(0)) return;
        _expectSettleFails(id, p1Wins, pk, "ataque: liquido con la llave vieja del arbitro");
    }

    /// @notice Aunque el árbitro firme como ganador a alguien que no jugó, el
    ///         contrato no le paga.
    function attackOutsiderWinner(uint256 matchSeed) public {
        bytes32 id = _pick(matchSeed, Escrow1v1.Status.Funded);
        if (id == bytes32(0)) return;
        uint64 dl = uint64(block.timestamp + 1 hours);
        bytes memory sig = _result(arbiterPk, id, attacker, dl);
        vm.prank(attacker);
        try escrow.settle(id, attacker, dl, sig) {
            _violation("ataque: cobro un ganador que no jugo la partida");
        } catch {}
    }

    /// @notice Unirse con el asiento que el árbitro le firmó a OTRO.
    function attackStolenSeat(uint256 matchSeed, uint256 victimSeed) public {
        bytes32 id = _pick(matchSeed, Escrow1v1.Status.Open);
        if (id == bytes32(0)) return;
        Ghost storage g = ghost[id];
        bytes memory seat = _seat(arbiterPk, id, _player(victimSeed), g.stake, g.fundDl, g.playDl);
        _ensureBalance(attacker, g.stake);
        vm.prank(attacker);
        try escrow.join(id, seat) {
            _violation("ataque: se unio con el asiento de otro jugador");
        } catch {}
    }

    /// @notice Abrir una partida con el asiento que el árbitro le firmó a otro.
    function attackOpenWithOthersSeat(uint256 victimSeed, uint256 stakeSeed) public {
        uint256 st = _stake(stakeSeed);
        bytes32 id = keccak256(abi.encode("robada", nonce++));
        uint64 f = uint64(block.timestamp + 1 hours);
        uint64 pl = f + 1 hours;
        bytes memory seat = _seat(arbiterPk, id, _player(victimSeed), st, f, pl);
        _ensureBalance(attacker, st);
        vm.prank(attacker);
        try escrow.open(id, st, f, pl, seat) {
            _violation("ataque: abrio una partida con el asiento de otro");
        } catch {}
    }

    /// @notice Unirse con un asiento firmado con OTRAS condiciones (plazos
    ///         distintos a los guardados al abrir).
    function attackChangedTerms(uint256 matchSeed, uint256 actorSeed, uint256 delta) public {
        bytes32 id = _pick(matchSeed, Escrow1v1.Status.Open);
        if (id == bytes32(0)) return;
        Ghost storage g = ghost[id];
        address p = _player(actorSeed);
        if (p == g.p1) return;
        // Cambia una sola de las tres condiciones: el stake, el plazo de fondeo
        // o el de juego. Cualquiera de las tres tiene que hacer fallar el asiento.
        uint256 st = g.stake;
        uint64 f = g.fundDl;
        uint64 pl = g.playDl;
        uint256 k = delta % 3;
        if (k == 0) st = st == 1_000_000 ? 2_000_000 : 1_000_000;
        else if (k == 1) f = f + 1;
        else pl = pl + uint64(bound(delta, 1, 1 days));
        bytes memory seat = _seat(arbiterPk, id, p, st, f, pl);
        _ensureBalance(p, g.stake);
        vm.prank(p);
        try escrow.join(id, seat) {
            _violation("ataque: se unio con condiciones distintas a las de la partida");
        } catch {}
    }

    /// @notice Volver a abrir una partida que ya existe (abierta, lista o
    ///         cerrada), aunque sea con un asiento válido del árbitro.
    function attackReopen(uint256 matchSeed, uint256 actorSeed) public {
        uint256 n = ids.length;
        if (n == 0) return;
        bytes32 id = ids[matchSeed % n];
        Ghost storage g = ghost[id];
        address p = _player(actorSeed);
        bytes memory seat = _seat(arbiterPk, id, p, g.stake, g.fundDl, g.playDl);
        _ensureBalance(p, g.stake);
        vm.prank(p);
        try escrow.open(id, g.stake, g.fundDl, g.playDl, seat) {
            _violation("ataque: se volvio a abrir una partida que ya existia");
        } catch {}
    }

    function attackStrangerCancel(uint256 matchSeed, bool funded) public {
        bytes32 id = _pick(matchSeed, funded ? Escrow1v1.Status.Funded : Escrow1v1.Status.Open);
        if (id == bytes32(0)) return;
        vm.prank(attacker);
        try escrow.cancelMatch(id) {
            _violation("ataque: cancelo alguien que no es ni el arbitro ni el dueno");
        } catch {}
    }

    /// @notice Una partida cerrada (liquidada o reembolsada) no vuelve a mover
    ///         plata por ningún camino, ni con firmas nuevas y válidas.
    function attackClosedMatch(uint256 matchSeed, uint256 which) public {
        bytes32 id = _pickClosed(matchSeed);
        if (id == bytes32(0)) return;
        Ghost storage g = ghost[id];
        uint256 k = which % 5;
        bool ok;
        if (k == 0) {
            if (g.p2 == address(0)) return;
            uint64 dl = uint64(block.timestamp + 1 days);
            bytes memory sig = _result(arbiterPk, id, g.p1, dl);
            vm.prank(attacker);
            try escrow.settle(id, g.p1, dl, sig) {
                ok = true;
            } catch {}
        } else if (k == 1) {
            vm.prank(attacker);
            try escrow.refundUnfunded(id) {
                ok = true;
            } catch {}
        } else if (k == 2) {
            vm.prank(attacker);
            try escrow.refundExpired(id) {
                ok = true;
            } catch {}
        } else if (k == 3) {
            vm.prank(vm.addr(arbiterPk));
            try escrow.cancelMatch(id) {
                ok = true;
            } catch {}
        } else {
            address p = g.p1 == players[0] ? players[1] : players[0];
            bytes memory seat = _seat(arbiterPk, id, p, g.stake, g.fundDl, g.playDl);
            _ensureBalance(p, g.stake);
            vm.prank(p);
            try escrow.join(id, seat) {
                ok = true;
            } catch {}
        }
        if (ok) _violation("ataque: una partida cerrada volvio a mover plata");
    }

    /// @notice Cada función exige su estado: reembolso "por vencimiento" de una
    ///         partida que nunca se llenó, reembolso "sin fondear" de una que
    ///         sí, liquidar una que no se llenó, unirse a una llena. Todo tiene
    ///         que revertir, aunque el plazo haya pasado y la firma sea válida.
    function attackWrongState(uint256 matchSeed, uint256 which) public {
        uint256 k = which % 4;
        bool ok;
        if (k == 0) {
            bytes32 id = _pick(matchSeed, Escrow1v1.Status.Open);
            if (id == bytes32(0)) return;
            vm.prank(attacker);
            try escrow.refundExpired(id) {
                ok = true;
            } catch {}
        } else if (k == 1) {
            bytes32 id = _pick(matchSeed, Escrow1v1.Status.Funded);
            if (id == bytes32(0)) return;
            vm.prank(attacker);
            try escrow.refundUnfunded(id) {
                ok = true;
            } catch {}
        } else if (k == 2) {
            bytes32 id = _pick(matchSeed, Escrow1v1.Status.Open);
            if (id == bytes32(0)) return;
            uint64 dl = uint64(block.timestamp + 1 hours);
            bytes memory sig = _result(arbiterPk, id, ghost[id].p1, dl);
            vm.prank(attacker);
            try escrow.settle(id, ghost[id].p1, dl, sig) {
                ok = true;
            } catch {}
        } else {
            bytes32 id = _pick(matchSeed, Escrow1v1.Status.Funded);
            if (id == bytes32(0)) return;
            Ghost storage g = ghost[id];
            address p = _player(which / 4);
            if (p == g.p1 || p == g.p2) return;
            bytes memory seat = _seat(arbiterPk, id, p, g.stake, g.fundDl, g.playDl);
            _ensureBalance(p, g.stake);
            vm.prank(p);
            try escrow.join(id, seat) {
                ok = true;
            } catch {}
        }
        if (ok) _violation("ataque: una funcion anduvo con la partida en el estado equivocado");
    }

    /// @notice Un resultado firmado por el árbitro VIGENTE pero con un
    ///         vencimiento posterior a `playDeadline + gracia` (un bug, un
    ///         reloj corrido): no liquida, ni siquiera antes de ese tope.
    function attackLateDeadline(uint256 matchSeed, uint256 extra, bool p1Wins) public {
        bytes32 id = _pick(matchSeed, Escrow1v1.Status.Funded);
        if (id == bytes32(0)) return;
        Ghost storage g = ghost[id];
        address w = p1Wins ? g.p1 : g.p2;
        uint64 dl = g.playDl + GRACE + 1 + uint64(extra % 7 days);
        bytes memory sig = _result(arbiterPk, id, w, dl);
        vm.prank(attacker);
        try escrow.settle(id, w, dl, sig) {
            _violation("ataque: liquido un resultado que vence despues de abrirse el reembolso");
        } catch {}
    }

    /// @notice Un asiento firmado por el árbitro vigente con plazos que pasan
    ///         `MAX_MATCH_DURATION`: no abre (un deposito no se traba por años).
    function attackFarDeadlines(uint256 actorSeed, uint256 extra) public {
        address p = _player(actorSeed);
        uint256 st = _stake(extra);
        uint64 f = uint64(block.timestamp + 1 hours);
        uint64 pl = uint64(block.timestamp + escrow.MAX_MATCH_DURATION() + 1 + extra % 365 days);
        bytes32 id = keccak256(abi.encode("eterna", nonce++));
        bytes memory seat = _seat(arbiterPk, id, p, st, f, pl);
        _ensureBalance(p, st);
        vm.prank(p);
        try escrow.open(id, st, f, pl, seat) {
            _violation("ataque: abrio una partida que dura mas que MAX_MATCH_DURATION");
        } catch {}
    }

    /// @notice Ni el dueño puede subir la comisión por encima del tope.
    function feeAboveCap(uint256 seed) public {
        uint16 max = escrow.MAX_FEE_BPS();
        uint16 fee = uint16(bound(seed, uint256(max) + 1, type(uint16).max));
        vm.prank(owner);
        try escrow.setFeeBps(fee) {
            _violation("dueno: subio la comision por encima del tope");
        } catch {}
    }

    /// @notice Alguien que no es el dueño toca la administración.
    function attackAdmin(uint256 which) public {
        uint256 k = which % 6;
        bool ok;
        vm.prank(attacker);
        if (k == 0) {
            try escrow.setArbiter(attacker) {
                ok = true;
            } catch {}
        } else if (k == 1) {
            try escrow.setFeeBps(0) {
                ok = true;
            } catch {}
        } else if (k == 2) {
            try escrow.setAllowedStake(1_000_000, false) {
                ok = true;
            } catch {}
        } else if (k == 3) {
            try escrow.setPlatformWallet(attacker) {
                ok = true;
            } catch {}
        } else if (k == 4) {
            try escrow.transferOwnership(attacker) {
                ok = true;
            } catch {}
        } else {
            try escrow.acceptOwnership() {
                ok = true;
            } catch {}
        }
        if (ok) _violation("ataque: alguien que no es el dueno toco la administracion");
    }

    // --------------------------------------------------------------------- //
    //                            DESPACHADORES                              //
    // --------------------------------------------------------------------- //
    // Si cada ataque y cada capricho del USDC fuera un objetivo suelto, se
    // comerían la mayoría de los turnos y casi ninguna partida llegaría a
    // liquidarse. Agrupados, cada grupo tiene la misma chance que una
    // operación normal.

    function attack(uint256 which, uint256 a, uint256 b, bool c) external {
        uint256 k = which % 13;
        if (k == 0) attackForgedResult(a, b, c);
        else if (k == 1) attackOldArbiterKey(a, b, c);
        else if (k == 2) attackOutsiderWinner(a);
        else if (k == 3) attackStolenSeat(a, b);
        else if (k == 4) attackOpenWithOthersSeat(a, b);
        else if (k == 5) attackChangedTerms(a, b, which / 10);
        else if (k == 6) attackReopen(a, b);
        else if (k == 7) attackStrangerCancel(a, c);
        else if (k == 8) attackClosedMatch(a, b);
        else if (k == 9) attackAdmin(a);
        else if (k == 10) attackWrongState(a, b);
        else if (k == 11) attackLateDeadline(a, b, c);
        else attackFarDeadlines(a, b);
    }

    function chaos(uint256 which, uint256 seed) external {
        uint256 k = which % 4;
        if (k == 0) toggleBlacklist(seed);
        else if (k == 1) toggleBlacklistEscrow(seed);
        else if (k == 2) togglePause(seed);
        else donate(seed);
    }

    function ownerAction(uint256 which, uint256 seed, bool on) external {
        uint256 k = which % 6;
        // Casi siempre se reabre la mesa: cerrada para siempre no se juega.
        if (k == 0) setAllowedStake(seed, on || seed % 4 != 0);
        else if (k == 1) setFeeBps(seed);
        else if (k == 2) rotateArbiter(seed);
        else if (k == 3) feeAboveCap(seed);
        else if (k == 4) switchPlatform();
        else badOwnerConfig(seed);
    }

    // --------------------------------------------------------------------- //
    //                   AL FINAL: TODO TIENE QUE PODER SALIR                //
    // --------------------------------------------------------------------- //

    /// @notice El USDC vuelve a la normalidad, el reloj pasa todos los plazos
    ///         y un TERCERO (el atacante, sin ningún permiso) cierra cada
    ///         partida y le entrega a cada uno lo acreditado. Nadie tiene que
    ///         firmar ni aprobar nada para que cada jugador recupere lo suyo.
    ///         No es un objetivo del fuzzer: lo llama `afterInvariant`.
    function drainAll() external {
        usdc.setPaused(false);
        usdc.setBlacklisted(address(escrow), false);
        for (uint256 i = 0; i < players.length; i++) usdc.setBlacklisted(players[i], false);
        usdc.setBlacklisted(platformA, false);
        usdc.setBlacklisted(platformB, false);

        uint256 latest = block.timestamp;
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 end = uint256(ghost[ids[i]].playDl) + GRACE + 1;
            if (end > latest) latest = end;
        }
        vm.warp(latest);

        for (uint256 i = 0; i < ids.length; i++) {
            bytes32 id = ids[i];
            Escrow1v1.Status s = ghost[id].status;
            if (s == Escrow1v1.Status.Open) {
                _refundAndCheck(id, abi.encodeCall(Escrow1v1.refundUnfunded, (id)), attacker, true, 0, "drain refundUnfunded");
            } else if (s == Escrow1v1.Status.Funded) {
                _refundAndCheck(id, abi.encodeCall(Escrow1v1.refundExpired, (id)), attacker, true, 0, "drain refundExpired");
            }
        }
        for (uint256 i = 0; i < players.length + 2; i++) {
            address a = _eligible(i);
            uint256 amt = escrow.owed(a);
            if (amt == 0) continue;
            uint256 bal = usdc.balanceOf(a);
            vm.prank(attacker);
            try escrow.withdrawFor(a) {
                if (usdc.balanceOf(a) != bal + amt) _violation("drain: withdrawFor no entrego lo acreditado");
            } catch {
                _violation("drain: withdrawFor revirtio con el USDC normal");
            }
        }
    }

    // --------------------------------------------------------------------- //
    //                           LECTURAS (tests)                            //
    // --------------------------------------------------------------------- //

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function ghostOf(bytes32 id) external view returns (Ghost memory) {
        return ghost[id];
    }

    function playersList() external view returns (address[] memory) {
        return players;
    }

    function currentArbiter() external view returns (address) {
        return vm.addr(arbiterPk);
    }

    // --------------------------------------------------------------------- //
    //                               INTERNOS                                //
    // --------------------------------------------------------------------- //

    /// @dev Una liquidación a presentar: el resultado que firma el árbitro con
    ///      su política (vence en playDeadline + gracia), quién la manda y con
    ///      cuánto gas. `gasLimit` 0 = llamada normal (todo el gas): ahí una
    ///      firma válida y a tiempo TIENE que liquidar. Con gas acotado puede
    ///      revertir, pero si sale bien tiene que haber pagado exactamente igual.
    struct SettleCall {
        bytes32 id;
        address winner;
        address loser;
        uint64 deadline;
        address caller;
        uint256 gasLimit;
    }

    /// @dev Lo que tenía cada uno antes de liquidar.
    struct SettleBefore {
        address platform; // la wallet que cobra la comisión ahora
        uint256 winner;
        uint256 loser;
        uint256 platformWealth;
        uint256 winnerOwed;
        uint256 platformOwed;
        bool winnerPayable;
        bool platformPayable;
        bool winnerPricey;
    }

    function _settleCall(bytes32 id, bool p1Wins, address caller, uint256 gasLimit)
        internal
        view
        returns (SettleCall memory c)
    {
        Ghost storage g = ghost[id];
        c.id = id;
        (c.winner, c.loser) = p1Wins ? (g.p1, g.p2) : (g.p2, g.p1);
        c.deadline = g.playDl + GRACE;
        c.caller = caller;
        c.gasLimit = gasLimit;
    }

    function _settleAndCheck(SettleCall memory c) internal {
        Ghost storage g = ghost[c.id];
        uint256 pot = g.stake * 2;
        // La comisión de ESTA partida (congelada al abrir), no la vigente.
        uint256 fee = (pot * g.feeBps) / 10_000;
        bool expectOk = block.timestamp <= c.deadline;
        address plat = escrow.platformWallet();
        SettleBefore memory b = SettleBefore({
            platform: plat,
            winner: _wealth(c.winner),
            loser: _wealth(c.loser),
            platformWealth: _wealth(plat),
            winnerOwed: escrow.owed(c.winner),
            platformOwed: escrow.owed(plat),
            winnerPayable: _payable(c.winner),
            platformPayable: _payable(plat),
            winnerPricey: _pricey(c.winner)
        });
        bytes memory data = abi.encodeCall(
            Escrow1v1.settle, (c.id, c.winner, c.deadline, _result(arbiterPk, c.id, c.winner, c.deadline))
        );

        vm.prank(c.caller);
        if (!_call(data, c.gasLimit)) {
            if (expectOk && c.gasLimit == 0) _violation("settle: revirtio con una firma valida y a tiempo");
            return;
        }
        if (!expectOk) _violation("settle: liquido con el resultado vencido");
        if (_wealth(c.winner) != b.winner + (pot - fee)) _violation("settle: el ganador no recibio exactamente el premio");
        if (_wealth(b.platform) != b.platformWealth + fee) {
            _violation("settle: la plataforma no recibio exactamente la comision");
        }
        if (_wealth(c.loser) != b.loser) _violation("settle: el perdedor recibio plata");
        if (b.winnerPayable && escrow.owed(c.winner) != b.winnerOwed) {
            _violation("settle: un ganador que podia cobrar quedo acreditado");
        }
        if (b.winnerPricey && escrow.owed(c.winner) != b.winnerOwed + (pot - fee)) {
            _violation("settle: un pago que no entra en el presupuesto de gas no quedo acreditado");
        }
        if (b.platformPayable && escrow.owed(b.platform) != b.platformOwed) {
            _violation("settle: la plataforma podia cobrar y quedo acreditada");
        }
        if (escrow.owed(c.winner) != b.winnerOwed || escrow.owed(b.platform) != b.platformOwed) creditsSeen++;
        g.status = Escrow1v1.Status.Settled;
        ghostLocked -= pot;
        settles++;
    }

    /// @dev Lo que tenían p1 y p2 antes de un reembolso.
    struct RefundBefore {
        uint256 a;
        uint256 b;
        uint256 aOwed;
        uint256 bOwed;
        bool aPayable;
        bool bPayable;
        bool aPricey;
        bool bPricey;
    }

    function _refundAndCheck(
        bytes32 id,
        bytes memory data,
        address caller,
        bool expectOk,
        uint256 gasLimit,
        string memory what
    ) internal {
        Ghost storage g = ghost[id];
        bool joined = g.p2 != address(0);
        RefundBefore memory r = RefundBefore({
            a: _wealth(g.p1),
            b: joined ? _wealth(g.p2) : 0,
            aOwed: escrow.owed(g.p1),
            bOwed: joined ? escrow.owed(g.p2) : 0,
            aPayable: _payable(g.p1),
            bPayable: joined && _payable(g.p2),
            aPricey: _pricey(g.p1),
            bPricey: joined && _pricey(g.p2)
        });

        vm.prank(caller);
        if (!_call(data, gasLimit)) {
            if (expectOk && gasLimit == 0) _violation(string.concat(what, ": revirtio cuando correspondia reembolsar"));
            return;
        }
        if (!expectOk) _violation(string.concat(what, ": reembolso fuera de tiempo"));
        if (_wealth(g.p1) != r.a + g.stake) _violation(string.concat(what, ": p1 no recupero exactamente su stake"));
        if (joined && _wealth(g.p2) != r.b + g.stake) {
            _violation(string.concat(what, ": p2 no recupero exactamente su stake"));
        }
        if (r.aPayable && escrow.owed(g.p1) != r.aOwed) {
            _violation(string.concat(what, ": p1 podia cobrar y quedo acreditado"));
        }
        if (r.bPayable && escrow.owed(g.p2) != r.bOwed) {
            _violation(string.concat(what, ": p2 podia cobrar y quedo acreditado"));
        }
        if (r.aPricey && escrow.owed(g.p1) != r.aOwed + g.stake) {
            _violation(string.concat(what, ": un pago a p1 fuera del presupuesto de gas no quedo acreditado"));
        }
        if (r.bPricey && escrow.owed(g.p2) != r.bOwed + g.stake) {
            _violation(string.concat(what, ": un pago a p2 fuera del presupuesto de gas no quedo acreditado"));
        }
        if (escrow.owed(g.p1) != r.aOwed || (joined && escrow.owed(g.p2) != r.bOwed)) creditsSeen++;
        ghostLocked -= joined ? g.stake * 2 : g.stake;
        g.status = Escrow1v1.Status.Refunded;
        refunds++;
    }

    function _expectSettleFails(bytes32 id, bool p1Wins, uint256 pk, string memory why) internal {
        Ghost storage g = ghost[id];
        address w = p1Wins ? g.p1 : g.p2;
        uint64 dl = uint64(block.timestamp + 1 hours);
        bytes memory sig = _result(pk, id, w, dl);
        vm.prank(attacker);
        try escrow.settle(id, w, dl, sig) {
            _violation(why);
        } catch {}
    }

    function _call(bytes memory data, uint256 gasLimit) internal returns (bool ok) {
        if (gasLimit == 0) (ok,) = address(escrow).call(data);
        else (ok,) = address(escrow).call{gas: gasLimit}(data);
    }

    function _player(uint256 seed) internal view returns (address) {
        return players[seed % players.length];
    }

    /// @dev Quien puede tener crédito: los jugadores y las dos wallets de plataforma.
    function _eligible(uint256 seed) internal view returns (address) {
        uint256 k = seed % (players.length + 2);
        if (k < players.length) return players[k];
        return k == players.length ? platformA : platformB;
    }

    /// @dev Cualquiera: para las funciones permissionless, quién llama no puede
    ///      cambiar a quién se le paga.
    function _anyone(uint256 seed) internal view returns (address) {
        uint256 k = seed % (players.length + 3);
        if (k < players.length) return players[k];
        if (k == players.length) return platformA;
        if (k == players.length + 1) return attacker;
        return vm.addr(arbiterPk);
    }

    /// @dev Alguien con crédito, recorriendo en círculo desde `seed`; si nadie
    ///      tiene, el de `seed`.
    function _withCredit(uint256 seed) internal view returns (address) {
        uint256 n = players.length + 2;
        for (uint256 i = 0; i < n; i++) {
            address a = _eligible(seed + i);
            if (escrow.owed(a) > 0) return a;
        }
        return _eligible(seed);
    }

    function _isPlayer(address a) internal view returns (bool) {
        for (uint256 i = 0; i < players.length; i++) if (players[i] == a) return true;
        return false;
    }

    function _stake(uint256 seed) internal pure returns (uint256) {
        uint256 k = seed % 4;
        if (k == 0) return 1_000_000;
        if (k == 1) return 2_000_000;
        if (k == 2) return 5_000_000;
        return 10_000_000;
    }

    /// @dev Lo que una dirección tiene, esté en su wallet o acreditado en el escrow.
    function _wealth(address a) internal view returns (uint256) {
        return usdc.balanceOf(a) + escrow.owed(a);
    }

    /// @dev El USDC le dejaría mover plata a `a` desde o hacia el escrow (con
    ///      todo el gas: depósitos y `withdraw`).
    function _canMove(address a) internal view returns (bool) {
        return !usdc.paused() && !usdc.blacklisted(a) && !usdc.blacklisted(address(escrow));
    }

    /// @dev Pagarle a `a` cuesta más que el presupuesto de cada pago empujado.
    function _pricey(address a) internal view returns (bool) {
        return usdc.burnOf(a) > escrow.PAY_GAS();
    }

    /// @dev Un pago empujado a `a` TIENE que llegar a su wallet.
    function _payable(address a) internal view returns (bool) {
        return _canMove(a) && !_pricey(a);
    }

    function _ensureBalance(address p, uint256 amount) internal {
        uint256 b = usdc.balanceOf(p);
        if (b < amount) usdc.mint(p, amount - b);
    }

    /// @dev La primera partida en estado `want`, recorriendo en círculo desde `seed`.
    function _pick(uint256 seed, Escrow1v1.Status want) internal view returns (bytes32) {
        uint256 n = ids.length;
        if (n == 0) return bytes32(0);
        uint256 start = seed % n;
        for (uint256 i = 0; i < n; i++) {
            bytes32 id = ids[(start + i) % n];
            if (ghost[id].status == want) return id;
        }
        return bytes32(0);
    }

    function _pickClosed(uint256 seed) internal view returns (bytes32) {
        uint256 n = ids.length;
        if (n == 0) return bytes32(0);
        uint256 start = seed % n;
        for (uint256 i = 0; i < n; i++) {
            bytes32 id = ids[(start + i) % n];
            Escrow1v1.Status s = ghost[id].status;
            if (s == Escrow1v1.Status.Settled || s == Escrow1v1.Status.Refunded) return id;
        }
        return bytes32(0);
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _seat(uint256 pk, bytes32 id, address p, uint256 st, uint64 f, uint64 pl)
        internal
        view
        returns (bytes memory)
    {
        return _sign(pk, escrow.seatDigest(id, p, st, f, pl));
    }

    function _result(uint256 pk, bytes32 id, address w, uint64 dl) internal view returns (bytes memory) {
        return _sign(pk, escrow.resultDigest(id, w, dl));
    }

    function _violation(string memory why) internal {
        if (violations == 0) firstViolation = why;
        violations++;
    }
}
