// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title SavingCert
/// @notice Standalone ERC721 NFT đại diện cho deposit certificate.
///         NFT có thể được transfer tự do (tặng, bán, thế chấp DeFi),
///         nhưng KHÔNG ảnh hưởng đến quyền rút tiền — quyền rút tiền
///         thuộc về `depositor` ghi nhận tại thời điểm mở deposit.
///
/// @dev    Chỉ SavingCore (được set qua setSavingCore) mới được mint/burn.
contract SavingCert is ERC721, Ownable {

    // ─────────────────────── State ───────────────────────

    /// @notice Địa chỉ SavingCore duy nhất được phép mint/burn
    address public savingCore;

    /// @notice tokenId tiếp theo sẽ được mint
    uint256 public nextTokenId;

    // ─────────────────────── Events ───────────────────────

    event SavingCoreUpdated(address indexed oldCore, address indexed newCore);

    // ─────────────────────── Errors ───────────────────────

    error OnlySavingCore();
    error ZeroAddress();
    error SavingCoreAlreadySet();

    // ─────────────────────── Modifier ───────────────────────

    modifier onlySavingCore() {
        if (msg.sender != savingCore) revert OnlySavingCore();
        _;
    }

    // ─────────────────────── Constructor ───────────────────────

    constructor() ERC721("ChainSave Certificate", "CSAVE") Ownable(msg.sender) {}

    // ─────────────────────── Admin ───────────────────────

    /// @notice Liên kết SavingCore sau khi deploy (chỉ set được một lần)
    /// @param _savingCore Địa chỉ SavingCore contract
    function setSavingCore(address _savingCore) external onlyOwner {
        if (_savingCore == address(0)) revert ZeroAddress();
        if (savingCore != address(0)) revert SavingCoreAlreadySet();
        emit SavingCoreUpdated(savingCore, _savingCore);
        savingCore = _savingCore;
    }

    // ─────────────────────── SavingCore interface ───────────────────────

    /// @notice Mint một NFT mới cho `to`, trả về tokenId
    /// @dev    Chỉ SavingCore được gọi
    /// @param  to Địa chỉ nhận NFT (thường là depositor)
    /// @return tokenId Token ID vừa mint
    function mint(address to) external onlySavingCore returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _safeMint(to, tokenId);
    }

    // ─────────────────────── Views ───────────────────────

    /// @notice Kiểm tra xem tokenId đã tồn tại chưa
    function exists(uint256 tokenId) external view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }
}

