// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./VaultManager.sol";
import "./SavingCert.sol";

/// @title SavingCore (v2 — Dual Ownership)
/// @notice Quản lý saving plans và deposit certificates.
///
/// ┌──────────────────────────────────────────────────────────────────┐
/// │  DUAL OWNERSHIP MODEL                                            │
/// │                                                                  │
/// │  depositor  = địa chỉ nạp tiền, ghi nhận vĩnh viễn khi mở        │
/// │               deposit. Chỉ depositor mới rút được tiền.          │
/// │                                                                  │
/// │  NFT owner  = người giữ SavingCert NFT hiện tại. NFT có thể      │
/// │               transfer tự do (bán, tặng, thế chấp DeFi).         │
/// │               NFT owner được gia hạn thay depositor.             │
/// │                                                                  │
/// │  ⇒ Mất NFT  ≠ Mất tiền. Depositor luôn rút được.                │
/// └──────────────────────────────────────────────────────────────────┘
///
/// @dev SavingCore KHÔNG kế thừa ERC721; NFT được uỷ thác cho SavingCert.
contract SavingCore is Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ─────────────────────── Constants ───────────────────────

    uint256 public constant SECONDS_PER_YEAR    = 365 * 24 * 3600;
    uint256 public constant BPS_DENOMINATOR     = 10_000;
    uint256 public constant GRACE_PERIOD_DEFAULT = 3 days;

    uint256 public gracePeriod = GRACE_PERIOD_DEFAULT;

    // ─────────────────────── Types ───────────────────────

    enum DepositStatus { Active, Withdrawn, ManualRenewed, AutoRenewed }

    struct SavingPlan {
        uint256 tenorSeconds;
        uint256 aprBps;
        uint256 minDeposit;
        uint256 maxDeposit;
        uint256 earlyWithdrawPenaltyBps;
        bool    enabled;
    }

    struct DepositCert {
        uint256 planId;
        uint256 principal;
        uint256 aprBpsAtOpen;
        uint256 penaltyBpsAtOpen;
        uint256 tenorSeconds;
        uint256 startAt;
        uint256 maturityAt;
        DepositStatus status;
        // ─── Dual-ownership fields ───────────────────────────────
        /// @notice Địa chỉ nạp tiền ban đầu — KHÔNG thay đổi bao giờ.
        ///         Đây là địa chỉ duy nhất có quyền rút gốc + lãi.
        address depositor;
    }

    // ─────────────────────── State ───────────────────────

    IERC20       public immutable token;
    VaultManager public immutable vault;
    SavingCert   public immutable cert;      // NFT contract tách biệt

    uint256 public nextPlanId;
    uint256 public nextDepositId;

    mapping(uint256 => SavingPlan)  public plans;
    mapping(uint256 => DepositCert) public deposits;

    uint256 public totalPrincipalLocked;
    uint256 public totalInterestOwed;

    // ─────────────────────── Events ───────────────────────

    event PlanCreated(uint256 indexed planId, uint256 tenorSeconds, uint256 aprBps);
    event PlanUpdated(uint256 indexed planId, uint256 newAprBps);
    event PlanEnabled(uint256 indexed planId);
    event PlanDisabled(uint256 indexed planId);

    event DepositOpened(
        uint256 indexed depositId,
        address indexed depositor,
        uint256 indexed planId,
        uint256 principal,
        uint256 maturityAt,
        uint256 aprBpsAtOpen
    );

    event Withdrawn(
        uint256 indexed depositId,
        address indexed depositor,
        uint256 principal,
        uint256 interest,
        bool    isEarly
    );

    event Renewed(
        uint256 indexed oldDepositId,
        uint256 indexed newDepositId,
        uint256 newPrincipal,
        uint256 indexed newPlanId
    );

    event GracePeriodUpdated(uint256 newGracePeriod);
    event PenaltyCollected(uint256 indexed depositId, address indexed receiver, uint256 amount);

    event InterestShortfall(
        uint256 indexed depositId,
        address indexed depositor,
        uint256 principal,
        uint256 interestOwed,
        uint256 interestPaid
    );

    event AdminForceClosed(
        uint256 indexed depositId,
        address indexed depositor,
        uint256 principal
    );

    // ─────────────────────── Errors ───────────────────────

    error PlanNotFound(uint256 planId);
    error PlanIsDisabled(uint256 planId);
    error AmountBelowMinimum(uint256 amount, uint256 min);
    error AmountAboveMaximum(uint256 amount, uint256 max);
    error DepositNotActive(uint256 depositId);
    error NotDepositor(uint256 depositId, address caller);
    error NotNftOwnerOrDepositor(uint256 depositId, address caller);
    error DepositNotMatured(uint256 depositId, uint256 maturityAt, uint256 now_);
    error GracePeriodNotExpired(uint256 depositId, uint256 gracePeriodEnd, uint256 now_);
    error ZeroAmount();
    error InvalidApr();

    // ─────────────────────── Constructor ───────────────────────

    /// @param _token   ERC20 token address (MockUSDC)
    /// @param _vault   VaultManager address
    /// @param _cert    SavingCert (ERC721) address
    constructor(address _token, address _vault, address _cert)
        Ownable(msg.sender)
    {
        token = IERC20(_token);
        vault = VaultManager(_vault);
        cert  = SavingCert(_cert);
    }

    // ─────────────────────── Admin ───────────────────────

    function createPlan(
        uint256 tenorSeconds,
        uint256 aprBps,
        uint256 minDeposit,
        uint256 maxDeposit,
        uint256 earlyWithdrawPenaltyBps
    ) external onlyOwner {
        if (aprBps == 0) revert InvalidApr();
        uint256 planId = nextPlanId++;
        plans[planId] = SavingPlan({
            tenorSeconds:            tenorSeconds,
            aprBps:                  aprBps,
            minDeposit:              minDeposit,
            maxDeposit:              maxDeposit,
            earlyWithdrawPenaltyBps: earlyWithdrawPenaltyBps,
            enabled:                 true
        });
        emit PlanCreated(planId, tenorSeconds, aprBps);
    }

    function updatePlan(uint256 planId, uint256 newAprBps) external onlyOwner {
        _requirePlanExists(planId);
        if (newAprBps == 0) revert InvalidApr();
        plans[planId].aprBps = newAprBps;
        emit PlanUpdated(planId, newAprBps);
    }

    function enablePlan(uint256 planId) external onlyOwner {
        _requirePlanExists(planId);
        plans[planId].enabled = true;
        emit PlanEnabled(planId);
    }

    function disablePlan(uint256 planId) external onlyOwner {
        _requirePlanExists(planId);
        plans[planId].enabled = false;
        emit PlanDisabled(planId);
    }

    function setGracePeriod(uint256 newGracePeriod) external onlyOwner {
        require(newGracePeriod > 0,        "Grace period phai lon hon 0");
        require(newGracePeriod <= 30 days, "Grace period qua dai");
        gracePeriod = newGracePeriod;
        emit GracePeriodUpdated(newGracePeriod);
    }

    /// @notice Admin force-close — chỉ trả gốc, không trả lãi.
    ///         Tiền trả về `depositor`, không phụ thuộc NFT owner.
    function adminForceClose(uint256 depositId) external onlyOwner {
        DepositCert storage d = deposits[depositId];
        require(d.status == DepositStatus.Active, "Not active");

        address depositor = d.depositor;
        uint256 principal = d.principal;

        uint256 interestWouldOwed = _calcInterest(d.principal, d.aprBpsAtOpen, d.tenorSeconds);

        d.status = DepositStatus.Withdrawn;
        totalPrincipalLocked -= principal;
        if (totalInterestOwed >= interestWouldOwed)
            totalInterestOwed -= interestWouldOwed;

        token.safeTransfer(depositor, principal);

        emit AdminForceClosed(depositId, depositor, principal);
        emit Withdrawn(depositId, depositor, principal, 0, false);
    }

    function integrityCheck() external view returns (
        bool isIntact, uint256 actual, uint256 expected, uint256 diff
    ) {
        actual   = token.balanceOf(address(this));
        expected = totalPrincipalLocked;
        isIntact = actual >= expected;
        diff     = isIntact ? 0 : expected - actual;
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ─────────────────────── User flows ───────────────────────

    /// @notice Mở deposit mới.
    ///         - `depositor` được ghi nhận vĩnh viễn = msg.sender
    ///         - NFT được mint cho msg.sender (có thể transfer sau)
    /// @return depositId ID của deposit (đồng thời là tokenId của NFT)
    function openDeposit(uint256 planId, uint256 amount)
        external
        whenNotPaused
        returns (uint256 depositId)
    {
        if (amount == 0) revert ZeroAmount();
        SavingPlan storage plan = _requirePlanEnabled(planId);
        if (plan.minDeposit > 0 && amount < plan.minDeposit)
            revert AmountBelowMinimum(amount, plan.minDeposit);
        if (plan.maxDeposit > 0 && amount > plan.maxDeposit)
            revert AmountAboveMaximum(amount, plan.maxDeposit);

        token.safeTransferFrom(msg.sender, address(this), amount);

        depositId = nextDepositId++;
        uint256 maturityAt = block.timestamp + plan.tenorSeconds;

        deposits[depositId] = DepositCert({
            planId:           planId,
            principal:        amount,
            aprBpsAtOpen:     plan.aprBps,
            penaltyBpsAtOpen: plan.earlyWithdrawPenaltyBps,
            tenorSeconds:     plan.tenorSeconds,
            startAt:          block.timestamp,
            maturityAt:       maturityAt,
            status:           DepositStatus.Active,
            depositor:        msg.sender          // ← ghi nhận vĩnh viễn
        });

        uint256 interestOwed = _calcInterest(amount, plan.aprBps, plan.tenorSeconds);
        totalPrincipalLocked += amount;
        totalInterestOwed    += interestOwed;

        // Mint NFT (depositId == tokenId để dễ đối chiếu)
        uint256 tokenId = cert.mint(msg.sender);
        require(tokenId == depositId, "tokenId mismatch"); // sanity check

        emit DepositOpened(depositId, msg.sender, planId, amount, maturityAt, plan.aprBps);
    }

    /// @notice Rút sau khi đáo hạn — nhận gốc + lãi.
    ///
    ///         ┌────────────────────────────────────────────────┐
    ///         │  Ai được gọi?  →  chỉ depositor               │
    ///         │  Tiền về đâu?  →  depositor                   │
    ///         │  NFT bị sao?   →  KHÔNG bị ảnh hưởng gì cả   │
    ///         └────────────────────────────────────────────────┘
    ///
    /// @dev Người mất NFT vẫn gọi được hàm này vì chỉ check depositor.
    function withdrawAtMaturity(uint256 depositId) external whenNotPaused {
        DepositCert storage d = _requireActiveDeposit(depositId);
        _requireDepositor(depositId, d);

        if (block.timestamp < d.maturityAt)
            revert DepositNotMatured(depositId, d.maturityAt, block.timestamp);

        uint256 interest = _calcInterest(d.principal, d.aprBpsAtOpen, d.tenorSeconds);

        d.status = DepositStatus.Withdrawn;
        totalPrincipalLocked -= d.principal;
        totalInterestOwed    -= interest;

        address depositor = d.depositor;

        token.safeTransfer(depositor, d.principal);

        uint256 vaultAvail = vault.vaultBalance();
        if (vaultAvail >= interest) {
            vault.payInterest(depositor, interest);
            emit Withdrawn(depositId, depositor, d.principal, interest, false);
        } else {
            if (vaultAvail > 0) vault.payInterest(depositor, vaultAvail);
            emit InterestShortfall(depositId, depositor, d.principal, interest, vaultAvail);
            emit Withdrawn(depositId, depositor, d.principal, vaultAvail, false);
        }
    }

    /// @notice Rút sớm trước đáo hạn — mất phạt, không có lãi.
    ///
    ///         ┌────────────────────────────────────────────────┐
    ///         │  Ai được gọi?  →  chỉ depositor               │
    ///         │  Tiền về đâu?  →  depositor                   │
    ///         └────────────────────────────────────────────────┘
    function earlyWithdraw(uint256 depositId) external whenNotPaused {
        DepositCert storage d = _requireActiveDeposit(depositId);
        _requireDepositor(depositId, d);

        require(block.timestamp < d.maturityAt, "Use withdrawAtMaturity");

        uint256 penalty      = (d.principal * d.penaltyBpsAtOpen) / BPS_DENOMINATOR;
        uint256 userReceives = d.principal - penalty;

        d.status = DepositStatus.Withdrawn;

        uint256 interestWouldOwed = _calcInterest(d.principal, d.aprBpsAtOpen, d.tenorSeconds);
        totalPrincipalLocked -= d.principal;
        if (totalInterestOwed >= interestWouldOwed)
            totalInterestOwed -= interestWouldOwed;

        address depositor = d.depositor;

        token.safeTransfer(depositor, userReceives);

        if (penalty > 0) {
            address receiver = vault.feeReceiver();
            token.safeTransfer(receiver, penalty);
            emit PenaltyCollected(depositId, receiver, penalty);
        }

        emit Withdrawn(depositId, depositor, d.principal, 0, true);
    }

    /// @notice Gia hạn thủ công sau đáo hạn sang plan mới.
    ///
    ///         ┌─────────────────────────────────────────────────────────┐
    ///         │  Ai được gọi?  →  depositor HOẶC NFT owner hiện tại    │
    ///         │  Depositor của deposit mới? →  kế thừa từ deposit cũ   │
    ///         │  NFT mới mint cho ai?       →  người gọi (msg.sender)  │
    ///         └─────────────────────────────────────────────────────────┘
    ///
    /// @dev Cho phép NFT owner gia hạn giúp depositor (vd: smart contract DeFi).
    ///      Depositor của deposit mới vẫn là depositor gốc — tiền không bị chiếm.
    function renewDeposit(uint256 depositId, uint256 newPlanId)
        external
        whenNotPaused
        returns (uint256 newDepositId)
    {
        DepositCert storage d = _requireActiveDeposit(depositId);
        _requireNftOwnerOrDepositor(depositId, d);

        if (block.timestamp < d.maturityAt)
            revert DepositNotMatured(depositId, d.maturityAt, block.timestamp);

        SavingPlan storage newPlan = _requirePlanEnabled(newPlanId);

        uint256 interest    = _calcInterest(d.principal, d.aprBpsAtOpen, d.tenorSeconds);
        uint256 oldPrincipal = d.principal;
        uint256 newPrincipal = oldPrincipal + interest;
        address originalDepositor = d.depositor; // kế thừa depositor

        vault.payInterest(address(this), interest);

        totalPrincipalLocked -= oldPrincipal;
        uint256 oldInterestOwed = _calcInterest(oldPrincipal, d.aprBpsAtOpen, d.tenorSeconds);
        if (totalInterestOwed >= oldInterestOwed)
            totalInterestOwed -= oldInterestOwed;

        d.status = DepositStatus.ManualRenewed;

        newDepositId = nextDepositId++;
        uint256 newMaturityAt  = block.timestamp + newPlan.tenorSeconds;
        uint256 newInterestOwed = _calcInterest(newPrincipal, newPlan.aprBps, newPlan.tenorSeconds);
        totalPrincipalLocked += newPrincipal;
        totalInterestOwed    += newInterestOwed;

        deposits[newDepositId] = DepositCert({
            planId:           newPlanId,
            principal:        newPrincipal,
            aprBpsAtOpen:     newPlan.aprBps,
            penaltyBpsAtOpen: newPlan.earlyWithdrawPenaltyBps,
            tenorSeconds:     newPlan.tenorSeconds,
            startAt:          block.timestamp,
            maturityAt:       newMaturityAt,
            status:           DepositStatus.Active,
            depositor:        originalDepositor   // ← kế thừa, không đổi
        });

        // NFT mới mint cho msg.sender (NFT owner cũ hoặc depositor)
        uint256 tokenId = cert.mint(msg.sender);
        require(tokenId == newDepositId, "tokenId mismatch");

        emit Renewed(depositId, newDepositId, newPrincipal, newPlanId);
    }

    /// @notice Auto-renew sau khi hết grace period — gọi bởi bot.
    ///
    ///         ┌─────────────────────────────────────────────────────────┐
    ///         │  Ai được gọi?       →  bất kỳ (permissionless)         │
    ///         │  Depositor kế thừa? →  có, từ deposit cũ              │
    ///         │  NFT mới mint cho?  →  depositor (không phải bot)      │
    ///         └─────────────────────────────────────────────────────────┘
    function autoRenewDeposit(uint256 depositId)
        external
        whenNotPaused
        returns (uint256 newDepositId)
    {
        DepositCert storage d = _requireActiveDeposit(depositId);

        uint256 gracePeriodEnd = d.maturityAt + gracePeriod;
        if (block.timestamp < gracePeriodEnd)
            revert GracePeriodNotExpired(depositId, gracePeriodEnd, block.timestamp);

        address originalDepositor = d.depositor;

        uint256 interest     = _calcInterest(d.principal, d.aprBpsAtOpen, d.tenorSeconds);
        uint256 oldPrincipal = d.principal;
        uint256 newPrincipal = oldPrincipal + interest;

        vault.payInterest(address(this), interest);

        totalPrincipalLocked -= oldPrincipal;
        uint256 oldInterestOwed = _calcInterest(oldPrincipal, d.aprBpsAtOpen, d.tenorSeconds);
        if (totalInterestOwed >= oldInterestOwed)
            totalInterestOwed -= oldInterestOwed;

        d.status = DepositStatus.AutoRenewed;

        newDepositId = nextDepositId++;
        uint256 newMaturityAt  = block.timestamp + d.tenorSeconds;
        uint256 newInterestOwed = _calcInterest(newPrincipal, d.aprBpsAtOpen, d.tenorSeconds);
        totalPrincipalLocked += newPrincipal;
        totalInterestOwed    += newInterestOwed;

        deposits[newDepositId] = DepositCert({
            planId:           d.planId,
            principal:        newPrincipal,
            aprBpsAtOpen:     d.aprBpsAtOpen,
            penaltyBpsAtOpen: d.penaltyBpsAtOpen,
            tenorSeconds:     d.tenorSeconds,
            startAt:          block.timestamp,
            maturityAt:       newMaturityAt,
            status:           DepositStatus.Active,
            depositor:        originalDepositor   // ← bot không thể chiếm tiền
        });

        // NFT mint về depositor, không phải bot
        uint256 tokenId = cert.mint(originalDepositor);
        require(tokenId == newDepositId, "tokenId mismatch");

        emit Renewed(depositId, newDepositId, newPrincipal, d.planId);
    }

    // ─────────────────────── Views ───────────────────────

    function vaultSolvencyCheck() external view returns (bool sufficient, uint256 shortfall) {
        uint256 vaultBal = vault.vaultBalance();
        if (vaultBal >= totalInterestOwed) return (true, 0);
        return (false, totalInterestOwed - vaultBal);
    }

    function financialSummary() external view returns (
        uint256 principalLocked,
        uint256 interestOwed,
        uint256 vaultBalance,
        bool    isSolvent,
        uint256 shortfall
    ) {
        principalLocked = totalPrincipalLocked;
        interestOwed    = totalInterestOwed;
        vaultBalance    = vault.vaultBalance();
        isSolvent       = vaultBalance >= interestOwed;
        shortfall       = isSolvent ? 0 : interestOwed - vaultBalance;
    }

    function calcInterest(uint256 principal, uint256 aprBps, uint256 tenorSeconds)
        external pure returns (uint256)
    {
        return _calcInterest(principal, aprBps, tenorSeconds);
    }

    function getDeposit(uint256 depositId) external view returns (DepositCert memory) {
        return deposits[depositId];
    }

    function getPlan(uint256 planId) external view returns (SavingPlan memory) {
        return plans[planId];
    }

    /// @notice Tiện ích: lấy NFT owner hiện tại của một deposit
    function getNftOwner(uint256 depositId) external view returns (address) {
        return cert.ownerOf(depositId);
    }

    /// @notice Tiện ích: lấy depositor của một deposit
    function getDepositor(uint256 depositId) external view returns (address) {
        return deposits[depositId].depositor;
    }

    // ─────────────────────── Internal helpers ───────────────────────

    function _calcInterest(
        uint256 principal,
        uint256 aprBps,
        uint256 tenorSeconds
    ) internal pure returns (uint256) {
        return (principal * aprBps * tenorSeconds) / (SECONDS_PER_YEAR * BPS_DENOMINATOR);
    }

    function _requirePlanExists(uint256 planId) internal view {
        if (planId >= nextPlanId) revert PlanNotFound(planId);
    }

    function _requirePlanEnabled(uint256 planId) internal view returns (SavingPlan storage plan) {
        _requirePlanExists(planId);
        plan = plans[planId];
        if (!plan.enabled) revert PlanIsDisabled(planId);
    }

    function _requireActiveDeposit(uint256 depositId) internal view returns (DepositCert storage d) {
        d = deposits[depositId];
        if (d.status != DepositStatus.Active) revert DepositNotActive(depositId);
    }

    /// @dev Chỉ depositor mới được rút tiền
    function _requireDepositor(uint256 depositId, DepositCert storage d) internal view {
        if (d.depositor != msg.sender) revert NotDepositor(depositId, msg.sender);
    }

    /// @dev NFT owner HOẶC depositor đều được gia hạn
    function _requireNftOwnerOrDepositor(uint256 depositId, DepositCert storage d) internal view {
        bool isDepositor = (d.depositor == msg.sender);
        bool isNftOwner  = false;
        try cert.ownerOf(depositId) returns (address nftOwner) {
            isNftOwner = (nftOwner == msg.sender);
        } catch {}
        if (!isDepositor && !isNftOwner)
            revert NotNftOwnerOrDepositor(depositId, msg.sender);
    }
}


