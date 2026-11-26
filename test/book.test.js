const assert = require('assert'), fs = require('fs'), path = require('path')
const { boot, openMarket, mark, U, E } = require('./chain')
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

  const lad = async () => { const [l, issue, issuable] = await Promise.all([book.ladder(), book.issuePrice(), fund.issuanceApproved()]); return { issuable, nav: l[0], prices: [...l[1]], asks: [...l[2]], tokens: [...l[3]], cash: [...l[4]], edge: Number(l[5]), issue } }
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
  await fails(book.connect(alice).seed(U(10)), 'Book: only the fund')
  ok('closed before the sale ends; only the fund can seed')

  await openMarket(w, 1000000)
  await fails(fund.closeSale(), 'Fund: sale closed')
  const seed = U(1000000) / 20n // 5% of the sale cash
  {
    const l = await lad()
    assert.strictEqual(l.nav, U6, 'NAV 1.00 after close')
    assert.strictEqual(l.prices.length, 250); assert.strictEqual(l.edge, 249)
    let zone = [0n, 0n, 0n, 0n]
    for (let k = 0; k < 250; k++) {
      assert.strictEqual(l.prices[k], (U6 * BigInt(10000 - (250 - k) * 20)) / 10000n) // bids 0.5000 … 0.9980
      assert.strictEqual(l.asks[k], l.prices[k] + 1000n)                               // each resells 0.1% of NAV higher
      assert.strictEqual(l.tokens[k], 0n)
      const depth = 250 - k
      assert.strictEqual(l.cash[k], (seed * (depth <= 50 ? 8n : depth <= 100 ? 6n : 2n)) / 1000n)
      zone[depth <= 50 ? 0 : depth <= 100 ? 1 : depth <= 200 ? 2 : 3] += l.cash[k]
    }
    assert.deepStrictEqual(zone.map((z) => Number((z * 100n) / seed)), [40, 30, 20, 10]) // to -10%, -20%, -40%, -50%
    assert.strictEqual(l.issue, 1002000n)
    assert.strictEqual(await book.spotPrice(), 998000n, 'nothing on offer yet: the market is the top bid')
    assert.strictEqual(await token.totalSupply(), U(1000000), 'no tokens set aside for the book')
    assert.strictEqual(await fund.outstandingSupply(), U(1000000)); assert.strictEqual(await fund.netAssets(), U(1000000))
    assert.strictEqual(M.bookSpot(l), 998000n)
  }
  await invariant('seed')
  ok('ladder seeded with 5% of the sale cash: 250 bids from NAV -0.2% to NAV -50% in 0.2% steps, each reselling 0.1% higher; 40/30/20/10% of the cash down to -10/-20/-40/-50%')

  // ---------- new tokens only after a holder vote, only through the book ----------
  {
    const before = await w.snap()
    await fails(book.connect(dave).buy(U(1000), 0, []), 'Book: nothing to buy')
    await fails(fund.connect(alice).proposeIssuance(U(5000)), 'Fund: only GP')
    await fails(fund.connect(alice).issue(alice.address, U(1)), 'Fund: only the book')
    await send(fund.proposeIssuance(U(5000)))
    await fails(fund.proposeIssuance(U(1)), 'Fund: vote already running')
    await fails(fund.voteIssuance(U(1)), 'Fund: GP cannot vote')
    await send(fund.connect(bob).voteIssuance(U(300000)))
    await fails(fund.connect(dave).executeIssuance(), 'Fund: threshold not reached')
    await send(fund.connect(alice).voteIssuance(U(210000)))
    await fails(fund.connect(alice).withdrawIssuanceVotes(1), 'Fund: vote still running')
    await send(fund.connect(dave).executeIssuance())
    assert.strictEqual(await fund.issuanceApproved(), U(5000))
    await send(fund.connect(alice).withdrawIssuanceVotes(1)); await send(fund.connect(bob).withdrawIssuanceVotes(1))
    assert.strictEqual(await token.balanceOf(alice.address), U(600000))
    assert.strictEqual(await book.spotPrice(), U6, 'bid 0.998, issue 1.002')
    // 10,000 mUSDC wants more than the 5,000 approved tokens: the buyer gets exactly those, the rest of the money stays
    const sim = M.bookBuy(U(10000), await lad(), []), u0 = await usdc.balanceOf(dave.address)
    assert.strictEqual(sim.tokens, U(5000)); assert.strictEqual(sim.issued, U(5000))
    await send(book.connect(dave).buy(U(10000), sim.tokens, []))
    assert.strictEqual(await token.balanceOf(dave.address), U(5000)); assert.strictEqual(u0 - await usdc.balanceOf(dave.address), U(5010) + M.bookFee(U(5010)))
    assert.strictEqual(await fund.issuanceApproved(), 0n)
    await fails(book.connect(dave).buy(U(1000), 0, []), 'Book: nothing to buy')
    await invariant('capped issue')
    ok('new tokens need a holder vote: GP proposes 5,000, more than 50% of eligible supply approves; a buyer in the book gets exactly 5,000 at 1.0020 and no more; nobody can mint otherwise')
    // for the following checks: holders approve a large amount
    await w.revert(before)
    await send(fund.proposeIssuance(U(20000000)))
    await send(fund.connect(alice).voteIssuance(U(520000))); await send(fund.connect(dave).executeIssuance()); await send(fund.connect(alice).withdrawIssuanceVotes(1))
    assert.strictEqual(await book.spotPrice(), U6); assert.strictEqual(await fund.premiumBps(), 0n)
  }
  const base = await w.snap()
  const reset = async () => { await w.revert(base); return w.snap() }

  // ---------- buying above NAV: new issuance ----------
  {
    const l = await lad(), q = await book.quoteBuy(U(10000), [])
    const sim = M.bookBuy(U(10000), l, [])
    assert.strictEqual(q[0], sim.tokens); assert.strictEqual(q[1], sim.cash + sim.fee); assert.strictEqual(q[2], 1002000n); assert.strictEqual(sim.issued, sim.tokens)
    const [u0, t0, v0, ts0, nav0] = await Promise.all([usdc.balanceOf(alice.address), token.balanceOf(alice.address), usdc.balanceOf(fundAddr), token.totalSupply(), fund.navPerToken()])
    await send(book.connect(alice).buy(U(10000), sim.tokens, []))
    const [u1, t1, v1, ts1, nav1] = await Promise.all([usdc.balanceOf(alice.address), token.balanceOf(alice.address), usdc.balanceOf(fundAddr), token.totalSupply(), fund.navPerToken()])
    assert.strictEqual(t1 - t0, sim.tokens); assert.strictEqual(u0 - u1, sim.cash + sim.fee)
    assert.strictEqual(v1 - v0, sim.cash + sim.fee, 'price and fee both go into the vault')
    assert.strictEqual(ts1 - ts0, sim.tokens, 'the tokens are new')
    assert(nav1 > nav0, 'issuing above NAV raises NAV per token: ' + nav0 + ' -> ' + nav1)
    assert.strictEqual((await book.inventory())[0], 0n)
    await invariant('issue')
    ok('market buy of 10,000 mUSDC: ' + f6(sim.tokens) + ' new tokens issued at 1.0020 (the old pool: +19%); all of it into the vault; NAV ' + f6(nav0) + ' -> ' + f6(nav1) + '; preview = contract')

    // selling: the ladder bids from NAV -0.5% down, and offers again at the same price what it bought
    const l2 = await lad(), sims = M.bookSell(U(300), l2, [])
    assert.strictEqual(sims.last, l2.prices[249])
    await send(book.connect(alice).sell(U(300), sims.cash - sims.fee, []))
    const l3 = await lad(), cash0 = l3.cash[249] + (U(300) * l3.prices[249]) / U6
    assert.strictEqual(l3.tokens[249], U(300)); assert.strictEqual(l3.edge, 249)
    const simb = M.bookBuy(U(2000), l3, [])
    assert.strictEqual(simb.ladder.tokens[249], 0n); assert.strictEqual(simb.last, l3.issue)
    await send(book.connect(bob).buy(U(2000), simb.tokens, []))
    const l4 = await lad(), profit = l4.cash[249] - cash0
    assert(profit >= (U(300) * l3.nav * 10n) / 10000n / U6 - 1000n && profit <= U(1) + 2000n, 'round trip leaves 0.1% of NAV on the rung: ' + profit)
    await invariant('sell and buy back')
    ok('selling 300 fills the top bid at ' + f6(sims.last) + '; the next buyer takes those tokens at ' + f6(l3.asks[249]) + ' before anything new is issued: ' + f6(profit) + ' mUSDC profit stays on the rung')
  }

  // ---------- slippage, deep sells ----------
  await reset()
  {
    await fails(book.connect(alice).buy(U(1000), U(1000), []), 'Book: slippage')
    await fails(book.connect(alice).sell(U(1000), U(1000), []), 'Book: slippage')
    // a very large buy is all new issuance at one price: no price impact above NAV +0.5%
    const sim = M.bookBuy(U(4000000), await lad(), [])
    await send(book.connect(alice).buy(U(4000000), sim.tokens, []))
    assert.strictEqual(sim.last, 1002000n)
    const prem = Number(await fund.premiumBps())
    assert(prem >= 0 && prem <= 20, 'market stays within 0.2% above NAV: ' + prem)
    await invariant('big issue')
    // the fund is now five times as large: anyone can bring the ladder back to 5% of net assets from the vault
    const na = await fund.netAssets(), inv0 = await book.inventory(), vc0 = await fund.vaultCash()
    await send(fund.connect(dave).topUpReserve())
    const inv1 = await book.inventory(), lt = await lad()
    assert.strictEqual(await fund.netAssets(), na, 'moving cash from the vault to the ladder changes no value')
    assert.strictEqual(vc0 - await fund.vaultCash(), inv1[1] - inv0[1])
    assert(inv1[1] <= (na * 500n) / 10000n && inv1[1] > (na * 499n) / 10000n, 'ladder cash at 5% of net assets: ' + inv1[1])
    assert.strictEqual(lt.cash[249], (((na * 500n) / 10000n) * 8n) / 1000n)
    await fails(fund.connect(dave).topUpReserve(), 'Fund: reserve at target')
    await invariant('top-up')
    ok('a buy of 4,000,000 mUSDC is issued at NAV +0.2% in full: the market cannot run away above NAV (premium now ' + (prem / 100).toFixed(2) + '%); the reserve is then topped up from ' + f6(inv0[1]) + ' to ' + f6(inv1[1]) + ' mUSDC, 5% of net assets')
  }

  // ---------- limit orders ----------
  await reset()
  {
    await fails(book.connect(bob).limitSell(U(1) - 1n, U(1), []), 'Book: order below 1 token')
    await fails(book.connect(bob).limitSell(U(10), 0, []), 'Book: bad price')
    // Bob offers 5,000 at 1.0005 (below the issue price of 1.002), Carol 3,000 at 1.0015, Alice 2,000 at 1.0005 (later, same price); Dave takes
    await send(book.connect(bob).limitSell(U(5000), 1000500n, []))
    await send(book.connect(carol).limitSell(U(3000), 1001500n, []))
    await send(book.connect(alice).limitSell(U(2000), 1000500n, []))
    let os = await open()
    assert.strictEqual(os.length, 3)
    assert.strictEqual(await book.spotPrice(), U6, 'holders\' orders do not move the ladder price')
    await invariant('three asks')

    await fails(book.connect(alice).buy(U(20000), 0, [1n, 0n]), 'Book: orders not sorted')          // 1.004 before 1.002
    await fails(book.connect(alice).buy(U(20000), 0, [0n, 0n]), 'Book: orders not sorted')          // the same order twice
    await fails(book.connect(alice).buy(U(20000), 0, [2n, 0n]), 'Book: orders not sorted')          // same price: lower id first
    await fails(book.connect(alice).sell(U(100), 0, [0n]), 'Book: order on the wrong side')

    const hints = M.bookHints(true, os, null)
    assert.deepStrictEqual(hints.map((o) => o.id), [0n, 2n, 1n])
    const l = await lad(), sim = M.bookBuy(U(20000), l, hints)
    const q = await book.quoteBuy(U(20000), hints.map((o) => o.id))
    assert.strictEqual(q[0], sim.tokens); assert.strictEqual(q[1], sim.cash + sim.fee)
    // order of fills: Bob 1.002, Alice 1.002, Carol 1.004, then new issuance at 1.005
    assert.deepStrictEqual(sim.fills.map((f) => [f.id, f.q]), [[0n, U(5000)], [2n, U(2000)], [1n, U(3000)]])
    const [b0, c0, d0, v0] = await Promise.all([bob, carol, alice].map((a) => usdc.balanceOf(a.address)).concat(usdc.balanceOf(fundAddr)))
    await send(book.connect(dave).buy(U(20000), sim.tokens, hints.map((o) => o.id)))
    const [b1, c1, d1, v1] = await Promise.all([bob, carol, alice].map((a) => usdc.balanceOf(a.address)).concat(usdc.balanceOf(fundAddr)))
    assert.strictEqual(b1 - b0, U(5002.5)); assert.strictEqual(d1 - d0, U(2001)); assert.strictEqual(c1 - c0, U(3004.5)); assert(sim.issued > 0n) // makers get their full price, no fee
    assert.strictEqual(v1 - v0, sim.fee + ((sim.issued * 1002000n + U6 - 1n) / U6))
    assert.strictEqual((await open()).length, 0)
    await invariant('asks taken')
    ok('limit sells rest in the book; a taker fills holders\' offers below the issue price first, then new issuance; makers pay no fee; unsorted or repeated orders are refused')
  }
  await reset()
  {
    // a limit buy at or above the issue price is filled at once with new tokens; nothing rests
    const r0 = await token.balanceOf(dave.address)
    await send(book.connect(dave).limitBuy(U(300), 1010000n, []))
    assert.strictEqual(await token.balanceOf(dave.address) - r0, U(300)); assert.strictEqual((await open()).length, 0)
    // a limit buy between the top bid (0.998) and the issue price rests as the best bid
    const u0 = await usdc.balanceOf(alice.address)
    await send(book.connect(alice).limitBuy(U(8000), 999000n, []))
    const os = await open()
    assert.strictEqual(os.length, 1); assert.strictEqual(os[0].tokens, U(8000)); assert.strictEqual(os[0].isBuy, true)
    assert.strictEqual(u0 - await usdc.balanceOf(alice.address), U(7992))
    await invariant('resting bid')
    // Bob sells 1,000: Alice's bid at 0.999 is better than the ladder's 0.998, so it fills first, at her price
    const hints = M.bookHints(false, os, null), sim = M.bookSell(U(1000), await lad(), hints)
    assert.strictEqual(sim.last, 999000n)
    const [ub, ta] = await Promise.all([usdc.balanceOf(bob.address), token.balanceOf(alice.address)])
    await send(book.connect(bob).sell(U(1000), 0, hints.map((o) => o.id)))
    assert.strictEqual(await usdc.balanceOf(bob.address) - ub, U(999) - M.bookFee(U(999)))
    assert.strictEqual(await token.balanceOf(alice.address) - ta, U(1000))
    // cancel: only the maker, escrow comes back, a cancelled order is skipped when named
    const oid = os[0].id
    await fails(book.connect(bob).cancel(oid), 'Book: not your order')
    const u1 = await usdc.balanceOf(alice.address), left = (await book.orders(oid)).cash
    await send(book.connect(alice).cancel(oid))
    assert.strictEqual(await usdc.balanceOf(alice.address) - u1, left)
    await fails(book.connect(alice).cancel(oid), 'Book: order not open')
    assert.strictEqual((await open()).length, 0)
    await send(book.connect(bob).sell(U(100), 0, [oid])) // named but gone: falls through to the ladder
    await invariant('cancelled')
    ok('limit buy above the issue price is filled at once with new tokens; below it, it rests as the best bid and sellers hit it first; cancel returns the escrow, only to the maker')
  }

  // ---------- NAV moves the ladder, not the holders' orders ----------
  await reset()
  {
    await send(book.connect(bob).limitSell(U(1000), 1050000n, []))
    await send(fund.deployCapital(eve.address, U(500000), 'PortCo A'))
    assert.strictEqual(await fund.navPerToken(), U6)
    await mark(w, U(700000))
    const nav = await fund.navPerToken()
    assert.strictEqual(nav, 1200000n)
    const l = await lad()
    assert.strictEqual(l.prices[249], 1197600n); assert.strictEqual(l.asks[249], 1198800n); assert.strictEqual(l.issue, 1202400n)
    assert.strictEqual(await fund.marketPrice(), 1200000n)
    assert.strictEqual((await open())[0].price, 1050000n)
    // Bob's stale ask at 1.05 is now below the ladder's bids: a taker buys it first
    const hints = M.bookHints(true, await open(), null), sim = M.bookBuy(U(2000), l, hints)
    assert.strictEqual(sim.fills[0].id, 0n); assert.strictEqual(sim.fills[0].q, U(1000))
    await send(book.connect(alice).buy(U(2000), sim.tokens, [0n]))
    await invariant('after NAV move')
    ok('GP revaluation +20% NAV: every rung and the issue price move with it (top bid 1.1976, issue 1.2024) without a transaction; holders\' orders keep their price')
  }

  // ---------- bottom of the ladder; surplus pot, buyback and dividend by GP proposal and holder vote ----------
  await reset()
  {
    const s0 = await fund.surplus()
    // Bob sells until the ladder has no bids left
    const l = await lad(), all = M.bookSell(U(300000), l, [])
    await send(book.connect(bob).sell(U(300000), 0, []))
    assert.strictEqual(await token.balanceOf(bob.address), U(300000) - all.tokens)
    assert((await book.inventory())[1] < 500n, 'ladder cash used up (dust only)')
    const nav = await fund.navPerToken()
    assert.strictEqual(await fund.marketPrice(), (nav * 5010n) / 10000n, 'bottom rung offers at NAV -49.9%')
    await fails(book.connect(bob).sell(U(100), 0, []), 'Book: nothing to sell into')
    const surplus = await fund.surplus()
    assert.strictEqual(surplus - s0, all.fee, 'the taker fee of the sale is in the surplus pot')
    assert.strictEqual(await fund.freeCash(), (await fund.vaultCash()) - surplus)
    await fails(fund.deployCapital(eve.address, (await fund.freeCash()) + 1n, 'too much'), 'Fund: above free vault cash')

    // nothing leaves the pot without a GP proposal and a holder vote
    await fails(fund.connect(carol).buyback(U(1), []), 'Fund: only GP')
    await fails(fund.buyback(U(1), []), 'Fund: above approved surplus')
    await fails(fund.payDividend(U(1)), 'Fund: above approved surplus')
    await fails(fund.connect(alice).proposeSurplusUse(1, U(1)), 'Fund: only GP')
    await fails(fund.proposeSurplusUse(1, surplus + 1n), 'Fund: above the surplus')
    await fails(fund.proposeSurplusUse(0, U(1)), 'Fund: unknown kind')
    const forBuyback = (surplus * 6n) / 10n, forDividend = (surplus * 3n) / 10n
    const vote = async (kind, amount) => {
      await send(fund.proposeSurplusUse(kind, amount)); const id = await fund.issueProposalId()
      assert.strictEqual(await fund.issueKind(), BigInt(kind))
      await send(fund.connect(alice).voteIssuance(U(520000))); await send(fund.connect(dave).executeIssuance()); await send(fund.connect(alice).withdrawIssuanceVotes(id))
    }
    const ia = await fund.issuanceApproved()
    await vote(1, forBuyback)
    assert.strictEqual(await fund.buybackApproved(), forBuyback); assert.strictEqual(await fund.issuanceApproved(), ia, 'a surplus vote approves no new tokens')
    await fails(fund.proposeSurplusUse(2, surplus - forBuyback + 1n), 'Fund: above the surplus')
    const [ts0, vc0, navB] = await Promise.all([token.totalSupply(), fund.vaultCash(), fund.navPerToken()])
    await fails(fund.buyback(forBuyback + 1n, []), 'Fund: above approved surplus')
    await send(fund.buyback(forBuyback, []))
    const [ts1, vc1, navA, l2, s1] = await Promise.all([token.totalSupply(), fund.vaultCash(), fund.navPerToken(), lad(), fund.surplus()])
    assert(ts1 < ts0, 'tokens burned'); assert(navA >= navB, 'NAV per token not lowered: ' + navB + ' -> ' + navA)
    assert(l2.cash[0] > 0n, 'the money now bids on the lowest rung')
    assert.strictEqual(vc0 - vc1, surplus - s1, 'only surplus money left the vault (the fee on the purchase came back into the pot)')
    assert((await fund.buybackApproved()) < forBuyback / 100n + 2n, 'approval used up')
    await invariant('buyback')

    // dividend: approved by holders, paid by the GP, collected by each holder
    await vote(2, forDividend)
    assert.strictEqual(await fund.dividendApproved(), forDividend)
    const na0 = await fund.netAssets()
    const entitled = (await token.totalSupply()) - (await token.balanceOf(bookAddr)) - (await token.balanceOf(fundAddr)) - (await token.balanceOf(await w.vesting.getAddress()))
    await fails(fund.connect(alice).payDividend(forDividend), 'Fund: only GP')
    await send(fund.payDividend(forDividend))
    const per = (forDividend * 10n ** 18n) / entitled, paid = (per * entitled) / 10n ** 18n
    assert.strictEqual(await fund.dividendsUnclaimed(), paid); assert.strictEqual(await fund.netAssets(), na0 - paid, 'a declared dividend is no longer part of net assets')
    assert.strictEqual(await fund.surplus(), s1 - paid)
    const bobBal = await token.balanceOf(bob.address), owedBob = (bobBal * per) / 10n ** 18n
    assert.strictEqual(await fund.dividendOf(bob.address), owedBob); assert.strictEqual(await fund.dividendOf(bookAddr), 0n, 'tokens in the book get nothing')
    // tokens sold after the payment leave the dividend with the seller
    await send(token.connect(bob).transfer(dave.address, bobBal))
    assert.strictEqual(await fund.dividendOf(bob.address), owedBob); assert.strictEqual(await fund.dividendOf(dave.address), 0n)
    const u0 = await usdc.balanceOf(bob.address)
    await send(fund.connect(carol).claimDividend(bob.address)) // anyone can trigger it; the money goes to the holder
    assert.strictEqual((await usdc.balanceOf(bob.address)) - u0, owedBob)
    await fails(fund.claimDividend(bob.address), 'Fund: nothing to collect')
    await send(fund.claimDividend(alice.address)); await send(fund.claimDividend(carol.address))
    assert((await fund.dividendsUnclaimed()) < 10n, 'all collected but rounding dust')
    await invariant('dividend')
    ok('selling through all 250 bids ends at the bottom of the ladder (NAV -49.9%); fees collect in a surplus pot (' + f6(surplus) + ' mUSDC); buyback and dividend need a GP proposal and a holder vote: buyback burns ' + f6(ts0 - ts1) + ' tokens, NAV per token ' + f6(navB) + ' -> ' + f6(navA) + '; dividend of ' + f6(paid) + ' mUSDC paid per token in a wallet and collected')
  }
  await reset()
  {
    // what the ladder earns on a round trip can be moved into the pot
    await send(book.connect(bob).sell(U(2000), 0, [])); await send(book.connect(alice).buy(U(1900), 0, []))
    const [inv0, s0, na0] = await Promise.all([book.inventory(), fund.surplus(), fund.netAssets()])
    await send(fund.connect(dave).sweepLadder())
    const [inv1, s1, na1] = await Promise.all([book.inventory(), fund.surplus(), fund.netAssets()])
    assert(s1 > s0 && s1 - s0 === inv0[1] - inv1[1], 'what left the rungs is in the pot'); assert.strictEqual(na1, na0, 'net assets unchanged')
    await invariant('sweep')
    ok('the ladder\'s profit from a sale and repurchase (' + f6(s1 - s0) + ' mUSDC) moves into the surplus pot with sweepLadder(); rungs keep their share of 5% of net assets')
  }

  // ---------- trading account with a session key ----------
  await reset()
  {
    const key = accts[7], far = BigInt((await w.provider.getBlock('latest')).timestamp + 3600)
    await send(w.accounts.connect(alice).create(key.address, far, U(50000), 100, 300, { value: E.parseEther('0.01') })) // buy up to NAV +1%, sell down to NAV -3%, 50,000 volume
    const acct = w.at('TradingAccount', await w.accounts.accountOf(alice.address), key)
    const acctAddr = await acct.getAddress()
    await send(usdc.connect(alice).transfer(acctAddr, U(40000)))
    const l = await lad(), sim = M.bookBuy(U(5000), l, [])
    await send(acct.buyInBook(0, U(5000), sim.tokens, []))
    assert.strictEqual(await token.balanceOf(acctAddr), sim.tokens)
    assert.strictEqual(await usdc.allowance(acctAddr, bookAddr), 0n)
    await fails(acct.limitBuyInBook(0, U(100), 1040000n, []), "Account: price above the session's limit")
    await fails(acct.limitSellInBook(0, U(100), 960000n, []), "Account: price below the session's limit")
    // a limit sell inside the limits rests under the account's name; the key can cancel it; proceeds stay in the account
    await send(acct.limitSellInBook(0, U(1000), 1003000n, []))
    let os = await open()
    assert.strictEqual(os.length, 1); assert.strictEqual(os[0].maker, acctAddr)
    await fails(book.connect(alice).cancel(os[0].id), 'Book: not your order')
    await send(acct.cancelInBook(0, os[0].id))
    assert.strictEqual(await token.balanceOf(acctAddr), sim.tokens)
    await send(acct.limitBuyInBook(0, U(2000), 999000n, []))
    os = await open()
    assert.strictEqual(os[0].isBuy, true)
    // Bob sells 7,500: first the account's bid at 0.999, then down the ladder from 0.998
    await send(book.connect(bob).sell(U(7500), 0, [os[0].id]))
    assert.strictEqual((await open()).length, 0)
    assert.strictEqual(await token.balanceOf(acctAddr), sim.tokens + U(2000))
    await send(acct.sellInBook(0, U(500), 0, []))
    // volume cap: about 8,500 used; 45,000 more is over 50,000
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
    // eligible = supply - the ladder's tokens - GP wallet; Bob's tokens in his open order still count
    assert.strictEqual(await fund.eligibleSupply(), U(1000000))
    await w.warp(301)
    await send(fund.mintManagementFee())
    assert.strictEqual(await token.balanceOf(await w.vesting.getAddress()), (U(1000000) * 200n) / 10000n)
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
          else await mark(w, (inv * BigInt(85 + rnd(35))) / 100n)
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
    ok('gas: small market buy ' + a.toLocaleString() + ', larger buy ' + b.toLocaleString() + ', resting limit order ' + c.toLocaleString() + ', cancel ' + d.toLocaleString())
  }
  console.log('\nall ' + n + ' passed')
  process.exit(0)
})().catch((e) => { console.error('FAIL', e); process.exit(1) })
