// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title Escrow1v1
 * @notice Contrato de custodia (escrow) para duelos 1v1 por dinero.
 *
 * Idea general:
 *  - El "arbitro" (backend de confianza) empareja a los dos jugadores y le
 *    firma a cada uno un ASIENTO: autoriza a ESA address a depositar en ESA
 *    partida, con ESE stake y ESOS plazos. El primero ABRE la partida
 *    depositando; el segundo se UNE depositando lo mismo. El arbitro no paga
 *    gas por esto.
 *  - Cuando termina el juego, el arbitro FIRMA quien gano, con un
 *    VENCIMIENTO. La presenta el propio arbitro (y si no, cualquiera: el
 *    ganador, por ejemplo); el contrato la VERIFICA y paga: premio al
 *    ganador + comision a la wallet de la plataforma.
 *  - Reembolsos: si no se llena la partida a tiempo, si pasa el plazo de juego
 *    (mas una gracia) sin liquidar, o si el arbitro cancela (empate /
 *    disputa), se devuelve el dinero a los jugadores.
 *  - Cada pago (premio, comision o reembolso) se EMPUJA por separado. Si el
 *    USDC rechaza uno (una direccion en la blacklist de Circle, el token en
 *    pausa), ese monto queda ACREDITADO en `owed` y lo demas se paga igual.
 *    Lo acreditado se retira con `withdraw` (o cualquiera se lo entrega a su
 *    dueño con `withdrawFor`).
 *
 * Nadie (ni siquiera el dueño) puede sacar el dinero de los jugadores a mano:
 * solo se mueve segun estas reglas.
 *
 * Version 2 (antes de mainnet, decidida el 2026-09-24), los mismos arreglos
 * que EscrowAleph v2 mas los propios del 1v1:
 *  - Pago con credito de respaldo. En la v1 el premio y los reembolsos se
 *    empujaban en la misma transaccion: un ganador en la blacklist hacia
 *    revertir `settle`, y un jugador en la blacklist hacia revertir
 *    `refundExpired` y `cancelMatch` (devuelven a los dos). La plata del otro
 *    quedaba trabada para siempre.
 *  - El resultado firmado VENCE. En la v1 `Result(matchId, winner)` valia para
 *    siempre: si el arbitro llegaba a firmar dos ganadores distintos para una
 *    partida, cobraba el primero que llegara.
 *  - El asiento ata el stake y los plazos. En la v1 los elegia quien abria, y
 *    el que se unia solo podia revisarlos por su cuenta.
 *  - Dueño en dos pasos (`Ownable2Step`), y sin `renounceOwnership`: una
 *    transferencia a una direccion con un error, o una renuncia, perdian la
 *    administracion (rotar la llave del arbitro) para siempre.
 *  - Una mesa deshabilitada (`setAllowedStake(x, false)`) tampoco acepta
 *    `join`: es el freno de emergencia de las entradas. Las salidas (liquidar,
 *    reembolsar, retirar) nunca se frenan.
 */
contract Escrow1v1 is Ownable2Step, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /// @notice Token de apuesta (USDC).
    IERC20 public immutable usdc;

    /// @notice Backend que firma asientos y resultados.
    address public arbiter;

    /// @notice Wallet que recibe la comision.
    address public platformWallet;

    /// @notice Comision en "basis points" (1000 = 10%).
    uint16 public feeBps;

    /// @notice Tope duro de comision para que nadie pueda abusar (20%).
    uint16 public constant MAX_FEE_BPS = 2000;

    /// @notice Margen tras el plazo de juego antes de habilitar el reembolso
    ///         permissionless (refundExpired). Le da al arbitro una ventana firme
    ///         para liquidar: sin esto, pasado playDeadline el PERDEDOR podia
    ///         front-runnear un settle tardio con refundExpired y convertir su
    ///         derrota en reembolso. El arbitro firma el resultado con vencimiento
    ///         en `playDeadline + REFUND_GRACE`: la firma vale exactamente hasta
    ///         que se abre el reembolso, sin superponerse con el.
    uint64 public constant REFUND_GRACE = 30 minutes;

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
        uint64 playDeadline; // plazo para decidir (antes de la gracia)
        Status status;
    }

    /// @notice Partidas por id.
    mapping(bytes32 => Match) public matches;

    /// @notice Mesas (montos) permitidas, en unidades de USDC (6 decimales).
    mapping(uint256 => bool) public allowedStake;

    /// @notice Lo que cada direccion tiene ACREDITADO y todavia no cobro: los
    ///         pagos y reembolsos cuyo envio rechazo el USDC. Es un saldo por
    ///         direccion (suma lo de todas sus partidas) y solo sale hacia ella.
    mapping(address => uint256) public owed;

    /// @dev RESULTADO: el arbitro firma quien gano, con un VENCIMIENTO
    ///      (segundos). Pasado `deadline`, la firma no liquida nada, sin
    ///      transaccion de nadie. (El arbitro, ademas, no publica una firma
    ///      antes de tenerla guardada: una caida no le hace firmar otra.)
    bytes32 private constant RESULT_TYPEHASH =
        keccak256("Result(bytes32 matchId,address winner,uint64 deadline)");

    /// @dev ASIENTO: el arbitro autoriza que UNA address entre a ESTA partida,
    ///      con ESTE stake y ESTOS plazos. Ata al rival on-chain sin que el
    ///      arbitro pague gas: cada jugador presenta su asiento al depositar
    ///      (open/join). Como la firma incluye matchId + player, no sirve en
    ///      otra partida ni para otro: un observador no puede secuestrar el slot
    ///      del rival (griefing/DoS). Y como incluye las condiciones, quien abre
    ///      no puede inventarlas: el asiento del que se une verifica contra las
    ///      que quedaron guardadas.
    bytes32 private constant SEAT_TYPEHASH =
        keccak256(
            "Seat(bytes32 matchId,address player,uint256 stake,uint64 fundDeadline,uint64 playDeadline)"
        );

    event ArbiterUpdated(address indexed arbiter);
    event PlatformWalletUpdated(address indexed wallet);
    event FeeUpdated(uint16 feeBps);
    event AllowedStakeUpdated(uint256 amount, bool allowed);
    event MatchOpened(bytes32 indexed id, address p1, uint256 stake);
    event Deposited(bytes32 indexed id, address player);
    event MatchFunded(bytes32 indexed id);
    event Settled(bytes32 indexed id, address winner, uint256 prize, uint256 fee);
    event Refunded(bytes32 indexed id);
    /// @notice Un pago de la partida `id` que el USDC rechazo y quedo en `owed`.
    event Credited(bytes32 indexed id, address indexed account, uint256 amount);
    /// @notice Lo acreditado salio hacia su dueño.
    event Withdrawn(address indexed account, uint256 amount);

    // Version "2" del dominio: la v1 firmaba `Result(matchId, winner)` y
    // `Seat(matchId, player)`. La direccion del contrato ya separa las firmas;
    // la version lo deja explicito.
    constructor(
        address _usdc,
        address _arbiter,
        address _platformWallet,
        uint16 _feeBps,
        address _owner
    ) Ownable(_owner) EIP712("Arcade1v1Escrow", "2") {
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

    /// @notice Habilita o deshabilita una mesa. Deshabilitada, no acepta
    ///         depositos nuevos: ni `open` ni `join`. Lo que ya esta adentro
    ///         sale igual (liquidacion, reembolsos y retiros no la miran).
    function setAllowedStake(uint256 amount, bool ok) external onlyOwner {
        allowedStake[amount] = ok;
        emit AllowedStakeUpdated(amount, ok);
    }

    /// @notice Deshabilitada: sin dueño no hay quien rote la llave del arbitro
    ///         ni la wallet de la plataforma. La transferencia es en dos pasos
    ///         (`transferOwnership` + `acceptOwnership`, de Ownable2Step).
    function renounceOwnership() public pure override {
        revert("renounce disabled");
    }

    // --------------------------------------------------------------------- //
    //                          CICLO DE PARTIDA                             //
    // --------------------------------------------------------------------- //

    /// @notice Un jugador ABRE la partida depositando su apuesta (queda como p1,
    ///         esperando rival), con el stake y los plazos que le firmo el
    ///         arbitro. El arbitro no crea la partida ni paga gas: cada jugador
    ///         deposita lo suyo. Modelo asincronico "deposita y anda".
    function open(
        bytes32 id,
        uint256 stake,
        uint64 fundDeadline,
        uint64 playDeadline,
        bytes calldata seatSig
    ) external nonReentrant {
        Match storage m = matches[id];
        require(m.status == Status.None, "match exists");
        require(allowedStake[stake], "stake not allowed");
        require(
            fundDeadline > block.timestamp && playDeadline > fundDeadline,
            "bad deadlines"
        );
        // El arbitro debe haber autorizado a msg.sender para ESTA partida y con
        // ESTAS condiciones: sin esto, un observador front-runnea el open con el
        // mismo id y secuestra el slot de p1 (la partida real del rival queda
        // inutilizable), o el que abre elige plazos que el rival no pidio.
        _requireSeat(id, msg.sender, stake, fundDeadline, playDeadline, seatSig);

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
    function join(bytes32 id, bytes calldata seatSig) external nonReentrant {
        Match storage m = matches[id];
        require(m.status == Status.Open, "not open");
        require(block.timestamp <= m.fundDeadline, "fund expired");
        require(msg.sender != m.p1, "same player");
        // Mesa deshabilitada: tampoco entra plata para completar una partida ya
        // abierta. La de p1 vuelve con refundUnfunded o con la cancelacion.
        require(allowedStake[m.stake], "stake not allowed");
        // El arbitro debe haber autorizado a msg.sender como rival de ESTA
        // partida, con las MISMAS condiciones con las que se abrio: sin esto, un
        // tercero front-runnea el join del rival legitimo, ocupa el slot de p2 y
        // bloquea la liquidacion (los fondos quedan trabados hasta el reembolso
        // por vencimiento).
        _requireSeat(
            id,
            msg.sender,
            m.stake,
            m.fundDeadline,
            m.playDeadline,
            seatSig
        );

        m.p2 = msg.sender;
        m.p2Paid = true;
        m.status = Status.Funded;

        usdc.safeTransferFrom(msg.sender, address(this), m.stake);
        emit Deposited(id, msg.sender);
        emit MatchFunded(id);
    }

    /// @notice Liquida la partida con la firma del arbitro: paga al ganador.
    ///         Cualquiera puede presentarla (el arbitro lo hace por defecto),
    ///         hasta su `deadline`.
    function settle(
        bytes32 id,
        address winner,
        uint64 deadline,
        bytes calldata signature
    ) external nonReentrant {
        Match storage m = matches[id];
        require(m.status == Status.Funded, "not funded");
        require(block.timestamp <= deadline, "result expired");
        require(winner == m.p1 || winner == m.p2, "bad winner");
        // Verificar que el arbitro firmo (id, winner, deadline).
        require(
            ECDSA.recover(_resultDigest(id, winner, deadline), signature) ==
                arbiter,
            "bad signature"
        );

        m.status = Status.Settled;

        uint256 pot = m.stake * 2;
        uint256 fee = (pot * feeBps) / 10000;
        uint256 prize = pot - fee;

        emit Settled(id, winner, prize, fee);
        _pay(id, platformWallet, fee);
        _pay(id, winner, prize);
    }

    // --------------------------------------------------------------------- //
    //                             REEMBOLSOS                                //
    // --------------------------------------------------------------------- //
    // Ningun camino puede dejar plata trabada para siempre: cada uno devuelve
    // EXACTAMENTE el stake a cada jugador que deposito.

    /// @notice Si el plazo de deposito vencio sin llenarse, cada uno recupera lo suyo.
    function refundUnfunded(bytes32 id) external nonReentrant {
        Match storage m = matches[id];
        require(m.status == Status.Open, "not open");
        require(block.timestamp > m.fundDeadline, "not expired");

        m.status = Status.Refunded;
        emit Refunded(id);
        _refundPaid(id, m);
    }

    /// @notice Si se lleno pero paso el plazo de juego sin liquidar (ej: nadie
    ///         jugo), pasada la gracia se devuelve todo a ambos.
    function refundExpired(bytes32 id) external nonReentrant {
        Match storage m = matches[id];
        require(m.status == Status.Funded, "not funded");
        // Recien tras playDeadline + gracia: le da al arbitro una ventana firme
        // para liquidar un resultado real y evita que el perdedor front-runnee un
        // settle tardio para escapar de la derrota (ver REFUND_GRACE).
        require(
            block.timestamp > uint256(m.playDeadline) + REFUND_GRACE,
            "not expired"
        );

        m.status = Status.Refunded;
        emit Refunded(id);
        _refundPaid(id, m);
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
        emit Refunded(id);
        _refundPaid(id, m);
    }

    function _refundPaid(bytes32 id, Match storage m) internal {
        if (m.p1Paid) _pay(id, m.p1, m.stake);
        if (m.p2Paid) _pay(id, m.p2, m.stake);
    }

    // --------------------------------------------------------------------- //
    //                          PAGOS Y RETIROS                              //
    // --------------------------------------------------------------------- //
    // El USDC de Circle revierte una transferencia a (o desde) una direccion de
    // su blacklist, y tambien cualquier transferencia mientras el token esta en
    // pausa. Con los pagos empujados juntos, UN jugador en la blacklist hacia
    // revertir la liquidacion o el reembolso entero, y la plata del otro
    // quedaba trabada para siempre. Ahora cada pago va por su cuenta, y el que
    // el USDC rechaza queda acreditado a su dueño.

    /// @dev Un pago de la partida `id`: se empuja, y si el USDC lo rechaza queda
    ///      acreditado en `owed[to]`. Lo llaman solo funciones `nonReentrant`,
    ///      con el estado de la partida ya cerrado (Settled/Refunded) ANTES del
    ///      primer envio.
    function _pay(bytes32 id, address to, uint256 amount) internal {
        if (amount == 0) return;
        uint256 gasBefore = gasleft();
        if (usdc.trySafeTransfer(to, amount)) return;
        // Un envio que se quedo SIN GAS deja a este contrato con menos de 1/64
        // del gas que tenia antes de llamar (EIP-150). Eso no es un rechazo del
        // USDC: es quien llamo (settle y dos de los reembolsos son
        // permissionless) mandando gas justo para convertir el pago de otro en
        // un credito. Se revierte todo. Es el mismo chequeo que
        // `ERC2771Forwarder` de OpenZeppelin.
        require(gasleft() >= gasBefore / 63, "insufficient gas");
        owed[to] += amount;
        emit Credited(id, to, amount);
    }

    /// @notice Cobra lo que `msg.sender` tiene acreditado.
    function withdraw() external nonReentrant {
        _withdraw(msg.sender);
    }

    /// @notice Le entrega a `account` lo que tiene acreditado. Cualquiera puede
    ///         llamarla (el arbitro, por ejemplo, cuando el USDC sale de su
    ///         pausa): la plata sale SOLO hacia `account`, nunca hacia quien
    ///         llama. Una direccion que sigue en la blacklist no cobra, y su
    ///         credito queda intacto (el revert deshace el cero).
    function withdrawFor(address account) external nonReentrant {
        _withdraw(account);
    }

    function _withdraw(address account) internal {
        uint256 amount = owed[account];
        require(amount > 0, "nothing owed");
        owed[account] = 0;
        emit Withdrawn(account, amount);
        usdc.safeTransfer(account, amount);
    }

    // --------------------------------------------------------------------- //
    //                              VISTAS                                   //
    // --------------------------------------------------------------------- //

    /// @notice Hash EIP-712 que el arbitro firma como resultado (util para el
    ///         backend/tests).
    function resultDigest(
        bytes32 id,
        address winner,
        uint64 deadline
    ) external view returns (bytes32) {
        return _resultDigest(id, winner, deadline);
    }

    /// @notice Hash EIP-712 del asiento que el arbitro firma para autorizar a
    ///         `player` a depositar en la partida `id` con esas condiciones
    ///         (util para backend/tests).
    function seatDigest(
        bytes32 id,
        address player,
        uint256 stake,
        uint64 fundDeadline,
        uint64 playDeadline
    ) external view returns (bytes32) {
        return _seatDigest(id, player, stake, fundDeadline, playDeadline);
    }

    // --------------------------------------------------------------------- //
    //                              INTERNOS                                 //
    // --------------------------------------------------------------------- //
    // Cada digest tiene UNA sola copia, compartida por su vista publica y por
    // el chequeo: un drift entre dos copias haria que un chequeo offchain contra
    // la vista pasara mientras el contrato rechaza en produccion.

    function _resultDigest(
        bytes32 id,
        address winner,
        uint64 deadline
    ) internal view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(abi.encode(RESULT_TYPEHASH, id, winner, deadline))
            );
    }

    function _seatDigest(
        bytes32 id,
        address player,
        uint256 stake,
        uint64 fundDeadline,
        uint64 playDeadline
    ) internal view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        SEAT_TYPEHASH,
                        id,
                        player,
                        stake,
                        fundDeadline,
                        playDeadline
                    )
                )
            );
    }

    /// @dev Verifica que el arbitro haya firmado el asiento. Revierte si no.
    function _requireSeat(
        bytes32 id,
        address player,
        uint256 stake,
        uint64 fundDeadline,
        uint64 playDeadline,
        bytes calldata seatSig
    ) internal view {
        bytes32 digest = _seatDigest(
            id,
            player,
            stake,
            fundDeadline,
            playDeadline
        );
        require(ECDSA.recover(digest, seatSig) == arbiter, "bad seat");
    }
}
