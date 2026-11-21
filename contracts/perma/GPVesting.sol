// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFundTokenBurnable {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function burn(uint256 amount) external;
}

interface ISubFundGP {
    function gp() external view returns (address);
}

/// @title GPVesting - holds the manager's fee tokens until they vest
/// @notice Each yearly fee mint is one tranche. A tranche unlocks in full
///         one "year" after it was minted. If token holders remove the GP,
///         everything that has not vested yet is burned.
///         Tokens sitting here are excluded from governance voting weight.
contract GPVesting {
    struct Tranche {
        uint64 mintedAt;
        uint192 amount;
    }

    IFundTokenBurnable public immutable token;
    address public immutable fund;
    uint256 public immutable vestingPeriod;

    Tranche[] public tranches;
    uint256 public claimed;

    event TrancheAdded(uint256 indexed index, uint256 amount, uint256 unlocksAt);
    event Claimed(address indexed gp, uint256 amount);
    event Forfeited(address indexed oldGP, uint256 paidOutVested, uint256 burnedUnvested);

    modifier onlyFund() {
        require(msg.sender == fund, "Vesting: only fund");
        _;
    }

    constructor(address token_, address fund_, uint256 vestingPeriod_) {
        token = IFundTokenBurnable(token_);
        fund = fund_;
        vestingPeriod = vestingPeriod_;
    }

    function trancheCount() external view returns (uint256) {
        return tranches.length;
    }

    /// @notice Total amount whose lock-up has expired (claimed or not).
    function vested() public view returns (uint256 total) {
        for (uint256 i = 0; i < tranches.length; i++) {
            if (block.timestamp >= uint256(tranches[i].mintedAt) + vestingPeriod) {
                total += tranches[i].amount;
            }
        }
    }

    function claimable() public view returns (uint256) {
        return vested() - claimed;
    }

    function unvested() public view returns (uint256) {
        return token.balanceOf(address(this)) - claimable();
    }

    /// @dev Called by the sub-fund right after it minted fee tokens to this contract.
    function notifyTranche(uint256 amount) external onlyFund {
        tranches.push(Tranche(uint64(block.timestamp), uint192(amount)));
        emit TrancheAdded(tranches.length - 1, amount, block.timestamp + vestingPeriod);
    }

    /// @notice Current GP withdraws everything that has vested.
    function claim() external returns (uint256 amount) {
        address gp = ISubFundGP(fund).gp();
        require(msg.sender == gp, "Vesting: only GP");
        amount = claimable();
        require(amount > 0, "Vesting: nothing vested");
        claimed += amount;
        require(token.transfer(gp, amount), "Vesting: transfer failed");
        emit Claimed(gp, amount);
    }

    /// @dev GP removal: pay the old GP what already vested, burn the rest.
    function forfeit(address oldGP) external onlyFund returns (uint256 burned) {
        uint256 payout = claimable();
        for (uint256 i = 0; i < tranches.length; i++) {
            if (block.timestamp < uint256(tranches[i].mintedAt) + vestingPeriod) {
                burned += tranches[i].amount;
                tranches[i].amount = 0;
            }
        }
        if (payout > 0) {
            claimed += payout;
            require(token.transfer(oldGP, payout), "Vesting: transfer failed");
        }
        if (burned > 0) token.burn(burned);
        emit Forfeited(oldGP, payout, burned);
    }
}
