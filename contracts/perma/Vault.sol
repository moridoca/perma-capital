// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ERC20.sol";

interface IUmbrellaForVault {
    function usdc() external view returns (address);
    function subFunds(uint256 index) external view returns (address);
}

interface ISubFundForVault {
    function token() external view returns (address);
    function book() external view returns (address);
    function navPerToken() external view returns (uint256);
    function marketPrice() external view returns (uint256);
    function dividendOf(address who) external view returns (uint256);
    function claimDividend(address who) external returns (uint256);
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

/// @title Vault: mUSDC that one leader trades for its depositors
/// @notice Built after the user vaults of Hyperliquid (docs: Vaults, For vault
///         leaders, For vault depositors) and separate from a sub-fund's own
///         ladder: anyone can open a vault and trade it by any strategy; anyone
///         can deposit and share in the result.
///
///         As on Hyperliquid:
///           - opened by anyone with at least 100 mUSDC of their own; name and
///             description are fixed at creation
///           - the leader must own at least 5% of the vault at all times
///           - the leader gets 10% of a depositor's profit, taken when the
///             depositor withdraws; no management fee
///           - a deposit can be withdrawn after LOCK (one day in production)
///           - deposits and withdrawals are in mUSDC. A withdrawal takes the
///             depositor's fraction of the cash; if the free cash does not
///             cover it, open orders are cancelled, and the same fraction of
///             every position is sold at market. The slippage of that sale is
///             the withdrawing depositor's
///           - the leader can let agents trade for the vault
///           - the vault can be closed once all positions are sold
///           - shares are a token (ERC-20), with the ERC-4626 views asset,
///             totalAssets, convertToShares and convertToAssets
///
///         Different, because there is no oracle price here:
///           - new shares are priced with fund tokens at the higher of market
///             price and NAV; value and profit use the lower of the two
///           - what the book does not take in a withdrawal is paid out as tokens
///           - trades fill no higher than NAV +5% and no lower than NAV -55%
contract Vault is ERC20 {
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
    string public description;

    bool public closed;
    /// @notice Addresses the leader lets trade for the vault. They cannot do anything else.
    mapping(address => bool) public agents;
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
    event AgentSet(address indexed agent, bool allowed);

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

    modifier onlyTrader() {
        require(msg.sender == leader || agents[msg.sender], "Vault: only the leader or an agent");
        require(!closed, "Vault: closed");
        _;
    }

    constructor(address umbrella_, address leader_, string memory name_, string memory description_, uint256 lockSeconds)
        ERC20(name_, "VLT")
    {
        factory = msg.sender;
        description = description_;
        umbrella = IUmbrellaForVault(umbrella_);
        usdc = IERC20ForVault(IUmbrellaForVault(umbrella_).usdc());
        leader = leader_;
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

    /// @notice mUSDC the vault owns: free, in the escrow of its buy orders, and
    ///         dividends it has not collected yet.
    function cashTotal() public view returns (uint256 c) {
        c = usdc.balanceOf(address(this)) + _escrow(0, true);
        for (uint256 k = 0; k < funds.length; k++) c += _fund(funds[k]).dividendOf(address(this));
    }

    /// @notice Collects the dividends of the fund tokens the vault holds. Anyone can call it.
    function collectDividends() public {
        for (uint256 k = 0; k < funds.length; k++) {
            ISubFundForVault f = _fund(funds[k]);
            if (f.dividendOf(address(this)) > 0) f.claimDividend(address(this));
        }
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
        return totalSupply == 0 ? ONE : (_value(false) * ONE) / totalSupply;
    }

    /// @notice What a new share costs: tokens at the higher of market and NAV.
    function issuePrice() public view returns (uint256) {
        return totalSupply == 0 ? ONE : (_value(true) * ONE + totalSupply - 1) / totalSupply;
    }

    // ERC-4626 views
    function asset() external view returns (address) {
        return address(usdc);
    }

    function totalAssets() external view returns (uint256) {
        return _value(false);
    }

    function convertToShares(uint256 assets) external view returns (uint256) {
        return (assets * ONE) / issuePrice();
    }

    function convertToAssets(uint256 shareAmount) external view returns (uint256) {
        return (shareAmount * sharePrice()) / ONE;
    }

    // ------------------------------------------------------------------
    // Deposits and redemptions
    // ------------------------------------------------------------------

    /// @dev The factory moves the leader's first deposit in before calling this.
    function init(uint256 usdcAmount) external {
        require(msg.sender == factory && totalSupply == 0, "Vault: only the factory, once");
        _issue(leader, usdcAmount, usdcAmount);
    }

    /// @notice Pay mUSDC in and get shares at issuePrice().
    function deposit(uint256 usdcAmount, uint256 minShares) external nonReentrant returns (uint256 minted) {
        require(!closed, "Vault: closed");
        require(usdcAmount >= ONE, "Vault: below 1 mUSDC");
        collectDividends();
        uint256 v = _value(true);
        require(v > 0 && totalSupply > 0, "Vault: no value");
        minted = (usdcAmount * totalSupply) / v;
        require(minted > 0 && minted >= minShares, "Vault: too few shares");
        require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "Vault: usdc transfer failed");
        _issue(msg.sender, minted, usdcAmount);
        require(balanceOf[leader] * 10_000 >= totalSupply * LEADER_MIN_BPS, "Vault: leader below 5%");
    }

    function _issue(address to, uint256 amount, uint256 paid) private {
        _mint(to, amount);
        basis[to] += paid;
        unlockAt[to] = block.timestamp + LOCK;
        emit Deposited(to, paid, amount);
    }

    /// @dev Shares can be passed on. What was paid for them and their lock go with
    ///      them; the leader's shares stay with the leader while the vault is open.
    function _beforeMove(address from, address to, uint256 amount) internal override {
        if (from == address(0) || to == address(0) || from == to) return;
        require(from != leader || closed, "Vault: the leader's shares are not transferable");
        uint256 part = (basis[from] * amount) / balanceOf[from];
        basis[from] -= part;
        basis[to] += part;
        if (unlockAt[from] > unlockAt[to]) unlockAt[to] = unlockAt[from];
    }

    /// @notice Withdraw: give shares back and receive mUSDC. You get your fraction of
    ///         the vault's cash, and the same fraction of every position is sold at
    ///         market for you. Open orders are cancelled only if the free balances
    ///         do not cover it. What the book does not take comes as tokens.
    ///         A depositor's profit is shared with the leader first (10%, in shares).
    /// @param ids Per sub-fund the vault is in (order of positions()): resting buy
    ///        orders to sell into, best first. May be empty: then only the ladders bid.
    function redeem(uint256 shareAmount, uint256 minUsdcOut, uint256[][] calldata ids)
        external
        nonReentrant
        returns (uint256 usdcOut)
    {
        require(shareAmount > 0 && shareAmount <= balanceOf[msg.sender], "Vault: not your shares");
        require(closed || block.timestamp >= unlockAt[msg.sender], "Vault: deposit still locked");
        collectDividends();

        uint256 supply = totalSupply;
        uint256 burned = shareAmount;
        {
            uint256 part = (basis[msg.sender] * shareAmount) / balanceOf[msg.sender];
            uint256 feeShares = 0;
            if (msg.sender != leader) {
                uint256 worth = (_value(false) * shareAmount) / supply;
                if (worth > part) {
                    uint256 fee = ((worth - part) * PROFIT_SHARE_BPS) / 10_000;
                    feeShares = (shareAmount * fee) / worth;
                    basis[leader] += fee;
                }
            }
            basis[msg.sender] -= part;
            burned = shareAmount - feeShares;
            if (feeShares > 0) {
                balanceOf[msg.sender] -= feeShares;
                balanceOf[leader] += feeShares;
                emit Transfer(msg.sender, leader, feeShares);
            }
            emit Redeemed(msg.sender, shareAmount, feeShares, 0);
        }

        // The fraction burned / supply of every asset.
        uint256 n = funds.length;
        uint256[] memory owed = new uint256[](n);
        usdcOut = (cashTotal() * burned) / supply;
        bool short = usdcOut > usdc.balanceOf(address(this));
        for (uint256 k = 0; k < n; k++) {
            owed[k] = (tokensTotal(funds[k]) * burned) / supply;
            if (owed[k] > _token(funds[k]).balanceOf(address(this))) short = true;
        }
        if (short) _cancelAll();
        _burn(msg.sender, burned);
        if (msg.sender == leader && !closed) {
            require(balanceOf[leader] * 10_000 >= totalSupply * LEADER_MIN_BPS, "Vault: leader below 5%");
        }

        // Sell the positions' part at market; what is not taken goes out as tokens.
        for (uint256 k = 0; k < n; k++) {
            if (owed[k] == 0) continue;
            IERC20ForVault t = _token(funds[k]);
            address b = _fund(funds[k]).book();
            uint256 sold = 0;
            t.approve(b, owed[k]);
            try IBookForVault(b).sell(owed[k], 0, k < ids.length ? ids[k] : new uint256[](0)) returns (uint256 got, uint256 s) {
                usdcOut += got;
                sold = s;
            } catch {}
            t.approve(b, 0);
            if (owed[k] > sold) require(t.transfer(msg.sender, owed[k] - sold), "Vault: token transfer failed");
        }
        require(usdcOut >= minUsdcOut, "Vault: less mUSDC than asked for");
        if (usdcOut > 0) require(usdc.transfer(msg.sender, usdcOut), "Vault: usdc transfer failed");
    }

    /// @notice The leader lets another address trade for the vault, or ends that.
    function setAgent(address agent, bool allowed) external onlyLeader {
        agents[agent] = allowed;
        emit AgentSet(agent, allowed);
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
        onlyTrader
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
        onlyTrader
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
        onlyTrader
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
        onlyTrader
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

    function cancel(uint256 fundIndex, uint256 id) external onlyTrader nonReentrant {
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

    /// @notice The leader ends the vault once every position is sold: open orders
    ///         are cancelled, trading and deposits stop, everyone withdraws their
    ///         share of the cash without a lock.
    function close() external onlyLeader nonReentrant {
        _cancelAll();
        for (uint256 k = 0; k < funds.length; k++) require(tokensTotal(funds[k]) < ONE, "Vault: sell all positions first");
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
            string memory description_,
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
        return (name, description, leader, closed, totalSupply, value(), sharePrice(), issuePrice(), cashTotal(), balanceOf[leader], LOCK);
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
        shares_ = balanceOf[who];
        worth = totalSupply == 0 ? 0 : (value() * shares_) / totalSupply;
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
    function create(string calldata name, string calldata description, uint256 usdcAmount) external returns (Vault vault) {
        require(bytes(name).length > 0 && bytes(name).length <= 32, "Vaults: name 1 to 32 characters");
        require(bytes(description).length <= 140, "Vaults: description up to 140 characters");
        require(usdcAmount >= MIN_FIRST_DEPOSIT, "Vaults: first deposit below 100 mUSDC");
        vault = new Vault(umbrella, msg.sender, name, description, LOCK);
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
