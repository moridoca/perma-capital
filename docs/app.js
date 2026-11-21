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
      'function mint(address to, uint256 amount)'
    ]
  }
  const IFACE = { fund: new E.Interface(ABI.fund), pool: new E.Interface(ABI.pool), vesting: new E.Interface(ABI.vesting) }

  const state = {
    rpcIndex: 0, provider: null,
    funds: [], selected: 0, detail: null, me: null, tab: 'home', side: 'buy',
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
    return rows.map((o) => ({
      name: o[0], fund: o[1], token: o[2], pool: o[3], vesting: o[4],
      nav: o[5], price: o[6], premiumBps: o[7], netAssets: o[8]
    }))
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

  async function loadMe(p, f, d) {
    if (!state.account) return null
    const usdc = new E.Contract(CFG.usdc, ABI.erc20, p)
    const token = new E.Contract(f.token, ABI.erc20, p)
    const fund = new E.Contract(f.fund, ABI.fund, p)
    const [u, t, esc0] = await Promise.all([
      usdc.balanceOf(state.account), token.balanceOf(state.account), fund.escrowed(d.proposalId, state.account)
    ])
    return { usdc: u, token: t, escrowed: esc0, isGP: d.gp.toLowerCase() === state.account.toLowerCase() }
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
      const me = await read((p) => loadMe(p, f, d))
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


  // ---------- rendering ----------
  const TABS = [['home', 'Home'], ['trade', 'Trade'], ['rules', 'Rules'], ['gp', 'Manager'], ['govern', 'Govern'], ['activity', 'Activity']]
  const ICON = {
    home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
    trade: '<path d="M7 20V4M7 4L4 7M7 4l3 3M17 4v16M17 20l-3-3M17 20l3-3"/>',
    rules: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-4.5"/>',
    gp: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M3 13h18"/>',
    govern: '<path d="M4 20h16M6 20V10M10 20V10M14 20V10M18 20V10M3 10l9-6 9 6z"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>'
  }
  const gapText = (bps) => (bps < 0 ? 'discount ' : 'premium ') + pct(Math.abs(bps))
  const gapPill = (price, bps) => price === 0n ? '<span class="pill">market not open</span>'
    : '<span class="pill ' + (Number(bps) < 0 ? 'warn' : 'okp') + '">' + gapText(Number(bps)) + '</span>'
  const letter = (name) => { const w = String(name).trim().split(/\s+/); return (w[1] || w[0] || '?').charAt(0).toUpperCase() }

  function renderTabs() {
    $('tabs').innerHTML = TABS.map((t) => '<button data-tab="' + t[0] + '"' + (state.tab === t[0] ? ' aria-current="page"' : '') +
      '><svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[t[0]] + '</svg>' + t[1] + '</button>').join('')
    $('app').dataset.tab = state.tab
    document.querySelectorAll('main > section').forEach((s) => { s.hidden = s.dataset.view !== state.tab })
  }

  function renderFunds() {
    $('funds').innerHTML = state.funds.map((f, i) =>
      '<button class="row' + (i === state.selected ? ' on' : '') + '" data-i="' + i + '"><span class="badge">' + esc(letter(f.name)) + '</span>' +
      '<span class="grow"><span class="t">' + esc(f.name) + '</span><span class="d">Net assets ' + amt(f.netAssets) + ' mUSDC · market ' +
      (f.price === 0n ? 'not open' : usd(f.price)) + '</span></span>' +
      '<span class="r"><span class="t num">' + usd(f.nav) + '</span><span class="d">' + gapPill(f.price, f.premiumBps) + '</span></span></button>').join('')
  }

  function renderHero() {
    const d = state.detail, f = state.funds[state.selected], open = d.saleClosed
    $('hero').innerHTML = '<div class="sechead"><h1>' + esc(f.name) + '</h1>' + gapPill(open ? d.marketPrice : 0n, d.premiumBps) + '</div>' +
      '<h2 style="margin-top:14px">NAV per token</h2><div class="big">' + usd(d.navPerToken) + '</div>' +
      '<div class="sub">Market <b class="num">' + (open ? usd(d.marketPrice) : '–') + '</b> · net assets <b class="num">' + amt(d.netAssets) + '</b> mUSDC' +
      (d.netAssets === 0n ? ' · no assets yet, NAV shows the $1.00 issue price' : '') + '</div>' +
      '<div class="ids">' + esc(d.symbol) + ' · fund ' + link(f.fund) + ' · GP ' + link(d.gp) + '</div>'
    $('strip').innerHTML = '<b>' + esc(d.symbol) + '</b><span>NAV <span class="num">' + usd(d.navPerToken) + '</span></span><span>Mkt <span class="num">' +
      (open ? usd(d.marketPrice) : '–') + '</span></span>' + gapPill(open ? d.marketPrice : 0n, d.premiumBps)
    $('fundTitle').textContent = f.name
  }

  const cell = (k, v, s) => '<div><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + (s || '&nbsp;') + '</div></div>'
  function renderKpis() {
    const d = state.detail, s = esc(d.symbol)
    const share = d.netAssets > 0n ? Number((d.investedValue * 10000n) / d.netAssets) / 100 : 0
    $('kpis').innerHTML =
      cell('Net assets', amt(d.netAssets), 'mUSDC') +
      cell('Vault cash', amt(d.vaultCash), 'mUSDC, read on-chain') +
      cell('Invested value', amt(d.investedValue), '<span class="pill warn">GP-reported</span> ' + share.toFixed(1) + '% of net assets') +
      cell('Outstanding supply', amt(d.outstandingSupply), s + ', excl. fund-owned pool tokens') +
      cell('Pool reserves', d.saleClosed ? amt(d.reserveToken) + ' / ' + amt(d.reserveUSDC) : '–', d.saleClosed ? s + ' / mUSDC' : 'opens when the sale closes') +
      cell('Fund-owned liquidity', d.saleClosed ? amt(d.polTokens) + ' / ' + amt(d.polCash) : '–', d.saleClosed ? s + ' / mUSDC, cannot be withdrawn' : 'created when the sale closes')
  }

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
      if (st.innerHTML !== html) st.innerHTML = html
    }
    const d = state.detail, t = now()
    let gov = '<dl class="kv"><dt>Current GP</dt><dd>' + link(d.gp) + '</dd><dt>Eligible supply</dt><dd>' + amt(d.eligibleSupply) + ' ' + esc(d.symbol) + '</dd>'
    if (d.voteActive) {
      const share = d.eligibleSupply > 0n ? Number((d.yesVotes * 10000n) / d.eligibleSupply) / 100 : 0
      gov += '<dt>Vote #' + d.proposalId + '</dt><dd>replace with ' + link(d.proposedGP) + '</dd><dt>Yes votes</dt><dd>' + amt(d.yesVotes) + ' (' + share.toFixed(1) + '%)</dd><dt>Closes in</dt><dd>' + dur(Number(d.voteDeadline) - t) + '</dd></dl>' +
        '<div class="meter"><i style="width:' + Math.min(100, share) + '%"></i><b style="left:50%"></b></div><p class="note">The marker is the threshold: more than 50% of eligible supply.</p>'
    } else gov += '<dt>Vote</dt><dd>none running</dd><dt>Voting period</dt><dd>' + dur(state.voting) + '</dd></dl>'
    if ($('govBox').innerHTML !== gov) $('govBox').innerHTML = gov
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

  function renderFeed() {
    const sc = state.scan[state.selected], s = state.detail.symbol
    if (!sc) { $('feed').innerHTML = '<div class="row"><span class="d">Loading history…</span></div>'; return }
    const items = []
    for (let i = sc.events.length - 1; i >= 0 && items.length < 20; i--) {
      const ev = sc.events[i]
      const text = describe(ev, s)
      if (!text) continue
      const t = sc.ts[ev.block]
      items.push('<div class="row"><span class="grow"><span class="t" style="font-weight:500">' + esc(text) + '</span><span class="d">' + (t !== undefined ? esc(clock(t, true)) + ' · ' : '') +
        '<a target="_blank" rel="noopener" href="' + esc(CFG.explorer) + '/tx/' + esc(ev.tx) + '">block ' + ev.block + '</a></span></span></div>')
    }
    $('feed').innerHTML = (sc.failed ? '<div class="row"><span class="d">Event history could not be fully loaded from the public endpoint.</span></div>' : '') +
      (items.length ? items.join('') : '<div class="row"><span class="d">No activity in this sub-fund yet.</span></div>')
  }

  function renderFooter() {
    const f = state.funds[state.selected]
    $('footNet').textContent = CFG.network
    const rows = [['Umbrella', CFG.umbrella], ['mUSDC', CFG.usdc], ['Fund', f.fund], ['Token', f.token], ['Pool', f.pool], ['Vesting', f.vesting]]
    $('addrs').innerHTML = rows.map((r) => '<dt>' + r[0] + '</dt><dd><a target="_blank" rel="noopener" href="' + esc(CFG.explorer) + '/address/' + esc(r[1]) + '">' + esc(r[1]) + '</a></dd>').join('')
  }

  // ---------- chart ----------
  const CH = { w: 480, h: 240, l: 46, r: 8, t: 10, b: 22 }
  let chartPts = []
  function renderChart() {
    const svg = $('chart')
    const d = state.detail
    const pts = chartPts = buildSeries(state.selected)
    if (!d.saleClosed || !pts.length) {
      svg.innerHTML = '<text class="msg" x="240" y="124" text-anchor="middle">' +
        (d.saleClosed ? 'Loading price history…' : 'The chart starts when the sale closes and the market opens.') + '</text>'
      svg._scale = null
      $('chartRead').textContent = ''
      return
    }
    const tEnd = Math.max(now(), pts[pts.length - 1].t)
    let t0 = pts[0].t
    if (tEnd - t0 < 60) t0 = tEnd - 60
    let lo = Infinity, hi = -Infinity
    for (const p of pts) { lo = Math.min(lo, p.nav, p.price); hi = Math.max(hi, p.nav, p.price) }
    if (hi - lo < 0.02) { lo -= 0.02; hi += 0.02 }
    const pad = (hi - lo) * 0.1; lo -= pad; hi += pad
    const X = (t) => CH.l + ((t - t0) / (tEnd - t0)) * (CH.w - CH.l - CH.r)
    const Y = (v) => CH.t + (1 - (v - lo) / (hi - lo)) * (CH.h - CH.t - CH.b)
    let g = ''
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4, y = Y(v)
      g += '<line class="g" x1="' + CH.l + '" x2="' + (CH.w - CH.r) + '" y1="' + y + '" y2="' + y + '"/>' +
        '<text class="lb" x="' + (CH.l - 6) + '" y="' + (y + 3) + '" text-anchor="end">$' + v.toFixed(3) + '</text>'
    }
    const multiDay = tEnd - t0 > 86400
    for (let i = 0; i <= 2; i++) {
      const t = t0 + ((tEnd - t0) * i) / 2
      g += '<text class="lb" x="' + X(t) + '" y="' + (CH.h - 6) + '" text-anchor="' + (i === 0 ? 'start' : i === 2 ? 'end' : 'middle') + '">' + esc(clock(t, multiDay)) + '</text>'
    }
    let navPath = '', pricePath = '', bands = ''
    pts.forEach((p, i) => {
      const x = X(Math.max(p.t, t0)), xn = i + 1 < pts.length ? X(Math.max(pts[i + 1].t, t0)) : X(tEnd)
      navPath += (i ? ' V' + Y(p.nav) : 'M' + x + ',' + Y(p.nav)) + ' H' + xn
      pricePath += (i ? ' V' + Y(p.price) : 'M' + x + ',' + Y(p.price)) + ' H' + xn
      const y1 = Math.min(Y(p.nav), Y(p.price)), hgt = Math.abs(Y(p.nav) - Y(p.price))
      if (hgt > 0.5 && xn > x) bands += '<rect class="gap' + (p.price < p.nav ? '' : ' pos') + '" x="' + x + '" y="' + y1 + '" width="' + (xn - x) + '" height="' + hgt + '"/>'
    })
    svg.innerHTML = g + bands + '<path class="bid" d="' + pricePath + '"/><path class="nav" d="' + navPath + '"/>' +
      '<line id="guide" class="guide" y1="' + CH.t + '" y2="' + (CH.h - CH.b) + '" visibility="hidden"/>'
    svg._scale = { t0, tEnd }
    readout(pts[pts.length - 1], true)
  }
  function readout(p, latest) {
    const gap = Math.trunc((p.price / p.nav - 1) * 10000) / 100 // truncated like premiumBps() in the contract
    $('chartRead').textContent = (latest ? 'now' : clock(p.t, true)) + ' · NAV $' + p.nav.toFixed(4) + ' · mkt $' + p.price.toFixed(4) +
      ' · ' + (gap < 0 ? 'discount ' : 'premium ') + Math.abs(gap).toFixed(2) + '%'
  }
  function chartHover(e) {
    const svg = $('chart'), sc = svg._scale
    if (!sc || !chartPts.length) return
    const box = svg.getBoundingClientRect()
    const x = ((e.clientX - box.left) / box.width) * CH.w
    const t = sc.t0 + ((x - CH.l) / (CH.w - CH.l - CH.r)) * (sc.tEnd - sc.t0)
    let p = chartPts[0]
    for (const q of chartPts) if (q.t <= t) p = q
    const guide = svg.querySelector('#guide')
    if (guide && x >= CH.l && x <= CH.w - CH.r) { guide.setAttribute('x1', x); guide.setAttribute('x2', x); guide.setAttribute('visibility', 'visible') }
    readout(p, false)
  }
  function chartLeave() {
    const guide = $('chart').querySelector('#guide')
    if (guide) guide.setAttribute('visibility', 'hidden')
    if (chartPts.length) readout(chartPts[chartPts.length - 1], true)
  }

  // ---------- wallet ----------
  const feeOverrides = () => (CFG.fees ? {
    maxPriorityFeePerGas: E.parseUnits(CFG.fees.priorityGwei, 'gwei'), maxFeePerGas: E.parseUnits(CFG.fees.maxGwei, 'gwei')
  } : {})
  const reason = (e) => {
    const r = (e && (e.reason || (e.revert && e.revert.args && e.revert.args[0]) || e.shortMessage || (e.info && e.info.error && e.info.error.message) || e.message)) || String(e)
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
    } catch (e) { log('Wallet: ' + reason(e), true) }
    syncWallet()
  }

  function renderWallet() {
    const chip = $('walletChip'), m = state.me, d = state.detail
    const set = (role, text, disabled) => { chip.dataset.role = role; chip.disabled = !!disabled; chip.querySelector('span').textContent = text }
    let hint = '', box
    if (!window.ethereum) {
      set('none', 'Read-only', true)
      box = '<div style="grid-column:1/-1"><div class="k">Read-only</div><div class="s">This browser has no wallet. Open the page in a browser with MetaMask to send transactions. Reading works without one.</div></div>'
    } else if (!state.account) {
      set('connect', 'Connect wallet')
      box = '<div style="grid-column:1/-1"><div class="k">Not connected</div><div class="s">Connect a wallet to send transactions. You need a little Sepolia test ETH for gas.</div></div>'
    } else if (!state.walletChainOk) {
      set('connect', 'Switch network')
      box = '<div style="grid-column:1/-1"><div class="k">Wrong network</div><div class="s">Wallet ' + esc(short(state.account)) + ' is on another network. Use the button at the top to switch to ' + esc(CFG.network) + '.</div></div>'
    } else {
      const gp = m && m.isGP
      set(gp ? 'gp' : 'investor', short(state.account) + (gp ? ' · GP' : ''))
      hint = link(state.account)
      box = m && d ? cell('mUSDC', amt(m.usdc), 'test money') + cell(esc(d.symbol), amt(m.token), 'fund tokens') +
        (m.escrowed > 0n ? cell('Locked in vote', amt(m.escrowed), esc(d.symbol)) : '') +
        cell('Role', gp ? 'GP' : 'Investor', gp ? 'you are the GP of this sub-fund' : 'token holder or visitor')
        : '<div style="grid-column:1/-1"><div class="s">Loading balances…</div></div>'
    }
    if ($('walletBox').innerHTML !== box) $('walletBox').innerHTML = box
    $('walletHint').innerHTML = hint
    $('gpHint').innerHTML = d ? (m && m.isGP ? '<span class="pill warn">you are the GP</span>' : 'GP is ' + link(d.gp)) : ''
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
  const vsNav = (price, nav) => { const b = Number(((price - nav) * 10000n) / nav); return gapText(b) }

  const ACTIONS = [
    { id: 'mint', tab: 'trade', title: 'Get test mUSDC', lead: 'Play money for this prototype. Anyone can mint it.', btn: 'Mint test mUSDC', ghost: true,
      fields: [F.usdc('a')], chips: [{ l: '100k', v: '100000' }, { l: '1M', v: '1000000' }, { l: '2M', v: '2000000' }],
      why: () => '',
      steps: async (c, v) => [['Minting test mUSDC', c.usdc, 'mint', [c.account, v.a]]] },
    { id: 'buy', tab: 'trade', title: 'Primary sale', lead: 'Buy new tokens from the fund at a fixed $1.00. This is the only issue: no capital calls later.', btn: 'Buy at $1.00',
      fields: [F.tok('a')], chips: [{ l: '100k', v: '100000' }, { l: '500k', v: '500000' }, { l: '1M', v: '1000000' }],
      show: (d) => !d.saleClosed,
      why: (d) => need(!d.saleClosed, 'The primary sale is closed.'),
      pre: (d, m, v) => 'Cost: ' + amt(v.a) + ' mUSDC',
      steps: async (c, v) => [await approval(c, c.usdc, c.f.fund, v.a, 'mUSDC'), ['Buying in the primary sale', c.fund, 'buy', [v.a]]] },
    { id: 'swapbuy', tab: 'trade', side: 'buy', title: 'Buy in the pool', lead: 'Swap mUSDC for fund tokens at the market price.', btn: 'Buy',
      fields: [F.usdc('a')], chips: [{ l: '25%', pct: 25, of: 'usdc' }, { l: '50%', pct: 50, of: 'usdc' }, { l: 'Max', pct: 100, of: 'usdc' }],
      show: (d) => d.saleClosed,
      why: (d) => need(d.saleClosed, 'The market opens when the sale closes.'),
      pre: (d, m, v) => {
        const out = ammOut(v.a, d.reserveUSDC, d.reserveToken)
        if (out === 0n || out >= d.reserveToken) return ''
        const after = ((d.reserveUSDC + v.a) * 10n ** 6n) / (d.reserveToken - out)
        return 'You receive about ' + amt(out) + ' ' + d.symbol + ' · price after ' + usd(after) + ' (' + vsNav(after, d.navPerToken) + ' vs NAV now)'
      },
      steps: async (c, v) => {
        const out = await c.pool.quoteUSDCForToken(v.a)
        return [await approval(c, c.usdc, c.f.pool, v.a, 'mUSDC'), ['Buying in the pool', c.pool, 'swapUSDCForToken', [v.a, (out * 99n) / 100n]]]
      } },
    { id: 'sell', tab: 'trade', side: 'sell', title: 'Sell in the pool', lead: 'This is the exit: the fund never redeems. You sell to the market.', btn: 'Sell', sell: true,
      fields: [F.tok('a')], chips: [{ l: '25%', pct: 25, of: 'token' }, { l: '50%', pct: 50, of: 'token' }, { l: 'Max', pct: 100, of: 'token' }],
      show: (d) => d.saleClosed,
      why: (d) => need(d.saleClosed, 'The market opens when the sale closes.'),
      pre: (d, m, v) => {
        const out = ammOut(v.a, d.reserveToken, d.reserveUSDC)
        if (out === 0n) return ''
        const after = ((d.reserveUSDC - out) * 10n ** 6n) / (d.reserveToken + v.a)
        return 'You receive about ' + amt(out) + ' mUSDC · price after ' + usd(after) + ' (' + vsNav(after, d.navPerToken) + ' vs NAV now)'
      },
      steps: async (c, v) => {
        const out = await c.pool.quoteTokenForUSDC(v.a)
        return [await approval(c, c.token, c.f.pool, v.a, c.d.symbol), ['Selling in the pool', c.pool, 'swapTokenForUSDC', [v.a, (out * 99n) / 100n]]]
      } },
    { id: 'subscribe', tab: 'trade', title: 'Follow-on', lead: 'New tokens from the fund at the higher of NAV and market price.', btn: 'Subscribe',
      fields: [F.tok('a')],
      show: (d) => d.followOnRemaining > 0n,
      why: (d) => need(d.followOnRemaining > 0n, 'No follow-on is open.'),
      pre: (d, m, v) => 'Cost about ' + amt((v.a * d.issuePrice) / 10n ** 6n) + ' mUSDC at ' + usd(d.issuePrice),
      steps: async (c, v) => {
        const maxPrice = (c.d.issuePrice * 102n) / 100n
        return [await approval(c, c.usdc, c.f.fund, (v.a * maxPrice) / 10n ** 6n + 1n, 'mUSDC'), ['Subscribing to the follow-on', c.fund, 'subscribe', [v.a, maxPrice]]]
      } },
    { id: 'close', tab: 'rules', inline: true, title: 'Close the sale and open the market', btn: 'Close sale, open market', fields: [],
      show: (d) => !d.saleClosed,
      why: (d, m) => d.saleClosed ? 'The sale is already closed.' : d.sold < 19n * 10n ** 6n ? 'Nothing has been sold yet.' : (m && m.isGP) || d.sold === SALE_CAP ? '' : 'Only the GP can close before sell-out.',
      steps: async (c) => [['Closing the sale', c.fund, 'closeSale', []]] },
    { id: 'buyback', tab: 'rules', inline: true, title: 'Trigger the buyback-and-burn', btn: 'Trigger buyback', optional: true,
      fields: [F.usdc('a', 'empty = maximum')],
      show: (d) => d.saleClosed,
      why: (d) => !d.saleClosed ? 'Opens with the market.' : d.marketPrice >= d.buybackTriggerPrice ? 'The market is not more than 10% below NAV.' :
        Number(d.lastBuyback) + Math.floor(state.year / 52) > now() ? 'Cooldown: ' + dur(Number(d.lastBuyback) + Math.floor(state.year / 52) - now()) + '.' :
          d.maxBuyback === 0n ? 'The vault holds no cash.' : '',
      steps: async (c, v) => [['Triggering the buyback', c.fund, 'buyback', [v.a === null ? c.d.maxBuyback : v.a]]] },
    { id: 'fee', tab: 'rules', inline: true, title: 'Mint the yearly management fee', btn: 'Mint fee tranche', fields: [],
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
      pre: (d, m, v) => d.outstandingSupply === 0n ? '' : 'NAV per token after: about ' + usd(((d.vaultCash + d.polCash + v.val) * 10n ** 6n) / d.outstandingSupply) + ' (now ' + usd(d.navPerToken) + ')',
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
    { id: 'propose', tab: 'govern', title: 'Propose a new GP', lead: 'Any token holder can start a vote.', btn: 'Start the vote', fields: [F.address('to', 'Address of the new GP')],
      why: (d, m) => !d.saleClosed ? 'Possible after the sale closes.' : d.voteActive ? 'A vote is already running.' : m && m.token === 0n ? 'Token holders only.' : '',
      steps: async (c, v) => [['Proposing a new GP', c.fund, 'proposeRemoveGP', [v.to]]] },
    { id: 'vote', tab: 'govern', title: 'Vote yes', lead: 'Your tokens are locked in the fund until the vote ends, so no token votes twice.', btn: 'Lock tokens and vote yes',
      fields: [F.tok('a')], chips: [{ l: '50%', pct: 50, of: 'token' }, { l: 'Max', pct: 100, of: 'token' }],
      why: (d, m) => !d.voteActive ? 'No vote is running.' : m && m.isGP ? 'The GP cannot vote on his own removal.' : '',
      steps: async (c, v) => [await approval(c, c.token, c.f.fund, v.a, c.d.symbol), ['Voting yes', c.fund, 'vote', [v.a]]] },
    { id: 'execute', tab: 'govern', title: 'Execute the removal', lead: 'Anyone can execute once more than 50% of eligible supply has voted yes.', btn: 'Replace the GP', fields: [],
      why: (d) => !d.voteActive ? 'No vote is running.' : d.yesVotes * 10000n > d.eligibleSupply * 5000n ? '' : 'Threshold of more than 50% not reached.',
      steps: async (c) => [['Executing the GP removal', c.fund, 'executeRemoveGP', []]] },
    { id: 'withdraw', tab: 'govern', title: 'Withdraw locked votes', lead: 'Get your tokens back after the vote.', btn: 'Withdraw', ghost: true, fields: [],
      why: (d, m) => m && m.escrowed === 0n ? 'You have no tokens locked.' : d.voteActive ? 'The vote is still running.' : '',
      steps: async (c) => [['Withdrawing locked votes', c.fund, 'withdrawVotes', [c.d.proposalId]]] }
  ]

  async function approval(c, erc20, spender, amount, label) {
    const cur = await erc20.allowance(c.account, spender)
    if (cur >= amount) return null
    return ['One-time approval for ' + label, erc20, 'approve', [spender, E.MaxUint256]]
  }

  function actHtml(a) {
    const fields = a.fields.map((f) => '<label class="field' + (f.type === 'amount' ? '' : ' txt') + '"><input data-k="' + f.k + '" placeholder="' + esc(f.ph) + '"' +
      (f.type === 'amount' ? ' inputmode="decimal"' : '') + ' autocomplete="off" spellcheck="false">' +
      (f.unit ? '<span class="unit"' + (f.unit === 'token' ? ' data-unit="token">token' : '>' + f.unit) + '</span>' : '') + '</label>').join('')
    const chips = a.chips ? '<div class="chips">' + a.chips.map((c, i) => '<button type="button" class="chip" data-chip="' + i + '">' + c.l + '</button>').join('') + '</div>' : ''
    const cls = 'btn go' + (a.sell ? ' sellb' : '') + (a.ghost ? ' ghost' : '')
    if (a.inline) return '<div class="act" data-a="' + a.id + '">' + fields + '<button class="' + cls + ' sm">' + a.btn + '</button><p class="note why"></p></div>'
    return '<div class="card act" data-a="' + a.id + '"><h3>' + a.title + '</h3>' + (a.lead ? '<p class="lead">' + a.lead + '</p>' : '') + fields + chips +
      '<p class="note pre"></p><p class="note why"></p><button class="' + cls + '">' + a.btn + '</button></div>'
  }

  function buildActions(force) {
    const key = state.selected + '|' + (state.signer ? state.account : 'none')
    if (!force && key === state.actionsKey) return updateActions()
    state.actionsKey = key
    for (const tab of ['trade', 'gp', 'govern']) {
      let html = ''
      for (const a of ACTIONS.filter((x) => x.tab === tab)) {
        if (a.id === 'swapbuy') html += '<div class="seg" id="sideSeg"><button type="button" data-side="buy">Buy</button><button type="button" data-side="sell">Sell</button></div>'
        html += actHtml(a)
      }
      $('act-' + tab).innerHTML = html
    }
    $('rules').innerHTML = RULES.map((r) => '<div class="light" data-rule="' + r.k + '"><span class="lamp"></span><div class="grow"><div class="t">' + r.t + '</div><div class="d">' + r.p +
      '</div><div class="st"></div>' + (r.act ? actHtml(ACTIONS.find((a) => a.id === r.act)) : '') + '</div></div>').join('')
    updateActions()
  }

  const rowOf = (id) => document.querySelector('[data-a="' + id + '"]')
  function updateActions() {
    const d = state.detail, m = state.me
    const seg = $('sideSeg')
    if (seg) {
      seg.hidden = !d || !d.saleClosed
      seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.side === state.side)))
    }
    for (const a of ACTIONS) {
      const row = rowOf(a.id)
      if (!row) continue
      let why = '', soft = false
      if (!d) { why = 'Loading…'; soft = true }
      else if (!state.signer) { why = a.why(d, null); if (!why) { why = 'Connect a wallet on ' + CFG.network + ' to send this.'; soft = true } }
      else why = (a.gp && m && !m.isGP ? 'Only the GP of this sub-fund can do this.' : '') || a.why(d, m)
      row.hidden = !!d && ((a.show && !a.show(d)) || (a.side && a.side !== state.side))
      const note = row.querySelector('.why')
      note.textContent = why
      note.classList.toggle('soft', soft)
      row.querySelector('.go').disabled = !!why || state.busy || !state.signer
      row.querySelectorAll('[data-unit="token"]').forEach((u) => { if (d) u.textContent = d.symbol })
      const pre = row.querySelector('.pre')
      if (pre) {
        let text = ''
        if (d && a.pre) { try { const v = readFields(a, row); text = a.pre(d, m, v) || '' } catch (e) { text = '' } }
        pre.textContent = text
      }
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
    const f = state.funds[state.selected], s = state.signer
    const c = {
      account: state.account, f, d: state.detail,
      fund: new E.Contract(f.fund, ABI.fund, s), token: new E.Contract(f.token, ABI.erc20, s),
      pool: new E.Contract(f.pool, ABI.pool, s), vesting: new E.Contract(f.vesting, ABI.vesting, s),
      usdc: new E.Contract(CFG.usdc, ABI.erc20, s)
    }
    try {
      const steps = (await a.steps(c, v)).filter(Boolean)
      for (let i = 0; i < steps.length; i++) {
        const [label, contract, method, args] = steps[i]
        const fn = contract.getFunction(method)
        try { await fn.staticCall(...args) } catch (e) { throw new Error('Blocked by the contract: ' + reason(e)) }
        log((steps.length > 1 ? 'Step ' + (i + 1) + '/' + steps.length + ': ' : '') + label + ' – confirm in your wallet…')
        const tx = await fn(...args, feeOverrides())
        log('  sent, waiting for confirmation…')
        const rc = await tx.wait()
        log('  confirmed in block ' + rc.blockNumber + '.')
      }
      row.querySelectorAll('input').forEach((inp) => { inp.value = '' })
    } catch (e) {
      log(a.title + ': ' + (e.message && e.message.startsWith('Blocked') ? e.message : reason(e)), true)
    } finally {
      state.busy = false
      await refresh(true)
      updateActions()
    }
  }

  function render() {
    renderFunds(); renderHero(); renderKpis(); renderChart(); renderWallet(); buildActions(false); renderRules(); renderFeed(); renderFooter()
  }

  // ---------- wiring ----------
  $('funds').addEventListener('click', (e) => {
    const card = e.target.closest('[data-i]')
    if (!card) return
    const i = Number(card.dataset.i)
    if (i === state.selected) return
    state.selected = i; state.detail = null; state.me = null
    $('kpis').innerHTML = ''; $('feed').innerHTML = ''; $('chart').innerHTML = ''; $('hero').innerHTML = ''; $('strip').innerHTML = ''
    renderFunds(); buildActions(true)
    refresh(true)
  })
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]')
    if (!b || b.dataset.tab === state.tab) return
    state.tab = b.dataset.tab
    renderTabs()
    window.scrollTo(0, 0)
  })
  $('view').addEventListener('click', (e) => {
    const side = e.target.closest('[data-side]')
    if (side) { state.side = side.dataset.side; updateActions(); return }
    const row = e.target.closest('[data-a]')
    if (!row) return
    const a = ACTIONS.find((x) => x.id === row.dataset.a)
    if (!a) return
    const chip = e.target.closest('[data-chip]')
    if (chip) {
      const c = a.chips[Number(chip.dataset.chip)], m = state.me
      const input = row.querySelector('[data-k="a"]')
      if (c.v) input.value = c.v
      else if (m) input.value = E.formatUnits(((c.of === 'usdc' ? m.usdc : m.token) * BigInt(c.pct)) / 100n, D)
      updateActions()
      return
    }
    if (e.target.closest('.go')) runAction(a, row)
  })
  $('view').addEventListener('input', () => updateActions())
  $('walletChip').onclick = () => { if (!state.account) connect(); else if (!state.walletChainOk) switchChain() }
  $('chart').addEventListener('mousemove', chartHover)
  $('chart').addEventListener('mouseleave', chartLeave)
  if (window.ethereum && window.ethereum.on) {
    window.ethereum.on('accountsChanged', syncWallet)
    window.ethereum.on('chainChanged', syncWallet)
  }
  document.querySelector('.net').textContent = CFG.short || CFG.network
  renderTabs()
  setInterval(() => { if (state.detail) { renderRules(); updateActions(); setNet(state.netOk) } }, 1000)
  setInterval(() => refresh(false), CFG.pollMs)
  syncWallet()
})()
