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

| Tab | What it shows |
|---|---|
| Home | The umbrella with every sub-fund, and the balance sheet of the selected one |
| Trade | Wallet balances, test mUSDC, the primary sale, buying and selling in the pool, the follow-on. Each trade shows the price it will leave behind before you send it |
| Rules | What the code enforces, each rule with its status right now: sale cap, fund-owned liquidity, buyback trigger, follow-on price, fee schedule, GP removal, and the one trust assumption |
| Manager | What only the GP can do: deploy capital, revalue the portfolio, open a follow-on, return proceeds |
| Govern | The vote to replace the GP |
| Activity | On-chain events, what this browser sent, and all contract addresses |

NAV per token, market price and the chart of both stay in view on a wide screen; on a phone
they are the top of the Home tab and a one-line strip elsewhere. Invested value is flagged
as GP-reported wherever it appears: it is the one number not verified on-chain.

The page suggests a tip of 0.05 gwei to the wallet. Sepolia's base fee is close to zero, so
the tip is the whole price, and MetaMask's default of 1.5 gwei costs 30 times as much.
Fonts are served from this repository (SIL Open Font License, see `docs/vendor/fonts`), so
the page makes no third-party request except to the Sepolia endpoints.

## A live walkthrough with one wallet

The numbers are from a run of exactly these steps on a local chain.

| Step | Tab and action | Result |
|---|---|---|
| 1 | Trade: get test mUSDC, 2,000,000 | Wallet funded |
| 2 | Trade: primary sale, 1,000,000 | 1,000,000 pBUY at $1.00 |
| 3 | Rules: close the sale (GP) | Market opens at $1.00; 52,632 pBUY + 52,632 mUSDC become fund-owned liquidity |
| 4 | Manager: deploy capital, 600,000 | NAV stays $1.00; vault cash 347,368 |
| 5 | Trade: sell in the pool, 5,000 | Market $0.8342, discount 16.6%; the buyback rule shows "triggered" |
| 6 | Rules: trigger the buyback (empty = maximum) | 3,474 mUSDC spent; market $0.9589, discount 4.1% |
| 7 | Manager: revalue the portfolio, 750,000 | NAV $1.1512; the discount widens to 16.7% and the buyback is triggered again |
| 8 | Rules, after one demo year: mint the fee tranche | 2% of supply in new tokens, locked in vesting |

The wallet that deployed the contracts is the GP of all three sub-funds. The GP cannot vote
on his own removal, so the governance steps need a second wallet that holds tokens.

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
