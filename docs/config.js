// Live deployments the dashboard can read from. Choose one with ?net=sepolia (default)
// or ?net=arbitrum; the chip next to the logo switches. Deployment records:
// scripts/perma/sepolia-deployment.json and scripts/perma/arbitrum-sepolia-deployment.json.
window.PERMA_NETWORKS = {
  sepolia: {
    network: 'Sepolia testnet',
    short: 'Sepolia',
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
    fees: { priorityGwei: '0.05', maxGwei: '0.1' },
    addChain: null
  },
  arbitrum: {
    network: 'Arbitrum Sepolia testnet',
    short: 'Arbitrum Sepolia',
    chainId: 421614,
    // Blocks every ~0.3 s. All three accept getLogs over 50,000 blocks (checked 21 Nov 2026).
    rpcUrls: [
      'https://arbitrum-sepolia-rpc.publicnode.com',
      'https://sepolia-rollup.arbitrum.io/rpc',
      'https://arbitrum-sepolia.gateway.tenderly.co'
    ],
    explorer: 'https://sepolia.arbiscan.io',
    // Filled in after deploy_arbitrum_sepolia.ts has run. Empty = not deployed yet.
    umbrella: '',
    usdc: '',
    deployBlock: 0,
    logChunk: 50000,
    batch: 10,
    pollMs: 2000,
    receiptMs: 250,
    // Arbitrum ignores the tip and charges only the base fee (0.02 gwei on 21 Nov 2026).
    // The cap only has to stay above it.
    fees: { priorityGwei: '0', maxGwei: '1' },
    // Lets MetaMask add the network if it does not know it yet.
    addChain: {
      chainName: 'Arbitrum Sepolia',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],
      blockExplorerUrls: ['https://sepolia.arbiscan.io']
    }
  }
}
;(function () {
  var key = new URLSearchParams(location.search).get('net')
  if (!window.PERMA_NETWORKS[key]) key = 'sepolia'
  window.PERMA_CONFIG = Object.assign({ key: key }, window.PERMA_NETWORKS[key])
})()
