// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title VaultManager
/// @notice Holds the liquidity pool used to pay interest to depositors.
///         Only the SavingCore contract can request interest payouts.
contract VaultManager is Ownable, Pausable {
    using SafeERC20 for IERC20;

    /// @notice The token managed by this vault (e.g. MockUSDC)
    IERC20 public immutable token;

    /// @notice Address that receives early-withdrawal penalties
    address public feeReceiver;

    /// @notice The SavingCore contract authorised to pull interest
    address public savingCore;

    // ─────────────────────── Events ───────────────────────
    event VaultFunded(address indexed by, uint256 amount);
    event VaultWithdrawn(address indexed by, uint256 amount);
    event FeeReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);
    event SavingCoreUpdated(address indexed oldCore, address indexed newCore);
    event InterestPaid(address indexed to, uint256 amount);
    event PenaltyForwarded(address indexed to, uint256 amount);

    // ─────────────────────── Errors ───────────────────────
    error OnlySavingCore();
    error ZeroAddress();
    error InsufficientVaultBalance(uint256 available, uint256 requested);
    error ZeroAmount();

    modifier onlySavingCore() {
        if (msg.sender != savingCore) revert OnlySavingCore();
        _;
    }

    /// @param _token   The ERC20 token address
    /// @param _feeReceiver Address to receive early-withdrawal penalties
    constructor(address _token, address _feeReceiver) Ownable(msg.sender) {
        if (_token == address(0) || _feeReceiver == address(0)) revert ZeroAddress();
        token = IERC20(_token);
        feeReceiver = _feeReceiver;
    }

    // ─────────────────────── Admin ───────────────────────

    /// @notice Link the SavingCore contract (call once after deployment)
    function setSavingCore(address _savingCore) external onlyOwner {
        if (_savingCore == address(0)) revert ZeroAddress();
        emit SavingCoreUpdated(savingCore, _savingCore);
        savingCore = _savingCore;
    }

    /// @notice Update the penalty fee receiver
    function setFeeReceiver(address _feeReceiver) external onlyOwner {
        if (_feeReceiver == address(0)) revert ZeroAddress();
        emit FeeReceiverUpdated(feeReceiver, _feeReceiver);
        feeReceiver = _feeReceiver;
    }

    /// @notice Admin deposits tokens into the vault to cover future interest
    /// @param amount Amount of tokens to fund (in smallest unit)
    function fundVault(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit VaultFunded(msg.sender, amount);
    }

    /// @notice Admin withdraws excess tokens from the vault
    /// @param amount Amount to withdraw
    function withdrawVault(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        uint256 balance = token.balanceOf(address(this));
        if (balance < amount) revert InsufficientVaultBalance(balance, amount);
        token.safeTransfer(msg.sender, amount);
        emit VaultWithdrawn(msg.sender, amount);
    }

    /// @notice Emergency pause — blocks all vault payouts
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume normal operation
    function unpause() external onlyOwner {
        _unpause();
    }

    // ─────────────────────── SavingCore interface ───────────────────────

    /// @notice Pay interest from the vault to a depositor
    /// @param to       Recipient address
    /// @param amount   Interest amount (in smallest unit)
    function payInterest(address to, uint256 amount) external onlySavingCore whenNotPaused {
        if (amount == 0) return;
        uint256 balance = token.balanceOf(address(this));
        if (balance < amount) revert InsufficientVaultBalance(balance, amount);
        token.safeTransfer(to, amount);
        emit InterestPaid(to, amount);
    }

    /// @notice Forward a penalty to the feeReceiver
    /// @param amount Penalty amount (in smallest unit)
    function forwardPenalty(uint256 amount) external onlySavingCore whenNotPaused {
        if (amount == 0) return;
        token.safeTransfer(feeReceiver, amount);
        emit PenaltyForwarded(feeReceiver, amount);
    }

    // ─────────────────────── Views ───────────────────────

    /// @notice Current token balance of the vault
    function vaultBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}

