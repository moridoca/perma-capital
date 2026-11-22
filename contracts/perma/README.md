# Perma Capital - tokenized permanent-capital fund (prototype)

A private-equity umbrella fund as smart contracts. Each sub-fund is issued once
and never wound up: no capital calls, no redemptions, no distributions.
Profits stay in the fund and raise NAV per token. Investors exit by selling
their tokens in the sub-fund's own on-chain order book.

Prototype for the Remix VM and testnets. mUSDC is play money.

## Contracts

| File | Role |
|---|---|
| UmbrellaFactory.sol | The umbrella. Launches sub-funds and lists them. One call, overview(i), returns addresses, NAV, market price and premium/discount. |
| SubFund.sol | One sub-fund: primary sale, vault, NAV, fee, buyback, follow-on issuance, GP removal vote. |
| FundToken.sol | The sub-fund's share token. Freely transferable ERC-20; only the sub-fund can mint. |
| OrderBook.sol | Secondary market. The fund's liquidity as a ladder of 20 rungs in 1% steps around NAV, plus holders' limit orders. 0.07% taker fee, paid to the fund. |
| GPVesting.sol | Holds the manager's fee tokens until they vest. |
| Deployers.sol | Two helpers that keep every contract under the 24 KB size limit (EIP-170). |
| MockUSDC.sol | Test stablecoin with a public faucet. |
| ERC20.sol | Minimal ERC-20 base, 6 decimals. No external imports. |

All amounts use 6 decimals, like USDC: 1 token = 1000000, $1.00 = 1000000.

## The rules the code enforces

| Rule | Value | Where |
|---|---|---|
| Primary sale price | $1.00, fixed | SubFund.buy |
| Sale cap | 9,500,000 tokens | SALE_CAP |
| Fund-owned liquidity | sold / 19 tokens plus the same amount of mUSDC, i.e. 5% of total supply; cannot be withdrawn | closeSale |
| Ladder | ten ask rungs at NAV +1% to +10% with the tokens, ten bid rungs at NAV -1% to -10% with the cash, equal sizes; prices follow NAV | OrderBook.seed, ladder |
| Taker fee | 0.07% of the mUSDC traded, paid to the fund's vault; resting orders pay nothing | TAKER_FEE_BPS |
| Total supply at launch | 10,000,000 if sold out | initialSupply |
| Management fee | 2% of initial supply per year, paid in new tokens (200,000) | mintManagementFee |
| Fee lifetime cap | 10 tranches (2,000,000 tokens), then never again | FEE_YEARS_CAP |
| Fee lock-up | each tranche unlocks one year after minting | GPVesting |
| Buyback trigger | market price at 10% below NAV, the bottom of the ladder | buyback |
| Buyback size | at most 1% of vault cash per execution, one per week, anyone can trigger | buyback |
| Follow-on issue price | the higher of NAV and market price | issuePrice |
| GP removal | more than 50% of eligible supply votes yes; unvested fee tokens are burned | executeRemoveGP |
| Eligible supply | total supply minus unvested fee tokens, the fund's own tokens on the ladder and the GP's wallet | eligibleSupply |

## NAV

    NAV per token = (vault cash + the fund's cash on the ladder + investedValue) / outstanding supply

- Vault cash and the ladder's cash are read on-chain.
- investedValue is reported by the GP (deployCapital books at cost,
  markInvestments revalues). This is the one trust assumption of the model.
- Outstanding supply excludes the fund's own tokens on the ladder (treasury stock).

Market price and NAV are two separate numbers. The ladder keeps them within
10% of each other as long as it has stock on the side that is being taken;
beyond that, only holders' orders trade. premiumBps() shows the gap. The
buyback rule and the follow-on rule lean against it, from below and from above.

## The order book

The fund is its own market maker. Its liquidity sits on 20 rungs:

    bids   NAV -1%, -2%, ... -10%     one tenth of the cash on each
    asks   NAV +1%, +2%, ... +10%     one tenth of the tokens on each

- Rung prices are computed from navPerToken() at the moment of a trade. When
  NAV changes, the whole ladder moves; nobody has to re-quote it.
- A rung that sold tokens holds the cash and bids it at the same price; a rung
  that bought tokens offers them at the same price. Inside the band the price
  is therefore found by trading, and a round trip costs the fund nothing and
  earns it the fee twice.
- Holders place limit orders at any fixed price (limitBuy, limitSell, cancel).
  A limit order first takes whatever the book offers at its price or better,
  the rest waits in the book. The smallest resting order is 1 token.
- Market orders are buy(usdcIn, minTokenOut, ids) and sell(tokenIn,
  minUSDCOut, ids). ids are the resting orders to trade against, best price
  first; the book takes the better price at every step, order or rung, and a
  holder's order goes first at the same price. quoteBuy and quoteSell return
  what a market order would do.
- marketPrice() is the middle between the ladder's best bid and best ask.
  Holders' orders do not count, so posting an order cannot move it.

Compared with the constant-product pool this replaces: 5% of supply in a
pool moved the price by about 19% for an order of 1% of the fund. On the
ladder the same order moves it by about 1.5%.

## Run the demo

1. Solidity compiler tab: turn on optimization (200 runs), then compile every
   .sol file in contracts/perma once. Remix only writes the artifact (ABI) for
   the file you compile, not for the files it imports.
2. Deploy & Run tab: environment Remix VM.
3. Right-click scripts/perma/demo.ts and choose Run.

The script uses a 60-second "year" and a 90-second voting period so that fee,
vesting and governance can be shown live. It takes about three minutes.

## Deploy by hand

1. Deploy MockUSDC.
2. Deploy ComponentDeployer.
3. Deploy SubFundDeployer(componentDeployer).
4. Deploy UmbrellaFactory(usdc, subFundDeployer, yearSeconds, votingSeconds).
   Production: 31536000 and 604800. For clicking through by hand: 300 and 180.
5. createSubFund("Perma Buyout", "pBUY"), then overview(0) for the addresses.
6. Load SubFund, FundToken, OrderBook, GPVesting with "At Address".

Investors approve mUSDC to the SubFund before buy, and mUSDC or the token to
the order book before trading.

## Known limits

- GP-reported investment value is not verified on-chain.
- The ladder is quoted around the GP-reported NAV. A valuation that is too
  high lets holders sell to the fund's bids at too high a price, one that is
  too low lets buyers take its tokens too cheaply. What is exposed is the
  liquidity in the book, 5% of the fund, not the vault.
- Whoever sees a revaluation first can trade against orders that are still
  priced for the old NAV. For the ladder this is harmless (it moves in the same
  transaction); for holders' resting orders it is the usual risk of a limit
  order.
- There is no matching engine. Two resting orders that cross are not matched
  until a taker trades against them, and a taker who names no orders trades
  with the ladder only.
- The buyback buys at the bottom of the ladder. A sale into the book right
  before buyback() can profit from it (MEV); the 1% cap bounds the damage.
- The GP cannot vote from his own wallet, but nothing stops him from moving
  vested tokens to another wallet first.
- No whitelist and no identity checks. That is deliberate for a prototype that
  studies the economics; a fund sold to real investors needs both.
- Not audited.
