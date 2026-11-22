"""An agent key: it can trade through your trading account, within limits, and can never withdraw.

Run the agent part on another machine if you like: it needs only the agent key and the account address.
"""
import example_utils
from eth_account import Account
from perma import Exchange

address, info, exchange, _ = example_utils.setup()
gas = 0.1 if exchange.network["name"] == "local" else 0.002  # ETH the agent gets for its own transactions
result, agent_key = exchange.approve_agent(expiry_seconds=3600, volume_cap_usd=10_000_000000, gas_eth=gas)
print(result)
account = result["accountAddress"]
print(exchange.usd_transfer(1_000_000000, account))  # 1,000 mUSDC for the agent to trade with

agent = Exchange(Account.from_key(agent_key), exchange.network, account_address=account, info=info)
coin = "pBUY"
mid = float(info.all_mids()[coin])
result = agent.bulk_orders([{"coin": coin, "is_buy": True, "sz": 10, "limit_px": round(mid * (0.99 - 0.001 * k), 4)} for k in range(3)])  # one transaction
print(result)
print(info.open_orders(account))
print(agent.cancel_all())  # one transaction
