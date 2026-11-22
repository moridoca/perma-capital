// Local chain + deployment helpers shared by the tests.
const ganache = require('ganache'), { ethers: E } = require('ethers'), fs = require('fs'), path = require('path')
const ART = JSON.parse(fs.readFileSync(path.join(__dirname, 'artifacts.json'), 'utf8'))
const U = (n) => E.parseUnits(String(n), 6)
async function boot(opts = {}) {
  const gp = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai', chainId: 421614 }, wallet: { totalAccounts: 10, defaultBalance: 1000 }, miner: { blockGasLimit: 30000000 } })
  const provider = new E.BrowserProvider(gp, 421614)
  const accts = await provider.listAccounts()
  const deploy = async (name, args, from) => { const f = new E.ContractFactory(ART[name].abi, ART[name].bytecode, from || accts[0]); const c = await f.deploy(...args); await c.waitForDeployment(); return c }
  const at = (name, addr, s) => new E.Contract(addr, ART[name].abi, s || accts[0])
  const usdc = await deploy('MockUSDC', [])
  const components = await deploy('ComponentDeployer', [])
  const fundDeployer = await deploy('SubFundDeployer', [await components.getAddress()])
  const umbrella = await deploy('UmbrellaFactory', [await usdc.getAddress(), await fundDeployer.getAddress(), opts.year || 300, opts.voting || 180])
  for (const [n, s] of opts.funds || [['Perma Buyout', 'pBUY']]) await (await umbrella.createSubFund(n, s)).wait()
  const accounts = await deploy('TradingAccountFactory', [await umbrella.getAddress()])
  const o = await umbrella.overview(0)
  const fund = at('SubFund', o.fund), token = at('FundToken', o.token), book = at('OrderBook', o.book), vesting = at('GPVesting', o.vesting)
  const send = async (p) => (await p).wait()
  const snap = () => gp.request({ method: 'evm_snapshot', params: [] })
  const revert = (id) => gp.request({ method: 'evm_revert', params: [id] })
  const warp = async (s) => { await gp.request({ method: 'evm_increaseTime', params: [s] }); await gp.request({ method: 'evm_mine', params: [] }) }
  return { gp, provider, accts, deploy, at, usdc, components, fundDeployer, umbrella, accounts, fund, token, book, vesting, send, snap, revert, warp, o, ART }
}
// Primary sale of `sold` tokens split over the buyers, then close: the book is seeded with sold/19.
async function openMarket(w, sold = 1000000) {
  const { accts, usdc, fund, token, book, send } = w
  const MAX = E.MaxUint256
  for (const a of accts.slice(1, 6)) {
    await send(usdc.mint(a.address, U(5000000)))
    for (const sp of [fund, book]) { await send(usdc.connect(a).approve(await sp.getAddress(), MAX)); await send(token.connect(a).approve(await sp.getAddress(), MAX)) }
  }
  await send(fund.connect(accts[1]).buy(U(sold * 0.6)))
  await send(fund.connect(accts[2]).buy(U(sold * 0.3)))
  await send(fund.connect(accts[3]).buy(U(sold * 0.1)))
  await send(fund.closeSale())
}
module.exports = { boot, openMarket, U, E, ART }
