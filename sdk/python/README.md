# PERMA Python SDK

Read the funds, trade in their order books, run and use vaults, from Python. The shape follows the
[Hyperliquid Python SDK](https://github.com/hyperliquid-dex/hyperliquid-python-sdk): `Info` reads, `Exchange` acts,
`vault_address` trades for a vault, an agent key trades without being able to withdraw.

The difference that matters: Hyperliquid's SDK talks to an API server that signs you into an off-chain matching
engine. PERMA has no server. Every `Info` call is a contract read and every `Exchange` call is a transaction on
Arbitrum Sepolia, signed locally with your key.

    pip install web3 eth-account        # from this folder: pip install -e .

```python
from perma import Info, constants

info = Info(constants.ARBITRUM_SEPOLIA)
print(info.all_mids())                 # {'pBUY': '0.9985'}
print(info.l2_snapshot("pBUY", 5))     # ladder and holders' orders, aggregated by price
```

```python
from eth_account import Account
from perma import Exchange, constants

exchange = Exchange(Account.from_key(TEST_KEY), constants.ARBITRUM_SEPOLIA)
print(exchange.order("pBUY", True, 10, 0.95, {"limit": {"tif": "Gtc"}}))
# {'status': 'ok', 'response': {'type': 'order', 'data': {'statuses': [{'resting': {'oid': 3, ...}}]}}, ...}
```

Use a test wallet only. The examples read the key from `examples/config.json` (copy `config.json.example`;
git ignores the copy).

## What maps to what

| Hyperliquid SDK | Here | Note |
|---|---|---|
| `Info.meta`, `all_mids`, `l2_snapshot`, `open_orders`, `user_state`, `user_fills`, `candles_snapshot` | same names | `user_fills` lists taker trades only; candles are built from trade events |
| `Info.user_vault_equities`, vault details | `user_vault_equities`, `vault_details`, `vaults` | |
| `Info.subscribe` (websocket) | `subscribe` | polls the chain per block; types `allMids`, `l2Book`, `trades`, `userFills` |
| `Exchange.order`, `bulk_orders`, `modify_order`, `cancel`, `bulk_cancel`, `market_open`, `market_close` | same names | order types `Gtc` and `Ioc`; no post-only, no trigger orders |
| `Exchange(..., vault_address=v)` | same | the wallet must be the vault's leader or one of its agents |
| `Exchange.vault_usd_transfer` | same | a withdrawal pays mUSDC and sells your part of the positions at market |
| `Exchange.approve_agent` + `Exchange(agent, account_address=a)` | same | the agent is a session key on a trading account (expiry, volume cap, price band around NAV), or a vault agent |
| leverage, margin, funding, sub-accounts, staking, spot/perp deploy | not here | PERMA has spot books of fund tokens only |

Sizes and prices go in as decimal numbers and come back as decimal strings. Amounts of mUSDC for
`vault_usd_transfer`, `create_vault`, `usd_transfer` and `mint_test_usdc` are 6-decimal integers, as in
Hyperliquid's `vault_usd_transfer` (`5_000000` = 5 mUSDC).

## Trading fast

A trade here is a transaction, so "high frequency" means: as many useful transactions per block as possible,
and no waiting in between. Three things in the SDK serve that:

- **Batches.** Through a trading account, `bulk_orders`, `bulk_cancel` and `modify_order` are ONE transaction
  (`TradingAccount.batch`): ten orders in the local test took 1.9 million gas together, and cancel-and-replace
  is atomic.
- **Pipelining.** `Exchange(..., pipelining=True)` sends without waiting for the previous transaction, counting
  nonces locally; `flush()` collects the results. Gas is then a fixed limit (`pipeline_gas`), since an estimate
  cannot see transactions that are still on their way.
- **Agent keys.** The loop signs with a session key: no wallet pop-ups, and the key can only trade within its
  limits.

`examples/market_maker.py` puts these together: per round one read of NAV and one transaction that replaces a
bid and an offer.

Limits, plainly:

- Arbitrum produces a block about every 0.25 s; the public RPC endpoint and your connection add to that. This is
  not the microseconds of an exchange's matching engine, and the SDK cannot make it so.
- A pipelined transaction that fails does so on-chain: you learn it at `flush()`, and you paid its gas.
- The book has no matching engine: a taker names the resting orders it trades against. The SDK picks them from
  a read of the book; with pipelining that read is reused for half a second (`book_ttl`).
- A vault has no batch call (its contract is at the size limit): vault orders are one transaction each, pipelined
  if you like.
- Reads go through whatever RPC endpoint you give `Info(network, rpc_url=...)`. For a tight loop use your own
  endpoint, not the public one.

## Running the tests and examples locally

    cd ../../test && npm install && node compile.js && node serve.js     # local chain on 127.0.0.1:8545
    cd ../sdk/python && python3 build_abi.py && python3 tests/test_local.py

`test/chain.json` then holds the local addresses; set `"network": "local"` in `examples/config.json` to run
the examples against it. `build_abi.py` refreshes `perma/abi.json` after a contract change.
