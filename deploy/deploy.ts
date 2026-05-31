// D:\Coding\Project\deploy\deploy.ts
import { ethers, run, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function waitForTx(hash: string, label: string): Promise<void> {
  process.stdout.write(`   → Waiting for ${label}`);
  while (true) {
    const receipt = await ethers.provider.getTransactionReceipt(hash);
    if (receipt?.blockNumber) {
      console.log(` ✓ (block ${receipt.blockNumber})`);
      return;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 8000));
  }
}

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("════════════════════════════════════════");
  console.log("  ChainSave v2 — Deploy to", network.name.toUpperCase());
  console.log("════════════════════════════════════════");
  console.log("Deployer :", deployer.address);
  console.log("Balance  :", ethers.formatEther(balance), "ETH");

  const USDC = (n: number): bigint => ethers.parseUnits(String(n), 6);

  // ── 1. MockUSDC ──────────────────────────────────────────────────────────
  console.log("\n[1/5] Deploying MockUSDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await waitForTx(usdc.deploymentTransaction()!.hash, "MockUSDC");
  const usdcAddr = await usdc.getAddress();
  console.log("   ✓ MockUSDC:", usdcAddr);

  // ── 2. VaultManager ──────────────────────────────────────────────────────
  console.log("\n[2/5] Deploying VaultManager...");
  const VaultManager = await ethers.getContractFactory("VaultManager");
  const vault = await VaultManager.deploy(usdcAddr, deployer.address);
  await waitForTx(vault.deploymentTransaction()!.hash, "VaultManager");
  const vaultAddr = await vault.getAddress();
  console.log("   ✓ VaultManager:", vaultAddr);

  // ── 3. SavingCert (NFT) ──────────────────────────────────────────────────
  console.log("\n[3/5] Deploying SavingCert (ERC721)...");
  const SavingCert = await ethers.getContractFactory("SavingCert");
  const savingCert = await SavingCert.deploy();
  await waitForTx(savingCert.deploymentTransaction()!.hash, "SavingCert");
  const certAddr = await savingCert.getAddress();
  console.log("   ✓ SavingCert:", certAddr);

  // ── 4. SavingCore ────────────────────────────────────────────────────────
  console.log("\n[4/5] Deploying SavingCore...");
  const SavingCore = await ethers.getContractFactory("SavingCore");
  const core = await SavingCore.deploy(usdcAddr, vaultAddr, certAddr);
  await waitForTx(core.deploymentTransaction()!.hash, "SavingCore");
  const coreAddr = await core.getAddress();
  console.log("   ✓ SavingCore:", coreAddr);

  // ── 5. Setup ──────────────────────────────────────────────────────────────
  console.log("\n[5/5] Setting up...");

  // SavingCert chỉ nhận lệnh mint từ SavingCore
  const tx0 = await savingCert.setSavingCore(coreAddr);
  await waitForTx(tx0.hash, "setSavingCore on SavingCert");

  // VaultManager nhận lệnh payInterest từ SavingCore
  const tx1 = await vault.setSavingCore(coreAddr);
  await waitForTx(tx1.hash, "setSavingCore on VaultManager");

  // Fund vault
  const tx2 = await usdc.mint(deployer.address, USDC(1_000_000));
  await waitForTx(tx2.hash, "mint 1,000,000 USDC");

  const tx3 = await usdc.approve(vaultAddr, USDC(500_000));
  await waitForTx(tx3.hash, "approve 500,000 USDC");

  const tx4 = await vault.fundVault(USDC(500_000));
  await waitForTx(tx4.hash, "fundVault 500,000 USDC");

  const H = (h: number): number => h * 3600;
  const D = (d: number): number => d * 86400;

  const plans: [number, number, number, number, number, string][] = [
    [H(1),   200,  0, 0, 300, "1h   / 2% APR"],
    [H(12),  300,  0, 0, 400, "12h  / 3% APR"],
    [D(30),  500,  0, 0, 500, "30d  / 5% APR"],
    [D(365), 1000, 0, 0, 500, "365d / 10% APR"],
  ];

  for (const [tenor, apr, minD, maxD, penalty, label] of plans) {
    const tx = await core.createPlan(tenor, apr, minD, maxD, penalty);
    await waitForTx(tx.hash, `createPlan ${label}`);
  }
  console.log("   ✓  saving plans created");

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════");
  console.log("  Deployment Complete!");
  console.log("════════════════════════════════════════");
  console.log("MockUSDC    :", usdcAddr);
  console.log("VaultManager:", vaultAddr);
  console.log("SavingCert  :", certAddr);
  console.log("SavingCore  :", coreAddr);

  if (network.name === "sepolia") {
    console.log("\n🔗 Etherscan:");
    console.log(`   https://sepolia.etherscan.io/address/${usdcAddr}`);
    console.log(`   https://sepolia.etherscan.io/address/${vaultAddr}`);
    console.log(`   https://sepolia.etherscan.io/address/${certAddr}`);
    console.log(`   https://sepolia.etherscan.io/address/${coreAddr}`);
  }

  // ── Auto-update frontend ──────────────────────────────────────────────────
  const contractsPath = path.resolve("./frontend/src/contracts.js");
  if (fs.existsSync(contractsPath)) {
    let content = fs.readFileSync(contractsPath, "utf8");
    content = content
      .replace(/MockUSDC:\s*"[^"]*"/,    `MockUSDC:    "${usdcAddr}"`)
      .replace(/VaultManager:\s*"[^"]*"/, `VaultManager:"${vaultAddr}"`)
      .replace(/SavingCert:\s*"[^"]*"/,   `SavingCert:  "${certAddr}"`)
      .replace(/SavingCore:\s*"[^"]*"/,   `SavingCore:  "${coreAddr}"`);
    fs.writeFileSync(contractsPath, content);
    console.log("\n✅ frontend/src/contracts.js updated!");
  }

  // ── Verify on Etherscan ───────────────────────────────────────────────────
  if (network.name === "sepolia" && process.env.ETHERSCAN_API_KEY) {
    console.log("\n⏳ Waiting 30s before verifying...");
    await new Promise<void>((r) => setTimeout(r, 30_000));
    try {
      await run("verify:verify", { address: usdcAddr,  constructorArguments: [] });
      await run("verify:verify", { address: vaultAddr, constructorArguments: [usdcAddr, deployer.address] });
      await run("verify:verify", { address: certAddr,  constructorArguments: [] });
      await run("verify:verify", { address: coreAddr,  constructorArguments: [usdcAddr, vaultAddr, certAddr] });
      console.log("✅ All contracts verified!");
    } catch (e: unknown) {
      console.log("Verify error:", (e as Error).message);
    }
  } else if (network.name === "sepolia") {
    console.log("\n💡 Verify thủ công:");
    console.log(`   npx hardhat verify --network sepolia ${usdcAddr}`);
    console.log(`   npx hardhat verify --network sepolia ${vaultAddr} "${usdcAddr}" "${deployer.address}"`);
    console.log(`   npx hardhat verify --network sepolia ${certAddr}`);
    console.log(`   npx hardhat verify --network sepolia ${coreAddr} "${usdcAddr}" "${vaultAddr}" "${certAddr}"`);
  }
}

main().catch((e: Error) => {
  console.error(e);
  process.exit(1);
});

