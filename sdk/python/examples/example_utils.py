import json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from eth_account import Account
from perma import Exchange, Info, constants

HERE = os.path.dirname(os.path.abspath(__file__))


def setup():
    """Returns (address, info, exchange, config) from examples/config.json."""
    cfg = json.load(open(os.path.join(HERE, "config.json")))
    if cfg["network"] == "local":
        net = json.load(open(os.path.join(HERE, "..", "..", "..", "test", "chain.json")))
    else:
        net = constants.ARBITRUM_SEPOLIA
    wallet = Account.from_key(cfg["secret_key"])
    info = Info(net)
    print("wallet", wallet.address, "on", net["name"])
    return wallet.address, info, Exchange(wallet, net, info=info), cfg
