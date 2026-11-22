"""Quoting loop for an agent key on a trading account: the fast path of this SDK.

Every round it reads NAV once and replaces its bid and its offer in ONE transaction (cancel both, place both),
sent without waiting for the previous round. On Arbitrum a block comes about every 0.25 s; what limits the
pace is the round trip to the RPC endpoint, not the chain.

    python3 market_maker.py <agent private key> <trading account address> [rounds]
"""
import sys, time

import example_utils
from eth_account import Account
from perma import Exchange

_, info, base, _ = example_utils.setup()
agent = Exchange(Account.from_key(sys.argv[1]), base.network, account_address=sys.argv[2], info=info, pipelining=True)
rounds = int(sys.argv[3]) if len(sys.argv) > 3 else 20
coin, size, half_spread = "pBUY", 25, 0.0005  # quote 0.05% either side of NAV, inside the fund's own 0.2% steps

t0, sent = time.time(), 0
for r in range(rounds):
    nav = float(info.fund_state(coin)["nav"])
    mine = info.open_orders(agent.address)
    f = info.fund(coin)
    calls = [agent._cancel_call(f, o["oid"])._encode_transaction_data() for o in mine]
    book = info.raw_book(coin)
    for is_buy, price in ((True, nav * (1 - half_spread)), (False, nav * (1 + half_spread))):
        calls.append(agent._limit_call(f, is_buy, int(size * 1e6), int(round(price, 6) * 1e6), book)._encode_transaction_data())
    res = agent._send(agent.account.functions.batch(calls), agent._order_parser(f))
    sent += 1
    print(f"round {r}: NAV {nav:.6f}, replaced {len(mine)} orders, {res['status']}")
    for done in agent.flush():  # here we wait for the block; drop this line to run fully ahead of confirmations
        if done["status"] != "ok":
            print("  ", done)
print(f"{sent} quote updates in {time.time() - t0:.1f} s")
agent.pipelining = False
print(agent.cancel_all())
