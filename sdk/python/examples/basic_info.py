"""Read-only: no key needed."""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from perma import Info, constants

info = Info(constants.ARBITRUM_SEPOLIA)
print("funds:", [u["name"] for u in info.meta()["universe"]])
print("market prices:", info.all_mids())
for v in info.vaults():
    print("vault", v["name"], "value", v["accountValue"], "share price", v["sharePrice"])
