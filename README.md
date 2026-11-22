# Perma Capital

A tokenized permanent-capital fund as smart contracts: a private-equity umbrella with
separate sub-funds that are issued once and never wound up. University prototype.

**Live dashboard:** https://moridoca.github.io/perma-capital/

> Prototype on the Sepolia testnet. mUSDC is play money and the tokens have no value.
> Nothing here is an offer to invest. The contracts are not audited.

## What is in this repository

| Path | Content |
|---|---|
| `contracts/perma/` | The Solidity contracts and their own README with the rules the code enforces |
| `scripts/perma/demo.ts` | End-to-end demo for the Remix VM (about three minutes, several accounts) |
| `scripts/perma/deploy_sepolia.ts` | Deployment to Sepolia through MetaMask; refuses any other chain |
| `scripts/perma/sepolia-deployment.json` | All addresses of the live deployment |
| `docs/` | The dashboard: one static page, no backend, no build step (served by GitHub Pages) |

## Live deployment (Sepolia, chain id 11155111)

| Contract | Address |
|---|---|
| UmbrellaFactory | `0x15690c82c8aabda3F5689157ebF637A4F5c8e672` |
| MockUSDC | `0x232dA8232534064007557E29A9186240c567B64D` |
| TradingAccountFactory (fast trading) | `0x8Da83E34460378F94f158C38697c7C93B75E51D4` |
| Perma Buyout (pBUY) | `0x078526Fd41949e907326378794EF47B56d145c47` |
| Perma Growth (pGRO) | `0x16F1De8877aB2A18eEFE1f49cf3bfDDFD0c469C6` |
| Perma Agriculture (pAGR) | `0x6D3494e3ab8B6819A6322d4a05D5c66F08cA12BD` |

Demo clock: one "year" is 300 seconds, a GP-removal vote stays open for 180 seconds.
Token, order book and vesting addresses are in `scripts/perma/sepolia-deployment.json`.

## The dashboard

It reads everything live from the contracts through public Sepolia endpoints, so it works
without a wallet. With MetaMask on Sepolia it can also send every transaction the contracts
offer; each one is checked against the contract first, and a refusal is shown with the
contract's own reason (for example "Fund: discount below trigger").

The interface follows the PERMA Testnet design: a terminal-style top bar with a fund
selector, five sections, and a tab bar on phones.

| Section | What it shows |
|---|---|
| Trade | The trading terminal of the selected fund: price and NAV, candles from on-chain trades, the order book, the trade tape, market and limit orders with a quote, open orders, balances, trade history, treasury. While a fund is still in its primary sale, the order column holds the sale and the chart shows its progress |
| Funds | Every sub-fund under the umbrella. For the selected one: balance sheet, the rules the code enforces with their status right now, and what only the manager can do |
| Reports | A fund report built from chain data: statement of net assets, capital account since launch, investments and valuations, manager fee, your position, event log, contract addresses |
| Portfolio | The connected wallet: account value, holdings across all funds at market and at NAV, test mUSDC |
| Govern | Votes to replace a manager, the valuations the GP has reported, the manager of each fund |

**Fast trading.** Orders without a wallet pop-up, like an agent key on Hyperliquid, built so
that it would also hold for real money (`contracts/perma/TradingAccount.sol`):

- Your funds sit in a **trading account**, a contract that only your wallet owns. One
  MetaMask confirmation creates it and starts a session.
- A **session key** created in the browser signs orders for that account. It can only buy
  and sell in this umbrella's order books (market and limit orders) and primary sales, only until its expiry (at most 30
  days), only up to a volume cap, and only at prices the owner allows around NAV (default:
  buy at most 10% above NAV, sell at least 20% below NAV; market orders are checked after
  the trade, limit orders by their limit price).
- It can send funds back to the owner and nowhere else. It never holds funds itself,
  only a little gas, which comes along in the same confirmation.
- The owner can end a session at any time; each new session gets a new key.
- A stolen key can therefore cause at most bad trades within these limits until the
  session ends. It cannot withdraw.

GP actions and governance still go through MetaMask. The contract is a prototype and not audited.

What the page does not pretend:

- **The book has no matching engine.** A taker names the resting orders it trades against,
  best price first, and the contract takes the better of order and ladder rung at every
  step. The dashboard does this for you. A resting order is only filled when someone takes
  it, so after a NAV change a holder's order can sit on the wrong side of the ladder until
  a taker picks it up.
- **There are no company-level statements on-chain.** The contracts hold one number for the
  whole portfolio and a memo per transaction, so the report shows exactly that. Invested
  value is flagged as GP-reported wherever it appears.
- **Valuations cannot be disputed** in this prototype. The only check on the GP is removal
  by vote.

The page suggests a tip of 0.05 gwei to the wallet. Sepolia's base fee is close to zero, so
the tip is the whole price, and MetaMask's default of 1.5 gwei costs 30 times as much.
Fonts and the stylesheet are served from this repository (fonts under the SIL Open Font
License, see `docs/vendor/fonts`), so the page makes no third-party request except to the
Sepolia endpoints.

## A live walkthrough with one wallet

The numbers are from a run of exactly these steps on a local chain.

| Step | Where | Result |
|---|---|---|
| 1 | Portfolio: get test mUSDC, 2,000,000 | Wallet funded |
| 2 | Trade: primary sale, 1,000,000 | 1,000,000 pBUY at $1.00 |
| 3 | Trade: close the sale, open the market (GP) | Market opens at $1.00; 52,632 pBUY + 52,632 mUSDC become fund-owned liquidity |
| 4 | Funds, Manager: deploy capital, 600,000 | NAV stays $1.00; vault cash 347,368 |
| 5 | Trade: buy for 5,000 mUSDC | 4,947 pBUY at an average of $1.0107: the first rung of the ladder, NAV +1%, plus the 0.07% fee. Market $1.0101 |
| 6 | Trade: Limit, sell 10,000 at 1.0250 | Rests in the book between the ladder's rungs, marked "you"; listed under Open orders |
| 7 | Trade: Market, sell 60,000 | Fills all ten bids of the ladder at an average of $0.9494. Market $0.9029, NAV $1.0033, discount 10.0%: buyback triggered |
| 8 | Funds, Rules: trigger the buyback (empty = maximum) | 3,474 mUSDC from the vault buy 3,845 pBUY off the lowest rung and burn them; the cash now bids there |
| 9 | Funds, Manager: revalue the portfolio, 750,000 | NAV $1.1620. Every rung moves with it, the market to $1.0458. The limit order at $1.0250 keeps its price and is now the cheapest offer in the book |
| 10 | Funds, Rules, after one demo year: mint the fee tranche | 2% of supply in new tokens, locked in vesting |

### Variant: sell out the whole sale first

Here the market only opens once all 9,500,000 tokens are sold, and then anyone (not just
the GP) can close the sale. Numbers from a local run with one non-GP wallet:

| Step | Where | Result |
|---|---|---|
| 1 | Portfolio: get test mUSDC, 9,500,000 | Wallet funded |
| 2 | Trade: primary sale, 9,500,000 | Sale sold out; the close button opens for every wallet |
| 3 | Trade: close the sale, open the market | 500,000 pBUY + 500,000 mUSDC become fund-owned liquidity; vault cash 9,000,000; NAV and price $1.00 |
| 4 | Trade: sell 600,000 | The book takes 529,590 pBUY at an average of $0.9435, the rest stays in the wallet. Market $0.9030, NAV $1.0033, discount 10.0%: buyback triggered |
| 5 | Funds, Rules: trigger the buyback, field empty | 90,004 mUSDC (1% of vault cash) buy and burn 99,118 pBUY; market up one rung to $0.9130 |

The ladder is deeper here: 50,000 mUSDC on each bid rung instead of 5,263, so it takes a
larger sale to reach the bottom. The buyback buys at the lowest prices on offer, which are
never above NAV once the market sits at the bottom of the ladder.

The contract does not force a sell-out: the GP can still close early once anything is
sold. Enforcing it would mean changing `closeSale` and deploying again.

The wallet that deployed the contracts is the GP of all three sub-funds. The GP cannot vote
on his own removal, so the governance steps need a second wallet that holds tokens.

## Second network: Arbitrum Sepolia

Same contracts on Arbitrum's testnet, where a block comes every ~0.3 s instead of every
12 s on Sepolia. The chip next to the logo switches between the two deployments
(`?net=sepolia`, `?net=arbitrum`), so both can be compared side by side; the log shows
how long each transaction took.

1. MetaMask: the dashboard offers to add Arbitrum Sepolia (chain id 421614) when you press
   "Switch network" on `?net=arbitrum`.
2. Get ETH on Arbitrum Sepolia from a faucet, or bridge SepoliaETH at
   [bridge.arbitrum.io](https://bridge.arbitrum.io).
3. Remix: compile as before, MetaMask on Arbitrum Sepolia, run
   `scripts/perma/deploy_arbitrum_sepolia.ts` (7 confirmations). The script stops on any
   other chain.
4. Enter the printed umbrella, mUSDC and deploy block under `arbitrum` in `docs/config.js`.

Deployed on 22 Nov 2026 (block 331,513,588). The deployer used the same nonces as on
Sepolia, so umbrella, mUSDC and the three sub-funds have the same addresses on both
networks; only the TradingAccountFactory differs (`0x12acA0B765732b7db6484bf8844bBD21d394e3bF`).
All addresses: `scripts/perma/arbitrum-sepolia-deployment.json`. The whole deployment
(8 transactions) cost about 0.00045 ETH.

## Running it yourself

- **Remix VM**: follow `contracts/perma/README.md`, then run `scripts/perma/demo.ts`.
- **Sepolia**: empty the four `EXISTING` addresses in `scripts/perma/deploy_sepolia.ts`, run it
  in Remix with MetaMask on Sepolia, then put the new umbrella, mUSDC and block number into
  `docs/config.js`.
- **Dashboard locally**: serve the `docs` folder over http (for example
  `python3 -m http.server --directory docs`). MetaMask does not work on pages opened as files.

Contract code is expensive on Sepolia: the full deployment used roughly 150 million gas,
about 1,560 gas per byte of contract code.

## Known limits

See `contracts/perma/README.md`. In short: the GP-reported investment value is a trust
assumption, the buyback can be front-run within its 1% cap, there is no whitelist and no
identity check, and nothing has been audited.
