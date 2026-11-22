"""Python SDK for the PERMA prototype: read the funds, trade in their order books, run and use vaults.

Shaped after the Hyperliquid Python SDK (Info for reading, Exchange for acting, vault_address and
agents), but everything here is a contract call on an EVM chain: there is no off-chain API server.
"""
from .info import Info
from .exchange import Exchange
from . import constants

__all__ = ["Info", "Exchange", "constants"]
