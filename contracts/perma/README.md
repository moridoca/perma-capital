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
| SubFund.sol | One sub-fund: primary sale, vault, NAV, fee, surplus pot with buyback and dividend, holder votes, GP removal vote. |
| FundToken.sol | The sub-fund's share token. Freely transferable ERC-20; only the sub-fund can mint. |
| OrderBook.sol | Secondary market. Below NAV the fund's cash on a ladder of 250 bid rungs in 0.2% steps down to NAV -50%, each reselling 0.1% higher; above NAV new issuance at NAV +0.2%; plus holders' limit orders. 0.07% taker fee, paid to the fund. |
| GPVesting.sol | Holds the manager's fee tokens until they vest. |
| Vault.sol | Leader-run vaults, as on Hyperliquid: anyone opens one, trades it in the order books, others deposit. Separate from the funds' ladders. With VaultFactory. |
| TradingAccount.sol | Trading account with session keys (fast trading without wallet prompts). With TradingAccountFactory. |
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
| Surplus pot | the 0.07% taker fees, and what the ladder's rungs hold above their share of 5% of net assets once anyone calls sweepLadder(); part of vault cash and of NAV, but the GP cannot invest it | surplus, fee, sweepLadder, freeCash |
| Buyback | only from the surplus pot, only the amount holders approved (GP proposes, more than 50% of eligible supply says yes), carried out by the GP, only while the market is below NAV; tokens are burned | proposeSurplusUse, buyback |
| Dividend | only from the surplus pot, same vote; the GP pays it as mUSDC per token to every token in a wallet at that moment; holders collect it; a declared dividend leaves NAV | proposeSurplusUse, payDividend, claimDividend |
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
so the market cannot run away upwards while approved tokens last; below NAV its ladder bids down to NAV -50%.
Below the ladder only holders' orders trade. A buyback is a decision of GP and holders, paid from the surplus pot.

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

## Vaults

A vault is a pot of mUSDC that one leader trades for its depositors, by any
strategy the leader likes. It has nothing to do with a sub-fund's ladder: the
ladder is the fund's own rule-based market making, a vault is a third party
trading in the same order books.

| Rule | Value | Where |
|---|---|---|
| Opening | anyone, with at least 100 mUSDC of their own; the opener is the leader | VaultFactory.create |
| What the leader can do | market and limit orders in the order books of this umbrella's sub-funds, at most 6 sub-funds and 8 open orders per vault; no transfer out, no other contract | Vault.buy, sell, limitBuy, limitSell, cancel |
| Price bounds | no fill above NAV +5% on a buy, none below NAV -55% on a sell (the ladder ends at -50%) | MAX_PREMIUM_BPS, MAX_DISCOUNT_BPS |
| Leader's own stake | at least 5% of the shares; larger deposits by others and smaller holdings by the leader are refused | LEADER_MIN_BPS |
| Price of new shares | vault value per share with fund tokens at the higher of market price and NAV | issuePrice, deposit |
| Value shown, profit | fund tokens at the lower of market price and NAV | value, sharePrice |
| Lock | a deposit can be withdrawn one day later (120 seconds in the test deployment) | LOCK |
| Withdrawal | in mUSDC: the depositor's fraction of the cash, plus what the sale of the same fraction of every position brings at market (the depositor's slippage). Open orders are cancelled only if the free balances do not cover it. What the book does not take is paid out as tokens | redeem |
| Shares | an ERC-20 token per vault, with the ERC-4626 views asset, totalAssets, convertToShares, convertToAssets; what was paid for shares and their lock travel with them; the leader's shares are not transferable | Vault is ERC20 |
| Agents | the leader can let other addresses trade for the vault; they can do nothing else | setAgent |
| Dividends | a vault collects the dividends of the fund tokens it holds; anyone can trigger it | collectDividends |
| Profit share | 10% of a depositor's profit, moved to the leader in shares at redemption; no management fee | PROFIT_SHARE_BPS |
| Closing | once every position is sold: orders cancelled, no trading, no deposits, withdrawal without lock | close |

Why two prices. A vault needs a price for the fund tokens it holds, and the
only prices on-chain are the book's market price and the GP-reported NAV.
The market price can be moved for one transaction by selling into the ladder
and buying back (cost about 0.25% of the volume). If shares were issued at
that price, a depositor could push it down, deposit cheaply and take the
difference from the other depositors. Issuing at the higher of the two closes
that. Measuring profit at the lower of the two keeps a leader from buying
below NAV and collecting a profit share on the paper gain. A withdrawal needs
no price for the position part: that part is sold, and the depositor gets what
the sale brings.

What follows Hyperliquid's documentation (Vaults, For vault leaders, For vault
depositors): 100 minimum to open, fixed name and description, 5% leader stake,
10% profit share at withdrawal, one-day lock, deposits and withdrawals in the
quote asset with orders cancelled and positions closed when a withdrawal needs
it, agents, closing only with no positions, tokenised shares along ERC-4626.
What differs: Hyperliquid closes 20% of positions at a time until the margin
suffices, here exactly the withdrawing depositor's fraction is sold; there is
no creation fee; ERC-4626's mint and withdraw-by-amount are left out because a
withdrawal's amount depends on the fills.

What this costs: while a fund trades below NAV, a new depositor pays NAV for
tokens the market values lower, so entering a vault that is invested costs the
discount on that part. Hyperliquid has a mark price from an oracle and does
not have this problem; here there is no oracle.

Other limits:

- The leader decides what is bought. Depositors can lose money, including all
  of it. A leader can also trade the vault against his own wallet's orders.
  The price bounds limit what one such trade can take (5% of its size on a
  buy when nothing cheaper is on offer; on a sell the ladder's bids come
  first), they do not stop it from being repeated. The 5% stake, the profit
  share and the depositors' right to leave after a day are what stands
  against it. This is the same trust a Hyperliquid vault asks for.
- Both prices follow the GP's NAV report (the market through the ladder).
- There is no vault-level governance.
- Opening a vault costs about 4.5 million gas, a deposit 129,000, a market
  order through a vault 534,000, a withdrawal with a sale 365,000 (local chain).
- VaultFactory is 24,306 of 24,576 bytes: there is little room left in Vault.

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
- A sale into the book right before the GP's buyback() can profit from it
  (MEV); the approved amount bounds the damage.
- Dividends go to tokens in wallets only. Tokens resting in a sell order or
  locked in a vote at the moment of payment get nothing, the yes-voters'
  tokens included unless they are withdrawn first (the vote ends with the
  approval, the GP pays afterwards).
- Every token transfer now also updates the dividend account of sender and
  receiver in the fund, which costs gas on each trade.
- The GP cannot vote from his own wallet, but nothing stops him from moving
  vested tokens to another wallet first.
- No whitelist and no identity checks. That is deliberate for a prototype that
  studies the economics; a fund sold to real investors needs both.
- Not audited.
