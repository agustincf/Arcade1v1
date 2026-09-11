# Aleph — Etapa 4, PR 1 de 3: el contrato `EscrowAleph` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un contrato nuevo, `EscrowAleph.sol`, que custodia el stake de 4 a 8 asientos de una sala de Aleph, arranca la sala cuando están los N depósitos, paga a todos en una sola transacción con una tabla firmada por el árbitro y devuelve lo de cada uno en los tres caminos de reembolso; con su suite Foundry, su script de despliegue y su ensayo en anvil en CI. **No toca ni una línea del árbitro ni de `Escrow1v1.sol`.**

**Architecture:** Contrato aparte (decisión 1 del spec), calcado en forma de `Escrow1v1` (Ownable + ReentrancyGuard + EIP712 de OpenZeppelin v5, SafeERC20, comisión con tope duro, gracia de reembolso) pero con estado por sala de N asientos. Dos firmas EIP-712 del árbitro: el **pase de asiento** `Seat(roomId, seatsHash, stake, fundDeadline, playDeadline, player)`, que ata a cada asiento a ESA lista, ESE stake y ESOS plazos (así el primero que deposita no puede inventar la mesa), y la **tabla de pagos** `Payout(roomId, tableHash)` con `tableHash = keccak256(abi.encode(seats, amounts))`, que el contrato recompone desde el calldata. El polvo del redondeo va a la plataforma (decisión 5) y el contrato lo acota a menos de N micro-USDC.

**Tech Stack:** Solidity 0.8.24, Foundry (forge/anvil/cast, ya instalado en `~/.foundry/bin`), OpenZeppelin v5.6.1 + forge-std v1.16.1 (las trae CI; local ya están en `packages/contracts/lib`), bash para los ensayos en anvil.

**Spec:** `docs/superpowers/specs/2026-09-10-aleph-etapa4-mesas-de-plata-design.md` (leerlo entero antes de empezar; este plan implementa "Arquitectura › Contrato nuevo", "Reglas › Los tres reembolsos", "Reglas › De unidades a USDC" (la parte del contrato) y "Tests › Contrato"). Desvíos deliberados respecto del spec, ya decididos acá:

1. El spec dice `open(roomId, seats[], stake, deadlines, seatSig)` con "la lista viene firmada por el árbitro". En vez de una firma aparte para la lista, **el pase de cada asiento incluye `seatsHash`, `stake` y los dos plazos**: una sola firma por asiento cubre las dos cosas (quién puede entrar y con qué mesa). Menos firmas, menos estado, y el que abre no puede cambiar ni el stake ni los plazos (en 1v1 el que abre los elige; acá los fija el árbitro).
2. El spec dice "exige que cada address sea un asiento de ESA sala". Se exige algo más fuerte y más barato: **la tabla viene en el MISMO orden que `seats` de la sala** (`seats[i] == room.seats[i]`). Sin bucles anidados, y de paso imposibilita un address repetido en la tabla.
3. El spec dice `Σ amounts + comisión == depositado` y que el polvo va con la comisión. El contrato exige `Σ amounts ≤ neto` **y** `neto − Σ amounts < N`: la plataforma nunca se lleva más que la comisión más (N−1) micro-USDC. Es una comparación fuera del bucle que paga, así que no contradice la decisión 5.

## Global Constraints

- Rama: `feat/aleph-etapa4-contrato` desde `main` (c9a84b5 o posterior). **`main` no acepta push directo**: al final se abre un PR y CI corre los 2 checks. **No desplegar en Sepolia en este PR** (eso es el PR 3, con OK del dueño).
- Cada tarea termina en verde: `cd packages/contracts && forge test -vv` (y `forge fmt --check` si el repo lo adopta; hoy no). Prettier ignora `.sol`; los `.sh` y `.md` sí pasan por `npm run format:check`.
- Estilo del repo: comentarios en **español** que explican el porqué; identificadores en inglés; mensajes de `require` en inglés corto (mismo vocabulario que `Escrow1v1`: `"bad seat"`, `"not expired"`, `"cant cancel"`).
- Constantes del spec, copiadas tal cual: stake de la mesa **2 USDC = `2_000_000`** (6 decimales); comisión de producción **15 % (`FEE_BPS=1500`)**, tope duro **`MAX_FEE_BPS = 2000`**; gracia **`REFUND_GRACE = 30 minutes`**; asientos **`MIN_SEATS = 4`, `MAX_SEATS = 8`** (los mismos que `ALEPH_RULES` del motor).
- Dominio EIP-712 propio: `EIP712("Arcade1v1EscrowAleph", "1")`. Distinto del 1v1 (`"Arcade1v1Escrow"`) a propósito: aunque el `verifyingContract` ya separa los dominios, el nombre lo deja explícito.
- Nombres que consumen los PR 2 y 3 (NO cambiar sin actualizar aquellos planes): `open`, `deposit`, `settle`, `refundUnfunded`, `refundExpired`, `cancelRoom`, `roomOf`, `depositors`, `paid`, `feeBps`, `usdc`, `seatDigest`, `payoutDigest`, `seatsHashOf`, `tableHashOf`, `setAllowedStake`, `Status { None, Funding, Funded, Settled, Refunded }`.
- No escribir secuencias `\u` (backslash-u) en ningún archivo ni parámetro de esta etapa.
- Commits chicos, mensajes en español con prefijo (`feat(contracts): …`, `test(contracts): …`, `chore(ci): …`, `docs(contracts): …`) y el trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File structure

| Archivo                                                   | Responsabilidad                                                                                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/EscrowAleph.sol` (nuevo)          | El contrato: estado por sala, `open`/`deposit`, `settle` con tabla firmada, tres reembolsos, vistas y digests                                |
| `packages/contracts/test/EscrowAleph.t.sol` (nuevo)       | Suite Foundry: camino feliz, rechazos de tabla/firma/pase, doble liquidación, reembolsos exactos, 8 asientos, gracia, reentrancy             |
| `packages/contracts/test/ReentrantUSDC.sol` (nuevo)       | Token de prueba que reentra al contrato durante un `transfer` (para el test de reentrancy)                                                   |
| `packages/contracts/script/DeployAleph.s.sol` (nuevo)     | Despliega `EscrowAleph` sobre un USDC YA existente y habilita la mesa de 2 USDC; imprime las dos variables del árbitro (Render)              |
| `packages/contracts/deploy-aleph-base-sepolia.sh` (nuevo) | Wrapper "llave en mano" del script anterior (reusa la wallet de deploy de `.env`)                                                            |
| `packages/contracts/check-aleph-deploy.sh` (nuevo)        | Ensayo del deploy en anvil: despliega un MockUSDC, corre el script real y verifica que la mesa de 2 USDC quedó habilitada                    |
| `.github/workflows/ci.yml` (modificar)                    | Un paso más en el job `contracts`: `bash packages/contracts/check-aleph-deploy.sh` (`forge test` ya corre TODA la carpeta `test`, sin tocar) |
| `packages/contracts/README.md` (modificar)                | Sección "EscrowAleph" con el ciclo de vida, las dos firmas y cómo desplegar                                                                  |

---

### Task 1: El contrato: estado, `open` y `deposit` (fondeo)

**Files:**

- Create: `packages/contracts/src/EscrowAleph.sol`
- Create: `packages/contracts/test/EscrowAleph.t.sol`

**Interfaces:**

- Consumes: OpenZeppelin v5 (`IERC20`, `SafeERC20`, `Ownable`, `ReentrancyGuard`, `EIP712`, `ECDSA`), `test/MockUSDC.sol` (ya existe).
- Produces (las usan las tareas 2-4 y los PR 2-3): `EscrowAleph` con `Status`, `open(bytes32 id, address[] calldata seats, uint256 stake, uint64 fundDeadline, uint64 playDeadline, bytes calldata seatSig)`, `deposit(bytes32 id, bytes calldata seatSig)`, `roomOf(bytes32) returns (address[] memory seats, uint256 stake, uint8 paidCount, uint64 fundDeadline, uint64 playDeadline, Status status)`, `depositors(bytes32) returns (address[] memory)`, `paid(bytes32, address) returns (bool)`, `seatsHashOf(address[] calldata) returns (bytes32)`, `seatDigest(bytes32 id, bytes32 seatsHash, uint256 stake, uint64 fundDeadline, uint64 playDeadline, address player) returns (bytes32)`.

- [ ] **Step 0: Pararse en la rama**

```bash
git fetch origin && git checkout -b feat/aleph-etapa4-contrato origin/main
cd packages/contracts && ls lib   # deben estar forge-std y openzeppelin-contracts; si no: git clone como en .github/workflows/ci.yml
forge test -vv                    # la suite de Escrow1v1 tiene que estar verde antes de empezar
```

- [ ] **Step 1: Escribir los tests que fallan (fondeo)**

```solidity
// packages/contracts/test/EscrowAleph.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EscrowAleph} from "../src/EscrowAleph.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {ReentrantUSDC} from "./ReentrantUSDC.sol";

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
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd packages/contracts && forge test --match-contract EscrowAlephTest -vv`
Expected: error de compilación (`EscrowAleph` y `ReentrantUSDC` no existen). Para que compile ya, crear `test/ReentrantUSDC.sol` con el contenido de la Task 4 Step 1 ahora mismo (es independiente del escrow), y seguir.

- [ ] **Step 3: Escribir el contrato (fondeo + vistas; `settle` y reembolsos llegan en las tareas 2 y 3)**

```solidity
// packages/contracts/src/EscrowAleph.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title EscrowAleph
 * @notice Custodia de las MESAS DE PLATA de Aleph, el formato multi-agente.
 *
 *  - Una sala tiene N asientos (4 a 8) que depositan el MISMO stake en USDC.
 *  - El árbitro (backend de confianza) congela la lista de asientos y emite un
 *    PASE firmado por asiento (EIP-712). El primero que deposita ABRE la sala
 *    con la lista completa; los demás DEPOSITAN con su pase. Ningún tercero
 *    puede sentarse ni alterar la lista, el stake o los plazos.
 *  - Con los N depósitos la sala queda Funded y el juego corre fuera de la
 *    cadena. Al terminar, el árbitro FIRMA una tabla de pagos (quién cobra
 *    cuánto) y cualquiera la presenta: el contrato la verifica y paga a todos
 *    en una sola transacción, más la comisión a la plataforma.
 *  - Reembolsos: si no se completa el fondeo a tiempo, si pasa el plazo de
 *    juego (más una gracia) sin liquidación, o si el árbitro/dueño cancela, cada
 *    uno recupera exactamente su stake.
 *
 *  Qué garantiza aunque la llave del árbitro se filtre: la tabla solo puede
 *  pagar a los asientos de ESA sala, en su orden, y la plataforma nunca recibe
 *  más que la comisión más el polvo del redondeo (menos de N micro-USDC). Una
 *  llave robada puede repartir mal entre los que jugaban; no puede sacar la
 *  plata a un extraño ni inventar fondos.
 *
 *  Es un contrato APARTE de Escrow1v1 a propósito (decisión 1 del spec): aquel
 *  tiene la forma p1/p2 metida en el storage y en el typehash, y custodia
 *  plata viva.
 */
contract EscrowAleph is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /// @notice Token de apuesta (USDC).
    IERC20 public immutable usdc;

    /// @notice Backend que firma pases y tablas de pago.
    address public arbiter;

    /// @notice Wallet que recibe la comisión (y el polvo del redondeo).
    address public platformWallet;

    /// @notice Comisión en basis points (1500 = 15 %), sobre el pozo entero.
    uint16 public feeBps;

    /// @notice Tope duro de comisión (20 %).
    uint16 public constant MAX_FEE_BPS = 2000;

    /// @notice Margen tras el plazo de juego antes del reembolso permissionless.
    ///         Misma razón que en Escrow1v1: sin gracia, un asiento que va
    ///         perdiendo se adelanta a un settle tardío y convierte su derrota
    ///         en reembolso.
    uint64 public constant REFUND_GRACE = 30 minutes;

    /// @notice Asientos por sala: las reglas del motor (ALEPH_RULES).
    uint8 public constant MIN_SEATS = 4;
    uint8 public constant MAX_SEATS = 8;

    enum Status {
        None, // no existe
        Funding, // abierta, esperando depósitos
        Funded, // los N depositaron: se juega
        Settled, // pagada según la tabla
        Refunded // reembolsada
    }

    struct Room {
        address[] seats; // lista congelada, en el orden del árbitro
        bytes32 seatsHash; // keccak256(abi.encode(seats)), lo que atan los pases
        uint256 stake; // lo que pone CADA asiento
        uint8 paidCount;
        uint64 fundDeadline; // plazo para que depositen los N
        uint64 playDeadline; // plazo para liquidar (antes de la gracia)
        Status status;
    }

    /// @dev Una struct con un array dinámico no tiene getter público útil:
    ///      se expone con `roomOf` y `depositors`.
    mapping(bytes32 => Room) private rooms;

    /// @notice ¿Ese asiento ya depositó en esa sala?
    mapping(bytes32 => mapping(address => bool)) public paid;

    /// @notice Mesas (montos) permitidas, en unidades de USDC (6 decimales).
    mapping(uint256 => bool) public allowedStake;

    /// @dev PASE: el árbitro autoriza a `player` a depositar en `roomId` con
    ///      EXACTAMENTE esa lista (`seatsHash`), ese `stake` y esos plazos. Como
    ///      la firma cubre todo, el que abre no puede inventar la mesa, y un pase
    ///      no sirve en otra sala ni para otro asiento.
    bytes32 private constant SEAT_TYPEHASH = keccak256(
        "Seat(bytes32 roomId,bytes32 seatsHash,uint256 stake,uint64 fundDeadline,uint64 playDeadline,address player)"
    );

    /// @dev TABLA: el árbitro firma el HASH de la tabla (no los arrays), así la
    ///      estructura EIP-712 no depende del largo. El contrato recompone el
    ///      hash desde el calldata: `keccak256(abi.encode(seats, amounts))`.
    bytes32 private constant PAYOUT_TYPEHASH = keccak256("Payout(bytes32 roomId,bytes32 tableHash)");

    event ArbiterUpdated(address indexed arbiter);
    event PlatformWalletUpdated(address indexed wallet);
    event FeeUpdated(uint16 feeBps);
    event AllowedStakeUpdated(uint256 amount, bool allowed);
    event RoomOpened(bytes32 indexed id, address[] seats, uint256 stake);
    event Deposited(bytes32 indexed id, address player);
    event RoomFunded(bytes32 indexed id);
    event Settled(bytes32 indexed id, bytes32 tableHash, uint256 paidOut, uint256 house);
    event Refunded(bytes32 indexed id);

    constructor(address _usdc, address _arbiter, address _platformWallet, uint16 _feeBps, address _owner)
        Ownable(_owner)
        EIP712("Arcade1v1EscrowAleph", "1")
    {
        require(_usdc != address(0) && _arbiter != address(0) && _platformWallet != address(0), "zero address");
        require(_feeBps <= MAX_FEE_BPS, "fee too high");
        usdc = IERC20(_usdc);
        arbiter = _arbiter;
        platformWallet = _platformWallet;
        feeBps = _feeBps;
    }

    // --------------------------------------------------------------------- //
    //                              ADMIN                                    //
    // --------------------------------------------------------------------- //

    function setArbiter(address a) external onlyOwner {
        require(a != address(0), "zero address");
        arbiter = a;
        emit ArbiterUpdated(a);
    }

    function setPlatformWallet(address w) external onlyOwner {
        require(w != address(0), "zero address");
        platformWallet = w;
        emit PlatformWalletUpdated(w);
    }

    function setFeeBps(uint16 f) external onlyOwner {
        require(f <= MAX_FEE_BPS, "fee too high");
        feeBps = f;
        emit FeeUpdated(f);
    }

    function setAllowedStake(uint256 amount, bool ok) external onlyOwner {
        allowedStake[amount] = ok;
        emit AllowedStakeUpdated(amount, ok);
    }

    // --------------------------------------------------------------------- //
    //                              FONDEO                                   //
    // --------------------------------------------------------------------- //

    /// @notice El PRIMER asiento en depositar abre la sala con la lista completa
    ///         (congelada por el árbitro) y su pase. El árbitro no paga gas.
    function open(
        bytes32 id,
        address[] calldata seats,
        uint256 stake,
        uint64 fundDeadline,
        uint64 playDeadline,
        bytes calldata seatSig
    ) external nonReentrant {
        Room storage r = rooms[id];
        require(r.status == Status.None, "room exists");
        require(allowedStake[stake], "stake not allowed");
        require(seats.length >= MIN_SEATS && seats.length <= MAX_SEATS, "bad seat count");
        require(fundDeadline > block.timestamp && playDeadline > fundDeadline, "bad deadlines");
        bytes32 seatsHash = keccak256(abi.encode(seats));
        _requireSeat(id, seatsHash, stake, fundDeadline, playDeadline, msg.sender, seatSig);

        r.seats = seats;
        r.seatsHash = seatsHash;
        r.stake = stake;
        r.fundDeadline = fundDeadline;
        r.playDeadline = playDeadline;
        r.status = Status.Funding;
        // Membresía y unicidad sobre la lista ya en storage (N <= 8, barato).
        // Sin unicidad, un address repetido nunca completaría el fondeo (paid es
        // por address) y la plata quedaría a la espera del reembolso.
        require(_isSeat(r.seats, msg.sender), "not a seat");
        _requireDistinct(r.seats);

        paid[id][msg.sender] = true;
        r.paidCount = 1;

        usdc.safeTransferFrom(msg.sender, address(this), stake);
        emit RoomOpened(id, seats, stake);
        emit Deposited(id, msg.sender);
    }

    /// @notice Cada uno de los demás asientos deposita con su pase. Con el
    ///         último, la sala queda Funded.
    function deposit(bytes32 id, bytes calldata seatSig) external nonReentrant {
        Room storage r = rooms[id];
        require(r.status == Status.Funding, "not funding");
        require(block.timestamp <= r.fundDeadline, "fund expired");
        require(!paid[id][msg.sender], "already paid");
        _requireSeat(id, r.seatsHash, r.stake, r.fundDeadline, r.playDeadline, msg.sender, seatSig);
        require(_isSeat(r.seats, msg.sender), "not a seat");

        paid[id][msg.sender] = true;
        r.paidCount += 1;
        bool funded = r.paidCount == r.seats.length;
        if (funded) r.status = Status.Funded;

        usdc.safeTransferFrom(msg.sender, address(this), r.stake);
        emit Deposited(id, msg.sender);
        if (funded) emit RoomFunded(id);
    }

    // --------------------------------------------------------------------- //
    //                              VISTAS                                   //
    // --------------------------------------------------------------------- //

    /// @notice Estado de una sala (el árbitro la lee cada tick mientras fondea).
    function roomOf(bytes32 id)
        external
        view
        returns (
            address[] memory seats,
            uint256 stake,
            uint8 paidCount,
            uint64 fundDeadline,
            uint64 playDeadline,
            Status status
        )
    {
        Room storage r = rooms[id];
        return (r.seats, r.stake, r.paidCount, r.fundDeadline, r.playDeadline, r.status);
    }

    /// @notice Asientos que YA depositaron (en el orden de la lista). Una sola
    ///         llamada en vez de N lecturas de `paid`.
    function depositors(bytes32 id) external view returns (address[] memory out) {
        Room storage r = rooms[id];
        out = new address[](r.paidCount);
        uint256 k = 0;
        for (uint256 i = 0; i < r.seats.length; i++) {
            if (paid[id][r.seats[i]]) out[k++] = r.seats[i];
        }
    }

    /// @notice Hash de una lista de asientos, tal como lo atan los pases.
    function seatsHashOf(address[] calldata seats) external pure returns (bytes32) {
        return keccak256(abi.encode(seats));
    }

    /// @notice Hash de una tabla de pagos, tal como lo firma el árbitro.
    function tableHashOf(address[] calldata seats, uint256[] calldata amounts) external pure returns (bytes32) {
        return keccak256(abi.encode(seats, amounts));
    }

    /// @notice Digest EIP-712 del pase (útil para backend/tests).
    function seatDigest(
        bytes32 id,
        bytes32 seatsHash,
        uint256 stake,
        uint64 fundDeadline,
        uint64 playDeadline,
        address player
    ) external view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(SEAT_TYPEHASH, id, seatsHash, stake, fundDeadline, playDeadline, player))
        );
    }

    /// @notice Digest EIP-712 de la tabla de pagos (útil para backend/tests).
    function payoutDigest(bytes32 id, bytes32 tableHash) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(PAYOUT_TYPEHASH, id, tableHash)));
    }

    // --------------------------------------------------------------------- //
    //                              INTERNOS                                 //
    // --------------------------------------------------------------------- //

    function _requireSeat(
        bytes32 id,
        bytes32 seatsHash,
        uint256 stake,
        uint64 fundDeadline,
        uint64 playDeadline,
        address player,
        bytes calldata seatSig
    ) internal view {
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(SEAT_TYPEHASH, id, seatsHash, stake, fundDeadline, playDeadline, player))
        );
        require(ECDSA.recover(digest, seatSig) == arbiter, "bad seat");
    }

    function _isSeat(address[] storage seats, address a) internal view returns (bool) {
        for (uint256 i = 0; i < seats.length; i++) {
            if (seats[i] == a) return true;
        }
        return false;
    }

    function _requireDistinct(address[] storage seats) internal view {
        for (uint256 i = 0; i < seats.length; i++) {
            require(seats[i] != address(0), "zero address");
            for (uint256 j = i + 1; j < seats.length; j++) {
                require(seats[i] != seats[j], "duplicate seat");
            }
        }
    }
}
```

- [ ] **Step 4: Correr los tests de fondeo para verificar que pasan**

Run: `cd packages/contracts && forge test --match-contract EscrowAlephTest -vv`
Expected: los 13 tests de fondeo en PASS. (Si `forge` se queja de "stack too deep" en `open`, agregar `via_ir = true` NO es la salida: mover la lectura de `seatsHash` a una función interna `_seatsHash(seats)` y reintentar.)

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/EscrowAleph.sol packages/contracts/test/EscrowAleph.t.sol packages/contracts/test/ReentrantUSDC.sol
git commit -m "feat(contracts): EscrowAleph, fondeo de N asientos con pases firmados

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `settle`: la tabla firmada paga a todos en una transacción

**Files:**

- Modify: `packages/contracts/src/EscrowAleph.sol` (agregar la sección LIQUIDACIÓN entre FONDEO y VISTAS)
- Modify: `packages/contracts/test/EscrowAleph.t.sol`

**Interfaces:**

- Produces: `settle(bytes32 id, address[] calldata seats, uint256[] calldata amounts, bytes calldata signature)`. Reglas: sala `Funded`; `seats.length == amounts.length == N`; `seats[i] == room.seats[i]`; firma del árbitro sobre `Payout(id, keccak256(abi.encode(seats, amounts)))`; `Σ amounts ≤ pot − fee` y `(pot − fee) − Σ amounts < N`; paga `pot − Σ amounts` a la plataforma (comisión + polvo) y `amounts[i]` a cada asiento (cero no transfiere).

- [ ] **Step 1: Escribir los tests que fallan (liquidación)**

Agregar al final de `EscrowAlephTest` (antes de la llave de cierre):

```solidity
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
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd packages/contracts && forge test --match-contract EscrowAlephTest -vv`
Expected: error de compilación (`settle` no existe).

- [ ] **Step 3: Implementar `settle`**

Insertar en `EscrowAleph.sol`, después de `deposit` y antes de la sección VISTAS:

```solidity
    // --------------------------------------------------------------------- //
    //                            LIQUIDACIÓN                                //
    // --------------------------------------------------------------------- //

    /// @notice Paga la tabla firmada por el árbitro, a todos en una transacción.
    ///         Cualquiera puede presentarla (el árbitro lo hace por defecto; si
    ///         no, un asiento con la firma publicada en el registro).
    ///
    ///  La tabla llega en el MISMO orden que `seats` de la sala: así cada
    ///  address se compara con el suyo (sin bucles anidados) y no puede repetirse.
    ///  La suma no puede pasar el neto (pozo menos comisión) ni dejar N o más
    ///  micro-USDC sin repartir: el resto (comisión + polvo) va a la plataforma.
    function settle(bytes32 id, address[] calldata seats, uint256[] calldata amounts, bytes calldata signature)
        external
        nonReentrant
    {
        Room storage r = rooms[id];
        require(r.status == Status.Funded, "not funded");
        uint256 n = r.seats.length;
        require(seats.length == n && amounts.length == n, "bad table");

        bytes32 tableHash = keccak256(abi.encode(seats, amounts));
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(PAYOUT_TYPEHASH, id, tableHash)));
        require(ECDSA.recover(digest, signature) == arbiter, "bad signature");

        uint256 sum = 0;
        for (uint256 i = 0; i < n; i++) {
            require(seats[i] == r.seats[i], "bad seat");
            sum += amounts[i];
        }
        uint256 pot = r.stake * n;
        uint256 fee = (pot * feeBps) / 10000;
        uint256 net = pot - fee;
        require(sum <= net && net - sum < n, "bad sum");

        r.status = Status.Settled;

        uint256 house = pot - sum; // comisión + polvo del redondeo
        if (house > 0) usdc.safeTransfer(platformWallet, house);
        for (uint256 i = 0; i < n; i++) {
            if (amounts[i] > 0) usdc.safeTransfer(seats[i], amounts[i]);
        }
        emit Settled(id, tableHash, sum, house);
    }
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd packages/contracts && forge test --match-contract EscrowAlephTest -vv`
Expected: todos en PASS (13 de fondeo + 13 de liquidación). Ojo con `test_SettleDustGoesToPlatform`: si `amounts` suman exactamente el neto antes del `-= 2`, el assert final compara contra `8_000_000 - sum`; si el cálculo de la tabla en el test no cuadra, arreglar EL TEST (los números del comentario), nunca aflojar el `require` del contrato.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/EscrowAleph.sol packages/contracts/test/EscrowAleph.t.sol
git commit -m "feat(contracts): EscrowAleph.settle, una tabla firmada paga a todos en una transacción

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Los tres reembolsos y la gracia

**Files:**

- Modify: `packages/contracts/src/EscrowAleph.sol` (sección REEMBOLSOS)
- Modify: `packages/contracts/test/EscrowAleph.t.sol`

**Interfaces:**

- Produces: `refundUnfunded(bytes32)` (cualquiera, `Funding` y `now > fundDeadline`), `refundExpired(bytes32)` (cualquiera, `Funded` y `now > playDeadline + REFUND_GRACE`), `cancelRoom(bytes32)` (árbitro o dueño, `Funding` o `Funded`). Los tres devuelven `stake` a cada asiento con `paid == true` y marcan `Refunded`.

- [ ] **Step 1: Escribir los tests que fallan (reembolsos)**

```solidity
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
        escrow.settle(roomId, seats4, amounts, sig);
        assertEq(usdc.balanceOf(seats4[0]), amounts[0], "cobra pese al settle tardio");
    }

    function test_RefundExpiredRejectsAfterSettle() public {
        _fundRoom(roomId, seats4);
        uint256[] memory amounts = _table4();
        escrow.settle(roomId, seats4, amounts, _signPayout(roomId, seats4, amounts));
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
        escrow.settle(roomId, seats4, amounts, _signPayout(roomId, seats4, amounts));
        vm.prank(arbiter);
        vm.expectRevert(bytes("cant cancel"));
        escrow.cancelRoom(roomId);
    }

    function test_CancelRejectsUnknownRoom() public {
        vm.prank(arbiter);
        vm.expectRevert(bytes("cant cancel"));
        escrow.cancelRoom(keccak256("nope"));
    }
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd packages/contracts && forge test --match-contract EscrowAlephTest -vv`
Expected: error de compilación (`refundUnfunded`, `refundExpired`, `cancelRoom` no existen).

- [ ] **Step 3: Implementar los reembolsos**

Insertar después de `settle`:

```solidity
    // --------------------------------------------------------------------- //
    //                             REEMBOLSOS                                //
    // --------------------------------------------------------------------- //
    // Ningún camino puede dejar plata trabada para siempre. Los tres son de
    // bucle acotado (N <= 8) y devuelven EXACTAMENTE el stake a cada uno que
    // depositó; el que no depositó no recibe nada.

    /// @notice Venció el fondeo sin completarse: cada uno recupera lo suyo.
    function refundUnfunded(bytes32 id) external nonReentrant {
        Room storage r = rooms[id];
        require(r.status == Status.Funding, "not funding");
        require(block.timestamp > r.fundDeadline, "not expired");
        r.status = Status.Refunded;
        _refundPaid(id, r);
        emit Refunded(id);
    }

    /// @notice Se fondeó pero el árbitro no liquidó: pasada la gracia,
    ///         cualquiera devuelve el stake a los N.
    function refundExpired(bytes32 id) external nonReentrant {
        Room storage r = rooms[id];
        require(r.status == Status.Funded, "not funded");
        require(block.timestamp > uint256(r.playDeadline) + REFUND_GRACE, "not expired");
        r.status = Status.Refunded;
        _refundPaid(id, r);
        emit Refunded(id);
    }

    /// @notice Disputa o sala rota: el árbitro (o el dueño) cancela y reembolsa.
    ///         El árbitro lo usa también cuando SU plazo de fondeo vence, para
    ///         no dejar a nadie esperando el reembolso permissionless.
    function cancelRoom(bytes32 id) external nonReentrant {
        require(msg.sender == arbiter || msg.sender == owner(), "not allowed");
        Room storage r = rooms[id];
        require(r.status == Status.Funding || r.status == Status.Funded, "cant cancel");
        r.status = Status.Refunded;
        _refundPaid(id, r);
        emit Refunded(id);
    }

    function _refundPaid(bytes32 id, Room storage r) internal {
        for (uint256 i = 0; i < r.seats.length; i++) {
            address s = r.seats[i];
            if (paid[id][s]) usdc.safeTransfer(s, r.stake);
        }
    }
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd packages/contracts && forge test --match-contract EscrowAlephTest -vv`
Expected: todo en PASS (35 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/EscrowAleph.sol packages/contracts/test/EscrowAleph.t.sol
git commit -m "feat(contracts): EscrowAleph, los tres reembolsos con la gracia del 1v1

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Reentrancy: el guard corta una reentrada durante un pago

**Files:**

- Create: `packages/contracts/test/ReentrantUSDC.sol` (si no se creó en la Task 1)
- Modify: `packages/contracts/test/EscrowAleph.t.sol`

- [ ] **Step 1: El token que reentra**

```solidity
// packages/contracts/test/ReentrantUSDC.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockUSDC} from "./MockUSDC.sol";

/// @notice USDC de prueba que, UNA vez, llama al contrato objetivo en medio de
///         un `transfer` (como haría un token malicioso o con hooks). Sirve para
///         comprobar que `nonReentrant` corta la reentrada.
contract ReentrantUSDC is MockUSDC {
    address public target;
    bytes public payload;
    bool public armed;

    function arm(address t, bytes calldata p) external {
        target = t;
        payload = p;
        armed = true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (armed) {
            armed = false;
            (bool ok, bytes memory ret) = target.call(payload);
            // Propagar el revert del objetivo tal cual (asi el test ve el error
            // del guard y no un "transfer failed" generico).
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
        return super.transfer(to, amount);
    }
}
```

- [ ] **Step 2: El test**

```solidity
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
        bytes32 pd = esc.payoutDigest(roomId, keccak256(abi.encode(seats4, amounts)));
        (uint8 v2, bytes32 r2, bytes32 s2) = vm.sign(arbiterPk, pd);
        bytes memory paySig = abi.encodePacked(r2, s2, v2);

        // Durante el primer transfer (a la plataforma), el token intenta
        // cancelar la sala: el guard tiene que cortarlo ANTES de mirar quién llama.
        evil.arm(address(esc), abi.encodeWithSelector(EscrowAleph.cancelRoom.selector, roomId));
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        esc.settle(roomId, seats4, amounts, paySig);
    }
```

- [ ] **Step 3: Correr**

Run: `cd packages/contracts && forge test --match-contract EscrowAlephTest -vv`
Expected: PASS. Si el error observado es `"not allowed"` en vez del selector del guard, el modificador `nonReentrant` no está en `cancelRoom`: agregarlo (el guard corre ANTES del cuerpo, por eso debe ganar).

- [ ] **Step 4: Correr la suite entera del paquete (la del 1v1 no se toca y sigue verde)**

Run: `cd packages/contracts && forge test -vv`
Expected: `Escrow1v1Test` 13/13 y `EscrowAlephTest` 36/36.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/test/ReentrantUSDC.sol packages/contracts/test/EscrowAleph.t.sol
git commit -m "test(contracts): EscrowAleph, el guard corta una reentrada en medio del pago

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Script de despliegue, wrapper de Sepolia y ensayo en anvil (CI)

**Files:**

- Create: `packages/contracts/script/DeployAleph.s.sol`
- Create: `packages/contracts/deploy-aleph-base-sepolia.sh`
- Create: `packages/contracts/check-aleph-deploy.sh`
- Modify: `.github/workflows/ci.yml` (job `contracts`, al final)

**Interfaces:**

- Consumes: variables de `packages/contracts/.env` (ya existen para el 1v1): `PRIVATE_KEY`, `ARBITER_ADDRESS`, `PLATFORM_WALLET`, `FEE_BPS`, `USDC_ADDRESS` (el `TestUSDC` YA desplegado en Sepolia: reusarlo, no desplegar otro).
- Produces: en la salida del script, las líneas `ALEPH_ESCROW_ADDRESS=…` y `ALEPH_STAKES=0,2` (variables del árbitro en Render) que consume el PR 3 al desplegar. La web no necesita variables nuevas.

- [ ] **Step 1: El script de Foundry**

```solidity
// packages/contracts/script/DeployAleph.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {EscrowAleph} from "../src/EscrowAleph.sol";

/**
 * Despliega EscrowAleph (mesas de plata de Aleph) sobre un USDC YA existente y
 * habilita la unica mesa de la etapa 4 (2 USDC). Variables de entorno:
 *   PRIVATE_KEY, USDC_ADDRESS (obligatoria: el TestUSDC ya desplegado),
 *   ARBITER_ADDRESS, PLATFORM_WALLET, FEE_BPS
 *   ALEPH_STAKE (opcional, en unidades de 6 decimales; default 2_000_000)
 */
contract DeployAleph is Script {
    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address arbiter = vm.envAddress("ARBITER_ADDRESS");
        address platform = vm.envAddress("PLATFORM_WALLET");
        uint16 feeBps = uint16(vm.envUint("FEE_BPS"));
        uint256 stake = vm.envOr("ALEPH_STAKE", uint256(2_000_000));
        address owner = vm.addr(deployerPk);

        vm.startBroadcast(deployerPk);
        EscrowAleph escrow = new EscrowAleph(usdc, arbiter, platform, feeBps, owner);
        escrow.setAllowedStake(stake, true);
        vm.stopBroadcast();

        console2.log("EscrowAleph desplegado en:", address(escrow));
        console2.log("USDC:", usdc);
        console2.log("mesa habilitada (unidades):", stake);
        console2.log("");
        // La web NO necesita variable nueva: la direccion del escrow viaja en la
        // vista de cada sala (`escrow`) y el link al explorador sale de CHAIN_ID.
        console2.log("=== Pega esto en apps/server (Render) ===");
        console2.log("ALEPH_ESCROW_ADDRESS=%s", address(escrow));
        console2.log("ALEPH_STAKES=0,2");
    }
}
```

- [ ] **Step 2: El wrapper de Sepolia**

```bash
#!/usr/bin/env bash
# packages/contracts/deploy-aleph-base-sepolia.sh
# Despliega EscrowAleph (mesas de plata de Aleph) en Base Sepolia, reusando la
# wallet de deploy y el TestUSDC de `.env` (los creó deploy-base-sepolia.sh).
# Uso: bash deploy-aleph-base-sepolia.sh
set -euo pipefail
cd "$(dirname "$0")"
[ -d "$HOME/.foundry/bin" ] && PATH="$HOME/.foundry/bin:$PATH"

ENV_FILE=".env"
RPC="${RPC_URL:-https://sepolia.base.org}"

if ! command -v forge >/dev/null 2>&1; then
  echo "❌ Falta Foundry (forge/cast). Instalalo: https://book.getfoundry.sh/getting-started/installation"
  exit 1
fi
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi

for v in PRIVATE_KEY USDC_ADDRESS ARBITER_ADDRESS PLATFORM_WALLET FEE_BPS; do
  if [ -z "${!v:-}" ]; then
    echo "❌ Falta $v en $ENV_FILE (corré primero deploy-base-sepolia.sh, que deja la wallet y el USDC)."
    exit 1
  fi
done

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
BAL=$(cast balance "$DEPLOYER" --rpc-url "$RPC" 2>/dev/null || echo 0)
echo "Deployer: $DEPLOYER"
echo "Saldo:    $BAL wei  (red: $RPC)"
if [ "$BAL" = "0" ]; then
  echo "⛽ Sin gas. Fondeá $DEPLOYER en un faucet de Base Sepolia y reintentá."
  exit 1
fi

echo ""
echo "🚀 Desplegando EscrowAleph a Base Sepolia..."
forge script script/DeployAleph.s.sol:DeployAleph --rpc-url "$RPC" --broadcast -vv

echo ""
echo "✅ Listo. Copiá ALEPH_ESCROW_ADDRESS y ALEPH_STAKES al árbitro (Render) y"
echo "   redeployalo. La web no necesita variables nuevas."
```

- [ ] **Step 3: El ensayo en anvil**

```bash
#!/usr/bin/env bash
# packages/contracts/check-aleph-deploy.sh
# Ensaya el script de despliegue REAL de EscrowAleph (script/DeployAleph.s.sol)
# en una cadena local (anvil): despliega un MockUSDC, corre el script sobre él y
# verifica que la mesa de 2 USDC quedó habilitada (si no, los depósitos
# revertirían en producción con "stake not allowed").
# Requiere Foundry (anvil, cast, forge). Uso: bash packages/contracts/check-aleph-deploy.sh
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")"

pkill -f anvil 2>/dev/null || true
sleep 1
anvil >/tmp/anvil-aleph-deploy.log 2>&1 &
ANVIL_PID=$!
for i in $(seq 1 15); do
  cast block-number --rpc-url http://localhost:8545 >/dev/null 2>&1 && break
  sleep 1
done
cleanup() { kill "$ANVIL_PID" 2>/dev/null || true; }
trap cleanup EXIT

KEY0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
USDC=$(forge create test/MockUSDC.sol:MockUSDC --rpc-url http://localhost:8545 \
  --private-key $KEY0 --broadcast 2>/dev/null | grep "Deployed to:" | awk '{print $3}')
[ -n "$USDC" ] || { echo "❌ No se pudo desplegar el MockUSDC"; exit 1; }

OUT=$(PRIVATE_KEY=$KEY0 \
  USDC_ADDRESS=$USDC \
  ARBITER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
  PLATFORM_WALLET=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC \
  FEE_BPS=1500 \
  forge script script/DeployAleph.s.sol:DeployAleph --rpc-url http://localhost:8545 --broadcast 2>&1)
echo "$OUT" | grep -E "EscrowAleph desplegado|ALEPH_ESCROW_ADDRESS|ALEPH_STAKES" || true

ESCROW=$(echo "$OUT" | sed -n 's/.*ALEPH_ESCROW_ADDRESS=//p' | tr -d ' \r' | head -1)
[ -n "$ESCROW" ] || { echo "❌ No se pudo determinar la dirección del EscrowAleph"; exit 1; }

allowed=$(cast call "$ESCROW" "allowedStake(uint256)(bool)" 2000000 --rpc-url http://localhost:8545)
echo "  mesa 2 USDC -> allowedStake = $allowed"
usdcOn=$(cast call "$ESCROW" "usdc()(address)" --rpc-url http://localhost:8545)
echo "  usdc() = $usdcOn (esperado $USDC)"
if [ "$allowed" = "true" ] && [ "$(echo "$usdcOn" | tr A-Z a-z)" = "$(echo "$USDC" | tr A-Z a-z)" ]; then
  echo "DEPLOY DE ALEPH VERIFICADO ✅ (EscrowAleph sobre el USDC dado + mesa de 2 USDC habilitada)"
else
  echo "❌ El deploy de Aleph no dejó la mesa habilitada o apunta a otro USDC"
  exit 1
fi
```

- [ ] **Step 4: Correr el ensayo localmente**

Run: `bash packages/contracts/check-aleph-deploy.sh`
Expected: termina con `DEPLOY DE ALEPH VERIFICADO ✅`. Si `forge create` no imprime "Deployed to:" con `--broadcast`, es la versión de Foundry: usar la misma invocación que `check-payment-e2e.sh` (ya funciona en CI).

- [ ] **Step 5: El paso de CI**

En `.github/workflows/ci.yml`, job `contracts`, después de `Ensayo del deploy (script real + mesas habilitadas)`:

```yaml
- name: Ensayo del deploy de EscrowAleph (mesa de 2 USDC habilitada)
  run: bash packages/contracts/check-aleph-deploy.sh
```

(`forge test -vv` ya corre toda la carpeta `test`, así que `EscrowAleph.t.sol` entra solo.)

- [ ] **Step 6: Formato y commit**

```bash
npm run format          # los .sh y el .yml pasan por prettier
git add packages/contracts/script/DeployAleph.s.sol packages/contracts/deploy-aleph-base-sepolia.sh packages/contracts/check-aleph-deploy.sh .github/workflows/ci.yml
git commit -m "chore(contracts): script de deploy de EscrowAleph, wrapper de Sepolia y ensayo en anvil (CI)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: README del paquete y PR

**Files:**

- Modify: `packages/contracts/README.md`

- [ ] **Step 1: Documentar `EscrowAleph`**

Agregar, después de la sección "Que hace" del `Escrow1v1` (antes de "Correr las pruebas"):

````markdown
## EscrowAleph — las mesas de plata de Aleph (N asientos)

Contrato aparte para el formato multi-agente: entre 4 y 8 asientos depositan el
mismo stake, el árbitro firma UNA tabla de pagos y el contrato paga a todos en
una sola transacción. No toca `Escrow1v1`.

- `open` — el PRIMER asiento en depositar abre la sala con la lista completa de
  asientos (congelada por el árbitro), el stake y los plazos. Presenta su
  **pase** (EIP-712 `Seat(roomId, seatsHash, stake, fundDeadline,
playDeadline, player)`, firmado por el árbitro): sin pase no hay asiento, y el
  pase ata la lista, el stake y los plazos, así que el que abre no puede
  inventar la mesa.
- `deposit` — cada uno de los demás asientos deposita con su pase. Con el
  último, la sala queda `Funded` y el juego corre fuera de la cadena.
- `settle` — con la firma del árbitro sobre `Payout(roomId, tableHash)`,
  `tableHash = keccak256(abi.encode(seats, amounts))`, paga `amounts[i]` a cada
  asiento (en el MISMO orden que la sala) y la comisión más el polvo del
  redondeo a la plataforma. Exige `Σ amounts ≤ pozo − comisión` y que sobren
  menos de N micro-USDC. Cualquiera puede presentarla.
- `refundUnfunded` / `refundExpired` / `cancelRoom` — los tres reembolsos:
  fondeo vencido (cualquiera), plazo de juego vencido más la gracia de 30 min
  (cualquiera), o cancelación del árbitro/dueño. Cada uno recupera exactamente
  su stake; el que no depositó no recibe nada.
- `roomOf`, `depositors`, `paid` — vistas para el árbitro y los agentes;
  `seatDigest`, `payoutDigest`, `seatsHashOf`, `tableHashOf` — los hashes tal
  cual los calcula el contrato, para que el backend y los tests firmen lo mismo.

Dominio EIP-712 propio: `Arcade1v1EscrowAleph` v1. Mesa habilitada por el
script de despliegue: **2 USDC**.

Pruebas: `forge test --match-contract EscrowAlephTest -vv` (36 pruebas: fondeo,
liquidación, tabla que no suma, address que no es asiento, firma ajena, doble
liquidación, los tres reembolsos exactos, 8 asientos, gracia y reentrancy).

Desplegar en Base Sepolia (reusa la wallet y el TestUSDC de `.env`):

```bash
cd packages/contracts
bash deploy-aleph-base-sepolia.sh
```
````

Ensayo del deploy en anvil, sin gastar nada: `bash check-aleph-deploy.sh`.

````

Y en "Correr las pruebas", actualizar el conteo: `Estado actual: 13 pruebas de Escrow1v1 + 36 de EscrowAleph`.

- [ ] **Step 2: Verificación final**

```bash
cd packages/contracts && forge test -vv
cd ../.. && npm run format:check && npm run lint
````

Expected: todo verde (el lint no mira `.sol`; el format sí mira `.md`/`.sh`/`.yml`).

- [ ] **Step 3: Commit y PR**

```bash
git add packages/contracts/README.md
git commit -m "docs(contracts): EscrowAleph, ciclo de vida, firmas y despliegue

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/aleph-etapa4-contrato
gh pr create --title "feat(aleph): etapa 4, PR 1 — EscrowAleph, el contrato de las mesas de plata" --body "$(cat <<'EOF'
## Qué hay

Contrato nuevo `EscrowAleph.sol` (decisión 1 del spec): N asientos (4–8) depositan con pases EIP-712 del árbitro, una tabla firmada paga a todos en una transacción, tres reembolsos exactos, gracia de 30 min. 36 tests Foundry (incluye 8 asientos y reentrancy), script de deploy, wrapper de Sepolia y ensayo en anvil en CI.

No toca `Escrow1v1.sol` ni el árbitro. No despliega nada (eso va con el PR 3, con OK).

Spec: docs/superpowers/specs/2026-09-10-aleph-etapa4-mesas-de-plata-design.md
Plan: docs/superpowers/plans/2026-09-11-aleph-etapa4-1-contrato.md

## Desvíos del spec (explicados en el plan)

1. El pase de cada asiento incluye `seatsHash`, `stake` y plazos (una sola firma por asiento; el que abre no puede inventar la mesa).
2. La tabla viene en el mismo orden que los asientos de la sala (más barato y sin repetidos).
3. `Σ amounts ≤ neto` y `neto − Σ < N`: la plataforma nunca cobra más que comisión + polvo.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Esperar los 2 checks de CI en verde antes de mergear. **Mergear este PR desbloquea el PR 2 (árbitro).**

---

## Self-review (hecho al escribir el plan)

- **Cobertura del spec, sección por sección:** estado por sala ✔ (Task 1), `open` con lista firmada ✔ (Task 1, con el desvío 1), `deposit` ✔ (Task 1), `settle` con tabla firmada + suma exacta + polvo a la comisión ✔ (Task 2), tres reembolsos + gracia ✔ (Task 3), "el bucle aguanta 8 asientos" ✔ (`test_SettleEightSeats`), reentrancy ✔ (Task 4), "un monto en cero no transfiere" ✔ (`test_SettleZeroAmountDoesNotTransfer`), comisión 15 % con tope 20 % ✔ (constructor + `MAX_FEE_BPS`), despliegue en Sepolia: script listo, ejecución en PR 3 ✔.
- **Placeholders:** ninguno; todo el código está escrito.
- **Consistencia de nombres:** `roomOf` devuelve 6 valores en el orden `(seats, stake, paidCount, fundDeadline, playDeadline, status)` en contrato, tests y README; `Status` con 5 valores en ese orden (los PR 2 y 3 lo copian como `ALEPH_ESCROW_STATUS`); mensajes de `require` iguales en contrato y `expectRevert`.
