// Perma Capital - end-to-end demo on the Remix VM
//
// How to run:
//   1. Compile every .sol file in contracts/perma once. Remix only writes the
//      artifact (ABI) for the file you compile, not for the files it imports.
//   2. Deploy & Run tab: environment = Remix VM.
//   3. Right-click this file -> Run. Watch the terminal.
//
// The script plays the full life of one sub-fund in about three minutes:
// launch -> primary sale -> market opens -> capital deployed -> limit order
// next to the fund's ladder -> sell-off and rule-based buyback -> revaluation -> management fee and
// vesting -> token holders replace the GP -> exit proceeds compound.

import { ethers } from 'ethers'

// Demo clock. Production values would be 31536000 (365 days) and 604800 (7 days).
const YEAR_SECONDS = 60
const VOTING_SECONDS = 90

const SUB_FUNDS = [
  ['Perma Buyout', 'pBUY'],
  ['Perma Growth', 'pGRO'],
  ['Perma Agriculture', 'pAGR']
]

const E: any = ethers
const v6 = !!E.BrowserProvider
const units = (n: number) => (v6 ? E.parseUnits(String(n), 6) : E.utils.parseUnits(String(n), 6))
const fmt = (x: any) => Number(v6 ? E.formatUnits(x, 6) : E.utils.formatUnits(x, 6)).toLocaleString('en-US', { maximumFractionDigits: 4 })
const MAX = v6 ? E.MaxUint256 : E.constants.MaxUint256
const addrOf = (c: any) => c.target || c.address
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000))
const send = async (p: Promise<any>) => (await p).wait()

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
    const signer = async (i: number) => (v6 ? await provider.getSigner(i) : provider.getSigner(i))
    const [gp, alice, bob, carol, newGP, portfolioCo] = await Promise.all([0, 1, 2, 3, 4, 5].map(signer))
    const A = async (s: any) => await s.getAddress()

    const deploy = async (name: string, args: any[]) => {
      const meta = await artifact(name)
      const factory = new E.ContractFactory(meta.abi, meta.data.bytecode.object, gp)
      const c = await factory.deploy(...args)
      if (v6) await c.waitForDeployment()
      else await c.deployed()
      console.log('  deployed ' + name + ' at ' + addrOf(c))
      return c
    }
    const attach = async (name: string, address: string) => new E.Contract(address, (await artifact(name)).abi, gp)
    const now = async () => Number((await provider.getBlock('latest')).timestamp)
    const waitUntil = async (ts: number, why: string) => {
      const wait = ts - Math.floor(Date.now() / 1000) + 2
      if (wait > 0) {
        console.log('  ... waiting ' + wait + 's (' + why + ')')
        await sleep(wait)
      }
    }
    const mustFail = async (label: string, c: any, fn: string, args: any[]) => {
      try {
        if (v6) await c[fn].staticCall(...args)
        else await c.callStatic[fn](...args)
        console.log('  UNEXPECTED: ' + label + ' did not revert')
      } catch (e) {
        console.log('  blocked as designed: ' + label)
      }
    }

    console.log('=== 1. Umbrella and sub-funds ===')
    const usdc = await deploy('MockUSDC', [])
    const components = await deploy('ComponentDeployer', [])
    const fundDeployer = await deploy('SubFundDeployer', [addrOf(components)])
    const umbrella = await deploy('UmbrellaFactory', [addrOf(usdc), addrOf(fundDeployer), YEAR_SECONDS, VOTING_SECONDS])
    for (const [name, symbol] of SUB_FUNDS) {
      await send(umbrella.createSubFund(name, symbol))
      console.log('  sub-fund launched: ' + name + ' (' + symbol + ')')
    }

    const o = await umbrella.overview(0)
    const fund = await attach('SubFund', o.fund)
    const token = await attach('FundToken', o.token)
    const book = await attach('OrderBook', o.book)
    const vesting = await attach('GPVesting', o.vesting)
    console.log('  Perma Buyout  fund ' + o.fund)
    console.log('                token ' + o.token)
    console.log('                order book ' + o.book)
    console.log('                vesting ' + o.vesting)

    const status = async (label: string) => {
      const nav = await fund.navPerToken()
      const price = await fund.marketPrice()
      const prem = Number(await fund.premiumBps()) / 100
      console.log(
        '  [' + label + '] NAV ' + fmt(nav) + ' | market ' + fmt(price) + ' | ' +
        (prem < 0 ? 'discount ' : 'premium ') + Math.abs(prem).toFixed(2) + '% | net assets ' +
        fmt(await fund.netAssets()) + ' | supply ' + fmt(await token.totalSupply())
      )
    }

    console.log('=== 2. Primary sale at $1.00 ===')
    for (const [who, amount] of [[alice, 6000000], [bob, 3500000], [carol, 1000000]] as any[]) {
      await send(usdc.mint(await A(who), units(amount)))
      await send(usdc.connect(who).approve(o.fund, MAX))
      await send(usdc.connect(who).approve(o.book, MAX))
      await send(token.connect(who).approve(o.book, MAX))
      await send(token.connect(who).approve(o.fund, MAX))
    }
    await send(fund.connect(alice).buy(units(6000000)))
    console.log('  Alice bought 6,000,000 pBUY')
    await send(fund.connect(bob).buy(units(3500000)))
    console.log('  Bob bought 3,500,000 pBUY -> sale cap of 9,500,000 reached')
    await mustFail('nobody but the fund can mint tokens', token.connect(alice), 'mint', [await A(alice), 1])
    await send(fund.connect(carol).closeSale())
    const closedAt = await now()
    console.log('  sale closed; 475,000 mUSDC (5% of the sale cash) locked as fund-owned liquidity:')
    console.log('  bids in the order book in 0.2% steps from NAV down to NAV -50%; new tokens need a holder vote')
    await status('market open')

    console.log('=== 3. Capital goes to work ===')
    await send(fund.deployCapital(await A(portfolioCo), units(6000000), 'Acquisition: PortCo A'))
    await status('6.0M invested at cost')

    console.log('=== 4. Order book: a limit order of a holder next to the ladder of the fund ===')
    await mustFail('buying when nobody sells and no new tokens are approved', book.connect(carol), 'buy', [units(1000), 0, []])
    await mustFail('anyone but the GP proposing new tokens', fund.connect(carol), 'proposeIssuance', [units(1)])
    await send(fund.proposeIssuance(units(1000000)))
    await send(fund.connect(alice).voteIssuance(units(5000000)))
    await send(fund.connect(carol).executeIssuance())
    await send(fund.connect(alice).withdrawIssuanceVotes(1))
    console.log('  holders approved 1,000,000 new pBUY: on offer in the book at NAV +0.2%, to anyone')
    await send(book.connect(alice).limitSell(units(100000), units(1.001), []))
    console.log('  Alice offers 100,000 pBUY at $1.001, below the price of new tokens (NAV +0.2%)')
    const open = await book.openOrders()
    const quote = await book.quoteBuy(units(150000), [...open.ids])
    await send(book.connect(carol).buy(units(150000), quote.tokenOut, [...open.ids]))
    console.log('  Carol bought ' + fmt(quote.tokenOut) + ' pBUY for ' + fmt(quote.usdcSpent) + ' mUSDC: Alice first at $1.001, the rest newly issued at NAV +0.2%')
    await mustFail('cancelling a filled order', book.connect(alice), 'cancel', [0])
    await status('after the first trades')

    console.log('=== 5. Sell-off, discount, rule-based buyback ===')
    await mustFail('buyback without a discount', fund, 'buyback', [units(1000), []])
    const bobBefore = await token.balanceOf(await A(bob))
    await send(book.connect(bob).sell(units(250000), 0, []))
    const bobAfter = await token.balanceOf(await A(bob))
    console.log('  Bob sold ' + fmt(v6 ? bobBefore - bobAfter : bobBefore.sub(bobAfter)) + ' pBUY: the ladder took it on its way down; the market is now more than 10% below NAV')
    await status('after the sell-off')
    await send(fund.connect(carol).buyback(units(30000), []))
    await status('anyone triggered a 30,000 buyback: vault cash becomes fresh bids')

    console.log('=== 6. Revaluation: the ladder and the issue price follow NAV ===')
    await send(fund.markInvestments(units(7500000), 'Year-end valuation'))
    await status('portfolio marked 6.0M -> 7.5M')
    console.log('  issue price for the approved tokens is now ' + fmt(await book.issuePrice()) + ', still NAV +0.2%')

    console.log('=== 7. Management fee: 2% in tokens, locked for one year ===')
    await mustFail('fee before the year is over', fund, 'mintManagementFee', [])
    await waitUntil(closedAt + YEAR_SECONDS, 'year 1 passes')
    await send(fund.connect(bob).mintManagementFee())
    const fee1At = await now()
    await status('year 1 fee: 190,000 pBUY to vesting')
    await mustFail('GP claiming before vesting', vesting, 'claim', [])
    await waitUntil(Math.max(fee1At, closedAt + YEAR_SECONDS) + YEAR_SECONDS, 'year 2 passes')
    await send(fund.mintManagementFee())
    await send(vesting.claim())
    console.log('  GP claimed tranche 1: ' + fmt(await token.balanceOf(await A(gp))) + ' pBUY; tranche 2 still locked: ' + fmt(await vesting.unvested()))
    await status('year 2 fee minted')

    console.log('=== 8. Token holders replace the GP ===')
    await send(fund.connect(bob).proposeRemoveGP(await A(newGP)))
    await mustFail('GP voting on his own removal', fund, 'vote', [1])
    await send(fund.connect(alice).vote(units(5900000)))
    console.log('  Alice locked 5,900,000 votes; eligible supply ' + fmt(await fund.eligibleSupply()))
    await send(fund.connect(carol).executeRemoveGP())
    await send(fund.connect(alice).withdrawVotes(1))
    console.log('  GP is now ' + (await fund.gp()) + '; unvested fee tokens burned')
    await mustFail('old GP touching the portfolio', fund, 'markInvestments', [1, 'x'])
    await status('after GP change')

    console.log('=== 9. Exit: proceeds stay in the fund and compound ===')
    await send(usdc.mint(await A(newGP), units(9000000)))
    await send(usdc.connect(newGP).approve(o.fund, MAX))
    await send(fund.connect(newGP).returnProceeds(units(9000000), 0))
    await status('PortCo A sold for 9.0M')

    console.log('=== Umbrella overview ===')
    const count = Number(await umbrella.subFundCount())
    for (let i = 0; i < count; i++) {
      const s = await umbrella.overview(i)
      console.log('  ' + s.name + ': NAV ' + fmt(s.navPerToken) + ' | market ' + fmt(s.marketPrice) + ' | net assets ' + fmt(s.netAssets))
    }
    console.log('=== Demo finished ===')
  } catch (e) {
    console.log('DEMO FAILED: ' + (e && e.message ? e.message : e))
  }
})()
