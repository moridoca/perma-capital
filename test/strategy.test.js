// The strategy planner exists twice: planStrategy in docs/app.js (dashboard) and plan in
// sdk/python/perma/strategy.py (SDK). This runs both on the same cases, fixed and random, and compares.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process'), assert = require('assert')
const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app.js'), 'utf8')
const block = src.slice(src.indexOf('// >>> strategy maths'), src.indexOf('// <<< strategy maths'))
const planStrategy = new Function(block + '\nreturn planStrategy')()
let seed = 7
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n }
const pick = (a) => a[rnd(a.length)]
const cases = []
const U = (x) => BigInt(Math.round(x * 1e6))
// post-only keeps a bid at or above the best offer out, and an offer at or below the best bid
const maker = { postOnly: true, maxInvestedPct: 50, requotePct: 0.02, rules: [{ side: 'buy', offsetPct: -0.05, sizeMode: 'tokens', size: 100, when: 'always', whenPct: 0 }, { side: 'sell', offsetPct: 0.05, sizeMode: 'tokens', size: 100, when: 'always', whenPct: 0 }] }
// fixed: the discount template on a vault with cash only, then with a position and stale orders
const discount = { maxInvestedPct: 80, requotePct: 0.1, rules: [
  { side: 'buy', offsetPct: -3, sizeMode: 'pctCash', size: 25, when: 'always', whenPct: 0 }, { side: 'buy', offsetPct: -6, sizeMode: 'pctCash', size: 25, when: 'always', whenPct: 0 },
  { side: 'sell', offsetPct: -0.5, sizeMode: 'pctPosition', size: 100, when: 'always', whenPct: 0 }] }
cases.push([discount, { nav: U(1), mid: U(0.999), cash: U(10000), tokens: 0n, orders: [] }])
cases.push([discount, { nav: U(1.2), mid: U(1.1), cash: U(4000), tokens: U(5000), orders: [{ oid: 3, isBuy: true, px: U(0.97), sz: U(2577) }, { oid: 4, isBuy: false, px: U(1.194), sz: U(5000) }] }])
cases.push([maker, { nav: U(1), mid: U(0.99), cash: U(5000), tokens: U(2000), orders: [], bestBid: U(0.988), bestAsk: U(0.991) }])
cases.push([Object.assign({}, maker, { postOnly: false }), { nav: U(1), mid: U(0.99), cash: U(5000), tokens: U(2000), orders: [], bestBid: U(0.988), bestAsk: U(0.991) }])
for (let k = 0; k < 400; k++) {
  const nav = U(0.5 + rnd(1500) / 1000), n = rnd(9)
  const st = { postOnly: rnd(2) === 0, maxInvestedPct: pick([0, 25, 50, 80, 100]), requotePct: pick([0, 0.02, 0.1, 1]), rules: Array.from({ length: n }, () => {
    const side = pick(['buy', 'sell']), sizeMode = pick(['tokens', side === 'buy' ? 'pctCash' : 'pctPosition'])
    return { side, offsetPct: (rnd(1600) - 800) / 100, sizeMode, size: sizeMode === 'tokens' ? rnd(500000) / 100 : pick([5, 12.5, 33.33, 50, 100]), when: pick(['always', 'always', 'marketBelow', 'marketAbove']), whenPct: (rnd(1000) - 700) / 100 }
  }) }
  const orders = Array.from({ length: rnd(9) }, (_, i) => ({ oid: i + 1, isBuy: rnd(2) === 0, px: (nav * BigInt(900000 + rnd(200000))) / 1000000n, sz: U(1 + rnd(400000) / 100) }))
  cases.push([st, { nav, mid: (nav * BigInt(850000 + rnd(200000))) / 1000000n, cash: U(rnd(2000000) / 100), tokens: U(rnd(2000000) / 100), orders,
    bestBid: pick([0n, (nav * BigInt(940000 + rnd(60000))) / 1000000n]), bestAsk: pick([0n, (nav * BigInt(960000 + rnd(80000))) / 1000000n]) }])
}
const ser = (x) => JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? v.toString() : v))
const mine = cases.map(([st, v]) => planStrategy(st, v))
const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(__dirname, '..', 'sdk', 'python'))})
from perma.strategy import plan
out = []
for st, v in json.load(sys.stdin):
    v = {k: (int(x) if k != "orders" else [{"oid": o["oid"], "isBuy": o["isBuy"], "px": int(o["px"]), "sz": int(o["sz"])} for o in x]) for k, x in v.items()}
    p = plan(st, v)
    out.append({"cancel": p["cancel"], "place": [{"isBuy": o["isBuy"], "px": str(o["px"]), "sz": str(o["sz"])} for o in p["place"]]})
print(json.dumps(out))`
const theirs = JSON.parse(execFileSync('python3', ['-c', py], { input: ser(cases), maxBuffer: 1 << 26 }).toString())
let placed = 0, cancelled = 0
mine.forEach((m, i) => { assert.strictEqual(ser(m), JSON.stringify(theirs[i]), 'case ' + i + ': ' + ser(cases[i])); placed += m.place.length; cancelled += m.cancel.length })
// the fixed cases, spelled out
assert.strictEqual(ser(mine[0]), ser({ cancel: [], place: [{ isBuy: true, px: U(0.97), sz: (U(2500) * 1000000n) / U(0.97) }, { isBuy: true, px: U(0.94), sz: (U(2500) * 1000000n) / U(0.94) }] }))
// NAV 1.20, 60% invested, cap 80%: 2,000 of the 4,000 cash may still be invested, 1,000 per bid; the bid at 0.97 is stale, the offer at 1.194 fits
assert.deepStrictEqual(mine[1].cancel, [3])
assert.strictEqual(ser(mine[1].place), ser([{ isBuy: true, px: U(1.164), sz: (U(1000) * 1000000n) / U(1.164) }, { isBuy: true, px: U(1.128), sz: (U(1000) * 1000000n) / U(1.128) }]))
console.log('ok  1 - dashboard and SDK plan the same orders in ' + cases.length + ' cases (' + placed + ' orders to place, ' + cancelled + ' to cancel)')
console.log('ok  2 - discount template: two bids of a quarter of the cash each at NAV -3% and -6%; with a position, bids shrink to the invested cap, a stale bid is cancelled and a fitting offer kept')
assert.strictEqual(ser(mine[2].place), ser([{ isBuy: false, px: U(1.0005), sz: U(100) }])); assert.strictEqual(mine[3].place.length, 2)
console.log('ok  3 - post-only: a bid at NAV -0.05% is held back while offers stand lower; without post-only it is placed and takes them')
console.log('\nall 3 passed')
