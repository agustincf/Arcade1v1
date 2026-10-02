// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Escrow1v1} from "../../src/Escrow1v1.sol";

interface IFiatToken {
    function blacklist(address) external;
    function unBlacklist(address) external;
    function pause() external;
    function unpause() external;
    function blacklister() external view returns (address);
    function pauser() external view returns (address);
}

/// @notice Mide cuánto gas necesita, como mínimo, un `transfer` del token.
contract TransferProbe {
    /// Búsqueda binaria del gas mínimo con el que el transfer sale bien. Cada
    /// prueba corre en una llamada que siempre revierte (así no gasta el saldo
    /// ni deja slots "tibios"), y el motivo dice si el transfer salió.
    function minGas(address token, address to, uint256 lo, uint256 hi) external returns (uint256) {
        bytes memory data = abi.encodeCall(IERC20.transfer, (to, 1));
        bytes32 salio = keccak256(abi.encodeWithSignature("Error(string)", "1"));
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            (, bytes memory ret) = address(this).call(abi.encodeCall(this.tryAndRevert, (token, data, mid)));
            if (keccak256(ret) == salio) hi = mid;
            else lo = mid + 1;
        }
        return lo;
    }

    function tryAndRevert(address token, bytes memory data, uint256 g) external {
        (bool ok,) = token.call{gas: g}(data);
        revert(ok ? "1" : "0");
    }
}

/// @notice `Escrow1v1` contra el USDC REAL de Circle (FiatTokenProxy
///         0x8335...2913 -> FiatTokenV2_2), en una copia local de Base mainnet.
///         Se saltean sin RPC:
///
///   BASE_RPC_URL=https://mainnet.base.org forge test --match-path 'test/fork/*'
///
///         El bloque es fijo (51.972.000) para que el resultado no cambie con
///         la red; `FORK_BLOCK=<n>` lo mueve. Correrlo de nuevo cuando el proxy
///         del USDC emita `Upgraded` (una implementación nueva): si
///         `test_Fork_ElTransferRealEntraHolgadoEnElPresupuesto` falla, el
///         presupuesto de gas de cada pago (PAY_GAS) quedó chico y los pagos
///         se van a acreditar en vez de empujarse. Freno: `setAllowedStake(x,
///         false)` en cada mesa.
contract Escrow1v1ForkTest is Test {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    uint256 constant ARB_PK = 0xA11CE;
    uint64 constant GRACE = 30 minutes;
    uint256 constant STAKE = 10_000_000; // la mesa más grande
    uint16 constant FEE = 1500;
    uint256 constant PRIZE = 2 * STAKE - (2 * STAKE * FEE) / 10_000;
    uint256 constant FEE_AMT = (2 * STAKE * FEE) / 10_000;

    Escrow1v1 esc;
    IERC20 usdc = IERC20(USDC);
    IFiatToken fiat = IFiatToken(USDC);
    address arbiter;
    address owner = address(0x5AFE);
    address platform = makeAddr("platform");
    address p1 = makeAddr("p1");
    address p2 = makeAddr("p2");
    bytes32 constant ID = keccak256("fork-match");
    uint64 fundDl;
    uint64 playDl;
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc, vm.envOr("FORK_BLOCK", uint256(51_972_000)));
        forked = true;
        arbiter = vm.addr(ARB_PK);
        esc = new Escrow1v1(USDC, arbiter, platform, FEE, owner);
        vm.prank(owner);
        esc.setAllowedStake(STAKE, true);
        fundDl = uint64(block.timestamp + 70 minutes);
        playDl = uint64(block.timestamp + 2 hours);
        deal(USDC, p1, STAKE);
        deal(USDC, p2, STAKE);
        vm.prank(p1);
        usdc.approve(address(esc), STAKE);
        vm.prank(p2);
        usdc.approve(address(esc), STAKE);
    }

    modifier onFork() {
        if (!forked) vm.skip(true);
        _;
    }

    function test_Fork_CaminoFeliz() public onFork {
        _openJoin();
        _settle(p1);
        assertEq(usdc.balanceOf(p1), PRIZE);
        assertEq(usdc.balanceOf(platform), FEE_AMT);
        assertEq(usdc.balanceOf(address(esc)), 0);
    }

    function test_Fork_GanadorEnLaBlacklistQuedaAcreditadoYCobraAlSalir() public onFork {
        _openJoin();
        _blacklist(p1);
        _settle(p1);
        assertEq(esc.owed(p1), PRIZE, "acreditado");
        assertEq(usdc.balanceOf(platform), FEE_AMT, "la comision se cobra igual");
        vm.expectRevert(); // "Blacklistable: account is blacklisted"
        esc.withdrawFor(p1);
        _unBlacklist(p1);
        esc.withdrawFor(p1);
        assertEq(usdc.balanceOf(p1), PRIZE);
        assertEq(usdc.balanceOf(address(esc)), 0);
    }

    function test_Fork_UnaDireccionEnLaBlacklistNoDeposita() public onFork {
        _blacklist(p1);
        bytes memory s1 = _sig(esc.seatDigest(ID, p1, STAKE, fundDl, playDl));
        vm.prank(p1);
        vm.expectRevert();
        esc.open(ID, STAKE, fundDl, playDl, s1);
    }

    function test_Fork_ReembolsoConUnoEnLaBlacklistLePagaAlOtro() public onFork {
        _openJoin();
        _blacklist(p2);
        vm.warp(uint256(playDl) + GRACE + 1);
        esc.refundExpired(ID);
        assertEq(usdc.balanceOf(p1), STAKE);
        assertEq(esc.owed(p2), STAKE);
    }

    function test_Fork_ConElUsdcEnPausaTodoSeAcreditaYDespuesSeEntrega() public onFork {
        _openJoin();
        vm.prank(fiat.pauser());
        fiat.pause();
        _settle(p2);
        assertEq(esc.owed(p2), PRIZE);
        assertEq(esc.owed(platform), FEE_AMT);
        vm.expectRevert(); // "Pausable: paused"
        esc.withdrawFor(p2);
        vm.prank(fiat.pauser());
        fiat.unpause();
        esc.withdrawFor(p2);
        esc.withdrawFor(platform);
        assertEq(usdc.balanceOf(p2), PRIZE);
        assertEq(usdc.balanceOf(platform), FEE_AMT);
        assertEq(usdc.balanceOf(address(esc)), 0);
    }

    /// Circle bloquea al ESCROW: no entra nada, cada salida queda acreditada y
    /// ningún retiro anda; no se pierde nada y todo fluye apenas lo liberan.
    /// (Riesgo aceptado: confiar en Circle. No hay camino de migración.)
    function test_Fork_EscrowEnLaBlacklist() public onFork {
        _openJoin();
        _blacklist(address(esc));
        _settle(p1);
        assertEq(esc.owed(p1), PRIZE);
        assertEq(esc.owed(platform), FEE_AMT);
        vm.expectRevert();
        esc.withdrawFor(p1);
        _unBlacklist(address(esc));
        esc.withdrawFor(p1);
        assertEq(usdc.balanceOf(p1), PRIZE);
    }

    /// Un tercero presenta `settle` con cada límite de gas de un rango: con el
    /// USDC real el resultado es siempre "revierte" o "paga entero", nunca un
    /// pago sano estacionado como crédito, y es monótono en el gas.
    function test_Fork_BarridoDeGasDelSettle() public onFork {
        _openJoin();
        uint64 dl = playDl + GRACE;
        bytes memory data = abi.encodeCall(Escrow1v1.settle, (ID, p1, dl, _sig(esc.resultDigest(ID, p1, dl))));
        (uint256 ok, uint256 rev) = _sweep(data, 100_000, 800_000, 1_000);
        console2.log("settle: sale bien / revierte", ok, rev);
        assertGt(ok, 0);
        assertGt(rev, 0);
    }

    function test_Fork_BarridoDeGasDelReembolso() public onFork {
        _openJoin();
        vm.warp(uint256(playDl) + GRACE + 1);
        (uint256 ok, uint256 rev) = _sweep(abi.encodeCall(Escrow1v1.refundExpired, (ID)), 100_000, 800_000, 1_000);
        console2.log("refundExpired: sale bien / revierte", ok, rev);
        assertGt(ok, 0);
        assertGt(rev, 0);
    }

    // --------------------------------------------------------------------- //

    function _sweep(bytes memory data, uint256 lo, uint256 hi, uint256 step)
        internal
        returns (uint256 ok, uint256 rev)
    {
        uint256 snap = vm.snapshotState();
        for (uint256 g = lo; g <= hi; g += step) {
            vm.revertToState(snap);
            vm.prank(address(0xBAD)); // cualquiera
            (bool success,) = address(esc).call{gas: g}(data);
            if (!success) {
                assertEq(ok, 0, "con mas gas nunca vuelve a revertir");
                rev++;
                continue;
            }
            ok++;
            assertEq(esc.owed(p1) + esc.owed(p2) + esc.owed(platform), 0, "credito forzado con el USDC real");
        }
        vm.revertToState(snap);
    }

    function _sig(bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ARB_PK, d);
        return abi.encodePacked(r, s, v);
    }

    function _openJoin() internal {
        bytes memory s1 = _sig(esc.seatDigest(ID, p1, STAKE, fundDl, playDl));
        vm.prank(p1);
        esc.open(ID, STAKE, fundDl, playDl, s1);
        bytes memory s2 = _sig(esc.seatDigest(ID, p2, STAKE, fundDl, playDl));
        vm.prank(p2);
        esc.join(ID, s2);
    }

    function _settle(address winner) internal {
        uint64 dl = playDl + GRACE;
        bytes memory sig = _sig(esc.resultDigest(ID, winner, dl));
        esc.settle(ID, winner, dl, sig);
    }

    function _blacklist(address a) internal {
        vm.prank(fiat.blacklister());
        fiat.blacklist(a);
    }

    function _unBlacklist(address a) internal {
        vm.prank(fiat.blacklister());
        fiat.unBlacklist(a);
    }
}

/// @notice Lo que cuesta una salida de VERDAD: todo se arma en `setUp`, así que
///         el test arranca con el USDC frío (EIP-2929), como una transacción
///         real. (Armar la partida en la misma función del test calienta el
///         proxy, la implementación y los saldos, y mide ~28 % de menos.)
contract Escrow1v1ForkFrioTest is Test {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    uint256 constant ARB_PK = 0xA11CE;
    uint64 constant GRACE = 30 minutes;
    uint256 constant STAKE = 10_000_000;
    bytes32 constant ID = keccak256("fork-frio");

    Escrow1v1 esc;
    TransferProbe probe;
    address nueva;
    bytes settleData;
    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("BASE_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc, vm.envOr("FORK_BLOCK", uint256(51_972_000)));
        forked = true;
        probe = new TransferProbe();
        deal(USDC, address(probe), 1_000_000);
        nueva = makeAddr("nueva");

        address p1 = makeAddr("p1");
        address p2 = makeAddr("p2");
        esc = new Escrow1v1(USDC, vm.addr(ARB_PK), makeAddr("platform"), 1500, address(0x5AFE));
        vm.prank(address(0x5AFE));
        esc.setAllowedStake(STAKE, true);
        uint64 fundDl = uint64(block.timestamp + 70 minutes);
        uint64 playDl = uint64(block.timestamp + 2 hours);
        address[2] memory who = [p1, p2];
        for (uint256 i = 0; i < 2; i++) {
            deal(USDC, who[i], STAKE);
            vm.prank(who[i]);
            IERC20(USDC).approve(address(esc), STAKE);
            bytes memory seat = _sig(esc.seatDigest(ID, who[i], STAKE, fundDl, playDl));
            vm.prank(who[i]);
            if (i == 0) esc.open(ID, STAKE, fundDl, playDl, seat);
            else esc.join(ID, seat);
        }
        uint64 dl = playDl + GRACE;
        settleData = abi.encodeCall(Escrow1v1.settle, (ID, p1, dl, _sig(esc.resultDigest(ID, p1, dl))));
    }

    modifier onFork() {
        if (!forked) vm.skip(true);
        _;
    }

    /// Canario de las actualizaciones de Circle: un `transfer` real y frío a
    /// una dirección NUEVA (lo más caro) tiene que dejar al menos 6x de margen
    /// en PAY_GAS. Medido en el bloque fijo: 41.051. Si una versión nueva del
    /// USDC lo hace fallar, el presupuesto quedó chico: revisar antes de seguir.
    function test_Fork_ElTransferRealEntraHolgadoEnElPresupuesto() public onFork {
        uint256 minimo = probe.minGas(USDC, nueva, 1_000, 300_000);
        console2.log("gas minimo de un transfer real y frio a una direccion nueva:", minimo);
        assertLe(minimo * 6, esc.PAY_GAS(), "PAY_GAS deja menos de 6x de margen: revisar antes de seguir");
    }

    /// El gas que hay que darle a un `settle` real (sin contar los 21.000 de la
    /// transacción ni el calldata). AUDIT.md (A7) dice ~400k: lo ata.
    function test_Fork_ElSettleRealPideMenosDe400kDeGas() public onFork {
        uint256 snap = vm.snapshotState(); // el USDC está frío acá
        uint256 lo = 100_000;
        uint256 hi = 2_000_000;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            vm.revertToState(snap);
            (bool ok,) = address(esc).call{gas: mid}(settleData);
            if (ok) hi = mid;
            else lo = mid + 1;
        }
        vm.revertToState(snap);
        console2.log("gas minimo de un settle real (frio):", lo);
        assertLt(lo, 400_000, "el settle pide mas de lo documentado en AUDIT.md (A7)");
    }

    function _sig(bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ARB_PK, d);
        return abi.encodePacked(r, s, v);
    }
}
