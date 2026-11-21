// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./FundToken.sol";
import "./LiquidityPool.sol";
import "./GPVesting.sol";

interface IComponentDeployer {
    function deploy(string calldata name, string calldata symbol, address usdc, uint256 yearSeconds)
        external
        returns (address token, address pool, address vesting);
}

/// @title SubFund - one permanent-capital sub-fund under the umbrella
/// @notice Issued once, never wound up. There are no capital calls, no
///         redemptions and no distributions: profits stay in the fund and
///         raise NAV per token. Holders exit by selling in the pool.
///
///         What the code enforces (no manager discretion):
///           - primary sale at a fixed $1.00, hard-capped
///           - 5% of supply paired with sale cash as permanent, fund-owned liquidity
///           - management fee paid in tokens: 2% of initial supply per year,
///             10-year lifetime cap, each tranche locked for one year
///           - buyback-and-burn that anyone can trigger when the market
///             trades more than 10% below NAV
///           - follow-on issuance only at or above NAV, so new money never dilutes holders
///           - token holders can replace the GP; unvested fee tokens are burned
///
///         What stays a trust assumption: the value of off-chain
///         investments is reported by the GP (investedValue).
///         Cash and pool liquidity are read on-chain and cannot be misstated.
contract SubFund {
    uint256 private constant ONE = 1e6; // 1 token and $1.00, both 6 decimals

    // --- primary sale ---
    uint256 public constant IPO_PRICE = 1e6;          // $1.00 per token
    uint256 public constant SALE_CAP = 9_500_000e6;   // tokens sold to investors
    uint256 public constant POL_DIVISOR = 19;         // liquidity seed = sold / 19  (= 5% of total supply)

    // --- management fee (in tokens, no NAV input needed) ---
    uint256 public constant FEE_BPS_PER_YEAR = 200;   // 2% of initial supply per year
    uint256 public constant FEE_YEARS_CAP = 10;       // fee minting stops for good after 10 tranches

    // --- discount control ---
    uint256 public constant BUYBACK_TRIGGER_BPS = 1000; // market price more than 10% below NAV
    uint256 public constant BUYBACK_MAX_BPS = 100;      // at most 1% of vault cash per execution

    // --- governance ---
    uint256 public constant REMOVAL_THRESHOLD_BPS = 5000; // more than 50% of eligible supply

    string public name;
    IERC20Like public immutable usdc;
    FundToken public immutable token;
    LiquidityPool public immutable pool;
    GPVesting public immutable vesting;

    /// @notice Length of one "year" in seconds. 365 days in production;
    ///         the demo deploys with a short value so fee, vesting and
    ///         voting periods can be shown live.
    uint256 public immutable YEAR;

    /// @notice How long a GP-removal vote stays open (7 days in production).
    uint256 public immutable VOTING_PERIOD;

    address public gp;

    // sale state
    bool public saleClosed;
    uint256 public sold;
    uint256 public initialSupply;

    // portfolio state
    uint256 public investedValue; // GP-reported value of off-chain investments (mUSDC, 6 decimals)

    // fee state
    uint256 public feeTranchesMinted;
    uint256 public lastFeeMint;

    // buyback state
    uint256 public lastBuyback;

    // follow-on state
    uint256 public followOnRemaining;

    // governance state
    uint256 public proposalId;
    address public proposedGP;
    uint256 public voteDeadline;
    uint256 public yesVotes;
    mapping(uint256 => mapping(address => uint256)) public escrowed;

    event Purchased(address indexed investor, uint256 tokens);
    event SaleClosed(uint256 sold, uint256 liquidityTokens, uint256 liquidityUSDC);
    event CapitalDeployed(address indexed to, uint256 amount, string memo);
    event ProceedsReturned(address indexed from, uint256 amount, uint256 newInvestedValue);
    event InvestmentsMarked(uint256 oldValue, uint256 newValue, string memo);
    event NAVUpdated(uint256 navPerToken, uint256 marketPrice, uint256 timestamp);
    event ManagementFeeMinted(uint256 tranche, uint256 tokens);
    event BuybackExecuted(address indexed caller, uint256 usdcSpent, uint256 tokensBurned, uint256 priceAfter);
    event FollowOnOpened(uint256 tokens);
    event FollowOnSubscribed(address indexed investor, uint256 tokens, uint256 price);
    event RemovalProposed(uint256 indexed id, address indexed proposer, address newGP, uint256 deadline);
    event Voted(uint256 indexed id, address indexed voter, uint256 tokens);
    event GPRemoved(uint256 indexed id, address oldGP, address newGP, uint256 burnedUnvested);

    modifier onlyGP() {
        require(msg.sender == gp, "Fund: only GP");
        _;
    }

    /// @param components Helper that deploys token, pool and vesting for this
    ///        fund. Keeping that bytecode out of this contract is what keeps
    ///        every contract below the 24 KB size limit (EIP-170).
    constructor(
        string memory name_,
        string memory symbol_,
        address usdc_,
        address gp_,
        uint256 yearSeconds,
        uint256 votingSeconds,
        address components
    ) {
        require(yearSeconds >= 52 && votingSeconds > 0, "Fund: bad periods");
        name = name_;
        usdc = IERC20Like(usdc_);
        gp = gp_;
        YEAR = yearSeconds;
        VOTING_PERIOD = votingSeconds;
        (address t, address p, address v) =
            IComponentDeployer(components).deploy(name_, symbol_, usdc_, yearSeconds);
        token = FundToken(t);
        pool = LiquidityPool(p);
        vesting = GPVesting(v);
    }

    // ==================================================================
    // 1. Primary sale
    // ==================================================================

    /// @notice Buy tokens at $1.00 each. Approve mUSDC to this contract first.
    function buy(uint256 tokenAmount) external {
        require(!saleClosed, "Fund: sale closed");
        require(tokenAmount > 0, "Fund: zero amount");
        require(sold + tokenAmount <= SALE_CAP, "Fund: exceeds sale cap");
        sold += tokenAmount;
        require(usdc.transferFrom(msg.sender, address(this), (tokenAmount * IPO_PRICE) / ONE), "Fund: payment failed");
        token.mint(msg.sender, tokenAmount);
        emit Purchased(msg.sender, tokenAmount);
    }

    /// @notice Close the sale and open the secondary market at the IPO price.
    ///         The GP can close any time; anyone can close once sold out.
    function closeSale() external {
        require(!saleClosed, "Fund: sale closed");
        require(sold >= POL_DIVISOR * ONE, "Fund: nothing sold");
        require(msg.sender == gp || sold == SALE_CAP, "Fund: only GP before sell-out");
        saleClosed = true;

        // Permanent fund-owned liquidity: equal token and cash value at $1.00.
        // The fund has no function to withdraw it again.
        uint256 liqTokens = sold / POL_DIVISOR;
        uint256 liqUSDC = (liqTokens * IPO_PRICE) / ONE;
        token.mint(address(this), liqTokens);
        token.approve(address(pool), liqTokens);
        usdc.approve(address(pool), liqUSDC);
        pool.addLiquidity(liqTokens, liqUSDC);

        initialSupply = sold + liqTokens;
        lastFeeMint = block.timestamp;
        emit SaleClosed(sold, liqTokens, liqUSDC);
        _emitNAV();
    }

    // ==================================================================
    // 2. Portfolio and NAV
    // ==================================================================

    /// @notice GP sends vault cash to an investment (off-chain asset). Booked at cost.
    function deployCapital(address to, uint256 amount, string calldata memo) external onlyGP {
        require(saleClosed, "Fund: sale open");
        investedValue += amount;
        require(usdc.transfer(to, amount), "Fund: transfer failed");
        emit CapitalDeployed(to, amount, memo);
        _emitNAV();
    }

    /// @notice GP revalues the off-chain portfolio. This is the oracle of the model.
    function markInvestments(uint256 newValue, string calldata memo) external onlyGP {
        emit InvestmentsMarked(investedValue, newValue, memo);
        investedValue = newValue;
        _emitNAV();
    }

    /// @notice Exit or income comes back into the vault. The GP states the
    ///         remaining portfolio value in the same transaction, so cash is
    ///         never counted twice. Nothing is paid out: it compounds.
    function returnProceeds(uint256 amount, uint256 newInvestedValue) external onlyGP {
        require(usdc.transferFrom(msg.sender, address(this), amount), "Fund: payment failed");
        investedValue = newInvestedValue;
        emit ProceedsReturned(msg.sender, amount, newInvestedValue);
        _emitNAV();
    }

    /// @notice Cash held directly by the fund.
    function vaultCash() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /// @notice The fund's share of the pool: (tokens, mUSDC).
    function ownedLiquidity() public view returns (uint256 tokens, uint256 cash) {
        uint256 total = pool.totalShares();
        if (total == 0) return (0, 0);
        uint256 mine = pool.shares(address(this));
        tokens = (pool.reserveToken() * mine) / total;
        cash = (pool.reserveUSDC() * mine) / total;
    }

    /// @notice Net assets = vault cash + fund-owned pool cash + reported investments.
    function netAssets() public view returns (uint256) {
        (, uint256 poolCash) = ownedLiquidity();
        return vaultCash() + poolCash + investedValue;
    }

    /// @notice Tokens held by investors and the GP. Fund-owned tokens in the
    ///         pool are treasury stock and do not count.
    function outstandingSupply() public view returns (uint256) {
        (uint256 poolTokens, ) = ownedLiquidity();
        return token.totalSupply() - poolTokens;
    }

    /// @notice NAV per token in mUSDC, 6 decimals (1_000000 = $1.00).
    function navPerToken() public view returns (uint256) {
        uint256 supply = outstandingSupply();
        if (supply == 0) return IPO_PRICE;
        return (netAssets() * ONE) / supply;
    }

    /// @notice Pool price in mUSDC per token, 6 decimals.
    function marketPrice() public view returns (uint256) {
        return pool.spotPrice();
    }

    /// @notice Market price relative to NAV in basis points.
    ///         Negative = discount, positive = premium.
    function premiumBps() public view returns (int256) {
        uint256 nav = navPerToken();
        uint256 price = marketPrice();
        if (nav == 0 || price == 0) return 0;
        return (int256(price) - int256(nav)) * 10_000 / int256(nav);
    }

    // ==================================================================
    // 3. Management fee: 2% of initial supply per year, paid in tokens
    // ==================================================================

    function feePerYear() public view returns (uint256) {
        return (initialSupply * FEE_BPS_PER_YEAR) / 10_000;
    }

    /// @notice Anyone can trigger the yearly fee mint once it is due.
    ///         Tokens go to the vesting contract, not to the GP wallet.
    function mintManagementFee() external {
        require(saleClosed, "Fund: sale open");
        require(feeTranchesMinted < FEE_YEARS_CAP, "Fund: lifetime fee cap reached");
        require(block.timestamp >= lastFeeMint + YEAR, "Fund: fee not due yet");
        lastFeeMint += YEAR;
        feeTranchesMinted += 1;
        uint256 amount = feePerYear();
        token.mint(address(vesting), amount);
        vesting.notifyTranche(amount);
        emit ManagementFeeMinted(feeTranchesMinted, amount);
        _emitNAV();
    }

    // ==================================================================
    // 4. Discount control: rule-based buyback-and-burn
    // ==================================================================

    function buybackTriggerPrice() public view returns (uint256) {
        return (navPerToken() * (10_000 - BUYBACK_TRIGGER_BPS)) / 10_000;
    }

    function maxBuyback() public view returns (uint256) {
        return (vaultCash() * BUYBACK_MAX_BPS) / 10_000;
    }

    /// @notice Anyone can make the fund buy its own tokens in the pool and
    ///         burn them while the market trades more than 10% below NAV.
    ///         Limited to 1% of vault cash per execution and one execution
    ///         per "week". Buying below NAV never lowers NAV per token.
    ///         Note: where the fund itself owns the pool, a holder selling
    ///         into the pool already is a buyback at the market price. This
    ///         function then moves vault cash into the pool and lifts the quote.
    function buyback(uint256 usdcAmount) external {
        require(saleClosed, "Fund: sale open");
        require(block.timestamp >= lastBuyback + YEAR / 52, "Fund: buyback cooldown");
        uint256 navBefore = navPerToken();
        require(marketPrice() < buybackTriggerPrice(), "Fund: discount below trigger");
        require(usdcAmount > 0 && usdcAmount <= maxBuyback(), "Fund: amount above limit");
        lastBuyback = block.timestamp;

        usdc.approve(address(pool), usdcAmount);
        uint256 bought = pool.swapUSDCForToken(usdcAmount, 0);
        token.burn(bought);

        require(marketPrice() <= navBefore, "Fund: would push price above NAV");
        emit BuybackExecuted(msg.sender, usdcAmount, bought, marketPrice());
        _emitNAV();
    }

    // ==================================================================
    // 5. Follow-on issuance: only at or above NAV
    // ==================================================================

    /// @notice GP offers additional tokens. The price is not his choice.
    function openFollowOn(uint256 tokenAmount) external onlyGP {
        require(saleClosed, "Fund: sale open");
        followOnRemaining = tokenAmount;
        emit FollowOnOpened(tokenAmount);
    }

    /// @notice Issue price = the higher of NAV and market price.
    ///         New money never buys in below the value existing holders own.
    function issuePrice() public view returns (uint256) {
        uint256 nav = navPerToken();
        uint256 price = marketPrice();
        return price > nav ? price : nav;
    }

    function subscribe(uint256 tokenAmount, uint256 maxPrice) external {
        require(tokenAmount > 0 && tokenAmount <= followOnRemaining, "Fund: exceeds follow-on");
        uint256 price = issuePrice();
        require(price <= maxPrice, "Fund: price above max");
        followOnRemaining -= tokenAmount;
        uint256 cost = (tokenAmount * price + ONE - 1) / ONE; // round up in favour of the fund
        require(usdc.transferFrom(msg.sender, address(this), cost), "Fund: payment failed");
        token.mint(msg.sender, tokenAmount);
        emit FollowOnSubscribed(msg.sender, tokenAmount, price);
        _emitNAV();
    }

    // ==================================================================
    // 6. Governance: token holders can replace the GP
    // ==================================================================

    /// @notice Supply that is allowed to vote: everything except unvested
    ///         fee tokens, tokens in the pool and the GP's own wallet.
    function eligibleSupply() public view returns (uint256) {
        return token.totalSupply()
            - token.balanceOf(address(vesting))
            - token.balanceOf(address(pool))
            - token.balanceOf(gp);
    }

    function voteActive() public view returns (bool) {
        return proposedGP != address(0) && block.timestamp <= voteDeadline;
    }

    /// @notice Start a vote to replace the GP. Open for VOTING_PERIOD.
    function proposeRemoveGP(address newGP) external {
        require(saleClosed, "Fund: sale open");
        require(!voteActive(), "Fund: vote already running");
        require(newGP != address(0) && newGP != gp, "Fund: invalid candidate");
        require(token.balanceOf(msg.sender) > 0, "Fund: holders only");
        proposalId += 1;
        proposedGP = newGP;
        voteDeadline = block.timestamp + VOTING_PERIOD;
        yesVotes = 0;
        emit RemovalProposed(proposalId, msg.sender, newGP, voteDeadline);
    }

    /// @notice Vote yes by locking tokens in the fund until the vote ends.
    ///         Locking prevents the same tokens from voting twice.
    function vote(uint256 tokenAmount) external {
        require(voteActive(), "Fund: no active vote");
        require(msg.sender != gp, "Fund: GP cannot vote");
        require(tokenAmount > 0, "Fund: zero amount");
        escrowed[proposalId][msg.sender] += tokenAmount;
        yesVotes += tokenAmount;
        require(token.transferFrom(msg.sender, address(this), tokenAmount), "Fund: lock failed");
        emit Voted(proposalId, msg.sender, tokenAmount);
    }

    /// @notice Executes as soon as more than 50% of eligible supply voted yes.
    ///         The old GP keeps what has vested; the unvested rest is burned.
    function executeRemoveGP() external {
        require(voteActive(), "Fund: no active vote");
        require(yesVotes * 10_000 > eligibleSupply() * REMOVAL_THRESHOLD_BPS, "Fund: threshold not reached");
        address oldGP = gp;
        address newGP = proposedGP;
        proposedGP = address(0);
        gp = newGP;
        uint256 burned = vesting.forfeit(oldGP);
        emit GPRemoved(proposalId, oldGP, newGP, burned);
        _emitNAV();
    }

    /// @notice Get locked voting tokens back once the vote is over.
    function withdrawVotes(uint256 id) external {
        require(id < proposalId || !voteActive(), "Fund: vote still running");
        uint256 amount = escrowed[id][msg.sender];
        require(amount > 0, "Fund: nothing locked");
        escrowed[id][msg.sender] = 0;
        require(token.transfer(msg.sender, amount), "Fund: unlock failed");
    }

    // ==================================================================
    // internals
    // ==================================================================

    function _emitNAV() private {
        emit NAVUpdated(navPerToken(), marketPrice(), block.timestamp);
    }
}
