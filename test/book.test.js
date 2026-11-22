const assert = require('assert'), fs = require('fs'), path = require('path')
const { boot, openMarket, U, E } = require('./chain')
const U6 = 10n ** 6n
// The dashboard's own maths, cut out of docs/app.js: what the page previews is checked against the contract.
const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app.js'), 'utf8')
const STEPS = Number(process.env.STEPS || 150)
const cutAt = (s) => { const a = s.indexOf('// >>> book maths'), b = s.indexOf('// <<< book maths'); assert(a >= 0 && b > a, 'book maths markers'); return s.slice(a, b) }
const M = new Function('U6', cutAt(SRC) + '\nreturn { bookMatch, bookBuy, bookSell, bookHints, bookSpot, bookFee, BOOK_NO_CAP }')(U6)
const f6 = (x) => E.formatUnits(x, 6)
let n = 0
const ok = (name) => console.log('ok ' + String(++n).padStart(2) + ' - ' + name)
let PROV = null
const why = (e) => String(e.reason || '') + ' ' + String(e.shortMessage || '') + ' ' + String(e.message || '') + ' ' + String((e.revert && e.revert.args && e.revert.args[0]) || '')
// ganache does not return the revert text from estimateGas, so replay the call to read it
const fails = async (p, text) => { try { await (await p).wait() } catch (e) { let s = why(e); if (!s.includes(text) && e.transaction) { try { await PROV.call(e.transaction) } catch (e2) { s += why(e2) } } assert(s.includes(text), 'expected revert "' + text + '", got: ' + s.slice(0, 300)); return } assert.fail('expected revert: ' + text) }

;(async () => {
  const w = await boot()
  PROV = w.provider
  const { accts, usdc, fund, token, book, send } = w
  const [gp, alice, bob, carol, dave, eve] = accts
  const bookAddr = await book.getAddress(), fundAddr = await fund.getAddress()

  const lad = async () => { const l = await book.ladder(); return { nav: l[0], prices: [...l[1]], tokens: [...l[2]], cash: [...l[3]] } }
  const open = async () => { const o = await book.openOrders(); return o[0].map((id, k) => ({ id, maker: o[1][k], isBuy: o[2][k], price: o[3][k], tokens: o[4][k] })) }
  // Every unit in the book is either the fund's ladder or a holder's escrow.
  const invariant = async (label) => {
    const [inv, tb, ub, os] = await Promise.all([book.inventory(), token.balanceOf(bookAddr), usdc.balanceOf(bookAddr), open()])
    const l = await lad()
    assert.strictEqual(l.tokens.reduce((a, b) => a + b, 0n), inv[0], label + ': ladder tokens = inventory')
    assert.strictEqual(l.cash.reduce((a, b) => a + b, 0n), inv[1], label + ': ladder cash = inventory')
    let escT = 0n, escC = 0n
    for (const o of os) { const full = await book.orders(o.id); if (o.isBuy) escC += full.cash; else escT += full.tokens }
    assert.strictEqual(tb, inv[0] + escT, label + ': token balance = ladder + sell escrow')
    assert.strictEqual(ub, inv[1] + escC, label + ': usdc balance = ladder + buy escrow')
  }

  // ---------- before the sale closes ----------
  assert.strictEqual(await book.spotPrice(), 0n)
  await fails(book.connect(alice).buy(U(100), 0, []), 'Book: market not open')
  await fails(book.connect(alice).seed(U(10), U(10)), 'Book: only the fund')
  ok('closed before the sale ends; only the fund can seed')

  await openMarket(w, 1000000)
  await fails(fund.closeSale(), 'Fund: sale closed')
  const seed = U(1000000) / 19n
  {
    const l = await lad()
    assert.strictEqual(l.nav, U6, 'NAV 1.00 after close')
    for (let k = 0; k < 10; k++) {
      assert.strictEqual(l.prices[k], (U6 * BigInt(9000 + k * 100)) / 10000n)       // 0.90 … 0.99
      assert.strictEqual(l.prices[10 + k], (U6 * BigInt(10100 + k * 100)) / 10000n) // 1.01 … 1.10
      assert.strictEqual(l.tokens[k], 0n); assert.strictEqual(l.cash[10 + k], 0n)
    }
    const per = seed / 10n
    for (let k = 1; k < 10; k++) { assert.strictEqual(l.tokens[10 + k], per); assert.strictEqual(l.cash[k - 1], per) }
    assert.strictEqual(l.tokens[10], per + (seed - per * 10n)); assert.strictEqual(l.cash[9], per + (seed - per * 10n))
    assert.strictEqual(await book.spotPrice(), U6); assert.strictEqual(await fund.marketPrice(), U6)
    assert.strictEqual(await fund.premiumBps(), 0n)
    assert.strictEqual(await fund.outstandingSupply(), U(1000000)); assert.strictEqual(await fund.netAssets(), U(1000000))
    assert.strictEqual(M.bookSpot(l), U6)
  }
  await invariant('seed')
  ok('ladder seeded: 10 bids at NAV -1%..-10%, 10 asks at NAV +1%..+10%, equal sizes; NAV 1.0000, market 1.0000')
  const base = await w.snap()
  const reset = async () => { await w.revert(base); return w.snap() }

  // ---------- market buy against the ladder ----------
  {
    const l = await lad(), q = await book.quoteBuy(U(10000), [])
    const sim = M.bookBuy(U(10000), l, [])
    assert.strictEqual(q[0], sim.tokens); assert.strictEqual(q[1], sim.cash + sim.fee); assert.strictEqual(q[2], sim.last)
    const [u0, t0, v0] = await Promise.all([usdc.balanceOf(alice.address), token.balanceOf(alice.address), usdc.balanceOf(fundAddr)])
    await send(book.connect(alice).buy(U(10000), (sim.tokens * 99n) / 100n, []))
    const [u1, t1, v1] = await Promise.all([usdc.balanceOf(alice.address), token.balanceOf(alice.address), usdc.balanceOf(fundAddr)])
    assert.strictEqual(t1 - t0, sim.tokens); assert.strictEqual(u0 - u1, sim.cash + sim.fee); assert.strictEqual(v1 - v0, sim.fee)
    assert(u0 - u1 <= U(10000))
    const avg = Number(u0 - u1) / Number(t1 - t0)
    assert(avg > 1.01 && avg < 1.02, 'average price between the first two rungs: ' + avg)
    const l2 = await lad()
    assert.strictEqual(l2.tokens[10], 0n); assert(l2.cash[10] > 0n, 'the rung that sold now holds cash')
    await invariant('market buy')
    ok('market buy of 10,000 mUSDC: ' + f6(sim.tokens) + ' tokens at avg ' + avg.toFixed(4) + ' (was +19% in the pool); fee ' + f6(sim.fee) + ' to the fund; preview = contract')

    // the rung that sold buys back at the same price
    const qs = await book.quoteSell(U(1000), [])
    const sims = M.bookSell(U(1000), l2, [])
    assert.strictEqual(qs[0], sims.cash - sims.fee); assert.strictEqual(qs[1], sims.tokens)
    assert.strictEqual(sims.last, l2.prices[11], 'sells into the partly filled rung at +2%')
    await send(book.connect(alice).sell(U(1000), 0, []))
    await invariant('sell back')
    ok('a rung that sold buys back at its own price: selling 1,000 right after fills at ' + f6(sims.last))
  }

  // ---------- slippage, empty book, partial fills ----------
  await reset()
  {
    await fails(book.connect(alice).buy(U(1000), U(1000), []), 'Book: slippage')
    await fails(book.connect(alice).sell(U(1000), U(1000), []), 'Book: slippage')
    // buy far more than the ladder holds: gets every token on it, pays only for those
    const l = await lad(), sim = M.bookBuy(U(4000000), l, [])
    assert.strictEqual(sim.tokens, seed)
    const u0 = await usdc.balanceOf(alice.address)
    await send(book.connect(alice).buy(U(4000000), 0, []))
    assert.strictEqual(u0 - await usdc.balanceOf(alice.address), sim.cash + sim.fee)
    assert((await book.inventory())[0] === 0n)
    await fails(book.connect(alice).buy(U(100), 0, []), 'Book: nothing to buy')
    assert.strictEqual(await book.spotPrice(), (await lad()).prices[19], 'ladder sold out: price at the top of the band')
    await invariant('sold out')
    ok('slippage limits hold; a buy larger than the ladder takes all of it and pays only for that; market then sits at NAV +10%')
  }

  // ---------- limit orders ----------
  await reset()
  {
    await fails(book.connect(bob).limitSell(U(1) - 1n, U(1), []), 'Book: order below 1 token')
    await fails(book.connect(bob).limitSell(U(10), 0, []), 'Book: bad price')
    // Bob offers 5,000 at 1.005 (inside the ladder's spread), Carol 3,000 at 1.0150, Alice 2,000 at 1.005 (later, same price); Dave takes
    await send(book.connect(bob).limitSell(U(5000), 1005000n, []))
    await send(book.connect(carol).limitSell(U(3000), 1015000n, []))
    await send(book.connect(alice).limitSell(U(2000), 1005000n, []))
    let os = await open()
    assert.strictEqual(os.length, 3)
    assert.strictEqual(await book.spotPrice(), U6, 'holders\' orders do not move the ladder price')
    await invariant('three asks')

    await fails(book.connect(alice).buy(U(20000), 0, [1n, 0n]), 'Book: orders not sorted')          // 1.015 before 1.005
    await fails(book.connect(alice).buy(U(20000), 0, [0n, 0n]), 'Book: orders not sorted')          // the same order twice
    await fails(book.connect(alice).buy(U(20000), 0, [2n, 0n]), 'Book: orders not sorted')          // same price: lower id first
    await fails(book.connect(alice).sell(U(100), 0, [0n]), 'Book: order on the wrong side')
    await send(book.connect(dave).buy(U(50), 0, [1n, 0n])) // named orders are only checked when the trade reaches them
    await w.revert(await w.snap())

    const hints = M.bookHints(true, os, null)
    assert.deepStrictEqual(hints.map((o) => o.id), [0n, 2n, 1n])
    const l = await lad(), sim = M.bookBuy(U(20000), l, hints)
    const q = await book.quoteBuy(U(20000), hints.map((o) => o.id))
    assert.strictEqual(q[0], sim.tokens); assert.strictEqual(q[1], sim.cash + sim.fee)
    // order of fills: Bob 1.005, Alice 1.005, ladder 1.01, Carol 1.015, ladder 1.02
    assert.deepStrictEqual(sim.fills.map((f) => [f.id, f.q]), [[0n, U(5000)], [2n, U(2000)], [1n, U(3000)]])
    const [b0, c0, d0, v0] = await Promise.all([bob, carol, alice].map((a) => usdc.balanceOf(a.address)).concat(usdc.balanceOf(fundAddr)))
    await send(book.connect(dave).buy(U(20000), sim.tokens, hints.map((o) => o.id)))
    const [b1, c1, d1, v1] = await Promise.all([bob, carol, alice].map((a) => usdc.balanceOf(a.address)).concat(usdc.balanceOf(fundAddr)))
    assert.strictEqual(b1 - b0, U(5025)); assert.strictEqual(d1 - d0, U(2010)); assert.strictEqual(c1 - c0, U(3045)) // makers get their full price, no fee
    assert.strictEqual(v1 - v0, sim.fee)
    assert.strictEqual((await open()).length, 0)
    await invariant('asks taken')
    ok('limit sells rest in the book; a taker fills best price first (holder before ladder at a tie); makers pay no fee; unsorted or repeated orders are refused')
  }
  await reset()
  {
    // marketable limit buy: 8,000 at 1.0150 takes the 1.01 rung (5,263.16), the rest rests as a bid
    const l = await lad()
    const u0 = await usdc.balanceOf(alice.address)
    const tx = await send(book.connect(alice).limitBuy(U(8000), 1015000n, []))
    const filled = l.tokens[10], rest = U(8000) - filled
    assert.strictEqual(await token.balanceOf(alice.address), U(600000) + filled)
    const os = await open()
    assert.strictEqual(os.length, 1); assert.strictEqual(os[0].tokens, rest); assert.strictEqual(os[0].isBuy, true)
    const cost = (filled * 1010000n + U6 - 1n) / U6, escrow = (rest * 1015000n + U6 - 1n) / U6
    assert.strictEqual(u0 - await usdc.balanceOf(alice.address), cost + M.bookFee(cost) + escrow)
    await invariant('resting bid')
    // Bob sells 1,000: Alice's bid at 1.015 is better than the ladder's 1.01, so it fills first, at her price
    const hints = M.bookHints(false, os, null), sim = M.bookSell(U(1000), await lad(), hints)
    assert.strictEqual(sim.last, 1015000n)
    const [ub, ta] = await Promise.all([usdc.balanceOf(bob.address), token.balanceOf(alice.address)])
    await send(book.connect(bob).sell(U(1000), 0, hints.map((o) => o.id)))
    assert.strictEqual(await usdc.balanceOf(bob.address) - ub, U(1015) - M.bookFee(U(1015)))
    assert.strictEqual(await token.balanceOf(alice.address) - ta, U(1000))
    // cancel: only the maker, escrow comes back, a cancelled order is skipped when named
    await fails(book.connect(bob).cancel(0), 'Book: not your order')
    const u1 = await usdc.balanceOf(alice.address), left = (await book.orders(0)).cash
    await send(book.connect(alice).cancel(0))
    assert.strictEqual(await usdc.balanceOf(alice.address) - u1, left)
    await fails(book.connect(alice).cancel(0), 'Book: order not open')
    assert.strictEqual((await open()).length, 0)
    await send(book.connect(bob).sell(U(100), 0, [0n])) // named but gone: falls through to the ladder
    await invariant('cancelled')
    ok('limit buy above the best ask fills at once up to its price and rests the remainder; sellers hit it first; cancel returns the escrow, only to the maker')
  }

  // ---------- NAV moves the ladder, not the holders' orders ----------
  await reset()
  {
    await send(book.connect(bob).limitSell(U(1000), 1050000n, []))
    await send(fund.deployCapital(eve.address, U(500000), 'PortCo A'))
    assert.strictEqual(await fund.navPerToken(), U6)
    await send(fund.markInvestments(U(700000), 'revaluation +40%'))
    const nav = await fund.navPerToken()
    assert.strictEqual(nav, 1200000n)
    const l = await lad()
    assert.strictEqual(l.prices[9], 1188000n); assert.strictEqual(l.prices[10], 1212000n)
    assert.strictEqual(await fund.marketPrice(), 1200000n)
    assert.strictEqual((await open())[0].price, 1050000n)
    // Bob's stale ask at 1.05 is now below the ladder's bids: a taker buys it first
    const hints = M.bookHints(true, await open(), null), sim = M.bookBuy(U(2000), l, hints)
    assert.strictEqual(sim.fills[0].id, 0n); assert.strictEqual(sim.fills[0].q, U(1000))
    await send(book.connect(alice).buy(U(2000), sim.tokens, [0n]))
    await invariant('after NAV move')
    ok('GP revaluation +20% NAV: every rung moves with it (bid 1.188, ask 1.212) without a transaction; holders\' orders keep their price')
  }

  // ---------- floor of the band and the rule-based buyback ----------
  await reset()
  {
    await fails(fund.connect(carol).buyback(U(100), []), 'Fund: discount below trigger')
    // Bob sells until the ladder has no bids left
    const l = await lad(), all = M.bookSell(U(300000), l, [])
    await send(book.connect(bob).sell(U(300000), 0, []))
    assert.strictEqual(await token.balanceOf(bob.address), U(300000) - all.tokens)
    assert((await book.inventory())[1] < 20n, 'ladder cash used up (dust only)')
    const nav = await fund.navPerToken()
    assert.strictEqual(await fund.marketPrice(), (nav * 9000n) / 10000n)
    assert.strictEqual(await fund.marketPrice(), await fund.buybackTriggerPrice())
    await fails(book.connect(bob).sell(U(100), 0, []), 'Book: nothing to sell into')
    const max = await fund.maxBuyback()
    await fails(fund.connect(carol).buyback(max + 1n, []), 'Fund: amount above limit')
    const [ts0, vc0, navB] = await Promise.all([token.totalSupply(), fund.vaultCash(), fund.navPerToken()])
    await send(fund.connect(carol).buyback(max, []))
    const [ts1, vc1, navA, l2] = await Promise.all([token.totalSupply(), fund.vaultCash(), fund.navPerToken(), lad()])
    assert(ts1 < ts0, 'tokens burned'); assert(vc0 - vc1 <= max && vc0 - vc1 > (max * 9990n) / 10000n, "about the full amount left the vault (the fee comes back to it)")
    assert(navA >= navB, 'NAV per token not lowered: ' + navB + ' -> ' + navA)
    assert(l2.cash[0] > 0n, 'vault cash now bids on the lowest rung')
    await fails(fund.connect(carol).buyback(U(10), []), 'Fund: buyback cooldown')
    await invariant('buyback')
    ok('selling through all ten bids pins the market at NAV -10% = buyback trigger; buyback burns ' + f6(ts0 - ts1) + ' tokens and refills the lowest rung; NAV per token ' + f6(navB) + ' -> ' + f6(navA))
  }

  // ---------- trading account with a session key ----------
  await reset()
  {
    const key = accts[7], far = BigInt((await w.provider.getBlock('latest')).timestamp + 3600)
    await send(w.accounts.connect(alice).create(key.address, far, U(50000), 300, 300, { value: E.parseEther('0.01') })) // +-3% of NAV, 50,000 volume
    const acct = w.at('TradingAccount', await w.accounts.accountOf(alice.address), key)
    const acctAddr = await acct.getAddress()
    await send(usdc.connect(alice).transfer(acctAddr, U(40000)))
    const l = await lad(), sim = M.bookBuy(U(5000), l, [])
    await send(acct.buyInBook(0, U(5000), sim.tokens, []))
    assert.strictEqual(await token.balanceOf(acctAddr), sim.tokens)
    assert.strictEqual(await usdc.allowance(acctAddr, bookAddr), 0n)
    // 30,000 more would average above NAV +3%: refused, nothing changes
    await fails(acct.buyInBook(0, U(30000), 0, []), "Account: price above the session's limit")
    await fails(acct.limitBuyInBook(0, U(100), 1040000n, []), "Account: price above the session's limit")
    await fails(acct.limitSellInBook(0, U(100), 960000n, []), "Account: price below the session's limit")
    // a limit sell inside the limits rests under the account's name; the key can cancel it; proceeds stay in the account
    await send(acct.limitSellInBook(0, U(1000), 1030000n, []))
    let os = await open()
    assert.strictEqual(os.length, 1); assert.strictEqual(os[0].maker, acctAddr)
    await fails(book.connect(alice).cancel(os[0].id), 'Book: not your order')
    await send(acct.cancelInBook(0, os[0].id))
    assert.strictEqual(await token.balanceOf(acctAddr), sim.tokens)
    await send(acct.limitBuyInBook(0, U(2000), 995000n, []))
    os = await open()
    assert.strictEqual(os[0].isBuy, true)
    // Bob sells 7,500: first into the ladder's bid at 1.01 (the rung the account bought from), then the account's bid at 0.995, then the ladder at 0.99
    await send(book.connect(bob).sell(U(7500), 0, [os[0].id]))
    assert.strictEqual((await open()).length, 0)
    assert.strictEqual(await token.balanceOf(acctAddr), sim.tokens + U(2000))
    await send(acct.sellInBook(0, U(500), 0, []))
    // volume cap: 5,000 + 1,030 + 1,990 + 500 used; 45,000 more is over 50,000
    await fails(acct.limitBuyInBook(0, U(45000), 1000000n, []), 'Account: session volume cap reached')
    await fails(acct.connect(bob).cancelInBook(0, 0), 'Account: not allowed')
    const t = await token.balanceOf(acctAddr)
    await send(acct.withdrawToOwner(await token.getAddress(), t))
    assert.strictEqual(await token.balanceOf(alice.address), U(600000) + t)
    await invariant('session')
    ok('session key: market and limit orders through the trading account, inside its NAV price limits and volume cap; it can cancel its own orders; funds only go back to the owner')
  }

  // ---------- governance and fee still work ----------
  await reset()
  {
    await send(book.connect(bob).limitSell(U(100000), 1300000n, []))
    // eligible = supply - ladder tokens - GP wallet; Bob's tokens in his open order still count
    assert.strictEqual(await fund.eligibleSupply(), U(1000000))
    await w.warp(301)
    await send(fund.mintManagementFee())
    assert.strictEqual(await token.balanceOf(await w.vesting.getAddress()), ((U(1000000) + seed) * 200n) / 10000n)
    await send(fund.connect(alice).proposeRemoveGP(dave.address))
    await send(fund.connect(alice).vote(U(520000)))
    await send(fund.connect(carol).executeRemoveGP())
    assert.strictEqual(await fund.gp(), dave.address)
    ok('fee mint and GP removal unchanged; tokens resting in sell orders stay eligible to vote')
  }

  // ---------- random trading: the dashboard's maths against the contract, and nothing lost ----------
  await reset()
  {
    let s = 20261122
    const rnd = (k) => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % k }
    const who = [alice, bob, carol, dave]
    let ops = 0, checked = 0, mism = 0, rev = 0
    const total = async () => (await Promise.all([...who, gp, eve].flatMap((a) => [usdc.balanceOf(a.address)]))).reduce((a, b) => a + b, 0n) + await usdc.balanceOf(bookAddr) + await usdc.balanceOf(fundAddr)
    const before = await total()
    for (let k = 0; k < STEPS; k++) {
      const a = who[rnd(4)], kind = rnd(100), l = await lad(), all = await open(), nav = Number(l.nav) / 1e6
      const os = all.filter((o) => o.maker !== a.address) // takers do not name their own orders, as in the dashboard
      try {
        if (kind < 30) {
          const amt = U(10 + rnd(30000)), hints = M.bookHints(true, os, null), sim = M.bookBuy(amt, l, hints)
          const q = await book.quoteBuy(amt, hints.map((o) => o.id)); checked++
          if (q[0] !== sim.tokens || q[1] !== sim.cash + sim.fee || q[2] !== sim.last) mism++
          if (sim.tokens > 0n) { const t0 = await token.balanceOf(a.address); await send(book.connect(a).buy(amt, sim.tokens, hints.map((o) => o.id))); assert.strictEqual(await token.balanceOf(a.address) - t0, sim.tokens) }
        } else if (kind < 60) {
          const bal = await token.balanceOf(a.address); if (bal < U(20)) continue
          const amt = U(10 + rnd(30000)) > bal ? bal / 2n : U(10 + rnd(30000)), hints = M.bookHints(false, os, null), sim = M.bookSell(amt, l, hints)
          const q = await book.quoteSell(amt, hints.map((o) => o.id)); checked++
          if (q[0] !== sim.cash - sim.fee || q[1] !== sim.tokens || q[2] !== sim.last) mism++
          if (sim.tokens > 0n) { const u0 = await usdc.balanceOf(a.address); await send(book.connect(a).sell(amt, sim.cash - sim.fee, hints.map((o) => o.id))); assert.strictEqual(await usdc.balanceOf(a.address) - u0, sim.cash - sim.fee) }
        } else if (kind < 75) {
          const price = BigInt(Math.round(nav * (0.85 + rnd(300) / 1000) * 1e6)), amt = U(1 + rnd(8000)), hints = M.bookHints(true, os, price)
          const sim = M.bookMatch(true, amt, M.BOOK_NO_CAP, price, l, hints), t0 = await token.balanceOf(a.address)
          await send(book.connect(a).limitBuy(amt, price, hints.map((o) => o.id)))
          assert.strictEqual(await token.balanceOf(a.address) - t0, sim.tokens); checked++
        } else if (kind < 90) {
          const bal = await token.balanceOf(a.address); if (bal < U(20)) continue
          const price = BigInt(Math.round(nav * (0.85 + rnd(300) / 1000) * 1e6)), amt = U(1 + rnd(8000)) > bal ? bal / 2n : U(1 + rnd(8000)), hints = M.bookHints(false, os, price)
          const sim = M.bookMatch(false, amt, M.BOOK_NO_CAP, price, l, hints), u0 = await usdc.balanceOf(a.address)
          await send(book.connect(a).limitSell(amt, price, hints.map((o) => o.id)))
          assert.strictEqual(await usdc.balanceOf(a.address) - u0, sim.cash - (sim.tokens > 0n ? sim.fee : 0n)); checked++
        } else if (kind < 96) {
          const mine = all.filter((o) => o.maker === a.address); if (!mine.length) continue
          await send(book.connect(a).cancel(mine[rnd(mine.length)].id))
        } else {
          const inv = await fund.investedValue()
          if (inv === 0n) await send(fund.deployCapital(eve.address, U(300000), 'deal'))
          else await send(fund.markInvestments((inv * BigInt(85 + rnd(35))) / 100n, 'mark'))
        }
        ops++
      } catch (e) { rev++; if (!/nothing to|slippage/.test(String(e.reason || e.shortMessage || e.message))) throw e }
      if (k % 25 === 24) await invariant('random op ' + k)
      assert.strictEqual(M.bookSpot(await lad()), await book.spotPrice())
    }
    await invariant('random end')
    assert.strictEqual(mism, 0, 'preview and contract disagree')
    assert.strictEqual(await total(), before + 0n, 'mUSDC is only moved, never created or lost')
    for (const o of await open()) await send(book.connect(who.find((x) => x.address === o.maker)).cancel(o.id))
    const inv = await book.inventory()
    assert.strictEqual(await token.balanceOf(bookAddr), inv[0]); assert.strictEqual(await usdc.balanceOf(bookAddr), inv[1])
    ok(STEPS + ' random steps (market, limit, cancel, NAV marks): ' + ops + ' executed, ' + checked + ' previews identical to the contract, book holds exactly ladder + escrow, all escrow returned on cancel')
  }

  // ---------- gas ----------
  await reset()
  {
    const g = async (p) => Number((await send(p)).gasUsed)
    const a = await g(book.connect(alice).buy(U(100), 0, []))
    const b = await g(book.connect(alice).buy(U(40000), 0, []))
    const c = await g(book.connect(bob).limitSell(U(100), 1500000n, []))
    const d = await g(book.connect(bob).cancel(0))
    ok('gas: small market buy ' + a.toLocaleString() + ', buy across 7 rungs ' + b.toLocaleString() + ', resting limit order ' + c.toLocaleString() + ', cancel ' + d.toLocaleString())
  }
  console.log('\nall ' + n + ' passed')
  process.exit(0)
})().catch((e) => { console.error('FAIL', e); process.exit(1) })
