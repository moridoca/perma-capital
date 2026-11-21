// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ERC20.sol";

/// @title MockUSDC - test stablecoin for the prototype
/// @notice Anyone can mint. This is play money for Remix VM / testnets only.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "mUSDC") {}

    /// @notice Mint 100,000 mUSDC to the caller.
    function faucet() external {
        _mint(msg.sender, 100_000e6);
    }

    /// @notice Mint any amount to any address (demo convenience).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
