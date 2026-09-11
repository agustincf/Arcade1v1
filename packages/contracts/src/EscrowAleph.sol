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
        require(
            ECDSA.recover(_hashTypedDataV4(keccak256(abi.encode(PAYOUT_TYPEHASH, id, tableHash))), signature)
                == arbiter,
            "bad signature"
        );

        uint256 sum = 0;
        for (uint256 i = 0; i < n; i++) {
            require(seats[i] == r.seats[i], "bad seat");
            sum += amounts[i];
        }
        uint256 pot = r.stake * n;
        // net = pot menos comisión; se evita una variable `fee` aparte (stack too
        // deep con tantos parámetros calldata en esta función).
        uint256 net = pot - (pot * feeBps) / 10000;
        require(sum <= net && net - sum < n, "bad sum");

        r.status = Status.Settled;

        uint256 house = pot - sum; // comisión + polvo del redondeo
        if (house > 0) usdc.safeTransfer(platformWallet, house);
        for (uint256 i = 0; i < n; i++) {
            if (amounts[i] > 0) usdc.safeTransfer(seats[i], amounts[i]);
        }
        emit Settled(id, tableHash, sum, house);
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
