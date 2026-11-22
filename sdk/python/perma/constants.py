"""Deployments the SDK knows. Amounts on-chain have 6 decimals (mUSDC and every fund token)."""

ARBITRUM_SEPOLIA = {
    "name": "arbitrum-sepolia",
    "chain_id": 421614,
    "rpc_url": "https://sepolia-rollup.arbitrum.io/rpc",
    "umbrella": "0x6a45Fd87609163Fe1BB19a5393ABf974D97ddC00",
    "usdc": "0x9944f1A0bd3C616eB09C694A90b4930384A6479A",
    "vaults": "0x4A171285495bB9AE8b9f3E004b202205647a1a73",
    "trading_accounts": "0xfB32e73a3dE3F0e3c057695D18cf6f58cAC57a6a",
    "deploy_block": 331747291,
    # Arbitrum charges the base fee only; the cap just has to stay above it.
    "max_fee_gwei": 0.2,
    "priority_fee_gwei": 0,
    "log_chunk": 50000,
}

DECIMALS = 6
ONE = 10**DECIMALS
MAX_UINT = 2**256 - 1
NO_ORDER = MAX_UINT  # what limitBuy / limitSell return as id when nothing is left to rest
