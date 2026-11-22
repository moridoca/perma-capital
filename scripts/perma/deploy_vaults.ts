// Perma Capital - VaultFactory (leader-run vaults) through MetaMask
//
// How to run:
//   1. Compile contracts/perma/Vault.sol (optimizer on, 200 runs).
//   2. MetaMask on Sepolia or Arbitrum Sepolia; Deploy & Run: MetaMask environment.
//   3. Right-click this file -> Run. One confirmation.
//
// The factory is tied to the umbrella entered below. No umbrella for the chain: nothing is sent.
// Afterwards enter the printed address as vaults in docs/config.js.

import { ethers } from 'ethers'

const UMBRELLA: { [chainId: number]: string } = {
  11155111: '', // Sepolia: enter the umbrella of an order-book deployment (vaults do not work with the earlier pool contracts)
  421614: '' // Arbitrum Sepolia: deploy_arbitrum_sepolia.ts deploys the factory itself; enter an umbrella here only to add vaults to an existing deployment
}
// Lock on a vault deposit. Production would be 86400 (one day).
const VAULT_LOCK_SECONDS = 120
const FEES: { [chainId: number]: [string, string] } = { 11155111: ['0.05', '0.1'], 421614: ['0', '0.2'] }

const E: any = ethers
const v6 = !!E.BrowserProvider
const gwei = (s: string) => (v6 ? E.parseUnits(s, 'gwei') : E.utils.parseUnits(s, 'gwei'))
const ARTIFACT_DIRS = ['artifacts/', 'contracts/perma/artifacts/', 'contracts/artifacts/']
const artifact = async (name: string) => {
  for (const dir of ARTIFACT_DIRS) {
    try { return JSON.parse(await remix.call('fileManager', 'getFile', dir + name + '.json')) } catch (e) {}
  }
  throw new Error('Artifact for ' + name + ' not found. Compile Vault.sol first.')
}

;(async () => {
  try {
    const provider = v6 ? new E.BrowserProvider(web3Provider) : new E.providers.Web3Provider(web3Provider)
    const chainId = Number((await provider.getNetwork()).chainId)
    const umbrella = UMBRELLA[chainId]
    if (!umbrella) {
      console.log('STOPPED: chain id ' + chainId + ' has no PERMA umbrella in this script. Nothing was sent.')
      return
    }
    const signer = v6 ? await provider.getSigner(0) : provider.getSigner(0)
    console.log('=== VaultFactory -> chain ' + chainId + ' ===')
    console.log('  umbrella: ' + umbrella)
    const meta = await artifact('VaultFactory')
    console.log('  deploying ... confirm in MetaMask')
    const f = FEES[chainId]
    const c = await new E.ContractFactory(meta.abi, meta.data.bytecode.object, signer).deploy(umbrella, VAULT_LOCK_SECONDS, { maxPriorityFeePerGas: gwei(f[0]), maxFeePerGas: gwei(f[1]) })
    if (v6) await c.waitForDeployment(); else await c.deployed()
    const addr = c.target || c.address
    console.log('=== VaultFactory: ' + addr + ' ===')
    console.log('docs/config.js: vaults: \'' + addr + '\'')
  } catch (e: any) {
    console.log('DEPLOYMENT FAILED: ' + (e && e.message ? e.message : e))
  }
})()
