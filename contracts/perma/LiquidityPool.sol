// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title LiquidityPool - the secondary market of one sub-fund
/// @notice Constant-product AMM (x * y = k) for FundToken / mUSDC with a
///         0.30% swap fee that stays in the pool and accrues to liquidity
///         providers. Nobody sets the price: it is whatever the reserves say.
contract LiquidityPool {
    uint256 public constant FEE_BPS = 30; // 0.30%
    uint256 private constant ONE = 1e6;

    IERC20Like public immutable token;
    IERC20Like public immutable usdc;

    uint256 public reserveToken;
    uint256 public reserveUSDC;

    uint256 public totalShares;
    mapping(address => uint256) public shares;

    bool private locked;

    event LiquidityAdded(address indexed provider, uint256 tokenIn, uint256 usdcIn, uint256 sharesMinted);
    event LiquidityRemoved(address indexed provider, uint256 tokenOut, uint256 usdcOut, uint256 sharesBurned);
    event Swap(address indexed trader, bool usdcForToken, uint256 amountIn, uint256 amountOut, uint256 priceAfter);

    modifier nonReentrant() {
        require(!locked, "Pool: reentrancy");
        locked = true;
        _;
        locked = false;
    }

    constructor(address token_, address usdc_) {
        token = IERC20Like(token_);
        usdc = IERC20Like(usdc_);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Market price: mUSDC per 1 token, 6 decimals (1_000000 = $1.00).
    function spotPrice() public view returns (uint256) {
        if (reserveToken == 0) return 0;
        return (reserveUSDC * ONE) / reserveToken;
    }

    function quoteUSDCForToken(uint256 usdcIn) public view returns (uint256 tokenOut) {
        return _amountOut(usdcIn, reserveUSDC, reserveToken);
    }

    function quoteTokenForUSDC(uint256 tokenIn) public view returns (uint256 usdcOut) {
        return _amountOut(tokenIn, reserveToken, reserveUSDC);
    }

    function _amountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) private pure returns (uint256) {
        if (amountIn == 0 || reserveIn == 0 || reserveOut == 0) return 0;
        uint256 inAfterFee = amountIn * (10_000 - FEE_BPS);
        return (inAfterFee * reserveOut) / (reserveIn * 10_000 + inAfterFee);
    }

    // ------------------------------------------------------------------
    // Liquidity
    // ------------------------------------------------------------------

    /// @notice Add liquidity. The first provider sets the price. Later
    ///         providers give tokenAmount and the matching mUSDC at the
    ///         current ratio (at most usdcMax).
    function addLiquidity(uint256 tokenAmount, uint256 usdcMax) external nonReentrant returns (uint256 minted) {
        require(tokenAmount > 0, "Pool: zero amount");
        uint256 usdcAmount;
        if (totalShares == 0) {
            usdcAmount = usdcMax;
            require(usdcAmount > 0, "Pool: zero amount");
            minted = _sqrt(tokenAmount * usdcAmount);
        } else {
            // round the mUSDC side up so existing LPs are never diluted
            usdcAmount = (tokenAmount * reserveUSDC + reserveToken - 1) / reserveToken;
            require(usdcAmount <= usdcMax, "Pool: usdcMax too low");
            minted = (tokenAmount * totalShares) / reserveToken;
        }
        require(minted > 0, "Pool: zero shares");

        reserveToken += tokenAmount;
        reserveUSDC += usdcAmount;
        totalShares += minted;
        shares[msg.sender] += minted;

        require(token.transferFrom(msg.sender, address(this), tokenAmount), "Pool: token transfer failed");
        require(usdc.transferFrom(msg.sender, address(this), usdcAmount), "Pool: usdc transfer failed");
        emit LiquidityAdded(msg.sender, tokenAmount, usdcAmount, minted);
    }

    function removeLiquidity(uint256 shareAmount) external nonReentrant returns (uint256 tokenOut, uint256 usdcOut) {
        require(shareAmount > 0 && shares[msg.sender] >= shareAmount, "Pool: bad share amount");
        tokenOut = (shareAmount * reserveToken) / totalShares;
        usdcOut = (shareAmount * reserveUSDC) / totalShares;

        shares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        reserveToken -= tokenOut;
        reserveUSDC -= usdcOut;

        require(token.transfer(msg.sender, tokenOut), "Pool: token transfer failed");
        require(usdc.transfer(msg.sender, usdcOut), "Pool: usdc transfer failed");
        emit LiquidityRemoved(msg.sender, tokenOut, usdcOut, shareAmount);
    }

    // ------------------------------------------------------------------
    // Trading
    // ------------------------------------------------------------------

    /// @notice Buy fund tokens with mUSDC.
    function swapUSDCForToken(uint256 usdcIn, uint256 minTokenOut) external nonReentrant returns (uint256 tokenOut) {
        tokenOut = quoteUSDCForToken(usdcIn);
        require(tokenOut > 0, "Pool: zero output");
        require(tokenOut >= minTokenOut, "Pool: slippage");

        reserveUSDC += usdcIn;
        reserveToken -= tokenOut;

        require(usdc.transferFrom(msg.sender, address(this), usdcIn), "Pool: usdc transfer failed");
        require(token.transfer(msg.sender, tokenOut), "Pool: token transfer failed");
        emit Swap(msg.sender, true, usdcIn, tokenOut, spotPrice());
    }

    /// @notice Sell fund tokens for mUSDC.
    function swapTokenForUSDC(uint256 tokenIn, uint256 minUSDCOut) external nonReentrant returns (uint256 usdcOut) {
        usdcOut = quoteTokenForUSDC(tokenIn);
        require(usdcOut > 0, "Pool: zero output");
        require(usdcOut >= minUSDCOut, "Pool: slippage");

        reserveToken += tokenIn;
        reserveUSDC -= usdcOut;

        require(token.transferFrom(msg.sender, address(this), tokenIn), "Pool: token transfer failed");
        require(usdc.transfer(msg.sender, usdcOut), "Pool: usdc transfer failed");
        emit Swap(msg.sender, false, tokenIn, usdcOut, spotPrice());
    }

    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
