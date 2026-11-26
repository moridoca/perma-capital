const assert = require('assert')
const { boot, openMarket, mark, U, E } = require('./chain')
const U6 = 10n ** 6n
const f6 = (x) => E.formatUnits(x, 6)
let n = 0
const ok = (name) => console.log('ok ' + String(++n).padStart(2) + ' - ' + name)
let PROV = null
const why = (e) => String(e.reason || '') + ' ' + String(e.shortMessage || '') + ' ' + String(e.message || '') + ' ' + String((e.revert && e.revert.args && e.revert.args[0]) || '')
// ganache does not return the revert text from estimateGas, so replay the call to read it
const fails = async (p, text) => {
  try { await (await p).wait() } catch (e) {
    let s = why(e)
    if (!s.includes(text) && e.transaction) { try { await PROV.call(e.transaction) } catch (e2) { s += why(e2) } }
    assert(s.includes(text), 'expected "' + text + '", got: ' + s.slice(0, 300)); return
  }
  assert.fail('expected a revert with "' + text + '"')
}

;(async () => {
  const LOCK = 600
  const w = await boot()
  PROV = w.provider
  const { accts, usdc, fund, token, book, send, umbrella } = w
  const [gp, alice, bob, carol, dave, eve, frank] = accts
  await openMarket(w, 1000000) // alice 600,000, bob 300,000, carol 100,000 pBUY; NAV 1.00; ladder 50,000
  const factory = await w.deploy('VaultFactory', [await umbrella.getAddress(), LOCK])
  const fAddr = await factory.getAddress()
  await send(usdc.mint(frank.address, U(1000000)))
  for (const a of [carol, dave, eve, frank]) await send(usdc.connect(a).approve(fAddr, E.MaxUint256))
  const bal = async (a) => [await usdc.balanceOf(a), await token.balanceOf(a)]

  // ---------- anyone opens a vault ----------
  await fails(factory.connect(dave).create('Momentum', 'x', U(99)), 'Vaults: first deposit below 100 mUSDC')
  await fails(factory.connect(dave).create('Momentum', 'x'.repeat(141), U(100)), 'Vaults: description up to 140 characters')
  await fails(factory.connect(dave).create('', 'x', U(100)), 'Vaults: name 1 to 32 characters')
  await send(factory.connect(dave).create('Momentum', 'Buys dips, sells rallies', U(10000)))
  assert.strictEqual(await factory.count(), 1n)
  const vault = w.at('Vault', await factory.vaults(0))
  const vAddr = await vault.getAddress()
  for (const a of [carol, eve, frank]) await send(usdc.connect(a).approve(vAddr, E.MaxUint256))
  {
    const i = await vault.info()
    assert.strictEqual(i.name_, 'Momentum'); assert.strictEqual(i.description_, 'Buys dips, sells rallies'); assert.strictEqual(i.leader_, dave.address)
    assert.strictEqual(await vault.asset(), await usdc.getAddress()); assert.strictEqual(await vault.totalAssets(), U(10000)); assert.strictEqual(await vault.convertToShares(U(500)), U(500)); assert.strictEqual(await vault.symbol(), 'VLT')
    assert.strictEqual(i.totalShares_, U(10000)); assert.strictEqual(i.value_, U(10000)); assert.strictEqual(i.sharePrice_, U6); assert.strictEqual(i.issuePrice_, U6)
    assert.strictEqual(i.leaderShares_, U(10000)); assert.strictEqual(i.lock_, BigInt(LOCK))
    await fails(vault.connect(eve).init(U(1)), 'Vault: only the factory, once')
  }
  ok('anyone opens a vault with at least 100 mUSDC of their own and is its leader; name and description fixed; shares are a token, first ones at 1.00')

  // ---------- deposits; the leader keeps at least 5% ----------
  await send(vault.connect(eve).deposit(U(40000), 0))
  await fails(vault.connect(carol).deposit(U(200000), 0), 'Vault: leader below 5%') // 10,000 of 250,000 = 4%
  await fails(vault.connect(carol).deposit(U(50000), U(50001)), 'Vault: too few shares')
  await send(vault.connect(carol).deposit(U(50000), U(50000)))
  assert.strictEqual(await vault.totalSupply(), U(100000)); assert.strictEqual(await vault.value(), U(100000))
  assert.strictEqual(await vault.balanceOf(eve.address), U(40000)); assert.strictEqual(await vault.basis(carol.address), U(50000))
  ok('deposits get shares at value per share; a deposit that would push the leader below 5% is refused')

  // ---------- only the leader trades, and only in the umbrella's books ----------
  await send(book.connect(alice).limitSell(U(30000), 999000n, [])) // order 0, rests between top bid and issue price
  await fails(vault.connect(eve).buy(0, U(1000), 0, [0]), 'Vault: only the leader or an agent')
  await fails(vault.connect(dave).buy(7, U(1000), 0, []), '') // no such sub-fund in the umbrella
  const v0 = await vault.value()
  await send(vault.connect(dave).buy(0, U(20000), 0, [0]))
  const held = await token.balanceOf(vAddr)
  { const exp = ((U(20000) - (U(20000) * 7n) / 10000n) * U6) / 999000n; assert(held >= exp && held - exp < U(1), 'bought at 0.9990 less the 0.07% taker fee') }
  {
    const p = await vault.positions()
    assert.deepStrictEqual([...p.index], [0n]); assert.strictEqual(p.tokens[0], held)
    const nav = await fund.navPerToken(), mkt = await fund.marketPrice()
    assert(mkt < nav)
    assert.strictEqual(p.prices[0], mkt, 'counts at the market price while that is below NAV')
    assert.strictEqual(await vault.value(), U(80000) + (held * mkt) / U6)
    assert.strictEqual(await vault.tokenPrice(0, true), nav, 'new shares are priced with tokens at NAV')
    assert(await vault.value() < v0, 'buying below NAV is not booked as a gain')
  }
  {
    // the leader's own wallet offers tokens far above NAV: the vault cannot be made to buy them
    const snap = await w.snap()
    await send(usdc.mint(dave.address, U(100000))); await send(usdc.connect(dave).approve(await fund.getAddress(), E.MaxUint256))
    const nav = await fund.navPerToken()
    await fails(vault.connect(dave).limitBuy(0, U(100), (nav * 106n) / 100n, []), 'Vault: price above NAV +5%')
    await fails(vault.connect(dave).limitSell(0, U(100), (nav * 44n) / 100n, []), 'Vault: price below NAV -55%')
    await send(book.connect(alice).limitSell(U(1000), 3000000n, [])) // stands in for the leader's own order at 3.00
    const o = await book.openOrders(), id = o[0][o[0].length - 1]
    await fails(vault.connect(dave).buy(0, U(60000), 0, [0, id]), 'Vault: fill above NAV +5%')
    await w.revert(snap)
  }
  ok('the leader buys ' + f6(held) + ' pBUY in the order book for the vault; nobody else can trade it, and no fill above NAV +5% or below NAV -55%; value ' + f6(v0) + ' -> ' + f6(await vault.value()))

  // ---------- pushing the market down does not make shares cheap ----------
  {
    const before = await vault.issuePrice(), mktBefore = await fund.marketPrice(), spBefore = await vault.sharePrice()
    await send(book.connect(bob).sell(U(20000), 0, []))
    const mkt = await fund.marketPrice(), nav = await fund.navPerToken()
    assert(mkt < (mktBefore * 96n) / 100n && mkt < nav, 'market pushed down')
    assert(await vault.issuePrice() >= before, 'issue price not lowered by the sale')
    assert(await vault.sharePrice() < spBefore, 'the value shown follows the market down')
    assert.strictEqual(await vault.tokenPrice(0, true), nav); assert.strictEqual(await vault.tokenPrice(0, false), mkt)
    const sh0 = await vault.totalSupply()
    const s = await w.snap(); await send(vault.connect(frank).deposit(U(1000), 0)); const got = (await vault.totalSupply()) - sh0; await w.revert(s)
    assert(got <= (U(1000) * U6) / before, 'no more shares for the money than before the sale')
    ok('a sale that moves the market from ' + f6(mktBefore) + ' to ' + f6(mkt) + ' lowers the value shown (' + f6(spBefore) + ' -> ' + f6(await vault.sharePrice()) + ' per share) but not the price of new shares (' + f6(await vault.issuePrice()) + ', tokens at NAV ' + f6(nav) + ')')
  }

  // ---------- resting orders stay part of the vault's value ----------
  {
    const v = await vault.value(), cash = await vault.cashTotal()
    await send(vault.connect(dave).limitSell(0, U(5000), 1500000n, []))
    await send(vault.connect(dave).limitBuy(0, U(1000), 600000n, []))
    assert.strictEqual(await vault.value(), v); assert.strictEqual(await vault.cashTotal(), cash)
    assert.strictEqual(await vault.tokensTotal(0), held)
    assert.strictEqual(await usdc.balanceOf(vAddr), cash - U(600)); assert.strictEqual(await token.balanceOf(vAddr), held - U(5000))
    const o = await vault.openOrders()
    assert.strictEqual(o.ids.length, 2); assert.deepStrictEqual([...o.isBuy], [false, true]); assert.deepStrictEqual([...o.tokens], [U(5000), U(1000)])
    await fails(vault.connect(eve).cancel(0, o.ids[0]), 'Vault: only the leader or an agent')
    await fails(vault.connect(dave).cancel(0, 0), 'Vault: not an open order of this vault')
    for (let k = 0; k < 6; k++) await send(vault.connect(dave).limitSell(0, U(10), 1600000n + BigInt(k), []))
    await fails(vault.connect(dave).limitSell(0, U(10), 1700000n, []), 'Vault: too many open orders')
    const o2 = await vault.openOrders()
    for (let k = 2; k < 8; k++) await send(vault.connect(dave).cancel(0, o2.ids[k]))
    assert.strictEqual((await vault.openOrders()).ids.length, 2); assert.strictEqual(await vault.value(), v)
    ok('limit orders of the vault rest in the book and still count in its value; at most 8 at a time; only the leader cancels')
  }

  // ---------- agents; shares can be passed on ----------
  {
    await fails(vault.connect(eve).setAgent(frank.address, true), 'Vault: only the leader')
    await send(vault.connect(dave).setAgent(frank.address, true))
    const t0 = await vault.tokensTotal(0)
    await send(vault.connect(frank).sell(0, U(100), 0, []))
    assert.strictEqual(await vault.tokensTotal(0), t0 - U(100))
    await send(vault.connect(dave).setAgent(frank.address, false))
    await fails(vault.connect(frank).sell(0, U(100), 0, []), 'Vault: only the leader or an agent')
    await fails(vault.connect(dave).transfer(frank.address, U(1)), "Vault: the leader's shares are not transferable")
    const snap = await w.snap()
    await send(vault.connect(eve).transfer(frank.address, U(10000)))
    assert.strictEqual(await vault.basis(frank.address), U(10000)); assert.strictEqual(await vault.basis(eve.address), U(30000))
    assert.strictEqual(await vault.unlockAt(frank.address), await vault.unlockAt(eve.address), 'the lock goes with the shares')
    await w.revert(snap)
    ok('an agent the leader names can trade for the vault and nothing else; depositors can pass shares on (what was paid for them and the lock go along), the leader cannot')
  }

  // ---------- lock, profit share, withdrawal in mUSDC ----------
  await fails(vault.connect(eve).redeem(U(40000), 0, []), 'Vault: deposit still locked')
  await w.warp(LOCK + 1)
  await fails(vault.connect(eve).redeem(U(40001), 0, []), 'Vault: not your shares')
  await fails(vault.connect(dave).redeem(U(6000), 0, []), 'Vault: leader below 5%') // 4,000 of 94,000
  await send(fund.deployCapital(gp.address, U(500000), 'PortCo A'))
  await mark(w, U(700000))
  {
    const value = await vault.value(), supply = await vault.totalSupply(), cash = await vault.cashTotal(), tokens = await vault.tokensTotal(0)
    const worth = (value * U(40000)) / supply
    assert(worth > U(40000), 'eve is in profit')
    const fee = ((worth - U(40000)) * 1000n) / 10000n, feeShares = (U(40000) * fee) / worth, burned = U(40000) - feeShares
    const cashPart = (cash * burned) / supply, tokenPart = (tokens * burned) / supply
    const q = await book.quoteSell(tokenPart, [])
    const [u0, t0] = await bal(eve.address), leader0 = await vault.balanceOf(dave.address)
    await fails(vault.connect(eve).redeem(U(40000), cashPart + q[0] + 1n, []), 'Vault: less mUSDC than asked for')
    await send(vault.connect(eve).redeem(U(40000), cashPart + q[0], []))
    const [u1, t1] = await bal(eve.address)
    assert.strictEqual(u1 - u0, cashPart + q[0], 'her cash part plus what the sale of her part of the position brought')
    assert.strictEqual(t1, t0, 'paid in mUSDC, no tokens'); assert.strictEqual(await vault.tokensTotal(0), tokens - tokenPart)
    assert.strictEqual(await vault.balanceOf(dave.address) - leader0, feeShares)
    assert.strictEqual(await vault.totalSupply(), supply - burned); assert.strictEqual(await vault.balanceOf(eve.address), 0n); assert.strictEqual(await vault.basis(eve.address), 0n)
    assert.strictEqual((await vault.openOrders()).ids.length, 2, 'free balances covered it: the orders stay')
    ok('after the lock a depositor withdraws ' + f6(u1 - u0) + ' mUSDC for shares counted at ' + f6(worth) + ': ' + f6(cashPart) + ' cash and ' + f6(q[0]) + ' from selling ' + f6(tokenPart) + ' pBUY at market (her slippage); 10% of the profit goes to the leader as ' + f6(feeShares) + ' shares; open orders untouched')
  }
  {
    // carol's part is larger than the free tokens: the vault's orders are cancelled to pay her
    const supply = await vault.totalSupply(), tokens = await vault.tokensTotal(0), value = await vault.value()
    const worth = (value * U(50000)) / supply, fee = worth > U(50000) ? ((worth - U(50000)) * 1000n) / 10000n : 0n, burned = U(50000) - (U(50000) * fee) / worth
    assert((tokens * burned) / supply > await token.balanceOf(vAddr), 'needs tokens that sit in an order')
    const [u0, t0] = await bal(carol.address)
    await send(vault.connect(carol).redeem(U(50000), 0, []))
    const [u1, t1] = await bal(carol.address)
    assert(u1 > u0 && t1 === t0); assert.strictEqual((await vault.openOrders()).ids.length, 0)
    assert.strictEqual(await vault.tokensTotal(0), tokens - (tokens * burned) / supply)
    ok('a withdrawal larger than the free balances cancels the vault\'s open orders and is paid in full; the leader cannot block it by staying invested')
  }
  {
    // no bids left in the book: the position part comes as tokens instead
    const snap = await w.snap()
    await send(book.connect(bob).sell(U(270000), 0, []))
    await fails(book.connect(bob).sell(U(100), 0, []), 'Book: nothing to sell into')
    const s = await vault.balanceOf(dave.address), tokens = await vault.tokensTotal(0), cash = await vault.cashTotal()
    assert.strictEqual(s, await vault.totalSupply())
    const [u0, t0] = await bal(dave.address)
    await send(vault.connect(dave).redeem(s, 0, []))
    const [u1, t1] = await bal(dave.address)
    assert.strictEqual(u1 - u0, cash); assert.strictEqual(t1 - t0, tokens)
    await w.revert(snap)
    ok('with no bids in the book the position part is paid out as tokens (' + f6(tokens) + ' pBUY), the cash part in mUSDC')
  }
  {
    // the leader is the last one in and takes the rest, fee shares included
    const s = await vault.balanceOf(dave.address)
    assert.strictEqual(s, await vault.totalSupply()); assert(s > U(10000))
    await send(vault.connect(dave).redeem(s, 0, []))
    assert.strictEqual(await vault.totalSupply(), 0n)
    assert.strictEqual(await usdc.balanceOf(vAddr), 0n); assert.strictEqual(await token.balanceOf(vAddr), 0n)
    ok('the leader withdraws like everyone else (' + f6(s) + ' shares, of which ' + f6(s - U(10000)) + ' from the profit share); the vault ends empty')
  }

  // ---------- dividends of the fund tokens a vault holds; no profit, no fee; closing ----------
  {
    await send(factory.connect(dave).create('Second', '', U(1000)))
    const v2 = w.at('Vault', await factory.vaults(1)), a2 = await v2.getAddress()
    await send(usdc.connect(frank).approve(a2, E.MaxUint256))
    await send(v2.connect(frank).deposit(U(9000), 0))
    await send(book.connect(alice).limitSell(U(5000), 1000n * 1250n, [])) // rests below the new issue price
    const open = await book.openOrders(), id = open[0][open[0].length - 1]
    await send(v2.connect(dave).buy(0, U(4000), 0, [id]))
    // the fund pays a dividend out of its surplus; the vault's tokens earn it
    const pot = (await fund.surplus()) / 2n
    await send(fund.proposeSurplusUse(2, pot)); const pid = await fund.issueProposalId()
    await send(fund.connect(alice).voteIssuance(U(520000))); await send(fund.connect(eve).executeIssuance()); await send(fund.connect(alice).withdrawIssuanceVotes(pid))
    const c0 = await v2.cashTotal()
    await send(fund.payDividend(pot))
    const due = await fund.dividendOf(a2)
    assert(due > 0n); assert.strictEqual(await v2.cashTotal(), c0 + due, 'uncollected dividends count as cash of the vault')
    const free0 = await usdc.balanceOf(a2)
    await send(v2.connect(eve).collectDividends())
    assert.strictEqual((await usdc.balanceOf(a2)) - free0, due); assert.strictEqual(await v2.cashTotal(), c0 + due)

    await send(v2.connect(dave).limitSell(0, U(1000), 1400000n, []))
    await mark(w, U(500000))
    assert(await v2.sharePrice() < U6, 'vault at a loss')
    await fails(v2.connect(frank).close(), 'Vault: only the leader')
    await fails(v2.connect(dave).close(), 'Vault: sell all positions first')
    await send(v2.connect(dave).cancel(0, (await v2.openOrders()).ids[0]))
    await send(v2.connect(dave).sell(0, await token.balanceOf(a2), 0, []))
    await send(v2.connect(dave).close())
    await fails(v2.connect(frank).deposit(U(100), 0), 'Vault: closed')
    await fails(v2.connect(dave).buy(0, U(100), 0, []), 'Vault: closed')
    const leader0 = await v2.balanceOf(dave.address), [u0, t0] = await bal(frank.address)
    await send(v2.connect(frank).redeem(U(9000) / 2n, 0, [])) // no lock once closed
    assert.strictEqual(await v2.balanceOf(dave.address), leader0, 'no profit, no fee')
    const [u1, t1] = await bal(frank.address)
    assert(u1 > u0 && t1 === t0)
    await send(v2.connect(frank).redeem(await v2.balanceOf(frank.address), 0, []))
    await send(v2.connect(dave).redeem(leader0, 0, [])) // a closed vault lets the leader out whatever the 5% rule says
    assert.strictEqual(await v2.totalSupply(), 0n); assert.strictEqual(await usdc.balanceOf(a2), 0n)
    ok('a vault collects the dividends of the fund tokens it holds (' + f6(due) + ' mUSDC); a depositor at a loss pays no profit share; the leader closes the vault once all positions are sold: no deposits or trades, everyone withdraws at once')
  }

  // ---------- gas ----------
  {
    await send(factory.connect(dave).create('Gas', '', U(1000)))
    const v3 = w.at('Vault', await factory.vaults(2))
    await send(usdc.connect(frank).approve(await v3.getAddress(), E.MaxUint256))
    const g = async (p) => Number((await send(p)).gasUsed)
    const c = await g(factory.connect(dave).create('Gas 2', 'A second one', U(1000)))
    const d = await g(v3.connect(frank).deposit(U(5000), 0))
    await send(book.connect(alice).limitSell(U(5000), 1250000n, []))
    const open = await book.openOrders(), id = open[0][open[0].length - 1]
    const b = await g(v3.connect(dave).buy(0, U(2000), 0, [id]))
    const l = await g(v3.connect(dave).limitSell(0, U(500), 1400000n, []))
    await w.warp(LOCK + 1)
    const r = await g(v3.connect(frank).redeem(U(1000), 0, []))
    ok('gas: open a vault ' + c.toLocaleString() + ', deposit ' + d.toLocaleString() + ', market buy ' + b.toLocaleString() + ', resting limit order ' + l.toLocaleString() + ', withdrawal with sale ' + r.toLocaleString())
  }
  console.log('\nall ' + n + ' passed')
  process.exit(0)
})().catch((e) => { console.error('FAIL', e); process.exit(1) })
