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
///           - 5% of the sale cash as permanent, fund-owned liquidity: bids in
///             the order book in equal steps of 0.2% from NAV down to NAV -50%,
///             each reselling what it bought 0.1% higher; anyone can make the
///             fund top this reserve up to 5% of net assets from the vault
///           - new tokens only in the amount token holders have approved by
///             vote, only through the open order book, and only at NAV +0.2%:
///             the money goes into the vault and never dilutes holders
///           - management fee paid in tokens: 2% of initial supply per year,
///             10-year lifetime cap, each tranche locked for one year
///           - a surplus pot (trading fees and what the ladder earns) that pays
///             for buybacks and dividends; both only when the GP proposes
///             them and holders approve
///           - token holders can replace the GP; unvested fee tokens are burned
///
///           - a revaluation of the off-chain portfolio is a proposal with a
///             bond and a report hash; holders can dispute it, and the side
///             that loses a dispute vote forfeits its bond to the other
///
///         What stays a trust assumption: the value of off-chain
///         investments comes from the GP (investedValue). It is disputable,
///         not verifiable.
///         Cash and the fund's liquidity in the book are read on-chain and
///         cannot be misstated. Because the ladder is quoted around NAV, a
///         wrong valuation moves the fund's own bids and asks: the most it
///         can cost is the liquidity in the book, 5% of the fund.
contract SubFund {
    uint256 private constant ONE = 1e6; // 1 token and $1.00, both 6 decimals

    // --- primary sale ---
    uint256 public constant IPO_PRICE = 1e6;          // $1.00 per token
    uint256 public constant SALE_CAP = 9_500_000e6;   // tokens sold to investors
    uint256 public constant RESERVE_BPS = 500;        // fund-owned liquidity in the book: 5% of the sale cash, later 5% of net assets

    // --- management fee (in tokens, no NAV input needed) ---
    uint256 public constant FEE_BPS_PER_YEAR = 200;   // 2% of initial supply per year
    uint256 public constant FEE_YEARS_CAP = 10;       // fee minting stops for good after 10 tranches

    // --- what a holder vote can be about ---
    uint8 public constant KIND_ISSUANCE = 0; // new tokens for the order book
    uint8 public constant KIND_BUYBACK = 1;  // mUSDC from the surplus for buying back and burning
    uint8 public constant KIND_DIVIDEND = 2; // mUSDC from the surplus paid to holders

    // --- governance ---
    uint256 public constant REMOVAL_THRESHOLD_BPS = 5000; // more than 50% of eligible supply

    // --- valuation: proposal, bond, dispute ---
    uint256 public constant MARK_BOND_BPS = 100;      // bond = 1% of the proposed portfolio value
    uint256 public constant MIN_MARK_BOND = 10e6;     // at least 10 mUSDC

    // a revaluation of the off-chain portfolio waiting to take effect
    struct Mark {
        uint256 value;        // proposed investedValue
        bytes32 reportHash;   // fingerprint of the report behind it (e.g. keccak256 of the PDF)
        address proposer;     // the GP who posted the bond
        uint256 bond;         // posted by the proposer, and again by a disputer
        uint256 deadline;     // end of the dispute window, then end of the holder vote
        address disputer;     // zero while undisputed
        uint256 accept;       // tokens locked for the GP's value
        uint256 reject;       // tokens locked against it
        uint8 state;          // 1 open, 2 disputed, 3 applied, 4 rejected
    }

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
    uint256 public investedValue; // value of off-chain investments (mUSDC, 6 decimals): at cost, then as marked

    // valuation state
    uint256 public markId;                   // id of the latest proposal
    mapping(uint256 => Mark) public marks;
    mapping(uint256 => mapping(address => uint256)) public markEscrow; // tokens locked in a dispute vote
    uint256 public bondsHeld;                // mUSDC bonds in the vault; not fund money
    bytes32 public lastReportHash;           // report behind the value in force

    // fee state
    uint256 public feeTranchesMinted;
    uint256 public lastFeeMint;

    // surplus: trading fees and ladder profit, part of vault cash, kept apart from
    // the money the GP invests. Buybacks and dividends are paid from it only.
    uint256 public surplus;
    uint256 public buybackApproved;  // mUSDC holders have approved for buybacks
    uint256 public dividendApproved; // mUSDC holders have approved for dividends

    // dividends: cumulative mUSDC per token (scaled by 1e18) and each holder's position in it
    uint256 public dividendPerToken;
    uint256 public dividendsUnclaimed; // declared and not yet collected; no longer part of net assets
    mapping(address => uint256) private dividendSeen;
    mapping(address => uint256) private dividendOwed;

    // issuance state: what holders have approved and the book has not sold yet
    uint256 public issuanceApproved;
    uint256 public issueProposalId;
    uint256 public issueProposed;   // amount asked for in the running vote: tokens, or mUSDC for buyback and dividend
    uint8 public issueKind;         // what the running or last vote is about
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
    event ReserveToppedUp(uint256 usdc, uint256 target);
    event CapitalDeployed(address indexed to, uint256 amount, string memo);
    event ProceedsReturned(address indexed from, uint256 amount, uint256 newInvestedValue);
    event InvestmentsMarked(uint256 oldValue, uint256 newValue, string memo);
    event MarkProposed(uint256 indexed id, uint256 value, bytes32 reportHash, uint256 bond, uint256 deadline, string memo);
    event MarkDisputed(uint256 indexed id, address indexed disputer, uint256 voteDeadline);
    event MarkVoted(uint256 indexed id, address indexed voter, bool accept, uint256 tokens);
    event MarkResolved(uint256 indexed id, bool applied, address bondWinner, uint256 bondPaid);
    event NAVUpdated(uint256 navPerToken, uint256 marketPrice, uint256 timestamp);
    event ManagementFeeMinted(uint256 tranche, uint256 tokens);
    event BuybackExecuted(address indexed caller, uint256 usdcSpent, uint256 tokensBurned, uint256 priceAfter);
    event IssuanceProposed(uint256 indexed id, uint256 tokens, uint256 deadline);
    event Proposed(uint256 indexed id, uint8 kind, uint256 amount, uint256 deadline);
    event Approved(uint256 indexed id, uint8 kind, uint256 amount);
    event SurplusAdded(uint256 usdc, uint256 surplus);
    event DividendPaid(uint256 usdc, uint256 perTokenE18);
    event DividendClaimed(address indexed holder, uint256 usdc);
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
        require(sold >= 100 * ONE, "Fund: nothing sold");
        require(msg.sender == gp || sold == SALE_CAP, "Fund: only GP before sell-out");
        saleClosed = true;

        // Permanent fund-owned liquidity: cash on the book's bid ladder below
        // NAV. The fund has no function to withdraw it again. No tokens are
        // set aside: above NAV the book issues new ones.
        uint256 liqUSDC = (((sold * RESERVE_BPS) / 10_000) * IPO_PRICE) / ONE;
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
        require(!markOpen(), "Fund: valuation pending");
        require(amount <= freeCash(), "Fund: above free vault cash");
        investedValue += amount;
        require(usdc.transfer(to, amount), "Fund: transfer failed");
        emit CapitalDeployed(to, amount, memo);
        _emitNAV();
    }

    /// @notice Exit or income comes back into the vault. The GP states the
    ///         remaining portfolio value in the same transaction, so cash is
    ///         never counted twice. Nothing is paid out: it compounds.
    ///         The remaining value can only stay or fall, and by no more than
    ///         the cash that came back: any other change is a revaluation and
    ///         has to go through proposeMark.
    function returnProceeds(uint256 amount, uint256 newInvestedValue) external onlyGP {
        require(!markOpen(), "Fund: valuation pending");
        require(newInvestedValue <= investedValue && newInvestedValue + amount >= investedValue,
            "Fund: revalue via proposeMark");
        require(usdc.transferFrom(msg.sender, address(this), amount), "Fund: payment failed");
        investedValue = newInvestedValue;
        emit ProceedsReturned(msg.sender, amount, newInvestedValue);
        _emitNAV();
    }

    // ------------------------------------------------------------------
    // Valuation: the GP's revaluation is a proposal with a bond. Holders
    // can dispute it with the same bond; then holders decide by locking
    // tokens, and the side that loses forfeits its bond to the other.
    //   state 1 = open, 2 = disputed, 3 = applied, 4 = rejected
    // ------------------------------------------------------------------

    function markOpen() public view returns (bool) {
        uint8 s = marks[markId].state;
        return s == 1 || s == 2;
    }

    /// @notice Bond for a proposed portfolio value: 1%, at least 10 mUSDC.
    function markBond(uint256 value) public pure returns (uint256 b) {
        b = (value * MARK_BOND_BPS) / 10_000;
        if (b < MIN_MARK_BOND) b = MIN_MARK_BOND;
    }

    /// @notice GP proposes a new value for the off-chain portfolio, names the
    ///         report behind it by its hash and posts the bond (approve mUSDC
    ///         first). Takes effect after the dispute window unless disputed.
    function proposeMark(uint256 value, bytes32 reportHash, string calldata memo) external onlyGP {
        require(saleClosed, "Fund: sale open");
        require(!markOpen(), "Fund: valuation pending");
        require(reportHash != bytes32(0), "Fund: report hash missing");
        uint256 bond = markBond(value);
        require(usdc.transferFrom(msg.sender, address(this), bond), "Fund: bond failed");
        bondsHeld += bond;
        markId += 1;
        Mark storage m = marks[markId];
        m.value = value;
        m.reportHash = reportHash;
        m.proposer = msg.sender;
        m.bond = bond;
        m.deadline = block.timestamp + VOTING_PERIOD;
        m.state = 1;
        emit MarkProposed(markId, value, reportHash, bond, m.deadline, memo);
    }

    /// @notice A holder disputes the pending value by posting the same bond.
    ///         A holder vote of VOTING_PERIOD follows.
    function disputeMark() external {
        Mark storage m = marks[markId];
        require(m.state == 1 && block.timestamp <= m.deadline, "Fund: nothing to dispute");
        require(msg.sender != gp && token.balanceOf(msg.sender) > 0, "Fund: holders only");
        require(usdc.transferFrom(msg.sender, address(this), m.bond), "Fund: bond failed");
        bondsHeld += m.bond;
        m.disputer = msg.sender;
        m.state = 2;
        m.deadline = block.timestamp + VOTING_PERIOD;
        emit MarkDisputed(markId, msg.sender, m.deadline);
    }

    /// @notice Vote on a disputed value by locking tokens until it is resolved.
    function voteMark(bool accept, uint256 tokenAmount) external {
        Mark storage m = marks[markId];
        require(m.state == 2 && block.timestamp <= m.deadline, "Fund: no dispute vote");
        require(msg.sender != gp, "Fund: GP cannot vote");
        require(tokenAmount > 0, "Fund: zero amount");
        markEscrow[markId][msg.sender] += tokenAmount;
        if (accept) m.accept += tokenAmount;
        else m.reject += tokenAmount;
        require(token.transferFrom(msg.sender, address(this), tokenAmount), "Fund: lock failed");
        emit MarkVoted(markId, msg.sender, accept, tokenAmount);
    }

    /// @notice Anyone can settle a valuation once its window is over.
    ///         Undisputed: the value applies and the GP gets the bond back.
    ///         Disputed: more tokens for than against applies it (a tie rejects);
    ///         the winning side receives both bonds.
    function resolveMark() external {
        Mark storage m = marks[markId];
        require((m.state == 1 || m.state == 2) && block.timestamp > m.deadline, "Fund: nothing to resolve");
        bool applied = m.state == 1 || m.accept > m.reject;
        uint256 pot = m.state == 1 ? m.bond : 2 * m.bond;
        address winner = applied ? m.proposer : m.disputer;
        m.state = applied ? 3 : 4;
        bondsHeld -= pot;
        if (applied) {
            emit InvestmentsMarked(investedValue, m.value, "mark");
            investedValue = m.value;
            lastReportHash = m.reportHash;
        }
        require(usdc.transfer(winner, pot), "Fund: payout failed");
        emit MarkResolved(markId, applied, winner, pot);
        _emitNAV();
    }

    /// @notice Get tokens locked in a dispute vote back once it is resolved.
    function withdrawMarkVotes(uint256 id) external {
        require(marks[id].state > 2, "Fund: not resolved");
        uint256 amount = markEscrow[id][msg.sender];
        require(amount > 0, "Fund: nothing locked");
        markEscrow[id][msg.sender] = 0;
        require(token.transfer(msg.sender, amount), "Fund: unlock failed");
    }

    /// @notice Cash held directly by the fund.
    function vaultCash() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /// @notice What the fund owns on the book's ladder: (tokens, mUSDC).
    function ownedLiquidity() public view returns (uint256 tokens, uint256 cash) {
        return book.inventory();
    }

    /// @notice Vault cash the GP can invest: without the surplus pot and without
    ///         dividends that are declared and not collected yet.
    function freeCash() public view returns (uint256) {
        return vaultCash() - surplus - dividendsUnclaimed - bondsHeld;
    }

    /// @notice Net assets = vault cash (surplus included; declared dividends and
    ///         valuation bonds not) + the fund's cash in the book + investments.
    function netAssets() public view returns (uint256) {
        (, uint256 bookCash) = ownedLiquidity();
        return vaultCash() - dividendsUnclaimed - bondsHeld + bookCash + investedValue;
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
    // 4. Surplus pot: buyback and dividend, both proposed by the GP and
    //    approved by holders
    // ==================================================================

    /// @notice The book reports the taker fee it has just paid into the vault.
    function fee(uint256 usdcAmount) external {
        require(msg.sender == address(book), "Fund: only the book");
        surplus += usdcAmount;
        emit SurplusAdded(usdcAmount, surplus);
    }

    /// @notice Anyone can move what the ladder has earned into the surplus pot:
    ///         cash on a rung above its share of 5% of net assets.
    function sweepLadder() external returns (uint256 taken) {
        require(saleClosed, "Fund: sale open");
        taken = book.skim((netAssets() * RESERVE_BPS) / 10_000);
        surplus += taken;
        emit SurplusAdded(taken, surplus);
    }

    /// @notice The GP buys tokens in the book with surplus money and burns them,
    ///         up to what holders approved. Only while the market is below NAV,
    ///         so a buyback never lowers NAV per token.
    /// @param ids Resting sell orders to buy from, cheapest first (may be empty).
    function buyback(uint256 usdcAmount, uint256[] calldata ids) external onlyGP {
        require(usdcAmount > 0 && usdcAmount <= buybackApproved && usdcAmount <= surplus, "Fund: above approved surplus");
        uint256 navBefore = navPerToken();
        require(marketPrice() < navBefore, "Fund: market not below NAV");

        usdc.approve(address(book), usdcAmount);
        (uint256 bought, uint256 spent) = book.buy(usdcAmount, 0, ids);
        usdc.approve(address(book), 0);
        // the fee on this purchase came back into the surplus through fee()
        buybackApproved -= spent;
        surplus -= spent;
        token.burn(bought);

        require(marketPrice() <= navBefore, "Fund: would push price above NAV");
        emit BuybackExecuted(msg.sender, spent, bought, marketPrice());
        _emitNAV();
    }

    /// @notice The GP pays an approved dividend out of the surplus: mUSDC per token
    ///         to every token in a wallet at this moment. Tokens in the order book,
    ///         tokens locked in a vote and unvested fee tokens get nothing, so
    ///         holders should take their tokens back first.
    function payDividend(uint256 usdcAmount) external onlyGP {
        require(usdcAmount > 0 && usdcAmount <= dividendApproved && usdcAmount <= surplus, "Fund: above approved surplus");
        uint256 entitled = token.totalSupply() - token.balanceOf(address(book)) - token.balanceOf(address(this))
            - token.balanceOf(address(vesting));
        require(entitled > 0, "Fund: no entitled tokens");
        uint256 per = (usdcAmount * 1e18) / entitled;
        uint256 paid = (per * entitled) / 1e18;
        dividendPerToken += per;
        dividendApproved -= usdcAmount;
        surplus -= paid;
        dividendsUnclaimed += paid;
        emit DividendPaid(paid, per);
        _emitNAV();
    }

    function _entitled(address who) private view returns (bool) {
        return who != address(0) && who != address(book) && who != address(this) && who != address(vesting);
    }

    function _accrue(address who) private {
        if (_entitled(who)) dividendOwed[who] += (token.balanceOf(who) * (dividendPerToken - dividendSeen[who])) / 1e18;
        dividendSeen[who] = dividendPerToken;
    }

    /// @notice Called by the token before a balance changes, so that dividends
    ///         stay with whoever held the tokens when they were paid.
    function settle(address from, address to) external {
        require(msg.sender == address(token), "Fund: only the token");
        _accrue(from);
        _accrue(to);
    }

    /// @notice Dividends a holder can collect.
    function dividendOf(address who) public view returns (uint256) {
        if (!_entitled(who)) return dividendOwed[who];
        return dividendOwed[who] + (token.balanceOf(who) * (dividendPerToken - dividendSeen[who])) / 1e18;
    }

    /// @notice Sends a holder's dividends to that holder. Anyone can trigger it,
    ///         so contracts that hold tokens (vaults, trading accounts) get theirs too.
    function claimDividend(address who) external returns (uint256 amount) {
        _accrue(who);
        amount = dividendOwed[who];
        require(amount > 0, "Fund: nothing to collect");
        dividendOwed[who] = 0;
        dividendsUnclaimed -= amount;
        require(usdc.transfer(who, amount), "Fund: payment failed");
        emit DividendClaimed(who, amount);
    }

    /// @notice Anyone can make the fund bring its liquidity in the book back to
    ///         5% of net assets with vault cash, for example after new tokens
    ///         were issued. Tokens the ladder holds count at NAV. The cash goes
    ///         onto the bid rungs from the market downwards.
    function topUpReserve() external returns (uint256 used) {
        require(saleClosed, "Fund: sale open");
        uint256 target = (netAssets() * RESERVE_BPS) / 10_000;
        (uint256 bookTokens, uint256 bookCash) = ownedLiquidity();
        uint256 have = bookCash + (bookTokens * navPerToken()) / ONE;
        require(have < target, "Fund: reserve at target");
        uint256 amount = target - have;
        if (amount > freeCash()) amount = freeCash();
        usdc.approve(address(book), amount);
        used = book.refill(amount, target, 250);
        usdc.approve(address(book), 0);
        emit ReserveToppedUp(used, target);
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
        _propose(KIND_ISSUANCE, tokenAmount);
        emit IssuanceProposed(issueProposalId, tokenAmount, issueDeadline);
    }

    /// @notice The GP asks holders to release mUSDC from the surplus pot for a
    ///         buyback (KIND_BUYBACK) or a dividend (KIND_DIVIDEND). Same vote as
    ///         for new tokens; one vote at a time.
    function proposeSurplusUse(uint8 kind, uint256 usdcAmount) external onlyGP {
        require(kind == KIND_BUYBACK || kind == KIND_DIVIDEND, "Fund: unknown kind");
        require(usdcAmount + buybackApproved + dividendApproved <= surplus, "Fund: above the surplus");
        _propose(kind, usdcAmount);
    }

    function _propose(uint8 kind, uint256 amount) private {
        require(saleClosed, "Fund: sale open");
        require(!issuanceVoteActive(), "Fund: vote already running");
        require(amount > 0, "Fund: zero amount");
        issueProposalId += 1;
        issueProposed = amount;
        issueKind = kind;
        issueDeadline = block.timestamp + VOTING_PERIOD;
        issueYes = 0;
        emit Proposed(issueProposalId, kind, amount, issueDeadline);
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
        emit Approved(issueProposalId, issueKind, amount);
        if (issueKind == KIND_BUYBACK) {
            buybackApproved += amount;
        } else if (issueKind == KIND_DIVIDEND) {
            dividendApproved += amount;
        } else {
            issuanceApproved += amount;
            emit IssuanceApproved(issueProposalId, amount, issuanceApproved);
        }
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
