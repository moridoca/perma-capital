// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ERC20.sol";

/// @title FundToken - one share class of one sub-fund
/// @notice Freely transferable ERC-20. No whitelist, no transfer hooks.
///         Only the sub-fund contract can mint, and the sub-fund's code
///         only mints in four rule-bound situations:
///         primary sale (capped), liquidity seed (once),
///         management fee (2% p.a., lifetime cap), follow-on (at or above NAV).
///         Supply policy is therefore code, not a manager decision.
contract FundToken is ERC20 {
    address public immutable fund;

    constructor(string memory name_, string memory symbol_, address fund_) ERC20(name_, symbol_) {
        fund = fund_;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == fund, "FundToken: only fund");
        _mint(to, amount);
    }

    /// @notice Anyone can burn their own tokens (used by buyback-and-burn).
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
