// Live deployment the dashboard reads from. See scripts/perma/sepolia-deployment.json.
window.PERMA_CONFIG = {
  network: 'Sepolia testnet',
  chainId: 11155111,
  // Public read-only endpoints, tried in this order. No API key, no wallet needed for reading.
  rpcUrls: [
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://sepolia.gateway.tenderly.co',
    'https://1rpc.io/sepolia'
  ],
  explorer: 'https://sepolia.etherscan.io',
  umbrella: '0x15690c82c8aabda3F5689157ebF637A4F5c8e672',
  usdc: '0x232dA8232534064007557E29A9186240c567B64D',
  // Block shortly before the first sub-fund was created; event history is read from here.
  deployBlock: 12182250,
  logChunk: 9000,
  // Calls per HTTP request. One public endpoint rejects batches of 40, all accept 10.
  batch: 10,
  pollMs: 6000,
  // Fees suggested to the wallet. Sepolia's base fee is close to zero, so the tip is the
  // whole price; MetaMask's default tip of 1.5 gwei is 30 times this.
  fees: { priorityGwei: '0.05', maxGwei: '0.1' }
}
