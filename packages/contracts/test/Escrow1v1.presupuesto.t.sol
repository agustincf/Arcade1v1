// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Escrow1v1} from "../src/Escrow1v1.sol";
import {DelegatingProxy, GasProbeUSDC} from "./ProxyUSDC.sol";

/// @notice La propiedad central del pago: una vez que `_pay` acepta el gas de
///         quien llama, el token recibe SIEMPRE exactamente `PAY_GAS`, con
///         cualquier gas de más. Si el margen del chequeo quedara corto (un
///         `+ 5_000` cambiado por menos), quien llama podría darle al token un
///         poco menos que su presupuesto, y los otros tests no lo verían.
///
///         Cada escenario se arma en `setUp` y se mide desde una foto tomada al
///         empezar el test: así el token está FRÍO (EIP-2929), como en una
///         transacción real, que es cuando el CALL cuesta más. Se busca el gas
///         mínimo con el que la salida anda y se barre de a 1 unidad desde ahí:
///         en cada corrida que sale bien, el token tiene que haber entrado con
///         el mismo gas, casi todo el presupuesto, y nadie quedar acreditado.
abstract contract PresupuestoBase is Test {
    uint256 constant PK = 0xA11CE;
    address arbiter;
    address owner = address(0xABCD);
    address platform = address(0xFEE5);
    address p1 = address(0x1111);
    address p2 = address(0x2222);
    uint256 constant STAKE = 5_000_000;
    uint64 constant GRACE = 30 minutes;
    bytes32 constant ID = keccak256("presupuesto");
    uint64 fundDl;
    uint64 playDl;
    Escrow1v1 esc;
    GasProbeUSDC tok;
    bytes data;
    address[] cobran; // a quiénes les paga la salida que se mide

    function _armar(bool conProxy, uint16 fee) internal {
        arbiter = vm.addr(PK);
        fundDl = uint64(block.timestamp + 70 minutes);
        playDl = uint64(block.timestamp + 2 hours);
        if (conProxy) tok = GasProbeUSDC(address(new DelegatingProxy(address(new GasProbeUSDC()))));
        else tok = new GasProbeUSDC();
        esc = new Escrow1v1(address(tok), arbiter, platform, fee, owner);
        vm.prank(owner);
        esc.setAllowedStake(STAKE, true);
    }

    function _deposita(address who, bool abre) internal {
        tok.mint(who, STAKE);
        vm.prank(who);
        IERC20(address(tok)).approve(address(esc), STAKE);
        bytes memory s = _sig(esc.seatDigest(ID, who, STAKE, fundDl, playDl));
        vm.prank(who);
        if (abre) esc.open(ID, STAKE, fundDl, playDl, s);
        else esc.join(ID, s);
    }

    function _sig(bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(PK, d);
        return abi.encodePacked(r, s, v);
    }

    /// El gas mínimo con el que la salida anda, desde la foto `snap`.
    function _minimo(uint256 snap) internal returns (uint256 lo) {
        lo = 50_000;
        uint256 hi = 3_000_000;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            vm.revertToState(snap);
            (bool ok,) = address(esc).call{gas: mid}(data);
            if (ok) hi = mid;
            else lo = mid + 1;
        }
    }

    function _medir() internal {
        uint256 snap = vm.snapshotState(); // acá el token está frío
        uint256 b = _minimo(snap);
        uint256[] memory entrada = new uint256[](cobran.length);
        for (uint256 g = b - 300; g <= b + 3_500; g++) {
            vm.revertToState(snap);
            vm.prank(address(0xBAD)); // un tercero cualquiera
            (bool ok,) = address(esc).call{gas: g}(data);
            if (!ok) {
                assertLt(g, b, "con mas gas que el minimo, nunca revierte");
                continue;
            }
            for (uint256 i = 0; i < cobran.length; i++) {
                uint256 s = tok.seen(cobran[i]);
                assertEq(esc.owed(cobran[i]), 0, "un pago que entra en el presupuesto nunca se acredita");
                // Detrás de un proxy la implementación recibe 63/64 de lo que
                // recibió el proxy, menos lo que él gasta: ~97 % del presupuesto.
                assertGt(s, (esc.PAY_GAS() * 97) / 100, "el token recibio casi todo su presupuesto");
                if (entrada[i] == 0) entrada[i] = s;
                assertEq(s, entrada[i], "el gas que recibe el token no depende del de quien llama");
            }
        }
        vm.revertToState(snap);
    }
}

contract PresupuestoRefundUnfunded is PresupuestoBase {
    function setUp() public {
        _armar(false, 1500);
        _deposita(p1, true);
        vm.warp(uint256(fundDl) + 1);
        data = abi.encodeCall(Escrow1v1.refundUnfunded, (ID));
        cobran.push(p1);
    }

    function test_ElTokenRecibeSiempreSuPresupuesto() public {
        _medir();
    }
}

/// Lo mismo detrás de un proxy como el del USDC real.
contract PresupuestoRefundUnfundedConProxy is PresupuestoBase {
    function setUp() public {
        _armar(true, 1500);
        _deposita(p1, true);
        vm.warp(uint256(fundDl) + 1);
        data = abi.encodeCall(Escrow1v1.refundUnfunded, (ID));
        cobran.push(p1);
    }

    function test_ElTokenRecibeSiempreSuPresupuesto() public {
        _medir();
    }
}

/// settle con dos pagos: el primero (la comisión) encuentra el token frío, el
/// segundo (el premio), tibio. Los dos reciben el presupuesto entero.
contract PresupuestoSettle is PresupuestoBase {
    function setUp() public {
        _armar(false, 1500);
        _deposita(p1, true);
        _deposita(p2, false);
        uint64 dl = playDl + GRACE;
        data = abi.encodeCall(Escrow1v1.settle, (ID, p1, dl, _sig(esc.resultDigest(ID, p1, dl))));
        cobran.push(platform);
        cobran.push(p1);
    }

    function test_ElTokenRecibeSiempreSuPresupuesto() public {
        _medir();
    }
}

/// Sin comisión, el premio es el ÚNICO pago y encuentra el token frío.
contract PresupuestoSettleSinComision is PresupuestoBase {
    function setUp() public {
        _armar(false, 0);
        _deposita(p1, true);
        _deposita(p2, false);
        uint64 dl = playDl + GRACE;
        data = abi.encodeCall(Escrow1v1.settle, (ID, p1, dl, _sig(esc.resultDigest(ID, p1, dl))));
        cobran.push(p1);
    }

    function test_ElTokenRecibeSiempreSuPresupuesto() public {
        _medir();
    }
}

contract PresupuestoRefundExpired is PresupuestoBase {
    function setUp() public {
        _armar(false, 1500);
        _deposita(p1, true);
        _deposita(p2, false);
        vm.warp(uint256(playDl) + GRACE + 1);
        data = abi.encodeCall(Escrow1v1.refundExpired, (ID));
        cobran.push(p1);
        cobran.push(p2);
    }

    function test_ElTokenRecibeSiempreSuPresupuesto() public {
        _medir();
    }
}
