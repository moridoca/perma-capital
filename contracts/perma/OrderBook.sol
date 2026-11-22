// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface INavSource {
    function navPerToken() external view returns (uint256);
}

/// @title OrderBook - the secondary market of one sub-fund
/// @notice An order book with two kinds of liquidity:
///
///         1. The fund's own ladder. The fund-owned liquidity sits on 20 rungs
///            in equal steps of 1% of NAV: bids from NAV -1% down to NAV -10%,
///            asks from NAV +1% up to NAV +10%. The rung prices are computed
///            from the fund's live NAV, so the ladder moves with NAV and never
///            has to be re-quoted. A rung that sold tokens holds the cash and
///            buys them back at the same price, and the other way round: inside
///            the band the price is found by trading, and the fund earns the
///            taker fee, not a spread.
///
///         2. Limit orders of holders, at any price they choose. They rest in
///            the book until someone takes them or the maker cancels.
///
///         Whoever takes liquidity pays 0.07% to the fund; resting orders pay
///         nothing. A taker names the resting orders it wants to trade against
///         (best price first); the book takes the better price at every step,
///         order or rung.
contract OrderBook {
    uint256 public constant LEVELS = 10;        // rungs on each side of NAV
    uint256 public constant STEP_BPS = 100;     // one rung = 1% of NAV
    uint256 public constant TAKER_FEE_BPS = 7;  // 0.07%, paid in mUSDC to the fund
    uint256 public constant MIN_ORDER = 1e6;    // smallest resting order: 1 token

    uint256 private constant ONE = 1e6;
    uint256 private constant BPS = 10_000;
    uint256 private constant RUNGS = 2 * LEVELS;
    uint256 private constant NO_CAP = type(uint128).max;

    IERC20Like public immutable token;
    IERC20Like public immutable usdc;
    address public immutable fund;

    /// @dev Rung 0 is NAV -10%, rung 9 is NAV -1%, rung 10 is NAV +1%, rung 19 is NAV +10%.
    struct Rung {
        uint128 tokens; // offered at the rung price
        uint128 cash;   // bids at the rung price
    }

    struct Order {
        address maker;
        bool isBuy;
        uint64 price;   // mUSDC per token, 6 decimals
        uint128 tokens; // still open; 0 = filled or cancelled
        uint128 cash;   // buy orders: mUSDC still in escrow
    }

    Rung[RUNGS] private rungs;
    uint128 private fundTokens;
    uint128 private fundCash;
    bool public seeded;

    Order[] public orders;
    uint256[] private openIds;
    mapping(uint256 => uint256) private openSlot; // 1-based position in openIds

    /// @notice Price of the most recent fill.
    uint256 public lastPrice;

    bool private locked;

    event Seeded(uint256 tokens, uint256 usdc);
    event Trade(address indexed trader, bool usdcForToken, uint256 amountIn, uint256 amountOut, uint256 priceAfter);
    event OrderPlaced(uint256 indexed id, address indexed maker, bool isBuy, uint256 price, uint256 tokens);
    event OrderFilled(uint256 indexed id, address indexed taker, uint256 tokens, uint256 usdc);
    event OrderCancelled(uint256 indexed id);

    modifier nonReentrant() {
        require(!locked, "Book: reentrancy");
        locked = true;
        _;
        locked = false;
    }

    constructor(address token_, address usdc_, address fund_) {
        token = IERC20Like(token_);
        usdc = IERC20Like(usdc_);
        fund = fund_;
    }

    // ------------------------------------------------------------------
    // The fund's ladder
    // ------------------------------------------------------------------

    /// @notice The fund places its liquidity once, when the sale closes: the
    ///         tokens in equal parts on the ten ask rungs, the cash in equal
    ///         parts on the ten bid rungs. There is no function to take it out.
    function seed(uint256 tokenAmount, uint256 usdcAmount) external nonReentrant {
        require(msg.sender == fund, "Book: only the fund");
        require(!seeded, "Book: already seeded");
        require(tokenAmount >= LEVELS && usdcAmount >= LEVELS, "Book: zero amount");
        seeded = true;
        uint256 t = tokenAmount / LEVELS;
        uint256 c = usdcAmount / LEVELS;
        for (uint256 k = 0; k < LEVELS; k++) {
            rungs[LEVELS + k].tokens = uint128(t);
            rungs[k].cash = uint128(c);
        }
        // what the division leaves over goes to the rungs next to NAV
        rungs[LEVELS].tokens += uint128(tokenAmount - t * LEVELS);
        rungs[LEVELS - 1].cash += uint128(usdcAmount - c * LEVELS);
        fundTokens = uint128(tokenAmount);
        fundCash = uint128(usdcAmount);
        require(token.transferFrom(msg.sender, address(this), tokenAmount), "Book: token transfer failed");
        require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "Book: usdc transfer failed");
        emit Seeded(tokenAmount, usdcAmount);
    }

    /// @notice What the fund owns in this book: (tokens, mUSDC). Escrow of holders' orders is not included.
    function inventory() external view returns (uint256 tokens, uint256 cash) {
        return (fundTokens, fundCash);
    }

    function _nav() private view returns (uint256) {
        return seeded ? INavSource(fund).navPerToken() : 0;
    }

    function _price(uint256 nav, uint256 i) private pure returns (uint256) {
        return i < LEVELS
            ? (nav * (BPS - (LEVELS - i) * STEP_BPS)) / BPS
            : (nav * (BPS + (i - LEVELS + 1) * STEP_BPS)) / BPS;
    }

    /// @notice The ladder as it stands: NAV, and per rung its price, the tokens it offers and the cash it bids.
    function ladder()
        external
        view
        returns (uint256 nav, uint256[] memory prices, uint256[] memory tokens, uint256[] memory cash)
    {
        nav = _nav();
        prices = new uint256[](RUNGS);
        tokens = new uint256[](RUNGS);
        cash = new uint256[](RUNGS);
        for (uint256 i = 0; i < RUNGS; i++) {
            prices[i] = _price(nav, i);
            tokens[i] = rungs[i].tokens;
            cash[i] = rungs[i].cash;
        }
    }

    /// @notice The ladder's price: the middle between its best bid and best ask.
    ///         Holders' orders do not count, so nobody can move this number by
    ///         posting an order; it only moves when the ladder trades or NAV changes.
    ///         At the edge of the band it is the edge price.
    function spotPrice() public view returns (uint256) {
        uint256 nav = _nav();
        if (nav == 0) return 0;
        uint256 ask;
        uint256 bid;
        for (uint256 i = 0; i < RUNGS; i++) {
            if (rungs[i].tokens > 0) { ask = _price(nav, i); break; }
        }
        for (uint256 i = RUNGS; i > 0; i--) {
            uint256 p = _price(nav, i - 1);
            if (_bidSize(rungs[i - 1].cash, p) > 0) { bid = p; break; }
        }
        if (ask == 0) return bid;
        if (bid == 0) return ask;
        return (ask + bid) / 2;
    }

    // ------------------------------------------------------------------
    // Matching
    // ------------------------------------------------------------------

    struct Match {
        Rung[] rung;    // the ladder after the trade
        uint256[] fill; // tokens taken from each named order
        uint256 tokens; // tokens traded
        uint256 cash;   // mUSDC traded, before the taker fee
        uint256 last;   // price of the last fill
    }

    struct Cursor {
        uint256 nav;
        uint256 i;      // ladder position: buys walk up from rung 0, sells walk down from the top
        uint256 j;      // next named order
        uint256 prevPrice;
        uint256 prevId;
        uint256 maxTokens;
        uint256 maxCash;
        uint256 limit;
    }

    /// @dev Works out a trade without changing anything. `buying` = the taker buys tokens.
    function _match(bool buying, uint256 maxTokens, uint256 maxCash, uint256 limit, uint256[] memory ids)
        private
        view
        returns (Match memory m)
    {
        require(seeded, "Book: market not open");
        Cursor memory c = Cursor(_nav(), buying ? 0 : RUNGS, 0, 0, 0, maxTokens, maxCash, limit);
        m.rung = new Rung[](RUNGS);
        for (uint256 n = 0; n < RUNGS; n++) m.rung[n] = rungs[n];
        m.fill = new uint256[](ids.length);
        while (m.tokens < maxTokens && _step(buying, m, c, ids)) {}
    }

    /// @dev One fill: from the better of the next rung and the next named order.
    function _step(bool buying, Match memory m, Cursor memory c, uint256[] memory ids) private view returns (bool) {
        (uint256 rungPrice, uint256 rungAvail) = _nextRung(buying, m.rung, c);
        (uint256 orderPrice, uint256 orderAvail) = _nextOrder(buying, c, ids);
        if (rungAvail == 0 && orderAvail == 0) return false;

        // at the same price a holder's order goes first
        bool useOrder = orderAvail > 0 && (rungAvail == 0 || (buying ? orderPrice <= rungPrice : orderPrice >= rungPrice));
        uint256 p = useOrder ? orderPrice : rungPrice;
        if (buying ? p > c.limit : p < c.limit) return false;

        uint256 q = useOrder ? orderAvail : rungAvail;
        if (q > c.maxTokens - m.tokens) q = c.maxTokens - m.tokens;
        uint256 cash;
        if (buying) {
            uint256 afford = ((c.maxCash - m.cash) * ONE) / p;
            if (q > afford) q = afford;
            if (q == 0) return false;
            cash = (q * p + ONE - 1) / ONE; // rounded up: in favour of the seller
        } else {
            cash = (q * p) / ONE;           // rounded down: in favour of the buyer
            if (cash == 0) return false;
        }
        m.tokens += q;
        m.cash += cash;
        m.last = p;

        if (useOrder) {
            m.fill[c.j] = q;
            c.prevPrice = orderPrice;
            c.prevId = ids[c.j];
            c.j++;
        } else if (buying) {
            m.rung[c.i].tokens -= uint128(q);
            m.rung[c.i].cash += uint128(cash);
        } else {
            m.rung[c.i - 1].cash -= uint128(cash);
            m.rung[c.i - 1].tokens += uint128(q);
        }
        return true;
    }

    function _nextRung(bool buying, Rung[] memory r, Cursor memory c) private pure returns (uint256 price, uint256 avail) {
        if (buying) {
            for (; c.i < RUNGS; c.i++) {
                if (r[c.i].tokens == 0) continue;
                price = _price(c.nav, c.i);
                if (price > 0) return (price, r[c.i].tokens);
            }
        } else {
            for (; c.i > 0; c.i--) {
                price = _price(c.nav, c.i - 1);
                avail = _bidSize(r[c.i - 1].cash, price);
                if (avail > 0) return (price, avail);
            }
        }
        return (0, 0);
    }

    /// @dev Named orders must be on the other side, best price first, and none twice.
    ///      Orders that are already filled or cancelled are skipped.
    function _nextOrder(bool buying, Cursor memory c, uint256[] memory ids) private view returns (uint256 price, uint256 avail) {
        for (; c.j < ids.length; c.j++) {
            uint256 id = ids[c.j];
            Order storage o = orders[id];
            require(o.isBuy != buying, "Book: order on the wrong side");
            price = o.price;
            require(
                c.j == 0 || (buying ? price > c.prevPrice : price < c.prevPrice) || (price == c.prevPrice && id > c.prevId),
                "Book: orders not sorted"
            );
            // a buy order whose remainder is worth less than one unit of mUSDC cannot be sold into
            if (o.tokens > 0 && (buying || (uint256(o.tokens) * price) / ONE > 0)) return (price, o.tokens);
            c.prevPrice = price;
            c.prevId = id;
        }
        return (0, 0);
    }

    /// @dev Tokens a rung can buy with its cash. Cash too small to pay for anything counts as none.
    function _bidSize(uint256 cash, uint256 price) private pure returns (uint256 size) {
        if (price == 0) return 0;
        size = (cash * ONE) / price;
        if ((size * price) / ONE == 0) return 0;
    }

    function _fee(uint256 cash) private pure returns (uint256) {
        return (cash * TAKER_FEE_BPS + BPS - 1) / BPS;
    }

    /// @dev Writes a worked-out trade: the ladder, the makers, the taker, the fee.
    function _settle(bool buying, Match memory m, uint256[] memory ids) private returns (uint256 fee) {
        fee = _fee(m.cash);
        if (buying) {
            require(usdc.transferFrom(msg.sender, address(this), m.cash + fee), "Book: usdc transfer failed");
        } else {
            require(token.transferFrom(msg.sender, address(this), m.tokens), "Book: token transfer failed");
        }

        uint256 t;
        uint256 c;
        for (uint256 n = 0; n < RUNGS; n++) {
            rungs[n] = m.rung[n];
            t += m.rung[n].tokens;
            c += m.rung[n].cash;
        }
        fundTokens = uint128(t);
        fundCash = uint128(c);

        for (uint256 k = 0; k < ids.length; k++) {
            uint256 q = m.fill[k];
            if (q == 0) continue;
            Order storage o = orders[ids[k]];
            uint256 paid;
            o.tokens -= uint128(q);
            if (buying) {
                // taker buys from a sell order: the maker gets the cash
                paid = (q * o.price + ONE - 1) / ONE;
                require(usdc.transfer(o.maker, paid), "Book: usdc transfer failed");
            } else {
                // taker sells into a buy order: the maker gets the tokens, paid from its escrow
                paid = (q * o.price) / ONE;
                o.cash -= uint128(paid);
                require(token.transfer(o.maker, q), "Book: token transfer failed");
            }
            emit OrderFilled(ids[k], msg.sender, q, paid);
            if (o.tokens == 0) _close(ids[k], o);
        }

        if (fee > 0) require(usdc.transfer(fund, fee), "Book: fee transfer failed");
        if (buying) {
            require(token.transfer(msg.sender, m.tokens), "Book: token transfer failed");
        } else {
            require(usdc.transfer(msg.sender, m.cash - fee), "Book: usdc transfer failed");
        }
        lastPrice = m.last;
        emit Trade(msg.sender, buying, buying ? m.cash + fee : m.tokens, buying ? m.tokens : m.cash - fee, spotPrice());
    }

    // ------------------------------------------------------------------
    // Market orders
    // ------------------------------------------------------------------

    /// @notice Buy tokens for at most `usdcIn` (fee included), at whatever the book offers.
    /// @param ids Resting sell orders to trade against, cheapest first. May be empty: then only the ladder trades.
    /// @return tokenOut Tokens received.
    /// @return usdcSpent mUSDC paid, fee included. Anything not spent stays with the caller.
    function buy(uint256 usdcIn, uint256 minTokenOut, uint256[] calldata ids)
        external
        nonReentrant
        returns (uint256 tokenOut, uint256 usdcSpent)
    {
        Match memory m = _match(true, NO_CAP, (usdcIn * BPS) / (BPS + TAKER_FEE_BPS), type(uint256).max, ids);
        require(m.tokens > 0, "Book: nothing to buy");
        require(m.tokens >= minTokenOut, "Book: slippage");
        return (m.tokens, m.cash + _settle(true, m, ids));
    }

    /// @notice Sell up to `tokenIn` tokens at whatever the book bids.
    /// @param ids Resting buy orders to trade against, highest first. May be empty: then only the ladder trades.
    /// @return usdcOut mUSDC received, after the fee.
    /// @return tokenSold Tokens sold. If the book cannot take everything, the rest stays with the caller.
    function sell(uint256 tokenIn, uint256 minUSDCOut, uint256[] calldata ids)
        external
        nonReentrant
        returns (uint256 usdcOut, uint256 tokenSold)
    {
        Match memory m = _match(false, tokenIn, NO_CAP, 0, ids);
        require(m.tokens > 0, "Book: nothing to sell into");
        require(m.cash - _fee(m.cash) >= minUSDCOut, "Book: slippage");
        return (m.cash - _settle(false, m, ids), m.tokens);
    }

    /// @notice What buy(usdcIn, ., ids) would do right now.
    function quoteBuy(uint256 usdcIn, uint256[] calldata ids)
        external
        view
        returns (uint256 tokenOut, uint256 usdcSpent, uint256 priceAtEnd)
    {
        Match memory m = _match(true, NO_CAP, (usdcIn * BPS) / (BPS + TAKER_FEE_BPS), type(uint256).max, ids);
        return (m.tokens, m.cash + _fee(m.cash), m.last);
    }

    /// @notice What sell(tokenIn, ., ids) would do right now.
    function quoteSell(uint256 tokenIn, uint256[] calldata ids)
        external
        view
        returns (uint256 usdcOut, uint256 tokenSold, uint256 priceAtEnd)
    {
        Match memory m = _match(false, tokenIn, NO_CAP, 0, ids);
        return (m.cash - _fee(m.cash), m.tokens, m.last);
    }

    // ------------------------------------------------------------------
    // Limit orders
    // ------------------------------------------------------------------

    /// @notice Buy `tokenAmount` at `price` or better. Whatever the book offers at
    ///         or below the price is bought at once (as a taker, with the fee);
    ///         the rest waits in the book as a buy order, with its mUSDC in escrow.
    /// @return id The resting order, or type(uint256).max if nothing is left to rest.
    /// @return filled Tokens bought at once.
    function limitBuy(uint256 tokenAmount, uint256 price, uint256[] calldata ids)
        external
        nonReentrant
        returns (uint256 id, uint256 filled)
    {
        _checkOrder(tokenAmount, price);
        Match memory m = _match(true, tokenAmount, NO_CAP, price, ids);
        if (m.tokens > 0) _settle(true, m, ids);
        filled = m.tokens;
        id = type(uint256).max;
        uint256 rest = tokenAmount - filled;
        if (rest >= MIN_ORDER) {
            uint256 escrow = (rest * price + ONE - 1) / ONE;
            require(usdc.transferFrom(msg.sender, address(this), escrow), "Book: usdc transfer failed");
            id = _rest(true, price, rest, escrow);
        }
    }

    /// @notice Sell `tokenAmount` at `price` or better. Whatever the book bids at
    ///         or above the price is sold at once (as a taker, with the fee);
    ///         the rest waits in the book as a sell order, with its tokens in escrow.
    function limitSell(uint256 tokenAmount, uint256 price, uint256[] calldata ids)
        external
        nonReentrant
        returns (uint256 id, uint256 filled)
    {
        _checkOrder(tokenAmount, price);
        Match memory m = _match(false, tokenAmount, NO_CAP, price, ids);
        if (m.tokens > 0) _settle(false, m, ids);
        filled = m.tokens;
        id = type(uint256).max;
        uint256 rest = tokenAmount - filled;
        if (rest >= MIN_ORDER) {
            require(token.transferFrom(msg.sender, address(this), rest), "Book: token transfer failed");
            id = _rest(false, price, rest, 0);
        }
    }

    /// @notice Take an order out of the book. Only its maker can; the escrow goes back to the maker.
    function cancel(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        require(o.maker == msg.sender, "Book: not your order");
        require(o.tokens > 0, "Book: order not open");
        uint256 tokens = o.tokens;
        o.tokens = 0;
        if (!o.isBuy) require(token.transfer(msg.sender, tokens), "Book: token transfer failed");
        emit OrderCancelled(id);
        _close(id, o);
    }

    function _checkOrder(uint256 tokenAmount, uint256 price) private pure {
        require(tokenAmount >= MIN_ORDER, "Book: order below 1 token");
        require(price > 0 && price <= type(uint64).max, "Book: bad price");
    }

    function _rest(bool isBuy, uint256 price, uint256 tokens, uint256 escrow) private returns (uint256 id) {
        id = orders.length;
        orders.push(Order(msg.sender, isBuy, uint64(price), uint128(tokens), uint128(escrow)));
        openIds.push(id);
        openSlot[id] = openIds.length;
        emit OrderPlaced(id, msg.sender, isBuy, price, tokens);
    }

    /// @dev Removes a finished order from the open list and returns what is left of a buy order's escrow.
    function _close(uint256 id, Order storage o) private {
        uint256 left = o.cash;
        if (left > 0) {
            o.cash = 0;
            require(usdc.transfer(o.maker, left), "Book: usdc transfer failed");
        }
        uint256 slot = openSlot[id];
        uint256 lastId = openIds[openIds.length - 1];
        openIds[slot - 1] = lastId;
        openSlot[lastId] = slot;
        openIds.pop();
        delete openSlot[id];
    }

    function orderCount() external view returns (uint256) {
        return orders.length;
    }

    /// @notice Every order that is still open.
    function openOrders()
        external
        view
        returns (
            uint256[] memory ids,
            address[] memory makers,
            bool[] memory isBuy,
            uint256[] memory prices,
            uint256[] memory tokens
        )
    {
        uint256 n = openIds.length;
        ids = new uint256[](n);
        makers = new address[](n);
        isBuy = new bool[](n);
        prices = new uint256[](n);
        tokens = new uint256[](n);
        for (uint256 k = 0; k < n; k++) {
            Order storage o = orders[openIds[k]];
            ids[k] = openIds[k];
            makers[k] = o.maker;
            isBuy[k] = o.isBuy;
            prices[k] = o.price;
            tokens[k] = o.tokens;
        }
    }
}
