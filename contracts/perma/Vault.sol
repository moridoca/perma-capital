// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IUmbrellaForVault {
    function usdc() external view returns (address);
    function subFunds(uint256 index) external view returns (address);
}

interface ISubFundForVault {
    function token() external view returns (address);
    function book() external view returns (address);
    function navPerToken() external view returns (uint256);
    function marketPrice() external view returns (uint256);
}

interface IBookForVault {
    function buy(uint256 usdcIn, uint256 minTokenOut, uint256[] calldata ids) external returns (uint256 tokenOut, uint256 usdcSpent);
    function sell(uint256 tokenIn, uint256 minUSDCOut, uint256[] calldata ids) external returns (uint256 usdcOut, uint256 tokenSold);
    function limitBuy(uint256 tokenAmount, uint256 price, uint256[] calldata ids) external returns (uint256 id, uint256 filled);
    function limitSell(uint256 tokenAmount, uint256 price, uint256[] calldata ids) external returns (uint256 id, uint256 filled);
    function cancel(uint256 id) external;
    function lastPrice() external view returns (uint256);
    function orders(uint256 id) external view returns (address maker, bool isBuy, uint64 price, uint128 tokens, uint128 cash);
}

interface IERC20ForVault {
    function balanceOf(address) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title Vault: a pool of mUSDC that one leader trades for its depositors
/// @notice Modelled on the user vaults of Hyperliquid, and separate from a
///         sub-fund's own ladder: anyone can open a vault and trade it by any
///         strategy; anyone can deposit and share in the result.
///
///         What the leader can do: trade the vault's money in the order books of
///         this umbrella's sub-funds, with market and limit orders. Nothing else:
///         no transfer out, no other contract, no other token. The leader takes
///         money out the same way as every depositor, by redeeming shares.
///         No fill above NAV +5% on a buy or below NAV -55% on a sell, so one
///         trade against the leader's own order cannot empty the vault.
///
///         Rules, all enforced here:
///           - Two prices per fund token, both read on-chain: the higher of
///             market price and NAV, and the lower of the two. Shares are issued
///             at the higher one, so pushing the market down for one transaction
///             does not make shares cheap. Profit is measured at the lower one,
///             so buying below NAV is no profit until the market pays for it.
///           - Redemptions are paid in kind: the same fraction of the mUSDC and
///             of every fund token the vault holds. No price is needed for that,
///             and the leader cannot block it by staying invested. If the free
///             balances do not cover a redemption, the vault's open orders are
///             cancelled first.
///           - A deposit can be redeemed after LOCK (one day in production).
///           - The leader must own at least 5% of the vault: deposits that would
///             push the leader below that are refused, and so are redemptions by
///             the leader that would.
///           - The leader gets 10% of each depositor's profit, taken in shares
///             when the depositor redeems. No profit, no fee; no management fee.
///           - The leader can close the vault. Then it only pays out.
contract Vault {
    uint256 private constant ONE = 1e6;
    uint256 public constant PROFIT_SHARE_BPS = 1000; // 10% of a depositor's profit
    uint256 public constant LEADER_MIN_BPS = 500;    // leader owns at least 5%
    uint256 public constant MAX_PREMIUM_BPS = 500;   // a buy never fills above NAV +5%
    uint256 public constant MAX_DISCOUNT_BPS = 5500; // a sell never fills below NAV -55% (the ladder ends at -50%)
    uint256 public constant MAX_FUNDS = 6;           // sub-funds one vault can hold
    uint256 public constant MAX_ORDERS = 8;          // resting orders one vault can have

    address public immutable factory;
    IUmbrellaForVault public immutable umbrella;
    IERC20ForVault public immutable usdc;
    address public immutable leader;
    uint256 public immutable LOCK;
    string public name;

    bool public closed;
    uint256 public totalShares;
    mapping(address => uint256) public shares;
    /// @notice Value a depositor paid in for the shares still held (mUSDC); profit is measured against it.
    mapping(address => uint256) public basis;
    mapping(address => uint256) public unlockAt;

    uint256[] private funds; // indices of the sub-funds this vault has traded
    mapping(uint256 => bool) private hasFund;

    struct Resting {
        uint64 fund;
        uint192 id;
    }
    Resting[] private resting;

    bool private locked;

    event Deposited(address indexed who, uint256 usdc, uint256 shares);
    event Redeemed(address indexed who, uint256 shares, uint256 feeShares, uint256 usdc);
    event Traded(uint256 indexed fundIndex, bool buy, uint256 tokens, uint256 usdc);
    event OrderRested(uint256 indexed fundIndex, uint256 id, bool buy, uint256 price, uint256 tokens);
    event OrderRemoved(uint256 indexed fundIndex, uint256 id);
    event Closed();

    modifier nonReentrant() {
        require(!locked, "Vault: reentrant");
        locked = true;
        _;
        locked = false;
    }

    modifier onlyLeader() {
        require(msg.sender == leader, "Vault: only the leader");
        require(!closed, "Vault: closed");
        _;
    }

    constructor(address umbrella_, address leader_, string memory name_, uint256 lockSeconds) {
        factory = msg.sender;
        umbrella = IUmbrellaForVault(umbrella_);
        usdc = IERC20ForVault(IUmbrellaForVault(umbrella_).usdc());
        leader = leader_;
        name = name_;
        LOCK = lockSeconds;
    }

    // ------------------------------------------------------------------
    // Value
    // ------------------------------------------------------------------

    /// @notice Price at which a fund token counts: the higher of market price and
    ///         NAV when shares are issued, the lower of the two everywhere else.
    function tokenPrice(uint256 fundIndex, bool forIssue) public view returns (uint256) {
        ISubFundForVault f = ISubFundForVault(umbrella.subFunds(fundIndex));
        uint256 m = f.marketPrice();
        uint256 n = f.navPerToken();
        return (m > n) == forIssue ? m : n;
    }

    /// @dev mUSDC and tokens of one fund that sit in the vault's resting orders.
    function _escrow(uint256 fundIndex, bool cash) private view returns (uint256 sum) {
        for (uint256 k = 0; k < resting.length; k++) {
            if (!cash && resting[k].fund != fundIndex) continue;
            IBookForVault b = IBookForVault(ISubFundForVault(umbrella.subFunds(resting[k].fund)).book());
            (, bool isBuy, , uint128 tokens, uint128 c) = b.orders(resting[k].id);
            if (cash) {
                if (isBuy) sum += c;
            } else if (!isBuy) {
                sum += tokens;
            }
        }
    }

    /// @notice mUSDC the vault owns: free plus the escrow of its buy orders.
    function cashTotal() public view returns (uint256) {
        return usdc.balanceOf(address(this)) + _escrow(0, true);
    }

    /// @notice Tokens of one sub-fund the vault owns: free plus those in its sell orders.
    function tokensTotal(uint256 fundIndex) public view returns (uint256) {
        IERC20ForVault t = IERC20ForVault(ISubFundForVault(umbrella.subFunds(fundIndex)).token());
        return t.balanceOf(address(this)) + _escrow(fundIndex, false);
    }

    function _value(bool forIssue) private view returns (uint256 v) {
        v = cashTotal();
        for (uint256 k = 0; k < funds.length; k++) {
            v += (tokensTotal(funds[k]) * tokenPrice(funds[k], forIssue)) / ONE;
        }
    }

    /// @notice Everything the vault owns, in mUSDC, tokens at the lower of market and NAV.
    function value() public view returns (uint256) {
        return _value(false);
    }

    /// @notice Value of one share in mUSDC (1.000000 before the first deposit).
    function sharePrice() public view returns (uint256) {
        return totalShares == 0 ? ONE : (_value(false) * ONE) / totalShares;
    }

    /// @notice What a new share costs: tokens at the higher of market and NAV.
    function issuePrice() public view returns (uint256) {
        return totalShares == 0 ? ONE : (_value(true) * ONE + totalShares - 1) / totalShares;
    }

    // ------------------------------------------------------------------
    // Deposits and redemptions
    // ------------------------------------------------------------------

    /// @dev The factory moves the leader's first deposit in before calling this.
    function init(uint256 usdcAmount) external {
        require(msg.sender == factory && totalShares == 0, "Vault: only the factory, once");
        _mint(leader, usdcAmount, usdcAmount);
    }

    /// @notice Pay mUSDC in and get shares at issuePrice().
    function deposit(uint256 usdcAmount, uint256 minShares) external nonReentrant returns (uint256 minted) {
        require(!closed, "Vault: closed");
        require(usdcAmount >= ONE, "Vault: below 1 mUSDC");
        uint256 v = _value(true);
        require(v > 0 && totalShares > 0, "Vault: no value");
        minted = (usdcAmount * totalShares) / v;
        require(minted > 0 && minted >= minShares, "Vault: too few shares");
        require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "Vault: usdc transfer failed");
        _mint(msg.sender, minted, usdcAmount);
        require(shares[leader] * 10_000 >= totalShares * LEADER_MIN_BPS, "Vault: leader below 5%");
    }

    function _mint(address to, uint256 amount, uint256 paid) private {
        shares[to] += amount;
        totalShares += amount;
        basis[to] += paid;
        unlockAt[to] = block.timestamp + LOCK;
        emit Deposited(to, paid, amount);
    }

    /// @notice Give shares back and receive the same fraction of everything the
    ///         vault holds: mUSDC and the tokens of every sub-fund it is in.
    ///         A depositor's profit is shared with the leader first (10%, in shares).
    function redeem(uint256 shareAmount) external nonReentrant returns (uint256 usdcOut) {
        require(shareAmount > 0 && shareAmount <= shares[msg.sender], "Vault: not your shares");
        require(closed || block.timestamp >= unlockAt[msg.sender], "Vault: deposit still locked");

        uint256 part = (basis[msg.sender] * shareAmount) / shares[msg.sender];
        uint256 feeShares = 0;
        if (msg.sender != leader) {
            uint256 worth = (value() * shareAmount) / totalShares;
            if (worth > part) {
                uint256 fee = ((worth - part) * PROFIT_SHARE_BPS) / 10_000;
                feeShares = (shareAmount * fee) / worth;
                basis[leader] += fee;
            }
        }
        basis[msg.sender] -= part;
        shares[msg.sender] -= shareAmount;
        uint256 burned = shareAmount - feeShares;
        if (feeShares > 0) shares[leader] += feeShares;

        // In kind: the fraction burned / totalShares of every asset.
        uint256 supply = totalShares;
        uint256 n = funds.length;
        uint256[] memory owed = new uint256[](n);
        usdcOut = (cashTotal() * burned) / supply;
        bool short = usdcOut > usdc.balanceOf(address(this));
        for (uint256 k = 0; k < n; k++) {
            owed[k] = (tokensTotal(funds[k]) * burned) / supply;
            if (owed[k] > _token(funds[k]).balanceOf(address(this))) short = true;
        }
        if (short) _cancelAll();
        totalShares = supply - burned;

        if (msg.sender == leader && !closed) {
            require(shares[leader] * 10_000 >= totalShares * LEADER_MIN_BPS, "Vault: leader below 5%");
        }
        if (usdcOut > 0) require(usdc.transfer(msg.sender, usdcOut), "Vault: usdc transfer failed");
        for (uint256 k = 0; k < n; k++) {
            if (owed[k] > 0) require(_token(funds[k]).transfer(msg.sender, owed[k]), "Vault: token transfer failed");
        }
        emit Redeemed(msg.sender, shareAmount, feeShares, usdcOut);
    }

    // ------------------------------------------------------------------
    // Trading: the leader, in this umbrella's order books only
    // ------------------------------------------------------------------

    function _fund(uint256 fundIndex) private view returns (ISubFundForVault) {
        return ISubFundForVault(umbrella.subFunds(fundIndex));
    }

    function _token(uint256 fundIndex) private view returns (IERC20ForVault) {
        return IERC20ForVault(_fund(fundIndex).token());
    }

    function _cap(uint256 fundIndex) private view returns (uint256) {
        return (_fund(fundIndex).navPerToken() * (10_000 + MAX_PREMIUM_BPS)) / 10_000;
    }

    function _floor(uint256 fundIndex) private view returns (uint256) {
        return (_fund(fundIndex).navPerToken() * (10_000 - MAX_DISCOUNT_BPS)) / 10_000;
    }

    function _track(uint256 fundIndex) private {
        if (hasFund[fundIndex]) return;
        require(funds.length < MAX_FUNDS, "Vault: too many sub-funds");
        hasFund[fundIndex] = true;
        funds.push(fundIndex);
    }

    function buy(uint256 fundIndex, uint256 usdcIn, uint256 minTokenOut, uint256[] calldata ids)
        external
        onlyLeader
        nonReentrant
        returns (uint256 tokenOut, uint256 spent)
    {
        _track(fundIndex);
        address b = _fund(fundIndex).book();
        uint256 cap = _cap(fundIndex);
        usdc.approve(b, usdcIn);
        (tokenOut, spent) = IBookForVault(b).buy(usdcIn, minTokenOut, ids);
        usdc.approve(b, 0);
        require(IBookForVault(b).lastPrice() <= cap, "Vault: fill above NAV +5%");
        emit Traded(fundIndex, true, tokenOut, spent);
    }

    function sell(uint256 fundIndex, uint256 tokenIn, uint256 minUSDCOut, uint256[] calldata ids)
        external
        onlyLeader
        nonReentrant
        returns (uint256 usdcOut, uint256 sold)
    {
        _track(fundIndex);
        address b = _fund(fundIndex).book();
        IERC20ForVault t = _token(fundIndex);
        uint256 floor = _floor(fundIndex);
        t.approve(b, tokenIn);
        (usdcOut, sold) = IBookForVault(b).sell(tokenIn, minUSDCOut, ids);
        t.approve(b, 0);
        require(IBookForVault(b).lastPrice() >= floor, "Vault: fill below NAV -55%");
        emit Traded(fundIndex, false, sold, usdcOut);
    }

    function limitBuy(uint256 fundIndex, uint256 tokenAmount, uint256 price, uint256[] calldata ids)
        external
        onlyLeader
        nonReentrant
        returns (uint256 id, uint256 filled)
    {
        require(price <= _cap(fundIndex), "Vault: price above NAV +5%");
        _track(fundIndex);
        _prune();
        address b = _fund(fundIndex).book();
        usdc.approve(b, type(uint256).max);
        (id, filled) = IBookForVault(b).limitBuy(tokenAmount, price, ids);
        usdc.approve(b, 0);
        _rested(fundIndex, id, true, price, tokenAmount - filled);
    }

    function limitSell(uint256 fundIndex, uint256 tokenAmount, uint256 price, uint256[] calldata ids)
        external
        onlyLeader
        nonReentrant
        returns (uint256 id, uint256 filled)
    {
        require(price >= _floor(fundIndex), "Vault: price below NAV -55%");
        _track(fundIndex);
        _prune();
        address b = _fund(fundIndex).book();
        IERC20ForVault t = _token(fundIndex);
        t.approve(b, tokenAmount);
        (id, filled) = IBookForVault(b).limitSell(tokenAmount, price, ids);
        t.approve(b, 0);
        _rested(fundIndex, id, false, price, tokenAmount - filled);
    }

    function _rested(uint256 fundIndex, uint256 id, bool isBuy, uint256 price, uint256 tokens) private {
        if (id == type(uint256).max) return;
        require(resting.length < MAX_ORDERS, "Vault: too many open orders");
        resting.push(Resting(uint64(fundIndex), uint192(id)));
        emit OrderRested(fundIndex, id, isBuy, price, tokens);
    }

    function cancel(uint256 fundIndex, uint256 id) external onlyLeader nonReentrant {
        for (uint256 k = 0; k < resting.length; k++) {
            if (resting[k].fund == fundIndex && resting[k].id == id) {
                IBookForVault(_fund(fundIndex).book()).cancel(id);
                resting[k] = resting[resting.length - 1];
                resting.pop();
                emit OrderRemoved(fundIndex, id);
                return;
            }
        }
        revert("Vault: not an open order of this vault");
    }

    /// @dev Forget orders that were filled in the meantime.
    function _prune() private {
        uint256 k = 0;
        while (k < resting.length) {
            IBookForVault b = IBookForVault(_fund(resting[k].fund).book());
            (, , , uint128 tokens, ) = b.orders(resting[k].id);
            if (tokens == 0) {
                emit OrderRemoved(resting[k].fund, resting[k].id);
                resting[k] = resting[resting.length - 1];
                resting.pop();
            } else {
                k++;
            }
        }
    }

    function _cancelAll() private {
        for (uint256 k = resting.length; k > 0; k--) {
            Resting memory r = resting[k - 1];
            IBookForVault b = IBookForVault(_fund(r.fund).book());
            (, , , uint128 tokens, ) = b.orders(r.id);
            if (tokens > 0) b.cancel(r.id);
            resting.pop();
            emit OrderRemoved(r.fund, r.id);
        }
    }

    /// @notice The leader ends the vault: open orders are cancelled, trading and
    ///         deposits stop, everyone redeems without a lock. What the vault
    ///         holds in fund tokens is paid out as tokens.
    function close() external onlyLeader nonReentrant {
        _cancelAll();
        closed = true;
        emit Closed();
    }

    // ------------------------------------------------------------------
    // Views for the dashboard
    // ------------------------------------------------------------------

    function info()
        external
        view
        returns (
            string memory name_,
            address leader_,
            bool closed_,
            uint256 totalShares_,
            uint256 value_,
            uint256 sharePrice_,
            uint256 issuePrice_,
            uint256 cash_,
            uint256 leaderShares_,
            uint256 lock_
        )
    {
        return (name, leader, closed, totalShares, value(), sharePrice(), issuePrice(), cashTotal(), shares[leader], LOCK);
    }

    /// @notice Sub-funds the vault is in: index, tokens owned (free + in sell orders), price they count at.
    function positions() external view returns (uint256[] memory index, uint256[] memory tokens, uint256[] memory prices) {
        uint256 n = funds.length;
        index = new uint256[](n);
        tokens = new uint256[](n);
        prices = new uint256[](n);
        for (uint256 k = 0; k < n; k++) {
            index[k] = funds[k];
            tokens[k] = tokensTotal(funds[k]);
            prices[k] = tokenPrice(funds[k], false);
        }
    }

    /// @notice The vault's resting orders (filled ones may still be listed until the next order).
    function openOrders()
        external
        view
        returns (uint256[] memory fundIndex, uint256[] memory ids, bool[] memory isBuy, uint256[] memory prices, uint256[] memory tokens)
    {
        uint256 n = resting.length;
        fundIndex = new uint256[](n);
        ids = new uint256[](n);
        isBuy = new bool[](n);
        prices = new uint256[](n);
        tokens = new uint256[](n);
        for (uint256 k = 0; k < n; k++) {
            fundIndex[k] = resting[k].fund;
            ids[k] = resting[k].id;
            (, bool b, uint64 p, uint128 t, ) = IBookForVault(_fund(resting[k].fund).book()).orders(resting[k].id);
            isBuy[k] = b;
            prices[k] = p;
            tokens[k] = t;
        }
    }

    /// @notice One depositor: shares, what they are worth, what was paid in, when they unlock.
    function position(address who) external view returns (uint256 shares_, uint256 worth, uint256 paidIn, uint256 unlock) {
        shares_ = shares[who];
        worth = totalShares == 0 ? 0 : (value() * shares_) / totalShares;
        return (shares_, worth, basis[who], unlockAt[who]);
    }
}

/// @title VaultFactory: anyone opens a vault for this umbrella
contract VaultFactory {
    uint256 public constant MIN_FIRST_DEPOSIT = 100e6; // the leader's own money, 100 mUSDC

    address public immutable umbrella;
    uint256 public immutable LOCK; // 86_400 (one day) in production, short in the demo
    Vault[] public vaults;

    event VaultCreated(address indexed vault, address indexed leader, string name);

    constructor(address umbrella_, uint256 lockSeconds) {
        umbrella = umbrella_;
        LOCK = lockSeconds;
    }

    /// @notice Open a vault and become its leader, with a first deposit of your own.
    function create(string calldata name, uint256 usdcAmount) external returns (Vault vault) {
        require(bytes(name).length > 0 && bytes(name).length <= 32, "Vaults: name 1 to 32 characters");
        require(usdcAmount >= MIN_FIRST_DEPOSIT, "Vaults: first deposit below 100 mUSDC");
        vault = new Vault(umbrella, msg.sender, name, LOCK);
        require(
            IERC20ForVault(IUmbrellaForVault(umbrella).usdc()).transferFrom(msg.sender, address(vault), usdcAmount),
            "Vaults: usdc transfer failed"
        );
        vault.init(usdcAmount);
        vaults.push(vault);
        emit VaultCreated(address(vault), msg.sender, name);
    }

    function count() external view returns (uint256) {
        return vaults.length;
    }
}
