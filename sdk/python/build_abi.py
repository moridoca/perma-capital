"""Writes perma/abi.json from the compiled contracts (run `node compile.js` in ../../test first)."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ART = json.load(open(os.path.join(HERE, "..", "..", "test", "artifacts.json")))
NAMES = ["UmbrellaFactory", "SubFund", "OrderBook", "MockUSDC", "FundToken", "Vault", "VaultFactory", "TradingAccount", "TradingAccountFactory"]
json.dump({n: ART[n]["abi"] for n in NAMES}, open(os.path.join(HERE, "perma", "abi.json"), "w"), separators=(",", ":"))
print("perma/abi.json written:", ", ".join(NAMES))
