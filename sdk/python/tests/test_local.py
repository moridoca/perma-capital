"""SDK against a local chain. Start it first: `cd test && node compile.js && node serve.js` (see README).

    python3 tests/test_local.py
"""
import json, os, sys, time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from eth_account import Account
from perma import Exchange, Info
from perma.constants import ONE

Account.enable_unaudited_hdwallet_features()
NET = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "test", "chain.json")))
key = lambda i: Account.from_mnemonic(NET["mnemonic"], account_path=f"m/44'/60'/0'/0/{i}")
n = 0


def ok(msg):
    global n
    n += 1
    print(f"ok {n:2d} - {msg}")


def good(r):
    assert r["status"] == "ok", r
    return r


info = Info(NET)
alice, bob, dave, eve = key(1), key(2), key(4), key(5)  # alice and bob hold pBUY; dave and eve hold mUSDC only

# ---- reading
assert [u["name"] for u in info.meta()["universe"]] == ["pBUY", "pGRO"]
assert info.all_mids() == {"pBUY": "1"}, info.all_mids()  # pGRO is still in its sale
book = info.l2_snapshot("pBUY", 5)
assert book["levels"][0][0]["px"] == "0.998" and book["levels"][1][0] == {"px": "1.002", "sz": "500000", "n": 1, "fund": "500000"}
st = info.user_state(alice.address)
assert st["assetPositions"][0]["coin"] == "pBUY" and st["assetPositions"][0]["szi"] == "600000"
ok("Info: meta, all_mids, l2_snapshot (ladder bids, approved issuance as the offer), user_state")

# ---- a wallet trades for itself
ex = Exchange(alice, NET, info=info)
r = good(ex.order("pBUY", False, 1000, 1.0015))
oid = r["response"]["data"]["statuses"][0]["resting"]["oid"]
assert info.open_orders(alice.address) == [{"coin": "pBUY", "oid": oid, "side": "A", "limitPx": "1.0015", "sz": "1000"}]
r = good(Exchange(dave, NET, info=info).market_buy_usdc("pBUY", 500))
f = r["response"]["data"]["statuses"][0]["filled"]
assert f["avgPx"].startswith("1.002") and abs(float(f["totalSz"]) - 500 / 1.0015 / 1.0007) < 0.01, f  # 1.0015 plus the 0.07% taker fee
r = good(ex.modify_order(oid, "pBUY", False, 400, 1.0018))
oid2 = r["response"]["data"]["statuses"][0]["resting"]["oid"]
assert oid2 != oid and [o["limitPx"] for o in info.open_orders(alice.address)] == ["1.0018"]
good(ex.cancel("pBUY", oid2))
assert info.open_orders(alice.address) == []
bad = ex.cancel("pBUY", oid2)
assert bad["status"] == "err" and "order not open" in bad["response"], bad
r = good(ex.market_open("pBUY", False, 300))  # Ioc sell into the ladder
assert "filled" in r["response"]["data"]["statuses"][0]
fills = info.user_fills(alice.address)
assert fills[-1]["side"] == "A" and fills[-1]["sz"] == "300"
ok("wallet mode: resting limit order, taker buy against it, modify, cancel, refused cancel reported, market sell, user_fills")

# ---- pipelining: transactions go out without waiting for each other
t0 = time.time()
fast = Exchange(alice, NET, info=info, pipelining=True)
sent = [fast.order("pBUY", False, 10, 1.0019 - k * 0.00001) for k in range(8)]
assert all(s["status"] == "pending" for s in sent)
t_send = time.time() - t0
res = fast.flush()
assert len(res) == 8 and all(x["status"] == "ok" for x in res)
oids = [x["response"]["data"]["statuses"][0]["resting"]["oid"] for x in res]
[fast.cancel("pBUY", o) for o in oids]
assert all(x["status"] == "ok" for x in fast.flush()) and info.open_orders(alice.address) == []
ok(f"pipelining: 8 orders sent in {t_send:.2f} s with locally counted nonces, then 8 cancels; all confirmed")

# ---- agent key on a trading account; batches
owner = Exchange(dave, NET, info=info)
r, agent_key = owner.approve_agent(gas_eth=0.05)
good(r)
acct = r["accountAddress"]
assert acct and info.trading_account(dave.address) == acct
good(owner.usd_transfer(50_000 * ONE, acct))
agent = Exchange(Account.from_key(agent_key), NET, account_address=acct, info=info)
good(agent.market_buy_usdc("pBUY", 5000))
r = good(agent.bulk_orders([{"coin": "pBUY", "is_buy": True, "sz": 100, "limit_px": 0.9990 - k * 0.0001} for k in range(5)]
                           + [{"coin": "pBUY", "is_buy": False, "sz": 100, "limit_px": 1.0012 + k * 0.0001} for k in range(5)]))
st = r["response"]["data"]["statuses"]
assert len(st) == 10 and all("resting" in s for s in st), st
gas_bulk = r["gasUsed"]
mine = info.open_orders(acct)
assert len(mine) == 10
r = good(agent.modify_order(mine[0]["oid"], "pBUY", True, 150, 0.9991))  # cancel and replace in one transaction
assert len(info.open_orders(acct)) == 10
bad = agent.order("pBUY", False, 10, 0.5)  # outside the session's price limits
assert bad["status"] == "err" and "session" in bad["response"], bad
good(agent.cancel_all())
assert info.open_orders(acct) == []
ok(f"account mode: agent key from approve_agent trades through the trading account; 10 orders in one transaction ({gas_bulk:,} gas), "
   "cancel-and-replace in one, cancel_all in one; an order outside the session's price limits is refused")

# ---- vaults
leader = Exchange(eve, NET, info=info)
r = good(leader.create_vault("SDK vault", "Opened from Python", 10_000 * ONE))
vault = r["response"]["vaultAddress"]
good(Exchange(dave, NET, info=info).vault_usd_transfer(vault, True, 5_000 * ONE))
vex = Exchange(eve, NET, vault_address=vault, info=info)
r = good(vex.order("pBUY", True, 2000, 1.003))  # takes the offers up to 1.003
assert "filled" in r["response"]["data"]["statuses"][0]
r = good(vex.order("pBUY", False, 500, 1.02))
void = r["response"]["data"]["statuses"][0]["resting"]["oid"]
d = info.vault_details(vault, dave.address)
assert d["name"] == "SDK vault" and d["positions"][0]["coin"] == "pBUY" and d["openOrders"][0]["oid"] == void and float(d["followerState"]["shares"]) > 4900
assert abs(d["leaderFraction"] - 2 / 3) < 0.01
r, vault_agent = vex.approve_agent()
good(r)
aex = Exchange(Account.from_key(vault_agent), NET, vault_address=vault, info=info)
# a vault agent pays its own gas: the leader sends it some ETH
tx = {"to": aex.wallet.address, "value": info.w3.to_wei(0.05, "ether"), "nonce": info.w3.eth.get_transaction_count(eve.address), "gas": 21000,
      "chainId": NET["chain_id"], "maxFeePerGas": info.w3.to_wei(3, "gwei"), "maxPriorityFeePerGas": 0}
info.w3.eth.wait_for_transaction_receipt(info.w3.eth.send_raw_transaction(eve.sign_transaction(tx).raw_transaction))
good(aex.cancel("pBUY", void))
assert info.vault_details(vault)["openOrders"] == []
assert Exchange(dave, NET, vault_address=vault, info=info).order("pBUY", True, 10, 1.003)["status"] == "err"  # not leader, not agent

# ---- a strategy from the dashboard's builder, run by the SDK
from perma.strategy import Runner

rules = {"name": "test", "fund": "pBUY", "postOnly": True, "maxInvestedPct": 80, "requotePct": 0.1, "intervalSec": 1, "rules": [
    {"side": "buy", "offsetPct": -3, "sizeMode": "pctCash", "size": 20, "when": "always", "whenPct": 0},
    {"side": "sell", "offsetPct": 1, "sizeMode": "pctPosition", "size": 50, "when": "always", "whenPct": 0}]}
runner = Runner(vex, rules, log=lambda m: None)
first = runner.step()
assert len(first["plan"]["place"]) == 2 and all(x["status"] == "ok" for x in first["results"]), first
resting = info.vault_details(vault)["openOrders"]
assert sorted(o["side"] for o in resting) == ["A", "B"], resting
second = runner.step()
assert second["plan"] == {"cancel": [], "place": []}, second  # the orders still fit: nothing is touched
rules["rules"][0]["offsetPct"] = -4  # a changed rule replaces just that order
third = runner.step()
assert len(third["plan"]["cancel"]) == 1 and len(third["plan"]["place"]) == 1 and third["plan"]["place"][0]["isBuy"]
ok("strategy runner: rules place a bid and an offer for the vault, a second check leaves them, a changed rule replaces only its order")

time.sleep(4)  # the local chain's deposit lock is 3 seconds
before = info.usdc.functions.balanceOf(dave.address).call()
r = good(Exchange(dave, NET, info=info).vault_usd_transfer(vault, False, 2_000 * ONE))
got = info.usdc.functions.balanceOf(dave.address).call() - before
assert 1_900 * ONE < got < 2_050 * ONE, got
assert [e["vaultAddress"] for e in info.user_vault_equities(dave.address)] == [vault]
ok(f"vault mode: create_vault, deposit, the leader and an agent trade with vault_address, a stranger cannot; withdrawal of about 2,000 paid {got / ONE:,.2f} mUSDC")

# ---- feed
seen = []
sid = info.subscribe({"type": "l2Book", "coin": "pBUY", "depth": 40}, seen.append, interval=0.1)
time.sleep(0.5)
good(ex.order("pBUY", False, 50, 1.0011))
time.sleep(1.0)
assert info.unsubscribe(sid) and len(seen) >= 2
assert any(l["px"] == "1.0011" and l["fund"] == "0" for l in seen[-1]["data"]["levels"][1]) and not any(l["px"] == "1.0011" for l in seen[0]["data"]["levels"][1])
assert all(x["status"] == "ok" for x in ex.cancel_all())
ok("subscribe: the l2Book feed reports a new resting offer after the block that brought it")
print(f"\nall {n} passed")
