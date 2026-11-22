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
| SubFund.sol | One sub-fund: primary sale, vault, NAV, fee, buyback, issuance vote, GP removal vote. |
| FundToken.sol | The sub-fund's share token. Freely transferable ERC-20; only the sub-fund can mint. |
| OrderBook.sol | Secondary market. Below NAV the fund's cash on a ladder of 250 bid rungs in 0.2% steps down to NAV -50%, each reselling 0.1% higher; above NAV new issuance at NAV +0.2%; plus holders' limit orders. 0.07% taker fee, paid to the fund. |
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
| Fund-owned liquidity | 5% of the sale proceeds at the close; cannot be withdrawn. Later anyone can bring it back to 5% of net assets from vault cash (tokens on the ladder count at NAV) | closeSale, topUpReserve, RESERVE_BPS |
| Ladder | 250 bid rungs from NAV -0.2% to NAV -50% in 0.2% steps; 40% of the cash down to -10%, 30% from there to -20%, 20% to -40%, 10% to -50%; a rung offers what it bought 0.1% of NAV higher; prices follow NAV | OrderBook.seed, _weight, ladder |
| New issuance | only the amount holders approved by vote (GP proposes, more than 50% of eligible supply says yes); sold only in the order book, to anyone, at NAV +0.2% once nothing cheaper is on offer; payment goes to the vault | proposeIssuance, voteIssuance, executeIssuance, OrderBook.issuePrice |
| Taker fee | 0.07% of the mUSDC traded, paid to the fund's vault; resting orders pay nothing | TAKER_FEE_BPS |
| Total supply at launch | 9,500,000 if sold out | initialSupply |
| Management fee | 2% of initial supply per year, paid in new tokens (190,000) | mintManagementFee |
| Fee lifetime cap | 10 tranches (1,900,000 tokens), then never again | FEE_YEARS_CAP |
| Fee lock-up | each tranche unlocks one year after minting | GPVesting |
| Buyback trigger | market price 10% or more below NAV | BUYBACK_TRIGGER_BPS, buyback |
| Buyback size | at most 1% of vault cash per execution, one per week, anyone can trigger | buyback |
| GP removal | more than 50% of eligible supply votes yes; unvested fee tokens are burned | executeRemoveGP |
| Eligible supply | total supply minus unvested fee tokens, the fund's own tokens on the ladder and the GP's wallet | eligibleSupply |

## NAV

    NAV per token = (vault cash + the fund's cash on the ladder + investedValue) / outstanding supply

- Vault cash and the ladder's cash are read on-chain.
- investedValue is reported by the GP (deployCapital books at cost,
  markInvestments revalues). This is the one trust assumption of the model.
- Outstanding supply excludes the fund's own tokens on the ladder (treasury stock).

Market price and NAV are two separate numbers, but the fund keeps them close:
above NAV it issues new tokens at NAV +0.2% in the amount holders approved,
so the market cannot run away upwards while approved tokens last; below NAV its ladder bids down to NAV -50%, and from NAV -10% the buyback
rule leans against the discount as well. Below the ladder only holders' orders trade.

## The order book

The fund is its own market maker.

    NAV +0.2%          new tokens, as many as holders approved, money to the vault
    NAV                (nothing: the fund never trades at NAV itself)
    NAV -0.2% ... -10% 50 bids, 40% of the cash (0.8% on each)
    ... -20%           50 bids, 30% (0.6% on each)
    ... -40%           100 bids, 20% (0.2% on each)
    ... -50%           50 bids, 10% (0.2% on each)

- Rung prices are computed from navPerToken() at the moment of a trade. When
  NAV changes, the whole ladder and the issue price move; nobody re-quotes.
- The split of the cash over the four zones is one function, _weight, and a
  first setting: there is no trading data yet to calibrate it. Changing it
  means a new deployment.
- A trade reads and writes only the rungs it touches. The book remembers the
  rung where the market stands (edge), so a small order costs the same gas
  with 250 rungs as with 50 (about 186,000 for a market buy in the tests).
  ladder() returns all 250 rungs for the dashboard and is a view call.
- topUpReserve() places vault cash on the bids from the market downwards,
  each rung up to its share of the target, until the fund's liquidity is 5%
  of net assets again. Anyone can call it; it does nothing when the reserve
  is at its target.
- A rung that bought tokens offers them again 0.1% of NAV above its bid. A
  round trip therefore leaves the fund 0.1% plus the fee twice, and the profit
  stays on the rung as more cash to bid with.
- Buyers get the cheapest offer first: holders' sell orders and the rungs'
  resale offers, all below NAV +0.2%, and only then new tokens. Issuing above
  NAV raises NAV per token; it never dilutes holders.
- Holders place limit orders at any fixed price (limitBuy, limitSell, cancel).
  A limit order first takes whatever the book offers at its price or better,
  the rest waits in the book. The smallest resting order is 1 token. A sell
  order above the issue price will not be reached while the fund issues below it.
- Market orders are buy(usdcIn, minTokenOut, ids) and sell(tokenIn,
  minUSDCOut, ids). ids are the resting orders to trade against, best price
  first; the book takes the better price at every step, and a holder's order
  goes first at the same price. quoteBuy and quoteSell return what a market
  order would do.
- marketPrice() is the middle between the ladder's best bid and the fund's
  best offer. Holders' orders do not count, so posting an order cannot move it.

Compared with the constant-product pool this replaces: an order of 1% of the
fund moved the pool price by about 19%. Now a buy costs NAV +0.2% as long as
approved tokens last,
and a sale of 1% of the fund goes through 25 rungs and ends 5% below NAV
(average price 2.6% below NAV) with the reserve at its 5% start; a sale of 2.6% of
the fund ends 13% below NAV.

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
- The ladder and the issue price follow the GP-reported NAV. A valuation that
  is too high lets holders sell to the fund's bids at too high a price; what is
  exposed there is the cash in the book. A valuation that is too low lets
  buyers have new tokens too cheaply; what is exposed there is the amount
  holders approved and the book has not sold yet. An approval does not expire.
- With nothing approved and no holder selling, there is nothing to buy, and
  the market price shown is the ladder's top bid.
- The issuance vote needs more than 50% of eligible supply, as the GP removal
  does. With widely spread holders that is a high bar for a routine decision.
- Whoever sees a revaluation first can trade against orders that are still
  priced for the old NAV. For the ladder this is harmless (it moves in the same
  transaction); for holders' resting orders it is the usual risk of a limit
  order.
- There is no matching engine. Two resting orders that cross are not matched
  until a taker trades against them, and a taker who names no orders trades
  with the ladder only.
- The reserve is 5% of the fund spread over 50% of price. It slows a fall and
  earns on every bounce; it cannot hold a price against sellers of more than
  about 5% of the fund.
- The buyback buys the cheapest offers once the market is 10% below NAV. A
  sale into the book right before buyback() can profit from it (MEV); the 1%
  cap bounds the damage.
- The GP cannot vote from his own wallet, but nothing stops him from moving
  vested tokens to another wallet first.
- No whitelist and no identity checks. That is deliberate for a prototype that
  studies the economics; a fund sold to real investors needs both.
- Not audited.
