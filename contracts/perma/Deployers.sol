// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./SubFund.sol";

// Why these two helpers exist:
// A contract that creates another contract carries the full bytecode of the
// created contract inside its own. One factory creating token + order book +
// vesting + sub-fund would be about 45 KB, far above the 24 KB limit per
// contract (EIP-170). Splitting creation across two small deployers keeps
// every contract deployable on a real network, not just in the Remix VM.

/// @title ComponentDeployer - creates token, order book and vesting for a sub-fund
/// @notice Called by a SubFund from its own constructor, so msg.sender
///         is the sub-fund and becomes the only minter of the new token.
/// @dev Split off so that ComponentDeployer stays under the size limit. Created by
///      ComponentDeployer's constructor, so it needs no deployment step of its own.
contract VestingDeployer {
    function deploy(address token, address fund, uint256 yearSeconds) external returns (address) {
        return address(new GPVesting(token, fund, yearSeconds));
    }
}

contract ComponentDeployer {
    VestingDeployer public immutable vestings = new VestingDeployer();

    function deploy(string calldata name, string calldata symbol, address usdc, uint256 yearSeconds)
        external
        returns (address token, address book, address vesting)
    {
        token = address(new FundToken(name, symbol, msg.sender));
        book = address(new OrderBook(token, usdc, msg.sender));
        vesting = vestings.deploy(token, msg.sender, yearSeconds);
    }
}

/// @title SubFundDeployer - creates the SubFund contract itself
contract SubFundDeployer {
    address public immutable components;

    constructor(address components_) {
        components = components_;
    }

    function deploy(
        string calldata name,
        string calldata symbol,
        address usdc,
        address gp,
        uint256 yearSeconds,
        uint256 votingSeconds
    ) external returns (address) {
        return address(new SubFund(name, symbol, usdc, gp, yearSeconds, votingSeconds, components));
    }
}
