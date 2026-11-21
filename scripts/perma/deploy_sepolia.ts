// Perma Capital - deployment to Sepolia through MetaMask
//
// How to run:
//   1. Compile every .sol file in contracts/perma once (optimizer on, 200 runs).
//   2. MetaMask: switch to the Sepolia network. The account needs SepoliaETH for gas.
//   3. Deploy & Run tab: choose the MetaMask (browser extension) environment.
//   4. Right-click this file -> Run. MetaMask asks for one confirmation per
//      transaction: 4 deployments + 1 per sub-fund (7 in total).
//
// The script refuses to run on any chain other than Sepolia.
// Addresses are printed and saved to scripts/perma/sepolia-deployment.json.
// If a run stops halfway, paste the addresses already printed into EXISTING
// and run again: finished steps are skipped.

import { ethers } from 'ethers'

const SEPOLIA_CHAIN_ID = 11155111

// Demo clock. Production values would be 31536000 (365 days) and 604800 (7 days).
const YEAR_SECONDS = 300
const VOTING_SECONDS = 180

const SUB_FUNDS = [
  ['Perma Buyout', 'pBUY'],
  ['Perma Growth', 'pGRO'],
  ['Perma Agriculture', 'pAGR']
]

// Addresses of the live Sepolia deployment (21 Nov 2026). With all four set, a
// re-run deploys nothing and only prints the addresses again.
// Empty all four for a fresh deployment.
const EXISTING = {
  usdc: '0x232dA8232534064007557E29A9186240c567B64D',
  components: '0x4B93e16FC9d99580A4EB94ff8A5977790Ec62193',
  fundDeployer: '0x748148cBe50E7082733E085E295987553A63EF07',
  umbrella: '0x15690c82c8aabda3F5689157ebF637A4F5c8e672'
}

const OUT_FILE = 'scripts/perma/sepolia-deployment.json'

// Fees suggested to MetaMask. Sepolia's base fee is close to zero, so the tip is the
// whole price. MetaMask's default tip of 1.5 gwei makes these large deployments
// expensive (contract code costs far more gas on Sepolia than the old 200 gas/byte).
const PRIORITY_FEE_GWEI = '0.05'
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
    if (chainId !== SEPOLIA_CHAIN_ID) {
      console.log('STOPPED: connected chain id is ' + chainId + ', expected Sepolia (' + SEPOLIA_CHAIN_ID + ').')
      console.log('Nothing was sent. Switch MetaMask to Sepolia and choose the MetaMask environment in Deploy & Run.')
      return
    }

    const gp = v6 ? await provider.getSigner(0) : provider.getSigner(0)
    const gpAddress = await gp.getAddress()
    console.log('=== Perma Capital -> Sepolia ===')
    console.log('  deployer / GP: ' + gpAddress)
    try {
      console.log('  balance: ' + fmtEth(await provider.getBalance(gpAddress)) + ' SepoliaETH')
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

    const launched = Number(await umbrella.subFundCount())
    for (let i = launched; i < SUB_FUNDS.length; i++) {
      console.log('  launching ' + SUB_FUNDS[i][0] + ' ... confirm in MetaMask')
      await (await umbrella.createSubFund(SUB_FUNDS[i][0], SUB_FUNDS[i][1], FEES)).wait()
      console.log('  sub-fund launched: ' + SUB_FUNDS[i][0] + ' (' + SUB_FUNDS[i][1] + ')')
    }

    const out: any = {
      network: 'sepolia',
      chainId: SEPOLIA_CHAIN_ID,
      gp: gpAddress,
      yearSeconds: YEAR_SECONDS,
      votingSeconds: VOTING_SECONDS,
      usdc: addrOf(usdc),
      components: addrOf(components),
      fundDeployer: addrOf(fundDeployer),
      umbrella: addrOf(umbrella),
      subFunds: []
    }
    const count = Number(await umbrella.subFundCount())
    for (let i = 0; i < count; i++) {
      // overview returns: name, fund, token, pool, vesting, navPerToken, marketPrice, premiumBps, netAssets
      const o = await umbrella.overview(i)
      out.subFunds.push({ name: o[0], fund: o[1], token: o[2], pool: o[3], vesting: o[4] })
      console.log('  ' + o[0])
      console.log('      fund    ' + o[1])
      console.log('      token   ' + o[2])
      console.log('      pool    ' + o[3])
      console.log('      vesting ' + o[4])
    }

    try {
      await remix.call('fileManager', 'writeFile', OUT_FILE, JSON.stringify(out, null, 2))
      console.log('  saved ' + OUT_FILE)
    } catch (e) {
      console.log('  could not save ' + OUT_FILE + ' - copy the addresses above')
    }
    console.log('=== Deployment finished. UmbrellaFactory: ' + addrOf(umbrella) + ' ===')
  } catch (e: any) {
    console.log('DEPLOYMENT FAILED: ' + (e && e.message ? e.message : e))
  }
})()
