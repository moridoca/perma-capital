"""Vault strategies as rules: "quote this side at NAV +/- x% for this size, under this condition".

The same rules can be built in the dashboard (Vaults > Strategy builder > Export) and run here:

    from perma.strategy import Runner
    Runner(vault_exchange, json.load(open("strategy.json"))).run()

`plan` is the same function as planStrategy in docs/app.js; test/strategy.test.js runs both on the same cases.
Amounts in `state` are 6-decimal integers.
"""
import time
from typing import Any, Dict, List

ONE = 10**6
PPM = 10**6
MAX_ORDERS = 8


def ppm(pct) -> int:
    """1% = 10,000 ppm (rounded half up, as JavaScript's Math.round does)."""
    import math
    return math.floor(float(pct) * 10000 + 0.5)


def plan(st: Dict[str, Any], v: Dict[str, Any]) -> Dict[str, List[Any]]:
    """Orders to cancel and orders to place. v: nav, mid, cash, tokens, orders [{oid, isBuy, px, sz}]."""
    nav = v["nav"]
    invested = v["tokens"] * nav // ONE
    total = v["cash"] + invested
    cap = total * ppm(st["maxInvestedPct"]) // PPM
    cash_left = min(cap - invested if cap > invested else 0, v["cash"])
    tok_left = v["tokens"]
    desired = []
    for r in (st.get("rules") or [])[:MAX_ORDERS]:
        buy, w = r["side"] == "buy", ppm(r.get("whenPct") or 0)
        if r["when"] == "marketBelow" and not v["mid"] * PPM < nav * (PPM + w):
            continue
        if r["when"] == "marketAbove" and not v["mid"] * PPM > nav * (PPM + w):
            continue
        px = nav * (PPM + ppm(r["offsetPct"])) // PPM
        hi, lo = nav * 105 // 100, nav * 45 // 100  # the vault refuses fills outside NAV +5% / -55%
        if buy and px > hi:
            px = hi
        if not buy and px < lo:
            px = lo
        if px <= 0:
            continue
        # post-only: a quote that would trade at once is left out instead of taking
        if st.get("postOnly") and buy and v.get("bestAsk", 0) > 0 and px >= v["bestAsk"]:
            continue
        if st.get("postOnly") and not buy and v.get("bestBid", 0) > 0 and px <= v["bestBid"]:
            continue
        if r["sizeMode"] == "pctCash":
            sz = (v["cash"] * ppm(r["size"]) // PPM) * ONE // px
        elif r["sizeMode"] == "pctPosition":
            sz = v["tokens"] * ppm(r["size"]) // PPM
        else:
            import math
            sz = math.floor(float(r["size"]) * 1e6 + 0.5)
        if buy:
            if sz * px // ONE > cash_left:
                sz = cash_left * ONE // px
            if sz < ONE:
                continue
            cash_left -= sz * px // ONE
        else:
            sz = min(sz, tok_left)
            if sz < ONE:
                continue
            tok_left -= sz
        desired.append({"isBuy": buy, "px": px, "sz": sz})
    tol = nav * ppm(st["requotePct"]) // PPM
    used, place = set(), []
    for d in desired:
        hit = next((o for o in v["orders"] if o["oid"] not in used and o["isBuy"] == d["isBuy"] and abs(o["px"] - d["px"]) <= tol
                    and o["sz"] * 2 >= d["sz"] and o["sz"] <= d["sz"] * 2), None)
        if hit:
            used.add(hit["oid"])
        else:
            place.append(d)
    return {"cancel": [o["oid"] for o in v["orders"] if o["oid"] not in used], "place": place[:max(0, MAX_ORDERS - len(used))]}


class Runner:
    """Runs a strategy for a vault. `exchange` must be in vault mode (leader or agent)."""

    def __init__(self, exchange, strategy: Dict[str, Any], log=print):
        if exchange.mode != "vault":
            raise ValueError("create the Exchange with vault_address=...")
        self.ex, self.st, self.log = exchange, strategy, log
        self.info = exchange.info
        self.fund = self.info.fund(strategy["fund"])

    def state(self) -> Dict[str, Any]:
        f, v = self.fund, self.ex.vault.functions
        fidx, ids, is_buy, prices, sizes = v.openOrders().call()
        # best prices of everyone else: the fund's ladder, approved new tokens, other makers' orders
        b = self.info.raw_book(self.st["fund"])
        best_bid, best_ask = 0, (b["issue"] if b["issuable"] > 0 else 0)
        for i in range(len(b["bids"])):
            if b["cash"][i] > 0 and b["bids"][i] > best_bid:
                best_bid = b["bids"][i]
            if b["tokens"][i] > 0 and (best_ask == 0 or b["asks"][i] < best_ask):
                best_ask = b["asks"][i]
        me = self.ex.address.lower()
        for o in b["orders"]:
            if o["sz"] == 0 or o["maker"].lower() == me:
                continue
            if o["isBuy"] and o["px"] > best_bid:
                best_bid = o["px"]
            if not o["isBuy"] and (best_ask == 0 or o["px"] < best_ask):
                best_ask = o["px"]
        return {"bestBid": best_bid, "bestAsk": best_ask, "nav": f["fundC"].functions.navPerToken().call(), "mid": f["fundC"].functions.marketPrice().call(),
                "cash": v.cashTotal().call(), "tokens": v.tokensTotal(f["index"]).call(),
                "orders": [{"oid": ids[k], "isBuy": is_buy[k], "px": prices[k], "sz": sizes[k]} for k in range(len(ids)) if fidx[k] == f["index"] and sizes[k] > 0]}

    def step(self) -> Dict[str, Any]:
        """One check: read, plan, cancel, place. Returns the plan with the results."""
        p = plan(self.st, self.state())
        coin, results = self.st["fund"], []
        for oid in p["cancel"]:
            results.append(self.ex.cancel(coin, oid))
        for o in p["place"]:
            results.append(self.ex.order(coin, o["isBuy"], o["sz"] / ONE, o["px"] / ONE))
        if p["cancel"] or p["place"]:
            self.log(f"{self.st.get('name', 'strategy')}: cancelled {len(p['cancel'])}, placed {len(p['place'])}; "
                     + ", ".join(r["status"] if isinstance(r, dict) else "?" for r in results))
        return {"plan": p, "results": results}

    def run(self, rounds: int = 0) -> None:
        """Checks every intervalSec seconds; forever if rounds is 0."""
        n = 0
        while rounds == 0 or n < rounds:
            try:
                self.step()
            except Exception as e:  # a failed read or a refused order must not end the loop
                self.log("strategy error: " + str(e)[:200])
            n += 1
            if rounds == 0 or n < rounds:
                time.sleep(float(self.st.get("intervalSec", 20)))
