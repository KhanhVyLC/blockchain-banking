//D:\Coding\Project\frontend\src\App.jsx

import React, { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { ADDRESSES, ERC20_ABI, CORE_ABI } from "./contracts.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt      = (n)   => (Number(n) / 1e6).toFixed(2);
const fmtApr   = (bps) => (Number(bps) / 100).toFixed(2) + "%";

// fmtDate: hiển thị đầy đủ ngày + giờ:phút:giây
const fmtDate  = (ts)  => {
  const d = new Date(Number(ts) * 1000);
  const date = d.toLocaleDateString("vi-VN");
  const hh   = String(d.getHours()).padStart(2, "0");
  const mm   = String(d.getMinutes()).padStart(2, "0");
  const ss   = String(d.getSeconds()).padStart(2, "0");
  return `${date} ${hh}:${mm}:${ss}`;
};

const fmtTenor = (sec) => {
  const s = Number(sec);
  if (s < 3600)        return `${Math.round(s / 60)} phút`;
  if (s < 86400)       return `${(s / 3600).toFixed(s % 3600 === 0 ? 0 : 1)} giờ`;
  if (s % 86400 === 0) return `${s / 86400} ngày`;
  return `${(s / 86400).toFixed(1)} ngày`;
};
const fmtAddr  = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "—";

const STATUS       = ["Active", "Withdrawn", "Manual Renewed", "Auto Renewed"];
const STATUS_COLOR = ["#16a34a", "#64748b", "#7c3aed", "#2563eb"];

// CARD_COLOR cho admin → xanh teal theo màu brand
const CARD_COLOR     = "#006c6c";   // nền card admin (teal)
const CARD_ACCENT    = "#007f7f";   // accent teal nhạt hơn
const CARD_HOVER_BG  = "#005858";   // hover nền card admin (teal đậm)

const VAULT_ABI = [
  "function vaultBalance() view returns (uint256)",
  "function feeReceiver() view returns (address)",
  "function fundVault(uint256)",
  "function withdrawVault(uint256)",
  "function setFeeReceiver(address)",
  "function pause()",
  "function unpause()",
  "function paused() view returns (bool)",
  "function owner() view returns (address)",
];

const ADMIN_ABI = [
  "function createPlan(uint256,uint256,uint256,uint256,uint256)",
  "function updatePlan(uint256,uint256)",
  "function enablePlan(uint256)",
  "function disablePlan(uint256)",
  "function pause()",
  "function unpause()",
  "function paused() view returns (bool)",
  "function owner() view returns (address)",
  "function gracePeriod() view returns (uint256)",
  "function setGracePeriod(uint256)",
  "function financialSummary() view returns (uint256,uint256,uint256,bool,uint256)",
  "function vaultSolvencyCheck() view returns (bool,uint256)",
  "function integrityCheck() view returns (bool,uint256,uint256,uint256)",
];

// ─── Styles ──────────────────────────────────────────────────────────────────
// [CHANGED] Toàn bộ palette chuyển sang light/white theme
const S = {
  page:    { minHeight: "100vh", background: "#f2f2f2", color: "#0f172a", fontFamily: "'Inter',system-ui,sans-serif" },
  header:  { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 32px", borderBottom: "1px solid #e0e0e0", background: "#ffffff", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 1px 4px #0f172a0d" },
  main:    { maxWidth: 1100, margin: "0 auto", padding: "32px 24px" },
  hero:    { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "120px 32px", gap: 24 },
  tabs:    { display: "flex", gap: 4, marginBottom: 24, flexWrap: "wrap" },
  tab:     { padding: "10px 20px", borderRadius: 8, border: "1px solid #e2e8f0", cursor: "pointer", background: "#f1f5f9", color: "#64748b", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 7 },
  tabOn:   { background: "#006c6c", color: "#fff", border: "1px solid #006c6c" },
  tabAdm:  { border: "1px solid #006c6c" },
  card:    { background: "#ffffff", borderRadius: 16, padding: 24, border: "1px solid #e2e8f0", boxShadow: "0 1px 6px #0f172a0a" },
  grid:    { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 20 },
  igrid:   { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 20px", marginTop: 12 },
  btnP:    { background: "#006c6c", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: "pointer", fontSize: 14 },
  btnS:    { background: "#f1f5f9", color: "#334155", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: "pointer", fontSize: 14 },
  btnA:    { background: "#0891b2", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: "pointer", fontSize: 14 },
  btnD:    { background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 18px", fontWeight: 600, cursor: "pointer", fontSize: 14 },
  chip:    { background: "#f1f5f9", border: "1px solid #e2e8f0", padding: "6px 12px", borderRadius: 20, fontSize: 12, color: "#475569", fontFamily: "monospace" },
  overlay: { position: "fixed", inset: 0, background: "#0f172a88", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 },
  modal:   { background: "#ffffff", borderRadius: 16, padding: 28, minWidth: 340, maxWidth: 480, width: "90%", border: "1px solid #e2e8f0", boxShadow: "0 8px 32px #0f172a22" },
  input:   { width: "100%", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 8, padding: "10px 12px", color: "#0f172a", fontSize: 14, boxSizing: "border-box", marginTop: 4 },
  label:   { fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1 },
  toast:   { position: "fixed", top: 20, right: 20, zIndex: 999, padding: "12px 20px", borderRadius: 10, color: "#fff", fontWeight: 600, fontSize: 14, boxShadow: "0 4px 20px #0f172a22", maxWidth: 360 },
};

// ═════════════════════════════════════════════════════════════════════════════
// SHARED SUB-COMPONENTS
// ═════════════════════════════════════════════════════════════════════════════

function InfoItem({ label, value }) {
  return (
    <div>
      <div style={{ color: "#94a3b8", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>{value}</div>
    </div>
  );
}

function AField({ label, value, onChange, placeholder, type = "text", width = "100%" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={S.label}>{label}</label>
      <input
        style={{ ...S.input, width, marginTop: 0, boxSizing: "border-box" }}
        type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

// [CHANGED] AdminCard → nền xanh lá đậm
function AdminCard({ img, label, color, onClick }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? CARD_HOVER_BG : CARD_COLOR,
        border: `2px solid ${hovered ? "#00a0a0" : "#006c6c"}`,
        borderRadius: 16, padding: "28px 16px",
        display: "flex", flexDirection: "column",
        alignItems: "center", gap: 14,
        cursor: "pointer", transition: "all 0.2s",
        transform: hovered ? "translateY(-4px)" : "none",
        boxShadow: hovered ? "0 8px 24px #006c6c66" : "0 2px 8px #006c6c22",
      }}
    >
      {img && (
        <img src={img} alt={label}
          style={{ width: 52, height: 52, objectFit: "contain", filter: "brightness(0) invert(1)" }}
          onError={e => { e.target.style.display = "none"; }}
        />
      )}
      <span style={{ fontWeight: 700, fontSize: 14, color: "#dcfce7", textAlign: "center", lineHeight: 1.4 }}>
        {label}
      </span>
    </div>
  );
}

// ─── VaultSolvency ────────────────────────────────────────────────────────────
function VaultSolvency({ core, vaultBal }) {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (!core) return;
    core.financialSummary().then(s => setSummary({
      principalLocked: s[0], interestOwed: s[1], vaultBalance: s[2], isSolvent: s[3], shortfall: s[4],
    })).catch(() => {});
  }, [vaultBal, core]);

  if (!summary) return null;

  const pct = summary.interestOwed > 0n
    ? Number(summary.vaultBalance * 100n / summary.interestOwed)
    : 100;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
        {[
          { label: "Tiền gốc khoá", value: fmt(summary.principalLocked) + " USDC", color: "#2563eb" },
          { label: "Lãi phải trả",  value: fmt(summary.interestOwed) + " USDC",    color: "#d97706" },
          { label: "Vault hiện có", value: fmt(summary.vaultBalance) + " USDC",    color: summary.isSolvent ? "#16a34a" : "#dc2626" },
        ].map(s => (
          <div key={s.label} style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", textAlign: "center", border: "1px solid #e2e8f0" }}>
            <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>{s.label}</div>
            <div style={{ color: s.color, fontWeight: 700, fontSize: 15 }}>{s.value}</div>
          </div>
        ))}
      </div>
      <div style={{
        background: summary.isSolvent ? "#f0fdf4" : "#fef2f2",
        border: `1px solid ${summary.isSolvent ? "#86efac" : "#fca5a5"}`,
        borderRadius: 10, padding: "12px 16px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: summary.isSolvent ? "#15803d" : "#dc2626", fontWeight: 700 }}>
            {summary.isSolvent ? " Vault đủ khả năng chi trả" : "⚠️ VAULT THIẾU TIỀN LÃI"}
          </span>
          <span style={{ color: "#64748b", fontSize: 13 }}>{Math.min(pct, 100)}% coverage</span>
        </div>
        {!summary.isSolvent && (
          <div style={{ color: "#dc2626", fontSize: 13, marginTop: 6 }}>
            Thiếu {fmt(summary.shortfall)} USDC — cần nạp thêm vào vault
          </div>
        )}
        <div style={{ marginTop: 8, background: "#e2e8f0", borderRadius: 6, height: 6, overflow: "hidden" }}>
          <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: summary.isSolvent ? "#16a34a" : "#dc2626", transition: "width 0.5s" }} />
        </div>
      </div>
    </div>
  );
}

// ─── GracePeriodConfig ────────────────────────────────────────────────────────
function GracePeriodConfig({ core, loading, withLoading }) {
  const [current, setCurrent] = useState(null);
  const [newVal, setNewVal]   = useState("");
  const [unit, setUnit]       = useState("seconds");

  useEffect(() => {
    if (!core) return;
    core.gracePeriod().then(v => setCurrent(Number(v))).catch(() => {});
  }, [core]);

  const toSeconds = (val, u) => {
    const n = parseFloat(val);
    if (u === "hours") return Math.round(n * 3600);
    if (u === "days")  return Math.round(n * 86400);
    return Math.round(n);
  };

  const fmtGrace = (sec) => {
    if (sec == null) return "...";
    if (sec >= 86400) return `${(sec / 86400).toFixed(2)} ngày (${sec}s)`;
    if (sec >= 3600)  return `${(sec / 3600).toFixed(2)} giờ (${sec}s)`;
    return `${sec} giây`;
  };

  return (
    <div>
      <div style={{ ...S.card, padding: "14px 18px", marginBottom: 20, background: "#f0fdf4", border: "1px solid #86efac" }}>
        <div style={{ color: "#64748b", fontSize: 12, marginBottom: 4 }}>Grace Period hiện tại</div>
        <div style={{ color: "#006c6c", fontWeight: 700, fontSize: 18 }}>{fmtGrace(current)}</div>
        <div style={{ color: "#475569", fontSize: 12, marginTop: 4 }}>
          Sau khi đáo hạn, user có thời gian này để tự rút hoặc gia hạn thủ công.<br />
          Hết thời gian → bot tự động gia hạn với APR cũ.
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 400 }}>
        <AField label="Grace period mới" value={newVal} onChange={setNewVal} placeholder="ví dụ: 300" type="number" />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={S.label}>Đơn vị</label>
          <select style={{ ...S.input, marginTop: 0 }} value={unit} onChange={e => setUnit(e.target.value)}>
            <option value="seconds">Giây</option>
            <option value="hours">Giờ</option>
            <option value="days">Ngày</option>
          </select>
        </div>
        {newVal && (
          <div style={{ color: "#64748b", fontSize: 12 }}>= {toSeconds(newVal, unit)} giây</div>
        )}
        <button style={S.btnP} disabled={!!loading || !newVal}
          onClick={() => withLoading("Set Grace Period", async () => {
            const sec = toSeconds(newVal, unit);
            if (sec <= 0)      throw new Error("Phải lớn hơn 0 giây");
            if (sec > 2592000) throw new Error("Tối đa 30 ngày");
            await (await core.setGracePeriod(BigInt(sec))).wait();
            setCurrent(sec);
            setNewVal("");
          })}>
          {loading === "Set Grace Period" ? "Đang xử lý..." : "Cập nhật Grace Period"}
        </button>
      </div>
    </div>
  );
}

// ─── SecurityMonitor ──────────────────────────────────────────────────────────
function SecurityMonitor({ core, vaultBal, withLoading, loading }) {
  const [integrity, setIntegrity] = useState(null);
  const [loading2, setLoading2]   = useState(false);

  const refresh = useCallback(async () => {
    if (!core) return;
    setLoading2(true);
    try {
      const ic = await core.integrityCheck();
      setIntegrity({ isIntact: ic[0], actual: ic[1], expected: ic[2], diff: ic[3] });
    } catch (e) { console.error(e); }
    setLoading2(false);
  }, [core]);

  useEffect(() => { refresh(); }, [vaultBal, refresh]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button style={{ ...S.btnS, fontSize: 12, padding: "6px 14px" }} onClick={refresh} disabled={loading2}>
          {loading2 ? "Đang kiểm tra..." : "🔄 Refresh"}
        </button>
      </div>
      <p style={{ color: "#94a3b8", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 8px" }}>
        Kiểm tra tính toàn vẹn (Integrity Check)
      </p>
      {integrity ? (
        <div style={{
          background: integrity.isIntact ? "#f0fdf4" : "#fef2f2",
          border: `1px solid ${integrity.isIntact ? "#86efac" : "#fca5a5"}`,
          borderRadius: 10, padding: "14px 16px", marginBottom: 20,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 12, height: 12, borderRadius: "50%",
              background: integrity.isIntact ? "#16a34a" : "#dc2626",
              boxShadow: `0 0 8px ${integrity.isIntact ? "#16a34a" : "#dc2626"}`,
            }} />
            <span style={{ fontWeight: 700, color: integrity.isIntact ? "#15803d" : "#dc2626" }}>
              {integrity.isIntact ? "✅ Số dư khớp — không phát hiện bất thường" : "🚨 CẢNH BÁO: Số dư KHÔNG khớp!"}
            </span>
          </div>
          {!integrity.isIntact && (
            <div style={{ color: "#dc2626", fontSize: 13, marginTop: 6 }}>
              Sổ sách: {fmt(integrity.expected)} USDC · Thực tế: {fmt(integrity.actual)} USDC · Thiếu: {fmt(integrity.diff)} USDC
            </div>
          )}
          {integrity.isIntact && (
            <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>
              Contract giữ: {fmt(integrity.actual)} USDC · Sổ sách: {fmt(integrity.expected)} USDC
            </div>
          )}
        </div>
      ) : <div style={{ color: "#64748b", fontSize: 13, marginBottom: 20 }}>Đang tải...</div>}
      <p style={{ color: "#94a3b8", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, margin: "0 0 8px" }}>
        Vault Solvency
      </p>
      <VaultSolvency core={core} vaultBal={vaultBal} />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN PANEL
// ═════════════════════════════════════════════════════════════════════════════

function AdminPanel({ panelKey, onBack, vault, core, usdc, signer, account,
  loading, withLoading, isPaused, setIsPaused, plans, vaultBal }) {

  const [newPlan,  setNewPlan]  = useState({ tenorVal: "", tenorUnit: "days", aprBps: "", minDeposit: "", maxDeposit: "", penaltyBps: "" });
  const [updForm,  setUpdForm]  = useState({ planId: "", newAprBps: "" });
  const [togForm,  setTogForm]  = useState({ planId: "", action: "enable" });
  const [fundAmt,  setFundAmt]  = useState("");
  const [wdAmt,    setWdAmt]    = useState("");
  const [feeRcv,   setFeeRcv]   = useState("...");
  const [newFee,   setNewFee]   = useState("");
  const [mintTo,   setMintTo]   = useState("");
  const [mintAmt,  setMintAmt]  = useState("10000");
  const [mintHist, setMintHist] = useState([]);

  useEffect(() => {
    if (vault) vault.feeReceiver().then(setFeeRcv).catch(() => {});
  }, [vault]);

  const Back = () => (
    <button onClick={onBack} style={{ ...S.btnS, marginBottom: 20, display: "flex", alignItems: "center", gap: 6 }}>
      ← Quay lại
    </button>
  );

  if (panelKey === "createPlan") return (
    <div>
      <Back />
      <h3 style={{ color: "#006c6c", marginTop: 0 }}> Tạo Saving Plan mới</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 420 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={S.label}>Kỳ hạn</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...S.input, marginTop: 0, flex: 1 }} type="number"
              value={newPlan.tenorVal} placeholder="ví dụ: 7"
              onChange={e => setNewPlan(p => ({ ...p, tenorVal: e.target.value }))} />
            <select style={{ ...S.input, marginTop: 0, width: 100 }}
              value={newPlan.tenorUnit}
              onChange={e => setNewPlan(p => ({ ...p, tenorUnit: e.target.value }))}>
              <option value="seconds">Giây</option>
              <option value="hours">Giờ</option>
              <option value="days">Ngày</option>
            </select>
          </div>
        </div>
        <AField label="APR (bps) — 500=5%"    value={newPlan.aprBps}     onChange={v => setNewPlan(p => ({ ...p, aprBps: v }))}     placeholder="500" type="number" />
        <AField label="Min Deposit USDC (0=∞)" value={newPlan.minDeposit} onChange={v => setNewPlan(p => ({ ...p, minDeposit: v }))} placeholder="0"   type="number" />
        <AField label="Max Deposit USDC (0=∞)" value={newPlan.maxDeposit} onChange={v => setNewPlan(p => ({ ...p, maxDeposit: v }))} placeholder="0"   type="number" />
        <AField label="Penalty (bps) — 500=5%" value={newPlan.penaltyBps} onChange={v => setNewPlan(p => ({ ...p, penaltyBps: v }))} placeholder="500" type="number" />
        <button style={S.btnP} disabled={!!loading}
          onClick={() => withLoading("Tạo Plan", async () => {
            const u = v => v && v !== "0" ? ethers.parseUnits(v, 6) : 0n;
            const tenorSec = newPlan.tenorUnit === "seconds"
              ? BigInt(Math.round(parseFloat(newPlan.tenorVal)))
              : newPlan.tenorUnit === "hours"
                ? BigInt(Math.round(parseFloat(newPlan.tenorVal) * 3600))
                : BigInt(Math.round(parseFloat(newPlan.tenorVal) * 86400));
            await (await core.createPlan(tenorSec, BigInt(newPlan.aprBps),
              u(newPlan.minDeposit), u(newPlan.maxDeposit), BigInt(newPlan.penaltyBps))).wait();
            setNewPlan({ tenorVal: "", tenorUnit: "days", aprBps: "", minDeposit: "", maxDeposit: "", penaltyBps: "" });
          })}>
          {loading === "Tạo Plan" ? "Đang xử lý..." : "➕ Tạo Plan"}
        </button>
      </div>
    </div>
  );

  if (panelKey === "updatePlan") return (
    <div>
      <Back />
      <h3 style={{ color: "#d97706", marginTop: 0 }}> Cập nhật APR</h3>
      <p style={{ color: "#64748b", fontSize: 13 }}>⚠️ Chỉ ảnh hưởng deposit <strong>mới</strong> — deposit đang mở không thay đổi.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 340 }}>
        <AField label="Plan ID"       value={updForm.planId}    onChange={v => setUpdForm(f => ({ ...f, planId: v }))}    placeholder="0"   type="number" />
        <AField label="APR mới (bps)" value={updForm.newAprBps} onChange={v => setUpdForm(f => ({ ...f, newAprBps: v }))} placeholder="300" type="number" />
        <button style={S.btnA} disabled={!!loading}
          onClick={() => withLoading("Cập nhật APR", async () => {
            await (await core.updatePlan(BigInt(updForm.planId), BigInt(updForm.newAprBps))).wait();
          })}>
          {loading === "Cập nhật APR" ? "..." : "Cập nhật"}
        </button>
      </div>
    </div>
  );

  if (panelKey === "togglePlan") return (
    <div>
      <Back />
      <h3 style={{ color: "#0891b2", marginTop: 0 }}> Bật / Tắt Plan</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 340 }}>
        <AField label="Plan ID" value={togForm.planId} onChange={v => setTogForm(f => ({ ...f, planId: v }))} placeholder="0" type="number" />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={S.label}>Hành động</label>
          <select style={{ ...S.input, marginTop: 0 }} value={togForm.action} onChange={e => setTogForm(f => ({ ...f, action: e.target.value }))}>
            <option value="enable"> Enable</option>
            <option value="disable"> Disable</option>
          </select>
        </div>
        <button style={S.btnA} disabled={!!loading}
          onClick={() => withLoading("Toggle Plan", async () => {
            const tx = togForm.action === "enable"
              ? await core.enablePlan(BigInt(togForm.planId))
              : await core.disablePlan(BigInt(togForm.planId));
            await tx.wait();
          })}>
          {loading === "Toggle Plan" ? "..." : "Xác nhận"}
        </button>
      </div>
      <div style={{ marginTop: 24 }}>
        <p style={{ color: "#94a3b8", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Danh sách plans</p>
        {plans.map(p => (
          <div key={String(p.id)} style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: "#f8fafc", borderRadius: 8, marginBottom: 6, fontSize: 13, border: "1px solid #e2e8f0" }}>
            <span>Plan #{String(p.id)} — {fmtTenor(p.tenorSeconds)} · {fmtApr(p.aprBps)}</span>
            <span style={{ color: p.enabled ? "#16a34a" : "#dc2626", fontWeight: 700 }}>{p.enabled ? " ON" : " OFF"}</span>
          </div>
        ))}
      </div>
    </div>
  );

  if (panelKey === "vault") return (
    <div>
      <Back />
      <h3 style={{ color: "#16a34a", marginTop: 0 }}> Quản lý Vault & Đối soát</h3>
      <VaultSolvency core={core} vaultBal={vaultBal} />
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 340 }}>
        <AField label="Nạp vào vault (USDC)" value={fundAmt} onChange={setFundAmt} placeholder="10000" type="number" />
        <button style={S.btnP} disabled={!!loading}
          onClick={() => withLoading("Nạp Vault", async () => {
            const amt = ethers.parseUnits(fundAmt, 6);
            await (await usdc.approve(ADDRESSES.VaultManager, amt)).wait();
            await (await vault.fundVault(amt)).wait();
            setFundAmt("");
          })}>
          {loading === "Nạp Vault" ? "..." : " Nạp vào Vault"}
        </button>
        <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 14 }}>
          <AField label="Rút từ vault (USDC)" value={wdAmt} onChange={setWdAmt} placeholder="1000" type="number" />
        </div>
        <button style={S.btnD} disabled={!!loading}
          onClick={() => withLoading("Rút Vault", async () => {
            await (await vault.withdrawVault(ethers.parseUnits(wdAmt, 6))).wait();
            setWdAmt("");
          })}>
          {loading === "Rút Vault" ? "..." : " Rút từ Vault"}
        </button>
      </div>
    </div>
  );

  if (panelKey === "feeReceiver") return (
    <div>
      <Back />
      <h3 style={{ color: "#7c3aed", marginTop: 0 }}>💸 Fee Receiver</h3>
      <div style={{ ...S.card, padding: 14, marginBottom: 20, background: "#f8fafc" }}>
        <div style={{ color: "#64748b", fontSize: 12, marginBottom: 4 }}>Địa chỉ hiện tại</div>
        <code style={{ color: "#0f172a", fontSize: 12, wordBreak: "break-all" }}>{feeRcv}</code>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 420 }}>
        <AField label="Địa chỉ mới" value={newFee} onChange={setNewFee} placeholder="0x..." />
        <button style={S.btnA} disabled={!!loading}
          onClick={() => withLoading("Set Fee Receiver", async () => {
            await (await vault.setFeeReceiver(newFee)).wait();
            setFeeRcv(newFee); setNewFee("");
          })}>
          {loading === "Set Fee Receiver" ? "..." : "Cập nhật Fee Receiver"}
        </button>
      </div>
    </div>
  );

  if (panelKey === "pause") return (
    <div>
      <Back />
      <h3 style={{ color: "#dc2626", marginTop: 0 }}> Khẩn cấp — Pause / Unpause</h3>
      <div style={{ ...S.card, padding: 20, marginBottom: 20, borderLeft: "4px solid #dc2626", background: "#fef2f2" }}>
        <div style={{ color: "#64748b", fontSize: 13, marginBottom: 12 }}>
          Khi pause: tất cả <strong>deposit, withdraw, renew</strong> đều bị chặn.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 12, height: 12, borderRadius: "50%",
            background: isPaused ? "#dc2626" : "#16a34a",
            boxShadow: `0 0 8px ${isPaused ? "#dc2626" : "#16a34a"}`,
          }} />
          <span style={{ fontWeight: 700, fontSize: 16, color: isPaused ? "#dc2626" : "#16a34a" }}>
            {isPaused ? "HỆ THỐNG ĐANG TẠM DỪNG" : "HỆ THỐNG ĐANG HOẠT ĐỘNG"}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <button style={{ ...S.btnD, padding: "14px 28px", fontSize: 15 }} disabled={!!loading || isPaused}
          onClick={() => withLoading("Pause", async () => {
            await (await core.pause()).wait();
            setIsPaused(true);
          })}>
          {loading === "Pause" ? "..." : "⏸ Pause System"}
        </button>
        <button style={{ ...S.btnP, padding: "14px 28px", fontSize: 15 }} disabled={!!loading || !isPaused}
          onClick={() => withLoading("Unpause", async () => {
            await (await core.unpause()).wait();
            setIsPaused(false);
          })}>
          {loading === "Unpause" ? "..." : "▶ Unpause System"}
        </button>
      </div>
    </div>
  );

  if (panelKey === "graceperiod") return (
    <div>
      <Back />
      <h3 style={{ color: "#006c6c", marginTop: 0 }}>⏱ Cập nhật Grace Period</h3>
      <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 20px" }}>
        Sau khi deposit đáo hạn, user có đúng thời gian này để tự rút hoặc gia hạn thủ công.
        Hết thời gian → bot tự động gia hạn với <strong style={{ color: "#0f172a" }}>APR cũ</strong>.
      </p>
      <GracePeriodConfig core={core} loading={loading} withLoading={withLoading} />
    </div>
  );

  if (panelKey === "mint") return (
    <div>
      <Back />
      <h3 style={{ color: "#475569", marginTop: 0 }}> Phát USDC cho Depositor</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 420 }}>
        <AField label="Địa chỉ ví nhận" value={mintTo}  onChange={setMintTo}  placeholder="0x..." />
        <AField label="Số lượng (USDC)"  value={mintAmt} onChange={setMintAmt} placeholder="10000" type="number" />
        <button style={S.btnP} disabled={!!loading || !mintTo}
          onClick={() => withLoading("Mint", async () => {
            if (!ethers.isAddress(mintTo)) throw new Error("Địa chỉ không hợp lệ");
            const iface = new ethers.Interface(["function mint(address,uint256)"]);
            await (await signer.sendTransaction({
              to: ADDRESSES.MockUSDC,
              data: iface.encodeFunctionData("mint", [mintTo, ethers.parseUnits(mintAmt, 6)]),
            })).wait();
            setMintHist(h => [{ addr: mintTo, amt: mintAmt, time: new Date().toLocaleTimeString("vi-VN") }, ...h.slice(0, 4)]);
            setMintTo("");
          })}>
          {loading === "Mint" ? "Đang mint..." : " Mint USDC"}
        </button>
        <button style={S.btnS} disabled={!!loading}
          onClick={() => withLoading("Mint Self", async () => {
            const iface = new ethers.Interface(["function mint(address,uint256)"]);
            await (await signer.sendTransaction({
              to: ADDRESSES.MockUSDC,
              data: iface.encodeFunctionData("mint", [account, ethers.parseUnits("10000", 6)]),
            })).wait();
          })}>
          {loading === "Mint Self" ? "..." : " Mint 10,000 cho tôi"}
        </button>
        {mintHist.length > 0 && (
          <div style={{ background: "#f8fafc", borderRadius: 8, padding: "10px 14px", border: "1px solid #e2e8f0" }}>
            <p style={{ color: "#94a3b8", fontSize: 11, textTransform: "uppercase", margin: "0 0 8px" }}>Lịch sử mint</p>
            {mintHist.map((h, i) => (
              <div key={i} style={{ fontSize: 12, color: "#64748b", padding: "4px 0", borderBottom: i < mintHist.length - 1 ? "1px solid #e2e8f0" : "none" }}>
                <span style={{ color: "#16a34a" }}>✓</span> <span style={{ color: "#0f172a" }}>{h.amt} USDC</span> → {h.addr.slice(0, 10)}...{h.addr.slice(-6)} <span style={{ color: "#94a3b8" }}>({h.time})</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (panelKey === "plans") return (
    <div>
      <Back />
      <h3 style={{ color: "#0891b2", marginTop: 0 }}> Danh sách Plans</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "#94a3b8", background: "#f8fafc" }}>
              {["ID", "Tenor", "APR", "Min", "Max", "Penalty", "Trạng thái"].map(h => (
                <th key={h} style={{ padding: "8px 12px", borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plans.map(p => (
              <tr key={String(p.id)} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "10px 12px" }}>#{String(p.id)}</td>
                <td style={{ padding: "10px 12px" }}>{fmtTenor(p.tenorSeconds)}</td>
                <td style={{ padding: "10px 12px", color: "#006c6c", fontWeight: 700 }}>{fmtApr(p.aprBps)}</td>
                <td style={{ padding: "10px 12px" }}>{p.minDeposit > 0n ? fmt(p.minDeposit) + " USDC" : "—"}</td>
                <td style={{ padding: "10px 12px" }}>{p.maxDeposit > 0n ? fmt(p.maxDeposit) + " USDC" : "—"}</td>
                <td style={{ padding: "10px 12px" }}>{fmtApr(p.earlyWithdrawPenaltyBps)}</td>
                <td style={{ padding: "10px 12px" }}>
                  <span style={{ color: p.enabled ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                    {p.enabled ? " Enabled" : " Disabled"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  if (panelKey === "security") return (
    <div>
      <Back />
      <h3 style={{ color: "#dc2626", marginTop: 0 }}>🛡️ Security Monitor</h3>
      <SecurityMonitor core={core} vaultBal={vaultBal} withLoading={withLoading} loading={loading} />
    </div>
  );

  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN TAB
// ═════════════════════════════════════════════════════════════════════════════

function AdminTab({ vault, core, usdc, signer, account, loading, withLoading,
  isPaused, setIsPaused, plans, vaultBal }) {
  const [activePanel, setActivePanel] = useState(null);

  const MENU = [
    { key: "createPlan",  img: "/ic_create_plan.png", label: "Tạo Plan mới"     },
    { key: "updatePlan",  img: "/ic_update_apr.png",  label: "Cập nhật APR"     },
    { key: "togglePlan",  img: "/ic_toggle_plan.png", label: "Bật / Tắt Plan"   },
    { key: "vault",       img: "/ic_vault.png",       label: "Quản lý Vault"    },
    { key: "feeReceiver", img: "/ic_fee.png",         label: "Fee Receiver"     },
    { key: "pause",       img: isPaused ? "/ic_unpause.png" : "/ic_pause.png",
                          label: isPaused ? "Unpause System" : "Pause System"   },
    { key: "graceperiod", img: "/ic_grace.png",       label: "Grace Period"     },
    { key: "mint",        img: "/ic_mint.png",        label: "Phát USDC"        },
    { key: "plans",       img: "/ic_plans.png",       label: "Xem Plans"        },
    { key: "security",    img: "/ic_security.png",    label: "Security Monitor" },
  ];

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Vault Balance", value: fmt(vaultBal) + " USDC",              color: "#16a34a" },
          { label: "Số Plans",      value: plans.length + " plans",               color: "#006c6c" },
          { label: "System Status", value: isPaused ? "⏸ PAUSED" : "▶ RUNNING",  color: isPaused ? "#dc2626" : "#16a34a" },
        ].map(s => (
          <div key={s.label} style={{ ...S.card, textAlign: "center", padding: 16 }}>
            <div style={{ color: "#94a3b8", fontSize: 11, textTransform: "uppercase", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontWeight: 700, color: s.color, fontSize: 15 }}>{s.value}</div>
          </div>
        ))}
      </div>
      {activePanel ? (
        <div style={S.card}>
          <AdminPanel
            panelKey={activePanel} onBack={() => setActivePanel(null)}
            vault={vault} core={core} usdc={usdc} signer={signer} account={account}
            loading={loading} withLoading={withLoading}
            isPaused={isPaused} setIsPaused={setIsPaused}
            plans={plans} vaultBal={vaultBal}
          />
        </div>
      ) : (
        // [CHANGED] Admin icon grid → nền xanh lá đậm qua AdminCard
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(155px,1fr))", gap: 16 }}>
          {MENU.map(m => (
            <AdminCard key={m.key} img={m.img} label={m.label} color={CARD_COLOR}
              onClick={() => setActivePanel(m.key)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// USER COMPONENTS
// ═════════════════════════════════════════════════════════════════════════════

function OpenDepositModal({ plan, onClose, usdc, core, balance, loading, withLoading }) {
  const [amount, setAmount] = useState("");
  const interest = amount
    ? fmt((ethers.parseUnits(amount || "0", 6) * plan.aprBps * BigInt(plan.tenorSeconds)) / (365n * 86400n * 10000n))
    : null;

  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <h3 style={{ marginTop: 0, color: "#0f172a" }}>Mở Deposit — Plan #{String(plan.id)}</h3>
        <p style={{ color: "#64748b", fontSize: 14 }}>
          {fmtTenor(plan.tenorSeconds)} · {fmtApr(plan.aprBps)} APR · Penalty: {fmtApr(plan.earlyWithdrawPenaltyBps)}
        </p>
        <label style={S.label}>Số tiền (USDC)</label>
        <input style={S.input} type="number" placeholder="ví dụ: 1000"
          value={amount} onChange={e => setAmount(e.target.value)} />
        <p style={{ color: "#64748b", fontSize: 12, margin: "6px 0 4px" }}>Số dư: {fmt(balance)} USDC</p>
        {interest && (
          <p style={{ color: "#006c6c", fontSize: 13, margin: "0 0 12px" }}>
            💰 Lãi dự kiến: ~{interest} USDC sau {fmtTenor(plan.tenorSeconds)}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button style={S.btnP} disabled={!amount || !!loading}
            onClick={() => withLoading("Open Deposit", async () => {
              const parsed = ethers.parseUnits(amount, 6);
              await (await usdc.approve(ADDRESSES.SavingCore, parsed)).wait();
              await (await core.openDeposit(plan.id, parsed)).wait();
              onClose();
            })}>
            {loading === "Open Deposit" ? "Đang xử lý..." : "Xác nhận"}
          </button>
          <button style={S.btnS} onClick={onClose}>Huỷ</button>
        </div>
      </div>
    </div>
  );
}

function RenewModal({ deposit, plans, core, onClose, loading, withLoading }) {
  const [planId, setPlanId] = useState("");
  return (
    <div style={S.overlay}>
      <div style={S.modal}>
        <h3 style={{ marginTop: 0, color: "#0f172a" }}>Gia hạn Deposit #{String(deposit.id)}</h3>
        <label style={S.label}>Chọn Plan mới</label>
        <select style={{ ...S.input, marginTop: 4 }} value={planId} onChange={e => setPlanId(e.target.value)}>
          <option value="">-- Chọn plan --</option>
          {plans.filter(p => p.enabled).map(p => (
            <option key={String(p.id)} value={String(p.id)}>
              Plan #{String(p.id)}: {fmtTenor(p.tenorSeconds)} · {fmtApr(p.aprBps)}
            </option>
          ))}
        </select>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button style={S.btnP} disabled={!planId || !!loading}
            onClick={() => withLoading("Renew", async () => {
              await (await core.renewDeposit(deposit.id, BigInt(planId))).wait();
              onClose();
            })}>
            {loading === "Renew" ? "Đang xử lý..." : "Gia hạn"}
          </button>
          <button style={S.btnS} onClick={onClose}>Huỷ</button>
        </div>
      </div>
    </div>
  );
}

// ─── DepositCard ──────────────────────────────────────────────────────────────
function DepositCard({ dep, plans, core, isPaused, loading, withLoading, gracePeriod, account }) {
  const [modal, setModal] = useState(null);

  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (dep.status !== 0n) return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [dep.status]);

  const isActive       = dep.status === 0n;
  const maturity       = Number(dep.maturityAt);
  const isMatured      = isActive && now >= maturity;
  const isEarly        = isActive && now < maturity;
  const gracePeriodEnd = maturity + gracePeriod;

  const estInterest = isActive
    ? fmt((dep.principal * dep.aprBpsAtOpen * dep.tenorSeconds) / (365n * 86400n * 10000n))
    : "—";

  const isDepositor = dep.depositor?.toLowerCase() === account?.toLowerCase();
  const isNftOwnerNotDepositor = !isDepositor;

  // [CHANGED] fmtRemaining: luôn hiển thị đủ phút và giây
  const fmtRemaining = (endTs) => {
    const rem = endTs - now;
    if (rem <= 0) return "đã đáo hạn";
    const days  = Math.floor(rem / 86400);
    const hours = Math.floor((rem % 86400) / 3600);
    const mins  = Math.floor((rem % 3600) / 60);
    const secs  = rem % 60;
    if (days > 0)  return `${days} ngày ${hours} giờ ${mins} phút ${secs} giây`;
    if (hours > 0) return `${hours} giờ ${mins} phút ${secs} giây`;
    return `${mins} phút ${secs} giây`;
  };

  return (
    <div style={S.card}>
      {modal === "renew" && (
        <RenewModal deposit={dep} plans={plans} core={core} onClose={() => setModal(null)}
          loading={loading} withLoading={withLoading} />
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: "#0f172a" }}>
          Deposit #{String(dep.originalId ?? dep.id)}
          {dep.renewCount > 0 && (
            <span style={{ color: "#94a3b8", fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
              (hiện tại #{String(dep.id)})
            </span>
          )}
        </span>
        <span style={{
          background: STATUS_COLOR[Number(dep.status)] + "18",
          color: STATUS_COLOR[Number(dep.status)],
          padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600,
          border: `1px solid ${STATUS_COLOR[Number(dep.status)]}44`,
        }}>
          {STATUS[Number(dep.status)]}
        </span>
      </div>

      {/* Info grid */}
      <div style={S.igrid}>
        <InfoItem label="Vốn"              value={fmt(dep.principal) + " USDC"} />
        <InfoItem label="Kỳ hạn"           value={fmtTenor(dep.tenorSeconds)} />
        <InfoItem label="APR"              value={fmtApr(dep.aprBpsAtOpen)} />
        <InfoItem label="Lãi dự kiến"      value={estInterest + " USDC"} />
        {/* [CHANGED] Hiển thị ngày+giờ:phút:giây đầy đủ */}
        <InfoItem label="Ngày mở gốc"      value={fmtDate(dep.originalStartAt || dep.startAt)} />
        <InfoItem label="Đáo hạn gần nhất" value={fmtDate(dep.maturityAt)} />
      </div>

      {/* Renew count badge */}
      {dep.renewCount > 0 && (
        <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ background: "#ede9fe", color: "#7c3aed", fontSize: 12, padding: "2px 10px", borderRadius: 20, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <img src="/ic_renew.png" alt="" style={{ width: 13, height: 13, objectFit: "contain" }} onError={e => e.target.style.display="none"} />
            Đã gia hạn {dep.renewCount} lần
          </span>
          <span style={{ color: "#94a3b8", fontSize: 12 }}>
            Kỳ hiện tại bắt đầu: {fmtDate(dep.startAt)}
          </span>
        </div>
      )}

      {/* Banner cảnh báo NFT owner không phải depositor */}
      {isNftOwnerNotDepositor && isActive && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: "#fffbeb", borderRadius: 8, border: "1px solid #fcd34d", fontSize: 12 }}>
          <span style={{ color: "#b45309", fontWeight: 600 }}>⚠️ Bạn giữ NFT nhưng không phải depositor gốc</span>
          <div style={{ color: "#92400e", marginTop: 3 }}>
            Depositor: <code style={{ color: "#b45309", fontSize: 11 }}>{fmtAddr(dep.depositor)}</code>
            {" "}— chỉ họ mới rút được tiền. Bạn chỉ có thể gia hạn.
          </div>
        </div>
      )}

      {/* Status banners */}
      {isEarly && !isPaused && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: "#e6f7f7", borderRadius: 8, color: "#005252", fontSize: 13, border: "1px solid #99d4d4", display: "flex", alignItems: "center", gap: 8 }}>
          <img src="/ic_countdown.png" alt="" style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }} onError={e => e.target.style.display="none"} />
          Còn {fmtRemaining(maturity)} đến đáo hạn
        </div>
      )}
      {isMatured && now < gracePeriodEnd && !isPaused && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: "#fffbeb", borderRadius: 8, color: "#b45309", fontSize: 13, border: "1px solid #fcd34d", display: "flex", alignItems: "center", gap: 8 }}>
          <img src="/ic_countdown.png" alt="" style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }} onError={e => e.target.style.display="none"} />
          Trong grace period — còn {fmtRemaining(gracePeriodEnd)} để tự rút hoặc gia hạn thủ công
        </div>
      )}
      {isPaused && isActive && (
        <div style={{ marginTop: 8, padding: "10px 14px", background: "#fef2f2", borderRadius: 8, color: "#dc2626", fontSize: 13, textAlign: "center", border: "1px solid #fca5a5" }}>
          ⏸ Hệ thống đang tạm dừng — mọi giao dịch bị chặn
        </div>
      )}

      {/* Action buttons */}
      {isActive && !isPaused && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {isEarly && isDepositor && (
            <button style={{ ...S.btnD, display: "flex", alignItems: "center", gap: 7 }} onClick={() => {
              if (!window.confirm(`Rút sớm mất ${fmtApr(dep.penaltyBpsAtOpen)} phí phạt.\nBạn nhận: ${fmt(dep.principal - dep.principal * dep.penaltyBpsAtOpen / 10000n)} USDC\nTiếp tục?`)) return;
              withLoading("Rút sớm", async () => { await (await core.earlyWithdraw(dep.id)).wait(); });
            }}>
              <img src="/ic_warning.png" alt="" style={{ width: 16, height: 16, objectFit: "contain" }} onError={e => e.target.style.display="none"} />
              Rút sớm (mất phạt)
            </button>
          )}
          {isMatured && isDepositor && (
            <button style={S.btnP}
              onClick={() => withLoading("Rút tiền", async () => { await (await core.withdrawAtMaturity(dep.id)).wait(); })}>
               Rút tiền gốc & Lãi
            </button>
          )}
          {isMatured && (
            <button style={{ ...S.btnA, display: "flex", alignItems: "center", gap: 7 }} onClick={() => setModal("renew")}>
              <img src="" alt="" style={{ width: 16, height: 16, objectFit: "contain" }} onError={e => e.target.style.display="none"} />
              Gia hạn
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── DepositFilter ────────────────────────────────────────────────────────────
function DepositFilter({ deposits, filter, setFilter }) {
  const FILTERS = [
    { key: "all",       label: "Tất cả" },
    { key: "active",    label: "Active" },
    { key: "withdrawn", label: "Withdrawn" },
  ];
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {FILTERS.map(f => (
        <button
          key={f.key}
          onClick={() => setFilter(f.key)}
          style={{
            padding: "6px 14px",
            borderRadius: 20,
            border: filter === f.key ? "1.5px solid #006c6c" : "1.5px solid #e2e8f0",
            background: filter === f.key ? "#006c6c" : "#ffffff",
            color: filter === f.key ? "#ffffff" : "#64748b",
            fontWeight: 600,
            fontSize: 12,
            cursor: "pointer",
            transition: "all 0.15s",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          {f.label}
          {f.key !== "all" && (
            <span style={{
              background: filter === f.key ? "rgba(255,255,255,0.25)" : "#f1f5f9",
              color: filter === f.key ? "#fff" : "#94a3b8",
              borderRadius: 10,
              padding: "1px 7px",
              fontSize: 11,
            }}>
              {f.key === "active"    ? deposits.filter(d => Number(d.status) === 0).length : ""}
              {f.key === "withdrawn" ? deposits.filter(d => Number(d.status) === 1).length : ""}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── DepositsTab ─────────────────────────────────────────────────────────────
function DepositsTab({ deposits, plans, core, isPaused, loading, withLoading, gracePeriod, account, onSwitchToPlans, filter }) {
  const filtered = deposits.filter(d => {
    if (filter === "all")       return true;
    if (filter === "active")    return Number(d.status) === 0;
    if (filter === "withdrawn") return Number(d.status) === 1;
    return true;
  });

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {deposits.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: "#64748b" }}>
            <p style={{ fontSize: 48 }}>📭</p>
            <p>Bạn chưa có deposit nào.</p>
            <button style={S.btnP} onClick={onSwitchToPlans}>Xem Saving Plans</button>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 48, color: "#64748b" }}>
            <p style={{ fontSize: 32 }}>🔍</p>
            <p>Không có deposit nào ở trạng thái này.</p>
          </div>
        ) : filtered.map(d => (
          <DepositCard key={String(d.id)} dep={d} plans={plans} core={core}
            isPaused={isPaused} loading={loading} withLoading={withLoading}
            gracePeriod={gracePeriod} account={account}
          />
        ))}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═════════════════════════════════════════════════════════════════════════════

export default function App() {
  const [signer,      setSigner]      = useState(null);
  const [account,     setAccount]     = useState("");
  const [core,        setCore]        = useState(null);
  const [usdc,        setUsdc]        = useState(null);
  const [vault,       setVault]       = useState(null);
  const [plans,       setPlans]       = useState([]);
  const [deposits,    setDeposits]    = useState([]);
  const [balance,     setBalance]     = useState(0n);
  const [vaultBal,    setVaultBal]    = useState(0n);
  const [isAdmin,     setIsAdmin]     = useState(false);
  const [isPaused,    setIsPaused]    = useState(false);
  const [tab,         setTab]         = useState("plans");
  const [loading,     setLoading]     = useState("");
  const [toast,       setToast]       = useState(null);
  const [openModal,   setOpenModal]   = useState(null);
  const [gracePeriod, setGracePeriod] = useState(3 * 86400);
  const [depositFilter, setDepositFilter] = useState("all");

  const disconnect = () => {
    setSigner(null); setAccount(""); setCore(null); setUsdc(null); setVault(null);
    setPlans([]); setDeposits([]); setBalance(0n); setVaultBal(0n);
    setIsAdmin(false); setIsPaused(false); setGracePeriod(3 * 86400);
  };

  const connect = async () => {
    if (!window.ethereum) return alert("Vui lòng cài MetaMask.");
    const web3 = new ethers.BrowserProvider(window.ethereum);
    const sgn  = await web3.getSigner();
    const addr = await sgn.getAddress();
    setSigner(sgn); setAccount(addr);
    const coreC  = new ethers.Contract(ADDRESSES.SavingCore,   [...CORE_ABI, ...ADMIN_ABI], sgn);
    const usdcC  = new ethers.Contract(ADDRESSES.MockUSDC,     ERC20_ABI, sgn);
    const vaultC = new ethers.Contract(ADDRESSES.VaultManager, VAULT_ABI, sgn);
    setCore(coreC); setUsdc(usdcC); setVault(vaultC);
    try {
      const owner = await coreC.owner();
      setIsAdmin(owner.toLowerCase() === addr.toLowerCase());
    } catch {}
    window.ethereum.on("accountsChanged", accounts => {
      if (accounts.length === 0) disconnect(); else window.location.reload();
    });
  };

  // ── Loaders ───────────────────────────────────────────────────────────────
  const loadPlans = useCallback(async () => {
    if (!core) return;
    const count = await core.nextPlanId();
    const arr = [];
    for (let i = 0n; i < count; i++) {
      const p = await core.getPlan(i);
      arr.push({
        id: i,
        tenorSeconds:            p[0],
        aprBps:                  p[1],
        minDeposit:              p[2],
        maxDeposit:              p[3],
        earlyWithdrawPenaltyBps: p[4],
        enabled:                 p[5],
      });
    }
    setPlans(arr);
  }, [core]);

  const loadDeposits = useCallback(async () => {
    if (!core || !account) return;
    try {
      const allIds = new Set();

      const openEvs = await core.queryFilter(
        core.filters.DepositOpened(null, account), 0, "latest"
      );
      for (const e of openEvs) allIds.add(String(BigInt(e.args[0])));

      const renewEvs = await core.queryFilter(core.filters.Renewed(), 0, "latest");
      const renewedFromStr = {};
      for (const e of renewEvs) {
        const oldId = String(BigInt(e.args[0]));
        const newId = String(BigInt(e.args[1]));
        renewedFromStr[newId] = oldId;
        allIds.add(newId);
      }

      const traceOrigin = async (idBigInt) => {
        let curId   = String(BigInt(idBigInt));
        let count   = 0;
        const visited = new Set();
        while (renewedFromStr[curId] !== undefined) {
          if (visited.has(curId)) break;
          visited.add(curId);
          curId = renewedFromStr[curId];
          count++;
        }
        try {
          const orig = await core.getDeposit(BigInt(curId));
          return { originalStartAt: orig[5], renewCount: count, originalId: BigInt(curId) };
        } catch {
          return { originalStartAt: null, renewCount: count, originalId: BigInt(idBigInt) };
        }
      };

      const active = [];
      for (const idStr of allIds) {
        const id = BigInt(idStr);
        try {
          const d = await core.getDeposit(id);
          const depositor = d[8];

          if (depositor.toLowerCase() !== account.toLowerCase()) continue;

          const status = Number(d[7]);
          if (status !== 0 && status !== 1) continue;

          const { originalStartAt, renewCount, originalId } = await traceOrigin(id);

          active.push({
            id,
            planId:           d[0],
            principal:        d[1],
            aprBpsAtOpen:     d[2],
            penaltyBpsAtOpen: d[3],
            tenorSeconds:     d[4],
            startAt:          d[5],
            maturityAt:       d[6],
            status:           d[7],
            depositor:        d[8],
            originalStartAt:  originalStartAt ?? d[5],
            originalId:       originalId ?? id,
            renewCount,
          });
        } catch (e) {
          console.warn(`Skip deposit #${id}:`, e.message);
        }
      }

      active.sort((a, b) => Number(b.startAt) - Number(a.startAt));
      setDeposits(active);
    } catch (e) {
      console.error("loadDeposits error:", e);
      setDeposits([]);
    }
  }, [core, account]);

  const loadMisc = useCallback(async () => {
    if (!vault || !core) return;
    try {
      setVaultBal(await vault.vaultBalance());
      const [vp, cp] = await Promise.all([
        vault.paused().catch(() => false),
        core.paused().catch(() => false),
      ]);
      setIsPaused(vp || cp);
    } catch {}
    try {
      const gp = await core.gracePeriod();
      setGracePeriod(Number(gp));
    } catch {}
    if (usdc && account) {
      try { setBalance(await usdc.balanceOf(account)); } catch {}
    }
  }, [vault, core, usdc, account]);

  const reloadAll = useCallback(() => {
    loadPlans();
    loadDeposits();
    loadMisc();
  }, [loadPlans, loadDeposits, loadMisc]);

  useEffect(() => { if (core) reloadAll(); }, [core, account]);
  useEffect(() => {
    if (!core || !vault) return;
    const t = setInterval(() => loadMisc(), 5000);
    return () => clearInterval(t);
  }, [core, vault, loadMisc]);

  // ── Toast / withLoading ───────────────────────────────────────────────────
  const notify = (msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4500);
  };

  const withLoading = async (label, fn) => {
    setLoading(label);
    try {
      await fn();
      notify(`${label} thành công ✓`);
      reloadAll();
    } catch (e) {
      let msg = "Giao dịch thất bại";
      if (e.reason)                                              msg = e.reason;
      else if (e.message?.includes("user rejected"))             msg = "Bạn đã từ chối giao dịch";
      else if (e.message?.includes("insufficient funds"))        msg = "Không đủ ETH để trả gas";
      else if (e.message?.includes("ERC20Insufficient"))         msg = "Số dư USDC không đủ";
      else if (e.message?.includes("PlanIsDisabled"))            msg = "Plan đã bị tắt";
      else if (e.message?.includes("DepositNotMatured"))         msg = "Deposit chưa đến đáo hạn";
      else if (e.message?.includes("NotDepositor"))              msg = "Bạn không phải depositor — không thể rút tiền";
      else if (e.message?.includes("NotNftOwnerOrDepositor"))    msg = "Bạn không phải depositor hoặc NFT owner";
      else if (e.message?.includes("GracePeriodNotExpired"))     msg = "Chưa hết grace period";
      else if (e.message)                                        msg = e.message.slice(0, 120);
      notify(msg, false);
      console.error(label, e);
    } finally {
      setLoading("");
    }
  };

  const TABS = [
    { key: "plans",    img: "/saving.png",  label: "Saving Plans" },
    { key: "deposits", img: "/deposit.png", label: `Deposits (${deposits.length})` },
    ...(isAdmin ? [{ key: "admin", img: "/admin.png", label: "Admin" }] : []),
  ];

  return (
    <div style={S.page}>
      {toast && (
        <div style={{ ...S.toast, background: toast.ok ? "#16a34a" : "#dc2626" }}>{toast.msg}</div>
      )}

      <header style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/logo.png" alt="logo"
            style={{ width: 36, height: 36, objectFit: "contain", borderRadius: 8 }}
            onError={e => { e.target.style.display = "none"; }}
          />
          <span style={{ fontWeight: 800, fontSize: 20, color: "#0f172a" }}>ChainSave</span>
          {isAdmin && (
            <span style={{ background: "#e6f7f7", color: "#006c6c", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, border: "1px solid #99d4d4" }}>
              ADMIN
            </span>
          )}
          {isPaused && (
            <span style={{ background: "#fee2e2", color: "#dc2626", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, border: "1px solid #fca5a5" }}>
              ⏸ PAUSED
            </span>
          )}
        </div>
        {account ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#475569", fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}>
              <img src="/ic_usdc_coin.png" alt="USDC"
                style={{ width: 18, height: 18, objectFit: "contain" }}
                onError={e => e.target.style.display = "none"}
              />
              {fmt(balance)} USDC
            </span>
            {isAdmin && (
              <span style={{ color: "#64748b", fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}>
                <img src="/ic_vault_coin.png" alt="Vault"
                  style={{ width: 18, height: 18, objectFit: "contain" }}
                  onError={e => e.target.style.display = "none"}
                />
                Vault: {fmt(vaultBal)}
              </span>
            )}
            <span
              style={{ ...S.chip, fontFamily: "monospace", fontSize: 11, maxWidth: "none", whiteSpace: "nowrap", cursor: "pointer" }}
              onClick={() => { navigator.clipboard.writeText(account); notify("Đã copy địa chỉ ✓"); }}
              title="Click để copy"
            >
              {account}
            </span>
            <button style={{ ...S.btnS, padding: "6px 12px", fontSize: 12 }} onClick={disconnect}>
              Đăng xuất
            </button>
          </div>
        ) : (
          <button style={S.btnP} onClick={connect}>Kết nối MetaMask</button>
        )}
      </header>

      {!account ? (
        <div style={S.hero}>
          <h1 style={{ fontSize: 42, fontWeight: 800, color: "#0f172a", textAlign: "center" }}>
            Kiếm lãi on-chain.<br />
            <span style={{ color: "#006c6c" }}>Tiết kiệm phi tập trung.</span>
          </h1>
          <p style={{ color: "#64748b", maxWidth: 480, lineHeight: 1.7, textAlign: "center" }}>
            Khoá USDC theo kỳ hạn, nhận lãi suất cố định, nắm giữ chứng chỉ NFT. Không cần ngân hàng.
          </p>
          <button style={{ ...S.btnP, padding: "14px 32px", fontSize: 16 }} onClick={connect}>
            Kết nối ví để bắt đầu
          </button>
        </div>
      ) : (
        <main style={S.main}>
          <div style={{ ...S.tabs, justifyContent: "space-between", alignItems: "center", flexWrap: "nowrap" }}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {TABS.map(t => (
                <button key={t.key}
                  style={{ ...S.tab, ...(tab === t.key ? S.tabOn : {}), ...(t.key === "admin" ? S.tabAdm : {}) }}
                  onClick={() => setTab(t.key)}>
                  <img src={t.img} alt={t.label}
                    style={{ width: 18, height: 18, objectFit: "contain", filter: tab === t.key ? "brightness(10)" : "brightness(0.4)" }}
                    onError={e => e.target.style.display = "none"}
                  />
                  {t.label}
                </button>
              ))}
            </div>
            {tab === "deposits" && (
              <DepositFilter deposits={deposits} filter={depositFilter} setFilter={setDepositFilter} />
            )}
          </div>

          {tab === "plans" && (
            <>
              {openModal && (
                <OpenDepositModal
                  plan={openModal} onClose={() => setOpenModal(null)}
                  usdc={usdc} core={core} balance={balance}
                  loading={loading} withLoading={withLoading}
                />
              )}
              {/* [CHANGED] Saving Plan cards → teal dark theme */}
              <div style={S.grid}>
                {plans.length === 0 && <p style={{ color: "#64748b" }}>Không có plan nào.</p>}
                {plans.map(plan => (
                  <div key={String(plan.id)} style={{
                    background: plan.enabled
                      ? "linear-gradient(145deg, #007a7a 0%, #005252 60%, #003d3d 100%)"
                      : "linear-gradient(145deg, #5a9a9a 0%, #3a7070 60%, #2a5555 100%)",
                    borderRadius: 16,
                    padding: 24,
                    border: "1px solid #00606060",
                    boxShadow: "0 4px 20px #006c6c44",
                    opacity: plan.enabled ? 1 : 0.6,
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                  }}>
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                      <span style={{ fontWeight: 700, fontSize: 16, color: "#ffffff" }}>
                        {fmtTenor(plan.tenorSeconds)} Plan
                      </span>
                      {!plan.enabled && (
                        <span style={{ color: "#fca5a5", fontSize: 12, fontWeight: 600 }}>Disabled</span>
                      )}
                    </div>

                    {/* APR */}
                    <div style={{ fontSize: 42, fontWeight: 800, color: "#ffffff", margin: "4px 0 2px", lineHeight: 1.1 }}>
                      {fmtApr(plan.aprBps)}
                    </div>
                    <div style={{ color: "#a7d4d4", fontSize: 12, marginBottom: 16, letterSpacing: 0.3 }}>
                      APR hàng năm
                    </div>

                    {/* Info grid */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px", marginBottom: 20 }}>
                      {[
                        { label: "MIN DEPOSIT",   value: plan.minDeposit > 0n ? fmt(plan.minDeposit) + " USDC" : "Không giới hạn" },
                        { label: "MAX DEPOSIT",   value: plan.maxDeposit > 0n ? fmt(plan.maxDeposit) + " USDC" : "Không giới hạn" },
                        { label: "PHẠT RÚT SỚM",  value: fmtApr(plan.earlyWithdrawPenaltyBps) },
                        { label: "PLAN ID",        value: "#" + String(plan.id) },
                      ].map(item => (
                        <div key={item.label}>
                          <div style={{ color: "#7fbfbf", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>
                            {item.label}
                          </div>
                          <div style={{ color: "#ffffff", fontWeight: 700, fontSize: 14 }}>
                            {item.value}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Button */}
                    <button
                      style={{
                        background: "transparent",
                        color: "#ffffff",
                        border: "1.5px solid rgba(255,255,255,0.55)",
                        borderRadius: 10,
                        padding: "12px 18px",
                        fontWeight: 600,
                        fontSize: 15,
                        cursor: plan.enabled && !loading && !isPaused ? "pointer" : "not-allowed",
                        width: "100%",
                        marginTop: "auto",
                        opacity: plan.enabled && !isPaused ? 1 : 0.6,
                        transition: "opacity 0.15s, border-color 0.15s",
                      }}
                      onClick={() => {
                        if (isPaused) { notify("Hệ thống đang tạm dừng", false); return; }
                        setOpenModal(plan);
                      }}
                      disabled={!plan.enabled || !!loading || isPaused}
                    >
                      Mở Deposit
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === "deposits" && (
            <DepositsTab
              deposits={deposits} plans={plans} core={core}
              isPaused={isPaused} loading={loading} withLoading={withLoading}
              gracePeriod={gracePeriod} account={account}
              onSwitchToPlans={() => setTab("plans")}
              filter={depositFilter}
            />
          )}

          {tab === "admin" && isAdmin && (
            <AdminTab
              vault={vault} core={core} usdc={usdc} signer={signer} account={account}
              loading={loading} withLoading={withLoading}
              isPaused={isPaused} setIsPaused={setIsPaused}
              plans={plans} vaultBal={vaultBal}
            />
          )}
          {tab === "admin" && !isAdmin && (
            <div style={{ textAlign: "center", padding: 48, color: "#dc2626" }}>
              <p style={{ fontSize: 48 }}>🚫</p>
              <p>Bạn không có quyền Admin.</p>
            </div>
          )}
        </main>
      )}
    </div>
  );
}
