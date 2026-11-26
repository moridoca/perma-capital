# Governance: everything adjustable, nothing silently

Design for making the whole platform governable. Status: proposal, 26 Nov 2026.
Nothing here is implemented yet except the valuation process (section 5), which is.

## 1. Principle

Every number and every piece of logic can change. Nobody can change anything alone,
quickly, or unseen:

    GP proposes  ->  holders vote  ->  timelock  ->  anyone executes
       (on-chain)     (tokens locked)   (exit window)

- **Only the GP proposes.** The work before a proposal (discussion in Discord, expert
  opinions, an audit) happens off-chain; the proposal carries a hash of that document.
  Holders do not draft proposals, they approve or reject them.
- **Holders decide.** Votes are cast by locking tokens, as in the existing votes.
- **Timelock.** An approved change waits before it takes effect. Holders who disagree
  can sell into the ladder in that time. This exit window is what makes "the majority
  decides" acceptable to the minority.
- **Anyone executes** once the timelock has run, so the GP cannot sit on an approved change.

Two exceptions to "only the GP proposes", both because otherwise the GP would be judge
in his own case:

1. **Removing the GP**: any holder can start that vote (as today).
2. **Disputing a valuation**: any holder can dispute with a bond (section 5).

## 2. Three classes of change

| Class | Examples | Approval | Timelock (prod) |
|---|---|---|---|
| Parameter | reserve %, taker fee, ladder step, vault profit share | > 50% of votes cast, quorum 20% of eligible supply | 7 days |
| Constitutional | the bounds of a parameter, quorum, thresholds, timelock lengths | >= 2/3 of votes cast, quorum 33% | 14 days |
| Code upgrade | a new OrderBook, Vault, valuation module | >= 2/3 of votes cast, quorum 33%, audit hash required | 14 days |

Quorum, majorities and timelocks are themselves constitutional parameters.

## 3. The core that does not change

Three rules sit in contracts that are not upgradeable. They protect the minority from
a majority (a whale, or a GP voting through wallets he controls):

1. **The token contract is final.** Nobody can move, freeze or burn tokens a holder owns.
2. **The treasury pays out only by rule**: investments up to free cash (as today),
   the ladder, dividends pro rata to all holders, bonds back to whoever posted them.
   No governance decision can send fund money to an address of its choosing.
3. **The timelock has a floor**: at least 2 days in production, whatever governance decides.

Everything else is a module the treasury talks to and can be replaced.

Without this core, a 51% vote could empty the vault and the other 49% would have no
remedy: no exit window helps if the ladder's cash is what gets taken.

## 4. Architecture

    UmbrellaFactory ─ Governor (one per umbrella)
                        ├─ ParamRegistry   key -> value, min, max, max step per vote, class
                        ├─ Timelock        queue, earliest execution, execute
                        └─ ModuleRegistry  current implementation of each module + audit hash

    per sub-fund:
      FundToken   (final)        holders' balances
      Treasury    (final)        all mUSDC; pays out by rule only
      SubFund     (module)       sale, NAV, fee, surplus, votes on its own scope
      OrderBook   (module)       ladder and holders' orders
      Valuation   (module)       proposals, bonds, disputes (section 5)

    platform-wide modules: VaultFactory, TradingAccountFactory

- Modules read parameters from the ParamRegistry. To keep trading gas low, a module keeps
  a local copy that the Timelock pushes on change (`sync`), rather than reading the
  registry on every trade.
- An upgrade replaces a module behind a proxy (ERC-1967). The Treasury only accepts calls
  from the modules the ModuleRegistry names, so a replaced module loses access at once.
- The audit hash is a required field of every upgrade proposal: the dashboard shows it
  next to the code hash of the new implementation.

### Who votes on what

| Scope | Voters | Weight |
|---|---|---|
| One sub-fund (its ladder, fee, reserve, valuation, issuance) | that sub-fund's holders | tokens |
| The platform (vault rules, trading-account rules, new sub-funds, platform fees, code of shared modules) | holders of all sub-funds | tokens x NAV per token of their sub-fund |

Weighting by NAV makes one dollar one vote across sub-funds. The NAV used is the one in
force when the vote opens, so a revaluation during the vote does not shift weights.

## 5. Valuation (implemented)

The GP no longer sets the portfolio value directly.

| Step | Rule |
|---|---|
| Proposal | GP: `proposeMark(value, reportHash, memo)`, bond 1% of the value (at least 10 mUSDC) |
| Window | one voting period; nothing changes in the meantime, no capital deployed or returned |
| Undisputed | anyone calls `resolveMark()`: value applies, report hash stored, bond back |
| Dispute | any holder except the GP: `disputeMark()`, posting the same bond |
| Vote | holders lock tokens for or against (`voteMark`) for one more voting period |
| Result | more tokens for than against applies the value; a tie or no votes rejects it; the winner receives both bonds |
| Proceeds | `returnProceeds` can only lower the portfolio value, by at most the cash returned |

Bonds sit in the vault but are excluded from net assets and from free cash.

Bond size, minimum bond and window length become parameters in phase 1.

## 6. What becomes a parameter

Current fixed values and proposed bounds. Bounds are constitutional, the value is a parameter.

| Module | Parameter | Today | Bounds |
|---|---|---|---|
| SubFund | Reserve target | 5% | 2–20%, step <= 2 pts |
| SubFund | Management fee | 2% of initial supply / year | 0–3% |
| SubFund | Fee lifetime cap | 10 tranches | 0–20 |
| SubFund | Vote threshold (issuance, surplus use) | > 50% of eligible supply | replaced by quorum + majority (section 2) |
| Valuation | Bond | 1%, min 10 mUSDC | 0.25–5% |
| Valuation | Dispute window / vote length | 1 voting period | 1–14 days |
| OrderBook | Rungs / step | 250 x 0.2% | step 0.05–1%, depth to -10% … -80% |
| OrderBook | Cash per zone | 40/30/20/10 | each zone 0–70%, sum 100% |
| OrderBook | Resale markup | 0.1% | 0.02–1% |
| OrderBook | Issue premium | NAV +0.2% | 0–2% |
| OrderBook | Taker fee | 0.07% | 0–0.5% |
| OrderBook | Smallest order | 1 token | 0.01–1,000 |
| Vault | Profit share | 10% | 0–30% |
| Vault | Leader minimum | 5% | 1–20% |
| Vault | Price bounds | NAV +5% / -55% | +0–20% / -30–90% |
| Vault | Max funds / orders | 6 / 8 | 1–12 / 1–16 (gas) |
| Vault | Lock | 1 day | 0–30 days |
| Vault | Opening minimum | 100 mUSDC | 0–100,000 |
| TradingAccount | Max session | 30 days | 1–90 days |
| Platform | Voting period, year length | fixed at deployment | constitutional |

Changing the ladder's shape (step, depth, zones) re-spreads the ladder's cash at the next
`topUpReserve`; tokens resting on rungs keep their resale price until sold.

## 7. Phases

| Phase | Content | Size |
|---|---|---|
| 0 | Valuation with bond and dispute | done |
| 1 | Governor, ParamRegistry, Timelock; every number in section 6 a parameter; dashboard "Govern" tab lists proposals with their document hash | large |
| 2 | Treasury split out of SubFund; modules behind proxies; ModuleRegistry; upgrade proposals with audit hash | large |
| 3 | Platform scope with NAV-weighted votes across sub-funds | medium |

Each phase ends with tests on the local chain and one redeployment.

## 8. Open points

- **Contract size.** SubFund's deployer is at 23,697 of 24,576 bytes. Phase 1 needs the
  split into modules anyway; until then nothing more fits into SubFund.
- **Gas.** Locking tokens to vote costs a transfer per voter. A snapshot-based vote
  (ERC20Votes) is cheaper for holders but needs checkpoints in the token, which is final:
  this has to be decided before the token is redeployed in phase 2.
- **Low turnout.** Quorum 20% may be hard to reach with spread-out holders. Delegation
  (holders delegate their vote) is the usual answer and comes with ERC20Votes.
- **The GP votes.** The GP cannot vote from his own wallet; nothing stops him voting
  through others. The 2/3 bar and the exit window are the protection, not identity checks.
