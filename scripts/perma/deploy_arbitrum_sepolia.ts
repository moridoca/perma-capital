// Perma Capital - deployment to Arbitrum Sepolia through MetaMask
//
// How to run:
//   1. Compile every .sol file in contracts/perma once (optimizer on, 200 runs).
//   2. MetaMask: switch to Arbitrum Sepolia (chain id 421614). The account needs ETH on
//      Arbitrum Sepolia for gas: a faucet, or bridge SepoliaETH at bridge.arbitrum.io.
//   3. Deploy & Run tab: choose the MetaMask (browser extension) environment.
//   4. Right-click this file -> Run. MetaMask asks for one confirmation per
//      transaction: 5 deployments + 1 per sub-fund (8 in total).
//
// The script refuses to run on any chain other than Arbitrum Sepolia.
// Addresses are printed and saved to scripts/perma/arbitrum-sepolia-deployment.json.
// Afterwards enter umbrella, usdc and the printed deploy block under "arbitrum" in docs/config.js.
// If a run stops halfway, paste the addresses already printed into EXISTING
// and run again: finished steps are skipped.

import { ethers } from 'ethers'

const CHAIN_ID = 421614

// Demo clock. Production values would be 31536000 (365 days) and 604800 (7 days).
const YEAR_SECONDS = 300
const VOTING_SECONDS = 180

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
  tradingAccounts: ''
}

const OUT_FILE = 'scripts/perma/arbitrum-sepolia-deployment.json'

// Arbitrum ignores the tip and charges the base fee only (0.02 gwei on 21 Nov 2026).
// The cap just has to stay above it. Keep it low: the wallet must hold gas limit x cap
// for every deployment, and the large deployers have high gas limits.
const PRIORITY_FEE_GWEI = '0'
const MAX_FEE_GWEI = '0.1'

const E: any = ethers
const v6 = !!E.BrowserProvider
const addrOf = (c: any) => c.target || c.address
const fmtEth = (x: any) => (v6 ? E.formatEther(x) : E.utils.formatEther(x))
const gwei = (s: string) => (v6 ? E.parseUnits(s, 'gwei') : E.utils.parseUnits(s, 'gwei'))
const FEES = { maxPriorityFeePerGas: gwei(PRIORITY_FEE_GWEI), maxFeePerGas: gwei(MAX_FEE_GWEI) }

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
      console.log('STOPPED: connected chain id is ' + chainId + ', expected Arbitrum Sepolia (' + CHAIN_ID + ').')
      console.log('Nothing was sent. Switch MetaMask to Arbitrum Sepolia and choose the MetaMask environment in Deploy & Run.')
      return
    }

    const gp = v6 ? await provider.getSigner(0) : provider.getSigner(0)
    const gpAddress = await gp.getAddress()
    console.log('=== Perma Capital -> Arbitrum Sepolia ===')
    console.log('  deployer / GP: ' + gpAddress)
    try {
      console.log('  balance: ' + fmtEth(await provider.getBalance(gpAddress)) + ' ETH on Arbitrum Sepolia')
    } catch (e) {
      console.log('  balance: could not be read (RPC hiccup), continuing')
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
    const startBlock = Number(await provider.getBlockNumber())
    const launched = Number(await umbrella.subFundCount())
    for (let i = launched; i < SUB_FUNDS.length; i++) {
      console.log('  launching ' + SUB_FUNDS[i][0] + ' ... confirm in MetaMask')
      await (await umbrella.createSubFund(SUB_FUNDS[i][0], SUB_FUNDS[i][1], FEES)).wait()
      console.log('  sub-fund launched: ' + SUB_FUNDS[i][0] + ' (' + SUB_FUNDS[i][1] + ')')
    }

    const out: any = {
      network: 'arbitrum-sepolia',
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
    console.log('docs/config.js, network "arbitrum": umbrella ' + addrOf(umbrella) + ', usdc ' + addrOf(usdc) + ', tradingAccounts ' + addrOf(tradingAccounts) + (launched === 0 ? ', deployBlock ' + startBlock : ''))
  } catch (e: any) {
    console.log('DEPLOYMENT FAILED: ' + (e && e.message ? e.message : e))
  }
})()
