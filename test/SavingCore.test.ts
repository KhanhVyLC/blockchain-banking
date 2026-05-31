import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  MockUSDC,
  VaultManager,
  SavingCert,
  SavingCore,
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// ─── Helpers ───────────────────────────────────────────────────────────────
const USDC = (n: number): bigint => ethers.parseUnits(String(n), 6);
const BPS_DENOM = 10_000n;
const YEAR = 365n * 24n * 3600n;

function calcInterest(principal: bigint, aprBps: number, tenorDays: number): bigint {
  const tenorSec = BigInt(tenorDays) * 86400n;
  return (principal * BigInt(aprBps) * tenorSec) / (YEAR * BPS_DENOM);
}

// ─── Fixture type ──────────────────────────────────────────────────────────
interface Fixture {
  usdc:        MockUSDC;
  vault:       VaultManager;
  cert:        SavingCert;   // ← mới: NFT contract riêng
  core:        SavingCore;
  owner:       HardhatEthersSigner;
  alice:       HardhatEthersSigner;
  bob:         HardhatEthersSigner;
  feeReceiver: HardhatEthersSigner;
  bot:         HardhatEthersSigner;
}

// ─── Deploy fixture ────────────────────────────────────────────────────────
async function deployAll(): Promise<Fixture> {
  const [owner, alice, bob, feeReceiver, bot] = await ethers.getSigners();

  // 1. MockUSDC
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy() as unknown as MockUSDC;

  // 2. VaultManager
  const VaultManager = await ethers.getContractFactory("VaultManager");
  const vault = await VaultManager.deploy(
    await usdc.getAddress(),
    feeReceiver.address
  ) as unknown as VaultManager;

  // 3. SavingCert (ERC721 riêng) ← mới
  const SavingCert = await ethers.getContractFactory("SavingCert");
  const cert = await SavingCert.deploy() as unknown as SavingCert;

  // 4. SavingCore — constructor nhận thêm _cert ← sửa: 3 args
  const SavingCore = await ethers.getContractFactory("SavingCore");
  const core = await SavingCore.deploy(
    await usdc.getAddress(),
    await vault.getAddress(),
    await cert.getAddress()   // ← arg mới
  ) as unknown as SavingCore;

  // 5. Setup: link contracts
  await cert.setSavingCore(await core.getAddress()); // ← mới: SavingCert cần biết SavingCore
  await vault.setSavingCore(await core.getAddress());

  // 6. Mint tokens
  await usdc.mint(alice.address, USDC(10_000));
  await usdc.mint(bob.address,   USDC(10_000));
  await usdc.mint(owner.address, USDC(100_000));

  // 7. Fund vault
  await usdc.connect(owner).approve(await vault.getAddress(), USDC(50_000));
  await vault.connect(owner).fundVault(USDC(50_000));

  // 8. Approve SavingCore để tiêu token của alice & bob
  await usdc.connect(alice).approve(await core.getAddress(), USDC(10_000));
  await usdc.connect(bob).approve(await core.getAddress(), USDC(10_000));

  // 9. Default plan: 90 ngày, 2.5% APR, penalty 5%
  await core.connect(owner).createPlan(90 * 86400, 250, 0, 0, 500); // planId = 0

  return { usdc, vault, cert, core, owner, alice, bob, feeReceiver, bot };
}

// ══════════════════════════════════════════════════════════════════════════════
describe("MockUSDC", function () {
  it("has 6 decimals", async () => {
    const { usdc } = await deployAll();
    expect(await usdc.decimals()).to.equal(6);
  });

  it("owner can mint", async () => {
    const { usdc, alice } = await deployAll();
    await usdc.mint(alice.address, USDC(100));
  });

  it("non-owner cannot mint", async () => {
    const { usdc, alice } = await deployAll();
    await expect(usdc.connect(alice).mint(alice.address, USDC(1))).to.be.reverted;
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("SavingCert (NFT contract)", function () {
  it("savingCore được set đúng sau deploy", async () => {
    const { cert, core } = await deployAll();
    expect(await cert.savingCore()).to.equal(await core.getAddress());
  });

  it("setSavingCore chỉ gọi được một lần", async () => {
    const { cert, alice } = await deployAll();
    // Gọi lần 2 phải revert (SavingCoreAlreadySet)
    await expect(cert.setSavingCore(alice.address)).to.be.reverted;
  });

  it("mint chỉ được gọi bởi SavingCore", async () => {
    const { cert, alice } = await deployAll();
    await expect(cert.connect(alice).mint(alice.address)).to.be.reverted;
  });

  it("tokenId của NFT khớp với depositId", async () => {
    const { core, cert, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    // depositId = 0 → tokenId = 0 → owner = alice
    expect(await cert.ownerOf(0)).to.equal(alice.address);
  });

  it("NFT có thể transfer tự do (ERC721 chuẩn)", async () => {
    const { core, cert, alice, bob } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    // Alice transfer NFT sang Bob
    await cert.connect(alice).transferFrom(alice.address, bob.address, 0);
    expect(await cert.ownerOf(0)).to.equal(bob.address);
    // Depositor trong SavingCore vẫn là alice
    const d = await core.getDeposit(0);
    expect(d.depositor).to.equal(alice.address);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("createPlan", function () {
  it("creates a plan with correct fields", async () => {
    const { core } = await deployAll();
    const plan = await core.getPlan(0);
    expect(plan.tenorSeconds).to.equal(90 * 86400);
    expect(plan.aprBps).to.equal(250);
    expect(plan.earlyWithdrawPenaltyBps).to.equal(500);
    expect(plan.enabled).to.be.true;
  });

  it("emits PlanCreated", async () => {
    const { core, owner } = await deployAll();
    await expect(core.connect(owner).createPlan(30 * 86400, 100, 0, 0, 200))
      .to.emit(core, "PlanCreated")
      .withArgs(1, 30 * 86400, 100);
  });

  it("reverts on zero APR", async () => {
    const { core, owner } = await deployAll();
    await expect(core.connect(owner).createPlan(30 * 86400, 0, 0, 0, 200)).to.be.reverted;
  });

  it("reverts if non-owner calls createPlan", async () => {
    const { core, alice } = await deployAll();
    await expect(core.connect(alice).createPlan(30 * 86400, 100, 0, 0, 200)).to.be.reverted;
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("updatePlan / enable / disable", function () {
  it("updatePlan changes APR and emits PlanUpdated", async () => {
    const { core, owner } = await deployAll();
    await expect(core.connect(owner).updatePlan(0, 300))
      .to.emit(core, "PlanUpdated")
      .withArgs(0, 300);
    expect((await core.getPlan(0)).aprBps).to.equal(300);
  });

  it("disablePlan stops new deposits", async () => {
    const { core, owner, alice } = await deployAll();
    await core.connect(owner).disablePlan(0);
    await expect(core.connect(alice).openDeposit(0, USDC(100))).to.be.reverted;
  });

  it("enablePlan re-allows deposits", async () => {
    const { core, owner, alice } = await deployAll();
    await core.connect(owner).disablePlan(0);
    await core.connect(owner).enablePlan(0);
    await expect(core.connect(alice).openDeposit(0, USDC(100))).to.not.be.reverted;
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("openDeposit", function () {
  it("happy path: mints NFT trên SavingCert và ghi nhận deposit", async () => {
    const { core, cert, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));

    // NFT nằm ở SavingCert, không phải SavingCore ← sửa: dùng cert.ownerOf
    expect(await cert.ownerOf(0)).to.equal(alice.address);

    const d = await core.getDeposit(0);
    expect(d.principal).to.equal(USDC(1000));
    expect(d.aprBpsAtOpen).to.equal(250);
    expect(d.status).to.equal(0);         // Active
    expect(d.depositor).to.equal(alice.address); // ← field mới
  });

  it("emits DepositOpened với depositor = msg.sender", async () => {
    const { core, alice } = await deployAll();
    const tx = await core.connect(alice).openDeposit(0, USDC(1000));
    await expect(tx).to.emit(core, "DepositOpened");
  });

  it("reverts if plan is disabled", async () => {
    const { core, owner, alice } = await deployAll();
    await core.connect(owner).disablePlan(0);
    await expect(core.connect(alice).openDeposit(0, USDC(1000))).to.be.reverted;
  });

  it("reverts if amount below minimum", async () => {
    const { core, owner, alice } = await deployAll();
    await core.connect(owner).createPlan(30 * 86400, 200, USDC(500), 0, 100);
    await expect(core.connect(alice).openDeposit(1, USDC(100))).to.be.reverted;
  });

  it("reverts if amount above maximum", async () => {
    const { core, owner, alice } = await deployAll();
    await core.connect(owner).createPlan(30 * 86400, 200, 0, USDC(500), 100);
    await expect(core.connect(alice).openDeposit(1, USDC(1000))).to.be.reverted;
  });

  it("reverts on zero amount", async () => {
    const { core, alice } = await deployAll();
    await expect(core.connect(alice).openDeposit(0, 0)).to.be.reverted;
  });

  it("snaps APR: updatePlan sau khi mở không ảnh hưởng deposit đang chạy", async () => {
    const { core, owner, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    await core.connect(owner).updatePlan(0, 999);
    expect((await core.getDeposit(0)).aprBpsAtOpen).to.equal(250);
  });

  it("depositId khớp tokenId: deposit thứ 2 có depositId=1, tokenId=1", async () => {
    const { core, cert, alice, bob } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000)); // depositId=0, tokenId=0
    await core.connect(bob).openDeposit(0, USDC(500));    // depositId=1, tokenId=1
    expect(await cert.ownerOf(1)).to.equal(bob.address);
    expect((await core.getDeposit(1)).depositor).to.equal(bob.address);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("withdrawAtMaturity", function () {
  it("pays correct principal + interest after maturity", async () => {
    const { core, usdc, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const cert = await core.getDeposit(0);
    await time.increaseTo(Number(cert.maturityAt));

    const balBefore = await usdc.balanceOf(alice.address);
    await core.connect(alice).withdrawAtMaturity(0);
    const balAfter  = await usdc.balanceOf(alice.address);

    const expected = USDC(1000) + calcInterest(USDC(1000), 250, 90);
    expect(balAfter - balBefore).to.equal(expected);
  });

  it("emits Withdrawn with isEarly=false", async () => {
    const { core, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));
    await expect(core.connect(alice).withdrawAtMaturity(0))
      .to.emit(core, "Withdrawn")
      .withArgs(0, alice.address, USDC(1000), calcInterest(USDC(1000), 250, 90), false);
  });

  it("reverts if called before maturity", async () => {
    const { core, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    await expect(core.connect(alice).withdrawAtMaturity(0)).to.be.reverted;
  });

  it("reverts if called twice", async () => {
    const { core, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));
    await core.connect(alice).withdrawAtMaturity(0);
    await expect(core.connect(alice).withdrawAtMaturity(0)).to.be.reverted;
  });

  it("vault thiếu lãi: vẫn trả gốc đủ, emit InterestShortfall", async () => {
    const { core, vault, usdc, owner, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));

    await vault.connect(owner).withdrawVault(await vault.vaultBalance());

    const balBefore = await usdc.balanceOf(alice.address);
    const tx = await core.connect(alice).withdrawAtMaturity(0);
    const balAfter  = await usdc.balanceOf(alice.address);

    expect(balAfter - balBefore).to.equal(USDC(1000));
    await expect(tx).to.emit(core, "InterestShortfall");
  });

  // ── [DUAL-OWNERSHIP] Rút tiền chỉ depositor được ─────────────────────────

  it("bob KHÔNG rút được deposit của alice — revert NotDepositor", async () => {
    // ← sửa: v1 check ownerOf, v2 check depositor
    const { core, alice, bob } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));
    await expect(core.connect(bob).withdrawAtMaturity(0))
      .to.be.revertedWithCustomError(core, "NotDepositor");
  });

  it("alice mất NFT nhưng vẫn rút được tiền — dual-ownership", async () => {
    // ← test MỚI: core của dual-ownership model
    const { core, cert, usdc, alice, bob } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));

    // Alice transfer NFT sang Bob (mất NFT)
    await cert.connect(alice).transferFrom(alice.address, bob.address, 0);
    expect(await cert.ownerOf(0)).to.equal(bob.address); // NFT đã sang Bob

    // Alice vẫn rút được tiền vì depositor = alice
    const balBefore = await usdc.balanceOf(alice.address);
    await core.connect(alice).withdrawAtMaturity(0);
    const balAfter  = await usdc.balanceOf(alice.address);

    expect(balAfter - balBefore).to.equal(USDC(1000) + calcInterest(USDC(1000), 250, 90));
    console.log("      ✅ Alice mất NFT nhưng vẫn rút được tiền");
  });

  it("bob giữ NFT của alice KHÔNG rút được tiền — tiền thuộc về depositor", async () => {
    // ← test MỚI
    const { core, cert, alice, bob } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));

    await cert.connect(alice).transferFrom(alice.address, bob.address, 0);

    // Bob giữ NFT nhưng không phải depositor → revert
    await expect(core.connect(bob).withdrawAtMaturity(0))
      .to.be.revertedWithCustomError(core, "NotDepositor");
    console.log("      ✅ Bob giữ NFT nhưng không rút được tiền của Alice");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("earlyWithdraw", function () {
  it("pays principal minus penalty, no interest, penalty to feeReceiver", async () => {
    const { core, usdc, alice, feeReceiver } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));

    const aliceBefore = await usdc.balanceOf(alice.address);
    const feeBefore   = await usdc.balanceOf(feeReceiver.address);

    await core.connect(alice).earlyWithdraw(0);

    const aliceAfter = await usdc.balanceOf(alice.address);
    const feeAfter   = await usdc.balanceOf(feeReceiver.address);

    const penalty = USDC(1000) * 500n / 10_000n;
    expect(aliceAfter - aliceBefore).to.equal(USDC(1000) - penalty);
    expect(feeAfter   - feeBefore).to.equal(penalty);
  });

  it("emits Withdrawn with isEarly=true and interest=0", async () => {
    const { core, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    await expect(core.connect(alice).earlyWithdraw(0))
      .to.emit(core, "Withdrawn")
      .withArgs(0, alice.address, USDC(1000), 0, true);
  });

  it("cannot early-withdraw after maturity", async () => {
    const { core, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));
    await expect(core.connect(alice).earlyWithdraw(0))
      .to.be.revertedWith("Use withdrawAtMaturity");
  });

  it("cannot withdraw twice", async () => {
    const { core, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    await core.connect(alice).earlyWithdraw(0);
    await expect(core.connect(alice).earlyWithdraw(0)).to.be.reverted;
  });

  it("bob KHÔNG earlyWithdraw được deposit của alice — revert NotDepositor", async () => {
    // ← sửa: v1 check ownerOf, v2 check depositor
    const { core, alice, bob } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    await expect(core.connect(bob).earlyWithdraw(0))
      .to.be.revertedWithCustomError(core, "NotDepositor");
  });

  it("tiền rút sớm về đúng ví depositor, không phải NFT owner", async () => {
    // ← test MỚI
    const { core, cert, usdc, alice, bob } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));

    // Alice transfer NFT sang Bob
    await cert.connect(alice).transferFrom(alice.address, bob.address, 0);

    // Alice vẫn rút được và tiền về alice (vì alice là depositor)
    const balBefore = await usdc.balanceOf(alice.address);
    await core.connect(alice).earlyWithdraw(0);
    const balAfter  = await usdc.balanceOf(alice.address);

    const penalty = USDC(1000) * 500n / 10_000n;
    expect(balAfter - balBefore).to.equal(USDC(1000) - penalty);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("renewDeposit (manual)", function () {
  it("mints new NFT with compounded principal", async () => {
    const { core, cert, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));

    await core.connect(alice).renewDeposit(0, 0);

    const oldCert = await core.getDeposit(0);
    const newCert = await core.getDeposit(1);

    expect(oldCert.status).to.equal(2); // ManualRenewed
    expect(newCert.principal).to.equal(USDC(1000) + calcInterest(USDC(1000), 250, 90));
    expect(newCert.status).to.equal(0); // Active
    // Depositor kế thừa
    expect(newCert.depositor).to.equal(alice.address);
    // NFT mới mint về alice (người gọi renewDeposit)
    expect(await cert.ownerOf(1)).to.equal(alice.address);
  });

  it("emits Renewed event", async () => {
    const { core, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));
    await expect(core.connect(alice).renewDeposit(0, 0)).to.emit(core, "Renewed");
  });

  it("reverts if deposit not yet matured", async () => {
    const { core, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    await expect(core.connect(alice).renewDeposit(0, 0)).to.be.reverted;
  });

  it("reverts if new plan is disabled", async () => {
    const { core, owner, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));
    await core.connect(owner).disablePlan(0);
    await expect(core.connect(alice).renewDeposit(0, 0)).to.be.reverted;
  });

  it("new deposit uses new plan's APR", async () => {
    const { core, owner, alice } = await deployAll();
    await core.connect(owner).createPlan(180 * 86400, 300, 0, 0, 500); // planId=1
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));
    await core.connect(alice).renewDeposit(0, 1);
    const newCert = await core.getDeposit(1);
    expect(newCert.aprBpsAtOpen).to.equal(300);
    expect(newCert.tenorSeconds).to.equal(180 * 86400);
  });

  // ── [DUAL-OWNERSHIP] renewDeposit: NFT owner HOẶC depositor đều được ─────

  it("NFT owner (bob) có thể gia hạn thay depositor (alice)", async () => {
    // ← test MỚI
    const { core, cert, alice, bob } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));

    // Alice transfer NFT sang Bob
    await cert.connect(alice).transferFrom(alice.address, bob.address, 0);
    expect(await cert.ownerOf(0)).to.equal(bob.address);

    // Bob (NFT owner) gia hạn được
    await expect(core.connect(bob).renewDeposit(0, 0)).to.not.be.reverted;

    // Deposit mới: depositor vẫn là alice, NFT mới về bob (người gọi)
    const newCert = await core.getDeposit(1);
    expect(newCert.depositor).to.equal(alice.address);
    expect(await cert.ownerOf(1)).to.equal(bob.address);
    console.log("      ✅ Bob (NFT owner) gia hạn được, depositor vẫn là Alice");
  });

  it("người không liên quan KHÔNG gia hạn được — revert NotNftOwnerOrDepositor", async () => {
    // ← test MỚI
    const { core, alice, bob } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));
    // Bob không phải depositor, không giữ NFT
    await expect(core.connect(bob).renewDeposit(0, 0))
      .to.be.revertedWithCustomError(core, "NotNftOwnerOrDepositor");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("autoRenewDeposit", function () {
  it("reverts if called before grace period ends", async () => {
    const { core, alice, bot } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt) + 1 * 24 * 3600); // +1 ngày (< 3 ngày grace)
    await expect(core.connect(bot).autoRenewDeposit(0)).to.be.reverted;
  });

  it("succeeds after grace period and locks original APR", async () => {
    const { core, owner, alice, bot } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);

    await core.connect(owner).updatePlan(0, 50); // hạ APR — không ảnh hưởng auto-renew

    await time.increaseTo(Number(d.maturityAt) + 3 * 24 * 3600 + 1);
    await core.connect(bot).autoRenewDeposit(0);

    const oldCert = await core.getDeposit(0);
    const newCert = await core.getDeposit(1);
    expect(oldCert.status).to.equal(3); // AutoRenewed
    expect(newCert.aprBpsAtOpen).to.equal(250); // APR gốc được giữ
    expect(newCert.principal).to.equal(USDC(1000) + calcInterest(USDC(1000), 250, 90));
  });

  it("emits Renewed event", async () => {
    const { core, alice, bot } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt) + 3 * 24 * 3600 + 1);
    await expect(core.connect(bot).autoRenewDeposit(0)).to.emit(core, "Renewed");
  });

  it("NFT mới mint về depositor gốc, KHÔNG về ví bot", async () => {
    // ← sửa: v1 dùng core.ownerOf, v2 dùng cert.ownerOf
    const { core, cert, alice, bot } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt) + 3 * 24 * 3600 + 1);
    await core.connect(bot).autoRenewDeposit(0);

    // NFT mới (depositId=1) thuộc về alice, không phải bot
    expect(await cert.ownerOf(1)).to.equal(alice.address);
    expect(await cert.ownerOf(1)).to.not.equal(bot.address);

    // depositor của deposit mới vẫn là alice
    expect((await core.getDeposit(1)).depositor).to.equal(alice.address);
    console.log("      ✅ NFT mới về Alice, bot không chiếm được");
  });

  it("alice mất NFT — bot auto-renew — NFT mới vẫn về alice (depositor)", async () => {
    // ← test MỚI: kịch bản thực tế mất NFT
    const { core, cert, alice, bob, bot } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);

    // Alice mất NFT (transfer sang Bob)
    await cert.connect(alice).transferFrom(alice.address, bob.address, 0);

    await time.increaseTo(Number(d.maturityAt) + 3 * 24 * 3600 + 1);
    await core.connect(bot).autoRenewDeposit(0);

    // NFT mới về alice (depositor gốc), không phải bob hay bot
    expect(await cert.ownerOf(1)).to.equal(alice.address);
    console.log("      ✅ Dù mất NFT cũ, Alice vẫn nhận NFT mới sau auto-renew");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Vault management", function () {
  it("fundVault increases balance", async () => {
    const { vault, usdc, owner } = await deployAll();
    const before = await vault.vaultBalance();
    await usdc.connect(owner).approve(await vault.getAddress(), USDC(1000));
    await vault.connect(owner).fundVault(USDC(1000));
    expect(await vault.vaultBalance()).to.equal(before + USDC(1000));
  });

  it("withdrawVault decreases balance", async () => {
    const { vault, owner } = await deployAll();
    const before = await vault.vaultBalance();
    await vault.connect(owner).withdrawVault(USDC(100));
    expect(await vault.vaultBalance()).to.equal(before - USDC(100));
  });

  it("withdrawVault reverts if amount exceeds balance", async () => {
    const { vault, owner } = await deployAll();
    const bal = await vault.vaultBalance();
    await expect(vault.connect(owner).withdrawVault(bal + USDC(1))).to.be.reverted;
  });

  it("non-owner cannot fundVault", async () => {
    const { vault, alice } = await deployAll();
    await expect(vault.connect(alice).fundVault(USDC(100))).to.be.reverted;
  });

  it("setFeeReceiver updates address", async () => {
    const { vault, owner, bob } = await deployAll();
    await vault.connect(owner).setFeeReceiver(bob.address);
    expect(await vault.feeReceiver()).to.equal(bob.address);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Pause / Unpause", function () {
  it("pause blocks openDeposit", async () => {
    const { core, owner, alice } = await deployAll();
    await core.connect(owner).pause();
    await expect(core.connect(alice).openDeposit(0, USDC(100))).to.be.reverted;
  });

  it("pause blocks withdrawAtMaturity", async () => {
    const { core, owner, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));
    await core.connect(owner).pause();
    await expect(core.connect(alice).withdrawAtMaturity(0)).to.be.reverted;
  });

  it("pause blocks earlyWithdraw", async () => {
    const { core, owner, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    await core.connect(owner).pause();
    await expect(core.connect(alice).earlyWithdraw(0)).to.be.reverted;
  });

  it("pause blocks renewDeposit", async () => {
    const { core, owner, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));
    await core.connect(owner).pause();
    await expect(core.connect(alice).renewDeposit(0, 0)).to.be.reverted;
  });

  it("unpause restores operations", async () => {
    const { core, owner, alice } = await deployAll();
    await core.connect(owner).pause();
    await core.connect(owner).unpause();
    await expect(core.connect(alice).openDeposit(0, USDC(100))).to.not.be.reverted;
  });

  it("vault pause blocks payInterest → withdrawAtMaturity revert", async () => {
    const { core, vault, owner, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));
    await vault.connect(owner).pause();
    await expect(core.connect(alice).withdrawAtMaturity(0)).to.be.reverted;
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Interest math", function () {
  it("calculates Alice example correctly (~6.16 USDC)", async () => {
    const { core } = await deployAll();
    const result = await core.calcInterest(USDC(1000), 250, 90n * 86400n);
    expect(result).to.be.closeTo(6_164_383n, 10n);
  });

  it("multiply-before-divide preserves precision for small amounts", async () => {
    const { core } = await deployAll();
    const result = await core.calcInterest(USDC(1), 100, 7n * 86400n);
    expect(result).to.be.gt(0n);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Security Monitor", function () {

  describe("integrityCheck", function () {
    it("returns intact=true khi số dư khớp sổ sách", async () => {
      const { core, alice } = await deployAll();
      await core.connect(alice).openDeposit(0, USDC(1000));
      const [isIntact, actual, expected, diff] = await core.integrityCheck();
      expect(isIntact).to.be.true;
      expect(actual).to.equal(expected);
      expect(diff).to.equal(0n);
    });

    it("phát hiện mất tiền khi số dư không khớp", async () => {
      const { core, usdc, alice } = await deployAll();
      await core.connect(alice).openDeposit(0, USDC(1000));

      const coreAddr = await core.getAddress();
      await ethers.provider.send("hardhat_setBalance", [coreAddr, "0xde0b6b3a7640000"]);
      await ethers.provider.send("hardhat_impersonateAccount", [coreAddr]);
      const coreSigner = await ethers.getSigner(coreAddr);
      await usdc.connect(coreSigner).transfer(alice.address, USDC(500));
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [coreAddr]);

      const [isIntact, , , diff] = await core.integrityCheck();
      expect(isIntact).to.be.false;
      expect(diff).to.equal(USDC(500));
      console.log(`      🚨 Phát hiện thiếu: ${diff / 1_000_000n} USDC`);
    });
  });

  describe("InterestShortfall", function () {
    it("emit InterestShortfall khi vault thiếu, vẫn trả gốc đủ", async () => {
      const { core, vault, usdc, owner, alice } = await deployAll();
      await core.connect(alice).openDeposit(0, USDC(1000));
      const d = await core.getDeposit(0);
      await time.increaseTo(Number(d.maturityAt));

      await vault.connect(owner).withdrawVault(await vault.vaultBalance());

      const balBefore = await usdc.balanceOf(alice.address);
      await expect(core.connect(alice).withdrawAtMaturity(0))
        .to.emit(core, "InterestShortfall");

      const balAfter = await usdc.balanceOf(alice.address);
      expect(balAfter - balBefore).to.equal(USDC(1000));
      console.log("      ✅ Alice nhận đủ gốc dù vault thiếu lãi");
    });
  });

  describe("vaultSolvencyCheck", function () {
    it("trả về sufficient=true khi vault đủ", async () => {
      const { core, alice } = await deployAll();
      await core.connect(alice).openDeposit(0, USDC(1000));
      const [sufficient, shortfall] = await core.vaultSolvencyCheck();
      expect(sufficient).to.be.true;
      expect(shortfall).to.equal(0n);
    });

    it("trả về sufficient=false và đúng shortfall khi vault thiếu", async () => {
      const { core, vault, owner, alice } = await deployAll();
      await core.connect(alice).openDeposit(0, USDC(1000));

      const summary = await core.financialSummary();
      const interestOwed = summary[1] as bigint;

      await vault.connect(owner).withdrawVault(await vault.vaultBalance());

      const [sufficient, shortfall] = await core.vaultSolvencyCheck();
      expect(sufficient).to.be.false;
      expect(shortfall).to.equal(interestOwed);
      console.log(`      ✅ Vault thiếu: ${shortfall / 1_000_000n} USDC`);
    });
  });

  describe("Full security demo flow", function () {
    it("phát hiện bất thường → pause → user không rút được → unpause", async () => {
      const { core, usdc, owner, alice } = await deployAll();
      await core.connect(alice).openDeposit(0, USDC(1000));

      let [isIntact] = await core.integrityCheck();
      expect(isIntact).to.be.true;
      console.log("      Step 1: ✅ Integrity OK");

      const coreAddr = await core.getAddress();
      await ethers.provider.send("hardhat_setBalance", [coreAddr, "0xde0b6b3a7640000"]);
      await ethers.provider.send("hardhat_impersonateAccount", [coreAddr]);
      const coreSigner = await ethers.getSigner(coreAddr);
      await usdc.connect(coreSigner).transfer(alice.address, USDC(500));
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [coreAddr]);

      [isIntact] = await core.integrityCheck();
      expect(isIntact).to.be.false;
      console.log("      Step 2: 🚨 Phát hiện mất 500 USDC!");

      await core.connect(owner).pause();
      console.log("      Step 3: ⏸ Admin đã Pause hệ thống");

      const d = await core.getDeposit(0);
      await time.increaseTo(Number(d.maturityAt));
      await expect(core.connect(alice).withdrawAtMaturity(0)).to.be.reverted;
      console.log("      Step 4: ✅ User bị chặn khi hệ thống paused");

      await core.connect(owner).unpause();
      console.log("      Step 5: ▶ Admin Unpause sau khi xử lý xong");
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("Tính năng mới", function () {

  it("earlyWithdraw: emit PenaltyCollected với đúng receiver và amount", async () => {
    const { core, alice, feeReceiver } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const expectedPenalty = USDC(1000) * 500n / 10_000n;
    await expect(core.connect(alice).earlyWithdraw(0))
      .to.emit(core, "PenaltyCollected")
      .withArgs(0, feeReceiver.address, expectedPenalty);
  });

  it("totalPrincipalLocked tăng khi openDeposit, giảm khi withdraw", async () => {
    const { core, alice } = await deployAll();
    expect(await core.totalPrincipalLocked()).to.equal(0n);
    await core.connect(alice).openDeposit(0, USDC(1000));
    expect(await core.totalPrincipalLocked()).to.equal(USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));
    await core.connect(alice).withdrawAtMaturity(0);
    expect(await core.totalPrincipalLocked()).to.equal(0n);
  });

  it("financialSummary trả về đúng số liệu", async () => {
    const { core, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const [principal, interestOwed, vaultBalance, isSolvent] = await core.financialSummary();
    expect(principal).to.equal(USDC(1000));
    expect(interestOwed).to.be.gt(0n);
    expect(vaultBalance).to.be.gt(0n);
    expect(isSolvent).to.be.true;
  });

  it("withdrawAtMaturity: trả đủ gốc khi vault = 0, emit InterestShortfall", async () => {
    const { core, vault, usdc, owner, alice } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));
    const d = await core.getDeposit(0);
    await time.increaseTo(Number(d.maturityAt));
    await vault.connect(owner).withdrawVault(await vault.vaultBalance());
    const balBefore = await usdc.balanceOf(alice.address);
    const tx = await core.connect(alice).withdrawAtMaturity(0);
    const balAfter  = await usdc.balanceOf(alice.address);
    expect(balAfter - balBefore).to.equal(USDC(1000));
    await expect(tx).to.emit(core, "InterestShortfall");
  });

  it("getNftOwner và getDepositor trả về đúng sau khi transfer NFT", async () => {
    // ← test MỚI: helper view functions
    const { core, cert, alice, bob } = await deployAll();
    await core.connect(alice).openDeposit(0, USDC(1000));

    expect(await core.getDepositor(0)).to.equal(alice.address);
    expect(await core.getNftOwner(0)).to.equal(alice.address);

    // Alice transfer NFT sang Bob
    await cert.connect(alice).transferFrom(alice.address, bob.address, 0);

    expect(await core.getDepositor(0)).to.equal(alice.address); // không đổi
    expect(await core.getNftOwner(0)).to.equal(bob.address);     // đã đổi
    console.log("      ✅ depositor không đổi dù NFT chuyển tay");
  });
});
