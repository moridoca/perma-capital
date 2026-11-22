"""Reading: funds, order books, accounts, vaults. No key needed."""
import json
import os
import threading
import time
from typing import Any, Callable, Dict, List, Optional

from web3 import Web3

from .constants import ONE

_ABI = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "abi.json")))


def px(x: int) -> str:
    """6-decimal integer -> decimal string, as prices and sizes are returned."""
    return f"{x / ONE:.6f}".rstrip("0").rstrip(".") if x % ONE else str(x // ONE)


def to_units(x) -> int:
    """Decimal number or string -> 6-decimal integer."""
    return int(round(float(x) * ONE))


class Info:
    def __init__(self, network: Dict[str, Any], rpc_url: Optional[str] = None):
        self.network = network
        self.w3 = Web3(Web3.HTTPProvider(rpc_url or network["rpc_url"], request_kwargs={"timeout": 20}))
        self.umbrella = self.contract("UmbrellaFactory", network["umbrella"])
        self.usdc = self.contract("MockUSDC", network["usdc"])
        self._funds: List[Dict[str, Any]] = []
        self._subs: Dict[int, threading.Event] = {}
        self._next_sub = 0

    # ---- plumbing -----------------------------------------------------
    def contract(self, name: str, address: str):
        return self.w3.eth.contract(address=Web3.to_checksum_address(address), abi=_ABI[name])

    def funds(self, refresh: bool = False) -> List[Dict[str, Any]]:
        if self._funds and not refresh:
            return self._funds
        out = []
        for i in range(self.umbrella.functions.subFundCount().call()):
            o = self.umbrella.functions.overview(i).call()  # name, fund, token, book, vesting, nav, price, premium, netAssets
            token = self.contract("FundToken", o[2])
            out.append({"index": i, "name": token.functions.symbol().call(), "fullName": o[0], "fund": o[1], "token": o[2], "book": o[3],
                        "fundC": self.contract("SubFund", o[1]), "tokenC": token, "bookC": self.contract("OrderBook", o[3])})
        self._funds = out
        return out

    def fund(self, name: str) -> Dict[str, Any]:
        for f in self.funds():
            if f["name"] == name or f["fullName"] == name:
                return f
        raise ValueError(f"unknown fund {name!r}; known: {[f['name'] for f in self.funds()]}")

    def name_to_asset(self, name: str) -> int:
        return self.fund(name)["index"]

    # ---- markets ------------------------------------------------------
    def meta(self) -> Dict[str, Any]:
        return {"universe": [{"name": f["name"], "fullName": f["fullName"], "index": f["index"], "szDecimals": 6,
                              "fund": f["fund"], "token": f["token"], "book": f["book"]} for f in self.funds()]}

    def all_mids(self) -> Dict[str, str]:
        """Market price per fund (the middle of the ladder's best bid and best offer). Funds still in their sale are left out."""
        out = {}
        for f in self.funds():
            if f["fundC"].functions.saleClosed().call():
                out[f["name"]] = px(f["fundC"].functions.marketPrice().call())
        return out

    def fund_state(self, name: str) -> Dict[str, Any]:
        """NAV, market, treasury and surplus of one fund."""
        c = self.fund(name)["fundC"].functions
        nav, mkt = c.navPerToken().call(), c.marketPrice().call()
        return {"coin": name, "saleClosed": c.saleClosed().call(), "nav": px(nav), "mid": px(mkt), "premiumBps": c.premiumBps().call(),
                "netAssets": px(c.netAssets().call()), "vaultCash": px(c.vaultCash().call()), "freeCash": px(c.freeCash().call()),
                "surplus": px(c.surplus().call()), "investedValue": px(c.investedValue().call()),
                "issuanceApproved": px(c.issuanceApproved().call()), "buybackApproved": px(c.buybackApproved().call()),
                "dividendApproved": px(c.dividendApproved().call())}

    def raw_book(self, name: str) -> Dict[str, Any]:
        """Ladder and resting orders as integers; what the hint and quote logic works on."""
        f = self.fund(name)
        nav, bids, asks, tokens, cash, edge = f["bookC"].functions.ladder().call()
        ids, makers, is_buy, prices, sizes = f["bookC"].functions.openOrders().call()
        orders = [{"oid": ids[k], "maker": makers[k], "isBuy": is_buy[k], "px": prices[k], "sz": sizes[k]} for k in range(len(ids))]
        return {"nav": nav, "bids": bids, "asks": asks, "tokens": tokens, "cash": cash, "edge": edge, "orders": orders,
                "issue": f["bookC"].functions.issuePrice().call(), "issuable": f["fundC"].functions.issuanceApproved().call()}

    def l2_snapshot(self, name: str, depth: int = 20) -> Dict[str, Any]:
        """Aggregated book: levels[0] bids (best first), levels[1] asks (best first). n = number of orders, fund = part that is the fund's ladder."""
        b = self.raw_book(name)
        bid, ask = {}, {}

        def add(side, price, size, own):
            if size <= 0:
                return
            lv = side.setdefault(price, {"sz": 0, "n": 0, "fund": 0})
            lv["sz"] += size
            lv["n"] += 1
            if own:
                lv["fund"] += size

        for i in range(len(b["bids"])):
            if b["cash"][i] > 0 and b["bids"][i] > 0:
                add(bid, b["bids"][i], b["cash"][i] * ONE // b["bids"][i], True)
            if b["tokens"][i] > 0:
                add(ask, b["asks"][i], b["tokens"][i], True)
        if b["issuable"] > 0:
            add(ask, b["issue"], b["issuable"], True)
        for o in b["orders"]:
            add(bid if o["isBuy"] else ask, o["px"], o["sz"], False)
        fmt = lambda side, rev: [{"px": px(p), "sz": px(v["sz"]), "n": v["n"], "fund": px(v["fund"])} for p, v in sorted(side.items(), reverse=rev)[:depth]]
        return {"coin": name, "time": int(time.time() * 1000), "block": self.w3.eth.block_number, "nav": px(b["nav"]), "levels": [fmt(bid, True), fmt(ask, False)]}

    def hints(self, name: str, is_buy: bool, limit_px: Optional[int] = None, exclude: Optional[str] = None, book: Optional[Dict[str, Any]] = None) -> List[int]:
        """Resting orders a taker should name, best price first (the book has no matching engine of its own)."""
        b = book or self.raw_book(name)
        os_ = [o for o in b["orders"] if o["isBuy"] != is_buy and o["sz"] > 0
               and (limit_px is None or (o["px"] <= limit_px if is_buy else o["px"] >= limit_px))
               and (exclude is None or o["maker"].lower() != exclude.lower())]
        os_.sort(key=lambda o: (o["px"] if is_buy else -o["px"], o["oid"]))
        return [o["oid"] for o in os_[:40]]

    # ---- accounts -----------------------------------------------------
    def open_orders(self, address: str) -> List[Dict[str, Any]]:
        address = address.lower()
        out = []
        for f in self.funds():
            ids, makers, is_buy, prices, sizes = f["bookC"].functions.openOrders().call()
            for k in range(len(ids)):
                if makers[k].lower() == address:
                    out.append({"coin": f["name"], "oid": ids[k], "side": "B" if is_buy[k] else "A", "limitPx": px(prices[k]), "sz": px(sizes[k])})
        return out

    def user_state(self, address: str) -> Dict[str, Any]:
        """Balances of a wallet, trading account or vault: mUSDC, fund tokens at the market price, dividends to collect."""
        address = Web3.to_checksum_address(address)
        usdc = self.usdc.functions.balanceOf(address).call()
        positions, value = [], usdc
        for f in self.funds():
            sz = f["tokenC"].functions.balanceOf(address).call()
            div = f["fundC"].functions.dividendOf(address).call()
            if sz == 0 and div == 0:
                continue
            mid = f["fundC"].functions.marketPrice().call() or f["fundC"].functions.navPerToken().call()
            value += sz * mid // ONE + div
            positions.append({"coin": f["name"], "szi": px(sz), "positionValue": px(sz * mid // ONE), "markPx": px(mid), "dividend": px(div)})
        return {"address": address, "withdrawable": px(usdc), "accountValue": px(value), "assetPositions": positions,
                "ethForGas": str(self.w3.from_wei(self.w3.eth.get_balance(address), "ether"))}

    def trading_account(self, owner: str) -> Optional[str]:
        """The trading account of a wallet (session keys trade through it), or None."""
        if not self.network.get("trading_accounts"):
            return None
        a = self.contract("TradingAccountFactory", self.network["trading_accounts"]).functions.accountOf(Web3.to_checksum_address(owner)).call()
        return None if int(a, 16) == 0 else a

    # ---- history ------------------------------------------------------
    def _logs(self, event, lookback_blocks: int, argument_filters: Optional[Dict[str, Any]] = None):
        head = self.w3.eth.block_number
        start = max(self.network.get("deploy_block", 0), head - lookback_blocks)
        chunk, out = self.network.get("log_chunk", 50000), []
        while start <= head:
            end = min(head, start + chunk - 1)
            out += event.get_logs(from_block=start, to_block=end, argument_filters=argument_filters or {})
            start = end + 1
        return out

    def trades(self, name: str, lookback_blocks: int = 200000, user: Optional[str] = None) -> List[Dict[str, Any]]:
        """Taker trades in one book, oldest first. px is the average price paid or received, fee included."""
        f = self.fund(name)
        flt = {"trader": Web3.to_checksum_address(user)} if user else None
        out = []
        for ev in self._logs(f["bookC"].events.Trade(), lookback_blocks, flt):
            a = ev["args"]
            tokens, usdc = (a["amountOut"], a["amountIn"]) if a["usdcForToken"] else (a["amountIn"], a["amountOut"])
            out.append({"coin": name, "side": "B" if a["usdcForToken"] else "A", "sz": px(tokens), "px": px(usdc * ONE // tokens) if tokens else "0",
                        "usdc": px(usdc), "midAfter": px(a["priceAfter"]), "user": a["trader"], "block": ev["blockNumber"], "hash": ev["transactionHash"].hex()})
        return out

    def user_fills(self, address: str, lookback_blocks: int = 200000) -> List[Dict[str, Any]]:
        """Trades this address made as a taker, in all books. Fills of its resting orders are not included."""
        out = []
        for f in self.funds():
            out += self.trades(f["name"], lookback_blocks, address)
        return sorted(out, key=lambda t: t["block"])

    def candles_snapshot(self, name: str, interval_seconds: int, lookback_blocks: int = 200000) -> List[Dict[str, Any]]:
        """OHLC of the market price after each trade, bucketed by block time."""
        ts_cache: Dict[int, int] = {}
        candles: Dict[int, Dict[str, Any]] = {}
        for t in self.trades(name, lookback_blocks):
            bn = t["block"]
            if bn not in ts_cache:
                ts_cache[bn] = self.w3.eth.get_block(bn)["timestamp"]
            bucket = ts_cache[bn] // interval_seconds * interval_seconds
            p, v = float(t["midAfter"]), float(t["usdc"])
            c = candles.get(bucket)
            if c is None:
                candles[bucket] = {"t": bucket * 1000, "T": (bucket + interval_seconds) * 1000 - 1, "s": name, "o": p, "h": p, "l": p, "c": p, "v": v, "n": 1}
            else:
                c["h"], c["l"], c["c"], c["v"], c["n"] = max(c["h"], p), min(c["l"], p), p, c["v"] + v, c["n"] + 1
        return [candles[k] for k in sorted(candles)]

    # ---- vaults -------------------------------------------------------
    def vault_addresses(self) -> List[str]:
        if not self.network.get("vaults"):
            return []
        fac = self.contract("VaultFactory", self.network["vaults"])
        return [fac.functions.vaults(i).call() for i in range(fac.functions.count().call())]

    def vault_details(self, vault_address: str, user: Optional[str] = None) -> Dict[str, Any]:
        v = self.contract("Vault", vault_address)
        name, desc, leader, closed, shares, value, price, issue, cash, leader_shares, lock = v.functions.info().call()
        idx, sizes, prices = v.functions.positions().call()
        fidx, ids, is_buy, oprices, osizes = v.functions.openOrders().call()
        sym = {f["index"]: f["name"] for f in self.funds()}
        out = {"vaultAddress": v.address, "name": name, "description": desc, "leader": leader, "isClosed": closed, "totalShares": px(shares),
               "accountValue": px(value), "sharePrice": px(price), "issuePrice": px(issue), "cash": px(cash),
               "leaderFraction": (leader_shares / shares) if shares else 0.0, "lockSeconds": lock,
               "positions": [{"coin": sym.get(idx[k], str(idx[k])), "szi": px(sizes[k]), "markPx": px(prices[k])} for k in range(len(idx))],
               "openOrders": [{"coin": sym.get(fidx[k], str(fidx[k])), "oid": ids[k], "side": "B" if is_buy[k] else "A", "limitPx": px(oprices[k]), "sz": px(osizes[k])}
                              for k in range(len(ids)) if osizes[k] > 0]}
        if user:
            s, worth, paid, unlock = v.functions.position(Web3.to_checksum_address(user)).call()
            out["followerState"] = {"user": user, "shares": px(s), "vaultEquity": px(worth), "paidIn": px(paid), "pnl": px(worth - paid) if worth >= paid else "-" + px(paid - worth), "lockupUntil": unlock}
        return out

    def vaults(self) -> List[Dict[str, Any]]:
        return [self.vault_details(a) for a in self.vault_addresses()]

    def user_vault_equities(self, user: str) -> List[Dict[str, Any]]:
        out = []
        for a in self.vault_addresses():
            s, worth, _, unlock = self.contract("Vault", a).functions.position(Web3.to_checksum_address(user)).call()
            if s > 0:
                out.append({"vaultAddress": a, "equity": px(worth), "shares": px(s), "lockedUntilTimestamp": unlock})
        return out

    # ---- subscriptions ------------------------------------------------
    def subscribe(self, subscription: Dict[str, Any], callback: Callable[[Any], None], interval: float = 0.25) -> int:
        """Calls back on every new block in which the subscribed data changed.

        There is no websocket server: this polls the chain. Types: {"type": "allMids"}, {"type": "l2Book", "coin": ...},
        {"type": "trades", "coin": ...}, {"type": "userFills", "user": ...}.
        """
        kind = subscription["type"]
        stop = threading.Event()
        sid = self._next_sub
        self._next_sub += 1
        self._subs[sid] = stop

        def run():
            last_block, last = self.w3.eth.block_number, None
            while not stop.is_set():
                try:
                    head = self.w3.eth.block_number
                    if head == last_block and last is not None:
                        time.sleep(interval)
                        continue
                    if kind == "allMids":
                        data = {"mids": self.all_mids()}
                        changed = data != last
                    elif kind == "l2Book":
                        data = self.l2_snapshot(subscription["coin"], subscription.get("depth", 20))
                        changed = last is None or data["levels"] != last["levels"]
                    elif kind in ("trades", "userFills"):
                        coins = [subscription["coin"]] if kind == "trades" else [f["name"] for f in self.funds()]
                        data = []
                        for c in coins:
                            ev = self.fund(c)["bookC"].events.Trade()
                            flt = {"trader": Web3.to_checksum_address(subscription["user"])} if kind == "userFills" else {}
                            for e in ev.get_logs(from_block=last_block + 1, to_block=head, argument_filters=flt):
                                a = e["args"]
                                tokens, usdc = (a["amountOut"], a["amountIn"]) if a["usdcForToken"] else (a["amountIn"], a["amountOut"])
                                data.append({"coin": c, "side": "B" if a["usdcForToken"] else "A", "sz": px(tokens), "px": px(usdc * ONE // tokens) if tokens else "0",
                                             "user": a["trader"], "block": e["blockNumber"], "hash": e["transactionHash"].hex()})
                        changed = bool(data)
                        last = last or True
                    else:
                        raise ValueError("unknown subscription type " + kind)
                    last_block = head
                    if changed:
                        if kind in ("allMids", "l2Book"):
                            last = data
                        callback({"channel": kind, "data": data})
                except Exception as e:  # keep the feed alive over a failed request
                    callback({"channel": "error", "data": str(e)})
                    time.sleep(1)
                time.sleep(interval)

        threading.Thread(target=run, daemon=True).start()
        return sid

    def unsubscribe(self, subscription_id: int) -> bool:
        stop = self._subs.pop(subscription_id, None)
        if stop:
            stop.set()
        return stop is not None
