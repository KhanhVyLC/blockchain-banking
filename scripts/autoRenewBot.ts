/**
 * autoRenewBot.ts — Batch job tự động gia hạn deposit lúc 0h00 mỗi ngày
 *
 * Cách chạy:
 *   npx ts-node scripts/autoRenewBot.ts --network sepolia
 *   npx ts-node scripts/autoRenewBot.ts --network localhost
 */

import "dotenv/config";
import {
  ethers, Contract, JsonRpcProvider, Wallet,
  Interface, Log, TransactionReceipt,
} from "ethers";
import * as fs from "fs";
import * as path from "path";

// ─── Config ──────────────────────────────────────────────────────────────────

const NETWORK: string = process.argv.includes("--network")
  ? process.argv[process.argv.indexOf("--network") + 1]
  : "sepolia";

let GRACE_PERIOD: number = parseInt(process.env.GRACE_PERIOD_SEC ?? "259200");
const BATCH_HOUR: number   = parseInt(process.env.BATCH_HOUR   ?? "0");
const BATCH_MINUTE: number = parseInt(process.env.BATCH_MINUTE ?? "0");

const RPC_URL: string = NETWORK === "localhost"
  ? "http://127.0.0.1:8545"
  : `https://sepolia.infura.io/v3/${process.env.INFURA_PROJECT_ID}`;

// ─── ABI ─────────────────────────────────────────────────────────────────────

const CORE_ABI: string[] = [
  "function nextDepositId() view returns (uint256)",

  
  "function getDeposit(uint256) view returns (tuple(uint256 planId, uint256 principal, uint256 aprBpsAtOpen, uint256 penaltyBpsAtOpen, uint256 tenorSeconds, uint256 startAt, uint256 maturityAt, uint8 status, address depositor))",

  "function autoRenewDeposit(uint256 depositId) returns (uint256)",
  "function gracePeriod() view returns (uint256)",

  "event DepositOpened(uint256 indexed depositId, address indexed depositor, uint256 indexed planId, uint256 principal, uint256 maturityAt, uint256 aprBpsAtOpen)",
  "event Renewed(uint256 indexed oldDepositId, uint256 indexed newDepositId, uint256 newPrincipal, uint256 indexed newPlanId)",
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface DepositCert {
  planId:           bigint;
  principal:        bigint;
  aprBpsAtOpen:     bigint;
  penaltyBpsAtOpen: bigint;
  tenorSeconds:     bigint;
  startAt:          bigint;
  maturityAt:       bigint;
  status:           bigint;
  depositor:        string;   // ← field mới trong v2
}

interface NextBatch {
  ms:      number;
  label:   string;
  nextRun: Date;
}

interface BatchStats {
  totalBatchRuns: number;
  totalRenewed:   number;
  totalFailed:    number;
  totalSkipped:   number;
  startedAt:      Date;
  lastBatchAt:    Date | null;
  history:        BatchHistory[];
}

interface BatchHistory {
  date:    string;
  renewed: number;
  failed:  number;
  skipped: number;
}

interface ToRenewItem {
  depositId: bigint;
  cert:      DepositCert;
}

interface PendingItem {
  depositId:    bigint;
  cert:         DepositCert;
  remainingSec: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt     = (n: bigint): string  => (Number(n) / 1e6).toFixed(2);
const fmtDate = (ts: bigint): string => new Date(Number(ts) * 1000).toLocaleString("vi-VN");
const pad     = (n: number): string  => String(n).padStart(2, "0");
const log     = (msg: string): void  => console.log(`[${new Date().toLocaleTimeString("vi-VN")}] ${msg}`);
const logOk   = (msg: string): void  => console.log(`[${new Date().toLocaleTimeString("vi-VN")}] ✅ ${msg}`);
const logWarn = (msg: string): void  => console.log(`[${new Date().toLocaleTimeString("vi-VN")}] ⚠️  ${msg}`);
const logErr  = (msg: string): void  => console.log(`[${new Date().toLocaleTimeString("vi-VN")}] ❌ ${msg}`);

// ─── Scheduler helpers ────────────────────────────────────────────────────────

function msUntilNextBatch(): NextBatch {
  const now  = new Date();
  const next = new Date(now);
  next.setHours(BATCH_HOUR, BATCH_MINUTE, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const ms      = next.getTime() - now.getTime();
  const hours   = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  return { ms, label: `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`, nextRun: next };
}

function loadContractAddress(): string {
  const contractsPath = path.join(__dirname, "../frontend/src/contracts.js");
  if (fs.existsSync(contractsPath)) {
    const content = fs.readFileSync(contractsPath, "utf8");
    const match   = content.match(/SavingCore:\s*"(0x[a-fA-F0-9]{40})"/);
    if (match) return match[1];
  }
  if (process.env.SAVING_CORE_ADDRESS) return process.env.SAVING_CORE_ADDRESS;
  throw new Error(
    "Không tìm thấy địa chỉ SavingCore!\n" +
    "Hãy deploy contract trước hoặc set SAVING_CORE_ADDRESS trong .env"
  );
}

// ─── Stats ────────────────────────────────────────────────────────────────────

const stats: BatchStats = {
  totalBatchRuns: 0,
  totalRenewed:   0,
  totalFailed:    0,
  totalSkipped:   0,
  startedAt:      new Date(),
  lastBatchAt:    null,
  history:        [],
};

function printStats(): void {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 Batch Job Statistics");
  console.log(`   Started      : ${stats.startedAt.toLocaleString("vi-VN")}`);
  console.log(`   Last batch   : ${stats.lastBatchAt?.toLocaleString("vi-VN") ?? "chưa chạy"}`);
  console.log(`   Total runs   : ${stats.totalBatchRuns} lần`);
  console.log(`   Total renewed: ${stats.totalRenewed} deposits ✅`);
  console.log(`   Total failed : ${stats.totalFailed} deposits ❌`);
  console.log(`   Total skipped: ${stats.totalSkipped} deposits`);
  if (stats.history.length > 0) {
    console.log("\n   Lịch sử 7 ngày gần nhất:");
    stats.history.slice(-7).forEach((h) => {
      console.log(`   ${h.date}: renewed=${h.renewed} failed=${h.failed} skipped=${h.skipped}`);
    });
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

// ─── Batch job chính ─────────────────────────────────────────────────────────

async function runBatchJob(core: Contract): Promise<void> {
  const batchDate = new Date().toLocaleDateString("vi-VN");
  console.log("\n" + "═".repeat(50));
  console.log(`🕛 BATCH JOB — ${new Date().toLocaleString("vi-VN")}`);
  console.log("═".repeat(50));

  const now = Math.floor(Date.now() / 1000);
  let renewed = 0, failed = 0, skipped = 0;

  // ── Thu thập tất cả depositId từ events ──────────────────────────────────
  const allIds = new Set<string>();
  try {
    const openEvs = await core.queryFilter(
      core.filters.DepositOpened(), 0, "latest"
    ) as ethers.EventLog[];
    for (const e of openEvs) allIds.add(e.args[0].toString());

    // Thêm các deposit được tạo ra từ lần renew trước
    const renewEvs = await core.queryFilter(
      core.filters.Renewed(), 0, "latest"
    ) as ethers.EventLog[];
    for (const e of renewEvs) allIds.add(e.args[1].toString()); // newDepositId

    log(`Tìm thấy ${allIds.size} deposit(s) trong hệ thống`);
  } catch (e: unknown) {
    logErr(`Không lấy được events: ${(e as Error).message}`);
    return;
  }

  if (allIds.size === 0) {
    log("Không có deposit nào — batch job kết thúc.");
    return;
  }

  // ── Phân loại deposit ─────────────────────────────────────────────────────
  const toRenew:  ToRenewItem[] = [];
  const pending:  PendingItem[] = [];
  const inactive: bigint[]      = [];

  for (const idStr of allIds) {
    const depositId = BigInt(idStr);
    try {
      const cert = await core.getDeposit(depositId) as DepositCert;

      if (cert.status !== 0n) {
        inactive.push(depositId);
        continue;
      }

      const gracePeriodEnd = Number(cert.maturityAt) + GRACE_PERIOD;

      if (now >= gracePeriodEnd) {
        toRenew.push({ depositId, cert });
      } else {
        pending.push({ depositId, cert, remainingSec: gracePeriodEnd - now });
      }
    } catch (e: unknown) {
      logErr(`Lỗi đọc deposit #${depositId}: ${(e as Error).message}`);
    }
  }

  console.log("\n📋 Phân loại deposits:");
  console.log(`   🔄 Cần auto renew    : ${toRenew.length}`);
  console.log(`   ⏳ Chưa đủ điều kiện: ${pending.length}`);
  console.log(`   ✓  Không còn Active  : ${inactive.length}`);

  if (pending.length > 0) {
    console.log("\n⏳ Deposit chưa đủ điều kiện:");
    for (const p of pending) {
      const days  = Math.floor(p.remainingSec / 86400);
      const hours = Math.floor((p.remainingSec % 86400) / 3600);
      const mins  = Math.floor((p.remainingSec % 3600) / 60);
      // v2: log depositor thay vì NFT owner — depositor mới là người nhận tiền
      console.log(
        `   #${p.depositId}: depositor=${p.cert.depositor.slice(0, 10)}...` +
        ` còn ${days}d ${hours}h ${mins}m đến hết grace period`
      );
    }
  }

  // ── Thực hiện auto renew ──────────────────────────────────────────────────
  if (toRenew.length === 0) {
    log("Không có deposit nào cần auto renew trong batch job này.");
  } else {
    console.log("\n🔄 Bắt đầu auto renew batch...\n");

    for (let i = 0; i < toRenew.length; i++) {
      const { depositId, cert } = toRenew[i];
      const progress = `[${i + 1}/${toRenew.length}]`;

      try {
        log(`${progress} Deposit #${depositId}`);

        // v2: log depositor (người nhận tiền) thay vì ownerOf (NFT owner)
        // Bot KHÔNG cần biết NFT đang ở đâu — tiền luôn về depositor
        log(`         Depositor: ${cert.depositor}`);
        log(`         Principal: ${fmt(cert.principal)} USDC`);
        log(`         APR      : ${Number(cert.aprBpsAtOpen) / 100}%`);
        log(`         Matured  : ${fmtDate(cert.maturityAt)}`);

        const tx      = await core.autoRenewDeposit(depositId);
        log(`         Tx hash  : ${tx.hash}`);
        const receipt: TransactionReceipt = await tx.wait();

        // Parse event Renewed để lấy newDepositId và principal mới
        const iface = core.interface as Interface;
        const renewedEvent = receipt.logs
          .map((l: Log) => {
            try { return iface.parseLog({ topics: [...l.topics], data: l.data }); }
            catch { return null; }
          })
          .find((e) => e?.name === "Renewed");

        if (renewedEvent) {
          const newId   = renewedEvent.args[1] as bigint;
          const newCert = await core.getDeposit(newId) as DepositCert;
          logOk(
            `${progress} #${depositId} → #${newId}` +
            ` | Principal mới: ${fmt(newCert.principal)} USDC` +
            ` | Depositor: ${newCert.depositor.slice(0, 10)}...`
          );
        } else {
          logOk(`${progress} #${depositId} renewed thành công`);
        }

        renewed++;
        stats.totalRenewed++;

        // Delay giữa các tx để tránh nonce collision
        if (i < toRenew.length - 1) {
          await new Promise<void>((r) => setTimeout(r, 2000));
        }
      } catch (e: unknown) {
        const err = e as { reason?: string; message?: string };
        logErr(`${progress} #${depositId} thất bại: ${err.reason ?? err.message}`);
        failed++;
        stats.totalFailed++;
      }
    }
  }

  skipped = pending.length;
  stats.totalSkipped += skipped;
  stats.totalBatchRuns++;
  stats.lastBatchAt = new Date();
  stats.history.push({ date: batchDate, renewed, failed, skipped });

  console.log("\n" + "─".repeat(50));
  console.log(`📊 Kết quả batch ${batchDate}:`);
  console.log(`   ✅ Renewed : ${renewed}`);
  console.log(`   ❌ Failed  : ${failed}`);
  console.log(`   ⏳ Skipped : ${skipped}`);
  console.log("─".repeat(50));

  printStats();
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

function scheduleNextBatch(core: Contract): void {
  const { ms, label, nextRun } = msUntilNextBatch();
  log(`Batch job tiếp theo lúc: ${nextRun.toLocaleString("vi-VN")} (còn ${label})`);
  setTimeout(async () => {
    await runBatchJob(core);
    scheduleNextBatch(core);
  }, ms);
}

function startCountdown(): void {
  setInterval(() => {
    const { label, nextRun } = msUntilNextBatch();
    log(`⏰ Batch job tiếp theo: ${nextRun.toLocaleString("vi-VN")} — còn ${label}`);
  }, 60_000);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  ChainSave v2 — Auto Renew Batch Job (0h00)     ║");
  console.log("║  Dual-ownership: tiền luôn về depositor gốc     ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`Network    : ${NETWORK}`);
  console.log(`RPC URL    : ${RPC_URL}`);
  console.log(`Batch time : ${pad(BATCH_HOUR)}:${pad(BATCH_MINUTE)} mỗi ngày`);
  console.log("");

  if (!process.env.PRIVATE_KEY || process.env.PRIVATE_KEY.includes("your_")) {
    logErr("PRIVATE_KEY chưa được set trong .env!");
    process.exit(1);
  }

  let provider: JsonRpcProvider;
  let signer: Wallet;

  try {
    provider = new JsonRpcProvider(RPC_URL);
    signer   = new Wallet(process.env.PRIVATE_KEY!, provider);
    const net = await provider.getNetwork();
    logOk(`Kết nối thành công — Chain ID: ${net.chainId}`);
    logOk(`Bot wallet : ${signer.address}`);

    const balance = await provider.getBalance(signer.address);
    log(`ETH balance: ${ethers.formatEther(balance)} ETH`);
    if (balance < ethers.parseEther("0.05")) {
      logWarn("ETH thấp! Nên có ít nhất 0.05 ETH để trả gas.");
    }
  } catch (e: unknown) {
    logErr(`Không kết nối được RPC: ${(e as Error).message}`);
    process.exit(1);
  }

  let coreAddress: string;
  try {
    coreAddress = loadContractAddress();
    logOk(`SavingCore : ${coreAddress}`);
  } catch (e: unknown) {
    logErr((e as Error).message);
    process.exit(1);
  }

  const core = new Contract(coreAddress!, CORE_ABI, signer);

  // Sanity check contract
  try {
    const count = await core.nextDepositId() as bigint;
    logOk(`Contract OK — hiện có ${count} deposit(s)`);
  } catch (e: unknown) {
    logErr(`Contract không phản hồi: ${(e as Error).message.slice(0, 100)}`);
    logErr(`Kiểm tra lại địa chỉ SavingCore: ${coreAddress!}`);
    process.exit(1);
  }

  // Đọc gracePeriod thực tế từ contract
  try {
    const iface  = new Interface(["function gracePeriod() view returns (uint256)"]);
    const result = await provider!.call({
      to:   coreAddress!,
      data: iface.encodeFunctionData("gracePeriod"),
    });
    GRACE_PERIOD = Number(iface.decodeFunctionResult("gracePeriod", result)[0]);
    logOk(
      `Grace Period: ${GRACE_PERIOD}s` +
      ` (${(GRACE_PERIOD / 3600).toFixed(1)} giờ` +
      ` / ${(GRACE_PERIOD / 86400).toFixed(2)} ngày)`
    );
  } catch {
    GRACE_PERIOD = parseInt(process.env.GRACE_PERIOD_SEC ?? "259200");
    logWarn(`gracePeriod không đọc được từ contract — dùng GRACE_PERIOD_SEC=${GRACE_PERIOD}s từ .env`);
  }

  // Nhắc nhở về dual-ownership
  console.log("");
  log("ℹ️  Dual-ownership mode: autoRenewDeposit mint NFT về depositor gốc,");
  log("   không phải về ví bot. Bot chỉ trả gas, không nhận gì cả.");
  console.log("");

  log("Chạy batch job khởi động (xử lý deposit tồn đọng nếu có)...");
  await runBatchJob(core);

  scheduleNextBatch(core);
  startCountdown();

  log("Bot đang chạy. Nhấn Ctrl+C để dừng.\n");
}

process.on("SIGINT", () => {
  console.log("\n\nBot đang dừng...");
  printStats();
  process.exit(0);
});

process.on("unhandledRejection", (reason: unknown) => {
  logErr(`Unhandled error: ${reason}`);
});

main().catch((e: Error) => {
  logErr(`Lỗi nghiêm trọng: ${e.message}`);
  process.exit(1);
});
