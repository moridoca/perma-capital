"""Trade for a vault you lead (or are an agent of): the same calls, with vault_address set."""
import example_utils
from perma import Exchange

address, info, exchange, cfg = example_utils.setup()
vault = cfg["vault_address"]
if not vault:
    result = exchange.create_vault("My vault", "Opened with the Python SDK", 100_000000)  # 100 mUSDC of your own
    print(result)
    vault = result["response"]["vaultAddress"]
vault_exchange = Exchange(exchange.wallet, exchange.network, vault_address=vault, info=info)
coin = "pBUY"
mid = float(info.all_mids()[coin])
result = vault_exchange.order(coin, True, 5, round(mid * 0.9, 4))
print(result)
print(info.vault_details(vault, address))
if result["status"] == "ok":
    for status in result["response"]["data"]["statuses"]:
        if "resting" in status:
            print(vault_exchange.cancel(coin, status["resting"]["oid"]))
