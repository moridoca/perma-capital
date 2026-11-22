// Perma Capital - trial deployment to the HyperEVM testnet (Hyperliquid, chain id 998) through MetaMask
//
// A first step only: the contracts on Hyperliquid's EVM, to see them run there. The dashboard is not
// set up for this network (see README, "Trial: HyperEVM testnet").
//
// Before you run it:
//   1. MetaMask network: chain id 998, RPC https://rpc.hyperliquid-testnet.xyz/evm, currency HYPE.
//      The account needs test HYPE on the HyperEVM for gas.
//   2. Switch the account to BIG BLOCKS. HyperEVM's fast blocks hold 2 million gas; seven of the nine
//      transactions here need more (the largest, launching a sub-fund, about 8.3 million). Big blocks hold
//      30 million and come about once a minute. The switch is an action on HyperCore, not an EVM
//      transaction: with Hyperliquid's Python SDK, `exchange.use_big_blocks(True)` against the testnet API
//      (examples/basic_evm_use_big_blocks.py there). Switch back with False afterwards, or every later
//      transaction of this account waits for a big block.
//   3. Remix: compile every .sol file in contracts/perma once (optimizer on, 200 runs, EVM version paris),
//      Deploy & Run: MetaMask environment, right-click this file -> Run. Nine confirmations, each lands in
//      a big block, so allow about ten minutes.
//
// The script refuses to run on any other chain and stops if it can tell that big blocks are off.
// If a run stops halfway, paste the addresses already printed into EXISTING and run again.

import { ethers } from 'ethers'

const CHAIN_ID = 998

// Demo clock. Production values would be 31536000 (365 days) and 604800 (7 days).
const YEAR_SECONDS = 300
const VOTING_SECONDS = 180
// Lock on a vault deposit. Production would be 86400 (one day).
const VAULT_LOCK_SECONDS = 120

const SUB_FUNDS = [
  ['Perma Buyout', 'pBUY'],
  ['Perma Growth', 'pGRO'],
  ['Perma Agriculture', 'pAGR']
]

// Empty = deploy. If a run stops halfway, paste the addresses already printed here
// and run again: finished steps are skipped.
const EXISTING = {
  usdc: '',
  components: '',
  fundDeployer: '',
  umbrella: '',
  tradingAccounts: '',
  vaults: ''
}

const OUT_FILE = 'scripts/perma/hyperevm-testnet-deployment.json'

// Fees are read from the chain when the script starts (big blocks have their own base fee).

const E: any = ethers
const v6 = !!E.BrowserProvider
const addrOf = (c: any) => c.target || c.address
const fmtEth = (x: any) => (v6 ? E.formatEther(x) : E.utils.formatEther(x))
const gwei = (s: string) => (v6 ? E.parseUnits(s, 'gwei') : E.utils.parseUnits(s, 'gwei'))
let FEES: any = {}

const ARTIFACT_DIRS = ['artifacts/', 'contracts/perma/artifacts/', 'contracts/artifacts/']
const artifact = async (name: string) => {
  for (const dir of ARTIFACT_DIRS) {
    try {
      return JSON.parse(await remix.call('fileManager', 'getFile', dir + name + '.json'))
    } catch (e) {}
  }
  throw new Error('Artifact for ' + name + ' not found. Compile the contracts first.')
}

;(async () => {
  try {
    const provider = v6 ? new E.BrowserProvider(web3Provider) : new E.providers.Web3Provider(web3Provider)
    const chainId = Number((await provider.getNetwork()).chainId)
    if (chainId !== CHAIN_ID) {
      console.log('STOPPED: connected chain id is ' + chainId + ', expected the HyperEVM testnet (' + CHAIN_ID + ').')
      console.log('Nothing was sent. Switch MetaMask to the HyperEVM testnet and choose the MetaMask environment in Deploy & Run.')
      return
    }

    const gp = v6 ? await provider.getSigner(0) : provider.getSigner(0)
    const gpAddress = await gp.getAddress()
    console.log('=== Perma Capital -> HyperEVM testnet ===')
    console.log('  deployer / GP: ' + gpAddress)
    try {
      console.log('  balance: ' + fmtEth(await provider.getBalance(gpAddress)) + ' HYPE on the HyperEVM testnet')
    } catch (e) {
      console.log('  balance: could not be read (RPC hiccup), continuing')
    }

    // Big blocks: needed for the large deployments. Some wallets do not pass these two calls on; then go on and say so.
    try {
      const big = await provider.send('eth_usingBigBlocks', [gpAddress])
      if (big === false) {
        console.log('STOPPED: this account sends to small blocks (2 million gas). Nothing was sent.')
        console.log('Switch it to big blocks first: see the notes at the top of this file.')
        return
      }
      console.log('  big blocks: on')
    } catch (e) {
      console.log('  big blocks: could not be checked through this wallet. If a deployment fails with out of gas, they are off.')
    }
    try {
      const p = await provider.send('eth_bigBlockGasPrice', [])
      FEES = v6 ? { maxPriorityFeePerGas: 0n, maxFeePerGas: BigInt(p) * 3n } : { maxPriorityFeePerGas: 0, maxFeePerGas: E.BigNumber.from(p).mul(3) }
      console.log('  big-block base fee read; fee cap set to three times that')
    } catch (e) {
      FEES = {}
      console.log('  big-block base fee not available through this wallet: the wallet chooses the fee')
    }

    const deployOrAttach = async (name: string, args: any[], existing: string) => {
      const meta = await artifact(name)
      if (existing) {
        console.log('  using existing ' + name + ' at ' + existing)
        return new E.Contract(existing, meta.abi, gp)
      }
      console.log('  deploying ' + name + ' ... confirm in MetaMask')
      const factory = new E.ContractFactory(meta.abi, meta.data.bytecode.object, gp)
      const c = await factory.deploy(...args, FEES)
      if (v6) await c.waitForDeployment()
      else await c.deployed()
      console.log('  deployed ' + name + ' at ' + addrOf(c))
      return c
    }

    const usdc = await deployOrAttach('MockUSDC', [], EXISTING.usdc)
    const components = await deployOrAttach('ComponentDeployer', [], EXISTING.components)
    const fundDeployer = await deployOrAttach('SubFundDeployer', [addrOf(components)], EXISTING.fundDeployer)
    const umbrella = await deployOrAttach(
      'UmbrellaFactory',
      [addrOf(usdc), addrOf(fundDeployer), YEAR_SECONDS, VOTING_SECONDS],
      EXISTING.umbrella
    )

    const tradingAccounts = await deployOrAttach('TradingAccountFactory', [addrOf(umbrella)], EXISTING.tradingAccounts)
    const vaults = await deployOrAttach('VaultFactory', [addrOf(umbrella), VAULT_LOCK_SECONDS], EXISTING.vaults)
    const startBlock = Number(await provider.getBlockNumber())
    const launched = Number(await umbrella.subFundCount())
    for (let i = launched; i < SUB_FUNDS.length; i++) {
      console.log('  launching ' + SUB_FUNDS[i][0] + ' ... confirm in MetaMask')
      await (await umbrella.createSubFund(SUB_FUNDS[i][0], SUB_FUNDS[i][1], FEES)).wait()
      console.log('  sub-fund launched: ' + SUB_FUNDS[i][0] + ' (' + SUB_FUNDS[i][1] + ')')
    }

    const out: any = {
      network: 'hyperevm-testnet',
      chainId: CHAIN_ID,
      deployBlock: launched === 0 ? startBlock : null,
      gp: gpAddress,
      yearSeconds: YEAR_SECONDS,
      votingSeconds: VOTING_SECONDS,
      usdc: addrOf(usdc),
      components: addrOf(components),
      fundDeployer: addrOf(fundDeployer),
      umbrella: addrOf(umbrella),
      tradingAccounts: addrOf(tradingAccounts),
      vaults: addrOf(vaults),
      vaultLockSeconds: VAULT_LOCK_SECONDS,
      subFunds: []
    }
    const count = Number(await umbrella.subFundCount())
    for (let i = 0; i < count; i++) {
      // overview returns: name, fund, token, book, vesting, navPerToken, marketPrice, premiumBps, netAssets
      const o = await umbrella.overview(i)
      out.subFunds.push({ name: o[0], fund: o[1], token: o[2], book: o[3], vesting: o[4] })
      console.log('  ' + o[0])
      console.log('      fund    ' + o[1])
      console.log('      token   ' + o[2])
      console.log('      book    ' + o[3])
      console.log('      vesting ' + o[4])
    }

    try {
      await remix.call('fileManager', 'writeFile', OUT_FILE, JSON.stringify(out, null, 2))
      console.log('  saved ' + OUT_FILE)
    } catch (e) {
      console.log('  could not save ' + OUT_FILE + ' - copy the addresses above')
    }
    console.log('=== Deployment finished. UmbrellaFactory: ' + addrOf(umbrella) + ' ===')
    console.log('addresses (not in docs/config.js: the dashboard does not read this network): umbrella ' + addrOf(umbrella) + ', usdc ' + addrOf(usdc) + ', tradingAccounts ' + addrOf(tradingAccounts) + ', vaults ' + addrOf(vaults) + (launched === 0 ? ', deployBlock ' + startBlock : ''))
  } catch (e: any) {
    console.log('DEPLOYMENT FAILED: ' + (e && e.message ? e.message : e))
  }
})()
