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
      'function overview(uint256 index) view returns (string name, address fund, address token, address book, address vesting, uint256 navPerToken, uint256 marketPrice, int256 premiumBps, uint256 netAssets)',
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
      'function surplus() view returns (uint256)',
      'function buybackApproved() view returns (uint256)',
      'function dividendApproved() view returns (uint256)',
      'function dividendsUnclaimed() view returns (uint256)',
      'function issueKind() view returns (uint8)',
      'function freeCash() view returns (uint256)',
      'function dividendOf(address) view returns (uint256)',
      'function issuanceApproved() view returns (uint256)',
      'function issueProposalId() view returns (uint256)',
      'function issueProposed() view returns (uint256)',
      'function issueDeadline() view returns (uint256)',
      'function issueYes() view returns (uint256)',
      'function issuanceVoteActive() view returns (bool)',
      'function issueEscrow(uint256 id, address voter) view returns (uint256)',
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
      'function eligibleSupply() view returns (uint256)',
      'function voteActive() view returns (bool)',
      'function buy(uint256 tokenAmount)',
      'function closeSale()',
      'function deployCapital(address to, uint256 amount, string memo)',
      'function proposeMark(uint256 value, bytes32 reportHash, string memo)',
      'function disputeMark()',
      'function voteMark(bool accept, uint256 tokenAmount)',
      'function resolveMark()',
      'function withdrawMarkVotes(uint256 id)',
      'function markId() view returns (uint256)',
      'function marks(uint256 id) view returns (uint256 value, bytes32 reportHash, address proposer, uint256 bond, uint256 deadline, address disputer, uint256 accept, uint256 reject, uint8 state)',
      'function markEscrow(uint256 id, address voter) view returns (uint256)',
      'function markBond(uint256 value) view returns (uint256)',
      'function bondsHeld() view returns (uint256)',
      'function lastReportHash() view returns (bytes32)',
      'function returnProceeds(uint256 amount, uint256 newInvestedValue)',
      'function mintManagementFee()',
      'function topUpReserve() returns (uint256)',
      'function buyback(uint256 usdcAmount, uint256[] ids)',
      'function proposeSurplusUse(uint8 kind, uint256 usdcAmount)',
      'function payDividend(uint256 usdcAmount)',
      'function claimDividend(address who) returns (uint256)',
      'function sweepLadder() returns (uint256)',
      'function proposeIssuance(uint256 tokenAmount)',
      'function voteIssuance(uint256 tokenAmount)',
      'function executeIssuance()',
      'function withdrawIssuanceVotes(uint256 id)',
      'function proposeRemoveGP(address newGP)',
      'function vote(uint256 tokenAmount)',
      'function executeRemoveGP()',
      'function withdrawVotes(uint256 id)',
      'event Purchased(address indexed investor, uint256 tokens)',
      'event SaleClosed(uint256 sold, uint256 liquidityTokens, uint256 liquidityUSDC)',
      'event CapitalDeployed(address indexed to, uint256 amount, string memo)',
      'event ProceedsReturned(address indexed from, uint256 amount, uint256 newInvestedValue)',
      'event InvestmentsMarked(uint256 oldValue, uint256 newValue, string memo)',
      'event MarkProposed(uint256 indexed id, uint256 value, bytes32 reportHash, uint256 bond, uint256 deadline, string memo)',
      'event MarkDisputed(uint256 indexed id, address indexed disputer, uint256 voteDeadline)',
      'event MarkVoted(uint256 indexed id, address indexed voter, bool accept, uint256 tokens)',
      'event MarkResolved(uint256 indexed id, bool applied, address bondWinner, uint256 bondPaid)',
      'event NAVUpdated(uint256 navPerToken, uint256 marketPrice, uint256 timestamp)',
      'event ManagementFeeMinted(uint256 tranche, uint256 tokens)',
      'event DividendPaid(uint256 usdc, uint256 perTokenE18)',
      'event DividendClaimed(address indexed holder, uint256 usdc)',
      'event BuybackExecuted(address indexed caller, uint256 usdcSpent, uint256 tokensBurned, uint256 priceAfter)',
      'event ReserveToppedUp(uint256 usdc, uint256 target)',
      'event IssuanceProposed(uint256 indexed id, uint256 tokens, uint256 deadline)',
      'event IssuanceVoted(uint256 indexed id, address indexed voter, uint256 tokens)',
      'event IssuanceApproved(uint256 indexed id, uint256 tokens, uint256 approvedNow)',
      'event RemovalProposed(uint256 indexed id, address indexed proposer, address newGP, uint256 deadline)',
      'event Voted(uint256 indexed id, address indexed voter, uint256 tokens)',
      'event GPRemoved(uint256 indexed id, address oldGP, address newGP, uint256 burnedUnvested)'
    ],
    book: [
      'function TAKER_FEE_BPS() view returns (uint256)',
      'function ladder() view returns (uint256 nav, uint256[] bids, uint256[] asks, uint256[] tokens, uint256[] cash, uint256 at)',
      'function issuePrice() view returns (uint256)',
      'function openOrders() view returns (uint256[] ids, address[] makers, bool[] isBuy, uint256[] prices, uint256[] tokens)',
      'function quoteBuy(uint256 usdcIn, uint256[] ids) view returns (uint256 tokenOut, uint256 usdcSpent, uint256 priceAtEnd)',
      'function quoteSell(uint256 tokenIn, uint256[] ids) view returns (uint256 usdcOut, uint256 tokenSold, uint256 priceAtEnd)',
      'function buy(uint256 usdcIn, uint256 minTokenOut, uint256[] ids) returns (uint256 tokenOut, uint256 usdcSpent)',
      'function sell(uint256 tokenIn, uint256 minUSDCOut, uint256[] ids) returns (uint256 usdcOut, uint256 tokenSold)',
      'function limitBuy(uint256 tokenAmount, uint256 price, uint256[] ids) returns (uint256 id, uint256 filled)',
      'function limitSell(uint256 tokenAmount, uint256 price, uint256[] ids) returns (uint256 id, uint256 filled)',
      'function cancel(uint256 id)',
      'event Trade(address indexed trader, bool usdcForToken, uint256 amountIn, uint256 amountOut, uint256 priceAfter)',
      'event OrderPlaced(uint256 indexed id, address indexed maker, bool isBuy, uint256 price, uint256 tokens)',
      'event OrderFilled(uint256 indexed id, address indexed taker, uint256 tokens, uint256 usdc)',
      'event OrderCancelled(uint256 indexed id)',
      'event Issued(address indexed buyer, uint256 tokens, uint256 usdc)'
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
    'function buyInBook(uint256 fundIndex, uint256 usdcIn, uint256 minTokenOut, uint256[] ids) returns (uint256)',
    'function sellInBook(uint256 fundIndex, uint256 tokenIn, uint256 minUSDCOut, uint256[] ids) returns (uint256)',
    'function limitBuyInBook(uint256 fundIndex, uint256 tokenAmount, uint256 price, uint256[] ids) returns (uint256 id, uint256 filled)',
    'function limitSellInBook(uint256 fundIndex, uint256 tokenAmount, uint256 price, uint256[] ids) returns (uint256 id, uint256 filled)',
    'function cancelInBook(uint256 fundIndex, uint256 orderId)',
    'function buyPrimary(uint256 fundIndex, uint256 tokenAmount)',
    'function withdrawToOwner(address token, uint256 amount)'
  ]
  ABI.vault = [
    'function info() view returns (string name, string description, address leader, bool closed, uint256 totalShares, uint256 value, uint256 sharePrice, uint256 issuePrice, uint256 cash, uint256 leaderShares, uint256 lock)',
    'function positions() view returns (uint256[] index, uint256[] tokens, uint256[] prices)',
    'function openOrders() view returns (uint256[] fundIndex, uint256[] ids, bool[] isBuy, uint256[] prices, uint256[] tokens)',
    'function position(address who) view returns (uint256 shares, uint256 worth, uint256 paidIn, uint256 unlock)',
    'function deposit(uint256 usdcAmount, uint256 minShares) returns (uint256)',
    'function redeem(uint256 shareAmount, uint256 minUsdcOut, uint256[][] ids) returns (uint256)',
    'function setAgent(address agent, bool allowed)',
    'function agents(address) view returns (bool)',
    'function cashTotal() view returns (uint256)',
    'function tokensTotal(uint256 fundIndex) view returns (uint256)',
    'function buy(uint256 fundIndex, uint256 usdcIn, uint256 minTokenOut, uint256[] ids) returns (uint256, uint256)',
    'function sell(uint256 fundIndex, uint256 tokenIn, uint256 minUSDCOut, uint256[] ids) returns (uint256, uint256)',
    'function limitBuy(uint256 fundIndex, uint256 tokenAmount, uint256 price, uint256[] ids) returns (uint256 id, uint256 filled)',
    'function limitSell(uint256 fundIndex, uint256 tokenAmount, uint256 price, uint256[] ids) returns (uint256 id, uint256 filled)',
    'function cancel(uint256 fundIndex, uint256 id)',
    'function close()'
  ]
  ABI.vaults = [
    'function count() view returns (uint256)',
    'function vaults(uint256) view returns (address)',
    'function create(string name, string description, uint256 usdcAmount) returns (address)'
  ]
  ABI.accounts = [
    'function accountOf(address) view returns (address)',
    'function create(address key, uint64 expiry, uint128 volumeCap, uint16 maxPremiumBps, uint16 maxDiscountBps) payable returns (address)'
  ]
  const IFACE = { fund: new E.Interface(ABI.fund), book: new E.Interface(ABI.book), vesting: new E.Interface(ABI.vesting) }

  const state = {
    rpcIndex: 0, provider: null,
    funds: [], selected: 0, detail: null, me: null, sym: {}, vaults: [], vsel: 0,
    tab: 'trade', sub: 'overview', range: 'All', pane: 'book', ttab: 'balances', side: 'buy', otype: 'market', fsel: false, ff: 'all', fq: '',
    year: 0, voting: 0,
    block: 0, chainTime: 0, fetchedAt: 0,
    scan: {}, live: {}, fee: {},
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
      name: o[0], fund: o[1], token: o[2], book: o[3], vesting: o[4],
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

  // Vaults: pools of mUSDC that their leaders trade in the order books (contracts/perma/Vault.sol).
  async function loadVaults(p) {
    if (!CFG.vaults) return []
    const fac = new E.Contract(CFG.vaults, ABI.vaults, p)
    const n = Math.min(Number(await fac.count()), 40)
    const addrs = await Promise.all(Array.from({ length: n }, (_, i) => fac.vaults(i)))
    return Promise.all(addrs.map(async (a) => {
      const v = new E.Contract(a, ABI.vault, p)
      const [i, pos, ord, mine] = await Promise.all([v.info(), v.positions(), v.openOrders(), state.account ? v.position(state.account) : null])
      return {
        addr: a, name: i[0], desc: i[1], leader: i[2], closed: i[3], shares: i[4], value: i[5], price: i[6], issue: i[7], cash: i[8], leaderShares: i[9], lock: Number(i[10]),
        pos: [...pos[0]].map((x, k) => ({ fund: Number(x), tokens: pos[1][k], price: pos[2][k] })),
        orders: [...ord[0]].map((x, k) => ({ fund: Number(x), id: ord[1][k], isBuy: ord[2][k], price: ord[3][k], tokens: ord[4][k] })).filter((o) => o.tokens > 0n),
        me: mine ? { shares: mine[0], worth: mine[1], paid: mine[2], unlock: Number(mine[3]) } : null
      }
    }))
  }

  const FUND_KEYS = ['gp', 'saleClosed', 'sold', 'initialSupply', 'investedValue', 'feeTranchesMinted', 'lastFeeMint',
    'surplus', 'buybackApproved', 'dividendApproved', 'dividendsUnclaimed', 'issueKind', 'freeCash', 'issuanceApproved', 'issueProposalId', 'issueProposed', 'issueDeadline', 'issueYes', 'issuanceVoteActive', 'proposalId', 'proposedGP', 'voteDeadline', 'yesVotes', 'vaultCash', 'netAssets',
    'outstandingSupply', 'navPerToken', 'marketPrice', 'premiumBps', 'feePerYear',
    'eligibleSupply', 'voteActive', 'markId', 'bondsHeld', 'lastReportHash']

  // Contracts deployed before the order book answer none of its calls: say so instead of a bare read error.
  const oldDeployment = (e) => {
    if (e && (e.code === 'CALL_EXCEPTION' || e.code === 'BAD_DATA')) throw new Error('This deployment still runs the earlier pool contracts. Deploy the order-book contracts with scripts/perma and enter the new addresses in docs/config.js.')
    throw e
  }
  async function loadDetail(p, f) {
    const fund = new E.Contract(f.fund, ABI.fund, p)
    const token = new E.Contract(f.token, ABI.erc20, p)
    const book = new E.Contract(f.book, ABI.book, p)
    const vesting = new E.Contract(f.vesting, ABI.vesting, p)
    // ladder() returns its rung prices together with the sizes, so a preview never mixes two blocks.
    const res = await Promise.all([
      ...FUND_KEYS.map((k) => fund[k]()),
      fund.ownedLiquidity(), token.totalSupply(), token.symbol(),
      book.ladder().catch(oldDeployment), book.openOrders(), vesting.unvested(), vesting.claimable(), vesting.trancheCount(),
      state.fee[f.book] ? Promise.resolve(state.fee[f.book]) : book.TAKER_FEE_BPS(), book.issuePrice()
    ])
    const d = {}
    FUND_KEYS.forEach((k, i) => { d[k] = res[i] })
    const n = FUND_KEYS.length
    d.polTokens = res[n][0]; d.polCash = res[n][1]
    d.totalSupply = res[n + 1]; d.symbol = res[n + 2]
    const l = res[n + 3], o = res[n + 4]
    d.lad = { prices: [...l[1]], asks: [...l[2]], tokens: [...l[3]], cash: [...l[4]], edge: Number(l[5]), issue: res[n + 9], issuable: d.issuanceApproved }
    d.orders = [...o[0]].map((id, k) => ({ id, maker: o[1][k], isBuy: o[2][k], price: o[3][k], tokens: o[4][k] }))
    d.unvested = res[n + 5]; d.claimable = res[n + 6]; d.tranches = res[n + 7]
    BOOK_FEE_BPS = state.fee[f.book] = res[n + 8]
    const mk = d.markId > 0n ? await fund.marks(d.markId) : null
    d.mark = mk ? { id: d.markId, value: mk[0], hash: mk[1], proposer: mk[2], bond: mk[3], deadline: Number(mk[4]), disputer: mk[5], accept: mk[6], reject: mk[7], state: Number(mk[8]) } : null
    d.markOpen = !!d.mark && (d.mark.state === 1 || d.mark.state === 2)
    return d
  }

  async function loadMe(p, funds, d, idx) {
    if (!state.account) return null
    const me = state.account
    const res = await Promise.all([new E.Contract(CFG.usdc, ABI.erc20, p).balanceOf(me),
      ...funds.flatMap((f) => [new E.Contract(f.token, ABI.erc20, p).balanceOf(me), new E.Contract(f.fund, ABI.fund, p).escrowed(f.proposalId, me)])])
    const by = funds.map((f, i) => ({ token: res[1 + i * 2], escrowed: res[2 + i * 2], isGP: f.gp.toLowerCase() === me.toLowerCase() }))
    const fc = new E.Contract(funds[idx].fund, ABI.fund, p)
    const [issueLocked, dividend, markLocked] = await Promise.all([d.issueProposalId > 0n ? fc.issueEscrow(d.issueProposalId, me) : 0n, fc.dividendOf(me),
      d.markId > 0n ? fc.markEscrow(d.markId, me) : 0n])
    return { dividend, markLocked, usdc: res[0], token: by[idx].token, escrowed: by[idx].escrowed, issueLocked, isGP: d.gp.toLowerCase() === me.toLowerCase(), by }
  }

  // Event history of one sub-fund, read in block chunks and kept in memory.
  async function scanLogs(p, idx, f, toBlock) {
    const sc = state.scan[idx] || (state.scan[idx] = { next: CFG.deployBlock, events: [], ts: {}, failed: false })
    const byAddr = {}
    byAddr[f.fund.toLowerCase()] = IFACE.fund
    byAddr[f.book.toLowerCase()] = IFACE.book
    byAddr[f.vesting.toLowerCase()] = IFACE.vesting
    let guard = 0
    while (sc.next <= toBlock && guard++ < 60) {
      const end = Math.min(sc.next + CFG.logChunk - 1, toBlock)
      const logs = await p.getLogs({ address: [f.fund, f.book, f.vesting], fromBlock: sc.next, toBlock: end })
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
        } else if (ev.name === 'Trade' && lastNav !== null) {
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
      let vaults = state.vaults
      try { vaults = await read(loadVaults) } catch (e) { console.warn('PERMA: vaults not read:', e) }
      try { await read((p) => scanLogs(p, idx, f, bn)); state.scan[idx].failed = false } catch (e) {
        if (state.scan[idx]) state.scan[idx].failed = true
      }
      if (idx !== state.selected || gen !== state.gen) return // selection changed or a newer refresh took over
      state.funds = funds; state.detail = d; state.me = me; state.shown = idx
      state.vaults = vaults; if (state.vsel >= vaults.length) state.vsel = 0
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
      if (e.name !== 'Trade' || sc.ts[e.block] === undefined) continue
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
  const TABS = [['trade', 'Trade'], ['funds', 'Funds'], ['vaults', 'Vaults'], ['reports', 'Reports'], ['portfolio', 'Portfolio'], ['govern', 'Govern']]
  const ICON = {
    trade: '<path d="M4 19V9M9 19V5M14 19v-7M19 19V8"/>',
    funds: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><rect x="3" y="11" width="18" height="5" rx="1.5"/><path d="M5 20h14"/>',
    vaults: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M12 9v-1.5M12 16.5V15M9 12H7.5M16.5 12H15"/>',
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
    $('view').classList.toggle('wide', state.tab === 'trade' || state.tab === 'reports' || state.tab === 'portfolio' || state.tab === 'vaults')
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
      '</div></div><div id="f-list" class="flist">' + fundList() + '</div><div class="fpfoot"><span><kbd>Esc</kbd> close</span><span class="grow"></span><span>Each fund is a separate contract with its own token, vault and order book.</span></div></div>'
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
  const RANGES = { '5m': 300, '15m': 900, '1H': 3600, '6H': 21600, '1D': 86400, 'All': Infinity }
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
      const sp = Number((d.sold * 10000n) / SALE_CAP) / 100, pol = d.sold / 20n
      PUT('tohlc').h = ''
      PUT('chartBox').h = '<div class="salebox"><div class="salebig">' + amt(d.sold) + '<small> of 9,500,000 ' + esc(d.symbol) + ' sold · ' + sp.toFixed(1) + '%</small></div>' +
        '<div class="meter"><i class="infoc" style="width:' + Math.min(100, sp) + '%"></i></div><ol class="salesteps">' +
        '<li><b>Primary sale.</b> Investors buy new tokens from the fund at a fixed $1.00. The money goes into the vault.</li>' +
        '<li><b>Close.</b> The GP closes the sale, or it sells out. 5% of the sale cash becomes fund-owned liquidity' +
        (d.sold > 0n ? ': at today\'s level ' + amt(pol) + ' mUSDC of bids below NAV.' : '.') + '</li>' +
        '<li><b>Market.</b> The order book opens around $1.00: the fund bids in 0.2% steps from NAV down to NAV −50% and, in the amount holders approve, issues new tokens just above it; holders add limit orders. Candles from on-chain trades and the NAV line appear here.</li></ol></div>'
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
    PUT('tpane').h = [['book', 'Order book'], ['trades', 'Trades']].map((p) => '<button aria-pressed="' + (state.pane === p[0]) + '" data-pane="' + p[0] + '">' + p[1] + '</button>').join('')
    const body = PUT('tbookBody')
    if (state.pane === 'trades') {
      const t = swapsOf(state.selected).slice(-28).reverse()
      body.h = t.length ? '<div class="bh"><span>Price</span><span>Size (' + esc(d.symbol) + ')</span><span>Time</span></div>' + t.map((x) => '<div class="tr ' + (x.buy ? 'bid' : 'ask') + '"><span class="p">' + x.px.toFixed(4) +
        '</span><span>' + cmp(x.tok) + (me && x.who.toLowerCase() === me.toLowerCase() ? ' <em>you</em>' : '') + '</span><span>' + esc(clock(x.t)) + '</span></div>').join('')
        : '<div class="bempty">No trades yet</div>'
      return
    }
    if (!d.saleClosed || !d.lad) { body.h = '<div class="bempty">The order book opens when the sale closes</div>'; return }
    const nav = num(d.navPerToken), mine = myAddr()
    // One row per price: the fund's rung and holders' orders at that price together.
    const levels = (bid) => {
      const by = new Map()
      const add = (price, q, own) => { const k = price.toString(), r = by.get(k) || { price, q: 0n, fund: false, own: false }; r.q += q; if (own === null) r.fund = true; else if (own) r.own = true; by.set(k, r) }
      d.lad.prices.forEach((bp, i) => { const price = bid ? bp : d.lad.asks[i], q = bid ? bidSize(d.lad.cash[i], bp) : d.lad.tokens[i]; if (q > 0n && price > 0n) add(price, q, null) })
      for (const o of d.orders) if (o.isBuy === bid && o.tokens > 0n && (bid || o.price <= d.lad.issue)) add(o.price, o.tokens, o.maker.toLowerCase() === mine)
      const rows = [...by.values()].sort((x, y) => (x.price === y.price ? 0 : (x.price < y.price) === bid ? 1 : -1)).slice(0, 8)
      let cum = 0
      return rows.map((r) => { cum += num(r.q) * num(r.price); return { px: num(r.price), q: num(r.q), cum, fund: r.fund, own: r.own } })
    }
    const asks = levels(false), bids = levels(true)
    // above every offer: the fund issues new tokens, without a size limit
    const issueRow = d.lad.issuable > 0n ? '<div class="br ask"><span class="p">' + num(d.lad.issue).toFixed(4) + ' <em>issue</em></span><span>' + cmp(num(d.lad.issuable)) + '</span><span>approved</span></div>' : ''
    const mx = Math.max(asks.length ? asks[asks.length - 1].cum : 0, bids.length ? bids[bids.length - 1].cum : 0, 1)
    const row = (r, side) => '<div class="br ' + side + '"><i style="width:' + ((r.cum / mx) * 100).toFixed(1) + '%"></i><span class="p">' + r.px.toFixed(4) + (r.fund ? '' : ' <em>' + (r.own ? 'you' : 'holder') + '</em>') +
      (r.fund && r.own ? ' <em>+you</em>' : '') + '</span><span>' + cmp(r.q) + '</span><span>' + cmp(r.cum) + '</span></div>'
    let bidHtml = ''
    for (const r of bids) bidHtml += row(r, 'bid')
    const P0 = num(d.marketPrice)
    body.h = '<div class="bh"><span>Price</span><span>Size (' + esc(d.symbol) + ')</span><span>Total (mUSDC)</span></div><div class="basks">' +
      (issueRow || asks.length ? issueRow + asks.slice().reverse().map((r) => row(r, 'ask')).join('') : '<div class="bempty">No offers: holders have approved no new tokens</div>') + '</div>' +
      '<div class="bspread"><span>Market</span><span>' + P0.toFixed(4) + '</span><span>' +
      '</span><span class="bnav">NAV ' + nav.toFixed(4) + '</span></div>' +
      '<div class="bbids">' + (bidHtml || '<div class="bempty">No bids: the ladder\'s cash is used up</div>') + '</div><p class="bfoot">Unmarked rows are the fund\'s own ladder: its cash in 0.2% steps from NAV down to NAV −50%, moving with NAV and not withdrawable. What a rung bought it offers again 0.1% higher. ' +
      'Above NAV the fund issues new tokens at NAV +0.2%, as many as holders approved by vote; the money goes into the vault. Marked rows are holders\' limit orders. Taking costs ' + feeText() + ', resting orders pay nothing.</p>'
  }

  function renderBottom() {
    const d = state.detail, m = state.me, f = cur()
    const mineOpen = d.orders && state.account ? d.orders.filter((o) => o.maker.toLowerCase() === myAddr()) : []
    const tabs = [['balances', 'Balances'], ['orders', 'Open orders' + (mineOpen.length ? ' (' + mineOpen.length + ')' : '')], ['mine', 'Trade history'], ['treasury', 'Treasury'], ['markets', 'Markets']]
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
    } else if (state.ttab === 'orders') {
      h = mineOpen.length ? '<table class="tt"><thead><tr><th class="l">Order</th><th class="l">Side</th><th>Limit price</th><th>Vs NAV</th><th>Open size (' + esc(d.symbol) + ')</th><th>mUSDC</th><th></th></tr></thead><tbody>' +
        mineOpen.slice().sort((x, y) => (x.id < y.id ? 1 : -1)).map((o) => '<tr data-a="cancel"><td class="l">#' + o.id + '</td><td class="l ' + (o.isBuy ? 'up' : 'dn') + '">' + (o.isBuy ? 'Buy' : 'Sell') + '</td><td>' + num(o.price).toFixed(4) +
          '</td><td>' + esc(vsNav(o.price, d.navPerToken)) + '</td><td>' + amt(o.tokens) + '</td><td>' + amt((o.tokens * o.price) / U6) + '</td><td><input type="hidden" data-k="id" value="' + o.id + '"><button class="tlink go">Cancel</button></td></tr>').join('') +
        '</tbody></table><p class="note">Resting orders pay no fee. Cancelling returns the tokens or mUSDC held for the order.</p>'
        : '<p class="note">' + (state.account ? 'No open orders in ' + esc(d.symbol) + '. Choose Limit in the order form to place one.' : 'Connect a wallet to see its orders.') + '</p>'
    } else if (state.ttab === 'mine') {
      const me = state.account, t = me ? swapsOf(state.selected).filter((x) => x.who.toLowerCase() === me.toLowerCase()).reverse() : []
      h = t.length ? '<table class="tt"><thead><tr><th class="l">Time</th><th class="l">Side</th><th>Price</th><th>Size (' + esc(d.symbol) + ')</th><th>mUSDC</th><th>Market after</th><th></th></tr></thead><tbody>' +
        t.map((x) => '<tr><td class="l">' + esc(clock(x.t, true)) + '</td><td class="l ' + (x.buy ? 'up' : 'dn') + '">' + (x.buy ? 'Buy' : 'Sell') + '</td><td>' + x.px.toFixed(4) + '</td><td>' + cmp(x.tok) + '</td><td>' + cmp(x.usdc) +
          '</td><td>' + x.after.toFixed(4) + '</td><td><a target="_blank" rel="noopener" href="' + esc(CFG.explorer) + '/tx/' + esc(x.tx) + '">tx</a></td></tr>').join('') + '</tbody></table>'
        : '<p class="note">' + (me ? 'This wallet has not taken liquidity in ' + esc(d.symbol) + ' yet. Fills of its resting orders are not listed here.' : 'Connect a wallet to see its trades.') + '</p>'
    } else if (state.ttab === 'treasury') {
      const r = (k, v) => '<tr><td class="l">' + k + '</td><td class="l">' + v + '</td></tr>'
      h = '<table class="tt kv"><tbody>' + r('Vault cash', amt(d.vaultCash) + ' mUSDC') + r('Fund-owned liquidity', amt(d.polTokens) + ' ' + esc(d.symbol) + ' + ' + amt(d.polCash) + ' mUSDC, cannot be withdrawn') +
        r('Invested value', amt(d.investedValue) + ' mUSDC <span class="pill warn">GP-proposed, disputable</span>') + r('Surplus pot', amt(d.surplus) + ' mUSDC from fees and ladder profit, inside vault cash; pays for buybacks and dividends only') +
        r('Approved for buybacks / dividends', amt(d.buybackApproved) + ' / ' + amt(d.dividendApproved) + ' mUSDC') + r('Dividends not collected yet', amt(d.dividendsUnclaimed) + ' mUSDC, no longer part of NAV') + r('Approved issuance', d.issuanceApproved > 0n ? amt(d.issuanceApproved) + ' ' + esc(d.symbol) + ' on offer in the book at ' + usd(d.lad.issue) : d.issuanceVoteActive ? 'vote running on ' + esc(voteWhat(d)) : 'none: holders have approved no new tokens') +
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
    PUT('ipoStatus').h = '<p class="lead">New tokens from the fund at a fixed $1.00. No capital calls later. When the sale closes, 5% of the sale cash becomes fund-owned liquidity: bids below NAV in the order book. The market opens at $1.00; new tokens need a holder vote.</p>' +
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
      cell('Invested value', amt(d.investedValue), '<span class="pill warn">GP-proposed, disputable</span> ' + share.toFixed(1) + '% of net assets') +
      cell('Outstanding supply', amt(d.outstandingSupply), s + ', excl. the fund\'s tokens on the ladder') +
      cell('Fund liquidity in the book', open ? amt(d.polTokens) + ' / ' + amt(d.polCash) : '–', open ? s + ' / mUSDC on the ladder' : 'placed when the sale closes') +
      cell('Fund-owned liquidity', open ? amt(d.polTokens) + ' / ' + amt(d.polCash) : '–', open ? s + ' / mUSDC, cannot be withdrawn' : 'created when the sale closes')
  }
  const gapText = (bps) => (bps < 0 ? 'discount ' : 'premium ') + pct(Math.abs(bps))

  // One entry per rule: [state of the lamp, status html]. 'off' = needs attention or can be acted on now.
  const markBond = (v) => { const b = (v * 100n) / 10000n; return b < 10n * U6 ? 10n * U6 : b }
  const markText = (d) => !d.mark ? '' : 'Proposed ' + amt(d.mark.value) + ' mUSDC (now ' + amt(d.investedValue) + ') · bond ' + amt(d.mark.bond) +
    (d.mark.state === 2 ? ' · for ' + amt(d.mark.accept) + ' / against ' + amt(d.mark.reject) : '') + ' · ' + (d.mark.deadline > now() ? dur(d.mark.deadline - now()) + ' left' : 'window over')
  const voteWhat = (d) => amt(d.issueProposed) + (Number(d.issueKind) === 1 ? ' mUSDC from the surplus for a buyback' : Number(d.issueKind) === 2 ? ' mUSDC from the surplus as a dividend' : ' new ' + d.symbol)
  const RULES = [
    { k: 'sale', t: 'Primary sale', p: 'Fixed $1.00 per token, hard cap of 9,500,000 tokens.', act: 'close' },
    { k: 'pol', t: 'Fund-owned liquidity', p: '5% of the sale cash goes into the order book as bids in 0.2% steps from NAV down to NAV −50% (40% of it down to −10%, 30% to −20%, 20% to −40%, 10% below); a rung resells what it bought 0.1% higher. The fund cannot withdraw it. Anyone can top it up to 5% of net assets from the vault.', act: 'topup' },
    { k: 'buyback', t: 'Surplus pot: buyback and dividend', p: 'Trading fees and what the ladder earns collect in a pot apart from the money the GP invests. It pays for buybacks (only below NAV, tokens are burned) and dividends (mUSDC per token in a wallet). Both need a proposal by the GP and a yes from more than 50% of eligible supply.', act: 'sweep' },
    { k: 'followon', t: 'New issuance', p: 'New tokens only in the amount holders approved by vote, only through the open order book, only at NAV +0.2%. No placement with chosen buyers, and new money never dilutes holders.' },
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
    if (k === 'pol') {
      if (!d.saleClosed) return ['idle', 'Created when the sale closes']
      const gap = reserveGap(d), have = d.polCash + (d.polTokens * d.navPerToken) / U6
      return [gap > 0n ? 'off' : 'ok', '<span class="num">' + amt(d.polCash) + '</span> mUSDC + <span class="num">' + amt(d.polTokens) + '</span> ' + s + ' on the ladder = ' +
        (d.netAssets > 0n ? (Number((have * 10000n) / d.netAssets) / 100).toFixed(2) : '0') + '% of net assets' + (gap > 0n ? ' · <span class="num">' + amt(gap) + '</span> mUSDC short of 5%' : '')]
    }
    if (k === 'buyback') {
      if (!d.saleClosed) return ['idle', 'Opens with the market']
      return ['ok', '<span class="num">' + amt(d.surplus) + '</span> mUSDC in the pot · approved: <span class="num">' + amt(d.buybackApproved) + '</span> for buybacks, <span class="num">' + amt(d.dividendApproved) + '</span> for dividends' +
        (d.dividendsUnclaimed > 0n ? '<br><span class="num">' + amt(d.dividendsUnclaimed) + '</span> mUSDC of dividends not collected yet' : '')]
    }
    if (k === 'followon') {
      if (!d.saleClosed) return ['idle', 'Possible after the sale closes']
      const price = ' at <span class="num">' + usd(d.lad.issue) + '</span>'
      if (d.issuanceVoteActive) return ['off', '<span class="pill live">vote running</span> on ' + esc(voteWhat(d)) + ': ' + (Number((d.issueYes * 10000n) / (d.eligibleSupply || 1n)) / 100).toFixed(1) + '% of eligible supply says yes, ' + dur(Math.max(0, Number(d.issueDeadline) - t)) + ' left']
      return d.issuanceApproved > 0n ? ['ok', '<span class="pill live">approved</span> <span class="num">' + amt(d.issuanceApproved) + '</span> ' + s + ' on offer in the order book' + price]
        : ['ok', 'Nothing approved: no new tokens can be issued · the price would be' + price]
    }
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
    return d.investedValue > 0n ? ['off', '<span class="pill warn">GP-proposed, disputable</span> <span class="num">' + amt(d.investedValue) + '</span> mUSDC = ' + share.toFixed(1) + '% of net assets']
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
      case 'InvestmentsMarked': return 'Portfolio value ' + amt(a[0]) + ' → ' + amt(a[1]) + ' applied'
      case 'MarkProposed': return 'GP proposed a portfolio value of ' + amt(a[1]) + ' mUSDC with a bond of ' + amt(a[3]) + ': “' + a[5] + '”'
      case 'MarkDisputed': return 'A holder disputed valuation #' + a[0]
      case 'MarkResolved': return 'Valuation #' + a[0] + (a[1] ? ' applied' : ' rejected') + '; ' + amt(a[3]) + ' mUSDC of bonds paid out'
      case 'ManagementFeeMinted': return 'Management fee tranche ' + a[0] + ': ' + amt(a[1]) + ' ' + s + ' minted into vesting'
      case 'DividendPaid': return 'Dividend paid: ' + amt(a[0]) + ' mUSDC to the tokens in wallets'
      case 'DividendClaimed': return 'Dividend collected by ' + short(a[0]) + ': ' + amt(a[1]) + ' mUSDC'
      case 'BuybackExecuted': return 'Buyback by ' + short(a[0]) + ': ' + amt(a[1]) + ' mUSDC spent, ' + amt(a[2]) + ' ' + s + ' burned, price now ' + usd(a[3])
      case 'ReserveToppedUp': return 'Reserve topped up: ' + amt(a[0]) + ' mUSDC moved from the vault onto the ladder (target ' + amt(a[1]) + ')'
      case 'IssuanceProposed': return 'Vote #' + a[0] + ' on new tokens: GP asks holders to approve ' + amt(a[1]) + ' ' + s
      case 'IssuanceVoted': return short(a[1]) + ' locked ' + amt(a[2]) + ' ' + s + ' as yes votes for the issuance'
      case 'IssuanceApproved': return 'Holders approved ' + amt(a[1]) + ' new ' + s + '; ' + amt(a[2]) + ' can now be issued in the order book'
      case 'Issued': return 'Issued ' + amt(a[1]) + ' new ' + s + ' to ' + short(a[0]) + ' in the order book for ' + amt(a[2]) + ' mUSDC'
      case 'RemovalProposed': return 'Vote #' + a[0] + ': ' + short(a[1]) + ' proposed ' + short(a[2]) + ' as new GP'
      case 'Voted': return short(a[1]) + ' locked ' + amt(a[2]) + ' ' + s + ' as yes votes'
      case 'GPRemoved': return 'GP replaced: ' + short(a[1]) + ' → ' + short(a[2]) + '; ' + amt(a[3]) + ' unvested fee tokens burned'
      case 'Trade': return a[1]
        ? 'Market: ' + short(a[0]) + ' bought ' + amt(a[3]) + ' ' + s + ' for ' + amt(a[2]) + ' mUSDC, price now ' + usd(a[4])
        : 'Market: ' + short(a[0]) + ' sold ' + amt(a[2]) + ' ' + s + ' for ' + amt(a[3]) + ' mUSDC, price now ' + usd(a[4])
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
    const followOn = ev.reduce((a, e) => (e.name === 'Issued' ? a + e.args[2] : a), 0n)
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
      tile('Invested value', amt(d.investedValue), '<span class="pill warn">GP-proposed, disputable</span>') +
      tile('Vault cash', amt(d.vaultCash), 'mUSDC, on-chain') + tile('Value created', sg(gain), 'reported value + proceeds − cost') +
      tile('Buybacks', amt(bbSpent), amt(bbBurned) + ' ' + s + ' burned') + tile('Fee tokens minted', amt(feeTok), d.feeTranchesMinted + ' of 10 tranches') + '</div>'

    const fr = (k, v, cls, note) => '<tr class="' + (cls || '') + '"><td>' + k + (note ? ' <small>' + note + '</small>' : '') + '</td><td class="num">' + v + '</td></tr>'
    h += '<div class="rgrid"><div class="rsec"><div class="sechead"><h2>Statement of net assets</h2><small>mUSDC</small></div><div class="rtab"><table class="fin"><tbody>' +
      '<tr class="hd"><td colspan="2">Assets</td></tr>' +
      fr('Vault cash', amt(d.vaultCash), '', 'read on-chain') +
      fr('Cash on the fund\'s ladder in the order book', amt(d.polCash), '', 'read on-chain') +
      fr('Investments', amt(d.investedValue), '', 'reported by the GP') +
      fr('Net assets', amt(d.netAssets), 't') +
      '<tr class="hd"><td colspan="2">Tokens (' + s + ')</td></tr>' +
      fr('Total supply', amt(d.totalSupply)) + fr('Less: the fund\'s tokens on the ladder', neg(d.polTokens), '', 'treasury stock') +
      fr('Outstanding supply', amt(d.outstandingSupply), 's') + fr('NAV per token', usd(d.navPerToken), 't') + '</tbody></table></div></div>'

    h += '<div class="rsec"><div class="sechead"><h2>Capital account since launch</h2><small>from events, mUSDC</small></div><div class="rtab"><table class="fin"><tbody>' +
      '<tr class="hd"><td colspan="2">Money in</td></tr>' +
      fr('Primary sale at $1.00', amt(primary)) + fr('New tokens issued in the order book', amt(followOn)) + fr('Exit proceeds returned', amt(returned)) +
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
    const rows = [['Umbrella', CFG.umbrella], ['mUSDC', CFG.usdc], ['Fund', f.fund], ['Token', f.token], ['Order book', f.book], ['Vesting', f.vesting]]
    h += '<div class="rsec"><div class="sechead"><h2>Contracts</h2><small>' + esc(CFG.network) + '</small></div><div class="card"><dl class="kv" id="addrs">' +
      rows.map((r) => '<dt>' + r[0] + '</dt><dd><a target="_blank" rel="noopener" href="' + esc(CFG.explorer) + '/address/' + esc(r[1]) + '">' + esc(r[1]) + '</a></dd>').join('') + '</dl></div></div>'
    PUT('reports').h = h
  }

  // ---------- Portfolio ----------
  function renderPortfolio() {
    const m = state.me
    let h = '<section class="pfhead"><div><h1>Portfolio</h1><p class="lead">' + (state.account ? (tkOn() ? 'Trading account ' : 'Wallet ') + link(state.account) + ' · values at the market price' : 'No wallet connected') + '</p></div></section>'
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
      h += '<section class="pfgrid"><div class="pfcol tp">' + stat('Account value', '$' + cmp(total), 'cash plus tokens at the market price') +
        stat('Tokens at market', '$' + cmp(vm), held + (held === 1 ? ' fund' : ' funds')) + stat('Tokens at NAV', '$' + cmp(vn), vm ? pcs(vm / vn - 1) + ' market vs NAV' : '–') +
        stat('Cash (mUSDC)', '$' + cmp(cash), 'test money') + stat('Locked in votes', cmp(m.by.reduce((a, b) => a + num(b.escrowed), 0)), 'tokens') + '</div>' +
        '<div class="tp pftabs"><div class="ttabs"><button aria-pressed="true">Holdings</button></div><div class="pftb">' +
        (held ? '<table class="tt"><thead><tr><th class="l">Fund</th><th>Balance</th><th>Locked</th><th>Price</th><th>Value at market</th><th>NAV</th><th>Value at NAV</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
          : '<p class="note pfpad">No fund tokens in this wallet yet. Get test mUSDC below, then buy in a primary sale or in an order book.</p>') + '</div></div></section>'
    }
    PUT('pf').h = h
  }

  // ---------- Vaults ----------
  const curV = () => state.vaults[state.vsel]
  const isLeader = () => { const v = curV(); return !!v && !!state.account && v.leader.toLowerCase() === state.account.toLowerCase() }
  const symOf = (i) => (state.funds[i] ? state.funds[i].symbol : 'fund ' + i)
  function renderVaults() {
    const vs = state.vaults
    let h = '<section class="pfhead"><div><h1>Vaults</h1><p class="lead">Anyone can open a vault and trade it by their own strategy in the order books of this umbrella. Depositors share the result. The leader gets 10% of a depositor\'s profit, must own at least 5% of the vault, and can only trade, at no more than 5% above NAV and no less than 55% below it. Deposits and withdrawals are in mUSDC: a withdrawal takes your fraction of the cash and sells the same fraction of every position at market for you. Built after the user vaults of Hyperliquid. Vaults are separate from the funds\' own bid ladders.</p></div></section>'
    if (!CFG.vaults) h += '<div class="tp pfnone">Vaults are not deployed on ' + esc(CFG.network) + ' yet.</div>'
    else if (!vs.length) h += '<div class="tp pfnone">No vault yet. Open the first one below.</div>'
    else {
      const share = (v) => (v.shares > 0n ? (Number((v.leaderShares * 10000n) / v.shares) / 100).toFixed(1) + '%' : '–')
      h += '<div class="tp pftabs"><div class="ttabs"><button aria-pressed="true">All vaults</button></div><div class="pftb"><table class="tt"><thead><tr><th class="l">Vault</th><th class="l">Leader</th><th>Value</th><th>Share price</th><th>Since start</th><th>Leader owns</th><th>Your shares</th><th>Your value</th><th></th></tr></thead><tbody>' +
        vs.map((v, i) => '<tr class="click" data-vault="' + i + '"' + (i === state.vsel ? ' aria-selected="true"' : '') + '><td class="l"><b>' + esc(v.name) + '</b></td><td class="l">' + link(v.leader) + '</td><td>$' + cmp(num(v.value)) + '</td><td>' + num(v.price).toFixed(4) +
          '</td><td class="' + (v.price >= U6 ? 'up' : 'dn') + '">' + pcs(num(v.price) - 1) + '</td><td>' + share(v) + '</td><td>' + (v.me && v.me.shares > 0n ? amt(v.me.shares) : '–') + '</td><td>' + (v.me && v.me.shares > 0n ? '$' + cmp(num(v.me.worth)) : '–') +
          '</td><td>' + (v.closed ? '<span class="pill warn">closed</span>' : i === state.vsel ? '<span class="pill live">selected</span>' : '') + '</td></tr>').join('') + '</tbody></table></div></div>'
      const v = curV()
      const stat = (k, val, sub) => '<div class="pfs"><span>' + k + '</span><b class="num">' + val + '</b>' + (sub ? '<small class="num">' + sub + '</small>' : '') + '</div>'
      const mine = v.me && v.me.shares > 0n ? v.me : null
      const left = mine ? Math.max(0, mine.unlock - now()) : 0
      h += '<section class="pfgrid"><div class="pfcol tp">' + stat(esc(v.name), '$' + cmp(num(v.value)), esc(v.desc || 'tokens at the lower of market price and NAV')) +
        stat('Share price', num(v.price).toFixed(4), 'new shares cost ' + num(v.issue).toFixed(4)) + stat('Cash', '$' + cmp(num(v.cash)), 'mUSDC, incl. open buy orders') +
        stat('Leader owns', share(v), link(v.leader)) + stat('Deposit lock', dur(v.lock), v.closed ? 'closed: no lock' : 'after each deposit') +
        stat('Your shares', mine ? amt(mine.shares) : '–', mine ? 'worth $' + cmp(num(mine.worth)) + ' · paid in $' + cmp(num(mine.paid)) : (state.account ? 'none yet' : 'no wallet connected')) +
        stat('Your result', mine ? pcs(num(mine.paid) ? num(mine.worth) / num(mine.paid) - 1 : null) : '–', mine ? (v.closed || left <= 0 ? 'redeemable now' : 'unlocks in ' + dur(left)) : '') + '</div>' +
        '<div class="tp pftabs"><div class="ttabs"><button aria-pressed="true">Holdings of ' + esc(v.name) + '</button></div><div class="pftb">' +
        '<table class="tt"><thead><tr><th class="l">Asset</th><th>Amount</th><th>Counted at</th><th>Value</th><th>Share of vault</th></tr></thead><tbody>' +
        [['mUSDC', v.cash, U6]].concat(v.pos.map((p) => [symOf(p.fund), p.tokens, p.price])).map((r) => { const val = (r[1] * r[2]) / U6
          return '<tr><td class="l"><b>' + esc(r[0]) + '</b></td><td>' + amt(r[1]) + '</td><td>' + num(r[2]).toFixed(4) + '</td><td>$' + cmp(num(val)) + '</td><td>' + (v.value > 0n ? (Number((val * 10000n) / v.value) / 100).toFixed(1) + '%' : '–') + '</td></tr>' }).join('') + '</tbody></table>' +
        (v.orders.length ? '<table class="tt"><thead><tr><th class="l">Open order</th><th class="l">Fund</th><th class="l">Side</th><th>Limit price</th><th>Open size</th><th></th></tr></thead><tbody>' +
          v.orders.map((o) => '<tr data-a="vcancel"><td class="l">#' + o.id + '</td><td class="l">' + esc(symOf(o.fund)) + '</td><td class="l ' + (o.isBuy ? 'up' : 'dn') + '">' + (o.isBuy ? 'Buy' : 'Sell') + '</td><td>' + num(o.price).toFixed(4) + '</td><td>' + amt(o.tokens) +
            '</td><td><input type="hidden" data-k="fi" value="' + o.fund + '"><input type="hidden" data-k="id" value="' + o.id + '"><button class="tlink go"' + (isLeader() ? '' : ' hidden') + '>Cancel</button></td></tr>').join('') + '</tbody></table>'
          : '<p class="note pfpad">No open orders.</p>') +
        '</div></div></section>'
    }
    PUT('vl').h = h
    if (ST.forVault !== (curV() && isLeader() && !curV().closed ? curV().addr : null)) renderStrat()
  }

  // ---------- Strategy builder for vault leaders ----------
  // A strategy is a list of rules "quote this side at NAV +/- x% for this size, under this condition".
  // planStrategy turns it, with the vault's state, into orders to cancel and orders to place. The same
  // function exists in sdk/python/perma/strategy.py; test/strategy.test.js runs both on the same cases.
  // >>> strategy maths
  const S_ONE = 1000000n, S_PPM = 1000000n, S_MAX_ORDERS = 8
  const sPpm = (pct) => BigInt(Math.round(Number(pct) * 10000)) // 1% = 10,000 ppm
  function planStrategy(st, v) {
    const nav = v.nav, invested = (v.tokens * nav) / S_ONE, total = v.cash + invested
    const cap = (total * sPpm(st.maxInvestedPct)) / S_PPM
    let cashLeft = cap > invested ? cap - invested : 0n
    if (cashLeft > v.cash) cashLeft = v.cash
    let tokLeft = v.tokens
    const desired = []
    for (const r of (st.rules || []).slice(0, S_MAX_ORDERS)) {
      const buy = r.side === 'buy', w = sPpm(r.whenPct || 0)
      if (r.when === 'marketBelow' && !(v.mid * S_PPM < nav * (S_PPM + w))) continue
      if (r.when === 'marketAbove' && !(v.mid * S_PPM > nav * (S_PPM + w))) continue
      let px = (nav * (S_PPM + sPpm(r.offsetPct))) / S_PPM
      const hi = (nav * 105n) / 100n, lo = (nav * 45n) / 100n // the vault refuses fills outside NAV +5% / -55%
      if (buy && px > hi) px = hi
      if (!buy && px < lo) px = lo
      if (px <= 0n) continue
      // post-only: a quote that would trade at once is left out instead of taking
      if (st.postOnly && buy && v.bestAsk > 0n && px >= v.bestAsk) continue
      if (st.postOnly && !buy && v.bestBid > 0n && px <= v.bestBid) continue
      let sz = r.sizeMode === 'pctCash' ? (((v.cash * sPpm(r.size)) / S_PPM) * S_ONE) / px
        : r.sizeMode === 'pctPosition' ? (v.tokens * sPpm(r.size)) / S_PPM
        : BigInt(Math.round(Number(r.size) * 1e6))
      if (buy) {
        if ((sz * px) / S_ONE > cashLeft) sz = (cashLeft * S_ONE) / px
        if (sz < S_ONE) continue
        cashLeft -= (sz * px) / S_ONE
      } else {
        if (sz > tokLeft) sz = tokLeft
        if (sz < S_ONE) continue
        tokLeft -= sz
      }
      desired.push({ isBuy: buy, px, sz })
    }
    // keep resting orders that still fit, cancel the rest, place what is missing
    const tol = (nav * sPpm(st.requotePct)) / S_PPM, used = new Set(), place = []
    for (const d of desired) {
      const hit = v.orders.find((o) => !used.has(o.oid) && o.isBuy === d.isBuy && (o.px > d.px ? o.px - d.px : d.px - o.px) <= tol && o.sz * 2n >= d.sz && o.sz <= d.sz * 2n)
      if (hit) used.add(hit.oid)
      else place.push(d)
    }
    return { cancel: v.orders.filter((o) => !used.has(o.oid)).map((o) => o.oid), place: place.slice(0, Math.max(0, S_MAX_ORDERS - used.size)) }
  }
  // <<< strategy maths

  const ST_TEMPLATES = {
    discount: { label: 'Discount buyer', hint: 'Bids below NAV, offers what it holds close to NAV. Takes offers that are already cheaper than its bids.', postOnly: false, maxInvestedPct: 80, requotePct: 0.1, intervalSec: 20, rules: [
      { side: 'buy', offsetPct: -3, sizeMode: 'pctCash', size: 25, when: 'always', whenPct: 0 },
      { side: 'buy', offsetPct: -6, sizeMode: 'pctCash', size: 25, when: 'always', whenPct: 0 },
      { side: 'sell', offsetPct: -0.5, sizeMode: 'pctPosition', size: 100, when: 'always', whenPct: 0 }] },
    maker: { label: 'Market maker', hint: 'A bid and an offer close around NAV, inside the fund\'s own 0.2% steps. Post-only: it never takes.', postOnly: true, maxInvestedPct: 50, requotePct: 0.02, intervalSec: 10, rules: [
      { side: 'buy', offsetPct: -0.05, sizeMode: 'tokens', size: 250, when: 'always', whenPct: 0 },
      { side: 'sell', offsetPct: 0.05, sizeMode: 'tokens', size: 250, when: 'always', whenPct: 0 }] },
    grid: { label: 'Grid', hint: 'Three bids below NAV and three offers above, 0.5% apart. Post-only.', postOnly: true, maxInvestedPct: 60, requotePct: 0.1, intervalSec: 20, rules: [
      { side: 'buy', offsetPct: -0.5, sizeMode: 'tokens', size: 200, when: 'always', whenPct: 0 }, { side: 'buy', offsetPct: -1, sizeMode: 'tokens', size: 200, when: 'always', whenPct: 0 },
      { side: 'buy', offsetPct: -1.5, sizeMode: 'tokens', size: 200, when: 'always', whenPct: 0 }, { side: 'sell', offsetPct: 0.5, sizeMode: 'tokens', size: 200, when: 'always', whenPct: 0 },
      { side: 'sell', offsetPct: 1, sizeMode: 'tokens', size: 200, when: 'always', whenPct: 0 }, { side: 'sell', offsetPct: 1.5, sizeMode: 'tokens', size: 200, when: 'always', whenPct: 0 }] },
    dip: { label: 'Dip only', hint: 'Buys only while the market is 5% or more below NAV; sells when it is back within 1%.', postOnly: false, maxInvestedPct: 90, requotePct: 0.1, intervalSec: 20, rules: [
      { side: 'buy', offsetPct: -5, sizeMode: 'pctCash', size: 50, when: 'marketBelow', whenPct: -5 },
      { side: 'sell', offsetPct: -1, sizeMode: 'pctPosition', size: 100, when: 'marketAbove', whenPct: -1.5 }] },
    empty: { label: 'Empty', hint: 'Start from nothing.', postOnly: true, maxInvestedPct: 50, requotePct: 0.1, intervalSec: 20, rules: [] }
  }
  const ST = { key: (v) => 'perma.st.' + CFG.chainId + '.' + v.addr.toLowerCase(), agentKey: (v) => 'perma.va.' + CFG.chainId + '.' + v.addr.toLowerCase(), cur: null, forVault: null, run: null, preview: '', io: '', agent: null, agentEth: null }
  const stClone = (t) => JSON.parse(JSON.stringify(t))
  function stLoad(v) {
    if (ST.forVault === v.addr) return
    ST.forVault = v.addr; ST.preview = ''; ST.io = ''; ST.agentEth = null
    let saved = null
    try { saved = JSON.parse(store.get(ST.key(v)) || 'null') } catch (e) { saved = null }
    ST.cur = saved || Object.assign({ name: 'Discount buyer', template: 'discount', fund: (state.funds[state.selected] || {}).symbol || 'pBUY' }, stClone(ST_TEMPLATES.discount))
    const pk = store.get(ST.agentKey(v))
    ST.agent = pk ? new E.Wallet(pk) : null
  }
  const stExport = () => JSON.stringify({ name: ST.cur.name, fund: ST.cur.fund, postOnly: !!ST.cur.postOnly, intervalSec: Number(ST.cur.intervalSec), maxInvestedPct: Number(ST.cur.maxInvestedPct), requotePct: Number(ST.cur.requotePct),
    rules: ST.cur.rules.map((r) => ({ side: r.side, offsetPct: Number(r.offsetPct), sizeMode: r.sizeMode, size: Number(r.size), when: r.when, whenPct: Number(r.whenPct) })) }, null, 2)
  function stCheck(st) {
    const num = (x) => typeof x === 'number' && isFinite(x)
    if (!st || !Array.isArray(st.rules)) throw new Error('No rules found.')
    if (st.rules.length > S_MAX_ORDERS) throw new Error('At most 8 rules: a vault can have 8 open orders.')
    if (!state.funds.some((f) => f.symbol === st.fund)) throw new Error('Unknown fund ' + st.fund + '.')
    if (!(num(st.maxInvestedPct) && st.maxInvestedPct >= 0 && st.maxInvestedPct <= 100)) throw new Error('Max invested: 0 to 100%.')
    if (!(num(st.requotePct) && st.requotePct >= 0 && st.requotePct <= 5)) throw new Error('Re-quote threshold: 0 to 5%.')
    if (!(num(st.intervalSec) && st.intervalSec >= 5)) throw new Error('Interval: at least 5 seconds.')
    st.rules.forEach((r, i) => {
      if (r.side !== 'buy' && r.side !== 'sell') throw new Error('Rule ' + (i + 1) + ': side is buy or sell.')
      if (!(num(r.offsetPct) && r.offsetPct > -100 && r.offsetPct <= 100)) throw new Error('Rule ' + (i + 1) + ': price offset in % of NAV.')
      if (!['tokens', 'pctCash', 'pctPosition'].includes(r.sizeMode) || !(num(r.size) && r.size > 0)) throw new Error('Rule ' + (i + 1) + ': enter a size.')
      if (r.sizeMode === 'pctCash' && r.side !== 'buy') throw new Error('Rule ' + (i + 1) + ': "% of cash" sizes a buy.')
      if (r.sizeMode === 'pctPosition' && r.side !== 'sell') throw new Error('Rule ' + (i + 1) + ': "% of position" sizes a sell.')
      if (r.sizeMode !== 'tokens' && r.size > 100) throw new Error('Rule ' + (i + 1) + ': at most 100%.')
      if (!['always', 'marketBelow', 'marketAbove'].includes(r.when) || !num(r.whenPct)) throw new Error('Rule ' + (i + 1) + ': check the condition.')
    })
    return st
  }
  async function stState(v, st) {
    const idx = state.funds.findIndex((f) => f.symbol === st.fund), f = state.funds[idx]
    return read(async (p) => {
      const fund = new E.Contract(f.fund, ABI.fund, p), vc = new E.Contract(v.addr, ABI.vault, p), book = new E.Contract(f.book, ABI.book, p)
      const [nav, mid, cash, tokens, vo, bo, lad, issue, issuable] = await Promise.all([fund.navPerToken(), fund.marketPrice(), vc.cashTotal(), vc.tokensTotal(idx), vc.openOrders(), book.openOrders(),
        book.ladder(), book.issuePrice(), fund.issuanceApproved()])
      const orders = [...vo[0]].map((x, k) => ({ fund: Number(x), oid: vo[1][k], isBuy: vo[2][k], px: vo[3][k], sz: vo[4][k] })).filter((o) => o.fund === idx && o.sz > 0n)
      const all = [...bo[0]].map((id, k) => ({ id, maker: bo[1][k], isBuy: bo[2][k], price: bo[3][k], tokens: bo[4][k] }))
      // best prices of everyone else: the fund's ladder, approved new tokens, other makers' orders
      let bestBid = 0n, bestAsk = issuable > 0n ? issue : 0n
      for (let i = 0; i < lad[1].length; i++) {
        if (lad[4][i] > 0n && lad[1][i] > bestBid) bestBid = lad[1][i]
        if (lad[3][i] > 0n && (bestAsk === 0n || lad[2][i] < bestAsk)) bestAsk = lad[2][i]
      }
      for (const o of all) {
        if (o.tokens === 0n || o.maker.toLowerCase() === v.addr.toLowerCase()) continue
        if (o.isBuy && o.price > bestBid) bestBid = o.price
        if (!o.isBuy && (bestAsk === 0n || o.price < bestAsk)) bestAsk = o.price
      }
      return { idx, f, nav, mid, cash, tokens, orders, all, bestBid, bestAsk }
    })
  }
  const stLine = (o, sym) => (o.isBuy ? 'buy ' : 'sell ') + amt(o.sz) + ' ' + sym + ' at ' + num(o.px).toFixed(4)
  async function stPreview() {
    const v = curV(), st = stCheck(JSON.parse(stExport())), s = await stState(v, st), plan = planStrategy(st, s)
    const out = ['NAV ' + num(s.nav).toFixed(4) + ' · market ' + num(s.mid).toFixed(4) + ' · vault: ' + amt(s.cash) + ' mUSDC, ' + amt(s.tokens) + ' ' + st.fund + ', ' + s.orders.length + ' open order(s) · best bid ' + (s.bestBid ? num(s.bestBid).toFixed(4) : '–') + ', best offer ' + (s.bestAsk ? num(s.bestAsk).toFixed(4) : '–')]
    for (const id of plan.cancel) out.push('cancel #' + id)
    for (const o of plan.place) out.push('place: ' + stLine(o, st.fund))
    if (!plan.cancel.length && !plan.place.length) out.push('Nothing to do right now: the open orders already match the rules, no rule applies, or post-only holds a quote back.')
    return out.join('\n')
  }
  async function stAgentSend(label, make) {
    if (!state.provider) state.provider = makeProvider(state.rpcIndex)
    const a = ST.agent.connect(state.provider)
    const n = await read((p) => p.getTransactionCount(ST.agent.address, 'pending'))
    const nonce = ST.run && ST.run.nonce != null ? Math.max(n, ST.run.nonce) : n
    const tx = await make(a, Object.assign(feeOverrides(), { nonce }))
    if (ST.run) ST.run.nonce = nonce + 1
    const rc = await confirmFast(tx)
    log('  ' + label + ': block ' + rc.blockNumber)
  }
  async function stTick() {
    const run = ST.run
    if (!run || run.busy) return
    run.busy = true
    try {
      const v = state.vaults.find((x) => x.addr === run.vault)
      if (!v || v.closed) throw new Error('The vault is closed or gone.')
      const s = await stState(v, run.st), plan = planStrategy(run.st, s)
      run.ticks += 1
      if (plan.cancel.length || plan.place.length) log('Strategy "' + run.st.name + '" on ' + v.name + ': ' + plan.cancel.length + ' to cancel, ' + plan.place.length + ' to place (NAV ' + num(s.nav).toFixed(4) + ')')
      for (const id of plan.cancel) await stAgentSend('cancelled #' + id, (a, o) => new E.Contract(v.addr, ABI.vault, a).cancel(s.idx, id, o))
      for (const q of plan.place) {
        const ids = bookHints(q.isBuy, s.all.filter((o) => o.maker.toLowerCase() !== v.addr.toLowerCase()), q.px).map((o) => o.id)
        await stAgentSend(stLine(q, run.st.fund), (a, o) => new E.Contract(v.addr, ABI.vault, a)[q.isBuy ? 'limitBuy' : 'limitSell'](s.idx, q.sz, q.px, ids, o))
        run.orders += 1
      }
      run.err = 0
      if (plan.cancel.length || plan.place.length) refresh(true)
    } catch (e) {
      run.err = (run.err || 0) + 1
      log('Strategy: ' + reason(e), true)
      if (run.err >= 3) { log('Strategy stopped after three failures in a row.', true); stStop() }
    } finally { run.busy = false; renderStrat() }
  }
  function stStop() { if (ST.run) { clearInterval(ST.run.timer); ST.run = null } renderStrat() }
  function renderStrat() {
    const el = $('vstrat'); if (!el) return
    const v = curV()
    if (!v || !isLeader() || v.closed || !state.funds.length) { el.innerHTML = ''; ST.forVault = null; return }
    stLoad(v)
    const st = ST.cur, running = ST.run && ST.run.vault === v.addr
    const opt = (val, label, cur) => '<option value="' + val + '"' + (val === cur ? ' selected' : '') + '>' + label + '</option>'
    const inp = (k, val, w) => '<input data-sk="' + k + '" value="' + esc(String(val)) + '" inputmode="decimal" autocomplete="off" style="width:' + (w || 64) + 'px"' + (running ? ' disabled' : '') + '>'
    const dis = running ? ' disabled' : ''
    let h = '<div class="card stcard"><h3>Strategy builder</h3><p class="lead">Describe what the vault should quote, as rules relative to NAV. Preview shows the orders the rules give right now. ' +
      'Running it needs an agent key in this browser: it can only trade for this vault, and it runs only while this tab is open. The same rules run from the Python SDK (Export).</p>' +
      '<div class="strow"><label>Template <select data-sk="template"' + dis + '>' + Object.keys(ST_TEMPLATES).map((k) => opt(k, ST_TEMPLATES[k].label, st.template)).join('') + '</select></label>' +
      '<label>Name ' + '<input data-sk="name" value="' + esc(st.name) + '" style="width:150px"' + dis + '></label>' +
      '<label>Fund <select data-sk="fund"' + dis + '>' + state.funds.map((f) => opt(f.symbol, f.symbol, st.fund)).join('') + '</select></label>' +
      '<label>Max invested ' + inp('maxInvestedPct', st.maxInvestedPct, 48) + ' %</label><label>Re-quote when off by ' + inp('requotePct', st.requotePct, 48) + ' % of NAV</label>' +
      '<label>Check every ' + inp('intervalSec', st.intervalSec, 48) + ' s</label>' +
      '<label><input type="checkbox" data-sk="postOnly"' + (st.postOnly ? ' checked' : '') + dis + '> Post-only (never take)</label></div>' +
      '<p class="note">' + esc((ST_TEMPLATES[st.template] || {}).hint || '') + '</p>' +
      '<table class="tt sttab"><thead><tr><th class="l">#</th><th class="l">Side</th><th class="l">Price</th><th class="l">Size</th><th class="l">When</th><th></th></tr></thead><tbody>' +
      st.rules.map((r, i) => '<tr><td class="l">' + (i + 1) + '</td><td class="l"><select data-sk="r.' + i + '.side"' + dis + '>' + opt('buy', 'Buy', r.side) + opt('sell', 'Sell', r.side) + '</select></td>' +
        '<td class="l">NAV ' + inp('r.' + i + '.offsetPct', r.offsetPct, 56) + ' %</td>' +
        '<td class="l">' + inp('r.' + i + '.size', r.size, 70) + ' <select data-sk="r.' + i + '.sizeMode"' + dis + '>' + opt('tokens', 'tokens', r.sizeMode) + opt('pctCash', '% of cash', r.sizeMode) + opt('pctPosition', '% of position', r.sizeMode) + '</select></td>' +
        '<td class="l"><select data-sk="r.' + i + '.when"' + dis + '>' + opt('always', 'always', r.when) + opt('marketBelow', 'market below NAV', r.when) + opt('marketAbove', 'market above NAV', r.when) + '</select> ' + inp('r.' + i + '.whenPct', r.whenPct, 48) + ' %</td>' +
        '<td><button class="tlink" data-st="del" data-i="' + i + '"' + dis + '>remove</button></td></tr>').join('') +
      (st.rules.length ? '' : '<tr><td class="l" colspan="6">No rules yet.</td></tr>') + '</tbody></table>' +
      '<div class="stbtns"><button class="btn ghost sm" data-st="add"' + (running || st.rules.length >= S_MAX_ORDERS ? ' disabled' : '') + '>Add rule</button>' +
      '<button class="btn sm" data-st="preview">Preview</button><button class="btn ghost sm" data-st="save"' + dis + '>Save</button>' +
      '<button class="btn ghost sm" data-st="export">Export</button><button class="btn ghost sm" data-st="import"' + dis + '>Import</button></div>'
    if (ST.preview) h += '<pre class="stpre" id="st-preview">' + esc(ST.preview) + '</pre>'
    if (ST.io !== '') h += '<textarea class="stio" id="st-io" spellcheck="false">' + esc(ST.io) + '</textarea><p class="note">Export: save this as strategy.json and run <code>python3 examples/run_strategy.py strategy.json</code> from sdk/python. Import: paste rules here, then press Import again.</p>'
    h += '<div class="stagent"><b>Agent</b> '
    if (!ST.agent) h += 'none in this browser. <button class="btn ghost sm" data-st="agent"' + ((state.mm || {}).signer ? '' : ' disabled') + '>Create agent key</button><span class="note"> Two MetaMask confirmations: name the key as agent of this vault, send it ' + esc(CFG.tkGas || '0.002') + ' ETH for gas.</span>'
    else h += link(ST.agent.address) + ' · gas ' + (ST.agentEth === null ? '–' : Number(E.formatEther(ST.agentEth)).toFixed(5) + ' ETH') + ' ' +
      (running ? '<span class="pill live">running</span> ' + ST.run.ticks + ' checks, ' + ST.run.orders + ' order(s) placed <button class="btn sm" data-st="stop">Stop</button>'
        : '<button class="btn sm" data-st="start">Start</button> <button class="btn ghost sm" data-st="unagent"' + ((state.mm || {}).signer ? '' : ' disabled') + '>Remove agent</button>')
    h += '</div><p class="note">The rules are not stored on-chain and nothing forces the leader to follow them. Stopping leaves the open orders in the book; cancel them above if you want them gone.</p></div>'
    el.innerHTML = h
  }
  async function stAction(what, btn) {
    const v = curV(); if (!v) return
    const st = ST.cur
    try {
      if (what === 'add') { st.rules.push({ side: 'buy', offsetPct: -1, sizeMode: 'tokens', size: 100, when: 'always', whenPct: 0 }); st.template = 'empty' }
      else if (what === 'del') { st.rules.splice(Number(btn.dataset.i), 1) }
      else if (what === 'preview') { ST.preview = 'Reading the vault…'; renderStrat(); ST.preview = await stPreview() }
      else if (what === 'save') { stCheck(JSON.parse(stExport())); store.set(ST.key(v), JSON.stringify(Object.assign(JSON.parse(stExport()), { template: st.template }))); log('Strategy "' + st.name + '" saved in this browser.') }
      else if (what === 'export') { ST.io = stExport() }
      else if (what === 'import') {
        const box = $('st-io')
        if (!box || !box.value.trim()) { ST.io = ' ' } else {
          const inSt = stCheck(JSON.parse(box.value))
          ST.cur = Object.assign({ name: inSt.name || 'Imported', template: 'empty' }, inSt); ST.io = ''; ST.preview = ''
          log('Strategy imported: ' + ST.cur.rules.length + ' rule(s).')
        }
      } else if (what === 'agent') {
        const mm = state.mm || {}
        if (!mm.signer) throw new Error('Connect MetaMask on ' + CFG.network + ' first.')
        const w = E.Wallet.createRandom(), vc = new E.Contract(v.addr, ABI.vault, mm.signer)
        await mmSend('Naming ' + short(w.address) + ' as agent of ' + v.name, (s) => vc.connect(s).setAgent(w.address, true, feeOverrides()))
        store.set(ST.agentKey(v), w.privateKey); ST.agent = new E.Wallet(w.privateKey)
        await mmSend('Sending the agent ' + (CFG.tkGas || '0.002') + ' ETH for gas', (s) => s.sendTransaction(Object.assign({ to: w.address, value: E.parseEther(CFG.tkGas || '0.002') }, feeOverrides())))
      } else if (what === 'unagent') {
        const mm = state.mm || {}, vc = new E.Contract(v.addr, ABI.vault, mm.signer)
        await mmSend('Ending the agent ' + short(ST.agent.address), (s) => vc.connect(s).setAgent(ST.agent.address, false, feeOverrides()))
        store.set(ST.agentKey(v), null); ST.agent = null
      } else if (what === 'start') {
        const run = stCheck(JSON.parse(stExport()))
        if (!run.rules.length) throw new Error('Add at least one rule.')
        const ok = await read((p) => new E.Contract(v.addr, ABI.vault, p).agents(ST.agent.address))
        if (!ok) throw new Error('This key is no longer an agent of the vault. Remove it and create a new one.')
        ST.run = { vault: v.addr, st: run, ticks: 0, orders: 0, busy: false, nonce: null, err: 0, timer: setInterval(stTick, run.intervalSec * 1000) }
        log('Strategy "' + run.name + '" started on ' + v.name + ': checks every ' + run.intervalSec + ' s while this tab is open.')
        stTick()
      } else if (what === 'stop') { log('Strategy stopped. Open orders stay in the book.'); stStop(); return }
      if (ST.agent) { try { ST.agentEth = await read((p) => p.getBalance(ST.agent.address)) } catch (e) { /* shown as – */ } }
    } catch (e) { log('Strategy builder: ' + reason(e), true); if (what === 'preview') ST.preview = '' }
    renderStrat()
  }
  function stInput(el) {
    const k = el.dataset.sk, st = ST.cur
    if (!st) return
    const numeric = (x) => { const n = Number(String(x).replace(',', '.')); return isFinite(n) ? n : 0 }
    if (k === 'template') { const t = ST_TEMPLATES[el.value]; Object.assign(st, stClone(t), { template: el.value, name: t.label }); ST.preview = ''; renderStrat(); return }
    if (k.startsWith('r.')) {
      const [, i, f] = k.split('.'), r = st.rules[Number(i)]
      r[f] = (f === 'side' || f === 'sizeMode' || f === 'when') ? el.value : numeric(el.value)
      if (f === 'side') { if (r.side === 'buy' && r.sizeMode === 'pctPosition') r.sizeMode = 'pctCash'; if (r.side === 'sell' && r.sizeMode === 'pctCash') r.sizeMode = 'pctPosition'; renderStrat() }
    } else st[k] = k === 'postOnly' ? el.checked : (k === 'name' || k === 'fund') ? el.value : numeric(el.value)
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
  // A session key created in this browser may trade for it - only in this umbrella's order books
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
  const SESSION_ONLY = { swapbuy: 1, sell: 1, limitbuy: 1, limitsell: 1, cancel: 1, buy: 1, faucet: 1, mint: 1 }      // routed through the trading account
  const SESSION_DIRECT = { sweep: 1, fee: 1, close: 1, execute: 1, topup: 1 }          // need no funds: the key calls the fund itself
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
  const vsNav = (price, nav) => gapText(Number(((price - nav) * 10000n) / nav))
  const U6 = 10n ** 6n

  // >>> book maths
  // The same walk and the same rounding as OrderBook._match, so a preview shows what the contract will do.
  let BOOK_FEE_BPS = 7n // replaced by the contract's TAKER_FEE_BPS when a fund is loaded
  const bookFee = (cash) => (cash * BOOK_FEE_BPS + 9999n) / 10000n
  const BOOK_NO_CAP = (1n << 128n) - 1n
  const bidSize = (cash, price) => { if (price === 0n) return 0n; const s = (cash * U6) / price; return (s * price) / U6 === 0n ? 0n : s }
  // lad: per rung below NAV its bid price (prices), its ask price (asks), tokens and cash; edge: the rung where bids
  // and offers meet, where the contract starts reading; issue: the price of new tokens; issuable: how many are approved.
  // orders: open orders of the other side, best price first.
  function bookMatch(buying, maxTokens, maxCash, limit, lad, orders) {
    const n = lad.prices.length, tok = lad.tokens.slice(), cash = lad.cash.slice()
    const m = { tokens: 0n, cash: 0n, last: 0n, issued: 0n, fills: [] }
    let i = buying ? lad.edge : lad.edge + 1, j = 0, lo = n
    const read = new Set(), see = (k) => { read.add(k); if (k < lo) lo = k; return k } // the rungs the contract would read
    while (m.tokens < maxTokens) {
      let rp = 0n, ra = 0n
      if (buying) { for (; i < n; i++) if (tok[see(i)] > 0n && lad.asks[i] > 0n) { rp = lad.asks[i]; ra = tok[i]; break }
        if (ra === 0n && lad.issue > 0n && lad.issuable > m.issued) { rp = lad.issue; ra = lad.issuable - m.issued } } // nothing left on the ladder: approved new issuance
      else { for (; i > 0; i--) { const a = bidSize(cash[see(i - 1)], lad.prices[i - 1]); if (a > 0n) { rp = lad.prices[i - 1]; ra = a; break } } }
      let op = 0n, oa = 0n
      for (; j < orders.length; j++) { const o = orders[j]; if (o.tokens > 0n && (buying || (o.tokens * o.price) / U6 > 0n)) { op = o.price; oa = o.tokens; break } }
      if (ra === 0n && oa === 0n) break
      const useOrder = oa > 0n && (ra === 0n || (buying ? op <= rp : op >= rp))
      const p = useOrder ? op : rp
      if (buying ? p > limit : p < limit) break
      let q = useOrder ? oa : ra, c
      if (q > maxTokens - m.tokens) q = maxTokens - m.tokens
      if (buying) { const afford = ((maxCash - m.cash) * U6) / p; if (q > afford) q = afford; if (q === 0n) break; c = (q * p + U6 - 1n) / U6 }
      else { c = (q * p) / U6; if (c === 0n) break }
      m.tokens += q; m.cash += c; m.last = p
      if (useOrder) { m.fills.push({ id: orders[j].id, q }); j++ }
      else if (buying && i === n) m.issued += q
      else if (buying) { tok[i] -= q; cash[i] += c }
      else { cash[i - 1] -= c; tok[i - 1] += q }
    }
    // the lowest rung that holds tokens after the trade, found the way the contract finds it
    let e = buying || lo > lad.edge ? lad.edge : lo
    while (e < n && read.has(e) && tok[e] === 0n) e++
    if (e >= n) e = n - 1; else if (!buying && !read.has(e)) e = lad.edge
    m.fee = bookFee(m.cash)
    m.ladder = { prices: lad.prices, asks: lad.asks, tokens: tok, cash, edge: e, issue: lad.issue, issuable: lad.issuable - m.issued }
    return m
  }
  const bookBuy = (usdcIn, lad, orders) => bookMatch(true, BOOK_NO_CAP, (usdcIn * 10000n) / (10000n + BOOK_FEE_BPS), (1n << 256n) - 1n, lad, orders)
  const bookSell = (tokenIn, lad, orders) => bookMatch(false, tokenIn, BOOK_NO_CAP, 0n, lad, orders)
  // Open orders a taker would name: the other side, best price first, at most `max`.
  const bookHints = (buying, open, limit, max) => open.filter((o) => o.isBuy !== buying && o.tokens > 0n && (limit == null || (buying ? o.price <= limit : o.price >= limit)))
    .sort((a, b) => (a.price === b.price ? (a.id < b.id ? -1 : 1) : (buying ? (a.price < b.price ? -1 : 1) : (a.price > b.price ? -1 : 1)))).slice(0, max || 40)
  // The ladder's own price, as OrderBook.spotPrice() computes it.
  function bookSpot(lad) {
    let ask = 0n, bid = 0n
    if (lad.tokens[lad.edge] > 0n) ask = lad.asks[lad.edge]; else if (lad.issuable > 0n) ask = lad.issue
    for (let i = lad.edge + 1; i > 0; i--) if (bidSize(lad.cash[i - 1], lad.prices[i - 1]) > 0n) { bid = lad.prices[i - 1]; break }
    return bid === 0n ? ask : ask === 0n ? bid : (ask + bid) / 2n
  }
  // <<< book maths

  const myAddr = () => (state.account || '').toLowerCase()
  const feeText = () => (Number(BOOK_FEE_BPS) / 100).toFixed(2) + '%'
  // The resting orders a taker names: the other side, best price first, never its own.
  const hintsFor = (d, buying, limit) => bookHints(buying, d.orders.filter((o) => o.maker.toLowerCase() !== myAddr()), limit)
  const ceilMul = (tokens, price) => (tokens * price + U6 - 1n) / U6
  // What the ladder is short of 5% of net assets; its tokens count at NAV, as in the contract.
  const reserveGap = (d) => (d.netAssets * 500n) / 10000n - (d.polCash + (d.polTokens * d.navPerToken) / U6)
  const marketOpen = (d) => need(d.saleClosed, 'The market opens when the sale closes.')

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
    { id: 'swapbuy', title: 'Buy in the order book', btn: 'Buy', term: 'buy', fields: [F.usdc('a')],
      why: marketOpen,
      quote: (d, m, v) => {
        const sim = bookBuy(v.a, d.lad, hintsFor(d, true))
        if (sim.tokens === 0n) return [['Nothing on offer', 'no sell orders, and holders have approved no new tokens']]
        const paid = sim.cash + sim.fee
        return [['You pay', amt(paid) + ' mUSDC'], ['You receive about', amt(sim.tokens) + ' ' + d.symbol], ['Average price', usd((paid * U6) / sim.tokens)], ['Last fill at', usd(sim.last)],
          ['Last fill vs NAV', vsNav(sim.last, d.navPerToken)], ['Taker fee (' + feeText() + ')', amt(sim.fee) + ' mUSDC'], ['Minimum received', amt((sim.tokens * 99n) / 100n) + ' ' + d.symbol]]
          .concat(sim.issued > 0n ? [['Newly issued', amt(sim.issued) + ' ' + d.symbol + ' at ' + usd(d.lad.issue)]] : [])
          .concat(v.a - paid > U6 ? [['Not filled', amt(v.a - paid) + ' mUSDC: nothing more is on offer']] : [])
      },
      steps: async (c, v) => {
        const ids = hintsFor(c.d, true).map((o) => o.id), q = await c.book.quoteBuy(v.a, ids)
        return [await approval(c, c.usdc, c.f.book, v.a, 'mUSDC'), ['Buying in the order book', c.book, 'buy', [v.a, (q[0] * 99n) / 100n, ids]]]
      } },
    { id: 'sell', title: 'Sell in the order book', btn: 'Sell', term: 'sell', fields: [F.tok('a')],
      why: marketOpen,
      quote: (d, m, v) => {
        const sim = bookSell(v.a, d.lad, hintsFor(d, false))
        if (sim.tokens === 0n) return [['No bids', 'the book has no buy side right now']]
        const out = sim.cash - sim.fee
        return [['You sell', amt(sim.tokens) + ' ' + d.symbol], ['You receive about', amt(out) + ' mUSDC'], ['Average price', usd((out * U6) / sim.tokens)], ['Last fill at', usd(sim.last)],
          ['Last fill vs NAV', vsNav(sim.last, d.navPerToken)], ['Taker fee (' + feeText() + ')', amt(sim.fee) + ' mUSDC'], ['Minimum received', amt((out * 99n) / 100n) + ' mUSDC']]
          .concat(v.a - sim.tokens > 0n ? [['Not filled', amt(v.a - sim.tokens) + ' ' + d.symbol + ': the book bids for no more']] : [])
      },
      steps: async (c, v) => {
        const ids = hintsFor(c.d, false).map((o) => o.id), q = await c.book.quoteSell(v.a, ids)
        return [await approval(c, c.token, c.f.book, v.a, c.d.symbol), ['Selling in the order book', c.book, 'sell', [v.a, (q[0] * 99n) / 100n, ids]]]
      } },
    { id: 'limitbuy', title: 'Limit buy', btn: 'Buy', term: 'buy', otype: 'limit', fields: [F.usdc('p'), F.tok('a')],
      why: marketOpen,
      quote: (d, m, v) => {
        if (v.p <= 0n) return null
        const sim = bookMatch(true, v.a, BOOK_NO_CAP, v.p, d.lad, hintsFor(d, true, v.p))
        const rest = v.a - sim.tokens >= U6 ? v.a - sim.tokens : 0n
        return [['Limit price', usd(v.p)], ['Vs NAV', vsNav(v.p, d.navPerToken)],
          ['Fills at once', sim.tokens > 0n ? amt(sim.tokens) + ' ' + d.symbol + ' at avg ' + usd((sim.cash * U6) / sim.tokens) : 'nothing: below the cheapest offer'],
          ['Rests in the book', rest > 0n ? amt(rest) + ' ' + d.symbol + ' at ' + usd(v.p) : 'nothing'],
          ['mUSDC needed', amt(sim.cash + (sim.tokens > 0n ? sim.fee : 0n) + ceilMul(rest, v.p))],
          ['Taker fee (' + feeText() + ')', sim.tokens > 0n ? amt(sim.fee) + ' mUSDC' : 'none while resting']]
      },
      steps: async (c, v) => {
        const ids = hintsFor(c.d, true, v.p).map((o) => o.id), cost = ceilMul(v.a, v.p)
        return [await approval(c, c.usdc, c.f.book, cost + cost / 100n + 1n, 'mUSDC'), ['Placing a limit buy at ' + usd(v.p), c.book, 'limitBuy', [v.a, v.p, ids]]]
      } },
    { id: 'limitsell', title: 'Limit sell', btn: 'Sell', term: 'sell', otype: 'limit', fields: [F.usdc('p'), F.tok('a')],
      why: marketOpen,
      quote: (d, m, v) => {
        if (v.p <= 0n) return null
        const sim = bookMatch(false, v.a, BOOK_NO_CAP, v.p, d.lad, hintsFor(d, false, v.p))
        const rest = v.a - sim.tokens >= U6 ? v.a - sim.tokens : 0n
        return [['Limit price', usd(v.p)], ['Vs NAV', vsNav(v.p, d.navPerToken)],
          ['Fills at once', sim.tokens > 0n ? amt(sim.tokens) + ' ' + d.symbol + ' at avg ' + usd((sim.cash * U6) / sim.tokens) : 'nothing: no bid at or above your price'],
          ['Rests in the book', rest > 0n ? amt(rest) + ' ' + d.symbol + ' at ' + usd(v.p) : 'nothing'],
          ['mUSDC if all of it fills', amt(sim.cash - (sim.tokens > 0n ? sim.fee : 0n) + (rest * v.p) / U6)],
          ['Taker fee (' + feeText() + ')', sim.tokens > 0n ? amt(sim.fee) + ' mUSDC' : 'none while resting']]
      },
      steps: async (c, v) => {
        const ids = hintsFor(c.d, false, v.p).map((o) => o.id)
        return [await approval(c, c.token, c.f.book, v.a, c.d.symbol), ['Placing a limit sell at ' + usd(v.p), c.book, 'limitSell', [v.a, v.p, ids]]]
      } },
    { id: 'cancel', title: 'Cancel order', btn: 'Cancel', fields: [F.text('id')],
      why: () => '',
      steps: async (c, v) => [['Cancelling order #' + v.id, c.book, 'cancel', [BigInt(v.id)]]] },
    { id: 'close', inline: true, title: 'Close the sale and open the market', btn: 'Close sale, open market', fields: [],
      show: (d) => !d.saleClosed,
      why: (d, m) => d.saleClosed ? 'The sale is already closed.' : d.sold < 100n * U6 ? 'Sell at least 100 tokens first.' : (m && m.isGP) || d.sold === SALE_CAP ? '' : 'Only the GP can close before sell-out.',
      steps: async (c) => [['Closing the sale', c.fund, 'closeSale', []]] },
    { id: 'sweep', inline: true, title: 'Move the ladder profit into the surplus pot', btn: 'Sweep ladder profit', fields: [],
      show: (d) => d.saleClosed,
      why: (d) => (!d.saleClosed ? 'Starts when the sale closes.' : ''),
      steps: async (c) => [['Moving the ladder profit into the surplus pot', c.fund, 'sweepLadder', []]] },
    { id: 'topup', inline: true, title: 'Top up the reserve', btn: 'Top up to 5%', fields: [],
      show: (d) => d.saleClosed,
      why: (d) => !d.saleClosed ? 'Starts when the sale closes.' : reserveGap(d) <= 0n ? 'The reserve is at 5% of net assets.' : d.vaultCash === 0n ? 'The vault holds no cash.' : '',
      steps: async (c) => [['Topping up the reserve from the vault', c.fund, 'topUpReserve', []]] },
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
    { id: 'mark', tab: 'gp', gp: true, title: 'Propose a revaluation', lead: 'State what the off-chain investments are worth. The value applies only after the dispute window; you post a bond of 1% (at least 10 mUSDC) that you lose if holders reject it. The report text is stored as its hash.', btn: 'Propose value',
      fields: [F.usdc('val'), F.text('report', 'Report: link or full text, stored as hash'), F.text('memo', 'Memo, e.g. Q3 2026 valuation')],
      why: (d) => !d.saleClosed ? 'Possible after the sale closes.' : d.markOpen ? 'A valuation is still pending.' : '',
      pre: (d, m, v) => d.outstandingSupply === 0n ? '' : 'Bond ' + amt(markBond(v.val)) + ' mUSDC · NAV per token after: about ' + usd(((d.netAssets - d.investedValue + v.val) * U6) / d.outstandingSupply) + ' (now ' + usd(d.navPerToken) + ') · applies after ' + dur(state.voting || 0) + ' unless disputed',
      steps: async (c, v) => {
        if (!v.report) throw new Error('Name the report behind the value: a link or its text.')
        return [await approval(c, c.usdc, c.f.fund, markBond(v.val), 'mUSDC'), ['Proposing a revaluation', c.fund, 'proposeMark', [v.val, E.id(v.report), v.memo]]]
      } },
    { id: 'followon', tab: 'gp', gp: true, title: 'Propose new tokens', lead: 'Ask holders to approve an amount of new tokens. Approved tokens are offered to everyone in the order book at NAV +0.2%; the GP sets neither price nor buyer.', btn: 'Start the vote', fields: [F.tok('a')],
      why: (d) => !d.saleClosed ? 'Possible after the sale closes.' : d.issuanceVoteActive ? 'A vote on new tokens is already running.' : '',
      pre: (d) => 'Already approved and unsold: ' + amt(d.issuanceApproved) + ' · issue price now ' + usd(d.lad.issue),
      steps: async (c, v) => [['Proposing the issue of new tokens', c.fund, 'proposeIssuance', [v.a]]] },
    { id: 'pbuyback', tab: 'gp', gp: true, title: 'Propose a buyback', lead: 'Ask holders to release mUSDC from the surplus pot for buying tokens back and burning them.', btn: 'Start the vote', fields: [F.usdc('a')],
      why: (d) => !d.saleClosed ? 'Possible after the sale closes.' : d.issuanceVoteActive ? 'A holder vote is already running.' : d.surplus === 0n ? 'The surplus pot is empty.' : '',
      pre: (d) => 'In the pot: ' + amt(d.surplus) + ' mUSDC · already approved: ' + amt(d.buybackApproved + d.dividendApproved),
      steps: async (c, v) => [['Proposing a buyback of ' + amt(v.a) + ' mUSDC', c.fund, 'proposeSurplusUse', [1, v.a]]] },
    { id: 'pdividend', tab: 'gp', gp: true, title: 'Propose a dividend', lead: 'Ask holders to release mUSDC from the surplus pot as a dividend.', btn: 'Start the vote', fields: [F.usdc('a')],
      why: (d) => !d.saleClosed ? 'Possible after the sale closes.' : d.issuanceVoteActive ? 'A holder vote is already running.' : d.surplus === 0n ? 'The surplus pot is empty.' : '',
      pre: (d) => 'In the pot: ' + amt(d.surplus) + ' mUSDC · already approved: ' + amt(d.buybackApproved + d.dividendApproved),
      steps: async (c, v) => [['Proposing a dividend of ' + amt(v.a) + ' mUSDC', c.fund, 'proposeSurplusUse', [2, v.a]]] },
    { id: 'buyback', tab: 'gp', gp: true, title: 'Buy back and burn', lead: 'Spends approved surplus on the cheapest offers in the book. Only while the market is below NAV.', btn: 'Buy back', fields: [F.usdc('a')],
      why: (d) => !d.saleClosed ? 'Opens with the market.' : d.buybackApproved === 0n ? 'Holders have approved no buyback.' : d.marketPrice >= d.navPerToken ? 'The market is not below NAV.' : '',
      pre: (d) => 'Approved: ' + amt(d.buybackApproved) + ' mUSDC',
      steps: async (c, v) => [['Buying back for ' + amt(v.a) + ' mUSDC', c.fund, 'buyback', [v.a, bookHints(true, c.d.orders, null).map((o) => o.id)]]] },
    { id: 'paydiv', tab: 'gp', gp: true, title: 'Pay the dividend', lead: 'Pays approved surplus to every token in a wallet at this moment. Tokens in the order book or locked in a vote get nothing.', btn: 'Pay dividend', fields: [F.usdc('a')],
      why: (d) => !d.saleClosed ? 'Opens with the market.' : d.dividendApproved === 0n ? 'Holders have approved no dividend.' : '',
      pre: (d) => 'Approved: ' + amt(d.dividendApproved) + ' mUSDC',
      steps: async (c, v) => [['Paying a dividend of ' + amt(v.a) + ' mUSDC', c.fund, 'payDividend', [v.a]]] },
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
    { id: 'mdispute', tab: 'govern', title: 'Valuation: dispute', lead: 'Disagree with the value the GP proposed. You post the same bond as the GP; holders then vote, and the losing side forfeits its bond to the winner.', btn: 'Dispute the value', fields: [],
      show: (d) => !!d.mark && d.mark.state === 1,
      why: (d, m) => !d.mark || d.mark.state !== 1 || d.mark.deadline < now() ? 'Nothing to dispute.' : m && m.isGP ? 'The GP cannot dispute his own value.' : m && m.token === 0n ? 'Token holders only.' : '',
      pre: (d) => markText(d),
      steps: async (c) => [await approval(c, c.usdc, c.f.fund, c.d.mark.bond, 'mUSDC'), ['Disputing the valuation', c.fund, 'disputeMark', []]] },
    { id: 'mvoteyes', tab: 'govern', title: 'Valuation: vote for the GP\u2019s value', btn: 'Lock tokens: accept', fields: [F.tok('a')], chips: [{ l: 'Max', pct: 100, of: 'token' }],
      show: (d) => !!d.mark && d.mark.state === 2,
      why: (d, m) => d.mark.deadline < now() ? 'The vote is over.' : m && m.isGP ? 'The GP cannot vote.' : '',
      pre: (d) => markText(d),
      steps: async (c, v) => [await approval(c, c.token, c.f.fund, v.a, c.d.symbol), ['Voting for the value', c.fund, 'voteMark', [true, v.a]]] },
    { id: 'mvoteno', tab: 'govern', title: 'Valuation: vote against', btn: 'Lock tokens: reject', fields: [F.tok('a')], chips: [{ l: 'Max', pct: 100, of: 'token' }],
      show: (d) => !!d.mark && d.mark.state === 2,
      why: (d, m) => d.mark.deadline < now() ? 'The vote is over.' : m && m.isGP ? 'The GP cannot vote.' : '',
      steps: async (c, v) => [await approval(c, c.token, c.f.fund, v.a, c.d.symbol), ['Voting against the value', c.fund, 'voteMark', [false, v.a]]] },
    { id: 'mresolve', tab: 'govern', title: 'Valuation: settle', lead: 'Anyone can settle once the window is over. Undisputed, the value applies; disputed, more tokens for than against apply it, a tie rejects it.', btn: 'Settle', fields: [],
      show: (d) => d.markOpen,
      why: (d) => d.mark.deadline >= now() ? 'Open for another ' + dur(d.mark.deadline - now()) + '.' : '',
      pre: (d) => markText(d),
      steps: async (c) => [['Settling the valuation', c.fund, 'resolveMark', []]] },
    { id: 'mwithdraw', tab: 'govern', title: 'Valuation: withdraw locked votes', btn: 'Withdraw', ghost: true, fields: [],
      show: (d, m) => !!m && m.markLocked > 0n,
      why: (d) => d.markOpen ? 'The vote is still running.' : '',
      steps: async (c) => [['Withdrawing locked votes', c.fund, 'withdrawMarkVotes', [c.d.markId]]] },
    { id: 'claimdiv', tab: 'govern', title: 'Collect your dividend', lead: 'Dividends stay with whoever held the tokens when they were paid.', btn: 'Collect', fields: [],
      show: (d, m) => !!m && m.dividend > 0n,
      why: (d, m) => (m && m.dividend > 0n ? '' : 'Nothing to collect.'),
      pre: (d, m) => (m ? amt(m.dividend) + ' mUSDC' : ''),
      steps: async (c) => [['Collecting the dividend', c.fund, 'claimDividend', [c.account]]] },
    { id: 'ivote', tab: 'govern', title: 'Holder vote: vote yes', lead: 'Approve what the GP asked for: new tokens, a buyback or a dividend. Your tokens are locked in the fund until the vote ends.', btn: 'Lock tokens and vote yes',
      fields: [F.tok('a')], chips: [{ l: '50%', pct: 50, of: 'token' }, { l: 'Max', pct: 100, of: 'token' }],
      show: (d) => d.issuanceVoteActive,
      why: (d, m) => !d.issuanceVoteActive ? 'No holder vote is running.' : m && m.isGP ? 'The GP cannot vote on his own proposal.' : '',
      pre: (d) => 'Proposed: ' + voteWhat(d) + ' · yes so far ' + amt(d.issueYes) + ' of ' + amt(d.eligibleSupply) + ' eligible · ' + dur(Math.max(0, Number(d.issueDeadline) - now())) + ' left',
      steps: async (c, v) => [await approval(c, c.token, c.f.fund, v.a, c.d.symbol), ['Voting yes on the proposal', c.fund, 'voteIssuance', [v.a]]] },
    { id: 'iexecute', tab: 'govern', title: 'Holder vote: approve', lead: 'Anyone can execute once more than 50% of eligible supply has voted yes.', btn: 'Approve the proposal', fields: [],
      show: (d) => d.issuanceVoteActive,
      why: (d) => !d.issuanceVoteActive ? 'No holder vote is running.' : d.issueYes * 10000n > d.eligibleSupply * 5000n ? '' : 'Threshold of more than 50% not reached.',
      steps: async (c) => [['Approving the proposal', c.fund, 'executeIssuance', []]] },
    { id: 'iwithdraw', tab: 'govern', title: 'Holder vote: withdraw locked votes', lead: 'Get your tokens back after the vote.', btn: 'Withdraw', ghost: true, fields: [],
      show: (d, m) => !!m && m.issueLocked > 0n,
      why: (d, m) => m && m.issueLocked === 0n ? 'You have no tokens locked.' : d.issuanceVoteActive ? 'The vote is still running.' : '',
      steps: async (c) => [['Withdrawing locked votes', c.fund, 'withdrawIssuanceVotes', [c.d.issueProposalId]]] },
    { id: 'withdraw', tab: 'govern', title: 'Withdraw locked votes', lead: 'Get your tokens back after the vote.', btn: 'Withdraw', ghost: true, fields: [],
      show: (d, m) => !!m && m.escrowed > 0n,
      why: (d, m) => m && m.escrowed === 0n ? 'You have no tokens locked.' : d.voteActive ? 'The vote is still running.' : '',
      steps: async (c) => [['Withdrawing locked votes', c.fund, 'withdrawVotes', [c.d.proposalId]]] }
  ]
  // Vault actions. The leader trades in the sub-fund chosen in the top bar.
  const SHARES = (k) => ({ k, ph: '0', type: 'amount', unit: 'shares' })
  const vaultOpen = (d) => { const v = curV(); return !v ? 'Choose a vault above.' : v.closed ? 'This vault is closed.' : '' }
  const leaderWhy = (d) => vaultOpen(d) || need(isLeader(), 'Only the leader of this vault can trade it.') || marketOpen(d)
  const redeemParts = (v, a) => {
    const me = v.me
    if (!me || me.shares === 0n || a > me.shares || v.shares === 0n) return null
    const worth = (v.value * a) / v.shares, part = (me.paid * a) / me.shares
    const feeShares = !isLeader() && worth > part ? (a * (((worth - part) * 1000n) / 10000n)) / worth : 0n
    const burned = a - feeShares
    return { feeShares, cash: (v.cash * burned) / v.shares, tokens: v.pos.map((p) => [symOf(p.fund), (p.tokens * burned) / v.shares]).filter((t) => t[1] > 0n) }
  }
  ACTIONS.push(
    { id: 'vcreate', tab: 'vault', title: 'Open a vault', lead: 'You become its leader. The first deposit is your own money, at least 100 mUSDC.', btn: 'Open vault',
      fields: [F.text('n', 'Name, up to 32 characters'), F.text('ds', 'Description, up to 140 characters'), F.usdc('a', 'First deposit')],
      why: () => need(!!CFG.vaults, 'Vaults are not deployed on this network yet.'),
      steps: async (c, v) => {
        if (!v.n || v.n.length > 32) throw new Error('Give the vault a name of 1 to 32 characters.')
        if (v.ds.length > 140) throw new Error('The description can have up to 140 characters.')
        return [await approval(c, c.usdc, CFG.vaults, v.a, 'mUSDC'), ['Opening the vault ' + v.n, c.vf, 'create', [v.n, v.ds, v.a]]]
      } },
    { id: 'vdeposit', tab: 'vault', title: 'Deposit into the selected vault', btn: 'Deposit', fields: [F.usdc('a')],
      chips: [{ l: '1k', v: '1000' }, { l: '10k', v: '10000' }, { l: '50k', v: '50000' }],
      show: () => !!curV(),
      why: vaultOpen,
      pre: (d, m, x) => {
        const v = curV(); if (!v || v.issue === 0n) return ''
        const sh = (x.a * U6) / v.issue
        if (!isLeader() && v.leaderShares * 10000n < (v.shares + sh) * 500n) return 'Too large: the leader would own less than 5% of the vault.'
        return 'About ' + amt(sh) + ' shares at ' + num(v.issue).toFixed(4) + ' · redeemable ' + dur(v.lock) + ' after the deposit'
      },
      steps: async (c, x) => { const v = curV(); return [await approval(c, c.usdc, v.addr, x.a, 'mUSDC'), ['Depositing into ' + v.name, c.vault, 'deposit', [x.a, (((x.a * U6) / v.issue) * 99n) / 100n]]] } },
    { id: 'vredeem', tab: 'vault', title: 'Withdraw', lead: 'Paid in mUSDC: your fraction of the cash, plus what the sale of your fraction of each position brings at market.', btn: 'Withdraw', fields: [SHARES('a')],
      chips: [25, 50, 100].map((p) => ({ l: p + '%', get: () => { const v = curV(); return v && v.me ? E.formatUnits((v.me.shares * BigInt(p)) / 100n, D) : '' } })),
      show: () => !!curV(),
      why: () => { const v = curV(); if (!v) return 'Choose a vault above.'
        if (!v.me || v.me.shares === 0n) return 'This wallet has no shares in this vault.'
        return !v.closed && now() < v.me.unlock ? 'Your deposit unlocks in ' + dur(v.me.unlock - now()) + '.' : '' },
      pre: (d, m, x) => {
        const v = curV(), r = v && redeemParts(v, x.a)
        if (!r) return v && v.me && x.a > v.me.shares ? 'More than this wallet holds (' + amt(v.me.shares) + ' shares).' : ''
        return 'You receive ' + amt(r.cash) + ' mUSDC in cash' + r.tokens.map((t) => ' plus the market sale of ' + amt(t[1]) + ' ' + t[0]).join('') +
          (r.feeShares > 0n ? ' · ' + amt(r.feeShares) + ' shares go to the leader (10% of your profit)' : '') +
          (isLeader() && !v.closed ? ' · you must keep 5% of the vault' : '')
      },
      steps: async (c, x) => {
        const v = curV(), ids = v.pos.map((p) => (p.fund === state.selected ? hintsFor(c.d, false).map((o) => o.id) : []))
        const out = await c.vault.redeem.staticCall(x.a, 0, ids).catch((e) => { throw new Error('Blocked by the contract: ' + reason(e)) })
        return [['Withdrawing ' + amt(x.a) + ' shares of ' + v.name + ' for about ' + amt(out) + ' mUSDC', c.vault, 'redeem', [x.a, (out * 99n) / 100n, ids]]]
      } },
    { id: 'vagent', tab: 'vault', title: 'Leader: agent', lead: 'Let another address trade for the vault. It can do nothing else. Send the same address with 0 in the second field to end it.', btn: 'Set agent', fields: [F.address('g', 'Agent address'), F.text('on', '1 = allow, 0 = end')],
      show: isLeader, why: (d) => vaultOpen(d) || need(isLeader(), 'Only the leader can name agents.'),
      steps: async (c, x) => [[(x.on === '0' ? 'Ending' : 'Allowing') + ' agent ' + short(x.g), c.vault, 'setAgent', [x.g, x.on !== '0']]] },
    { id: 'vbuy', tab: 'vault', title: 'Leader: buy for the vault', btn: 'Buy at market', fields: [F.usdc('a')],
      show: isLeader, why: leaderWhy,
      pre: (d, m, x) => { const sim = bookBuy(x.a, d.lad, hintsFor(d, true)); return sim.tokens === 0n ? 'Nothing on offer in ' + d.symbol + ' right now.' : 'About ' + amt(sim.tokens) + ' ' + d.symbol + ' at avg ' + usd(((sim.cash + sim.fee) * U6) / sim.tokens) + ' · the vault holds ' + amt(curV().cash) + ' mUSDC' },
      steps: async (c, x) => { const ids = hintsFor(c.d, true).map((o) => o.id), q = await c.book.quoteBuy(x.a, ids); return [['Buying ' + c.d.symbol + ' for ' + curV().name, c.vault, 'buy', [state.selected, x.a, (q[0] * 99n) / 100n, ids]]] } },
    { id: 'vsell', tab: 'vault', title: 'Leader: sell for the vault', btn: 'Sell at market', fields: [F.tok('a')],
      show: isLeader, why: leaderWhy,
      pre: (d, m, x) => { const sim = bookSell(x.a, d.lad, hintsFor(d, false)); return sim.tokens === 0n ? 'No bids in ' + d.symbol + ' right now.' : 'About ' + amt(sim.cash - sim.fee) + ' mUSDC at avg ' + usd(((sim.cash - sim.fee) * U6) / sim.tokens) },
      steps: async (c, x) => { const ids = hintsFor(c.d, false).map((o) => o.id), q = await c.book.quoteSell(x.a, ids); return [['Selling ' + c.d.symbol + ' for ' + curV().name, c.vault, 'sell', [state.selected, x.a, (q[0] * 99n) / 100n, ids]]] } },
    { id: 'vlimitbuy', tab: 'vault', title: 'Leader: limit buy', btn: 'Place buy order', fields: [F.usdc('p', 'Limit price'), F.tok('a', 'Size')],
      show: isLeader, why: leaderWhy,
      pre: (d, m, x) => (x.p > 0n ? vsNav(x.p, d.navPerToken) + ' · up to ' + amt((x.a * x.p) / U6) + ' mUSDC · at most 8 open orders per vault' : ''),
      steps: async (c, x) => [['Placing a limit buy at ' + usd(x.p) + ' for ' + curV().name, c.vault, 'limitBuy', [state.selected, x.a, x.p, hintsFor(c.d, true, x.p).map((o) => o.id)]]] },
    { id: 'vlimitsell', tab: 'vault', title: 'Leader: limit sell', btn: 'Place sell order', fields: [F.usdc('p', 'Limit price'), F.tok('a', 'Size')],
      show: isLeader, why: leaderWhy,
      pre: (d, m, x) => (x.p > 0n ? vsNav(x.p, d.navPerToken) + ' · ' + amt((x.a * x.p) / U6) + ' mUSDC if filled' : ''),
      steps: async (c, x) => [['Placing a limit sell at ' + usd(x.p) + ' for ' + curV().name, c.vault, 'limitSell', [state.selected, x.a, x.p, hintsFor(c.d, false, x.p).map((o) => o.id)]]] },
    { id: 'vcancel', title: 'Cancel a vault order', btn: 'Cancel', fields: [F.text('fi'), F.text('id')],
      why: () => need(isLeader(), 'Only the leader can cancel.'),
      steps: async (c, v) => [['Cancelling order #' + v.id + ' of ' + curV().name, c.vault, 'cancel', [BigInt(v.fi), BigInt(v.id)]]] },
    { id: 'vclose', tab: 'vault', title: 'Leader: close the vault', lead: 'Possible once every position is sold. Cancels open orders and ends trading and deposits; everyone, you included, then withdraws without a lock. This cannot be undone.', btn: 'Close the vault', ghost: true, fields: [],
      show: () => isLeader() && !curV().closed, why: (d) => vaultOpen(d) || need(isLeader(), 'Only the leader can close it.') || need(curV().pos.every((p) => p.tokens < U6), 'Sell all positions first.'),
      steps: async (c) => [['Closing ' + curV().name, c.vault, 'close', []]] }
  )
  const ACT = Object.fromEntries(ACTIONS.map((a) => [a.id, a]))
  // With a session key, trades go through the trading account; the key holds no funds.
  const SESSION_STEPS = {
    swapbuy: async (c, v) => { const ids = hintsFor(c.d, true).map((o) => o.id), q = await c.book.quoteBuy(v.a, ids); return [['Buying in the order book via the trading account', c.acct, 'buyInBook', [state.selected, v.a, (q[0] * 99n) / 100n, ids]]] },
    sell: async (c, v) => { const ids = hintsFor(c.d, false).map((o) => o.id), q = await c.book.quoteSell(v.a, ids); return [['Selling in the order book via the trading account', c.acct, 'sellInBook', [state.selected, v.a, (q[0] * 99n) / 100n, ids]]] },
    limitbuy: async (c, v) => [['Placing a limit buy at ' + usd(v.p) + ' via the trading account', c.acct, 'limitBuyInBook', [state.selected, v.a, v.p, hintsFor(c.d, true, v.p).map((o) => o.id)]]],
    limitsell: async (c, v) => [['Placing a limit sell at ' + usd(v.p) + ' via the trading account', c.acct, 'limitSellInBook', [state.selected, v.a, v.p, hintsFor(c.d, false, v.p).map((o) => o.id)]]],
    cancel: async (c, v) => [['Cancelling order #' + v.id + ' via the trading account', c.acct, 'cancelInBook', [state.selected, BigInt(v.id)]]],
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
  const ofield = (k, label, unit) => '<label class="ofield"><span>' + label + '</span><input data-k="' + k + '" inputmode="decimal" autocomplete="off" placeholder="0.00"><em' + (unit ? '>' + unit : ' data-unit="token">token') + '</em></label>'
  const orderForm = (id, label, unit, priced) => '<div class="oform" data-a="' + id + '">' + (priced ? ofield('p', 'Limit price', 'mUSDC') : '') + ofield('a', label, unit) + ticks + '<div class="oquote"></div><p class="qwarn why"></p><button class="ogo go ' + (/sell/.test(id) ? 's' : 'b') + '">' + (/sell/.test(id) ? 'Sell' : 'Buy') + ' <span data-unit="token">token</span></button></div>'

  function buildActions(force) {
    const key = state.selected + '|' + (state.signer ? state.account : 'none')
    if (!force && key === state.actionsKey) return updateActions()
    state.actionsKey = key
    $('torder').innerHTML = '<div class="oside" role="group" aria-label="Side"><button class="b" data-side="buy">Buy</button><button class="s" data-side="sell">Sell</button></div>' +
      '<div class="otype" role="group" aria-label="Order type"><button data-otype="market">Market</button><button data-otype="limit">Limit</button></div>' +
      '<div class="oav"><span>Available</span><span id="oav">–</span></div>' + orderForm('swapbuy', 'Spend', 'mUSDC') + orderForm('sell', 'Size', '') +
      orderForm('limitbuy', 'Size', '', true) + orderForm('limitsell', 'Size', '', true) +
      '<div class="oacct"><div class="oh">Account</div><div id="oacct"></div><div data-a="faucet"><button class="oclaim go">Get 100,000 test mUSDC</button><p class="qwarn why"></p></div></div>'
    $('ipo').innerHTML = '<div class="oh">Primary sale</div><div id="ipoStatus"></div>' +
      '<div class="oform" data-a="buy">' + fieldsHtml(ACT.buy) + '<div class="chips">' + ACT.buy.chips.map((c, i) => '<button type="button" class="chip" data-chip="' + i + '">' + c.l + '</button>').join('') +
      '</div><p class="note pre"></p><p class="qwarn why"></p><button class="ogo b go">Buy at $1.00</button></div>' +
      '<div class="oacct"><div class="oh">Account</div><div id="oacct2"></div><div data-a="faucet"><button class="oclaim go">Get 100,000 test mUSDC</button><p class="qwarn why"></p></div>' +
      '<div data-a="close"><button class="btn ghost sm go" style="width:100%">Close the sale, open the market</button><p class="qwarn why"></p></div></div>'
    for (const tab of ['gp', 'govern', 'pf', 'vault']) $('act-' + tab).innerHTML = ACTIONS.filter((x) => x.tab === tab).map((a) => actHtml(a)).join('')
    $('rules').innerHTML = RULES.map((r) => '<div class="light" data-rule="' + r.k + '"><span class="lamp"></span><div class="grow"><div class="t">' + r.t + '</div><div class="d">' + r.p +
      '</div><div class="st"></div>' + (r.act ? actHtml(ACT[r.act], { inline: true }) : '') + '</div></div>').join('')
    updateActions()
  }

  function available() { const m = state.me; return !m ? 0n : state.side === 'buy' ? m.usdc : m.token }
  function updateActions() {
    const d = state.detail, m = state.me
    document.querySelectorAll('#torder .oside button').forEach((b) => b.classList.toggle('on', b.dataset.side === state.side))
    document.querySelectorAll('#torder .otype button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.otype === state.otype)))
    for (const row of document.querySelectorAll('[data-a]')) {
      const a = ACT[row.dataset.a]
      if (!a) continue
      let why = '', soft = false
      if (!d) { why = 'Loading…'; soft = true }
      else if (!state.signer) { why = a.why(d, null); if (!why) { why = 'Connect a wallet on ' + CFG.network + ' to send this.'; soft = true } }
      else why = (tkOn() && !SESSION_ONLY[a.id] && !SESSION_DIRECT[a.id] ? 'The session key can only trade: switch to MetaMask for this.' : '') ||
        (a.gp && m && !m.isGP ? 'Only the GP of this sub-fund can do this.' : '') || a.why(d, m)
      if (a.term) row.hidden = a.term !== state.side || (a.otype || 'market') !== state.otype
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
        const html = m ? '<div class="qrow"><span>mUSDC</span><span>' + amt(m.usdc) + '</span></div><div class="qrow"><span>' + esc(d.symbol) + '</span><span>' + amt(m.token) + '</span></div><div class="qrow"><span>Value at market price</span><span>$' +
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
      book: new E.Contract(f.book, ABI.book, s), vesting: new E.Contract(f.vesting, ABI.vesting, s),
      usdc: new E.Contract(CFG.usdc, ABI.erc20, s),
      vault: curV() ? new E.Contract(curV().addr, ABI.vault, s) : null, vf: CFG.vaults ? new E.Contract(CFG.vaults, ABI.vaults, s) : null,
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
    renderFunds(); renderKpis(); renderRules(); renderReports(); renderPortfolio(); renderVaults(); renderGovern()
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
    const vRow = t.closest('[data-vault]'); if (vRow && !t.closest('a')) { state.vsel = Number(vRow.dataset.vault); renderVaults(); updateActions(); renderStrat(); return }
    const stB = t.closest('[data-st]'); if (stB) { stAction(stB.dataset.st, stB); return }
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
    const ot = t.closest('[data-otype]'); if (ot) { state.otype = ot.dataset.otype; prefillLimit(); updateActions(); return }
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
      if (c.get) input.value = c.get()
      else if (c.v) input.value = c.v
      else if (m) input.value = E.formatUnits(((c.of === 'usdc' ? m.usdc : m.token) * BigInt(c.pct)) / 100n, D)
      updateActions()
      return
    }
    if (t.closest('.go')) runAction(a, row)
  })
  // A limit form opens with the market price in its price field, as a starting point.
  function prefillLimit() {
    const d = state.detail
    if (!d || !d.marketPrice) return
    document.querySelectorAll('#torder [data-k="p"]').forEach((inp) => { if (!inp.value) inp.value = num(d.marketPrice).toFixed(4) })
  }
  function setPct(row, p) {
    let av = available()
    if (row.dataset.a === 'limitbuy') {
      // a limit buy is sized in tokens: what the available mUSDC buys at the limit price, fee included
      prefillLimit()
      let price = 0n
      try { price = E.parseUnits(row.querySelector('[data-k="p"]').value.trim() || '0', D) } catch (e) { price = 0n }
      av = price > 0n ? (((av * 10000n) / (10000n + BOOK_FEE_BPS)) * U6) / price : 0n
    }
    row.querySelector('[data-k="a"]').value = av > 0n && p > 0 ? E.formatUnits((av * BigInt(p)) / 100n, D) : ''
    const r = row.querySelector('.orange'); if (r) r.value = p
    updateActions()
  }
  document.addEventListener('input', (e) => {
    if (e.target.id === 'f-q') { state.fq = e.target.value; PUT('f-list').h = fundList(); return }
    if (e.target.dataset && e.target.dataset.sk) { stInput(e.target); return }
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
