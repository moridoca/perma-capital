"""Place a limit order that rests, look at it, cancel it."""
import example_utils

address, info, exchange, _ = example_utils.setup()
coin = "pBUY"
mid = float(info.all_mids()[coin])
print("state:", info.user_state(address))
result = exchange.order(coin, True, 10, round(mid * 0.9, 4), {"limit": {"tif": "Gtc"}})  # far below the market: it rests
print(result)
if result["status"] == "ok":
    for status in result["response"]["data"]["statuses"]:
        if "resting" in status:
            print("open orders:", info.open_orders(address))
            print(exchange.cancel(coin, status["resting"]["oid"]))
