// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockUSDC
/// @notice A mock ERC20 token with 6 decimals for testing purposes
contract MockUSDC is ERC20, Ownable {
    constructor() ERC20("Mock USDC", "USDC") Ownable(msg.sender) {}

    /// @notice Returns 6 decimals to mimic real USDC
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint tokens to any address (for testing)
    /// @param to Recipient address
    /// @param amount Amount in smallest unit (1 USDC = 1_000_000)
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}

