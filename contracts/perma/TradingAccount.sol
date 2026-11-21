// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IUmbrellaForAccount {
    function usdc() external view returns (address);
    function subFunds(uint256 index) external view returns (address);
}

interface ISubFundForAccount {
    function token() external view returns (address);
    function pool() external view returns (address);
    function navPerToken() external view returns (uint256);
    function buy(uint256 tokenAmount) external;
}

interface IPoolForAccount {
    function swapUSDCForToken(uint256 usdcIn, uint256 minTokenOut) external returns (uint256);
    function swapTokenForUSDC(uint256 tokenIn, uint256 minUSDCOut) external returns (uint256);
}

interface IERC20ForAccount {
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
}

/// @title Trading account with session keys
/// @notice A smart-contract account that holds an investor's mUSDC and fund tokens.
///         The owner (the investor's normal wallet) can let a session key trade for it,
///         so orders go out without a wallet pop-up, like an agent key on Hyperliquid.
///
///         What a session key can do:
///           - buy and sell in the pools of this umbrella's sub-funds, and buy in a
///             primary sale - nothing else, no other contract, no other token
///           - only until its expiry (at most 30 days ahead)
///           - only up to a volume cap in mUSDC (buys at cost, sells at NAV)
///           - only at prices the owner allows: buys at most maxPremiumBps above NAV,
///             sells at least maxDiscountBps below NAV, checked after the trade
///           - send funds back to the owner, never to anyone else
///
///         A stolen session key can therefore lose at most what bad trades within
///         these limits lose. It can never withdraw. The owner can revoke it at any time.
contract TradingAccount {
    uint256 private constant ONE = 1e6;
    uint256 public constant MAX_SESSION = 30 days;

    address public immutable owner;
    IUmbrellaForAccount public immutable umbrella;
    IERC20ForAccount public immutable usdc;

    struct Session {
        uint64 expiry;
        uint16 maxPremiumBps;
        uint16 maxDiscountBps;
        uint128 volumeCap;
        uint128 volumeUsed;
    }

    mapping(address => Session) public sessions;
    bool private locked;

    event SessionStarted(address indexed key, uint64 expiry, uint128 volumeCap, uint16 maxPremiumBps, uint16 maxDiscountBps);
    event SessionEnded(address indexed key, address by);
    event Traded(address indexed by, uint256 indexed fundIndex, bool buy, uint256 usdcAmount, uint256 tokenAmount);
    event Withdrawn(address indexed token, uint256 amount, address by);

    modifier onlyOwner() {
        require(msg.sender == owner, "Account: only owner");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "Account: busy");
        locked = true;
        _;
        locked = false;
    }

    /// @dev Deployed by TradingAccountFactory. A first session can be started in the
    ///      same transaction; ETH sent along is passed to the session key for gas.
    constructor(
        address owner_,
        address umbrella_,
        address key,
        uint64 expiry,
        uint128 volumeCap,
        uint16 maxPremiumBps,
        uint16 maxDiscountBps
    ) payable {
        owner = owner_;
        umbrella = IUmbrellaForAccount(umbrella_);
        usdc = IERC20ForAccount(IUmbrellaForAccount(umbrella_).usdc());
        if (key != address(0)) _start(key, expiry, volumeCap, maxPremiumBps, maxDiscountBps);
    }

    // ------------------------------------------------------------------
    // Sessions
    // ------------------------------------------------------------------

    /// @notice Let `key` trade until `expiry`. Replaces any earlier session of that key.
    ///         ETH sent along goes to the key for gas.
    function startSession(address key, uint64 expiry, uint128 volumeCap, uint16 maxPremiumBps, uint16 maxDiscountBps)
        external
        payable
        onlyOwner
    {
        _start(key, expiry, volumeCap, maxPremiumBps, maxDiscountBps);
    }

    /// @notice The owner can end any session; a key can end its own.
    function endSession(address key) external {
        require(msg.sender == owner || msg.sender == key, "Account: not allowed");
        delete sessions[key];
        emit SessionEnded(key, msg.sender);
    }

    function _start(address key, uint64 expiry, uint128 volumeCap, uint16 maxPremiumBps, uint16 maxDiscountBps) private {
        require(key != address(0) && key != owner, "Account: bad key");
        require(expiry > block.timestamp && expiry <= block.timestamp + MAX_SESSION, "Account: expiry must be within 30 days");
        require(maxPremiumBps <= 5_000 && maxDiscountBps <= 5_000, "Account: price limit above 50%");
        sessions[key] = Session(expiry, maxPremiumBps, maxDiscountBps, volumeCap, 0);
        emit SessionStarted(key, expiry, volumeCap, maxPremiumBps, maxDiscountBps);
        if (msg.value > 0) {
            (bool ok, ) = key.call{value: msg.value}("");
            require(ok, "Account: gas transfer failed");
        }
    }

    /// @dev Owner: no limits. Session key: active, within its volume cap.
    function _authorize(uint256 volume) private returns (uint256 maxPremiumBps, uint256 maxDiscountBps) {
        if (msg.sender == owner) return (type(uint16).max, 10_000);
        Session storage s = sessions[msg.sender];
        require(s.expiry > block.timestamp, "Account: no active session for this key");
        require(uint256(s.volumeUsed) + volume <= s.volumeCap, "Account: session volume cap reached");
        s.volumeUsed += uint128(volume);
        return (s.maxPremiumBps, s.maxDiscountBps);
    }

    // ------------------------------------------------------------------
    // Trading: only the pools and primary sales of this umbrella
    // ------------------------------------------------------------------

    function buyInPool(uint256 fundIndex, uint256 usdcIn, uint256 minTokenOut) external nonReentrant returns (uint256 tokenOut) {
        ISubFundForAccount fund = ISubFundForAccount(umbrella.subFunds(fundIndex));
        (uint256 maxPremiumBps, ) = _authorize(usdcIn);
        uint256 nav = fund.navPerToken();
        address pool = fund.pool();
        require(usdc.approve(pool, usdcIn), "Account: approve failed");
        tokenOut = IPoolForAccount(pool).swapUSDCForToken(usdcIn, minTokenOut);
        // Average price paid must not exceed NAV plus the allowed premium.
        require(tokenOut > 0 && usdcIn * ONE * 10_000 <= nav * (10_000 + maxPremiumBps) * tokenOut, "Account: price above the session's limit");
        emit Traded(msg.sender, fundIndex, true, usdcIn, tokenOut);
    }

    function sellInPool(uint256 fundIndex, uint256 tokenIn, uint256 minUSDCOut) external nonReentrant returns (uint256 usdcOut) {
        ISubFundForAccount fund = ISubFundForAccount(umbrella.subFunds(fundIndex));
        uint256 nav = fund.navPerToken();
        (, uint256 maxDiscountBps) = _authorize((tokenIn * nav) / ONE);
        address pool = fund.pool();
        require(IERC20ForAccount(fund.token()).approve(pool, tokenIn), "Account: approve failed");
        usdcOut = IPoolForAccount(pool).swapTokenForUSDC(tokenIn, minUSDCOut);
        // Average price received must not fall below NAV minus the allowed discount.
        require(usdcOut * ONE * 10_000 >= nav * (10_000 - maxDiscountBps) * tokenIn, "Account: price below the session's limit");
        emit Traded(msg.sender, fundIndex, false, usdcOut, tokenIn);
    }

    /// @notice Primary sale at the fixed $1.00 issue price.
    function buyPrimary(uint256 fundIndex, uint256 tokenAmount) external nonReentrant {
        ISubFundForAccount fund = ISubFundForAccount(umbrella.subFunds(fundIndex));
        _authorize(tokenAmount);
        require(usdc.approve(address(fund), tokenAmount), "Account: approve failed");
        fund.buy(tokenAmount);
        emit Traded(msg.sender, fundIndex, true, tokenAmount, tokenAmount);
    }

    // ------------------------------------------------------------------
    // Withdrawal: always to the owner
    // ------------------------------------------------------------------

    /// @notice Send `amount` of `token` to the owner. The owner and any active session
    ///         key may call this; the funds can only ever go to the owner.
    function withdrawToOwner(address token, uint256 amount) external nonReentrant {
        if (msg.sender != owner) require(sessions[msg.sender].expiry > block.timestamp, "Account: not allowed");
        require(IERC20ForAccount(token).transfer(owner, amount), "Account: transfer failed");
        emit Withdrawn(token, amount, msg.sender);
    }
}

/// @title One trading account per wallet
contract TradingAccountFactory {
    address public immutable umbrella;
    mapping(address => address) public accountOf;

    event AccountCreated(address indexed owner, address account);

    constructor(address umbrella_) {
        umbrella = umbrella_;
    }

    /// @notice Create the caller's trading account and, if `key` is set, start a first
    ///         session in the same transaction. ETH sent along goes to the key for gas.
    function create(address key, uint64 expiry, uint128 volumeCap, uint16 maxPremiumBps, uint16 maxDiscountBps)
        external
        payable
        returns (address account)
    {
        require(accountOf[msg.sender] == address(0), "Factory: account exists");
        require(key != address(0) || msg.value == 0, "Factory: gas needs a key");
        account = address(
            new TradingAccount{value: msg.value}(msg.sender, umbrella, key, expiry, volumeCap, maxPremiumBps, maxDiscountBps)
        );
        accountOf[msg.sender] = account;
        emit AccountCreated(msg.sender, account);
    }
}
