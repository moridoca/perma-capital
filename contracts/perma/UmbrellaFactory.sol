// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./SubFund.sol";

interface ISubFundDeployer {
    function deploy(
        string calldata name,
        string calldata symbol,
        address usdc,
        address gp,
        uint256 yearSeconds,
        uint256 votingSeconds
    ) external returns (address);
}

/// @title UmbrellaFactory - the umbrella above all sub-funds
/// @notice One umbrella, several fully separate sub-funds. Each sub-fund has
///         its own token, vault, NAV, pool and fee schedule. Investors pick
///         their own exposure; nothing is pooled across sub-funds and there
///         is no fund-of-funds layer.
contract UmbrellaFactory {
    address public immutable sponsor;   // deploys sub-funds and is their first GP
    address public immutable usdc;
    address public immutable fundDeployer;
    uint256 public immutable YEAR;          // 31_536_000 (365 days) in production, short in the demo
    uint256 public immutable VOTING_PERIOD; // 604_800 (7 days) in production, short in the demo

    SubFund[] public subFunds;

    event SubFundCreated(
        uint256 indexed index,
        string name,
        string symbol,
        address fund,
        address token,
        address book,
        address vesting
    );

    constructor(address usdc_, address fundDeployer_, uint256 yearSeconds, uint256 votingSeconds) {
        sponsor = msg.sender;
        usdc = usdc_;
        fundDeployer = fundDeployer_;
        YEAR = yearSeconds;
        VOTING_PERIOD = votingSeconds;
    }

    /// @notice Launch a new sub-fund, e.g. ("Perma Buyout", "pBUY").
    function createSubFund(string calldata name, string calldata symbol) external returns (SubFund fund) {
        require(msg.sender == sponsor, "Umbrella: only sponsor");
        fund = SubFund(ISubFundDeployer(fundDeployer).deploy(name, symbol, usdc, sponsor, YEAR, VOTING_PERIOD));
        subFunds.push(fund);
        emit SubFundCreated(
            subFunds.length - 1,
            name,
            symbol,
            address(fund),
            address(fund.token()),
            address(fund.book()),
            address(fund.vesting())
        );
    }

    function subFundCount() external view returns (uint256) {
        return subFunds.length;
    }

    /// @notice All addresses and headline numbers of one sub-fund in one call.
    function overview(uint256 index)
        external
        view
        returns (
            string memory name,
            address fund,
            address token,
            address book,
            address vesting,
            uint256 navPerToken,
            uint256 marketPrice,
            int256 premiumBps,
            uint256 netAssets
        )
    {
        SubFund f = subFunds[index];
        return (
            f.name(),
            address(f),
            address(f.token()),
            address(f.book()),
            address(f.vesting()),
            f.navPerToken(),
            f.marketPrice(),
            f.premiumBps(),
            f.netAssets()
        );
    }
}
