"""Acting: orders, cancels, vault deposits and withdrawals, agents. Every action is a signed transaction.

Three ways to trade, chosen when the Exchange is created (as in the Hyperliquid SDK):

    Exchange(wallet, network)                               the wallet trades for itself
    Exchange(wallet, network, vault_address=vault)          the vault's leader or an agent trades for the vault
    Exchange(agent_key, network, account_address=account)   a session key trades through its owner's trading account

For speed: `pipelining=True` sends transactions without waiting for the one before (nonces are counted
locally; `flush()` collects the results), and in account mode `bulk_orders`, `bulk_cancel` and
`modify_order` go out as one transaction.
"""
import secrets
import time
from typing import Any, Dict, List, Optional, Tuple

from eth_account import Account
from eth_account.signers.local import LocalAccount
from web3 import Web3
from web3.logs import DISCARD

from .constants import MAX_UINT, NO_ORDER, ONE
from .info import Info, px, to_units

OrderRequest = Dict[str, Any]  # {"coin", "is_buy", "sz", "limit_px", "order_type": {"limit": {"tif": "Gtc" | "Ioc"}}}
GTC = {"limit": {"tif": "Gtc"}}
IOC = {"limit": {"tif": "Ioc"}}


class Exchange:
    def __init__(self, wallet: LocalAccount, network: Dict[str, Any], vault_address: Optional[str] = None,
                 account_address: Optional[str] = None, info: Optional[Info] = None, pipelining: bool = False,
                 pipeline_gas: int = 2_500_000, book_ttl: Optional[float] = None):
        if vault_address and account_address:
            raise ValueError("give vault_address or account_address, not both")
        self.wallet = wallet
        self.network = network
        self.info = info or Info(network)
        self.w3 = self.info.w3
        self.vault_address = Web3.to_checksum_address(vault_address) if vault_address else None
        self.account_address = Web3.to_checksum_address(account_address) if account_address else None
        self.mode = "vault" if vault_address else "account" if account_address else "wallet"
        self.vault = self.info.contract("Vault", vault_address) if vault_address else None
        self.account = self.info.contract("TradingAccount", account_address) if account_address else None
        self.pipelining = pipelining
        self.pipeline_gas = pipeline_gas
        self._nonce: Optional[int] = None
        self._pending: List[Tuple[str, Any]] = []
        self._approved = set()
        # How long a read of the resting orders may be reused when choosing which ones to trade against.
        # Fresh every time by default; half a second when pipelining, where reading the book per order is the bottleneck.
        self.book_ttl = book_ttl if book_ttl is not None else (0.5 if pipelining else 0.0)
        self._books: Dict[str, Tuple[float, Any]] = {}

    @property
    def address(self) -> str:
        """Whose funds the orders use: the vault, the trading account or the wallet itself."""
        return self.vault_address or self.account_address or self.wallet.address

    # ---- sending ------------------------------------------------------
    def _fees(self) -> Dict[str, int]:
        return {"maxFeePerGas": self.w3.to_wei(self.network.get("max_fee_gwei", 1), "gwei"),
                "maxPriorityFeePerGas": self.w3.to_wei(self.network.get("priority_fee_gwei", 0), "gwei")}

    def _send(self, fn, parse=None, value: int = 0, force_wait: bool = False) -> Dict[str, Any]:
        # Count nonces locally only while pipelined transactions are still on their way; otherwise ask the chain,
        # so that several Exchange objects for one wallet do not get in each other's way.
        if self._nonce is None or not self._pending:
            self._nonce = self.w3.eth.get_transaction_count(self.wallet.address, "pending")
        wait = force_wait or not self.pipelining
        tx = {"from": self.wallet.address, "nonce": self._nonce, "chainId": self.network["chain_id"], "value": value, **self._fees()}
        if not wait:
            tx["gas"] = self.pipeline_gas  # an estimate would not see the transactions still on their way
        try:
            built = fn.build_transaction(tx)
        except Exception as e:  # the contract refuses: nothing was sent, the nonce is still free
            return {"status": "err", "response": _reason(e)}
        raw = self.wallet.sign_transaction(built)
        h = self.w3.eth.send_raw_transaction(raw.raw_transaction)
        self._nonce += 1
        if not wait:
            self._pending.append((h.hex(), parse))
            return {"status": "pending", "hash": h.hex()}
        return self._result(h, parse)

    def _result(self, h, parse) -> Dict[str, Any]:
        rc = self.w3.eth.wait_for_transaction_receipt(h, timeout=120, poll_latency=0.1)
        hx = h.hex() if hasattr(h, "hex") else h
        if rc["status"] != 1:
            return {"status": "err", "response": "reverted on-chain", "hash": hx}
        return {"status": "ok", "response": parse(rc) if parse else {"type": "default"}, "hash": hx, "block": rc["blockNumber"], "gasUsed": rc["gasUsed"]}

    def flush(self) -> List[Dict[str, Any]]:
        """Waits for every transaction sent with pipelining and returns their results in order."""
        out = [self._result(h, parse) for h, parse in self._pending]
        self._pending = []
        return out

    def _approve(self, token, spender: str) -> None:
        """One-time unlimited approval (wallet mode only; vaults and trading accounts approve per trade themselves)."""
        key = (token.address, spender)
        if key in self._approved:
            return
        if token.functions.allowance(self.wallet.address, spender).call() < MAX_UINT // 2:
            r = self._send(token.functions.approve(spender, MAX_UINT), force_wait=True)
            if r["status"] != "ok":
                raise RuntimeError("approval failed: " + str(r))
        self._approved.add(key)

    # ---- orders -------------------------------------------------------
    def _book(self, name: str):
        hit = self._books.get(name)
        if hit and time.time() - hit[0] < self.book_ttl:
            return hit[1]
        b = self.info.raw_book(name)
        self._books[name] = (time.time(), b)
        return b

    def _order_parser(self, f):
        me = self.address.lower()

        def parse(rc):
            placed = [e["args"] for e in f["bookC"].events.OrderPlaced().process_receipt(rc, errors=DISCARD) if e["args"]["maker"].lower() == me]
            trades = [e["args"] for e in f["bookC"].events.Trade().process_receipt(rc, errors=DISCARD) if e["args"]["trader"].lower() == me]
            statuses = []
            for t in trades:
                tokens, usdc = (t["amountOut"], t["amountIn"]) if t["usdcForToken"] else (t["amountIn"], t["amountOut"])
                statuses.append({"filled": {"totalSz": px(tokens), "avgPx": px(usdc * ONE // tokens) if tokens else "0", "usdc": px(usdc)}})
            for p in placed:
                statuses.append({"resting": {"oid": p["id"], "sz": px(p["tokens"]), "limitPx": px(p["price"])}})
            return {"type": "order", "data": {"statuses": statuses}}

        return parse

    def _limit_call(self, f, is_buy: bool, sz: int, limit_px: int, book=None):
        ids = self.info.hints(f["name"], is_buy, limit_px, exclude=self.address, book=book or self._book(f["name"]))
        if self.mode == "vault":
            return (self.vault.functions.limitBuy if is_buy else self.vault.functions.limitSell)(f["index"], sz, limit_px, ids)
        if self.mode == "account":
            return (self.account.functions.limitBuyInBook if is_buy else self.account.functions.limitSellInBook)(f["index"], sz, limit_px, ids)
        self._approve(self.info.usdc if is_buy else f["tokenC"], f["book"])
        return (f["bookC"].functions.limitBuy if is_buy else f["bookC"].functions.limitSell)(sz, limit_px, ids)

    def _cancel_call(self, f, oid: int):
        if self.mode == "vault":
            return self.vault.functions.cancel(f["index"], oid)
        if self.mode == "account":
            return self.account.functions.cancelInBook(f["index"], oid)
        return f["bookC"].functions.cancel(oid)

    def order(self, name: str, is_buy: bool, sz: float, limit_px: float, order_type: Dict[str, Any] = GTC) -> Dict[str, Any]:
        """Limit order for `sz` tokens at `limit_px` or better.

        Gtc: what the book offers at the price or better fills at once (0.07% taker fee), the rest waits in the book.
        Ioc: the same, but a rest is cancelled right away (a second transaction).
        """
        f = self.info.fund(name)
        tif = order_type["limit"]["tif"]
        if tif not in ("Gtc", "Ioc"):
            raise ValueError("order types here: Gtc and Ioc")
        if tif == "Ioc" and self.pipelining:
            raise ValueError("Ioc needs the order's result before it can cancel the rest: use it without pipelining")
        r = self._send(self._limit_call(f, is_buy, to_units(sz), to_units(limit_px)), self._order_parser(f))
        if tif == "Ioc" and r["status"] == "ok":
            for s in r["response"]["data"]["statuses"]:
                if "resting" in s:
                    c = self.cancel(name, s["resting"]["oid"])
                    s["cancelled"] = c["status"] == "ok"
        return r

    def bulk_orders(self, order_requests: List[OrderRequest]) -> Any:
        """Several Gtc limit orders. Through a trading account: one transaction, all or nothing. Otherwise one transaction each."""
        if self.mode == "account":
            calls, f0 = [], None
            books: Dict[str, Any] = {}
            for o in order_requests:
                f = self.info.fund(o["coin"])
                f0 = f0 or f
                books.setdefault(f["name"], self.info.raw_book(f["name"]))
                calls.append(self._limit_call(f, o["is_buy"], to_units(o["sz"]), to_units(o["limit_px"]), books[f["name"]])._encode_transaction_data())
            return self._send(self.account.functions.batch(calls), self._multi_parser([self.info.fund(o["coin"]) for o in order_requests]))
        return [self.order(o["coin"], o["is_buy"], o["sz"], o["limit_px"], o.get("order_type", GTC)) for o in order_requests]

    def _multi_parser(self, funds):
        seen, parsers = set(), []
        for f in funds:
            if f["name"] not in seen:
                seen.add(f["name"])
                parsers.append(self._order_parser(f))

        def parse(rc):
            statuses = []
            for p in parsers:
                statuses += p(rc)["data"]["statuses"]
            return {"type": "order", "data": {"statuses": statuses}}

        return parse

    def modify_order(self, oid: int, name: str, is_buy: bool, sz: float, limit_px: float) -> Any:
        """Cancel and replace. Through a trading account both happen in one transaction."""
        f = self.info.fund(name)
        if self.mode == "account":
            calls = [self._cancel_call(f, oid)._encode_transaction_data(), self._limit_call(f, is_buy, to_units(sz), to_units(limit_px))._encode_transaction_data()]
            return self._send(self.account.functions.batch(calls), self._order_parser(f))
        c = self.cancel(name, oid)
        if c["status"] == "err":
            return c
        return self.order(name, is_buy, sz, limit_px)

    def market_open(self, name: str, is_buy: bool, sz: float, px_: Optional[float] = None, slippage: float = 0.05) -> Dict[str, Any]:
        """Buy or sell `sz` tokens now, at no worse than the market price moved by `slippage`."""
        mid = px_ if px_ is not None else float(self.info.all_mids()[name])
        limit = mid * (1 + slippage) if is_buy else mid * (1 - slippage)
        return self.order(name, is_buy, sz, round(limit, 6), IOC)

    def market_close(self, name: str, sz: Optional[float] = None, slippage: float = 0.05) -> Dict[str, Any]:
        """Sell the position in `name` (all of it if no size is given)."""
        f = self.info.fund(name)
        have = f["tokenC"].functions.balanceOf(self.address).call()
        amount = have if sz is None else min(have, to_units(sz))
        if amount == 0:
            return {"status": "err", "response": "no position in " + name}
        return self.market_open(name, False, amount / ONE, None, slippage)

    def market_buy_usdc(self, name: str, usdc: float, slippage: float = 0.01) -> Dict[str, Any]:
        """Spend up to `usdc` (fee included) on whatever the book offers; refuses if it buys more than `slippage` fewer tokens than quoted."""
        f = self.info.fund(name)
        amount, ids = to_units(usdc), self.info.hints(name, True, None, exclude=self.address)
        quote = f["bookC"].functions.quoteBuy(amount, ids).call()[0]
        floor = int(quote * (1 - slippage))
        if self.mode == "vault":
            fn = self.vault.functions.buy(f["index"], amount, floor, ids)
        elif self.mode == "account":
            fn = self.account.functions.buyInBook(f["index"], amount, floor, ids)
        else:
            self._approve(self.info.usdc, f["book"])
            fn = f["bookC"].functions.buy(amount, floor, ids)
        return self._send(fn, self._order_parser(f))

    def cancel(self, name: str, oid: int) -> Dict[str, Any]:
        return self._send(self._cancel_call(self.info.fund(name), oid), lambda rc: {"type": "cancel", "data": {"statuses": ["success"]}})

    def bulk_cancel(self, cancel_requests: List[Dict[str, Any]]) -> Any:
        """[{"coin", "oid"}]. Through a trading account: one transaction."""
        if self.mode == "account":
            calls = [self._cancel_call(self.info.fund(c["coin"]), c["oid"])._encode_transaction_data() for c in cancel_requests]
            return self._send(self.account.functions.batch(calls), lambda rc: {"type": "cancel", "data": {"statuses": ["success"] * len(calls)}})
        return [self.cancel(c["coin"], c["oid"]) for c in cancel_requests]

    def cancel_all(self) -> Any:
        return self.bulk_cancel([{"coin": o["coin"], "oid": o["oid"]} for o in self.info.open_orders(self.address)])

    # ---- vaults -------------------------------------------------------
    def create_vault(self, name: str, description: str, usd: int) -> Dict[str, Any]:
        """Open a vault with `usd` (6-decimal integer, at least 100_000000) of the wallet's own mUSDC. The wallet becomes its leader."""
        fac = self.info.contract("VaultFactory", self.network["vaults"])
        self._approve(self.info.usdc, fac.address)
        return self._send(fac.functions.create(name, description, usd),
                          lambda rc: {"type": "createVault", "vaultAddress": fac.events.VaultCreated().process_receipt(rc, errors=DISCARD)[0]["args"]["vault"]}, force_wait=True)

    def vault_usd_transfer(self, vault_address: str, is_deposit: bool, usd: int) -> Dict[str, Any]:
        """Deposit `usd` (6-decimal integer) into a vault, or withdraw shares worth about `usd`.

        A withdrawal pays mUSDC: your fraction of the vault's cash plus what the market sale of your fraction of
        each position brings. At most 1% less than simulated just before sending.
        """
        v = self.info.contract("Vault", vault_address)
        if is_deposit:
            self._approve(self.info.usdc, v.address)
            return self._send(v.functions.deposit(usd, v.functions.convertToShares(usd).call() * 99 // 100), force_wait=True)
        mine = v.functions.balanceOf(self.wallet.address).call()
        price = v.functions.sharePrice().call()
        shares = min(mine, usd * ONE // price if price else mine)
        idx = v.functions.positions().call()[0]
        sym = {f["index"]: f["name"] for f in self.info.funds()}
        ids = [self.info.hints(sym[i], False, None, exclude=v.address) for i in idx]
        try:
            out = v.functions.redeem(shares, 0, ids).call({"from": self.wallet.address})
        except Exception as e:
            return {"status": "err", "response": _reason(e)}
        return self._send(v.functions.redeem(shares, out * 99 // 100, ids), lambda rc: {"type": "vaultTransfer", "shares": px(shares), "usdcSimulated": px(out)}, force_wait=True)

    # ---- agents -------------------------------------------------------
    def approve_agent(self, expiry_seconds: int = 86400, volume_cap_usd: int = 1_000_000 * ONE, max_premium_bps: int = 1000,
                      max_discount_bps: int = 2000, gas_eth: float = 0.002) -> Tuple[Dict[str, Any], str]:
        """Creates a fresh key that can trade and nothing else. Returns (result, private key).

        Vault mode: the leader names the key as an agent of the vault.
        Otherwise: a session key on the wallet's trading account (created if there is none), limited by expiry,
        volume and prices around NAV; `gas_eth` is sent to the key so it can pay for its transactions.
        """
        key = "0x" + secrets.token_hex(32)
        agent = Account.from_key(key).address
        if self.mode == "vault":
            return self._send(self.vault.functions.setAgent(agent, True), force_wait=True), key
        value, expiry = self.w3.to_wei(gas_eth, "ether"), int(time.time()) + expiry_seconds
        acct = self.account_address or self.info.trading_account(self.wallet.address)
        if acct:
            c = self.info.contract("TradingAccount", acct)
            r = self._send(c.functions.startSession(agent, expiry, volume_cap_usd, max_premium_bps, max_discount_bps), value=value, force_wait=True)
        else:
            fac = self.info.contract("TradingAccountFactory", self.network["trading_accounts"])
            r = self._send(fac.functions.create(agent, expiry, volume_cap_usd, max_premium_bps, max_discount_bps), value=value, force_wait=True)
            acct = self.info.trading_account(self.wallet.address)
        r["accountAddress"] = acct
        return r, key

    # ---- the rest -----------------------------------------------------
    def usd_transfer(self, amount: int, destination: str) -> Dict[str, Any]:
        """Send mUSDC from the wallet, for example into its trading account."""
        return self._send(self.info.usdc.functions.transfer(Web3.to_checksum_address(destination), amount), force_wait=True)

    def mint_test_usdc(self, amount: int, to: Optional[str] = None) -> Dict[str, Any]:
        """Test money: MockUSDC lets anyone mint."""
        return self._send(self.info.usdc.functions.mint(Web3.to_checksum_address(to or self.wallet.address), amount), force_wait=True)

    def claim_dividend(self, name: str, holder: Optional[str] = None) -> Dict[str, Any]:
        return self._send(self.info.fund(name)["fundC"].functions.claimDividend(Web3.to_checksum_address(holder or self.address)), force_wait=True)


def _reason(e: Exception) -> str:
    s = str(e)
    for cut in ("execution reverted: ", "revert "):
        if cut in s:
            s = s.split(cut, 1)[1]
    return s.strip("'\"() ,")[:200]
