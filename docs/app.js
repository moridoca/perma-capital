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
    funds: [], selected: 0, detail: null, me: null,
    year: 0, voting: 0,
    block: 0, chainTime: 0, fetchedAt: 0,
    scan: {}, live: {},
    account: null, signer: null, walletChainOk: false,
    busy: false, refreshing: false, pending: false, actionsKey: '', autoOpened: false
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
  const makeProvider = (i) => new E.JsonRpcProvider(CFG.rpcUrls[i], CFG.chainId, { staticNetwork: true, batchMaxCount: CFG.batch || 10 })
  async function read(fn) {
    let lastErr
    for (let k = 0; k < CFG.rpcUrls.length; k++) {
      try {
        if (!state.provider) state.provider = makeProvider(state.rpcIndex)
        return await fn(state.provider)
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
    if (state.refreshing) { state.pending = state.pending || force; return }
    state.refreshing = true
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
      if (idx !== state.selected) return // selection changed while loading
      state.funds = funds; state.detail = d; state.me = me
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
      setNet(false)
      if (!state.detail) {
        $('fatal').hidden = false
        $('fatal').textContent = 'Could not read from ' + CFG.network + ': ' + reason(e) + ' Retrying…'
      }
    } finally {
      state.refreshing = false
      if (state.pending) { state.pending = false; setTimeout(() => refresh(true), 0) }
    }
  }

  function setNet(ok) {
    $('netDot').className = 'dot ' + (ok ? 'ok' : 'bad')
    $('netText').textContent = ok ? CFG.network + ' · block ' + state.block.toLocaleString('en-US') : CFG.network + ' · connection problem, retrying'
  }

  // ---------- rendering ----------
  function premBadge(f) {
    if (f.price === 0n) return '<span class="badge">market not open</span>'
    const b = Number(f.premiumBps)
    return '<span class="badge ' + (b < 0 ? 'neg' : 'pos') + '">' + (b < 0 ? 'discount ' : 'premium ') + pct(Math.abs(b)) + '</span>'
  }

  function renderFunds() {
    $('funds').innerHTML = state.funds.map((f, i) =>
      '<button class="fund-card' + (i === state.selected ? ' sel' : '') + '" data-i="' + i + '">' +
      '<div class="nm">' + esc(f.name) + '</div>' +
      '<div class="row"><span>NAV per token</span><strong>' + usd(f.nav) + '</strong></div>' +
      '<div class="row"><span>Market price</span><strong>' + (f.price === 0n ? '–' : usd(f.price)) + '</strong></div>' +
      '<div class="row"><span>Net assets</span><strong>' + amt(f.netAssets) + ' mUSDC</strong></div>' +
      '<div class="row"><span></span>' + premBadge(f) + '</div></button>').join('')
  }

  function kpi(lbl, val, note, cls, hero) {
    return '<div class="kpi' + (hero ? ' hero' : '') + '"><div class="lbl">' + lbl + '</div><div class="val ' + (cls || '') + '">' + val +
      '</div><div class="note">' + (note || '&nbsp;') + '</div></div>'
  }

  function renderKpis() {
    const d = state.detail, f = state.funds[state.selected]
    $('fundTitle').textContent = f.name
    $('fundSub').innerHTML = 'Token ' + esc(d.symbol) + ' · fund ' + link(f.fund) + ' · GP ' + link(d.gp)
    const open = d.saleClosed
    const b = Number(d.premiumBps)
    const investedShare = d.netAssets > 0n ? Number((d.investedValue * 10000n) / d.netAssets) / 100 : 0
    $('kpis').innerHTML =
      kpi('NAV per token', usd(d.navPerToken), d.netAssets === 0n ? 'No assets yet: shows the $1.00 issue price' : 'Net assets / outstanding supply', '', true) +
      kpi('Market price', open ? usd(d.marketPrice) : '–', open ? 'Pool: ' + amt(d.reserveToken) + ' ' + esc(d.symbol) + ' / ' + amt(d.reserveUSDC) + ' mUSDC' : 'Market opens when the sale closes', '', true) +
      kpi(b < 0 ? 'Discount to NAV' : 'Premium to NAV', open ? pct(Math.abs(b)) : '–', open ? (b < 0 ? 'Market trades below NAV' : 'Market trades at or above NAV') : '', open ? (b < 0 ? 'neg' : 'pos') : '', true) +
      kpi('Net assets', amt(d.netAssets), 'mUSDC') +
      kpi('Vault cash', amt(d.vaultCash), 'mUSDC, read on-chain') +
      kpi('Invested value', amt(d.investedValue), '<span class="badge gold">GP-reported</span> ' + investedShare.toFixed(1) + '% of net assets') +
      kpi('Outstanding supply', amt(d.outstandingSupply), esc(d.symbol) + ', excl. fund-owned pool tokens')
  }

  function renderRules() {
    const d = state.detail, t = now(), s = esc(d.symbol)
    const rows = []
    const soldPct = Number((d.sold * 10000n) / SALE_CAP) / 100
    rows.push(['Primary sale', 'Fixed $1.00 per token, hard cap 9,500,000',
      (d.saleClosed ? '<span class="badge">closed</span> ' : '<span class="badge gold">open</span> ') + amt(d.sold) + ' sold (' + soldPct.toFixed(1) + '% of cap)' +
      '<div class="bar"><i style="width:' + Math.min(100, soldPct) + '%"></i></div>'])
    rows.push(['Fund-owned liquidity', '5% of supply plus the same cash; no function to withdraw it',
      d.saleClosed ? amt(d.polTokens) + ' ' + s + ' + ' + amt(d.polCash) + ' mUSDC in the pool' : 'Created when the sale closes'])
    let bb = 'Opens with the market'
    if (d.saleClosed) {
      const cool = Number(d.lastBuyback) + Math.floor(state.year / 52) - t
      const below = d.marketPrice < d.buybackTriggerPrice
      bb = (below ? '<span class="badge neg">triggered</span> ' : '<span class="badge">not triggered</span> ') +
        'market ' + usd(d.marketPrice) + ' vs trigger ' + usd(d.buybackTriggerPrice) +
        '<br>Max size now: ' + amt(d.maxBuyback) + ' mUSDC' + (below && cool > 0 ? ' · cooldown ' + dur(cool) : '')
    }
    rows.push(['Buyback-and-burn', 'Anyone can trigger it when the market is more than 10% below NAV; at most 1% of vault cash per execution', bb])
    rows.push(['Follow-on issuance', 'Price is the higher of NAV and market price',
      d.followOnRemaining > 0n ? '<span class="badge gold">open</span> ' + amt(d.followOnRemaining) + ' ' + s + ' at ' + usd(d.issuePrice) : 'None open · issue price would be ' + usd(d.issuePrice)])
    let fee = 'Starts when the sale closes'
    if (d.saleClosed) {
      const due = Number(d.lastFeeMint) + state.year - t
      fee = 'Tranches minted: ' + d.feeTranchesMinted + ' of 10 (' + amt(d.feePerYear) + ' ' + s + ' each)<br>' +
        (d.feeTranchesMinted >= 10n ? 'Lifetime cap reached' : due > 0 ? 'Next tranche due in ' + dur(due) : '<span class="badge gold">due now</span>') +
        '<br>Locked in vesting: ' + amt(d.unvested) + ' · claimable by GP: ' + amt(d.claimable)
    }
    rows.push(['Management fee', '2% of initial supply per year, paid in new tokens, each tranche locked for one year (demo year: ' + dur(state.year) + ')', fee])
    let gov = 'GP ' + link(d.gp) + ' · no vote running'
    if (d.voteActive) {
      const share = d.eligibleSupply > 0n ? Number((d.yesVotes * 10000n) / d.eligibleSupply) / 100 : 0
      gov = '<span class="badge gold">vote #' + d.proposalId + '</span> replace GP with ' + link(d.proposedGP) +
        '<br>Yes: ' + amt(d.yesVotes) + ' of ' + amt(d.eligibleSupply) + ' eligible (' + share.toFixed(1) + '%)' +
        '<div class="bar"><i style="width:' + Math.min(100, share) + '%"></i></div>Closes in ' + dur(Number(d.voteDeadline) - t)
    }
    rows.push(['GP removal', 'More than 50% of eligible supply; unvested fee tokens are burned (voting period: ' + dur(state.voting) + ')', gov])
    $('rules').innerHTML = '<tr><th>Rule</th><th>Parameter in the code</th><th>Status now</th></tr>' +
      rows.map((r) => '<tr><td><strong>' + r[0] + '</strong></td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>').join('')
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
    if (!sc) { $('feed').innerHTML = '<li class="when">Loading history…</li>'; return }
    const items = []
    for (let i = sc.events.length - 1; i >= 0 && items.length < 16; i--) {
      const ev = sc.events[i]
      const text = describe(ev, s)
      if (!text) continue
      const t = sc.ts[ev.block]
      items.push('<li>' + esc(text) + '<div class="when">' + (t !== undefined ? esc(clock(t, true)) + ' · ' : '') +
        '<a target="_blank" rel="noopener" href="' + esc(CFG.explorer) + '/tx/' + esc(ev.tx) + '">block ' + ev.block + '</a></div></li>')
    }
    $('feed').innerHTML = (sc.failed ? '<li class="when">Event history could not be fully loaded from the public endpoint.</li>' : '') +
      (items.length ? items.join('') : '<li class="when">No activity in this sub-fund yet.</li>')
  }

  // ---------- chart ----------
  const CH = { w: 800, h: 300, l: 58, r: 14, t: 12, b: 30 }
  let chartPts = []
  function renderChart() {
    const svg = $('chart')
    const d = state.detail
    const pts = chartPts = buildSeries(state.selected)
    if (!d.saleClosed || !pts.length) {
      svg.innerHTML = '<text x="400" y="150" text-anchor="middle" fill="#5E6B7D" font-size="15">' +
        (d.saleClosed ? 'Loading price history…' : 'The chart starts when the primary sale closes and the market opens.') + '</text>'
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
      g += '<line x1="' + CH.l + '" x2="' + (CH.w - CH.r) + '" y1="' + y + '" y2="' + y + '" stroke="#E4DCC8"/>' +
        '<text x="' + (CH.l - 8) + '" y="' + (y + 4) + '" text-anchor="end" fill="#5E6B7D" font-size="12">$' + v.toFixed(3) + '</text>'
    }
    const multiDay = tEnd - t0 > 86400
    for (let i = 0; i <= 3; i++) {
      const t = t0 + ((tEnd - t0) * i) / 3
      g += '<text x="' + X(t) + '" y="' + (CH.h - 8) + '" text-anchor="' + (i === 0 ? 'start' : i === 3 ? 'end' : 'middle') +
        '" fill="#5E6B7D" font-size="12">' + esc(clock(t, multiDay)) + '</text>'
    }
    let navPath = '', pricePath = '', bands = ''
    pts.forEach((p, i) => {
      const x = X(Math.max(p.t, t0)), xn = i + 1 < pts.length ? X(Math.max(pts[i + 1].t, t0)) : X(tEnd)
      navPath += (i ? ' V' + Y(p.nav) : 'M' + x + ',' + Y(p.nav)) + ' H' + xn
      pricePath += (i ? ' V' + Y(p.price) : 'M' + x + ',' + Y(p.price)) + ' H' + xn
      const y1 = Math.min(Y(p.nav), Y(p.price)), hgt = Math.abs(Y(p.nav) - Y(p.price))
      if (hgt > 0.5 && xn > x) bands += '<rect x="' + x + '" y="' + y1 + '" width="' + (xn - x) + '" height="' + hgt + '" fill="' + (p.price < p.nav ? '#A63A2B' : '#2E6E4A') + '" opacity="0.10"/>'
    })
    svg.innerHTML = g + bands +
      '<path d="' + pricePath + '" fill="none" stroke="#C9A227" stroke-width="5"/>' +
      '<path d="' + navPath + '" fill="none" stroke="#0B2545" stroke-width="2"/>' +
      '<line id="guide" y1="' + CH.t + '" y2="' + (CH.h - CH.b) + '" stroke="#5E6B7D" stroke-dasharray="3 3" visibility="hidden"/>'
    svg._scale = { t0, tEnd }
    readout(pts[pts.length - 1], true)
  }
  function readout(p, latest) {
    const gap = Math.trunc((p.price / p.nav - 1) * 10000) / 100 // truncated like premiumBps() in the contract
    $('chartRead').textContent = (latest ? 'Now' : clock(p.t, true)) + ': NAV $' + p.nav.toFixed(4) + ' · market $' + p.price.toFixed(4) +
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
    $('btnConnect').hidden = !eth || !!state.account
    renderWallet(); buildActions(true)
    refresh(true)
  }
  async function connect() {
    try { await window.ethereum.request({ method: 'eth_requestAccounts' }) } catch (e) { log('Wallet: ' + reason(e)) }
    syncWallet()
  }
  async function switchChain() {
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + CFG.chainId.toString(16) }] })
    } catch (e) { log('Wallet: ' + reason(e)) }
    syncWallet()
  }

  function renderWallet() {
    const box = $('walletBox'), m = state.me, d = state.detail
    if (!window.ethereum) {
      box.innerHTML = '<span>Read-only: this browser has no wallet. Open the page in a browser with MetaMask to send transactions.</span>'
    } else if (!state.account) {
      box.innerHTML = '<span>Connect a wallet to send transactions. You need a little Sepolia test ETH for gas.</span>'
    } else if (!state.walletChainOk) {
      box.innerHTML = '<span>Wallet ' + esc(short(state.account)) + ' is on another network.</span> <button id="btnSwitch" class="ghost">Switch to ' + esc(CFG.network) + '</button>'
      $('btnSwitch').onclick = switchChain
    } else {
      box.innerHTML = '<span>Wallet ' + link(state.account) + '</span>' +
        (m && d ? '<span><strong>' + amt(m.usdc) + '</strong> mUSDC</span><span><strong>' + amt(m.token) + '</strong> ' + esc(d.symbol) + '</span>' +
          (m.escrowed > 0n ? '<span>' + amt(m.escrowed) + ' locked in vote</span>' : '') +
          (m.isGP ? '<span class="badge gold">you are the GP</span>' : '') : '')
    }
  }

  // ---------- actions ----------
  const need = (d, cond, msg) => (cond ? '' : msg)
  const F = { amount: (k, ph) => ({ k, ph, type: 'amount' }), address: (k, ph) => ({ k, ph, type: 'address', wide: true }), text: (k, ph) => ({ k, ph, type: 'text', wide: true }) }
  const ACTIONS = [
    { id: 'mint', group: 'Investor', title: 'Get test mUSDC', fields: [F.amount('a', 'mUSDC, e.g. 1000000')],
      why: () => '',
      steps: async (c, v) => [['Minting test mUSDC', c.usdc, 'mint', [c.account, v.a]]] },
    { id: 'buy', group: 'Investor', title: 'Buy in the primary sale at $1.00', fields: [F.amount('a', 'tokens')],
      why: (d) => need(d, !d.saleClosed, 'The primary sale is closed.'),
      steps: async (c, v) => [await approval(c, c.usdc, c.f.fund, v.a, 'mUSDC'), ['Buying in the primary sale', c.fund, 'buy', [v.a]]] },
    { id: 'sell', group: 'Investor', title: 'Sell tokens in the pool', fields: [F.amount('a', 'tokens')],
      why: (d) => need(d, d.saleClosed, 'The market opens when the sale closes.'),
      steps: async (c, v) => {
        const out = await c.pool.quoteTokenForUSDC(v.a)
        return [await approval(c, c.token, c.f.pool, v.a, c.d.symbol), ['Selling in the pool', c.pool, 'swapTokenForUSDC', [v.a, (out * 99n) / 100n]]]
      } },
    { id: 'swapbuy', group: 'Investor', title: 'Buy tokens in the pool', fields: [F.amount('a', 'mUSDC to spend')],
      why: (d) => need(d, d.saleClosed, 'The market opens when the sale closes.'),
      steps: async (c, v) => {
        const out = await c.pool.quoteUSDCForToken(v.a)
        return [await approval(c, c.usdc, c.f.pool, v.a, 'mUSDC'), ['Buying in the pool', c.pool, 'swapUSDCForToken', [v.a, (out * 99n) / 100n]]]
      } },
    { id: 'subscribe', group: 'Investor', title: 'Subscribe to the follow-on', fields: [F.amount('a', 'tokens')],
      why: (d) => need(d, d.followOnRemaining > 0n, 'No follow-on is open.'),
      steps: async (c, v) => {
        const maxPrice = (c.d.issuePrice * 102n) / 100n
        return [await approval(c, c.usdc, c.f.fund, (v.a * maxPrice) / 10n ** 6n + 1n, 'mUSDC'), ['Subscribing to the follow-on', c.fund, 'subscribe', [v.a, maxPrice]]]
      } },
    { id: 'close', group: 'Anyone', title: 'Close the sale and open the market', fields: [],
      why: (d, m) => d.saleClosed ? 'The sale is already closed.' : d.sold < 19n * 10n ** 6n ? 'Nothing has been sold yet.' : (m && m.isGP) || d.sold === SALE_CAP ? '' : 'Only the GP can close before sell-out.',
      steps: async (c) => [['Closing the sale', c.fund, 'closeSale', []]] },
    { id: 'buyback', group: 'Anyone', title: 'Trigger the buyback-and-burn', fields: [F.amount('a', 'mUSDC, empty = maximum')], optional: true,
      why: (d) => !d.saleClosed ? 'Opens with the market.' : d.marketPrice >= d.buybackTriggerPrice ? 'The market is not more than 10% below NAV.' :
        Number(d.lastBuyback) + Math.floor(state.year / 52) > now() ? 'Cooldown: ' + dur(Number(d.lastBuyback) + Math.floor(state.year / 52) - now()) + '.' :
          d.maxBuyback === 0n ? 'The vault holds no cash.' : '',
      steps: async (c, v) => [['Triggering the buyback', c.fund, 'buyback', [v.a === null ? c.d.maxBuyback : v.a]]] },
    { id: 'fee', group: 'Anyone', title: 'Mint the yearly management fee', fields: [],
      why: (d) => !d.saleClosed ? 'Starts when the sale closes.' : d.feeTranchesMinted >= 10n ? 'Lifetime cap of 10 tranches reached.' :
        Number(d.lastFeeMint) + state.year > now() ? 'Not due yet: ' + dur(Number(d.lastFeeMint) + state.year - now()) + '.' : '',
      steps: async (c) => [['Minting the management fee', c.fund, 'mintManagementFee', []]] },
    { id: 'deploy', group: 'GP only', title: 'Deploy capital into an investment', gp: true,
      fields: [F.amount('a', 'mUSDC'), F.address('to', 'recipient address (the investment)'), F.text('memo', 'memo, e.g. Acquisition: PortCo A')],
      why: (d) => need(d, d.saleClosed, 'Possible after the sale closes.'),
      steps: async (c, v) => [['Deploying capital', c.fund, 'deployCapital', [v.to, v.a, v.memo]]] },
    { id: 'mark', group: 'GP only', title: 'Revalue the portfolio', gp: true,
      fields: [F.amount('val', 'new value in mUSDC'), F.text('memo', 'memo, e.g. Year-end valuation')],
      why: () => '',
      steps: async (c, v) => [['Revaluing the portfolio', c.fund, 'markInvestments', [v.val, v.memo]]] },
    { id: 'followon', group: 'GP only', title: 'Open a follow-on', gp: true, fields: [F.amount('a', 'tokens on offer')],
      why: (d) => need(d, d.saleClosed, 'Possible after the sale closes.'),
      steps: async (c, v) => [['Opening the follow-on', c.fund, 'openFollowOn', [v.a]]] },
    { id: 'proceeds', group: 'GP only', title: 'Return exit proceeds to the vault', gp: true,
      fields: [F.amount('a', 'mUSDC returned'), F.amount('rest', 'remaining portfolio value')],
      why: () => '',
      steps: async (c, v) => [await approval(c, c.usdc, c.f.fund, v.a, 'mUSDC'), ['Returning proceeds', c.fund, 'returnProceeds', [v.a, v.rest]]] },
    { id: 'claim', group: 'GP only', title: 'Claim vested fee tokens', gp: true, fields: [],
      why: (d) => need(d, d.claimable > 0n, 'Nothing has vested yet.'),
      steps: async (c) => [['Claiming vested fee tokens', c.vesting, 'claim', []]] },
    { id: 'propose', group: 'Governance', title: 'Propose a new GP', fields: [F.address('to', 'address of the new GP')],
      why: (d, m) => !d.saleClosed ? 'Possible after the sale closes.' : d.voteActive ? 'A vote is already running.' : m && m.token === 0n ? 'Token holders only.' : '',
      steps: async (c, v) => [['Proposing a new GP', c.fund, 'proposeRemoveGP', [v.to]]] },
    { id: 'vote', group: 'Governance', title: 'Vote yes (locks your tokens until the vote ends)', fields: [F.amount('a', 'tokens')],
      why: (d, m) => !d.voteActive ? 'No vote is running.' : m && m.isGP ? 'The GP cannot vote on his own removal.' : '',
      steps: async (c, v) => [await approval(c, c.token, c.f.fund, v.a, c.d.symbol), ['Voting yes', c.fund, 'vote', [v.a]]] },
    { id: 'execute', group: 'Governance', title: 'Execute the GP removal', fields: [],
      why: (d) => !d.voteActive ? 'No vote is running.' : d.yesVotes * 10000n > d.eligibleSupply * 5000n ? '' : 'Threshold of more than 50% not reached.',
      steps: async (c) => [['Executing the GP removal', c.fund, 'executeRemoveGP', []]] },
    { id: 'withdraw', group: 'Governance', title: 'Withdraw locked votes', fields: [],
      why: (d, m) => m && m.escrowed === 0n ? 'You have no tokens locked.' : d.voteActive ? 'The vote is still running.' : '',
      steps: async (c) => [['Withdrawing locked votes', c.fund, 'withdrawVotes', [c.d.proposalId]]] }
  ]

  async function approval(c, erc20, spender, amount, label) {
    const cur = await erc20.allowance(c.account, spender)
    if (cur >= amount) return null
    return ['One-time approval for ' + label, erc20, 'approve', [spender, E.MaxUint256]]
  }

  function buildActions(force) {
    const key = state.selected + '|' + (state.signer ? state.account : 'none')
    if (!force && key === state.actionsKey) return updateActions()
    state.actionsKey = key
    let html = '', group = ''
    for (const a of ACTIONS) {
      if (a.group !== group) {
        const open = a.group === 'Investor' || a.group === 'Anyone' || (a.group === 'GP only' && state.me && state.me.isGP) || (a.group === 'Governance' && state.detail && state.detail.voteActive)
        html += (group ? '</details>' : '') + '<details class="group" data-g="' + a.group + '"' + (open ? ' open' : '') + '><summary>' + a.group + '</summary>'
        group = a.group
      }
      html += '<div class="act" data-a="' + a.id + '"><div><div class="ttl">' + a.title + '</div><div class="why"></div>' +
        (a.fields.length ? '<div class="fields">' + a.fields.map((f) => '<input data-k="' + f.k + '" placeholder="' + esc(f.ph) + '"' +
          (f.wide ? ' class="wide"' : '') + (f.type === 'amount' ? ' inputmode="decimal"' : '') + ' autocomplete="off">').join('') + '</div>' : '') +
        '</div><button>Send</button></div>'
    }
    $('actions').innerHTML = html + '</details>'
    state.autoOpened = false
    updateActions()
  }

  function updateActions() {
    const d = state.detail, m = state.me
    if (m && m.isGP && !state.autoOpened) {
      state.autoOpened = true
      const g = $('actions').querySelector('[data-g="GP only"]')
      if (g) g.open = true
    }
    for (const a of ACTIONS) {
      const row = $('actions').querySelector('[data-a="' + a.id + '"]')
      if (!row) continue
      let why = ''
      if (!d) why = 'Loading…'
      else if (!state.signer) why = a.why(d, null) || 'Connect a wallet on ' + CFG.network + '.'
      else why = (a.gp && m && !m.isGP ? 'Only the GP of this sub-fund.' : '') || a.why(d, m)
      row.querySelector('.why').textContent = why
      row.querySelector('button').disabled = !!why || state.busy || !state.signer
    }
  }

  function readFields(a, row) {
    const v = {}
    for (const f of a.fields) {
      const raw = row.querySelector('[data-k="' + f.k + '"]').value.trim()
      if (f.type === 'amount') {
        if (!raw && a.optional) { v[f.k] = null; continue }
        const clean = raw.replace(/[,\s_]/g, '')
        if (!/^\d+(\.\d{1,6})?$/.test(clean)) throw new Error('Enter an amount for "' + f.ph + '" (digits, up to 6 decimals).')
        v[f.k] = E.parseUnits(clean, D)
        if (v[f.k] <= 0n && f.k === 'a') throw new Error('The amount must be greater than zero.')
      } else if (f.type === 'address') {
        if (!E.isAddress(raw)) throw new Error('"' + raw + '" is not a valid address.')
        v[f.k] = E.getAddress(raw)
      } else v[f.k] = raw
    }
    return v
  }

  function log(msg) {
    const box = $('txlog')
    box.hidden = false
    box.textContent += (box.textContent ? '\n' : '') + msg
    box.scrollTop = box.scrollHeight
  }

  async function runAction(a, row) {
    if (state.busy || !state.signer || !state.detail) return
    let v
    try { v = readFields(a, row) } catch (e) { log(a.title + ': ' + e.message); return }
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
      log(a.title + ': ' + (e.message && e.message.startsWith('Blocked') ? e.message : reason(e)))
    } finally {
      state.busy = false
      await refresh(true)
      updateActions()
    }
  }

  function renderFooter() {
    const f = state.funds[state.selected]
    $('footNet').textContent = CFG.network
    const rows = [['Umbrella', CFG.umbrella], ['mUSDC', CFG.usdc], ['Fund', f.fund], ['Token', f.token], ['Pool', f.pool], ['Vesting', f.vesting]]
    $('addrs').innerHTML = rows.map((r) => '<div>' + r[0] + ': <a class="mono" target="_blank" rel="noopener" href="' + esc(CFG.explorer) + '/address/' + esc(r[1]) + '">' + esc(r[1]) + '</a></div>').join('')
  }

  function render() {
    renderFunds(); renderKpis(); renderChart(); renderRules(); renderFeed(); renderWallet(); buildActions(false); renderFooter()
  }

  // ---------- wiring ----------
  $('funds').addEventListener('click', (e) => {
    const card = e.target.closest('[data-i]')
    if (!card) return
    const i = Number(card.dataset.i)
    if (i === state.selected) return
    state.selected = i; state.detail = null; state.me = null
    $('kpis').innerHTML = ''; $('rules').innerHTML = ''; $('feed').innerHTML = ''; $('chart').innerHTML = ''
    renderFunds(); buildActions(true)
    refresh(true)
  })
  $('actions').addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return
    const row = e.target.closest('[data-a]')
    const a = ACTIONS.find((x) => x.id === row.dataset.a)
    if (a) runAction(a, row)
  })
  $('btnConnect').onclick = connect
  $('chart').addEventListener('mousemove', chartHover)
  $('chart').addEventListener('mouseleave', chartLeave)
  if (window.ethereum && window.ethereum.on) {
    window.ethereum.on('accountsChanged', syncWallet)
    window.ethereum.on('chainChanged', syncWallet)
  }
  setInterval(() => { if (state.detail) { renderRules(); updateActions() } }, 1000)
  setInterval(() => refresh(false), CFG.pollMs)
  syncWallet()
})()
