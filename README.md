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
| Perma Buyout (pBUY) | `0x078526Fd41949e907326378794EF47B56d145c47` |
| Perma Growth (pGRO) | `0x16F1De8877aB2A18eEFE1f49cf3bfDDFD0c469C6` |
| Perma Agriculture (pAGR) | `0x6D3494e3ab8B6819A6322d4a05D5c66F08cA12BD` |

Demo clock: one "year" is 300 seconds, a GP-removal vote stays open for 180 seconds.
Token, pool and vesting addresses are in `scripts/perma/sepolia-deployment.json`.

## The dashboard

It reads everything live from the contracts through public Sepolia endpoints, so it works
without a wallet. With MetaMask on Sepolia it can also send every transaction the contracts
offer; each one is checked against the contract first, and a refusal is shown with the
contract's own reason (for example "Fund: discount below trigger").

The interface follows the PERMA Testnet design: a terminal-style top bar with a fund
selector, five sections, and a tab bar on phones.

| Section | What it shows |
|---|---|
| Trade | The trading terminal of the selected fund: price and NAV, candles from on-chain trades, the depth of the pool, the trade tape, order entry with a quote, balances, trade history, treasury. While a fund is still in its primary sale, the order column holds the sale and the chart shows its progress |
| Funds | Every sub-fund under the umbrella. For the selected one: balance sheet, the rules the code enforces with their status right now, and what only the manager can do |
| Reports | A fund report built from chain data: statement of net assets, capital account since launch, investments and valuations, manager fee, your position, event log, contract addresses |
| Portfolio | The connected wallet: account value, holdings across all funds at market and at NAV, test mUSDC |
| Govern | Votes to replace a manager, the valuations the GP has reported, the manager of each fund |

**Fast trading.** Orders without a wallet pop-up, like an agent key on Hyperliquid, built so
that it would also hold for real money (`contracts/perma/TradingAccount.sol`):

- Your funds sit in a **trading account**, a contract that only your wallet owns. One
  MetaMask confirmation creates it and starts a session.
- A **session key** created in the browser signs orders for that account. It can only buy
  and sell in this umbrella's pools and primary sales, only until its expiry (at most 30
  days), only up to a volume cap, and only at prices the owner allows around NAV (default:
  buy at most 10% above NAV, sell at least 20% below NAV, checked after each trade).
- It can send funds back to the owner and nowhere else. It never holds funds itself,
  only a little gas, which comes along in the same confirmation.
- The owner can end a session at any time; each new session gets a new key.
- A stolen key can therefore cause at most bad trades within these limits until the
  session ends. It cannot withdraw.

GP actions and governance still go through MetaMask. The contract is a prototype and not audited.

What the page does not pretend:

- **A pool has no order book.** The depth panel shows how much the pool trades before its
  price reaches each level, which is what an order book would tell you.
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
| 5 | Trade: sell 5,000 | Market $0.8342, discount 16.6%; the depth panel shows the buyback as triggered |
| 6 | Funds, Rules: trigger the buyback (empty = maximum) | 3,474 mUSDC spent; market $0.9589, discount 4.1% |
| 7 | Funds, Manager: revalue the portfolio, 750,000 | NAV $1.1512; the discount widens to 16.7% and the buyback is triggered again |
| 8 | Funds, Rules, after one demo year: mint the fee tranche | 2% of supply in new tokens, locked in vesting |

### Variant: sell out the whole sale first

Here the market only opens once all 9,500,000 tokens are sold, and then anyone (not just
the GP) can close the sale. Numbers from a local run with one non-GP wallet:

| Step | Where | Result |
|---|---|---|
| 1 | Portfolio: get test mUSDC, 9,500,000 | Wallet funded |
| 2 | Trade: primary sale, 9,500,000 | Sale sold out; the close button opens for every wallet |
| 3 | Trade: close the sale, open the market | 500,000 pBUY + 500,000 mUSDC become fund-owned liquidity; vault cash 9,000,000; NAV and price $1.00 |
| 4 | Trade: sell 30,000 | Market $0.8901, NAV $1.0002, discount 11.0%: buyback triggered |
| 5 | Funds, Rules: trigger the buyback, field empty | 28,328 mUSDC, price back to $1.0001 |

The pool is deeper here (500,000 instead of 52,632 tokens), so it takes a larger sale to
move the price. In step 5 the 1% limit would be 90,000 mUSDC, but the contract refuses
any buyback that ends above NAV. With the field empty, the dashboard therefore sends the
largest amount that stays at NAV.

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

Until step 4 the Arbitrum page says that nothing is deployed there yet.

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
