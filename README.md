#  ChainSave — Blockchain Term Deposit System

> **A decentralized fixed-term deposit system built on Blockchain**

ChainSave allows users to deposit assets (MockUSDC) into Saving Plans created by the Admin and earn interest (APR). Each deposit is uniquely represented by an **NFT (ERC721)** that acts as an on-chain certificate of deposit.


---

### 🧑‍💻 For Depositors (Users)

| Feature | Description |
|---|---|
| **Dual Ownership Security** | The system separates *Utility Rights* (NFT) from *Asset Rights* (Depositor wallet). Even if your wallet is compromised and the NFT is stolen, the hacker cannot withdraw your funds. Only the original depositor address can claim the principal and interest. |
| **Open Deposit & Snapshot** | Users select an active saving plan, lock USDC, and receive a transferable ERC721 NFT certificate. The APR and Penalty rates are **snapshotted (immutable)** at the moment of deposit, protecting users from future admin rate changes. |
| **NFT Composability** | The ERC721 certificate can be freely transferred, traded on secondary markets, or used as collateral in other DeFi protocols, all without compromising the core deposit's security. |
| **Withdraw at Maturity** | Withdraw the exact principal plus accumulated simple interest. The interest is dynamically calculated using precision math (Basis Points) to avoid EVM rounding errors. |
| **Early Withdraw** | Users can break the term early for emergency liquidity. No interest is paid, and a predetermined penalty fee is deducted from the principal and routed to the Treasury. |
| **Manual Renew** | Users can manually roll over their matured deposit into a new plan. Earned interest is compounded into the new principal, saving gas compared to a separate withdraw-and-deposit action. |
| **Auto Renew (Grace Period)** | If a user forgets to withdraw after the Grace Period (e.g., 3 days), the system automatically renews the deposit using the *original APR* to protect the user against rate drops. |

### 👑 For Admins (Treasury Management)

| Feature | Description |
|---|---|
| **Dynamic Plan Management** | Create and configure diverse saving products (Tenor days, APR in basis points, Min/Max limits, Early withdrawal penalty rates). Admins can enable/disable plans at any time to control new deposits. |
| **Vault Segregation** | User principals are locked securely in the `SavingCore`, while the interest payout pool is managed separately in the `VaultManager`. This prevents mixing funds and ensures accounting clarity. |
| **Solvency Dashboard** | Built-in `financialSummary()` function allows Admins to monitor real-time system health (Total Principal Locked vs. Interest Owed vs. Available Vault Balance) to prevent liquidity shortfalls. |
| **Emergency Circuit Breaker** | Inherits OpenZeppelin's `Pausable`. Admins can instantly freeze all withdrawals and renewals during a black swan event or identified vulnerability. |

### 🛡️ Advanced Architecture & Automation

| System Feature | Description |
|---|---|
| **Cross-Contract Authorization** | Strict access control modifiers (`onlySavingCore`). The Vault will only release funds or forward penalties when explicitly instructed by the core logic, preventing rogue Admin withdrawals. |
| **Off-chain Keeper Bot** | A robust Node.js/TypeScript batch job runs daily to trigger `autoRenewDeposit` for overdue certificates. Includes smart fallback mechanisms (reading on-chain parameters first, falling back to `.env` if RPC fails). |

## 🏗 System Architecture

The system is composed of **4 core components** working closely together:

### 1. 📜 Smart Contracts (Solidity 0.8.26 — OpenZeppelin v5)

| Contract | Role |
|---|---|
| `MockUSDC.sol` | ERC20 token simulating USDC (6 decimals) for testing, with mint functionality for Admin. |
| `VaultManager.sol` | Interest pool treasury — manages the fee receiver address, authorizes interest payouts, and controls the Pause state. |
| `SavingCore.sol` | The heart of the project — manages saving plans, issues NFT certificates (ERC721), and handles all interest/penalty calculation logic. |

### 2. 🖥️ Frontend (React + Vite + ethers.js v6)

- Interacts directly with Smart Contracts via **MetaMask** on the **Sepolia** network.
- Role-based UI: **Admin** view (management dashboard) and **User** view (Deposit, Withdraw, Renew tabs).

### 3. 🤖 Auto-Renew Bot (Node.js/TypeScript)

- A daily batch job that scans on-chain Events.
- Detects deposits that have exceeded the Grace Period and calls `autoRenewDeposit` to safeguard user funds.

### 4. 🌐 Network / Backend

- **Sepolia Testnet** via **Infura** as the RPC provider.

---

## 📂 Project Structure

```
chainsave/
├── contracts/              # Smart contract source code
│   ├── MockUSDC.sol
│   ├── SavingCore.sol
│   └── VaultManager.sol
|   └── SavingCert.sol
├── deploy/                 # Deployment script (auto-updates frontend ABI)
│   └── deploy.ts
├── scripts/                # Supporting scripts
│   └── autoRenewBot.ts     # Bot for scanning and auto-renewing deposits
├── test/                   # Smart contract unit tests
│   └── SavingCore.test.ts
├── typechain-types/        # Type definitions auto-generated on compile
├── frontend/               # ReactJS web application (Vite)
│   ├── public/             # Images, icons
│   ├── src/
│   │   ├── assets/
│   │   ├── App.css
│   │   ├── App.jsx         # Main UI logic
│   │   ├── contracts.js    # Contract addresses & ABI (auto-generated on deploy)
│   │   ├── index.css       # Styling
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── hardhat.config.ts       # Hardhat config (compiler, Sepolia network, Etherscan)
├── tsconfig.json
├── tsconfig.node.json
├── package.json
├── .env                    # Environment variables (Private key, API Keys) — do not commit
├── .gitignore
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS version recommended)
- [MetaMask Extension](https://metamask.io/)
- [Infura](https://infura.io/) and [Etherscan](https://etherscan.io/) accounts (for API Keys)

---

### Step 1: Install & Configure Environment

Clone the repository and install dependencies:

```bash
git clone <your-repo-url>
cd chainsave
npm install
```

Create a `.env` file at the project root:

```env
PRIVATE_KEY=0xyour_private_key_here
INFURA_PROJECT_ID=your_infura_project_id
ETHERSCAN_API_KEY=your_etherscan_api_key
```

---

### Step 2: Compile & Test Smart Contracts

Compile the contracts (generates the `typechain-types/` directory):

```bash
npx hardhat compile
```

Run unit tests and check coverage:

```bash
npx hardhat test
npx hardhat coverage
```

---

### Step 3: Deploy

**Option A — Localhost (local test environment)**

```bash
# Terminal 1: Start local node
npm run node

# Terminal 2: Deploy
npm run deploy:local
```

**Option B — Sepolia Testnet**

```bash
npm run deploy:sepolia
```

> 💡 The deploy script will automatically initialize base saving plans, fund the Vault, and update `frontend/src/contracts.js` with the latest ABI and contract addresses.

---

### Step 4: Run the Frontend

```bash
cd frontend
npm install
npm run dev
```

Access the app at: **http://localhost:5173**

---

### Step 5: Run the Auto-Renew Bot

```bash
# Local environment
npm run bot:local

# Sepolia Testnet
npm run bot:sepolia
```

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Smart Contract** | Solidity 0.8.26, Hardhat, TypeScript, ethers.js v6, OpenZeppelin v5 |
| **EVM Version** | Cancun (supports `mcopy` opcode required by OpenZeppelin v5) |
| **Testing & Deployment** | Hardhat, TypeScript, Hardhat Coverage |
| **Frontend** | ReactJS, Vite, CSS |
| **Bot** | Node.js, TypeScript |
| **Infrastructure** | Infura RPC, Etherscan API, Sepolia Testnet |

---
