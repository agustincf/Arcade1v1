# Escrow1v1 — audit brief

> For the external auditor. Spanish summary for the project:
> [`docs/auditorias/2026-10-02-preauditoria-escrow1v1.md`](../../docs/auditorias/2026-10-02-preauditoria-escrow1v1.md).
> Everything still missing for mainnet: [`docs/MAINNET.md`](../../docs/MAINNET.md).

Arcade1v1 is a 1v1 skill arena: two players (humans or AI agents) stake the
same amount of USDC, each plays an off-chain game, an off-chain **arbiter**
verifies both runs by replay and signs the winner, and `Escrow1v1` pays the
pot minus a platform fee. This contract will hold real USDC on **Base
mainnet**. It is the only contract in scope.

## 1. Scope

| Item         | Value                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| In scope     | `packages/contracts/src/Escrow1v1.sol` (single contract, ~320 lines of code without comments or blank lines)                                           |
| Commit       | the commit tagged `escrow1v1-audit` (set when the audit is contracted); the audited build's creation-code hash is then pinned in `build-aprobada.json` |
| Compiler     | solc **0.8.24** (pinned), optimizer **200 runs**, **no** `via_ir`, `evm_version = cancun`                                                              |
| Dependencies | OpenZeppelin Contracts **5.6.1**: `Ownable2Step`, `ReentrancyGuard`, `EIP712`, `ECDSA`, `SafeERC20`, `IERC20`                                          |
| Target chain | Base mainnet (chain id 8453)                                                                                                                           |
| Token        | Circle USDC on Base, `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (`FiatTokenProxy` → `FiatTokenV2_2`: 6 decimals, blacklist, pause, upgradeable)      |
| Tables       | 1, 2, 5 and 10 USDC per player                                                                                                                         |
| Fee          | 1500 bps (15% of the pot), hard cap 2000 (`MAX_FEE_BPS`)                                                                                               |
| Owner        | a Safe multisig, via `Ownable2Step` (deployed by a Ledger, then handed over)                                                                           |

**Out of scope:** `EscrowAleph.sol` (the multi-agent money tables stay on
testnet; it will be audited separately if they ever go to mainnet),
`TestUSDC.sol`, the deploy scripts, and the off-chain arbiter (described in §3
as a trust assumption, because the contract relies on what it signs).

## 2. How it works

```
            arbiter signs Seat(id, player, stake, fundDeadline, playDeadline)
                 │                                  │
   p1: open(id, stake, deadlines, seat)   p2: join(id, seat)
                 │                                  │
     None ──────► Open ───────────────────────────► Funded
                   │  refundUnfunded (anyone,         │ settle(id, winner, deadline, sig)
                   │   after fundDeadline)            │   (anyone; arbiter submits it)  ──► Settled
                   │  cancelMatch (arbiter/owner)     │ refundExpired (anyone,
                   ▼                                  │   after playDeadline + 30 min) ──► Refunded
               Refunded ◄─────────────────────────────┘ cancelMatch (arbiter/owner)  ──► Refunded
```

- **Seat** (EIP-712 `Seat(bytes32 matchId,address player,uint256 stake,uint64 fundDeadline,uint64 playDeadline)`):
  the arbiter authorizes one address to deposit into one match with fixed
  terms. `open` checks the seat against the terms passed in; `join` checks it
  against the terms stored at `open`. The arbiter never pays gas to create a
  match; each player deposits its own stake (`safeTransferFrom` of exactly
  `stake`).
- **Result** (EIP-712 `Result(bytes32 matchId,address winner,uint64 deadline)`):
  the arbiter's decision. `settle` requires `Funded`, `now <= deadline`,
  `deadline <= playDeadline + REFUND_GRACE`, `winner ∈ {p1, p2}` and the
  arbiter's signature. It pays `fee = 2·stake·feeBps / 10000` to
  `platformWallet` and `2·stake − fee` to the winner. `feeBps` is the value
  **frozen at `open`** (`Match.frozenFeeBps`).
- **Refunds** return exactly the stake to each player that deposited.
- **Payments** (`_pay`) are pushed one by one with a **fixed gas budget**
  (`PAY_GAS = 300_000`). A transfer that fails within the budget (blacklisted
  payee or escrow, paused token, a revert, a `false` return, or running out of
  the budget) is **credited** to `owed[payee]` (`Credited` event) and the rest
  of the exit proceeds. A caller that cannot provide the budget gets a revert
  (`insufficient gas`) and nothing changes. The transfer itself
  (`_tryTransfer`) is OpenZeppelin 5.6.1 `SafeERC20._safeTransfer(token, to,
value, bubble=false)` copied verbatim with one change: the `CALL` gets
  `PAY_GAS` instead of `gas()`; like the original it copies at most 32 bytes of
  returndata. `withdraw()` / `withdrawFor(a)` deliver credits with all
  available gas and revert (credit intact) if USDC refuses.
- Domain: `EIP712("Arcade1v1Escrow", "2")`. Signatures are bound to the chain
  id and the contract address.

## 3. Roles and trust

**Players** trust nothing but the contract and the three parties below.

**Arbiter** (hot key in a Node/viem backend, `apps/server/src`). The contract
trusts it to decide who won and whom to seat. Its policy today (verified in
code, `apps/server/src/matchmaking.ts`):

- match ids are 32 random bytes (`crypto.randomBytes`);
- seat terms are frozen when the waiting match is created:
  `fundDeadline = t0 + 70 min`, `playDeadline = t0 + max(SUBMIT_WINDOW, 71 min)`
  (default `SUBMIT_WINDOW` = 2 h); p1's seat is signed at matchmake, p2's at
  pairing;
- one decision per match: the result is decided once and signed; the
  decision and its signature are flushed to the arbiter's store (Redis in
  production; not yet enforced for the 1v1 paid tables, see F7/W9 in
  `docs/MAINNET.md`) **before** the signature is shown in any view or sent in a
  transaction. If signing fails, the match currently stays decided without a
  signature (INT-1/W5). The signed deadline is exactly
  `playDeadline + REFUND_GRACE`;
- it submits `settle` itself with retries; it calls `cancelMatch` for ties,
  for results whose deadline passed unsettled, and for expired matches.

What a **compromised arbiter key** can do (tested in
`test/Escrow1v1.preauditoria.t.sol`, blocks 3 and 7, and by the invariant suite):

- sit itself in every **Open** match (all it needs is public in `matches(id)`)
  and sign itself the win: the victim loses its stake. Loss is bounded by the
  stakes in Open matches (≤ 10 USDC each). This is inherent to asynchronous
  pairing: the rival is unknown when p1 opens;
- choose either player as the winner of a **Funded** match, or cancel it
  (refund both). It **cannot** redirect a Funded match to a third address, touch
  `owed`, or lock a deposit for longer than `MAX_MATCH_DURATION` (2 days) +
  `REFUND_GRACE` (30 min) after `open`.

Mitigations are operational: KMS/HSM custody of the key, monitoring, and the
owner's `setArbiter`.

**Owner** (Safe). Powers: `setArbiter` (immediate), `setPlatformWallet` (not
the escrow nor the token), `setFeeBps` (≤ 20%, only for matches opened
afterwards), `setAllowedStake` (the entry brake: a disabled table blocks `open`
and `join`, never exits), `cancelMatch` (refund only), and the two-step
ownership transfer (`renounceOwnership` is disabled). There is no function that
moves player funds to an arbitrary address. The owner can make itself the
arbiter and then has the arbiter's powers above.

**Circle (USDC).** Can blacklist a player (its payments are credited and
withdrawable once lifted), pause the token (everything is credited), blacklist
the escrow itself (all custody frozen until lifted; no migration path), or
upgrade the token. The contract assumes exact-amount transfers (no
fee-on-transfer).

## 4. Invariants the test suite asserts

Stateful fuzzing (`test/invariant/`): a handler plays random sequences of
open / join / settle / refunds / cancel / withdraw with tight gas, clock jumps
(including landing exactly on deadlines), a token that blacklists, pauses and
has payees whose transfers cost 150k (within budget) and 400k (over budget),
an owner that changes fee, tables, platform wallet and arbiter, and an attacker
that tries every unauthorized path. After **every** call:

1. **Solvency:** `USDC.balanceOf(escrow) == Σ stakes in Open/Funded matches + Σ owed + stray donations`.
2. **Exact payouts:** every successful settle pays exactly `2·stake − fee` (fee
   frozen at open) to the winner and `fee` to the current platform wallet, and
   nothing to the loser; every refund returns exactly the stake to each
   depositor. "Paid" counts wallet balance plus credit.
3. **No forced credits:** a payee the token would accept within the budget is
   paid, never credited, whatever gas the caller sent; a payee over the budget
   is always credited.
4. **Liveness of each action:** a valid, timely settle / refund / cancel /
   withdraw never reverts with enough gas; a closed match never moves money
   again; forged, expired, late-deadline, old-key, wrong-state and
   unauthorized calls always revert.
5. **State integrity:** status and the stored terms (players, stake,
   deadlines, frozen fee) match the model; credits only go to players and
   platform wallets.
6. **Nothing stays locked** (`afterInvariant`): with USDC back to normal and
   the clock past every deadline, a third party with no permissions closes
   every match and delivers every credit; only stray donations remain.

## 5. Accepted risks and design decisions

| #   | Decision / risk                                                                                                                                                                                                             | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Compromised arbiter key takes Open matches (bounded, §3).                                                                                                                                                                   | Inherent to async pairing; mitigated by key custody and rotation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A2  | Rotating back to a previously used arbiter key revives its unexpired signatures.                                                                                                                                            | Operational rule: never reuse a retired key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A3  | Seats do not encode the role (p1/p2): either seated player may `open`.                                                                                                                                                      | Payouts are by address; harmless on-chain. Clients identify players by address.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A4  | No pause function. The brake is `setAllowedStake(x, false)` plus the arbiter not signing seats; exits are never blocked.                                                                                                    | A pause adds audit surface without stopping anything this does not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A5  | Circle trust (blacklist, pause, escrow blacklist, upgrades).                                                                                                                                                                | Inherent to USDC. A USDC upgrade can no longer turn the guard into a lock (see A6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A6  | `PAY_GAS = 300_000` is a hard-coded per-transfer gas budget.                                                                                                                                                                | The previous guard (`gasleft() >= gasBefore/63` after a failed transfer) does not hold behind a proxy: an out-of-gas inside the implementation leaves the caller ~2/64 (F-01), and a rejection that burns all forwarded gas reverted every exit paying that address (F-02). A fixed budget makes the outcome independent of the caller's gas. A real, **cold** USDC transfer to a fresh address needs 41,051 gas on a Base fork (block 51,972,000): ~7x headroom. If a future USDC or a gas repricing exceeds the budget, payouts become credits (never lost or locked). The fork canary (`test/fork/`, cold, requires ≥ 6x) **must be re-run on every `Upgraded` event of the USDC proxy**; watching for that event is an open operational item (`docs/MAINNET.md`, O4). |
| A7  | Exits need a call gas of up to ~380k with the real USDC, cold (`settle` measured at 380,865 on a Base fork; ~400k+ as a transaction limit with the 21k intrinsic and calldata).                                             | The token must be able to receive its full budget. Callers below get a clean `insufficient gas` revert and nothing changes. Gas actually used is unchanged (~100k). Always estimate; never hard-code a limit below ~420k.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A8  | `feeBps` is frozen per match at `open` (`Match.frozenFeeBps`).                                                                                                                                                              | Fee changes never affect matches in progress. Off-chain displays must change together with `setFeeBps`. Residual (A15): the player who opens cannot cap the fee.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A9  | USDC sent directly to the contract is unrecoverable (no sweep).                                                                                                                                                             | No owner path can move funds; it never affects accounting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A10 | Only 65-byte, low-s signatures (OpenZeppelin `ECDSA`).                                                                                                                                                                      | A KMS signer must normalize `s` and return `(r, s, v)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A11 | `settle` is permissionless; `withdrawFor` can be called by anyone.                                                                                                                                                          | Payouts never depend on who calls; funds only go to their owner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A12 | Fee rounding is floor; the winner gets `pot − fee`.                                                                                                                                                                         | Conservation is exact.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A13 | Deadlines use `block.timestamp` (Base's sequencer).                                                                                                                                                                         | Windows are minutes to hours; a few seconds of skew are irrelevant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A14 | The EIP-712 domain stays `("Arcade1v1Escrow", "2")` after the pre-audit revision.                                                                                                                                           | The signed messages did not change. Deployments are separated by address and chain id; the revision is identifiable on-chain by `PAY_GAS()` and `MAX_MATCH_DURATION()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A15 | `open` freezes the fee current when it lands: neither the Seat nor `open` carries a fee, so a `setFeeBps` (≤ 20%) mined just before a pending `open` applies to that player. The joiner sees the frozen fee before joining. | Accepted: the owner is a Safe, fee changes are rare and announced, and capping it would change `open`'s ABI (and the web) for little gain. An optional `maxFeeBps` argument is the fix if the auditor disagrees.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Known **off-chain** issues (the arbiter and the web, not in scope) are listed
in `docs/MAINNET.md` with their status; none requires a contract change.

## 6. Pre-audit review (what was already done)

- Two internal adversarial reviews with Foundry PoCs for every claim, five
  independent verifiers, three independent designs (minimal / robust /
  pragmatic) and a synthesis, plus a deploy/EIP-712 parity review and a fresh
  red-team pass. Report: `docs/auditorias/2026-10-02-preauditoria-escrow1v1.md`.
- Findings on the contract and their status:

| ID   | Finding                                                                                                                                                                                 | Status                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| F-01 | `_pay`'s 1/63 out-of-gas guard is bypassable behind a delegating proxy if the token's transfer is expensive (incl. via the arbiter's own `eth_estimateGas`).                            | **Fixed**: fixed `PAY_GAS` budget.                                            |
| F-02 | A token rejection that burns all forwarded gas made every exit paying that address revert.                                                                                              | **Fixed** (same change). Behind the real proxy it was a gas cost, not a lock. |
| F-03 | `settle` accepted a result deadline later than `playDeadline + REFUND_GRACE` (arbiter policy only), reopening the loser's front-run race.                                               | **Fixed**: on-chain cap.                                                      |
| F-04 | A compromised arbiter could sign seats with unbounded deadlines (only the owner's cancel released them).                                                                                | **Fixed**: `MAX_MATCH_DURATION`. The rest of F-04 is A1.                      |
| F-05 | The owner's fee change applied to matches in progress.                                                                                                                                  | **Fixed**: fee frozen at open. Owner → arbiter is A1.                         |
| F-06 | `platformWallet` could be the escrow or the token (fees stranded).                                                                                                                      | **Fixed**.                                                                    |
| F-07 | Seats are role-agnostic.                                                                                                                                                                | Accepted (A3); web fix off-chain.                                             |
| F-09 | High-s and 64-byte signatures are rejected.                                                                                                                                             | Accepted (A10), operational note.                                             |
| F-10 | Deploy scripts truncated `FEE_BPS` with `uint16()`.                                                                                                                                     | **Fixed** (scripts).                                                          |
| —    | Hygiene: initial configuration emitted as events, player/winner indexed in events, named constants, `setAllowedStake(0)` rejected, pragma pinned, NatSpec trust model stated precisely. | **Done**.                                                                     |

- Static analysis on the final source:
  - **Slither 0.11.6** (102 detectors): `timestamp` (5; expected: deadlines
    are the product) and `assembly` (1; `_tryTransfer`, OpenZeppelin's own
    code with a fixed gas budget). With an earlier, pure-Solidity
    `_tryTransfer` Slither also reported `return-bomb` (the full returndata was
    copied at the caller's expense) and `reentrancy-no-eth` (`owed` written
    after the call): the first was fixed by copying at most 32 bytes; the
    second is a false positive, since every entry point is `nonReentrant`, the
    match is closed before the first payment and USDC has no hooks
    (`test_SettleIsGuardedAgainstReentrancy` uses a reentrant token).
  - **Aderyn 0.6.8** (88 detectors): 0 high; 4 lows, all expected:
    centralization (owner = Safe, §3), large numeric literals (`10_000`,
    `300_000`), "unsafe ERC20 operation" (the OpenZeppelin copy in
    `_tryTransfer`), and a false "TODO" (the Spanish word _todo_, "everything",
    in comments). It also flagged two shadowed names, now renamed
    (`Match.frozenFeeBps`, `initialOwner`).
- Coverage (`forge coverage`, `Escrow1v1.sol`): **100%** of lines,
  statements, branches and functions.
- Invariants: 256 runs × 100 calls in every CI run; a deep pass of 2000 × 300
  (600,000 calls per invariant) is green.
- Mutation testing (`node packages/contracts/mutantes.mjs`): 30 realistic
  bugs planted one at a time; the suite (unit, pre-audit regressions and
  invariants, not the fork tests) must catch every one. Result: 30/30 detected.
- Exact budget (`test/Escrow1v1.presupuesto.t.sol`): for `refundUnfunded`
  (also behind a delegating proxy), `settle` with and without fee, and
  `refundExpired`, the scenario is built in `setUp` so the token is cold, and
  the caller's gas is swept one unit at a time from the minimum that works: in
  every successful run the token entered with the same gas (≥ 97% of
  `PAY_GAS`) and nobody was credited. Lowering the `+ 5_000` margin to
  `2_000` fails it.
- Real-USDC fork tests (`test/fork/`, Base block 51,972,000): happy path,
  blacklisted winner/player/escrow, paused token, gas sweeps of `settle` and
  `refundExpired` (never a forced credit, monotonic in gas), and, measured
  cold as in a real transaction, the transfer cost canary (41,051, must stay
  ≤ `PAY_GAS / 6`) and the gas a real `settle` needs (380,865, must stay
  < 400k).

## 7. Build and test

```bash
cd packages/contracts
# libraries (gitignored; the CI pins these exact versions)
git clone --depth 1 --branch v1.16.1 https://github.com/foundry-rs/forge-std lib/forge-std
git clone --depth 1 --branch v5.6.1 https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts

forge test                                         # unit + invariants (256 runs × 100 calls)
FOUNDRY_PROFILE=deep forge test --match-path 'test/invariant/*'   # 2000 × 300
BASE_RPC_URL=https://mainnet.base.org forge test --match-path 'test/fork/*'
node mutantes.mjs                                  # ~10 min (machine-dependent); every mutant must be detected
forge coverage --report summary --no-match-path 'test/fork/*'
```

Foundry: CI pins v1.8.3 (the review also ran on 1.7.1).

## 8. Questions for the auditor

1. Is the fixed per-transfer budget (`PAY_GAS = 300_000`, `require(gasleft() >= PAY_GAS*64/63 + 5_000)`,
   then `call{gas: PAY_GAS}`) sound on Base for all exit paths, and is the
   margin right? Any case where a healthy USDC payment can still be credited?
2. `_tryTransfer` is OpenZeppelin's `_safeTransfer` with `call(PAY_GAS, …)`.
   Is its success predicate (returned `true`, or empty returndata from a
   contract) the right one for USDC across future upgrades, including a
   returndata of 1–31 bytes, where `mload(0x00)` mixes in the calldata
   scratch?
3. Is the on-chain cap `deadline <= playDeadline + REFUND_GRACE` with the
   strict `now > playDeadline + REFUND_GRACE` for `refundExpired` free of any
   second where both or neither exit is valid?
4. Is `MAX_MATCH_DURATION = 2 days` checked against `block.timestamp` at
   `open` enough to bound every lock (including the joiner's deposit)?
5. Anything in the interaction of `Ownable2Step` with the overridden `pure`
   `renounceOwnership`?
6. Is relying on `ECDSA.recover` reverting (instead of returning `address(0)`)
   correct in every path, given `arbiter != address(0)` is enforced?
7. Any centralization concern beyond A1–A2 and the owner's powers in §3 that
   should be mitigated in code before launch?

## 9. Deployment plan

`deploy-base-mainnet.sh` (logic in `deploy-mainnet.ts`, rehearsed end to end on
a Base fork by `check-mainnet-deploy.sh`):

1. Pre-flight, before anything is signed: the compiled creation code must hash
   to the audited build pinned in `build-aprobada.json` (source, libraries,
   compiler and settings); clean tree, commit on `main`; chain 8453 and Circle
   USDC; the Safe answers `getThreshold`/`getOwners`; the Ledger and the
   arbiter are plain accounts (no code, no EIP-7702 delegation); enough ETH.
2. `script/DeployMainnet.s.sol`, signed by a Ledger: chain, USDC, fee (1500)
   and tables (1, 2, 5, 10 USDC) are constants of the script; it enables the
   tables, then `transferOwnership(safe)`; the source is verified on Basescan.
   The Safe then calls `acceptOwnership()`.
3. Read-back: the deployed runtime code equals the compiled one except the
   immutables, which are read back: `usdc()`, `arbiter()`, `platformWallet()`,
   `feeBps()`, `owner()`, `pendingOwner()`, `allowedStake(x)`,
   `eip712Domain()`; and the source is verified on Basescan.
4. Point the arbiter and the web at it (the arbiter cross-checks chain,
   `arbiter()`, `feeBps()` and `allowedStake` before opening paid tables);
   mainnet launches with the 1v1 only.

Security contact: <https://github.com/agustincf/Arcade1v1/security>.
