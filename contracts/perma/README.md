# Perma Capital - tokenized permanent-capital fund (prototype)

A private-equity umbrella fund as smart contracts. Each sub-fund is issued once
and never wound up: no capital calls, no redemptions, no distributions.
Profits stay in the fund and raise NAV per token. Investors exit by selling
their tokens in the sub-fund's own on-chain market.

Prototype for the Remix VM and testnets. mUSDC is play money.

## Contracts

| File | Role |
|---|---|
| UmbrellaFactory.sol | The umbrella. Launches sub-funds and lists them. One call, overview(i), returns addresses, NAV, market price and premium/discount. |
| SubFund.sol | One sub-fund: primary sale, vault, NAV, fee, buyback, follow-on issuance, GP removal vote. |
| FundToken.sol | The sub-fund's share token. Freely transferable ERC-20; only the sub-fund can mint. |
| LiquidityPool.sol | Secondary market. Constant-product AMM (x * y = k), 0.30% fee. |
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
| Total supply at launch | 10,000,000 if sold out | initialSupply |
| Management fee | 2% of initial supply per year, paid in new tokens (200,000) | mintManagementFee |
| Fee lifetime cap | 10 tranches (2,000,000 tokens), then never again | FEE_YEARS_CAP |
| Fee lock-up | each tranche unlocks one year after minting | GPVesting |
| Buyback trigger | market price more than 10% below NAV | buyback |
| Buyback size | at most 1% of vault cash per execution, one per week, anyone can trigger | buyback |
| Follow-on issue price | the higher of NAV and market price | issuePrice |
| GP removal | more than 50% of eligible supply votes yes; unvested fee tokens are burned | executeRemoveGP |
| Eligible supply | total supply minus unvested fee tokens, pool tokens and the GP's wallet | eligibleSupply |

## NAV

    NAV per token = (vault cash + fund-owned pool cash + investedValue) / outstanding supply

- Vault cash and pool cash are read on-chain.
- investedValue is reported by the GP (deployCapital books at cost,
  markInvestments revalues). This is the one trust assumption of the model.
- Outstanding supply excludes the fund's own tokens in the pool (treasury stock).

Market price and NAV are two separate numbers. Nothing forces them to be
equal; premiumBps() shows the gap. The buyback rule and the follow-on rule
are the two mechanisms that lean against it, from below and from above.

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
6. Load SubFund, FundToken, LiquidityPool, GPVesting with "At Address".

Investors approve mUSDC to the SubFund before buy, and mUSDC or the token to
the pool before swapping.

## Known limits

- GP-reported investment value is not verified on-chain.
- A swap into the pool right before buyback() can profit from it (MEV);
  the 1% cap bounds the damage.
- Where the fund owns the pool, the pool sells treasury tokens at the market
  price. Below NAV this dilutes NAV slightly, above NAV it adds to it.
- The GP cannot vote from his own wallet, but nothing stops him from moving
  vested tokens to another wallet first.
- No whitelist and no identity checks. That is deliberate for a prototype that
  studies the economics; a fund sold to real investors needs both.
- Not audited.
