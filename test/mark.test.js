// Valuation: the GP's revaluation is a proposal with a bond and a report hash.
// Holders can dispute it with the same bond; then a holder vote decides and the
// losing side forfeits its bond to the winner.
const assert = require('assert')
const { boot, openMarket, U, E } = require('./chain')
const U6 = 10n ** 6n
let n = 0, PROV = null
const ok = (name) => console.log('ok ' + String(++n).padStart(2) + ' - ' + name)
const why = (e) => String(e.reason || '') + ' ' + String(e.shortMessage || '') + ' ' + String(e.message || '')
const fails = async (p, text) => {
  try { await (await p).wait() } catch (e) {
    let s = why(e)
    if (!s.includes(text) && e.transaction) { try { await PROV.call(e.transaction) } catch (e2) { s += why(e2) } }
    assert(s.includes(text), 'expected revert "' + text + '", got: ' + s.slice(0, 300)); return
  }
  assert.fail('expected revert: ' + text)
}

;(async () => {
  const w = await boot()
  PROV = w.provider
  const { accts, usdc, fund, token, book } = w
  const send = async (p) => (await p).wait()
  // ganache underestimates gas for calls that pull a bond and write several slots: those pass a fixed limit
  const warp = w.warpAtLeast
  const [gp, alice, bob, carol, dave, eve] = accts
  const fundAddr = await fund.getAddress()
  const VOTE = Number(await fund.VOTING_PERIOD())
  const H = (s) => E.id(s)

  await fails(fund.proposeMark(U(1), H('r'), 'x'), 'Fund: sale open')
  await openMarket(w, 1000000)
  await send(fund.deployCapital(eve.address, U(500000), 'PortCo A'))
  assert.strictEqual(await fund.investedValue(), U(500000))
  assert.strictEqual(await fund.navPerToken(), U6)
  let base = await w.snap()
  const reset = async () => { await w.revert(base); base = await w.snap() } // a ganache snapshot is used up by a revert
  ok('capital deployed at cost: NAV stays 1.00')

  // ---------- the GP can no longer set a value directly ----------
  assert.strictEqual(fund.interface.getFunction('markInvestments'), null, 'markInvestments is gone')
  await fails(fund.connect(alice).proposeMark(U(700000), H('r'), 'x'), 'Fund: only GP')
  await fails(fund.proposeMark(U(700000), E.ZeroHash, 'x'), 'Fund: report hash missing')
  // returnProceeds cannot be used to write the portfolio up, or down by more than the cash that came back
  await fails(fund.returnProceeds(U(100000), U(500001)), 'Fund: revalue via proposeMark')
  await fails(fund.returnProceeds(U(100000), U(399999)), 'Fund: revalue via proposeMark')
  ok('no direct revaluation: markInvestments removed, proposal needs a report hash, returnProceeds bounded by the cash returned')

  // ---------- undisputed: applies after the window, bond back ----------
  {
    const bond = await fund.markBond(U(700000))
    assert.strictEqual(bond, U(7000), 'bond 1% of the proposed value')
    assert.strictEqual(await fund.markBond(U(100)), U(10), 'at least 10 mUSDC')
    const g0 = await usdc.balanceOf(gp.address), na0 = await fund.netAssets(), fc0 = await fund.freeCash()
    await send(fund.proposeMark(U(700000), H('Q3 report'), 'Q3 2026'))
    assert.strictEqual(g0 - await usdc.balanceOf(gp.address), bond)
    assert.strictEqual(await fund.bondsHeld(), bond)
    assert.strictEqual(await fund.netAssets(), na0, 'the bond is not fund money: NAV unchanged')
    assert.strictEqual(await fund.freeCash(), fc0, 'and the GP cannot invest it')
    assert.strictEqual(await fund.investedValue(), U(500000), 'nothing applies yet')
    await fails(fund.proposeMark(U(1), H('r'), 'x'), 'Fund: valuation pending')
    await fails(fund.deployCapital(eve.address, U(1), 'x'), 'Fund: valuation pending')
    await fails(fund.returnProceeds(U(1), U(500000)), 'Fund: valuation pending')
    await fails(fund.connect(dave).resolveMark(), 'Fund: nothing to resolve')
    await warp(VOTE + 1)
    await fails(fund.connect(alice).disputeMark(), 'Fund: nothing to dispute')
    await send(fund.connect(dave).resolveMark({ gasLimit: 400000 }))
    assert.strictEqual(await fund.investedValue(), U(700000))
    assert.strictEqual(await fund.navPerToken(), 1200000n)
    assert.strictEqual(await fund.lastReportHash(), H('Q3 report'))
    assert.strictEqual(await usdc.balanceOf(gp.address), g0, 'bond returned')
    assert.strictEqual(await fund.bondsHeld(), 0n)
    const m = await fund.marks(1)
    assert.strictEqual(m.state, 3n)
    const l = await book.ladder()
    assert.strictEqual(l[0], 1200000n, 'ladder follows the new NAV')
    ok('undisputed +40%: bond 7,000 locked outside NAV, nothing moves for ' + VOTE + 's, then anyone resolves: NAV 1.20, ladder follows, report hash stored, bond back')
  }

  // ---------- disputed and rejected: disputer wins both bonds ----------
  await reset()
  {
    const g0 = await usdc.balanceOf(gp.address), b0 = await usdc.balanceOf(bob.address)
    await send(fund.proposeMark(U(1500000), H('inflated'), 'x3'))
    const bond = await fund.markBond(U(1500000))
    await fails(fund.disputeMark(), 'Fund: holders only')
    await fails(fund.connect(eve).disputeMark(), 'Fund: holders only') // eve holds no tokens
    await fails(fund.connect(alice).voteMark(false, U(1)), 'Fund: no dispute vote')
    await send(fund.connect(bob).disputeMark({ gasLimit: 400000 }))
    assert.strictEqual(b0 - await usdc.balanceOf(bob.address), bond)
    assert.strictEqual(await fund.bondsHeld(), 2n * bond)
    await fails(fund.connect(carol).disputeMark(), 'Fund: nothing to dispute')
    await fails(fund.voteMark(true, U(1)), 'Fund: GP cannot vote')
    await send(fund.connect(alice).voteMark(true, U(100000, { gasLimit: 400000 })))
    await send(fund.connect(bob).voteMark(false, U(250000, { gasLimit: 400000 })))
    await send(fund.connect(carol).voteMark(false, U(50000, { gasLimit: 400000 })))
    await fails(fund.connect(bob).withdrawMarkVotes(1), 'Fund: not resolved')
    await fails(fund.connect(dave).resolveMark(), 'Fund: nothing to resolve')
    assert.strictEqual(await fund.investedValue(), U(500000))
    await warp(VOTE + 1)
    await fails(fund.connect(dave).voteMark(true, U(1)), 'Fund: no dispute vote')
    await send(fund.connect(dave).resolveMark({ gasLimit: 400000 }))
    assert.strictEqual(await fund.investedValue(), U(500000), 'rejected: value unchanged')
    assert.strictEqual(await fund.navPerToken(), U6)
    assert.strictEqual(await usdc.balanceOf(bob.address), b0 + bond, 'disputer gets his bond back plus the GP\'s')
    assert.strictEqual(await usdc.balanceOf(gp.address), g0 - bond, 'GP loses his bond')
    assert.strictEqual(await fund.bondsHeld(), 0n)
    assert.strictEqual((await fund.marks(1)).state, 4n)
    const t0 = await token.balanceOf(bob.address)
    await send(fund.connect(bob).withdrawMarkVotes(1))
    assert.strictEqual(await token.balanceOf(bob.address) - t0, U(250000))
    await fails(fund.connect(bob).withdrawMarkVotes(1), 'Fund: nothing locked')
    ok('GP proposes x3 (bond ' + E.formatUnits(bond, 6) + '); Bob disputes with the same bond; vote 100k for vs 300k against: rejected, NAV stays 1.00, Bob receives both bonds, votes withdrawn')
  }

  // ---------- disputed but upheld: GP wins both bonds ----------
  await reset()
  {
    const g0 = await usdc.balanceOf(gp.address), b0 = await usdc.balanceOf(bob.address)
    await send(fund.proposeMark(U(650000), H('fair'), '+30%'))
    const bond = await fund.markBond(U(650000))
    await send(fund.connect(bob).disputeMark({ gasLimit: 400000 }))
    await send(fund.connect(alice).voteMark(true, U(300000, { gasLimit: 400000 })))
    await send(fund.connect(bob).voteMark(false, U(200000, { gasLimit: 400000 })))
    await warp(VOTE + 1)
    await send(fund.resolveMark({ gasLimit: 400000 }))
    assert.strictEqual(await fund.investedValue(), U(650000))
    assert.strictEqual(await fund.navPerToken(), 1150000n)
    assert.strictEqual(await usdc.balanceOf(gp.address), g0 + bond)
    assert.strictEqual(await usdc.balanceOf(bob.address), b0 - bond)
    ok('disputed but upheld 300k to 200k: value applies (NAV 1.15), the GP receives the disputer\'s bond')
  }

  // ---------- a tie rejects; nobody votes = tie ----------
  await reset()
  {
    await send(fund.proposeMark(U(800000), H('x'), 'x'))
    await send(fund.connect(carol).disputeMark({ gasLimit: 400000 }))
    await warp(VOTE + 1)
    await send(fund.resolveMark({ gasLimit: 400000 }))
    assert.strictEqual(await fund.investedValue(), U(500000))
    assert.strictEqual((await fund.marks(1)).state, 4n)
    ok('dispute without votes is a tie and rejects: the burden of proof is on the GP')
  }

  // ---------- write-downs go through the same process; proceeds still work ----------
  await reset()
  {
    await send(fund.proposeMark(U(400000), H('impairment'), '-20%'))
    await warp(VOTE + 1); await send(fund.resolveMark({ gasLimit: 400000 }))
    assert.strictEqual(await fund.navPerToken(), 900000n)
    // exit of a position: 200k back, remaining portfolio 200k (400k - 200k)
    await send(fund.returnProceeds(U(200000), U(200000)))
    assert.strictEqual(await fund.investedValue(), U(200000))
    assert.strictEqual(await fund.navPerToken(), 900000n, 'an exit at book value leaves NAV unchanged')
    // income without an exit: cash back, portfolio value unchanged
    await send(fund.returnProceeds(U(10000), U(200000)))
    assert.strictEqual(await fund.navPerToken(), 910000n)
    ok('write-down through a proposal (NAV 0.90); exit at book value and income through returnProceeds as before')
  }

  // ---------- money is only moved ----------
  await reset()
  {
    const all = [gp, alice, bob, carol, dave, eve]
    const total = async () => (await Promise.all(all.map((a) => usdc.balanceOf(a.address)))).reduce((a, b) => a + b, 0n)
      + await usdc.balanceOf(fundAddr) + await usdc.balanceOf(await book.getAddress())
    const t0 = await total()
    await send(fund.proposeMark(U(900000), H('a'), 'a')); await send(fund.connect(bob).disputeMark({ gasLimit: 400000 }))
    await send(fund.connect(alice).voteMark(true, U(10, { gasLimit: 400000 }))); await warp(VOTE + 1); await send(fund.resolveMark({ gasLimit: 400000 }))
    await send(fund.proposeMark(U(600000), H('b'), 'b')); await warp(VOTE + 1); await send(fund.resolveMark({ gasLimit: 400000 }))
    assert.strictEqual(await total(), t0, 'bonds are moved, never created or lost')
    const gas = Number((await send(fund.proposeMark(U(610000), H('c'), 'c'))).gasUsed)
    ok('bonds only change hands; a proposal costs ' + gas.toLocaleString('en') + ' gas')
  }
  process.exit(0)
})().catch((e) => { console.error(e); process.exit(1) })
