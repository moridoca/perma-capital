// A local chain over HTTP (127.0.0.1:8545) with everything deployed and a market open. For the Python SDK
// tests and for trying the examples without a testnet: node serve.js, then see sdk/python/README.md.
// Accounts are ganache's deterministic ones; chain.json holds the addresses.
const ganache = require('ganache'), { ethers: E } = require('ethers'), fs = require('fs'), path = require('path')
const ART = JSON.parse(fs.readFileSync(path.join(__dirname, 'artifacts.json'), 'utf8'))
const U = (n) => E.parseUnits(String(n), 6)
;(async () => {
  const server = ganache.server({ logging: { quiet: true }, chain: { hardfork: 'shanghai', chainId: 421614 }, wallet: { totalAccounts: 10, defaultBalance: 1000, deterministic: true }, miner: { blockGasLimit: 30000000 } })
  await server.listen(Number(process.env.PORT || 8545))
  const provider = new E.BrowserProvider(server.provider, 421614), accts = await provider.listAccounts()
  const deploy = async (name, args) => { const c = await new E.ContractFactory(ART[name].abi, ART[name].bytecode, accts[0]).deploy(...args); await c.waitForDeployment(); return c }
  const send = async (p) => (await p).wait()
  const usdc = await deploy('MockUSDC', []), comp = await deploy('ComponentDeployer', []), fd = await deploy('SubFundDeployer', [await comp.getAddress()])
  const deployBlock = await provider.getBlockNumber()
  const umbrella = await deploy('UmbrellaFactory', [await usdc.getAddress(), await fd.getAddress(), 300, 180])
  for (const [n, s] of [['Perma Buyout', 'pBUY'], ['Perma Growth', 'pGRO']]) await send(umbrella.createSubFund(n, s))
  const accounts = await deploy('TradingAccountFactory', [await umbrella.getAddress()])
  const vaults = await deploy('VaultFactory', [await umbrella.getAddress(), Number(process.env.LOCK || 3)])
  const o = await umbrella.overview(0)
  const fund = new E.Contract(o.fund, ART.SubFund.abi, accts[0]), token = new E.Contract(o.token, ART.FundToken.abi, accts[0])
  // accounts 1-3 buy in the sale; the GP (account 0) closes it and deploys capital
  for (const a of accts.slice(1, 8)) { await send(usdc.mint(a.address, U(3000000))); await send(usdc.connect(a).approve(o.fund, E.MaxUint256)); await send(token.connect(a).approve(o.fund, E.MaxUint256)) }
  await send(fund.connect(accts[1]).buy(U(600000))); await send(fund.connect(accts[2]).buy(U(300000))); await send(fund.connect(accts[3]).buy(U(100000)))
  await send(fund.closeSale())
  await send(fund.deployCapital(accts[9].address, U(400000), 'Acquisition: PortCo A'))
  // holders approve new tokens, so there is something to buy above NAV
  await send(fund.proposeIssuance(U(500000))); await send(fund.connect(accts[1]).voteIssuance(U(520000))); await send(fund.connect(accts[3]).executeIssuance()); await send(fund.connect(accts[1]).withdrawIssuanceVotes(1))
  fs.writeFileSync(path.join(__dirname, 'chain.json'), JSON.stringify({ name: 'local', chain_id: 421614, rpc_url: 'http://127.0.0.1:' + (process.env.PORT || 8545), umbrella: await umbrella.getAddress(), usdc: await usdc.getAddress(),
    vaults: await vaults.getAddress(), trading_accounts: await accounts.getAddress(), deploy_block: deployBlock, max_fee_gwei: 3, priority_fee_gwei: 0, log_chunk: 5000,
    mnemonic: 'myth like bonus scare over problem client lizard pioneer submit female collect' }, null, 1))
  console.log('READY')
})().catch((e) => { console.error(e); process.exit(1) })
