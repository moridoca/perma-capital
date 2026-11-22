// Perma Capital dashboard. Reads everything live from the contracts; sends transactions
// only through the visitor's own wallet. No backend, no build step.
(() => {
  'use strict'

  const CFG = window.PERMA_CONFIG
  const E = window.ethers
  const D = 6 // decimals of mUSDC and of every fund token
  const SALE_CAP = 9500000n * 10n ** 6n
  const $ = (id) => document.getElementById(id)

  const ABI = {
    umbrella: [
      'function subFundCount() view returns (uint256)',
      'function overview(uint256 index) view returns (string name, address fund, address token, address pool, address vesting, uint256 navPerToken, uint256 marketPrice, int256 premiumBps, uint256 netAssets)',
      'function YEAR() view returns (uint256)',
      'function VOTING_PERIOD() view returns (uint256)'
    ],
    fund: [
      'function gp() view returns (address)',
      'function saleClosed() view returns (bool)',
      'function sold() view returns (uint256)',
      'function initialSupply() view returns (uint256)',
      'function investedValue() view returns (uint256)',
      'function feeTranchesMinted() view returns (uint256)',
      'function lastFeeMint() view returns (uint256)',
      'function lastBuyback() view returns (uint256)',
      'function followOnRemaining() view returns (uint256)',
      'function proposalId() view returns (uint256)',
      'function proposedGP() view returns (address)',
      'function voteDeadline() view returns (uint256)',
      'function yesVotes() view returns (uint256)',
      'function escrowed(uint256 id, address voter) view returns (uint256)',
      'function vaultCash() view returns (uint256)',
      'function ownedLiquidity() view returns (uint256 tokens, uint256 cash)',
      'function netAssets() view returns (uint256)',
      'function outstandingSupply() view returns (uint256)',
      'function navPerToken() view returns (uint256)',
      'function marketPrice() view returns (uint256)',
      'function premiumBps() view returns (int256)',
      'function feePerYear() view returns (uint256)',
      'function buybackTriggerPrice() view returns (uint256)',
      'function maxBuyback() view returns (uint256)',
      'function issuePrice() view returns (uint256)',
      'function eligibleSupply() view returns (uint256)',
      'function voteActive() view returns (bool)',
      'function buy(uint256 tokenAmount)',
      'function closeSale()',
      'function deployCapital(address to, uint256 amount, string memo)',
      'function markInvestments(uint256 newValue, string memo)',
      'function returnProceeds(uint256 amount, uint256 newInvestedValue)',
      'function mintManagementFee()',
      'function buyback(uint256 usdcAmount)',
      'function openFollowOn(uint256 tokenAmount)',
      'function subscribe(uint256 tokenAmount, uint256 maxPrice)',
      'function proposeRemoveGP(address newGP)',
      'function vote(uint256 tokenAmount)',
      'function executeRemoveGP()',
      'function withdrawVotes(uint256 id)',
      'event Purchased(address indexed investor, uint256 tokens)',
      'event SaleClosed(uint256 sold, uint256 liquidityTokens, uint256 liquidityUSDC)',
      'event CapitalDeployed(address indexed to, uint256 amount, string memo)',
      'event ProceedsReturned(address indexed from, uint256 amount, uint256 newInvestedValue)',
      'event InvestmentsMarked(uint256 oldValue, uint256 newValue, string memo)',
      'event NAVUpdated(uint256 navPerToken, uint256 marketPrice, uint256 timestamp)',
      'event ManagementFeeMinted(uint256 tranche, uint256 tokens)',
      'event BuybackExecuted(address indexed caller, uint256 usdcSpent, uint256 tokensBurned, uint256 priceAfter)',
      'event FollowOnOpened(uint256 tokens)',
      'event FollowOnSubscribed(address indexed investor, uint256 tokens, uint256 price)',
      'event RemovalProposed(uint256 indexed id, address indexed proposer, address newGP, uint256 deadline)',
      'event Voted(uint256 indexed id, address indexed voter, uint256 tokens)',
      'event GPRemoved(uint256 indexed id, address oldGP, address newGP, uint256 burnedUnvested)'
    ],
    pool: [
      'function reserveToken() view returns (uint256)',
      'function reserveUSDC() view returns (uint256)',
      'function quoteUSDCForToken(uint256 usdcIn) view returns (uint256)',
      'function quoteTokenForUSDC(uint256 tokenIn) view returns (uint256)',
      'function swapUSDCForToken(uint256 usdcIn, uint256 minTokenOut) returns (uint256)',
      'function swapTokenForUSDC(uint256 tokenIn, uint256 minUSDCOut) returns (uint256)',
      'event Swap(address indexed trader, bool usdcForToken, uint256 amountIn, uint256 amountOut, uint256 priceAfter)'
    ],
    vesting: [
      'function trancheCount() view returns (uint256)',
      'function claimable() view returns (uint256)',
      'function unvested() view returns (uint256)',
      'function claim() returns (uint256)',
      'event Claimed(address indexed gp, uint256 amount)'
    ],
    erc20: [
      'function symbol() view returns (string)',
      'function totalSupply() view returns (uint256)',
      'function balanceOf(address) view returns (uint256)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 value) returns (bool)',
      'function mint(address to, uint256 amount)',
      'function faucet()',
      'function transfer(address to, uint256 value) returns (bool)'
    ]
  }
  ABI.account = [
    'function sessions(address) view returns (uint64 expiry, uint16 maxPremiumBps, uint16 maxDiscountBps, uint128 volumeCap, uint128 volumeUsed)',
    'function startSession(address key, uint64 expiry, uint128 volumeCap, uint16 maxPremiumBps, uint16 maxDiscountBps) payable',
    'function endSession(address key)',
    'function buyInPool(uint256 fundIndex, uint256 usdcIn, uint256 minTokenOut) returns (uint256)',
    'function sellInPool(uint256 fundIndex, uint256 tokenIn, uint256 minUSDCOut) returns (uint256)',
    'function buyPrimary(uint256 fundIndex, uint256 tokenAmount)',
    'function withdrawToOwner(address token, uint256 amount)'
  ]
  ABI.accounts = [
    'function accountOf(address) view returns (address)',
    'function create(address key, uint64 expiry, uint128 volumeCap, uint16 maxPremiumBps, uint16 maxDiscountBps) payable returns (address)'
  ]
  const IFACE = { fund: new E.Interface(ABI.fund), pool: new E.Interface(ABI.pool), vesting: new E.Interface(ABI.vesting) }

  const state = {
    rpcIndex: 0, provider: null,
    funds: [], selected: 0, detail: null, me: null, sym: {},
    tab: 'trade', sub: 'overview', range: 'All', pane: 'book', ttab: 'balances', side: 'buy', fsel: false, ff: 'all', fq: '',
    year: 0, voting: 0,
    block: 0, chainTime: 0, fetchedAt: 0,
    scan: {}, live: {},
    account: null, signer: null, walletChainOk: false,
    busy: false, refreshing: false, pending: false, netOk: false, startedAt: 0, gen: 0, shown: -1, actionsKey: ''
  }

  // ---------- formatting ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const num = (x) => Number(E.formatUnits(x, D))
  const amt = (x) => {
    const n = num(x)
    return n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 1000 || n === 0 ? 0 : 2 })
  }
  const usd = (x) => '$' + num(x).toFixed(4)
  const pct = (bps) => (Number(bps) / 100).toFixed(2) + '%'
  const short = (a) => a.slice(0, 6) + '…' + a.slice(-4)
  const link = (a) => '<a class="mono" target="_blank" rel="noopener" href="' + esc(CFG.explorer) + '/address/' + esc(a) + '">' + esc(short(a)) + '</a>'
  const dur = (s) => {
    s = Math.max(0, Math.ceil(s))
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
    return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + r + 's'
  }
  const clock = (t, withDate) => {
    const d = new Date(t * 1000)
    const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    return withDate ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + hm : hm
  }
  const now = () => (state.chainTime ? state.chainTime + (Date.now() - state.fetchedAt) / 1000 : Date.now() / 1000)

  // ---------- read provider with failover ----------
  // Public endpoints can stall or rate-limit. Each request gets a hard timeout and few
  // retries, and a whole read that takes too long moves on to the next endpoint.
  const READ_TIMEOUT_MS = 12000
  const makeProvider = (i) => {
    const req = new E.FetchRequest(CFG.rpcUrls[i])
    req.timeout = 9000
    req.setThrottleParams({ maxAttempts: 2, slotInterval: 400 })
    return new E.JsonRpcProvider(req, CFG.chainId, { staticNetwork: true, batchMaxCount: CFG.batch || 10 })
  }
  const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The endpoint did not answer in time.')), ms)
    promise.then((x) => { clearTimeout(timer); resolve(x) }, (e) => { clearTimeout(timer); reject(e) })
  })
  // The wallet's provider checks for receipts only every 4 s. Asking our own endpoints
  // every 0.5 s as well saves up to 4 s per step; on a fast chain that is most of the wait.
  async function confirmFast(tx) {
    const slow = tx.wait(); slow.catch(() => {})
    let done = false
    const fast = (async () => {
      while (!done) {
        await new Promise((r) => setTimeout(r, CFG.receiptMs || 500))
        let rc = null
        try { rc = await read((p) => p.getTransactionReceipt(tx.hash)) } catch (e) { rc = null }
        if (rc) { if (rc.status === 0) throw new Error('The transaction was reverted on-chain.'); return rc }
      }
    })()
    fast.catch(() => {})
    try { return await Promise.race([slow, fast]) } finally { done = true }
  }

  async function read(fn) {
    let lastErr
    for (let k = 0; k < CFG.rpcUrls.length; k++) {
      try {
        if (!state.provider) state.provider = makeProvider(state.rpcIndex)
        return await withTimeout(fn(state.provider), READ_TIMEOUT_MS)
      } catch (e) {
        lastErr = e
        state.rpcIndex = (state.rpcIndex + 1) % CFG.rpcUrls.length
        state.provider = null
      }
    }
    throw lastErr
  }

  // ---------- loading ----------
  async function loadUmbrella(p) {
    const u = new E.Contract(CFG.umbrella, ABI.umbrella, p)
    if (!state.year) {
      const [y, v] = await Promise.all([u.YEAR(), u.VOTING_PERIOD()])
      state.year = Number(y); state.voting = Number(v)
    }
    const count = Number(await u.subFundCount())
    const rows = await Promise.all(Array.from({ length: count }, (_, i) => u.overview(i)))
    const funds = rows.map((o) => ({
      name: o[0], fund: o[1], token: o[2], pool: o[3], vesting: o[4],
      nav: o[5], price: o[6], premiumBps: o[7], netAssets: o[8]
    }))
    // Per fund: who manages it, whether it trades, and the state of its vote. Token symbols never change.
    const LITE = ['gp', 'saleClosed', 'voteActive', 'proposalId', 'proposedGP', 'voteDeadline', 'yesVotes', 'eligibleSupply']
    const lite = await Promise.all(funds.flatMap((f) => {
      const c = new E.Contract(f.fund, ABI.fund, p)
      return [...LITE.map((k) => c[k]()), state.sym[f.token] ? Promise.resolve(state.sym[f.token]) : new E.Contract(f.token, ABI.erc20, p).symbol()]
    }))
    funds.forEach((f, i) => {
      const o = i * (LITE.length + 1)
      LITE.forEach((k, j) => { f[k] = lite[o + j] })
      f.symbol = state.sym[f.token] = lite[o + LITE.length]
    })
    return funds
  }

  const FUND_KEYS = ['gp', 'saleClosed', 'sold', 'initialSupply', 'investedValue', 'feeTranchesMinted', 'lastFeeMint',
    'lastBuyback', 'followOnRemaining', 'proposalId', 'proposedGP', 'voteDeadline', 'yesVotes', 'vaultCash', 'netAssets',
    'outstandingSupply', 'navPerToken', 'marketPrice', 'premiumBps', 'feePerYear', 'buybackTriggerPrice', 'maxBuyback',
    'issuePrice', 'eligibleSupply', 'voteActive']

  async function loadDetail(p, f) {
    const fund = new E.Contract(f.fund, ABI.fund, p)
    const token = new E.Contract(f.token, ABI.erc20, p)
    const pool = new E.Contract(f.pool, ABI.pool, p)
    const vesting = new E.Contract(f.vesting, ABI.vesting, p)
    const res = await Promise.all([
      ...FUND_KEYS.map((k) => fund[k]()),
      fund.ownedLiquidity(), token.totalSupply(), token.symbol(),
      pool.reserveToken(), pool.reserveUSDC(), vesting.unvested(), vesting.claimable(), vesting.trancheCount()
    ])
    const d = {}
    FUND_KEYS.forEach((k, i) => { d[k] = res[i] })
    const n = FUND_KEYS.length
    d.polTokens = res[n][0]; d.polCash = res[n][1]
    d.totalSupply = res[n + 1]; d.symbol = res[n + 2]
    d.reserveToken = res[n + 3]; d.reserveUSDC = res[n + 4]
    d.unvested = res[n + 5]; d.claimable = res[n + 6]; d.tranches = res[n + 7]
    return d
  }

  async function loadMe(p, funds, d, idx) {
    if (!state.account) return null
    const me = state.account
    const res = await Promise.all([new E.Contract(CFG.usdc, ABI.erc20, p).balanceOf(me),
      ...funds.flatMap((f) => [new E.Contract(f.token, ABI.erc20, p).balanceOf(me), new E.Contract(f.fund, ABI.fund, p).escrowed(f.proposalId, me)])])
    const by = funds.map((f, i) => ({ token: res[1 + i * 2], escrowed: res[2 + i * 2], isGP: f.gp.toLowerCase() === me.toLowerCase() }))
    return { usdc: res[0], token: by[idx].token, escrowed: by[idx].escrowed, isGP: d.gp.toLowerCase() === me.toLowerCase(), by }
  }

  // Event history of one sub-fund, read in block chunks and kept in memory.
  async function scanLogs(p, idx, f, toBlock) {
    const sc = state.scan[idx] || (state.scan[idx] = { next: CFG.deployBlock, events: [], ts: {}, failed: false })
    const byAddr = {}
    byAddr[f.fund.toLowerCase()] = IFACE.fund
    byAddr[f.pool.toLowerCase()] = IFACE.pool
    byAddr[f.vesting.toLowerCase()] = IFACE.vesting
    let guard = 0
    while (sc.next <= toBlock && guard++ < 60) {
      const end = Math.min(sc.next + CFG.logChunk - 1, toBlock)
      const logs = await p.getLogs({ address: [f.fund, f.pool, f.vesting], fromBlock: sc.next, toBlock: end })
      for (const lg of logs) {
        const iface = byAddr[lg.address.toLowerCase()]
        let parsed = null
        try { parsed = iface && iface.parseLog(lg) } catch (e) { parsed = null }
        if (parsed) sc.events.push({ name: parsed.name, args: parsed.args, block: lg.blockNumber, index: lg.index, tx: lg.transactionHash })
      }
      sc.next = end + 1
    }
    // NAVUpdated carries its own timestamp; other events need the block's.
    for (const ev of sc.events) if (ev.name === 'NAVUpdated') sc.ts[ev.block] = Number(ev.args[2])
    const missing = [...new Set(sc.events.filter((e) => sc.ts[e.block] === undefined).map((e) => e.block))].slice(-40)
    const blocks = await Promise.all(missing.map((b) => p.getBlock(b)))
    blocks.forEach((b, i) => { if (b) sc.ts[missing[i]] = Number(b.timestamp) })
    return sc
  }

  function buildSeries(idx) {
    const sc = state.scan[idx]
    const pts = []
    if (sc) {
      let lastNav = null
      for (const ev of sc.events) {
        const t = sc.ts[ev.block]
        if (t === undefined) continue
        if (ev.name === 'NAVUpdated') {
          lastNav = num(ev.args[0])
          pts.push({ t, nav: lastNav, price: num(ev.args[1]) })
        } else if (ev.name === 'Swap' && lastNav !== null) {
          pts.push({ t, nav: lastNav, price: num(ev.args[4]) })
        }
      }
    }
    for (const lp of state.live[idx] || []) pts.push(lp)
    pts.sort((a, b) => a.t - b.t)
    return pts.filter((p) => p.price > 0)
  }

  async function refresh(force) {
    if (!CFG.umbrella) return
    if (state.refreshing && Date.now() - state.startedAt < 45000) { state.pending = state.pending || force; return }
    state.refreshing = true; state.startedAt = Date.now()
    const gen = ++state.gen
    try {
      const bn = await read((p) => p.getBlockNumber())
      if (!force && bn === state.block && state.detail) return
      const funds = await read(loadUmbrella)
      if (!funds.length) throw new Error('The umbrella has no sub-funds yet.')
      if (state.selected >= funds.length) state.selected = 0
      const idx = state.selected
      const f = funds[idx]
      const [d, blk] = await Promise.all([read((p) => loadDetail(p, f)), read((p) => p.getBlock('latest'))])
      const me = await read((p) => loadMe(p, funds, d, idx))
      try { await read((p) => scanLogs(p, idx, f, bn)); state.scan[idx].failed = false } catch (e) {
        if (state.scan[idx]) state.scan[idx].failed = true
      }
      if (idx !== state.selected || gen !== state.gen) return // selection changed or a newer refresh took over
      state.funds = funds; state.detail = d; state.me = me; state.shown = idx
      state.block = bn; state.chainTime = Number(blk.timestamp); state.fetchedAt = Date.now()
      if (d.saleClosed) {
        const live = state.live[idx] || (state.live[idx] = [])
        const pts = buildSeries(idx)
        const last = pts[pts.length - 1]
        const cur = { t: state.chainTime, nav: num(d.navPerToken), price: num(d.marketPrice) }
        if (!last || Math.abs(last.nav - cur.nav) > 1e-9 || Math.abs(last.price - cur.price) > 1e-9) live.push(cur)
      }
      setNet(true)
      $('fatal').hidden = true
      render()
    } catch (e) {
      if (gen !== state.gen) return
      console.warn('PERMA: refresh failed:', e)
      setNet(false)
      if (!state.detail) {
        $('fatal').hidden = false
        $('fatal').textContent = 'Could not read from ' + CFG.network + ': ' + reason(e) + ' Retrying…'
      }
    } finally {
      if (gen === state.gen) {
        state.refreshing = false
        if (state.pending || (state.netOk && state.shown !== state.selected)) { state.pending = false; setTimeout(() => refresh(true), 0) }
      }
    }
  }

  function setNet(ok) {
    state.netOk = ok
    const age = state.fetchedAt ? Math.round((Date.now() - state.fetchedAt) / 1000) : 0
    const stale = age > 30
    $('netDot').className = ok && !stale ? 'ok' : 'bad'
    $('netText').textContent = (state.block ? 'block ' + state.block.toLocaleString('en-US') : CFG.network) +
      (!ok ? ' · reconnecting' : stale ? ' · ' + dur(age) + ' old' : '')
  }


  // ---------- derived data ----------
  const cmp = (n) => {
    const a = Math.abs(n)
    return a >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : a >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : n.toLocaleString('en-US', { maximumFractionDigits: a >= 100 ? 0 : 2 })
  }
  const px = (n) => (n == null || !isFinite(n) ? '–' : '$' + n.toFixed(4))
  const pcs = (frac, dp) => (frac == null || !isFinite(frac) ? '–' : (frac < 0 ? '−' : '+') + Math.abs(frac * 100).toFixed(dp == null ? 2 : dp) + '%')
  const gapOf = (price, nav) => Math.trunc((price / nav - 1) * 10000) / 10000 // truncated like premiumBps() in the contract
  const letter = (name) => { const w = String(name).trim().split(/\s+/); return (w[1] || w[0] || '?').charAt(0).toUpperCase() }
  const badge = (i, sm) => '<span class="badge' + (sm ? ' sm' : '') + ' r' + ((i % 3) + 1) + '">' + esc(letter(state.funds[i].name)) + '</span>'
  const cur = () => state.funds[state.selected]

  function swapsOf(idx) {
    const sc = state.scan[idx]
    if (!sc) return []
    const out = []
    for (const e of sc.events) {
      if (e.name !== 'Swap' || sc.ts[e.block] === undefined) continue
      const buy = e.args[1], usdc = num(buy ? e.args[2] : e.args[3]), tok = num(buy ? e.args[3] : e.args[2])
      out.push({ t: sc.ts[e.block], buy, usdc, tok, px: tok ? usdc / tok : num(e.args[4]), after: num(e.args[4]), who: e.args[0], tx: e.tx, block: e.block })
    }
    return out
  }
  function marketStats() {
    const d = state.detail, idx = state.selected, t = now()
    const pts = buildSeries(idx), sw = swapsOf(idx)
    const last = d.saleClosed ? num(d.marketPrice) : null, nav = num(d.navPerToken)
    const ref = pts.filter((p) => p.t <= t - 86400).pop() || pts[0]
    const sc = state.scan[idx]
    let valAt = null
    if (sc) for (const e of sc.events) if ((e.name === 'InvestmentsMarked' || e.name === 'CapitalDeployed' || e.name === 'ProceedsReturned') && sc.ts[e.block] !== undefined) valAt = sc.ts[e.block]
    return {
      last, nav, ch: last && ref && ref.price ? last / ref.price - 1 : null,
      prem: last ? gapOf(last, nav) : null,
      vol: sw.filter((s) => s.t > t - 86400).reduce((a, s) => a + s.usdc, 0),
      mcap: last ? num(d.outstandingSupply) * last : null, valAge: valAt == null ? null : t - valAt
    }
  }

  // Write markup only when it changed: a control that is replaced under the pointer can swallow a click.
  const PUT = (id) => ({ set h(html) { const el = $(id); if (el.__h !== html) { el.innerHTML = html; el.__h = html } } })

  // ---------- top bar ----------
  const TABS = [['trade', 'Trade'], ['funds', 'Funds'], ['reports', 'Reports'], ['portfolio', 'Portfolio'], ['govern', 'Govern']]
  const ICON = {
    trade: '<path d="M4 19V9M9 19V5M14 19v-7M19 19V8"/>',
    funds: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><rect x="3" y="11" width="18" height="5" rx="1.5"/><path d="M5 20h14"/>',
    reports: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
    portfolio: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12l6 6"/>',
    govern: '<path d="M4 20h16M6 20V10M10 20V10M14 20V10M18 20V10M3 10l9-6 9 6z"/>'
  }
  function renderTop() {
    const tabBtn = (t, icon) => '<button data-tab="' + t[0] + '"' + (state.tab === t[0] ? ' aria-current="page"' : '') + '>' +
      (icon ? '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[t[0]] + '</svg>' : '') + t[1] + '</button>'
    PUT('topnav').h = TABS.map((t) => tabBtn(t, false)).join('')
    PUT('tabs').h = TABS.map((t) => tabBtn(t, true)).join('')
    document.querySelectorAll('main > section').forEach((s) => { s.hidden = s.dataset.view !== state.tab })
    $('view').classList.toggle('wide', state.tab === 'trade' || state.tab === 'reports' || state.tab === 'portfolio')
    const f = cur()
    if (f) {
      const live = f.price > 0n
      PUT('fundsel').h = '<button class="fbtn" id="fbtn" aria-haspopup="dialog" aria-expanded="' + state.fsel + '">' + badge(state.selected, true) +
        '<span class="fbt"><b>' + esc(f.symbol) + '</b><small>' + esc(f.name) + '</small></span><span class="fbp num">' +
        (live ? usd(f.price) + ' <em class="' + (Number(f.premiumBps) >= 0 ? 'up' : 'dn') + '">' + pcs(Number(f.premiumBps) / 10000) + '</em>' : 'Sale $1.00') +
        '</span><svg class="car" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg></button>'
    }
    const fp = $('fpanel')
    fp.hidden = !state.fsel
    // Build the panel once per opening, then only refresh its list: rebuilding would drop the search focus.
    if (!state.fsel) { if (fp.firstChild) fp.innerHTML = '' } else if (!fp.firstChild) { fp.innerHTML = fundPanel(); placePanel() } else PUT('f-list').h = fundList()
  }
  function fundRows() {
    const q = state.fq.trim().toLowerCase(), m = state.me
    return state.funds.map((f, i) => ({ f, i })).filter(({ f, i }) =>
      (!q || (f.name + ' ' + f.symbol).toLowerCase().includes(q)) &&
      (state.ff === 'all' || (state.ff === 'live' && f.saleClosed) || (state.ff === 'ipo' && !f.saleClosed) || (state.ff === 'held' && m && m.by[i] && m.by[i].token > 0n)))
  }
  function fundList() {
    const rows = fundRows()
    if (!rows.length) return '<div class="fempty">No fund matches.</div>'
    return '<table class="ftab"><thead><tr><th class="l">Fund</th><th>Price</th><th>Vs NAV</th><th class="hm">NAV</th><th class="hm">Net assets</th><th>Status</th></tr></thead><tbody>' +
      rows.map(({ f, i }) => '<tr data-fund="' + i + '" class="' + (i === state.selected ? 'on' : '') + '"><td class="l"><span class="fname">' + badge(i, true) + '<span><b>' + esc(f.symbol) +
        '</b><small>' + esc(f.name) + '</small></span></span></td><td>' + (f.price > 0n ? usd(f.price) : '–') + '</td><td class="' + (Number(f.premiumBps) < 0 ? 'dn' : 'up') + '">' +
        (f.price > 0n ? pcs(Number(f.premiumBps) / 10000) : '–') + '</td><td class="hm">' + usd(f.nav) + '</td><td class="hm">' + amt(f.netAssets) + '</td><td><span class="fst ' +
        (f.saleClosed ? 'live">Live' : 'ipo">Sale open') + '</span></td></tr>').join('') + '</tbody></table>'
  }
  function fundPanel() {
    const m = state.me
    const n = (id) => state.funds.filter((f, i) => id === 'all' || (id === 'live' && f.saleClosed) || (id === 'ipo' && !f.saleClosed) || (id === 'held' && m && m.by[i] && m.by[i].token > 0n)).length
    return '<div class="fpanel" role="dialog" aria-label="Choose a fund"><div class="fptop"><label class="fsearch"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>' +
      '<input id="f-q" autocomplete="off" spellcheck="false" placeholder="Search funds" value="' + esc(state.fq) + '" aria-label="Search funds"></label><div class="fchips" role="group" aria-label="Filter">' +
      [['all', 'All'], ['live', 'Live'], ['ipo', 'Sale open'], ['held', 'Held']].map((c) => '<button aria-pressed="' + (state.ff === c[0]) + '" data-ff="' + c[0] + '">' + c[1] + ' <span>' + n(c[0]) + '</span></button>').join('') +
      '</div></div><div id="f-list" class="flist">' + fundList() + '</div><div class="fpfoot"><span><kbd>Esc</kbd> close</span><span class="grow"></span><span>Each fund is a separate contract with its own token, vault and pool.</span></div></div>'
  }
  function placePanel() {
    const el = document.querySelector('.fpanel'), btn = $('fbtn')
    if (!el || !btn) return
    const r = btn.getBoundingClientRect(), w = Math.min(760, window.innerWidth - 24)
    el.style.width = w + 'px'; el.style.right = 'auto'
    el.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + 'px'
    el.style.top = (r.bottom + 8) + 'px'
  }

  // ---------- Trade ----------
  const RANGES = { '1H': 3600, '6H': 21600, '1D': 86400, 'All': Infinity }
  let candleData = null
  function candles() {
    const idx = state.selected, pts = buildSeries(idx)
    if (!pts.length) return null
    const t1 = Math.max(now(), pts[pts.length - 1].t)
    let t0 = RANGES[state.range] === Infinity ? pts[0].t : t1 - RANGES[state.range]
    if (t1 - t0 < 120) t0 = t1 - 120
    const N = 40, step = (t1 - t0) / N, sw = swapsOf(idx), out = []
    const prev = pts.filter((p) => p.t < t0).pop() || pts[0]
    let pc = prev.price, pn = prev.nav, j = 0, k = 0
    while (j < pts.length && pts[j].t < t0) j++
    while (k < sw.length && sw[k].t < t0) k++
    for (let i = 0; i < N; i++) {
      const a = t0 + i * step, b = a + step, lastOne = i === N - 1
      let o = pc, h = pc, l = pc, c = pc, nav = pn, v = 0, n = 0
      while (j < pts.length && (pts[j].t < b || lastOne)) { c = pts[j].price; h = Math.max(h, c); l = Math.min(l, c); nav = pts[j].nav; j++; n++ }
      while (k < sw.length && (sw[k].t < b || lastOne)) { v += sw[k].usdc; k++ }
      out.push({ t: a, o, h, l, c, nav, v, n, pre: b <= pts[0].t })
      pc = c; pn = nav
    }
    return { cs: out, t0, t1 }
  }
  function ohlc(c, label) {
    return '<span>' + esc(label) + '</span><span>O <b>' + c.o.toFixed(4) + '</b></span><span>H <b>' + c.h.toFixed(4) + '</b></span><span>L <b>' + c.l.toFixed(4) +
      '</b></span><span>C <b>' + c.c.toFixed(4) + '</b></span><span class="tnavk">NAV <b>' + c.nav.toFixed(4) + '</b></span><span>Vol <b>' + cmp(c.v) + '</b></span>'
  }
  function renderChart() {
    const d = state.detail
    PUT('trng').h = Object.keys(RANGES).map((r) => '<button aria-pressed="' + (state.range === r) + '" data-range="' + r + '">' + r + '</button>').join('')
    const cd = candleData = d.saleClosed ? candles() : null
    if (!cd && !d.saleClosed) {
      const sp = Number((d.sold * 10000n) / SALE_CAP) / 100, pol = d.sold / 19n
      PUT('tohlc').h = ''
      PUT('chartBox').h = '<div class="salebox"><div class="salebig">' + amt(d.sold) + '<small> of 9,500,000 ' + esc(d.symbol) + ' sold · ' + sp.toFixed(1) + '%</small></div>' +
        '<div class="meter"><i class="infoc" style="width:' + Math.min(100, sp) + '%"></i></div><ol class="salesteps">' +
        '<li><b>Primary sale.</b> Investors buy new tokens from the fund at a fixed $1.00. The money goes into the vault.</li>' +
        '<li><b>Close.</b> The GP closes the sale, or it sells out. For every 19 tokens sold, 1 token and $1 become fund-owned liquidity' +
        (d.sold > 0n ? ': at today\'s level ' + amt(pol) + ' ' + esc(d.symbol) + ' + ' + amt(pol) + ' mUSDC.' : '.') + '</li>' +
        '<li><b>Market.</b> Trading opens at $1.00 in the pool. Candles from on-chain trades and the NAV line appear here.</li></ol></div>'
      return
    }
    if (!cd) { PUT('chartBox').h = '<p class="note">Loading price history…</p>'; return }
    const cs = cd.cs.filter((c) => !c.pre)
    const W = 860, H = 380, padR = 62, top = 14, ph = 280, vh = 56, gap = 12, N = cd.cs.length, iw = W - padR - 8, cw = iw / N
    let lo = Math.min(...cs.map((c) => Math.min(c.l, c.nav))), hi = Math.max(...cs.map((c) => Math.max(c.h, c.nav)))
    if (hi - lo < 0.02) { lo -= 0.02; hi += 0.02 }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad
    const Y = (v) => top + (1 - (v - lo) / (hi - lo)) * ph, X = (i) => 4 + i * cw
    const vmax = Math.max(...cs.map((c) => c.v), 1), v0 = top + ph + gap
    let g = ''
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4, y = Y(v)
      g += '<line class="tg" x1="0" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '"/><text class="tl" x="' + (W - padR + 6) + '" y="' + (y + 4) + '">' + v.toFixed(3) + '</text>'
    }
    const multi = cd.t1 - cd.t0 > 86400
    for (let i = 0; i <= 3; i++) {
      const t = cd.t0 + ((cd.t1 - cd.t0) * i) / 3
      g += '<text class="tl" x="' + (4 + (iw * i) / 3) + '" y="' + (H - 2) + '" text-anchor="' + (i === 0 ? 'start' : i === 3 ? 'end' : 'middle') + '">' + esc(clock(t, multi)) + '</text>'
    }
    let navPath = '', body = ''
    cd.cs.forEach((c, i) => {
      if (c.pre) return
      const x = X(i), mid = x + cw / 2, up = c.c >= c.o
      const y1 = Y(Math.max(c.o, c.c)), hgt = Math.max(1.2, Math.abs(Y(c.o) - Y(c.c)))
      navPath += (navPath ? ' L' : 'M') + mid + ',' + Y(c.nav)
      body += '<g class="tc ' + (up ? 'up' : 'dn') + '" data-c="' + i + '"><line x1="' + mid + '" x2="' + mid + '" y1="' + Y(c.h) + '" y2="' + Y(c.l) + '"/>' +
        '<rect x="' + (x + cw * 0.18) + '" y="' + y1 + '" width="' + (cw * 0.64) + '" height="' + hgt + '"/>' +
        (c.v > 0 ? '<rect class="vb" x="' + (x + cw * 0.18) + '" y="' + (v0 + vh - (c.v / vmax) * vh) + '" width="' + (cw * 0.64) + '" height="' + ((c.v / vmax) * vh) + '"/>' : '') +
        '<rect class="hit" x="' + x + '" y="' + top + '" width="' + cw + '" height="' + (ph + gap + vh) + '"/></g>'
    })
    const lastC = cs[cs.length - 1], yl = Y(lastC.c), upL = lastC.c >= lastC.nav
    PUT('chartBox').h = '<svg id="chart" class="tsvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Market price candles and NAV per token">' + g + body +
      '<path class="tnav" d="' + navPath + '"/><line class="tlast" x1="0" x2="' + (W - padR) + '" y1="' + yl + '" y2="' + yl + '"/>' +
      '<rect class="ttag ' + (upL ? 'up' : 'dn') + '" x="' + (W - padR + 1) + '" y="' + (yl - 8) + '" width="' + (padR - 2) + '" height="16" rx="3"/><text class="ttagt" x="' + (W - padR + 6) + '" y="' + (yl + 4) + '">' + lastC.c.toFixed(4) + '</text></svg>'
    PUT('tohlc').h = ohlc(lastC, 'now')
  }
  function chartHover(e) {
    const g = e.target.closest && e.target.closest('.tc')
    document.querySelectorAll('#chart .tc.hov').forEach((x) => x.classList.remove('hov'))
    if (!candleData) return
    if (!g) { const cs = candleData.cs.filter((c) => !c.pre); PUT('tohlc').h = ohlc(cs[cs.length - 1], 'now'); return }
    g.classList.add('hov')
    const c = candleData.cs[Number(g.dataset.c)]
    PUT('tohlc').h = ohlc(c, clock(c.t, candleData.t1 - candleData.t0 > 86400))
  }

  function renderHead() {
    const d = state.detail, f = cur(), s = marketStats()
    const cell = (k, v, cls) => '<div><span>' + k + '</span><b' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</b></div>'
    const mkt = '<button class="tmkt" data-open-funds="1" aria-label="Choose a fund">' + badge(state.selected) + '<span><b>' + esc(d.symbol) + '</b><small>' + esc(f.name) +
      '</small></span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg></button><div class="tstats">'
    if (!d.saleClosed) {
      PUT('thead').h = mkt + cell('Status', 'Primary sale') + cell('Issue price', '$1.0000') + cell('Sold', cmp(num(d.sold))) + cell('Sale cap', '9.50M') +
        cell('NAV per token', px(s.nav)) + cell('Vault cash', '$' + cmp(num(d.vaultCash))) + cell('Market', 'opens when the sale closes') + '</div>'
      return
    }
    PUT('thead').h = mkt +
      cell('Last', px(s.last), s.ch == null || s.ch >= 0 ? 'up' : 'dn') +
      cell('24h change', pcs(s.ch), s.ch == null || s.ch >= 0 ? 'up' : 'dn') +
      cell('NAV per token', px(s.nav)) +
      cell('Vs NAV', pcs(s.prem), s.prem == null || s.prem >= 0 ? 'up' : 'dn') +
      cell('24h volume', '$' + cmp(s.vol)) +
      cell('Market value', s.mcap == null ? '–' : '$' + cmp(s.mcap)) +
      cell('Vault cash', '$' + cmp(num(d.vaultCash))) +
      cell('Last GP valuation', s.valAge == null ? '–' : dur(s.valAge) + ' ago') + '</div>'
  }

  function renderBook() {
    const d = state.detail, me = state.account
    PUT('tpane').h = [['book', 'Pool depth'], ['trades', 'Trades']].map((p) => '<button aria-pressed="' + (state.pane === p[0]) + '" data-pane="' + p[0] + '">' + p[1] + '</button>').join('')
    const body = PUT('tbookBody')
    if (state.pane === 'trades') {
      const t = swapsOf(state.selected).slice(-28).reverse()
      body.h = t.length ? '<div class="bh"><span>Price</span><span>Size (' + esc(d.symbol) + ')</span><span>Time</span></div>' + t.map((x) => '<div class="tr ' + (x.buy ? 'bid' : 'ask') + '"><span class="p">' + x.px.toFixed(4) +
        '</span><span>' + cmp(x.tok) + (me && x.who.toLowerCase() === me.toLowerCase() ? ' <em>you</em>' : '') + '</span><span>' + esc(clock(x.t)) + '</span></div>').join('')
        : '<div class="bempty">No trades yet</div>'
      return
    }
    const T = num(d.reserveToken), U = num(d.reserveUSDC)
    if (!T || !U) { body.h = '<div class="bempty">The pool opens when the sale closes</div>'; return }
    const k = T * U, P0 = U / T, nav = num(d.navPerToken), trig = num(d.buybackTriggerPrice)
    const LV = [0.01, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3]
    const asks = [], bids = []
    let pt = T, pu = U
    for (const x of LV) { const P = P0 * (1 + x), tn = Math.sqrt(k / P), un = Math.sqrt(k * P); asks.push({ px: P, q: pt - tn, cum: un - U }); pt = tn }
    pt = T
    for (const x of LV) { const P = P0 * (1 - x), tn = Math.sqrt(k / P), un = Math.sqrt(k * P); bids.push({ px: P, q: tn - pt, cum: U - un }); pt = tn }
    const mx = Math.max(asks[asks.length - 1].cum, bids[bids.length - 1].cum, 1)
    const row = (r, side) => '<div class="br ' + side + '"><i style="width:' + ((r.cum / mx) * 100).toFixed(1) + '%"></i><span class="p">' + r.px.toFixed(4) + '</span><span>' + cmp(r.q) + '</span><span>' + cmp(r.cum) + '</span></div>'
    let bidHtml = '', placed = false
    for (const r of bids) {
      if (!placed && trig >= r.px && trig < P0) { bidHtml += '<div class="lsep refl">buyback trigger ' + trig.toFixed(4) + '</div>'; placed = true }
      bidHtml += row(r, 'bid')
    }
    const share = T ? (num(d.polTokens) / T) * 100 : 0
    body.h = '<div class="bh"><span>Price</span><span>Size (' + esc(d.symbol) + ')</span><span>Total (mUSDC)</span></div><div class="basks">' + asks.slice().reverse().map((r) => row(r, 'ask')).join('') + '</div>' +
      '<div class="bspread"><span>Pool</span><span>' + P0.toFixed(4) + '</span><span>' + (trig >= P0 ? 'buyback triggered' : '') + '</span><span class="bnav">NAV ' + nav.toFixed(4) + '</span></div>' +
      '<div class="bbids">' + bidHtml + '</div><p class="bfoot">A pool has no order book. Each level shows how much it trades before its price reaches that level, before the 0.30% fee. The fund owns ' +
      share.toFixed(0) + '% of this pool and cannot withdraw it.</p>'
  }

  function renderBottom() {
    const d = state.detail, m = state.me, f = cur()
    const tabs = [['balances', 'Balances'], ['mine', 'Trade history'], ['treasury', 'Treasury'], ['markets', 'Markets']]
    PUT('ttabs').h = tabs.map((t) => '<button aria-pressed="' + (state.ttab === t[0]) + '" data-ttab="' + t[0] + '">' + t[1] + '</button>').join('')
    let h = ''
    if (state.ttab === 'balances') {
      if (!m) h = '<p class="note">Connect a wallet to see its balances.</p>'
      else {
        h = '<table class="tt"><thead><tr><th class="l">Asset</th><th>Balance</th><th>Locked in vote</th><th>Price</th><th>Value at market</th><th>NAV</th><th>Value at NAV</th><th></th></tr></thead><tbody>' +
          '<tr><td class="l"><b>mUSDC</b> <small>test money</small></td><td>' + amt(m.usdc) + '</td><td>–</td><td>1.0000</td><td>$' + amt(m.usdc) + '</td><td>–</td><td>–</td><td></td></tr>' +
          state.funds.map((x, i) => { const b = m.by[i]; if (!b || (b.token === 0n && b.escrowed === 0n)) return ''
            const all = num(b.token + b.escrowed), p = num(x.price), nv = num(x.nav)
            return '<tr><td class="l"><b>' + esc(x.symbol) + '</b> <small>' + esc(x.name) + '</small></td><td>' + amt(b.token) + '</td><td>' + (b.escrowed > 0n ? amt(b.escrowed) : '–') + '</td><td>' +
              (p ? p.toFixed(4) : '–') + '</td><td>' + (p ? '$' + cmp(all * p) : '–') + '</td><td>' + nv.toFixed(4) + '</td><td>$' + cmp(all * nv) + '</td><td><button class="tlink" data-go="trade" data-fund="' + i + '">Trade</button></td></tr>' }).join('') + '</tbody></table>'
        if (!m.by.some((b) => b.token > 0n || b.escrowed > 0n)) h += '<p class="note">No fund tokens in this wallet yet.</p>'
      }
    } else if (state.ttab === 'mine') {
      const me = state.account, t = me ? swapsOf(state.selected).filter((x) => x.who.toLowerCase() === me.toLowerCase()).reverse() : []
      h = t.length ? '<table class="tt"><thead><tr><th class="l">Time</th><th class="l">Side</th><th>Price</th><th>Size (' + esc(d.symbol) + ')</th><th>mUSDC</th><th>Pool price after</th><th></th></tr></thead><tbody>' +
        t.map((x) => '<tr><td class="l">' + esc(clock(x.t, true)) + '</td><td class="l ' + (x.buy ? 'up' : 'dn') + '">' + (x.buy ? 'Buy' : 'Sell') + '</td><td>' + x.px.toFixed(4) + '</td><td>' + cmp(x.tok) + '</td><td>' + cmp(x.usdc) +
          '</td><td>' + x.after.toFixed(4) + '</td><td><a target="_blank" rel="noopener" href="' + esc(CFG.explorer) + '/tx/' + esc(x.tx) + '">tx</a></td></tr>').join('') + '</tbody></table>'
        : '<p class="note">' + (me ? 'This wallet has not traded ' + esc(d.symbol) + ' in the pool yet.' : 'Connect a wallet to see its trades.') + '</p>'
    } else if (state.ttab === 'treasury') {
      const below = d.saleClosed && d.marketPrice < d.buybackTriggerPrice
      const r = (k, v) => '<tr><td class="l">' + k + '</td><td class="l">' + v + '</td></tr>'
      h = '<table class="tt kv"><tbody>' + r('Vault cash', amt(d.vaultCash) + ' mUSDC') + r('Fund-owned liquidity', amt(d.polTokens) + ' ' + esc(d.symbol) + ' + ' + amt(d.polCash) + ' mUSDC, cannot be withdrawn') +
        r('Invested value', amt(d.investedValue) + ' mUSDC <span class="pill warn">GP-reported</span>') + r('Buyback trigger', usd(d.buybackTriggerPrice) + (below ? ' <span class="pill warn">triggered</span>' : ' · not triggered')) +
        r('Maximum buyback now', amt(d.maxBuyback) + ' mUSDC (1% of vault cash)') + r('Follow-on', d.followOnRemaining > 0n ? amt(d.followOnRemaining) + ' ' + esc(d.symbol) + ' at ' + usd(d.issuePrice) : 'none open') +
        r('Fee tranches minted', d.feeTranchesMinted + ' of 10') + '</tbody></table><p class="note">The rules and the buttons that anyone can press are under Funds › Rules.</p>'
    } else {
      h = '<table class="tt"><thead><tr><th class="l">Fund</th><th>Price</th><th>Vs NAV</th><th>NAV</th><th>Net assets</th><th class="l">Status</th><th></th></tr></thead><tbody>' +
        state.funds.map((x, i) => '<tr><td class="l"><b>' + esc(x.symbol) + '</b> <small>' + esc(x.name) + '</small></td><td>' + (x.price > 0n ? num(x.price).toFixed(4) : '–') + '</td><td class="' + (Number(x.premiumBps) < 0 ? 'dn' : 'up') + '">' +
          (x.price > 0n ? pcs(Number(x.premiumBps) / 10000) : '–') + '</td><td>' + num(x.nav).toFixed(4) + '</td><td>' + amt(x.netAssets) + '</td><td class="l">' + (x.saleClosed ? 'Live' : 'Sale open') +
          '</td><td><button class="tlink" data-go="trade" data-fund="' + i + '">' + (i === state.selected ? 'Selected' : 'Trade') + '</button></td></tr>').join('') + '</tbody></table>'
    }
    PUT('tbody').h = h
  }

  function renderIpo() {
    const d = state.detail, m = state.me
    const p = Number((d.sold * 10000n) / SALE_CAP) / 100
    PUT('ipoStatus').h = '<p class="lead">New tokens from the fund at a fixed $1.00. This is the only issue: no capital calls later. When the sale closes, 5% of supply plus the same cash become fund-owned liquidity and the market opens at $1.00.</p>' +
      '<div class="qrow"><span>Price</span><span>$1.0000</span></div><div class="qrow"><span>Sold</span><span>' + amt(d.sold) + ' of 9,500,000 (' + p.toFixed(1) + '%)</span></div><div class="meter"><i class="infoc" style="width:' + Math.min(100, p) + '%"></i></div>'
    const acct2 = m ? '<div class="qrow"><span>mUSDC</span><span>' + amt(m.usdc) + '</span></div><div class="qrow"><span>' + esc(d.symbol) + '</span><span>' + amt(m.token) + '</span></div>'
      : '<div class="qrow"><span>' + (window.ethereum ? 'Connect a wallet to buy' : 'Read-only: no wallet in this browser') + '</span><span></span></div>'
    PUT('oacct2').h = acct2 + signLine()
  }

  // ---------- Funds ----------
  function renderFunds() {
    PUT('funds').h = state.funds.map((f, i) => '<button class="row" data-i="' + i + '"' + (i === state.selected ? ' aria-current="true"' : '') + '>' + badge(i) +
      '<span class="grow"><span class="t">' + esc(f.name) + '</span> ' + (f.saleClosed ? '<span class="pill live">Live</span>' : '<span class="pill ipo">Sale open</span>') +
      (i === state.selected ? ' <span class="pill okp">selected</span>' : '') + '<br><span class="d num">' + esc(f.symbol) + ' · NAV ' + usd(f.nav) + ' · net assets ' + amt(f.netAssets) + ' mUSDC</span></span>' +
      '<span class="r"><span class="t num">' + (f.price > 0n ? usd(f.price) : '$1.0000') + '</span><br><span class="d ' + (f.price > 0n && Number(f.premiumBps) < -300 ? 'down' : 'mut') + '">' +
      (f.price > 0n ? pcs(Number(f.premiumBps) / 10000) + ' vs NAV' : 'issue price') + '</span></span></button>').join('')
    const d = state.detail, f = cur()
    $('fundTitle').textContent = f.name
    PUT('fundIds').h = d ? 'fund ' + link(f.fund) + ' · GP ' + link(d.gp) : ''
    PUT('subSeg').h = [['overview', 'Overview'], ['rules', 'Rules'], ['manager', 'Manager']].map((s) => '<button aria-pressed="' + (state.sub === s[0]) + '" data-sub-tab="' + s[0] + '">' + s[1] + '</button>').join('')
    document.querySelectorAll('[data-sub]').forEach((el) => { el.hidden = el.dataset.sub !== state.sub })
  }
  const cell = (k, v, s) => '<div><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + (s || '&nbsp;') + '</div></div>'
  function renderKpis() {
    const d = state.detail, s = esc(d.symbol), open = d.saleClosed
    const share = d.netAssets > 0n ? Number((d.investedValue * 10000n) / d.netAssets) / 100 : 0
    PUT('kpis').h =
      cell('NAV per token', usd(d.navPerToken), d.netAssets === 0n ? 'no assets yet: the $1.00 issue price' : 'net assets / outstanding supply') +
      cell('Market price', open ? usd(d.marketPrice) : '–', open ? gapText(Number(d.premiumBps)) + ' vs NAV' : 'market opens when the sale closes') +
      cell('Net assets', amt(d.netAssets), 'mUSDC') +
      cell('Vault cash', amt(d.vaultCash), 'mUSDC, read on-chain') +
      cell('Invested value', amt(d.investedValue), '<span class="pill warn">GP-reported</span> ' + share.toFixed(1) + '% of net assets') +
      cell('Outstanding supply', amt(d.outstandingSupply), s + ', excl. fund-owned pool tokens') +
      cell('Pool reserves', open ? amt(d.reserveToken) + ' / ' + amt(d.reserveUSDC) : '–', open ? s + ' / mUSDC' : 'opens when the sale closes') +
      cell('Fund-owned liquidity', open ? amt(d.polTokens) + ' / ' + amt(d.polCash) : '–', open ? s + ' / mUSDC, cannot be withdrawn' : 'created when the sale closes')
  }
  const gapText = (bps) => (bps < 0 ? 'discount ' : 'premium ') + pct(Math.abs(bps))

  // One entry per rule: [state of the lamp, status html]. 'off' = needs attention or can be acted on now.
  const RULES = [
    { k: 'sale', t: 'Primary sale', p: 'Fixed $1.00 per token, hard cap of 9,500,000 tokens.', act: 'close' },
    { k: 'pol', t: 'Fund-owned liquidity', p: '5% of supply plus the same cash goes into the pool. The fund has no function to withdraw it.' },
    { k: 'buyback', t: 'Buyback-and-burn', p: 'Anyone can trigger it while the market is more than 10% below NAV. At most 1% of vault cash per execution.', act: 'buyback' },
    { k: 'followon', t: 'Follow-on issuance', p: 'New tokens only at the higher of NAV and market price, so new money never dilutes holders.' },
    { k: 'fee', t: 'Management fee', p: '2% of initial supply per year, paid in new tokens. Ten tranches at most, each locked for one year.', act: 'fee' },
    { k: 'gov', t: 'GP removal', p: 'More than 50% of eligible supply replaces the GP. Unvested fee tokens are burned.' },
    { k: 'trust', t: 'Trust assumption', p: 'The value of off-chain investments is reported by the GP. It is the one input that is not verified on-chain.' }
  ]
  function ruleStatus(k) {
    const d = state.detail, t = now(), s = esc(d.symbol)
    if (k === 'sale') {
      const p = Number((d.sold * 10000n) / SALE_CAP) / 100
      const bar = '<div class="meter"><i style="width:' + Math.min(100, p) + '%"></i></div>'
      return d.saleClosed ? ['ok', '<span class="pill">closed</span> <span class="num">' + amt(d.sold) + '</span> sold (' + p.toFixed(1) + '% of cap)' + bar]
        : ['off', '<span class="pill ipo">open</span> <span class="num">' + amt(d.sold) + '</span> sold (' + p.toFixed(1) + '% of cap)' + bar]
    }
    if (k === 'pol') return d.saleClosed ? ['ok', '<span class="num">' + amt(d.polTokens) + '</span> ' + s + ' + <span class="num">' + amt(d.polCash) + '</span> mUSDC in the pool']
      : ['idle', 'Created when the sale closes']
    if (k === 'buyback') {
      if (!d.saleClosed) return ['idle', 'Opens with the market']
      const cool = Number(d.lastBuyback) + Math.floor(state.year / 52) - t
      const below = d.marketPrice < d.buybackTriggerPrice
      return [below ? 'off' : 'ok', (below ? '<span class="pill warn">triggered</span> ' : '<span class="pill">not triggered</span> ') +
        'market <span class="num">' + usd(d.marketPrice) + '</span> vs trigger <span class="num">' + usd(d.buybackTriggerPrice) + '</span>' +
        '<br>Max size now: <span class="num">' + amt(d.maxBuyback) + '</span> mUSDC' + (below && cool > 0 ? ' · cooldown ' + dur(cool) : '')]
    }
    if (k === 'followon') return d.followOnRemaining > 0n
      ? ['off', '<span class="pill live">open</span> <span class="num">' + amt(d.followOnRemaining) + '</span> ' + s + ' at <span class="num">' + usd(d.issuePrice) + '</span>']
      : [d.saleClosed ? 'ok' : 'idle', 'None open · issue price would be <span class="num">' + usd(d.issuePrice) + '</span>']
    if (k === 'fee') {
      if (!d.saleClosed) return ['idle', 'Starts when the sale closes']
      const due = Number(d.lastFeeMint) + state.year - t
      const capped = d.feeTranchesMinted >= 10n
      return [!capped && due <= 0 ? 'off' : 'ok', 'Tranches minted: <span class="num">' + d.feeTranchesMinted + ' of 10</span> (' + amt(d.feePerYear) + ' ' + s + ' each) · ' +
        (capped ? 'lifetime cap reached' : due > 0 ? 'next due in ' + dur(due) : '<span class="pill warn">due now</span>') +
        '<br>Locked in vesting: <span class="num">' + amt(d.unvested) + '</span> · claimable by GP: <span class="num">' + amt(d.claimable) + '</span> · demo year: ' + dur(state.year)]
    }
    if (k === 'gov') {
      if (!d.voteActive) return ['ok', 'GP ' + link(d.gp) + ' · no vote running · voting period ' + dur(state.voting)]
      const share = d.eligibleSupply > 0n ? Number((d.yesVotes * 10000n) / d.eligibleSupply) / 100 : 0
      return ['off', '<span class="pill live">vote #' + d.proposalId + '</span> replace GP with ' + link(d.proposedGP) +
        '<br>Yes: <span class="num">' + amt(d.yesVotes) + '</span> of <span class="num">' + amt(d.eligibleSupply) + '</span> eligible (' + share.toFixed(1) + '%) · closes in ' + dur(Number(d.voteDeadline) - t) +
        '<div class="meter"><i style="width:' + Math.min(100, share) + '%"></i><b style="left:50%"></b></div>']
    }
    const share = d.netAssets > 0n ? Number((d.investedValue * 10000n) / d.netAssets) / 100 : 0
    return d.investedValue > 0n ? ['off', '<span class="pill warn">GP-reported</span> <span class="num">' + amt(d.investedValue) + '</span> mUSDC = ' + share.toFixed(1) + '% of net assets']
      : ['ok', 'Nothing is invested off-chain: every number on this page is read on-chain']
  }
  function renderRules() {
    if (!state.detail) return
    for (const r of RULES) {
      const row = $('rules').querySelector('[data-rule="' + r.k + '"]')
      if (!row) continue
      const [cls, html] = ruleStatus(r.k)
      row.className = 'light' + (cls === 'ok' ? '' : ' ' + cls)
      const st = row.querySelector('.st')
      if (st.__h !== html) { st.innerHTML = html; st.__h = html }
    }
  }

  function describe(ev, s) {
    const a = ev.args
    switch (ev.name) {
      case 'Purchased': return 'Primary sale: ' + short(a[0]) + ' bought ' + amt(a[1]) + ' ' + s
      case 'SaleClosed': return 'Sale closed with ' + amt(a[0]) + ' sold; ' + amt(a[1]) + ' ' + s + ' + ' + amt(a[2]) + ' mUSDC locked as fund-owned liquidity'
      case 'CapitalDeployed': return 'GP deployed ' + amt(a[1]) + ' mUSDC: “' + a[2] + '”'
      case 'ProceedsReturned': return 'Proceeds of ' + amt(a[1]) + ' mUSDC returned to the vault; remaining portfolio value ' + amt(a[2])
      case 'InvestmentsMarked': return 'GP revalued the portfolio ' + amt(a[0]) + ' → ' + amt(a[1]) + ': “' + a[2] + '”'
      case 'ManagementFeeMinted': return 'Management fee tranche ' + a[0] + ': ' + amt(a[1]) + ' ' + s + ' minted into vesting'
      case 'BuybackExecuted': return 'Buyback by ' + short(a[0]) + ': ' + amt(a[1]) + ' mUSDC spent, ' + amt(a[2]) + ' ' + s + ' burned, price now ' + usd(a[3])
      case 'FollowOnOpened': return 'GP opened a follow-on of ' + amt(a[0]) + ' ' + s
      case 'FollowOnSubscribed': return short(a[0]) + ' subscribed ' + amt(a[1]) + ' ' + s + ' at ' + usd(a[2])
      case 'RemovalProposed': return 'Vote #' + a[0] + ': ' + short(a[1]) + ' proposed ' + short(a[2]) + ' as new GP'
      case 'Voted': return short(a[1]) + ' locked ' + amt(a[2]) + ' ' + s + ' as yes votes'
      case 'GPRemoved': return 'GP replaced: ' + short(a[1]) + ' → ' + short(a[2]) + '; ' + amt(a[3]) + ' unvested fee tokens burned'
      case 'Swap': return a[1]
        ? 'Pool: ' + short(a[0]) + ' bought ' + amt(a[3]) + ' ' + s + ' for ' + amt(a[2]) + ' mUSDC, price now ' + usd(a[4])
        : 'Pool: ' + short(a[0]) + ' sold ' + amt(a[2]) + ' ' + s + ' for ' + amt(a[3]) + ' mUSDC, price now ' + usd(a[4])
      case 'Claimed': return 'GP claimed ' + amt(a[1]) + ' vested ' + s
      default: return null
    }
  }

  // ---------- Reports ----------
  function renderReports() {
    const d = state.detail, f = cur(), sc = state.scan[state.selected], s = esc(d.symbol), m = state.me
    const ev = sc ? sc.events : []
    const sum = (name, i) => ev.reduce((a, e) => (e.name === name ? a + e.args[i] : a), 0n)
    const when = (e) => (sc && sc.ts[e.block] !== undefined ? clock(sc.ts[e.block], true) : 'block ' + e.block)
    const txl = (e) => '<a target="_blank" rel="noopener" href="' + esc(CFG.explorer) + '/tx/' + esc(e.tx) + '">tx</a>'
    const primary = sum('Purchased', 1)
    const followOn = ev.reduce((a, e) => (e.name === 'FollowOnSubscribed' ? a + (e.args[1] * e.args[2] + 10n ** 6n - 1n) / 10n ** 6n : a), 0n)
    const deployed = sum('CapitalDeployed', 1), returned = sum('ProceedsReturned', 1)
    const bbSpent = sum('BuybackExecuted', 1), bbBurned = sum('BuybackExecuted', 2)
    const feeTok = sum('ManagementFeeMinted', 1), feeClaimed = sum('Claimed', 1)
    const gain = d.investedValue + returned - deployed
    const sg = (x) => (x < 0n ? '−' + amt(-x) : amt(x))
    const neg = (x) => (x === 0n ? '0' : '−' + amt(x))
    const tile = (k, v, sub) => '<div><span class="k">' + k + '</span><span class="v">' + v + '</span><span class="s">' + (sub || '&nbsp;') + '</span></div>'
    const open = d.saleClosed
    let h = '<div class="sec"><div class="crumbs"><button data-tab="funds">Funds</button><i>›</i><span>' + esc(f.name) + '</span><i>›</i><span>Report</span></div>' +
      '<h1>' + esc(f.name) + ': fund report</h1><p class="lead">As of block ' + state.block.toLocaleString('en-US') + ', ' + esc(clock(state.chainTime, true)) + '. Every figure is read from the contracts or added up from their events.</p></div>' +
      (sc && sc.failed ? '<p class="dq">The event history could not be fully loaded from the public endpoint. Totals built from events may be incomplete; balances and NAV are unaffected.</p>' : '') +
      '<div class="rtiles">' +
      tile('Net assets', amt(d.netAssets), 'mUSDC') + tile('NAV per token', usd(d.navPerToken), 'net assets / outstanding supply') +
      tile('Market price', open ? usd(d.marketPrice) : '–', open ? gapText(Number(d.premiumBps)) + ' vs NAV' : 'market not open') +
      tile('Invested value', amt(d.investedValue), '<span class="pill warn">GP-reported</span>') +
      tile('Vault cash', amt(d.vaultCash), 'mUSDC, on-chain') + tile('Value created', sg(gain), 'reported value + proceeds − cost') +
      tile('Buybacks', amt(bbSpent), amt(bbBurned) + ' ' + s + ' burned') + tile('Fee tokens minted', amt(feeTok), d.feeTranchesMinted + ' of 10 tranches') + '</div>'

    const fr = (k, v, cls, note) => '<tr class="' + (cls || '') + '"><td>' + k + (note ? ' <small>' + note + '</small>' : '') + '</td><td class="num">' + v + '</td></tr>'
    h += '<div class="rgrid"><div class="rsec"><div class="sechead"><h2>Statement of net assets</h2><small>mUSDC</small></div><div class="rtab"><table class="fin"><tbody>' +
      '<tr class="hd"><td colspan="2">Assets</td></tr>' +
      fr('Vault cash', amt(d.vaultCash), '', 'read on-chain') +
      fr('Cash in the fund-owned pool position', amt(d.polCash), '', 'read on-chain') +
      fr('Investments', amt(d.investedValue), '', 'reported by the GP') +
      fr('Net assets', amt(d.netAssets), 't') +
      '<tr class="hd"><td colspan="2">Tokens (' + s + ')</td></tr>' +
      fr('Total supply', amt(d.totalSupply)) + fr('Less: fund-owned tokens in the pool', neg(d.polTokens), '', 'treasury stock') +
      fr('Outstanding supply', amt(d.outstandingSupply), 's') + fr('NAV per token', usd(d.navPerToken), 't') + '</tbody></table></div></div>'

    h += '<div class="rsec"><div class="sechead"><h2>Capital account since launch</h2><small>from events, mUSDC</small></div><div class="rtab"><table class="fin"><tbody>' +
      '<tr class="hd"><td colspan="2">Money in</td></tr>' +
      fr('Primary sale at $1.00', amt(primary)) + fr('Follow-on subscriptions', amt(followOn)) + fr('Exit proceeds returned', amt(returned)) +
      '<tr class="hd"><td colspan="2">Money out</td></tr>' +
      fr('Capital deployed into investments', neg(deployed)) + fr('Buybacks (tokens burned)', neg(bbSpent), '', amt(bbBurned) + ' ' + s) +
      fr('Distributions to investors', '0', '', 'by design: nothing is paid out') +
      '<tr class="hd"><td colspan="2">Portfolio (GP-reported)</td></tr>' +
      fr('Cost deployed', amt(deployed)) + fr('Proceeds returned', amt(returned)) + fr('Reported value today', amt(d.investedValue)) + fr('Value created', sg(gain), 't') + '</tbody></table></div></div></div>'

    const deals = ev.filter((e) => e.name === 'CapitalDeployed' || e.name === 'ProceedsReturned' || e.name === 'InvestmentsMarked')
    h += '<div class="rsec"><div class="sechead"><h2>Investments and valuations</h2><small>what the contract records</small></div>' +
      (deals.length ? '<div class="rtab"><table class="rt"><thead><tr><th class="l">Time</th><th class="l">Event</th><th class="l">Memo</th><th>Amount</th><th>Reported value after</th><th></th></tr></thead><tbody>' +
        (() => { let val = 0n; return deals.map((e) => {
          let kind, memo = '', amount = ''
          if (e.name === 'CapitalDeployed') { val += e.args[1]; kind = 'Capital deployed to ' + short(e.args[0]); memo = e.args[2]; amount = '−' + amt(e.args[1]) }
          else if (e.name === 'ProceedsReturned') { val = e.args[2]; kind = 'Proceeds returned'; amount = '+' + amt(e.args[1]) }
          else { val = e.args[1]; kind = 'Revaluation by the GP'; memo = e.args[2]; amount = sg(e.args[1] - e.args[0]) }
          return '<tr><td class="l">' + esc(when(e)) + '</td><td class="l">' + esc(kind) + '</td><td class="l">' + esc(memo) + '</td><td>' + amount + '</td><td>' + amt(val) + '</td><td>' + txl(e) + '</td></tr>'
        }).join('') })() + '</tbody></table></div>'
        : '<p class="note">No capital has been deployed and no valuation reported yet.</p>') +
      '<p class="dq">The contracts hold one number for the whole portfolio and a memo per transaction. There are no company-level statements on-chain, so this report cannot show any.</p></div>'

    const share = d.totalSupply > 0n ? Number((feeTok * 10000n) / d.totalSupply) / 100 : 0
    h += '<div class="rgrid"><div class="rsec"><div class="sechead"><h2>Manager fee</h2><small>' + s + '</small></div><div class="rtab"><table class="fin"><tbody>' +
      fr('Tranches minted', d.feeTranchesMinted + ' of 10') + fr('Fee tokens minted', amt(feeTok), '', share.toFixed(2) + '% of total supply') +
      fr('Locked in vesting', amt(d.unvested)) + fr('Vested, not yet claimed', amt(d.claimable)) + fr('Claimed by the GP', amt(feeClaimed)) + '</tbody></table></div></div>'
    if (m) {
      const all = m.token + m.escrowed
      const own = d.outstandingSupply > 0n ? Number((all * 1000000n) / d.outstandingSupply) / 10000 : 0
      h += '<div class="rsec"><div class="sechead"><h2>Your position</h2><small>' + esc(short(state.account)) + '</small></div><div class="rtab"><table class="fin"><tbody>' +
        fr('Tokens held', amt(m.token)) + fr('Tokens locked in a vote', amt(m.escrowed)) + fr('Share of outstanding supply', own.toFixed(2) + '%') +
        fr('Value at NAV', amt((all * d.navPerToken) / 10n ** 6n)) + fr('Value at market price', open ? amt((all * d.marketPrice) / 10n ** 6n) : '–') + '</tbody></table></div></div>'
    } else h += '<div class="rsec"><div class="sechead"><h2>Your position</h2></div><p class="note">Connect a wallet to see its share of this fund.</p></div>'
    h += '</div>'

    const items = []
    for (let i = ev.length - 1; i >= 0 && items.length < 30; i--) {
      const text = describe(ev[i], d.symbol)
      if (text) items.push('<tr><td class="l">' + esc(when(ev[i])) + '</td><td class="l" style="white-space:normal">' + esc(text) + '</td><td>' + txl(ev[i]) + '</td></tr>')
    }
    h += '<div class="rsec"><div class="sechead"><h2>Event log</h2><small>newest first</small></div>' + (items.length ? '<div class="rtab" id="feed"><table class="rt"><tbody>' + items.join('') + '</tbody></table></div>'
      : '<p class="note" id="feed">' + (sc ? 'No activity in this sub-fund yet.' : 'Loading history…') + '</p>') + '</div>'
    const rows = [['Umbrella', CFG.umbrella], ['mUSDC', CFG.usdc], ['Fund', f.fund], ['Token', f.token], ['Pool', f.pool], ['Vesting', f.vesting]]
    h += '<div class="rsec"><div class="sechead"><h2>Contracts</h2><small>' + esc(CFG.network) + '</small></div><div class="card"><dl class="kv" id="addrs">' +
      rows.map((r) => '<dt>' + r[0] + '</dt><dd><a target="_blank" rel="noopener" href="' + esc(CFG.explorer) + '/address/' + esc(r[1]) + '">' + esc(r[1]) + '</a></dd>').join('') + '</dl></div></div>'
    PUT('reports').h = h
  }

  // ---------- Portfolio ----------
  function renderPortfolio() {
    const m = state.me
    let h = '<section class="pfhead"><div><h1>Portfolio</h1><p class="lead">' + (state.account ? (tkOn() ? 'Trading account ' : 'Wallet ') + link(state.account) + ' · values at the pool price' : 'No wallet connected') + '</p></div></section>'
    if (!m) {
      h += '<div class="tp pfnone">' + (window.ethereum ? 'Connect a wallet on ' + esc(CFG.network) + ' to see its holdings.' : 'This browser has no wallet. Reading works without one; holdings need MetaMask.') + '</div>'
    } else {
      let vm = 0, vn = 0, held = 0
      const rows = state.funds.map((f, i) => { const b = m.by[i]; const all = num(b.token + b.escrowed); if (!all) return ''
        held++; const p = num(f.price) || 1, nv = num(f.nav); vm += all * p; vn += all * nv
        return '<tr class="click" data-fund="' + i + '"><td class="l"><b>' + esc(f.symbol) + '</b> <small>' + esc(f.name) + '</small></td><td>' + amt(b.token) + '</td><td>' + (b.escrowed > 0n ? amt(b.escrowed) : '–') + '</td><td>' +
          (f.price > 0n ? num(f.price).toFixed(4) : '1.0000 <small>issue</small>') + '</td><td>$' + cmp(all * p) + '</td><td>' + nv.toFixed(4) + '</td><td>$' + cmp(all * nv) + '</td><td>' + (b.isGP ? '<span class="pill warn">GP</span>' : '') + '</td></tr>' }).join('')
      const cash = num(m.usdc), total = cash + vm
      const stat = (k, v, sub) => '<div class="pfs"><span>' + k + '</span><b class="num">' + v + '</b>' + (sub ? '<small class="num">' + sub + '</small>' : '') + '</div>'
      h += '<section class="pfgrid"><div class="pfcol tp">' + stat('Account value', '$' + cmp(total), 'cash plus tokens at the pool price') +
        stat('Tokens at market', '$' + cmp(vm), held + (held === 1 ? ' fund' : ' funds')) + stat('Tokens at NAV', '$' + cmp(vn), vm ? pcs(vm / vn - 1) + ' market vs NAV' : '–') +
        stat('Cash (mUSDC)', '$' + cmp(cash), 'test money') + stat('Locked in votes', cmp(m.by.reduce((a, b) => a + num(b.escrowed), 0)), 'tokens') + '</div>' +
        '<div class="tp pftabs"><div class="ttabs"><button aria-pressed="true">Holdings</button></div><div class="pftb">' +
        (held ? '<table class="tt"><thead><tr><th class="l">Fund</th><th>Balance</th><th>Locked</th><th>Price</th><th>Value at market</th><th>NAV</th><th>Value at NAV</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
          : '<p class="note pfpad">No fund tokens in this wallet yet. Get test mUSDC below, then buy in a primary sale or in a pool.</p>') + '</div></div></section>'
    }
    PUT('pf').h = h
  }

  // ---------- Govern ----------
  function renderGovern() {
    const d = state.detail, f = cur(), t = now()
    let h = '<section class="sec"><h2>Open decisions</h2>', n = 0
    state.funds.forEach((x, i) => {
      if (!x.voteActive) return
      n++
      const share = x.eligibleSupply > 0n ? Number((x.yesVotes * 10000n) / x.eligibleSupply) / 100 : 0
      h += '<div class="card' + (i === state.selected ? ' hi' : '') + '"><div class="sechead"><h3>' + esc(x.symbol) + ': replace the GP with ' + esc(short(x.proposedGP)) + '</h3><span class="pill live">vote #' + x.proposalId + '</span></div>' +
        '<dl class="kv"><dt>Current GP</dt><dd>' + link(x.gp) + '</dd><dt>Yes votes</dt><dd>' + amt(x.yesVotes) + ' of ' + amt(x.eligibleSupply) + ' eligible (' + share.toFixed(1) + '%)</dd><dt>Closes in</dt><dd>' + dur(Number(x.voteDeadline) - t) + '</dd></dl>' +
        '<div class="meter"><i style="width:' + Math.min(100, share) + '%"></i><b style="left:50%"></b></div><p class="note">The marker is the threshold: more than 50% of eligible supply. ' +
        (i === state.selected ? 'Vote and execute below.' : '<button class="tlink" data-fund="' + i + '">Select this fund to vote</button>') + '</p></div>'
    })
    if (!n) h += '<p class="note">Nothing is waiting. A vote appears here as soon as a token holder proposes a new GP.</p>'
    h += '</section>'
    PUT('gov').h = h

    const sc = state.scan[state.selected]
    const marks = sc ? sc.events.filter((e) => e.name === 'InvestmentsMarked') : []
    let g = '<section class="sec"><div class="sechead"><h2>Valuations</h2><small>' + esc(f.name) + '</small></div>' +
      (marks.length ? '<div class="list">' + marks.slice(-8).reverse().map((e) => '<div class="row"><span class="grow"><span class="t">' + esc(e.args[2] || 'Revaluation') + '</span><br><span class="d num">' + amt(e.args[0]) + ' → ' + amt(e.args[1]) +
        (e.args[0] > 0n ? ' (' + pcs(num(e.args[1]) / num(e.args[0]) - 1) + ')' : '') + '</span><br><span class="d">' + esc(sc.ts[e.block] !== undefined ? clock(sc.ts[e.block], true) : 'block ' + e.block) + ' · reported by the GP</span></span></div>').join('') + '</div>'
        : '<p class="note">The GP has not reported a valuation for this fund yet.</p>') +
      '<p class="dq">In this prototype a valuation takes effect at once and cannot be disputed. The only check on the GP is removal by vote.</p></section>' +
      '<section class="sec"><div class="sechead"><h2>Managers</h2><small>one GP per sub-fund</small></div><div class="list">' +
      state.funds.map((x, i) => '<div class="row">' + badge(i) + '<span class="grow"><span class="t">' + esc(x.name) + '</span><br><span class="d">GP ' + link(x.gp) + '</span></span><span class="r"><span class="d">' +
        (x.voteActive ? '<span class="pill live">vote running</span>' : x.saleClosed ? 'no vote' : 'sale open') + '</span></span></div>').join('') + '</div></section>'
    PUT('gov2').h = g
    PUT('gpHint').h = d ? (state.me && state.me.isGP ? '<span class="pill warn">you are the GP</span>' : 'GP is ' + link(d.gp)) : ''
  }

  // ---------- wallet ----------
  const feeOverrides = () => (CFG.fees ? {
    maxPriorityFeePerGas: E.parseUnits(CFG.fees.priorityGwei, 'gwei'), maxFeePerGas: E.parseUnits(CFG.fees.maxGwei, 'gwei')
  } : {})
  // What the wallet itself answered. ethers files a wallet error it does not recognise under
  // e.error ("could not coalesce error") and a rejection under e.info.error.
  const walletErr = (e) => (e && (e.error || (e.info && e.info.error))) || null
  const unauthorised = (e) => { const w = walletErr(e); return !!e && (e.code === 4100 || !!(w && w.code === 4100)) }
  const reason = (e) => {
    const w = walletErr(e)
    if (unauthorised(e)) return 'MetaMask has not authorised this account on ' + CFG.network + '. Disconnect this site in MetaMask, connect again and retry.'
    const r = (e && (e.reason || (e.revert && e.revert.args && e.revert.args[0]) || (e.code === 'UNKNOWN_ERROR' && w && w.message) || e.shortMessage || (w && w.message) || e.message)) || String(e)
    return String(r).replace(/^execution reverted:?\s*/i, '').slice(0, 220)
  }
  async function syncWallet() {
    const eth = window.ethereum
    state.signer = null; state.account = null; state.walletChainOk = false
    if (eth) {
      try {
        const accts = await eth.request({ method: 'eth_accounts' })
        const cid = parseInt(await eth.request({ method: 'eth_chainId' }), 16)
        state.walletChainOk = cid === CFG.chainId
        if (accts && accts[0]) {
          state.account = E.getAddress(accts[0])
          if (state.walletChainOk) state.signer = await new E.BrowserProvider(eth).getSigner(state.account)
        }
      } catch (e) { /* stay read-only */ }
    }
    state.mm = { account: state.account, signer: state.signer, chainOk: state.walletChainOk }
    await tkLoad()
    if (tkOn()) { state.account = state.tk.acct; state.signer = keySigner(); state.walletChainOk = true }
    state.me = null
    renderWallet(); buildActions(true)
    refresh(true)
  }
  async function connect() {
    try { await window.ethereum.request({ method: 'eth_requestAccounts' }) } catch (e) { log('Wallet: ' + reason(e), true) }
    syncWallet()
  }
  async function switchChain() {
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + CFG.chainId.toString(16) }] })
    } catch (e) {
      // 4902: the wallet does not know this network yet, so offer to add it.
      const unknown = e && (e.code === 4902 || (e.data && e.data.originalError && e.data.originalError.code === 4902))
      if (unknown && CFG.addChain) {
        try { await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [Object.assign({ chainId: '0x' + CFG.chainId.toString(16) }, CFG.addChain)] }) } catch (e2) { log('Wallet: ' + reason(e2), true) }
      } else log('Wallet: ' + reason(e), true)
    }
    syncWallet()
  }
  // MetaMask 13.55+ (MetaMask/metamask-extension#47773): a network the site adds while it is
  // already connected is granted without accounts, so every send on it is refused with 4100
  // before any prompt appears. Reconnecting the site repairs the grant.
  async function reauthorise() {
    const eth = window.ethereum, want = (state.mm || {}).account
    log('MetaMask has not authorised this account on ' + CFG.network + ' – reconnect in your wallet…')
    try {
      try { await eth.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] }) } catch (e) { /* wallets without it: ask again anyway */ }
      const accts = await eth.request({ method: 'eth_requestAccounts' })
      if (!accts || !accts[0] || (want && E.getAddress(accts[0]) !== want)) throw new Error('A different account was connected: choose ' + (want ? short(want) : 'your account') + ' in MetaMask.')
      if (parseInt(await eth.request({ method: 'eth_chainId' }), 16) !== CFG.chainId) {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + CFG.chainId.toString(16) }] })
      }
    } finally { await syncWallet() }
    if (!state.mm.signer) throw new Error('Connect MetaMask on ' + CFG.network + ' and retry.')
  }
  // Sends through MetaMask; on that refusal reconnects once and sends again.
  async function walletSend(send) {
    try { return await send((state.mm || {}).signer) } catch (e) {
      if (!unauthorised(e)) throw e
      await reauthorise()
      log('  reconnected, sending again – confirm in your wallet…')
      return await send(state.mm.signer)
    }
  }
  function renderWallet() {
    const chip = $('walletChip'), m = state.me
    const set = (role, text, disabled) => { chip.dataset.role = role; chip.disabled = !!disabled; chip.querySelector('span').textContent = text }
    if (tkOn()) set('key', '⚡ ' + short(state.tk.acct))
    else if (!window.ethereum) set('none', 'Read-only', true)
    else if (!state.account) set('connect', 'Connect wallet')
    else if (!state.walletChainOk) set('connect', 'Switch network')
    else set(m && m.isGP ? 'gp' : 'investor', short(state.account) + (m && m.isGP ? ' · GP' : ''))
  }

  // ---------- fast trading: trading account + session key ----------
  // The investor's funds sit in a TradingAccount contract that only their wallet owns.
  // A session key created in this browser may trade for it - only in this umbrella's pools
  // and primary sales, until an expiry, up to a volume cap and within price limits around
  // NAV - and may send funds back to the owner, never anywhere else. Like an agent key on
  // Hyperliquid: orders go out without a wallet pop-up. The key itself holds only gas.
  const TK = 'perma.tk.' + CFG.chainId
  const store = {
    get: (k) => { try { return localStorage.getItem(k) } catch (e) { return null } },
    set: (k, val) => { try { if (val === null) localStorage.removeItem(k); else localStorage.setItem(k, val) } catch (e) { /* memory only */ } }
  }
  state.tk = { wallet: null, on: false, eth: null, nonce: null, del: false, acct: null, owner: null, sess: null, mode: null }
  try {
    const pk = store.get(TK)
    if (pk) { state.tk.wallet = new E.Wallet(pk); state.tk.on = store.get(TK + '.on') === '1'; state.tk.acct = store.get(TK + '.acct'); state.tk.owner = store.get(TK + '.owner') }
  } catch (e) { state.tk.wallet = null }
  const TK_LOW = E.parseEther(CFG.tkLow || '0.0002')
  const SESSION_ONLY = { swapbuy: 1, sell: 1, buy: 1, faucet: 1, mint: 1 }      // routed through the trading account
  const SESSION_DIRECT = { buyback: 1, fee: 1, close: 1, execute: 1 }          // need no funds: the key calls the fund itself
  const sessActive = () => !!(state.tk.sess && Number(state.tk.sess.expiry) > now())
  function tkOn() { return !!(state.tk.on && state.tk.wallet && state.tk.acct && sessActive()) }
  function keySigner() { if (!state.provider) state.provider = makeProvider(state.rpcIndex); return state.tk.wallet.connect(state.provider) }
  // Nonce kept locally: public endpoints behind load balancers can lag one block behind.
  async function tkNonce() {
    const n = await read((p) => p.getTransactionCount(state.tk.wallet.address, 'pending'))
    return state.tk.nonce == null ? n : Math.max(n, state.tk.nonce)
  }
  async function tkLoad() {
    const mm = state.mm || {}
    if (CFG.tradingAccounts && mm.account) {
      try {
        const a = await read((p) => new E.Contract(CFG.tradingAccounts, ABI.accounts, p).accountOf(mm.account))
        state.tk.acct = a === E.ZeroAddress ? null : a
        state.tk.owner = mm.account
        store.set(TK + '.acct', state.tk.acct); store.set(TK + '.owner', state.tk.acct ? mm.account : null)
      } catch (e) { /* keep what we had */ }
    }
    if (state.tk.acct && state.tk.wallet) {
      try { state.tk.sess = await read((p) => new E.Contract(state.tk.acct, ABI.account, p).sessions(state.tk.wallet.address)) } catch (e) { /* keep */ }
    } else state.tk.sess = null
  }
  async function tkBalance() {
    if (state.tk.wallet) { try { state.tk.eth = await read((p) => p.getBalance(state.tk.wallet.address)) } catch (e) { /* keep */ } }
    if (state.tk.acct && state.tk.wallet) { try { state.tk.sess = await read((p) => new E.Contract(state.tk.acct, ABI.account, p).sessions(state.tk.wallet.address)) } catch (e) { /* keep */ } }
    // Session ran out while in use: fall back to MetaMask.
    if (state.tk.on && state.account && state.tk.acct && state.account === state.tk.acct && !tkOn()) { log('The session has ended: signing with MetaMask again.', true); await syncWallet() }
    renderTk()
  }
  function signLine() {
    if (!CFG.tradingAccounts) return ''
    if (tkOn()) return '<div class="qrow"><span>Signing</span><span>⚡ session key · <button class="tlink" data-tk="off">use MetaMask</button></span></div>'
    const ready = state.tk.wallet && state.tk.acct && sessActive()
    return '<div class="qrow"><span>Signing</span><span>MetaMask · <button class="tlink" data-tk="' + (ready ? 'on">use session key' : 'goto">set up fast trading') + '</button></span></div>'
  }
  const fmtLeft = (s) => s <= 0 ? 'expired' : s < 3600 ? Math.ceil(s / 60) + ' min left' : Math.floor(s / 3600) + ' h ' + Math.floor((s % 3600) / 60) + ' min left'
  function tkForm(btn, act) {
    const f = (id, label, val, unit) => '<label class="tkf"><small>' + label + '</small><span class="field"><input id="' + id + '" inputmode="decimal" autocomplete="off" value="' + val + '"><span class="unit">' + unit + '</span></span></label>'
    return '<div class="tkform">' + f('tk-h', 'Session length', '24', 'hours') + f('tk-cap', 'Volume cap', '1000000', 'mUSDC') +
      f('tk-prem', 'Buy at most', '10', '% above NAV') + f('tk-disc', 'Sell at least', '20', '% below NAV') + '</div>' +
      '<button class="btn" data-tk="' + act + '"' + ((state.mm || {}).signer ? '' : ' disabled') + '>' + btn + '</button>' +
      '<p class="note">One MetaMask confirmation. It also sends ' + esc(CFG.tkGas || '0.002') + ' ETH to the session key for gas.</p>'
  }
  function renderTk() {
    const w = state.tk.wallet, mm = state.mm || {}, acct = state.tk.acct, s = state.tk.sess
    const mode = !CFG.tradingAccounts ? 'none' : !acct ? (mm.account ? 'create' : 'connect') : sessActive() ? 'active' : 'start'
    if (state.tk.mode !== mode + !!mm.signer) {
      state.tk.mode = mode + !!mm.signer
      let h = '<div class="card tkcard"><h3>Fast trading</h3>'
      if (mode === 'none') h += '<p class="lead">Fast trading needs the trading-account contract, which is not deployed on ' + esc(CFG.network) + ' yet.</p>'
      else if (mode === 'connect') h += '<p class="lead">Connect MetaMask: the trading account belongs to your wallet.</p>'
      else if (mode === 'create') h += '<p class="lead">Trade without a wallet pop-up for every order, like an agent key on Hyperliquid. Your funds sit in a trading account that only your wallet owns. ' +
        'A session key in this browser may trade for it within the limits below and can send funds back to you, never anywhere else.</p>' + tkForm('Create trading account and start session', 'create')
      else if (mode === 'start') h += '<p class="lead">No active session in this browser. Start one: a new session key is allowed to trade for your account within these limits.</p>' + tkForm('Start session', 'start')
      else h += '<p class="lead">Orders are signed by the session key: no pop-ups. It can only trade within the limits shown and send funds back to your wallet.</p>'
      h += '<div id="tk-status"></div><div class="tkbtns" id="tk-btns"></div>'
      if (mode === 'active' || mode === 'start') h += '<div class="tkdep"><label class="tkf"><small>Deposit from your wallet</small><span class="field"><input id="tk-dep" inputmode="decimal" autocomplete="off" placeholder="0"><span class="unit">mUSDC</span></span></label><button class="btn ghost sm" data-tk="deposit">Deposit (MetaMask)</button></div>'
      h += '<p class="note">If this browser is lost or the key is stolen, the worst case is bad trades within these limits until the session ends. The key can never withdraw: everything goes back to your wallet only. ' +
        'You can end the session from MetaMask at any time. The contract is a prototype and not audited.</p></div>'
      $('tk').innerHTML = h; $('tk').__h = null
    }
    if (mode === 'none' || mode === 'connect') {
      // A key from before may still hold gas or tokens of its own: let it send them home.
      PUT('tk-btns').h = w && state.tk.eth > 0n && (mm.account || state.tk.owner) ? '<button class="btn ghost sm" data-tk="gas">Return the key\'s gas to ' + esc(short(mm.account || state.tk.owner)) + '</button>' : ''
      PUT('tk-status').h = ''
      return
    }
    let st = ''
    if (acct) {
      st = '<dl class="kv"><dt>Trading account</dt><dd>' + link(acct) + '</dd>'
      if (w) st += '<dt>Session key</dt><dd>' + link(w.address) + '</dd>'
      if (s && Number(s.expiry) > 0) {
        st += '<dt>Session</dt><dd' + (sessActive() ? '' : ' class="dn"') + '>' + fmtLeft(Number(s.expiry) - now()) + '</dd>' +
          '<dt>Volume used</dt><dd>' + amt(s.volumeUsed) + ' of ' + amt(s.volumeCap) + ' mUSDC</dd>' +
          '<dt>Price limits</dt><dd>buy ≤ NAV +' + (Number(s.maxPremiumBps) / 100) + '% · sell ≥ NAV −' + (Number(s.maxDiscountBps) / 100) + '%</dd>'
      }
      if (w) st += '<dt>Key gas</dt><dd' + (state.tk.eth !== null && state.tk.eth < TK_LOW ? ' class="dn"' : '') + '>' + (state.tk.eth === null ? '–' : Number(E.formatEther(state.tk.eth)).toFixed(5) + ' ETH') + '</dd>'
      st += '<dt>Signing now</dt><dd>' + (tkOn() ? '⚡ session key' : 'MetaMask') + '</dd></dl>'
    }
    PUT('tk-status').h = st
    let b = ''
    if (mode === 'active') {
      b += '<button class="btn' + (tkOn() ? ' ghost' : '') + ' sm" data-tk="' + (tkOn() ? 'off">Use MetaMask' : 'on">Use session key') + '</button>'
      b += '<button class="btn ghost sm" data-tk="withdraw">Send everything to my wallet</button>'
      b += '<button class="btn ghost sm" data-tk="end">End session, return gas</button>'
    } else if (mode === 'start') {
      b += '<button class="btn ghost sm" data-tk="withdraw"' + (mm.signer ? '' : ' disabled') + '>Send everything to my wallet (MetaMask)</button>'
      if (w && state.tk.eth > 0n) b += '<button class="btn ghost sm" data-tk="gas">Return the key\'s gas</button>'
    }
    PUT('tk-btns').h = b
  }
  async function tkSend(label, make) {
    const s = keySigner(), k = await tkNonce()
    log(label + ' – signed by the session key…')
    const tx = await make(s, k)
    state.tk.nonce = k + 1
    const t0 = Date.now(), rc = await confirmFast(tx)
    log('  confirmed in block ' + rc.blockNumber + ' after ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s.')
  }
  async function mmSend(label, make) {
    log(label + ' – confirm in your wallet…')
    const tx = await walletSend(make)
    log('  sent, waiting for confirmation…')
    const t0 = Date.now(), rc = await confirmFast(tx)
    log('  confirmed in block ' + rc.blockNumber + ' after ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s.')
  }
  function sessionParams() {
    const val = (id) => Number(String($(id).value).replace(',', '.'))
    const hours = val('tk-h'), cap = val('tk-cap'), prem = val('tk-prem'), disc = val('tk-disc')
    if (!(hours > 0 && hours <= 720)) throw new Error('Session length: 1 to 720 hours.')
    if (!(cap > 0)) throw new Error('Enter a volume cap.')
    if (!(prem >= 0 && prem <= 50 && disc >= 0 && disc <= 50)) throw new Error('Price limits: 0 to 50%.')
    return [BigInt(Math.floor(now() + hours * 3600)), E.parseUnits(String(cap), 6), Math.round(prem * 100), Math.round(disc * 100)]
  }
  // Everything the key holds itself (gas, tokens of a key from before) back to the owner.
  async function returnKeyFunds(to) {
    const addr = state.tk.wallet.address
    for (const [t, sym] of [[CFG.usdc, 'mUSDC'], ...state.funds.map((f) => [f.token, f.symbol || 'tokens'])]) {
      const bal = await read((p) => new E.Contract(t, ABI.erc20, p).balanceOf(addr))
      if (bal > 0n) await tkSend('Returning ' + amt(bal) + ' ' + sym + ' held by the key', (s, nonce) => new E.Contract(t, ABI.erc20, s).transfer(to, bal, Object.assign(feeOverrides(), { nonce })))
    }
    const bal = await read((p) => p.getBalance(addr))
    const blk = await read((p) => p.getBlock('latest'))
    const tip = CFG.fees ? E.parseUnits(CFG.fees.priorityGwei, 'gwei') : 0n
    const maxFee = (blk && blk.baseFeePerGas ? blk.baseFeePerGas * 2n : E.parseUnits('1', 'gwei')) + tip
    const gas = await read((p) => p.estimateGas({ from: addr, to, value: 1n }))
    const value = bal - gas * maxFee
    if (value > 0n) await tkSend('Returning ' + Number(E.formatEther(value)).toFixed(5) + ' ETH of gas', (s, nonce) => s.sendTransaction({ to, value, gasLimit: gas, maxFeePerGas: maxFee, maxPriorityFeePerGas: tip, nonce }))
  }
  // A fresh key for every session, so a key that may have been copied is never re-enabled.
  // Whatever the old key still holds goes back to the owner first.
  async function freshKey(to) {
    if (state.tk.wallet) {
      try { state.tk.eth = await read((p) => p.getBalance(state.tk.wallet.address)) } catch (e) { /* ignore */ }
      if (state.tk.eth > 0n) { try { await returnKeyFunds(to) } catch (e) { log('Could not return the old key\'s gas: ' + reason(e), true) } }
    }
    const w = E.Wallet.createRandom()
    state.tk.wallet = new E.Wallet(w.privateKey); state.tk.nonce = null; state.tk.eth = null; state.tk.sess = null
    store.set(TK, w.privateKey)
    return state.tk.wallet
  }
  async function tkClick(what) {
    if (state.busy) return
    if (what === 'goto') { setTab('portfolio'); return }
    if (what === 'on' || what === 'off') {
      state.tk.on = what === 'on'; state.tk.nonce = null; store.set(TK + '.on', state.tk.on ? '1' : '0')
      await syncWallet(); renderTk(); return
    }
    const mm = state.mm || {}
    state.busy = true; updateActions()
    try {
      if (what === 'create' || what === 'start') {
        if (!mm.signer) throw new Error('Connect MetaMask on ' + CFG.network + ' first.')
        const params = sessionParams()
        const key = await freshKey(mm.account)
        const value = E.parseEther(CFG.tkGas || '0.002')
        if (what === 'create') {
          const fac = new E.Contract(CFG.tradingAccounts, ABI.accounts, mm.signer)
          try { await fac.create.staticCall(key.address, ...params, { value }) } catch (e) { throw new Error('Blocked by the contract: ' + reason(e)) }
          await mmSend('Creating the trading account and starting a session', (s) => fac.connect(s).create(key.address, ...params, Object.assign({ value }, feeOverrides())))
        } else {
          const acc = new E.Contract(state.tk.acct, ABI.account, mm.signer)
          try { await acc.startSession.staticCall(key.address, ...params, { value }) } catch (e) { throw new Error('Blocked by the contract: ' + reason(e)) }
          await mmSend('Starting a session', (s) => acc.connect(s).startSession(key.address, ...params, Object.assign({ value }, feeOverrides())))
        }
        state.tk.on = true; store.set(TK + '.on', '1')
        await tkLoad(); await syncWallet()
        log('Session started. Orders are now signed by the session key. Mint test mUSDC or deposit from your wallet, then trade.')
      } else if (what === 'deposit') {
        const raw = String($('tk-dep').value).replace(/[,\s_]/g, '')
        if (!raw || !(Number(raw) > 0)) throw new Error('Enter an amount to deposit.')
        const a = E.parseUnits(raw, 6)
        await mmSend('Depositing ' + amt(a) + ' mUSDC into the trading account', (s) => new E.Contract(CFG.usdc, ABI.erc20, s).transfer(state.tk.acct, a, feeOverrides()))
        $('tk-dep').value = ''
      } else if (what === 'withdraw') {
        const assets = [[CFG.usdc, 'mUSDC'], ...state.funds.map((f) => [f.token, f.symbol || 'tokens'])]
        let moved = 0
        for (const [t, sym] of assets) {
          const bal = await read((p) => new E.Contract(t, ABI.erc20, p).balanceOf(state.tk.acct))
          if (bal === 0n) continue
          const label = 'Sending ' + amt(bal) + ' ' + sym + ' to your wallet'
          if (tkOn()) await tkSend(label, (s, nonce) => new E.Contract(state.tk.acct, ABI.account, s).withdrawToOwner(t, bal, Object.assign(feeOverrides(), { nonce })))
          else { if (!mm.signer) throw new Error('Connect MetaMask first.'); await mmSend(label, (s) => new E.Contract(state.tk.acct, ABI.account, s).withdrawToOwner(t, bal, feeOverrides())) }
          moved++
        }
        if (!moved) log('The trading account is empty.')
      } else if (what === 'end' || what === 'gas') {
        const to = mm.account || state.tk.owner
        if (!to) throw new Error('Connect MetaMask: the gas goes back to your wallet.')
        if (what === 'end' && sessActive()) {
          await tkSend('Ending the session', (s, nonce) => new E.Contract(state.tk.acct, ABI.account, s).endSession(state.tk.wallet.address, Object.assign(feeOverrides(), { nonce })))
        }
        await returnKeyFunds(to)
        if (what === 'end') { state.tk.on = false; store.set(TK + '.on', '0') }
        await tkLoad(); await syncWallet()
      }
    } catch (e) {
      log('Fast trading: ' + (e.message && e.message.startsWith('Blocked') ? e.message : reason(e)), true)
    } finally {
      state.busy = false
      await refresh(true); tkBalance(); updateActions()
    }
  }

  // ---------- actions ----------
  const need = (cond, msg) => (cond ? '' : msg)
  const F = {
    usdc: (k, ph) => ({ k, ph: ph || '0', type: 'amount', unit: 'mUSDC' }),
    tok: (k, ph) => ({ k, ph: ph || '0', type: 'amount', unit: 'token' }),
    address: (k, ph) => ({ k, ph, type: 'address' }),
    text: (k, ph) => ({ k, ph, type: 'text' })
  }
  const FEE = 9970n // the pool keeps 0.30% of every swap
  const ammOut = (amountIn, rIn, rOut) => (amountIn <= 0n || rIn === 0n || rOut === 0n ? 0n : (amountIn * FEE * rOut) / (rIn * 10000n + amountIn * FEE))
  const vsNav = (price, nav) => gapText(Number(((price - nav) * 10000n) / nav))
  const U6 = 10n ** 6n

  const ACTIONS = [
    { id: 'faucet', title: 'Get test mUSDC', btn: 'Get 100,000 test mUSDC', fields: [],
      why: () => '',
      steps: async (c) => [['Getting 100,000 test mUSDC', c.usdc, 'faucet', []]] },
    { id: 'mint', tab: 'pf', title: 'Get test mUSDC', lead: 'Play money for this prototype. Anyone can mint any amount.', btn: 'Mint test mUSDC', ghost: true,
      fields: [F.usdc('a')], chips: [{ l: '100k', v: '100000' }, { l: '1M', v: '1000000' }, { l: '2M', v: '2000000' }],
      why: () => '',
      steps: async (c, v) => [['Minting test mUSDC', c.usdc, 'mint', [c.account, v.a]]] },
    { id: 'buy', title: 'Primary sale', btn: 'Buy at $1.00',
      fields: [F.tok('a')], chips: [{ l: '100k', v: '100000' }, { l: '500k', v: '500000' }, { l: '1M', v: '1000000' }],
      why: (d) => need(!d.saleClosed, 'The primary sale is closed.'),
      pre: (d, m, v) => 'Cost: ' + amt(v.a) + ' mUSDC' + (m ? ' · wallet holds ' + amt(m.usdc) : ''),
      steps: async (c, v) => [await approval(c, c.usdc, c.f.fund, v.a, 'mUSDC'), ['Buying in the primary sale', c.fund, 'buy', [v.a]]] },
    { id: 'swapbuy', title: 'Buy in the pool', btn: 'Buy', term: 'buy', fields: [F.usdc('a')],
      why: (d) => need(d.saleClosed, 'The market opens when the sale closes.'),
      quote: (d, m, v) => {
        const out = ammOut(v.a, d.reserveUSDC, d.reserveToken)
        if (out === 0n || out >= d.reserveToken) return null
        const after = ((d.reserveUSDC + v.a) * U6) / (d.reserveToken - out)
        return [['You pay', amt(v.a) + ' mUSDC'], ['You receive about', amt(out) + ' ' + d.symbol], ['Average price', usd((v.a * U6) / out)], ['Pool price after', usd(after)],
          ['Vs NAV after', vsNav(after, d.navPerToken)], ['Pool fee', '0.30%'], ['Minimum received', amt((out * 99n) / 100n) + ' ' + d.symbol]]
      },
      steps: async (c, v) => {
        const out = await c.pool.quoteUSDCForToken(v.a)
        return [await approval(c, c.usdc, c.f.pool, v.a, 'mUSDC'), ['Buying in the pool', c.pool, 'swapUSDCForToken', [v.a, (out * 99n) / 100n]]]
      } },
    { id: 'sell', title: 'Sell in the pool', btn: 'Sell', term: 'sell', fields: [F.tok('a')],
      why: (d) => need(d.saleClosed, 'The market opens when the sale closes.'),
      quote: (d, m, v) => {
        const out = ammOut(v.a, d.reserveToken, d.reserveUSDC)
        if (out === 0n) return null
        const after = ((d.reserveUSDC - out) * U6) / (d.reserveToken + v.a)
        return [['You sell', amt(v.a) + ' ' + d.symbol], ['You receive about', amt(out) + ' mUSDC'], ['Average price', usd((out * U6) / v.a)], ['Pool price after', usd(after)],
          ['Vs NAV after', vsNav(after, d.navPerToken)], ['Pool fee', '0.30%'], ['Minimum received', amt((out * 99n) / 100n) + ' mUSDC']]
      },
      steps: async (c, v) => {
        const out = await c.pool.quoteTokenForUSDC(v.a)
        return [await approval(c, c.token, c.f.pool, v.a, c.d.symbol), ['Selling in the pool', c.pool, 'swapTokenForUSDC', [v.a, (out * 99n) / 100n]]]
      } },
    { id: 'subscribe', tab: 'pf', title: 'Follow-on', lead: 'New tokens from the selected fund at the higher of NAV and market price.', btn: 'Subscribe',
      fields: [F.tok('a')],
      show: (d) => d.followOnRemaining > 0n,
      why: (d) => need(d.followOnRemaining > 0n, 'No follow-on is open.'),
      pre: (d, m, v) => 'Cost about ' + amt((v.a * d.issuePrice) / U6) + ' mUSDC at ' + usd(d.issuePrice),
      steps: async (c, v) => {
        const maxPrice = (c.d.issuePrice * 102n) / 100n
        return [await approval(c, c.usdc, c.f.fund, (v.a * maxPrice) / U6 + 1n, 'mUSDC'), ['Subscribing to the follow-on', c.fund, 'subscribe', [v.a, maxPrice]]]
      } },
    { id: 'close', inline: true, title: 'Close the sale and open the market', btn: 'Close sale, open market', fields: [],
      show: (d) => !d.saleClosed,
      why: (d, m) => d.saleClosed ? 'The sale is already closed.' : d.sold < 19n * U6 ? 'Nothing has been sold yet.' : (m && m.isGP) || d.sold === SALE_CAP ? '' : 'Only the GP can close before sell-out.',
      steps: async (c) => [['Closing the sale', c.fund, 'closeSale', []]] },
    { id: 'buyback', inline: true, title: 'Trigger the buyback-and-burn', btn: 'Trigger buyback', optional: true,
      fields: [F.usdc('a', 'empty = maximum')],
      show: (d) => d.saleClosed,
      why: (d) => !d.saleClosed ? 'Opens with the market.' : d.marketPrice >= d.buybackTriggerPrice ? 'The market is not more than 10% below NAV.' :
        Number(d.lastBuyback) + Math.floor(state.year / 52) > now() ? 'Cooldown: ' + dur(Number(d.lastBuyback) + Math.floor(state.year / 52) - now()) + '.' :
          d.maxBuyback === 0n ? 'The vault holds no cash.' : '',
      pre: (d, m, v) => v.a === null && d.saleClosed ? 'Empty sends ' + amt(buybackAmount(d)) + ' mUSDC: the 1% limit, or less where that would lift the price above NAV.' : '',
      steps: async (c, v) => [['Triggering the buyback', c.fund, 'buyback', [v.a === null ? buybackAmount(c.d) : v.a]]] },
    { id: 'fee', inline: true, title: 'Mint the yearly management fee', btn: 'Mint fee tranche', fields: [],
      show: (d) => d.saleClosed,
      why: (d) => !d.saleClosed ? 'Starts when the sale closes.' : d.feeTranchesMinted >= 10n ? 'Lifetime cap of 10 tranches reached.' :
        Number(d.lastFeeMint) + state.year > now() ? 'Not due yet: ' + dur(Number(d.lastFeeMint) + state.year - now()) + '.' : '',
      steps: async (c) => [['Minting the management fee', c.fund, 'mintManagementFee', []]] },
    { id: 'deploy', tab: 'gp', gp: true, title: 'Deploy capital', lead: 'Send vault cash to an investment. It is booked at cost.', btn: 'Deploy capital',
      fields: [F.usdc('a'), F.address('to', 'Recipient address (the investment)'), F.text('memo', 'Memo, e.g. Acquisition: PortCo A')],
      why: (d) => need(d.saleClosed, 'Possible after the sale closes.'),
      pre: (d, m, v) => 'Vault cash after: ' + amt(d.vaultCash > v.a ? d.vaultCash - v.a : 0n) + ' mUSDC',
      steps: async (c, v) => [['Deploying capital', c.fund, 'deployCapital', [v.to, v.a, v.memo]]] },
    { id: 'mark', tab: 'gp', gp: true, title: 'Revalue the portfolio', lead: 'State what the off-chain investments are worth now. This is the oracle of the model.', btn: 'Report new value',
      fields: [F.usdc('val'), F.text('memo', 'Memo, e.g. Year-end valuation')],
      why: () => '',
      pre: (d, m, v) => d.outstandingSupply === 0n ? '' : 'NAV per token after: about ' + usd(((d.vaultCash + d.polCash + v.val) * U6) / d.outstandingSupply) + ' (now ' + usd(d.navPerToken) + ')',
      steps: async (c, v) => [['Revaluing the portfolio', c.fund, 'markInvestments', [v.val, v.memo]]] },
    { id: 'followon', tab: 'gp', gp: true, title: 'Open a follow-on', lead: 'Offer additional tokens. The price is set by the code, not by the GP.', btn: 'Open follow-on', fields: [F.tok('a')],
      why: (d) => need(d.saleClosed, 'Possible after the sale closes.'),
      pre: (d) => 'Issue price now: ' + usd(d.issuePrice),
      steps: async (c, v) => [['Opening the follow-on', c.fund, 'openFollowOn', [v.a]]] },
    { id: 'proceeds', tab: 'gp', gp: true, title: 'Return exit proceeds', lead: 'Cash from an exit goes back into the vault. Nothing is paid out: it compounds.', btn: 'Return proceeds',
      fields: [F.usdc('a'), F.usdc('rest', 'remaining portfolio value')],
      why: () => '',
      steps: async (c, v) => [await approval(c, c.usdc, c.f.fund, v.a, 'mUSDC'), ['Returning proceeds', c.fund, 'returnProceeds', [v.a, v.rest]]] },
    { id: 'claim', tab: 'gp', gp: true, title: 'Claim vested fee tokens', lead: 'Fee tokens unlock one year after they were minted.', btn: 'Claim', ghost: true, fields: [],
      why: (d) => need(d.claimable > 0n, 'Nothing has vested yet.'),
      steps: async (c) => [['Claiming vested fee tokens', c.vesting, 'claim', []]] },
    { id: 'propose', tab: 'govern', title: 'Propose a new GP', lead: 'Any holder of the selected fund can start a vote.', btn: 'Start the vote', fields: [F.address('to', 'Address of the new GP')],
      show: (d) => !d.voteActive,
      why: (d, m) => !d.saleClosed ? 'Possible after the sale closes.' : d.voteActive ? 'A vote is already running.' : m && m.token === 0n ? 'Token holders only.' : '',
      steps: async (c, v) => [['Proposing a new GP', c.fund, 'proposeRemoveGP', [v.to]]] },
    { id: 'vote', tab: 'govern', title: 'Vote yes', lead: 'Your tokens are locked in the fund until the vote ends, so no token votes twice.', btn: 'Lock tokens and vote yes',
      fields: [F.tok('a')], chips: [{ l: '50%', pct: 50, of: 'token' }, { l: 'Max', pct: 100, of: 'token' }],
      show: (d) => d.voteActive,
      why: (d, m) => !d.voteActive ? 'No vote is running.' : m && m.isGP ? 'The GP cannot vote on his own removal.' : '',
      steps: async (c, v) => [await approval(c, c.token, c.f.fund, v.a, c.d.symbol), ['Voting yes', c.fund, 'vote', [v.a]]] },
    { id: 'execute', tab: 'govern', title: 'Execute the removal', lead: 'Anyone can execute once more than 50% of eligible supply has voted yes.', btn: 'Replace the GP', fields: [],
      show: (d) => d.voteActive,
      why: (d) => !d.voteActive ? 'No vote is running.' : d.yesVotes * 10000n > d.eligibleSupply * 5000n ? '' : 'Threshold of more than 50% not reached.',
      steps: async (c) => [['Executing the GP removal', c.fund, 'executeRemoveGP', []]] },
    { id: 'withdraw', tab: 'govern', title: 'Withdraw locked votes', lead: 'Get your tokens back after the vote.', btn: 'Withdraw', ghost: true, fields: [],
      show: (d, m) => !!m && m.escrowed > 0n,
      why: (d, m) => m && m.escrowed === 0n ? 'You have no tokens locked.' : d.voteActive ? 'The vote is still running.' : '',
      steps: async (c) => [['Withdrawing locked votes', c.fund, 'withdrawVotes', [c.d.proposalId]]] }
  ]
  const ACT = Object.fromEntries(ACTIONS.map((a) => [a.id, a]))
  // With a session key, trades go through the trading account; the key holds no funds.
  const SESSION_STEPS = {
    swapbuy: async (c, v) => { const out = await c.pool.quoteUSDCForToken(v.a); return [['Buying in the pool via the trading account', c.acct, 'buyInPool', [state.selected, v.a, (out * 99n) / 100n]]] },
    sell: async (c, v) => { const out = await c.pool.quoteTokenForUSDC(v.a); return [['Selling in the pool via the trading account', c.acct, 'sellInPool', [state.selected, v.a, (out * 99n) / 100n]]] },
    buy: async (c, v) => [['Buying in the primary sale via the trading account', c.acct, 'buyPrimary', [state.selected, v.a]]],
    faucet: async (c) => [['Minting 100,000 test mUSDC to the trading account', c.usdc, 'mint', [c.account, 100000n * U6]]],
    mint: async (c, v) => [['Minting test mUSDC to the trading account', c.usdc, 'mint', [c.account, v.a]]]
  }

  async function approval(c, erc20, spender, amount, label) {
    const cur0 = await erc20.allowance(c.account, spender)
    if (cur0 >= amount) return null
    return ['One-time approval for ' + label, erc20, 'approve', [spender, E.MaxUint256]]
  }

  function fieldsHtml(a) {
    return a.fields.map((f) => '<label class="field' + (f.type === 'amount' ? '' : ' txt') + '"><input data-k="' + f.k + '" placeholder="' + esc(f.ph) + '"' +
      (f.type === 'amount' ? ' inputmode="decimal"' : '') + ' autocomplete="off" spellcheck="false">' +
      (f.unit ? '<span class="unit"' + (f.unit === 'token' ? ' data-unit="token">token' : '>' + f.unit) + '</span>' : '') + '</label>').join('')
  }
  // Largest buyback within the 1% limit that leaves the pool price at or just below NAV.
  // The contract reverts a buyback that ends above NAV; with a large vault the 1% limit alone can.
  function buybackAmount(d) {
    const T = d.reserveToken, U = d.reserveUSDC, cap = d.maxBuyback, lim = (d.navPerToken * 9999n) / 10000n
    if (!T || !U || !cap) return cap
    const after = (a) => { const inF = a * 9970n, out = (inF * T) / (U * 10000n + inF); return ((U + a) * U6) / (T - out) }
    if (after(cap) <= lim) return cap
    let lo = 0n, hi = cap
    while (hi - lo > 1n) { const mid = (lo + hi) / 2n; if (after(mid) <= lim) lo = mid; else hi = mid }
    return lo
  }

  function actHtml(a, o) {
    o = o || {}
    const chips = a.chips ? '<div class="chips">' + a.chips.map((c, i) => '<button type="button" class="chip" data-chip="' + i + '">' + c.l + '</button>').join('') + '</div>' : ''
    const cls = 'btn go' + (a.ghost || o.ghost ? ' ghost' : '')
    if (a.inline || o.inline) return '<div class="act" data-a="' + a.id + '">' + fieldsHtml(a) + '<button class="' + cls + ' sm">' + a.btn + '</button>' + (a.pre ? '<p class="note pre"></p>' : '') + '<p class="note why"></p></div>'
    return '<div class="card act" data-a="' + a.id + '"><h3>' + a.title + '</h3>' + (a.lead ? '<p class="lead">' + a.lead + '</p>' : '') + fieldsHtml(a) + chips +
      '<p class="note pre"></p><p class="note why"></p><button class="' + cls + '">' + a.btn + '</button></div>'
  }
  const ticks = '<input class="orange" type="range" min="0" max="100" step="1" value="0" aria-label="Share of available balance"><div class="oticks">' +
    [0, 25, 50, 75, 100].map((v) => '<button type="button" data-pct="' + v + '">' + v + ' %</button>').join('') + '</div>'
  const orderForm = (id, label, unit) => '<div class="oform" data-a="' + id + '"><label class="ofield"><span>' + label + '</span><input data-k="a" inputmode="decimal" autocomplete="off" placeholder="0.00"><em' +
    (unit ? '>' + unit : ' data-unit="token">token') + '</em></label>' + ticks + '<div class="oquote"></div><p class="qwarn why"></p><button class="ogo go ' + (id === 'sell' ? 's' : 'b') + '">' + (id === 'sell' ? 'Sell' : 'Buy') + ' <span data-unit="token">token</span></button></div>'

  function buildActions(force) {
    const key = state.selected + '|' + (state.signer ? state.account : 'none')
    if (!force && key === state.actionsKey) return updateActions()
    state.actionsKey = key
    $('torder').innerHTML = '<div class="oside" role="group" aria-label="Side"><button class="b" data-side="buy">Buy</button><button class="s" data-side="sell">Sell</button></div>' +
      '<div class="otype" role="group" aria-label="Order type"><button aria-pressed="true">Market</button></div>' +
      '<div class="oav"><span>Available</span><span id="oav">–</span></div>' + orderForm('swapbuy', 'Spend', 'mUSDC') + orderForm('sell', 'Size', '') +
      '<div class="oacct"><div class="oh">Account</div><div id="oacct"></div><div data-a="faucet"><button class="oclaim go">Get 100,000 test mUSDC</button><p class="qwarn why"></p></div></div>'
    $('ipo').innerHTML = '<div class="oh">Primary sale</div><div id="ipoStatus"></div>' +
      '<div class="oform" data-a="buy">' + fieldsHtml(ACT.buy) + '<div class="chips">' + ACT.buy.chips.map((c, i) => '<button type="button" class="chip" data-chip="' + i + '">' + c.l + '</button>').join('') +
      '</div><p class="note pre"></p><p class="qwarn why"></p><button class="ogo b go">Buy at $1.00</button></div>' +
      '<div class="oacct"><div class="oh">Account</div><div id="oacct2"></div><div data-a="faucet"><button class="oclaim go">Get 100,000 test mUSDC</button><p class="qwarn why"></p></div>' +
      '<div data-a="close"><button class="btn ghost sm go" style="width:100%">Close the sale, open the market</button><p class="qwarn why"></p></div></div>'
    for (const tab of ['gp', 'govern', 'pf']) $('act-' + tab).innerHTML = ACTIONS.filter((x) => x.tab === tab).map((a) => actHtml(a)).join('')
    $('rules').innerHTML = RULES.map((r) => '<div class="light" data-rule="' + r.k + '"><span class="lamp"></span><div class="grow"><div class="t">' + r.t + '</div><div class="d">' + r.p +
      '</div><div class="st"></div>' + (r.act ? actHtml(ACT[r.act], { inline: true }) : '') + '</div></div>').join('')
    updateActions()
  }

  function available() { const m = state.me; return !m ? 0n : state.side === 'buy' ? m.usdc : m.token }
  function updateActions() {
    const d = state.detail, m = state.me
    document.querySelectorAll('#torder .oside button').forEach((b) => b.classList.toggle('on', b.dataset.side === state.side))
    for (const row of document.querySelectorAll('[data-a]')) {
      const a = ACT[row.dataset.a]
      if (!a) continue
      let why = '', soft = false
      if (!d) { why = 'Loading…'; soft = true }
      else if (!state.signer) { why = a.why(d, null); if (!why) { why = 'Connect a wallet on ' + CFG.network + ' to send this.'; soft = true } }
      else why = (tkOn() && !SESSION_ONLY[a.id] && !SESSION_DIRECT[a.id] ? 'The session key can only trade: switch to MetaMask for this.' : '') ||
        (a.gp && m && !m.isGP ? 'Only the GP of this sub-fund can do this.' : '') || a.why(d, m)
      if (a.term) row.hidden = a.term !== state.side
      else if (a.show && (row.classList.contains('card') || row.closest('.light'))) row.hidden = !!d && !a.show(d, m)
      const note = row.querySelector('.why')
      if (note) { if (note.textContent !== why) note.textContent = why; note.classList.toggle('soft', soft) }
      row.querySelector('.go').disabled = !!why || state.busy || !state.signer
      row.querySelectorAll('[data-unit="token"]').forEach((u) => { if (d && u.textContent !== d.symbol) u.textContent = d.symbol })
      let v = null
      if (d && (a.pre || a.quote)) { try { v = readFields(a, row) } catch (e) { v = null } }
      const pre = row.querySelector('.pre')
      if (pre) { const text = v && a.pre ? a.pre(d, m, v) || '' : ''; if (pre.textContent !== text) pre.textContent = text }
      const q = row.querySelector('.oquote')
      if (q) {
        const rows = v && a.quote ? a.quote(d, m, v) : null
        const html = rows ? rows.map((r) => '<div class="qrow"><span>' + r[0] + '</span><span>' + esc(r[1]) + '</span></div>').join('') : '<div class="qrow"><span>Enter a size to see the quote</span><span></span></div>'
        if (q.__h !== html) { q.innerHTML = html; q.__h = html }
      }
    }
    if (d) {
      const av = $('oav'); if (av) av.textContent = m ? amt(available()) + ' ' + (state.side === 'buy' ? 'mUSDC' : d.symbol) : '–'
      const ac = $('oacct')
      if (ac) {
        const html = m ? '<div class="qrow"><span>mUSDC</span><span>' + amt(m.usdc) + '</span></div><div class="qrow"><span>' + esc(d.symbol) + '</span><span>' + amt(m.token) + '</span></div><div class="qrow"><span>Value at pool price</span><span>$' +
          cmp(num(m.token) * num(d.marketPrice)) + '</span></div><div class="qrow"><span>Value at NAV</span><span>$' + cmp(num(m.token) * num(d.navPerToken)) + '</span></div>'
          : '<div class="qrow"><span>' + (window.ethereum ? 'Connect a wallet to trade' : 'Read-only: no wallet in this browser') + '</span><span></span></div>'
        const full = html + signLine()
        if (ac.__h !== full) { ac.innerHTML = full; ac.__h = full }
      }
      $('torder').hidden = !d.saleClosed
      $('ipo').hidden = d.saleClosed
    }
  }

  function readFields(a, row) {
    const v = {}
    for (const f of a.fields) {
      const raw = row.querySelector('[data-k="' + f.k + '"]').value.trim()
      if (f.type === 'amount') {
        if (!raw && a.optional) { v[f.k] = null; continue }
        const clean = raw.replace(/[,\s_]/g, '')
        if (!/^\d+(\.\d{1,6})?$/.test(clean)) throw new Error('Enter an amount (digits, up to 6 decimals).')
        v[f.k] = E.parseUnits(clean, D)
        if (v[f.k] <= 0n && f.k === 'a') throw new Error('The amount must be greater than zero.')
      } else if (f.type === 'address') {
        if (!E.isAddress(raw)) throw new Error('"' + raw + '" is not a valid address.')
        v[f.k] = E.getAddress(raw)
      } else v[f.k] = raw
    }
    return v
  }

  let toastTimer = null
  function log(msg, bad) {
    const box = $('txlog')
    box.textContent += (box.textContent ? '\n' : '') + msg
    box.scrollTop = box.scrollHeight
    const t = $('toast')
    t.hidden = false
    t.className = 'toast' + (bad ? ' bad' : '')
    t.innerHTML = '<b>' + (bad ? 'Not sent' : 'Transaction') + '</b>' + esc(msg.trim())
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { if (!state.busy) t.hidden = true }, bad ? 9000 : 6000)
  }

  async function runAction(a, row) {
    if (state.busy || !state.signer || !state.detail) return
    let v
    try { v = readFields(a, row) } catch (e) { log(a.title + ': ' + e.message, true); return }
    state.busy = true; updateActions()
    if (tkOn() && state.tk.eth !== null && state.tk.eth < TK_LOW) { log('The session key has almost no gas left: start a new session under Portfolio › Fast trading.', true); return }
    const f = cur(), s = tkOn() ? keySigner() : state.signer
    const c = {
      account: state.account, f, d: state.detail,
      fund: new E.Contract(f.fund, ABI.fund, s), token: new E.Contract(f.token, ABI.erc20, s),
      pool: new E.Contract(f.pool, ABI.pool, s), vesting: new E.Contract(f.vesting, ABI.vesting, s),
      usdc: new E.Contract(CFG.usdc, ABI.erc20, s),
      acct: tkOn() ? new E.Contract(state.tk.acct, ABI.account, s) : null
    }
    try {
      const steps = (await (tkOn() && SESSION_STEPS[a.id] ? SESSION_STEPS[a.id] : a.steps)(c, v)).filter(Boolean)
      for (let i = 0; i < steps.length; i++) {
        const [label, contract, method, args] = steps[i]
        const fn = contract.getFunction(method)
        try { await fn.staticCall(...args) } catch (e) { throw new Error('Blocked by the contract: ' + reason(e)) }
        log((steps.length > 1 ? 'Step ' + (i + 1) + '/' + steps.length + ': ' : '') + label + (tkOn() ? ' – signed by the session key…' : ' – confirm in your wallet…'))
        const opts = feeOverrides(), k = tkOn() ? await tkNonce() : null
        if (k !== null) opts.nonce = k
        const tx = k !== null ? await fn(...args, opts) : await walletSend((sg) => (sg ? contract.connect(sg) : contract).getFunction(method)(...args, opts))
        if (k !== null) state.tk.nonce = k + 1
        const t0 = Date.now()
        log('  sent, waiting for confirmation…')
        const rc = await confirmFast(tx)
        log('  confirmed in block ' + rc.blockNumber + ' after ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s.')
      }
      row.querySelectorAll('input').forEach((inp) => { inp.value = inp.type === 'range' ? 0 : '' })
    } catch (e) {
      log(a.title + ': ' + (e.message && e.message.startsWith('Blocked') ? e.message : reason(e)), true)
    } finally {
      state.busy = false
      await refresh(true)
      updateActions(); tkBalance()
    }
  }

  function render() {
    renderTop(); renderWallet(); renderTk(); buildActions(false)
    renderHead(); renderChart(); renderBook(); renderBottom(); renderIpo()
    renderFunds(); renderKpis(); renderRules(); renderReports(); renderPortfolio(); renderGovern()
    updateActions()
  }

  // ---------- wiring ----------
  function selectFund(i) {
    state.fsel = false
    if (i === state.selected || !state.funds[i]) { renderTop(); return }
    state.selected = i; state.detail = null; state.me = null
    renderTop(); renderFunds(); buildActions(true)
    refresh(true)
  }
  function setTab(t) { state.tab = t; state.fsel = false; renderTop(); window.scrollTo(0, 0) }
  document.addEventListener('click', (e) => {
    const t = e.target
    const tkB = t.closest('[data-tk]'); if (tkB) { if (!tkB.disabled) tkClick(tkB.dataset.tk); return }
    const tabB = t.closest('[data-tab]'); if (tabB) { setTab(tabB.dataset.tab); return }
    if (t.closest('#fbtn') || t.closest('[data-open-funds]')) { state.fsel = !state.fsel; renderTop(); if (state.fsel) { const q = $('f-q'); if (q && window.innerWidth >= 700) q.focus() } return }
    const ff = t.closest('[data-ff]'); if (ff) { state.ff = ff.dataset.ff; $('fpanel').innerHTML = ''; renderTop(); return }
    const fundEl = t.closest('[data-fund]'); if (fundEl) { const i = Number(fundEl.dataset.fund); const go = fundEl.dataset.go; selectFund(i); if (go && state.tab !== go) setTab(go); return }
    if (state.fsel && !t.closest('.fpanel')) { state.fsel = false; renderTop() }
    const fundRow = t.closest('#funds [data-i]'); if (fundRow) { selectFund(Number(fundRow.dataset.i)); return }
    const sub = t.closest('[data-sub-tab]'); if (sub) { state.sub = sub.dataset.subTab; renderFunds(); return }
    const range = t.closest('[data-range]'); if (range) { state.range = range.dataset.range; if (state.detail) renderChart(); return }
    const pane = t.closest('[data-pane]'); if (pane) { state.pane = pane.dataset.pane; if (state.detail) renderBook(); return }
    const tt = t.closest('[data-ttab]'); if (tt) { state.ttab = tt.dataset.ttab; if (state.detail) renderBottom(); return }
    const side = t.closest('[data-side]'); if (side) { state.side = side.dataset.side; updateActions(); return }
    const row = t.closest('[data-a]')
    if (!row) return
    const a = ACT[row.dataset.a]
    if (!a) return
    const pctB = t.closest('[data-pct]')
    if (pctB) { setPct(row, Number(pctB.dataset.pct)); return }
    const chip = t.closest('[data-chip]')
    if (chip) {
      const c = a.chips[Number(chip.dataset.chip)], m = state.me
      const input = row.querySelector('[data-k="a"]')
      if (c.v) input.value = c.v
      else if (m) input.value = E.formatUnits(((c.of === 'usdc' ? m.usdc : m.token) * BigInt(c.pct)) / 100n, D)
      updateActions()
      return
    }
    if (t.closest('.go')) runAction(a, row)
  })
  function setPct(row, p) {
    const av = available()
    row.querySelector('[data-k="a"]').value = av > 0n && p > 0 ? E.formatUnits((av * BigInt(p)) / 100n, D) : ''
    const r = row.querySelector('.orange'); if (r) r.value = p
    updateActions()
  }
  document.addEventListener('input', (e) => {
    if (e.target.id === 'f-q') { state.fq = e.target.value; PUT('f-list').h = fundList(); return }
    if (e.target.classList.contains('orange')) { setPct(e.target.closest('[data-a]'), Number(e.target.value)); return }
    if (e.target.closest('[data-a]')) updateActions()
  })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.fsel) { state.fsel = false; renderTop() } })
  window.addEventListener('resize', () => { if (state.fsel) placePanel() })
  $('walletChip').onclick = () => { if (!state.account) connect(); else if (!state.walletChainOk) switchChain() }
  $('chartBox').addEventListener('mousemove', chartHover)
  $('chartBox').addEventListener('mouseleave', chartHover)
  if (window.ethereum && window.ethereum.on) {
    window.ethereum.on('accountsChanged', syncWallet)
    window.ethereum.on('chainChanged', syncWallet)
  }
  $('netChip').textContent = CFG.short || CFG.network
  document.querySelectorAll('.cfgnet').forEach((e) => { e.textContent = CFG.network })
  const NETS = window.PERMA_NETWORKS || {}
  const others = Object.keys(NETS).filter((k) => k !== CFG.key)
  if (others.length) $('netChip').insertAdjacentHTML('afterend', others.map((k) => '<a class="net alt" href="?net=' + esc(k) + '" title="Open the ' + esc(NETS[k].network) + ' deployment">' + esc(NETS[k].short) + '</a>').join(''))
  renderTop()
  if (!CFG.umbrella) {
    // Network configured but nothing deployed there yet: say so instead of failing to read.
    $('fatal').hidden = false
    $('fatal').textContent = 'PERMA is not deployed on ' + CFG.network + ' yet. Run scripts/perma/deploy_arbitrum_sepolia.ts in Remix, then enter the addresses in docs/config.js.'
    $('netText').textContent = CFG.network
    syncWallet()
    return
  }
  setInterval(() => { if (state.detail) { renderRules(); renderGovern(); updateActions(); setNet(state.netOk) } }, 1000)
  setInterval(() => refresh(false), CFG.pollMs)
  setInterval(() => tkBalance(), Math.max(CFG.pollMs, 4000))
  syncWallet(); tkBalance()
})()
