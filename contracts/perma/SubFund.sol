// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./FundToken.sol";
import "./OrderBook.sol";
import "./GPVesting.sol";

interface IComponentDeployer {
    function deploy(string calldata name, string calldata symbol, address usdc, uint256 yearSeconds)
        external
        returns (address token, address book, address vesting);
}

/// @title SubFund - one permanent-capital sub-fund under the umbrella
/// @notice Issued once, never wound up. There are no capital calls, no
///         redemptions and no distributions: profits stay in the fund and
///         raise NAV per token. Holders exit by selling in the order book.
///
///         What the code enforces (no manager discretion):
///           - primary sale at a fixed $1.00, hard-capped
///           - sale cash worth 1/19 of the tokens sold as permanent, fund-owned
///             liquidity: bids in the order book in equal steps of 0.2% below NAV,
///             each reselling what it bought 0.1% higher
///           - new tokens only in the amount token holders have approved by
///             vote, only through the open order book, and only at NAV +0.2%:
///             the money goes into the vault and never dilutes holders
///           - management fee paid in tokens: 2% of initial supply per year,
///             10-year lifetime cap, each tranche locked for one year
///           - buyback-and-burn that anyone can trigger when the market
///             has fallen to the bottom of the fund's ladder, 9.9% below NAV
///           - token holders can replace the GP; unvested fee tokens are burned
///
///         What stays a trust assumption: the value of off-chain
///         investments is reported by the GP (investedValue).
///         Cash and the fund's liquidity in the book are read on-chain and
///         cannot be misstated. Because the ladder is quoted around NAV, a
///         wrong valuation moves the fund's own bids and asks: the most it
///         can cost is the liquidity in the book, 5% of the fund.
contract SubFund {
    uint256 private constant ONE = 1e6; // 1 token and $1.00, both 6 decimals

    // --- primary sale ---
    uint256 public constant IPO_PRICE = 1e6;          // $1.00 per token
    uint256 public constant SALE_CAP = 9_500_000e6;   // tokens sold to investors
    uint256 public constant POL_DIVISOR = 19;         // liquidity seed = sale cash for sold / 19 tokens

    // --- management fee (in tokens, no NAV input needed) ---
    uint256 public constant FEE_BPS_PER_YEAR = 200;   // 2% of initial supply per year
    uint256 public constant FEE_YEARS_CAP = 10;       // fee minting stops for good after 10 tranches

    // --- discount control ---
    uint256 public constant BUYBACK_MAX_BPS = 100;      // at most 1% of vault cash per execution

    // --- governance ---
    uint256 public constant REMOVAL_THRESHOLD_BPS = 5000; // more than 50% of eligible supply

    string public name;
    IERC20Like public immutable usdc;
    FundToken public immutable token;
    OrderBook public immutable book;
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

    // issuance state: what holders have approved and the book has not sold yet
    uint256 public issuanceApproved;
    uint256 public issueProposalId;
    uint256 public issueProposed;   // tokens asked for in the running vote
    uint256 public issueDeadline;
    uint256 public issueYes;
    mapping(uint256 => mapping(address => uint256)) public issueEscrow;

    // governance state
    uint256 public proposalId;
    address public proposedGP;
    uint256 public voteDeadline;
    uint256 public yesVotes;
    mapping(uint256 => mapping(address => uint256)) public escrowed;

    event Purchased(address indexed investor, uint256 tokens);
    event SaleClosed(uint256 sold, uint256 liquidityTokens, uint256 liquidityUSDC);
    event TokensIssued(uint256 tokens, uint256 stillApproved);
    event CapitalDeployed(address indexed to, uint256 amount, string memo);
    event ProceedsReturned(address indexed from, uint256 amount, uint256 newInvestedValue);
    event InvestmentsMarked(uint256 oldValue, uint256 newValue, string memo);
    event NAVUpdated(uint256 navPerToken, uint256 marketPrice, uint256 timestamp);
    event ManagementFeeMinted(uint256 tranche, uint256 tokens);
    event BuybackExecuted(address indexed caller, uint256 usdcSpent, uint256 tokensBurned, uint256 priceAfter);
    event IssuanceProposed(uint256 indexed id, uint256 tokens, uint256 deadline);
    event IssuanceVoted(uint256 indexed id, address indexed voter, uint256 tokens);
    event IssuanceApproved(uint256 indexed id, uint256 tokens, uint256 approvedNow);
    event RemovalProposed(uint256 indexed id, address indexed proposer, address newGP, uint256 deadline);
    event Voted(uint256 indexed id, address indexed voter, uint256 tokens);
    event GPRemoved(uint256 indexed id, address oldGP, address newGP, uint256 burnedUnvested);

    modifier onlyGP() {
        require(msg.sender == gp, "Fund: only GP");
        _;
    }

    /// @param components Helper that deploys token, order book and vesting for this
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
        (address t, address b, address v) =
            IComponentDeployer(components).deploy(name_, symbol_, usdc_, yearSeconds);
        token = FundToken(t);
        book = OrderBook(b);
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

        // Permanent fund-owned liquidity: cash on the book's bid ladder below
        // NAV. The fund has no function to withdraw it again. No tokens are
        // set aside: above NAV the book issues new ones.
        uint256 liqUSDC = ((sold / POL_DIVISOR) * IPO_PRICE) / ONE;
        usdc.approve(address(book), liqUSDC);
        book.seed(liqUSDC);

        initialSupply = sold;
        lastFeeMint = block.timestamp;
        emit SaleClosed(sold, 0, liqUSDC);
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

    /// @notice What the fund owns on the book's ladder: (tokens, mUSDC).
    function ownedLiquidity() public view returns (uint256 tokens, uint256 cash) {
        return book.inventory();
    }

    /// @notice Net assets = vault cash + the fund's cash in the book + reported investments.
    function netAssets() public view returns (uint256) {
        (, uint256 bookCash) = ownedLiquidity();
        return vaultCash() + bookCash + investedValue;
    }

    /// @notice Tokens held by investors and the GP. The fund's own tokens on
    ///         the ladder are treasury stock and do not count.
    function outstandingSupply() public view returns (uint256) {
        (uint256 bookTokens, ) = ownedLiquidity();
        return token.totalSupply() - bookTokens;
    }

    /// @notice NAV per token in mUSDC, 6 decimals (1_000000 = $1.00).
    function navPerToken() public view returns (uint256) {
        uint256 supply = outstandingSupply();
        if (supply == 0) return IPO_PRICE;
        return (netAssets() * ONE) / supply;
    }

    /// @notice The ladder's price in mUSDC per token, 6 decimals: the middle
    ///         between its best bid and best ask.
    function marketPrice() public view returns (uint256) {
        return book.spotPrice();
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

    /// @notice The bottom of the ladder: the lowest price it ever offers at.
    function buybackTriggerPrice() public view returns (uint256) {
        return book.floorPrice();
    }

    function maxBuyback() public view returns (uint256) {
        return (vaultCash() * BUYBACK_MAX_BPS) / 10_000;
    }

    /// @notice Anyone can make the fund buy its own tokens in the book and
    ///         burn them once the market has fallen to the bottom of the ladder,
    ///         9.9% below NAV: its bids are used up. Limited to 1%
    ///         of vault cash per execution and one execution per "week".
    ///         Buying below NAV never lowers NAV per token.
    ///         Bought from holders' sell orders, this is a buyback at a
    ///         discount. Bought from the ladder, it turns treasury tokens into
    ///         fresh bids: vault cash moves onto the lowest rung.
    /// @param ids Resting sell orders to buy from, cheapest first (may be empty).
    function buyback(uint256 usdcAmount, uint256[] calldata ids) external {
        require(saleClosed, "Fund: sale open");
        require(block.timestamp >= lastBuyback + YEAR / 52, "Fund: buyback cooldown");
        uint256 navBefore = navPerToken();
        require(marketPrice() <= buybackTriggerPrice(), "Fund: discount below trigger");
        require(usdcAmount > 0 && usdcAmount <= maxBuyback(), "Fund: amount above limit");
        lastBuyback = block.timestamp;

        usdc.approve(address(book), usdcAmount);
        (uint256 bought, uint256 spent) = book.buy(usdcAmount, 0, ids);
        usdc.approve(address(book), 0);
        token.burn(bought);

        require(marketPrice() <= navBefore, "Fund: would push price above NAV");
        emit BuybackExecuted(msg.sender, spent, bought, marketPrice());
        _emitNAV();
    }

    // ==================================================================
    // 5. Issuance: only what holders approved, only in the open market,
    //    only above NAV
    // ==================================================================

    function issuanceVoteActive() public view returns (bool) {
        return issueProposed > 0 && block.timestamp <= issueDeadline;
    }

    /// @notice The GP asks holders to approve the issue of up to `tokenAmount`
    ///         new tokens. He does not set a price and names no buyer: approved
    ///         tokens are offered to everyone in the order book at NAV +0.2%.
    function proposeIssuance(uint256 tokenAmount) external onlyGP {
        require(saleClosed, "Fund: sale open");
        require(!issuanceVoteActive(), "Fund: vote already running");
        require(tokenAmount > 0, "Fund: zero amount");
        issueProposalId += 1;
        issueProposed = tokenAmount;
        issueDeadline = block.timestamp + VOTING_PERIOD;
        issueYes = 0;
        emit IssuanceProposed(issueProposalId, tokenAmount, issueDeadline);
    }

    /// @notice Vote yes by locking tokens in the fund until the vote ends.
    function voteIssuance(uint256 tokenAmount) external {
        require(issuanceVoteActive(), "Fund: no active vote");
        require(msg.sender != gp, "Fund: GP cannot vote");
        require(tokenAmount > 0, "Fund: zero amount");
        issueEscrow[issueProposalId][msg.sender] += tokenAmount;
        issueYes += tokenAmount;
        require(token.transferFrom(msg.sender, address(this), tokenAmount), "Fund: lock failed");
        emit IssuanceVoted(issueProposalId, msg.sender, tokenAmount);
    }

    /// @notice Executes as soon as more than 50% of eligible supply voted yes.
    ///         The amount is added to what the book may issue.
    function executeIssuance() external {
        require(issuanceVoteActive(), "Fund: no active vote");
        require(issueYes * 10_000 > eligibleSupply() * REMOVAL_THRESHOLD_BPS, "Fund: threshold not reached");
        uint256 amount = issueProposed;
        issueProposed = 0;
        issuanceApproved += amount;
        emit IssuanceApproved(issueProposalId, amount, issuanceApproved);
    }

    /// @notice Get locked voting tokens back once the vote is over.
    function withdrawIssuanceVotes(uint256 id) external {
        require(id < issueProposalId || !issuanceVoteActive(), "Fund: vote still running");
        uint256 amount = issueEscrow[id][msg.sender];
        require(amount > 0, "Fund: nothing locked");
        issueEscrow[id][msg.sender] = 0;
        require(token.transfer(msg.sender, amount), "Fund: unlock failed");
    }

    /// @notice New tokens for a buyer in the order book, at the book's issue
    ///         price above NAV, out of what holders approved. Only the book
    ///         can call this; it has already sent the payment to this vault.
    function issue(address to, uint256 tokenAmount) external {
        require(msg.sender == address(book), "Fund: only the book");
        require(tokenAmount <= issuanceApproved, "Fund: above the approved issuance");
        issuanceApproved -= tokenAmount;
        token.mint(to, tokenAmount);
        emit TokensIssued(tokenAmount, issuanceApproved);
        _emitNAV();
    }

    // ==================================================================
    // 6. Governance: token holders can replace the GP
    // ==================================================================

    /// @notice Supply that is allowed to vote: everything except unvested
    ///         fee tokens, the fund's own tokens on the ladder and the GP's
    ///         own wallet. Holders' tokens in open sell orders still count:
    ///         they can be taken out of the book and voted.
    function eligibleSupply() public view returns (uint256) {
        (uint256 bookTokens, ) = ownedLiquidity();
        return token.totalSupply()
            - token.balanceOf(address(vesting))
            - bookTokens
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
