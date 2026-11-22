"""Run a strategy built in the dashboard (Vaults > Strategy builder > Export) for a vault.

    python3 run_strategy.py strategy.json [rounds]

config.json: secret_key is the vault's leader or one of its agents, vault_address the vault.
"""
import json, sys

import example_utils
from perma import Exchange
from perma.strategy import Runner

address, info, exchange, cfg = example_utils.setup()
strategy = json.load(open(sys.argv[1]))
vault = Exchange(exchange.wallet, exchange.network, vault_address=cfg["vault_address"], info=info)
print("strategy", strategy.get("name"), "on vault", cfg["vault_address"], "in", strategy["fund"])
Runner(vault, strategy).run(int(sys.argv[2]) if len(sys.argv) > 2 else 0)
