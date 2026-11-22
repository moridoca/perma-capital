"""Deposit into a vault, later withdraw. Amounts are 6-decimal integers: 5_000000 = 5 mUSDC."""
import example_utils

address, info, exchange, cfg = example_utils.setup()
vault = cfg["vault_address"] or info.vault_addresses()[0]
print(exchange.vault_usd_transfer(vault, True, 5_000000))
print(info.user_vault_equities(address))
# After the vault's lock (one day in production, 120 s on the test deployment):
# print(exchange.vault_usd_transfer(vault, False, 5_000000))
