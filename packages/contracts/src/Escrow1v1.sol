// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title Escrow1v1
 * @notice Contrato de custodia (escrow) para duelos 1v1 por dinero.
 *
 * Idea general:
 *  - El "arbitro" (backend de confianza) crea la partida con los dos jugadores
 *    y la mesa (stake). Los dos jugadores depositan el mismo monto en USDC.
 *  - Cuando termina el juego, el arbitro FIRMA quien gano. Cualquiera puede
 *    enviar esa firma al contrato; el contrato la VERIFICA y paga:
 *    premio al ganador + comision a la wallet de la plataforma.
 *  - Reembolsos: si no se llena la partida a tiempo, si pasa el plazo de juego
 *    sin resultado (ej: el rival no jugo en 1 hora), o si el arbitro cancela
 *    (empate / disputa), se devuelve el dinero a los jugadores.
 *
 * Nadie (ni siquiera el dueño) puede sacar el dinero de los jugadores a mano:
 * solo se mueve segun estas reglas.
 */
contract Escrow1v1 is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /// @notice Token de apuesta (USDC).
    IERC20 public immutable usdc;

    /// @notice Backend que firma los resultados.
    address public arbiter;

    /// @notice Wallet que recibe la comision.
    address public platformWallet;

    /// @notice Comision en "basis points" (1000 = 10%).
    uint16 public feeBps;

    /// @notice Tope duro de comision para que nadie pueda abusar (20%).
    uint16 public constant MAX_FEE_BPS = 2000;

    enum Status {
        None, // no existe
        Open, // creada, esperando depositos
        Funded, // los dos depositaron
        Settled, // pagada al ganador
        Refunded // reembolsada
    }

    struct Match {
        address p1;
        address p2;
        uint256 stake; // lo que apuesta CADA jugador
        bool p1Paid;
        bool p2Paid;
        uint64 fundDeadline; // plazo para que ambos depositen
        uint64 playDeadline; // plazo para enviar el resultado (ej: +1 hora)
        Status status;
    }

    /// @notice Partidas por id.
    mapping(bytes32 => Match) public matches;

    /// @notice Mesas (montos) permitidas, en unidades de USDC (6 decimales).
    mapping(uint256 => bool) public allowedStake;

    bytes32 private constant RESULT_TYPEHASH =
        keccak256("Result(bytes32 matchId,address winner)");

    event ArbiterUpdated(address indexed arbiter);
    event PlatformWalletUpdated(address indexed wallet);
    event FeeUpdated(uint16 feeBps);
    event AllowedStakeUpdated(uint256 amount, bool allowed);
    event MatchOpened(bytes32 indexed id, address p1, uint256 stake);
    event Deposited(bytes32 indexed id, address player);
    event MatchFunded(bytes32 indexed id);
    event Settled(bytes32 indexed id, address winner, uint256 prize, uint256 fee);
    event Refunded(bytes32 indexed id);

    constructor(
        address _usdc,
        address _arbiter,
        address _platformWallet,
        uint16 _feeBps,
        address _owner
    ) Ownable(_owner) EIP712("Arcade1v1Escrow", "1") {
        require(
            _usdc != address(0) &&
                _arbiter != address(0) &&
                _platformWallet != address(0),
            "zero address"
        );
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
    //                          CICLO DE PARTIDA                             //
    // --------------------------------------------------------------------- //

    /// @notice Un jugador ABRE la partida depositando su apuesta (queda como p1,
    ///         esperando rival). El arbitro YA NO crea la partida ni paga gas:
    ///         cada jugador deposita lo suyo. Modelo asincronico "deposita y anda".
    function open(
        bytes32 id,
        uint256 stake,
        uint64 fundDeadline,
        uint64 playDeadline
    ) external nonReentrant {
        Match storage m = matches[id];
        require(m.status == Status.None, "match exists");
        require(allowedStake[stake], "stake not allowed");
        require(
            fundDeadline > block.timestamp && playDeadline > fundDeadline,
            "bad deadlines"
        );

        m.p1 = msg.sender;
        m.stake = stake;
        m.p1Paid = true;
        m.fundDeadline = fundDeadline;
        m.playDeadline = playDeadline;
        m.status = Status.Open;

        usdc.safeTransferFrom(msg.sender, address(this), stake);
        emit MatchOpened(id, msg.sender, stake);
        emit Deposited(id, msg.sender);
    }

    /// @notice Otro jugador se UNE depositando su apuesta -> partida lista (Funded).
    function join(bytes32 id) external nonReentrant {
        Match storage m = matches[id];
        require(m.status == Status.Open, "not open");
        require(block.timestamp <= m.fundDeadline, "fund expired");
        require(msg.sender != m.p1, "same player");

        m.p2 = msg.sender;
        m.p2Paid = true;
        m.status = Status.Funded;

        usdc.safeTransferFrom(msg.sender, address(this), m.stake);
        emit Deposited(id, msg.sender);
        emit MatchFunded(id);
    }

    /// @notice Liquida la partida con la firma del arbitro: paga al ganador.
    function settle(
        bytes32 id,
        address winner,
        bytes calldata signature
    ) external nonReentrant {
        Match storage m = matches[id];
        require(m.status == Status.Funded, "not funded");
        require(winner == m.p1 || winner == m.p2, "bad winner");

        // Verificar que el arbitro firmo (id, winner).
        bytes32 structHash = keccak256(
            abi.encode(RESULT_TYPEHASH, id, winner)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        require(signer == arbiter, "bad signature");

        m.status = Status.Settled;

        uint256 pot = m.stake * 2;
        uint256 fee = (pot * feeBps) / 10000;
        uint256 prize = pot - fee;

        if (fee > 0) usdc.safeTransfer(platformWallet, fee);
        usdc.safeTransfer(winner, prize);

        emit Settled(id, winner, prize, fee);
    }

    /// @notice Si el plazo de deposito vencio sin llenarse, cada uno recupera lo suyo.
    function refundUnfunded(bytes32 id) external nonReentrant {
        Match storage m = matches[id];
        require(m.status == Status.Open, "not open");
        require(block.timestamp > m.fundDeadline, "not expired");

        m.status = Status.Refunded;
        if (m.p1Paid) usdc.safeTransfer(m.p1, m.stake);
        if (m.p2Paid) usdc.safeTransfer(m.p2, m.stake);
        emit Refunded(id);
    }

    /// @notice Si se lleno pero paso el plazo de juego sin resultado
    ///         (ej: nadie jugo en 1 hora), se devuelve todo a ambos.
    function refundExpired(bytes32 id) external nonReentrant {
        Match storage m = matches[id];
        require(m.status == Status.Funded, "not funded");
        require(block.timestamp > m.playDeadline, "not expired");

        m.status = Status.Refunded;
        usdc.safeTransfer(m.p1, m.stake);
        usdc.safeTransfer(m.p2, m.stake);
        emit Refunded(id);
    }

    /// @notice El arbitro (o el dueño) cancela y reembolsa (empate / disputa).
    function cancelMatch(bytes32 id) external nonReentrant {
        require(msg.sender == arbiter || msg.sender == owner(), "not allowed");
        Match storage m = matches[id];
        require(
            m.status == Status.Open || m.status == Status.Funded,
            "cant cancel"
        );

        m.status = Status.Refunded;
        if (m.p1Paid) usdc.safeTransfer(m.p1, m.stake);
        if (m.p2Paid) usdc.safeTransfer(m.p2, m.stake);
        emit Refunded(id);
    }

    /// @notice Hash EIP-712 que el arbitro debe firmar (util para el backend/tests).
    function resultDigest(
        bytes32 id,
        address winner
    ) external view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(abi.encode(RESULT_TYPEHASH, id, winner))
            );
    }
}
