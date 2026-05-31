// frontend/src/contracts.js
export const ADDRESSES = {
  MockUSDC:    "0xA54E7941dfaDaf47DBe662b2d0c925E8659b9d37",
  VaultManager:"0xd78F148562A806332c6c6DD4A1552009090638B5",
  SavingCert:  "0x5B55e598de0987eEC84D13483f457F9Ab432Afc3", // cập nhật sau khi deploy
  SavingCore:  "0xd6613AE6b7919761B618Ccb2DfEF302E885b5791",
};

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

export const VAULT_ABI = [
  "function vaultBalance() view returns (uint256)",
  "function feeReceiver() view returns (address)",
  "function fundVault(uint256 amount)",
  "function withdrawVault(uint256 amount)",
];

export const CORE_ABI = [
  // ── Views ──────────────────────────────────────────────────────────────
  "function nextPlanId() view returns (uint256)",
  "function nextDepositId() view returns (uint256)",
  "function getPlan(uint256 planId) view returns (tuple(uint256 tenorSeconds, uint256 aprBps, uint256 minDeposit, uint256 maxDeposit, uint256 earlyWithdrawPenaltyBps, bool enabled))",

  // getDeposit now includes depositor field (index 8)
  "function getDeposit(uint256 depositId) view returns (tuple(uint256 planId, uint256 principal, uint256 aprBpsAtOpen, uint256 penaltyBpsAtOpen, uint256 tenorSeconds, uint256 startAt, uint256 maturityAt, uint8 status, address depositor))",

  "function calcInterest(uint256 principal, uint256 aprBps, uint256 tenorSeconds) pure returns (uint256)",
  "function gracePeriod() view returns (uint256)",
  "function financialSummary() view returns (uint256,uint256,uint256,bool,uint256)",
  "function vaultSolvencyCheck() view returns (bool,uint256)",
  "function integrityCheck() view returns (bool,uint256,uint256,uint256)",

  // Dual-ownership helpers
  "function getNftOwner(uint256 depositId) view returns (address)",
  "function getDepositor(uint256 depositId) view returns (address)",

  // ── Transactions ───────────────────────────────────────────────────────
  "function openDeposit(uint256 planId, uint256 amount) returns (uint256)",
  "function withdrawAtMaturity(uint256 depositId)",     // chỉ depositor
  "function earlyWithdraw(uint256 depositId)",          // chỉ depositor
  "function renewDeposit(uint256 depositId, uint256 newPlanId) returns (uint256)", // depositor hoặc NFT owner
  "function autoRenewDeposit(uint256 depositId) returns (uint256)",

  // ── Events ─────────────────────────────────────────────────────────────
  "event DepositOpened(uint256 indexed depositId, address indexed depositor, uint256 indexed planId, uint256 principal, uint256 maturityAt, uint256 aprBpsAtOpen)",
  "event Withdrawn(uint256 indexed depositId, address indexed depositor, uint256 principal, uint256 interest, bool isEarly)",
  "event Renewed(uint256 indexed oldDepositId, uint256 indexed newDepositId, uint256 newPrincipal, uint256 indexed newPlanId)",
];

// ABI cho SavingCert NFT (nếu frontend cần đọc trực tiếp)
export const CERT_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function approve(address to, uint256 tokenId)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function nextTokenId() view returns (uint256)",
  "function savingCore() view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)",
];
