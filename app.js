// app.js — Jaleel Capital QARP dashboard. Renders entirely from the decrypted
// data.json payload. No external dependencies; charts are hand-rolled SVG.

"use strict";

let DATA = null;

/* ---------- formatting helpers ---------- */
const fmtUSD = (n, dp = 0) =>
  n == null ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtNum = (n, dp = 2) => (n == null ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const fmtPct = (n, dp = 1) => (n == null ? "—" : (n >= 0 ? "+" : "") + Number(n).toFixed(dp) + "%");
const signClass = (n) => (n == null ? "" : n > 0 ? "pos" : n < 0 ? "neg" : "muted");

function verdictSlug(v) {
  return "v-" + String(v).toLowerCase().replace(/[^a-z]+/g, "");
}
function verdictBadge(v) {
  return `<span class="badge ${verdictSlug(v)}">${v}</span>`;
}

const SECTOR_COLORS = [
  "#2563eb", "#0891b2", "#16a34a", "#b45309", "#7c3aed",
  "#db2777", "#0e7a4f", "#64748b", "#ca8a04", "#e11d48",
  "#0d9488", "#4f46e5",
];
const VERDICT_ORDER = ["STRONGEST", "STRONG BUY", "BUY", "HOLD-QUAL", "AVOID", "STRONG AVOID"];
const VERDICT_COLOR = {
  "STRONGEST": "#0e7a4f", "STRONG BUY": "#16a34a", "BUY": "#0891b2",
  "HOLD-QUAL": "#b45309", "AVOID": "#64748b", "STRONG AVOID": "#be123c",
};

/* ---------- SVG donut ---------- */
function donut(items, size = 132, thickness = 22) {
  const total = items.reduce((s, it) => s + it.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const segs = items.map((it, i) => {
    const frac = it.value / total;
    const len = frac * circ;
    const dash = `${len} ${circ - len}`;
    const seg = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${it.color || SECTOR_COLORS[i % SECTOR_COLORS.length]}"
      stroke-width="${thickness}" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}"
      transform="rotate(-90 ${c} ${c})" />`;
    offset += len;
    return seg;
  }).join("");
  return `<svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${segs}
    <circle cx="${c}" cy="${c}" r="${r - thickness / 2 - 1}" fill="#fff"/></svg>`;
}

function legend(items) {
  return `<div class="legend">${items.map((it, i) => `
    <div class="legend-row">
      <span class="legend-dot" style="background:${it.color || SECTOR_COLORS[i % SECTOR_COLORS.length]}"></span>
      <span class="legend-name">${it.label}</span>
      <span class="legend-val">${it.right}</span>
    </div>`).join("")}</div>`;
}

/* ---------- render: KPIs ---------- */
function renderKpis() {
  const t = DATA.meta.portfolio_totals;
  const u = DATA.universe;
  const strongBuys = u.filter((x) => x.verdict === "STRONG BUY" || x.verdict === "STRONGEST").length;
  const buys = u.filter((x) => x.verdict === "BUY").length;
  const cards = [
    { label: "Account Value", value: fmtUSD(t.account, 0), delta: `${fmtUSD(t.cash, 2)} cash`, dClass: "muted" },
    { label: "Total Gain", value: fmtUSD(t.gain, 0), delta: fmtPct(t.gain_pct), dClass: signClass(t.gain) },
    { label: "Cost Basis", value: fmtUSD(t.cost, 0), delta: `${DATA.portfolio.length} holdings`, dClass: "muted" },
    { label: "Halal Universe", value: String(DATA.meta.universe_count), delta: "scored names", dClass: "muted" },
    { label: "Strong Buy +", value: String(strongBuys), delta: `${buys} more BUY`, dClass: "muted" },
  ];
  document.getElementById("kpis").innerHTML = cards.map((c) => `
    <div class="kpi">
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
      <div class="delta ${c.dClass}">${c.delta}</div>
    </div>`).join("");
}

/* ---------- render: Overview ---------- */
function renderOverview() {
  // sector donut
  const secs = DATA.sectors.map((s, i) => ({ ...s, color: SECTOR_COLORS[i % SECTOR_COLORS.length] }));
  const secItems = secs.map((s) => ({ value: s.value, color: s.color }));
  const secLegend = secs.map((s) => ({ label: s.sector, right: s.weight_pct + "%", color: s.color }));
  document.getElementById("sector-chart").innerHTML = donut(secItems) + legend(secLegend);

  // verdict distribution bars
  const counts = {};
  DATA.universe.forEach((x) => (counts[x.verdict] = (counts[x.verdict] || 0) + 1));
  const max = Math.max(...Object.values(counts));
  document.getElementById("verdict-chart").innerHTML = `<div class="vbar">${VERDICT_ORDER
    .filter((v) => counts[v])
    .map((v) => `
      <div class="vbar-row">
        <span>${verdictBadge(v)}</span>
        <span class="vbar-track"><span class="vbar-fill" style="width:${(counts[v] / max * 100).toFixed(0)}%;background:${VERDICT_COLOR[v]}"></span></span>
        <span class="vbar-n">${counts[v]}</span>
      </div>`).join("")}</div>`;

  // top names mini table
  const top = DATA.universe.slice(0, 10);
  document.getElementById("top-names").innerHTML = `
    <div class="table-wrap" style="border:0;box-shadow:none">
    <table><thead><tr>
      <th class="left">#</th><th class="left">Name</th><th>QARP</th><th>DCF</th><th>Price</th><th class="left">Verdict</th>
    </tr></thead><tbody>
      ${top.map((x) => `<tr data-ticker="${x.ticker}">
        <td class="left muted">${x.rank}</td>
        <td class="left tick">${x.ticker}<span class="name">${x.name}</span></td>
        <td class="qarp-cell">${fmtNum(x.qarp, 1)}</td>
        <td>${fmtNum(x.dcf, 1)}</td>
        <td>${fmtUSD(x.price, 2)}</td>
        <td class="left">${verdictBadge(x.verdict)}</td>
      </tr>`).join("")}
    </tbody></table></div>`;
  document.querySelectorAll("#top-names tr[data-ticker]").forEach((tr) =>
    tr.addEventListener("click", () => openDrawer(tr.dataset.ticker)));
}

/* ---------- render: Universe table ---------- */
const U_COLS = [
  { key: "rank", label: "#", align: "left", fmt: (x) => `<span class="muted">${x.rank}</span>` },
  { key: "ticker", label: "Name", align: "left", fmt: (x) => `<span class="tick">${x.ticker}<span class="name">${x.name}</span></span>` },
  { key: "sector", label: "Sector", align: "left", fmt: (x) => `<span class="muted">${x.sector}</span>` },
  { key: "price", label: "Price", fmt: (x) => fmtUSD(x.price, 2) },
  { key: "day_pct", label: "Day", fmt: (x) => `<span class="${signClass(x.day_pct)}">${fmtPct(x.day_pct)}</span>` },
  { key: "qarp", label: "QARP", fmt: (x) => `<span class="qarp-cell">${fmtNum(x.qarp, 1)}</span>` },
  { key: "dcf", label: "DCF", fmt: (x) => fmtNum(x.dcf, 1) },
  { key: "mech", label: "Q /105", fmt: (x) => x.mech },
  { key: "verdict", label: "Verdict", align: "left", fmt: (x) => verdictBadge(x.verdict), sortVal: (x) => VERDICT_ORDER.indexOf(x.verdict) },
];
let uSort = { key: "rank", dir: 1 };

function renderUniverseControls() {
  const verdSel = document.getElementById("u-verdict");
  VERDICT_ORDER.filter((v) => DATA.universe.some((x) => x.verdict === v))
    .forEach((v) => verdSel.add(new Option(v, v)));
  const secSel = document.getElementById("u-sector");
  [...new Set(DATA.universe.map((x) => x.sector))].sort()
    .forEach((s) => secSel.add(new Option(s, s)));
  ["u-search", "u-verdict", "u-sector"].forEach((id) =>
    document.getElementById(id).addEventListener("input", renderUniverseTable));
}

function renderUniverseTable() {
  const q = document.getElementById("u-search").value.trim().toLowerCase();
  const fv = document.getElementById("u-verdict").value;
  const fs = document.getElementById("u-sector").value;
  let rows = DATA.universe.filter((x) =>
    (!q || x.ticker.toLowerCase().includes(q) || x.name.toLowerCase().includes(q)) &&
    (!fv || x.verdict === fv) && (!fs || x.sector === fs));

  const col = U_COLS.find((c) => c.key === uSort.key);
  const val = col.sortVal || ((x) => x[uSort.key]);
  rows.sort((a, b) => {
    const va = val(a), vb = val(b);
    if (typeof va === "string") return uSort.dir * va.localeCompare(vb);
    return uSort.dir * (va - vb);
  });

  document.querySelector("#u-table thead").innerHTML = `<tr>${U_COLS.map((c) => {
    const arrow = uSort.key === c.key ? `<span class="arrow">${uSort.dir > 0 ? "▲" : "▼"}</span>` : "";
    return `<th class="${c.align === "left" ? "left" : ""}" data-key="${c.key}">${c.label}${arrow}</th>`;
  }).join("")}</tr>`;
  document.querySelector("#u-table tbody").innerHTML = rows.map((x) => `
    <tr data-ticker="${x.ticker}">${U_COLS.map((c) =>
      `<td class="${c.align === "left" ? "left" : ""}">${c.fmt(x)}</td>`).join("")}</tr>`).join("");

  document.getElementById("u-count").textContent = `${rows.length} of ${DATA.universe.length}`;
  document.querySelectorAll("#u-table thead th").forEach((th) =>
    th.addEventListener("click", () => {
      const k = th.dataset.key;
      // numeric columns default to descending on first click; rank/text ascending
      if (uSort.key === k) uSort.dir *= -1;
      else uSort = { key: k, dir: ["rank", "ticker", "sector"].includes(k) ? 1 : -1 };
      renderUniverseTable();
    }));
  document.querySelectorAll("#u-table tbody tr").forEach((tr) =>
    tr.addEventListener("click", () => openDrawer(tr.dataset.ticker)));
}

/* ---------- render: Portfolio ---------- */
const P_COLS = [
  { key: "ticker", label: "Name", align: "left", fmt: (x) => `<span class="tick">${x.ticker}<span class="name">${x.name}</span></span>` },
  { key: "price", label: "Price", fmt: (x) => fmtUSD(x.price, 2) },
  { key: "day_pct", label: "Day", fmt: (x) => `<span class="${signClass(x.day_pct)}">${fmtPct(x.day_pct)}</span>` },
  { key: "shares", label: "Shares", fmt: (x) => fmtNum(x.shares, 2) },
  { key: "value", label: "Value", fmt: (x) => fmtUSD(x.value, 0) },
  { key: "gain", label: "Gain $", fmt: (x) => `<span class="${signClass(x.gain)}">${fmtUSD(x.gain, 0)}</span>` },
  { key: "gain_pct", label: "Gain %", fmt: (x) => `<span class="${signClass(x.gain_pct)}">${fmtPct(x.gain_pct)}</span>` },
  { key: "weight_pct", label: "Weight", fmt: (x) => fmtNum(x.weight_pct, 1) + "%" },
  { key: "qarp", label: "QARP", fmt: (x) => `<span class="qarp-cell">${fmtNum(x.qarp, 1)}</span>` },
  { key: "verdict", label: "Verdict", align: "left", fmt: (x) => verdictBadge(x.verdict), sortVal: (x) => VERDICT_ORDER.indexOf(x.verdict) },
];
let pSort = { key: "value", dir: -1 };

function renderPortfolio() {
  const t = DATA.meta.portfolio_totals;
  document.getElementById("p-totals").innerHTML = [
    ["Account", fmtUSD(t.account, 0)],
    ["Positions", fmtUSD(t.positions, 0)],
    ["Total Gain", `<span class="${signClass(t.gain)}">${fmtUSD(t.gain, 0)} (${fmtPct(t.gain_pct)})</span>`],
    ["Cash", fmtUSD(t.cash, 2)],
  ].map(([l, v]) => `<div class="pt"><div class="l">${l}</div><div class="v">${v}</div></div>`).join("");

  // allocation donut by holding weight
  const holds = [...DATA.portfolio].sort((a, b) => b.value - a.value)
    .map((h, i) => ({ ...h, color: SECTOR_COLORS[i % SECTOR_COLORS.length] }));
  document.getElementById("p-sector-chart").innerHTML =
    donut(holds.map((h) => ({ value: h.value, color: h.color }))) +
    legend(holds.slice(0, 8).map((h) => ({ label: h.ticker, right: h.weight_pct + "%", color: h.color })));

  renderPortfolioTable();
}

function renderPortfolioTable() {
  const col = P_COLS.find((c) => c.key === pSort.key);
  const val = col.sortVal || ((x) => x[pSort.key]);
  const rows = [...DATA.portfolio].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (typeof va === "string") return pSort.dir * va.localeCompare(vb);
    return pSort.dir * (va - vb);
  });
  document.querySelector("#p-table thead").innerHTML = `<tr>${P_COLS.map((c) => {
    const arrow = pSort.key === c.key ? `<span class="arrow">${pSort.dir > 0 ? "▲" : "▼"}</span>` : "";
    return `<th class="${c.align === "left" ? "left" : ""}" data-key="${c.key}">${c.label}${arrow}</th>`;
  }).join("")}</tr>`;
  document.querySelector("#p-table tbody").innerHTML = rows.map((x) => `
    <tr data-ticker="${x.ticker}">${P_COLS.map((c) =>
      `<td class="${c.align === "left" ? "left" : ""}">${c.fmt(x)}</td>`).join("")}</tr>`).join("");
  document.querySelectorAll("#p-table thead th").forEach((th) =>
    th.addEventListener("click", () => {
      const k = th.dataset.key;
      if (pSort.key === k) pSort.dir *= -1;
      else pSort = { key: k, dir: k === "ticker" ? 1 : -1 };
      renderPortfolioTable();
    }));
  document.querySelectorAll("#p-table tbody tr").forEach((tr) =>
    tr.addEventListener("click", () => openDrawer(tr.dataset.ticker)));
}

/* ---------- drawer (detail) ---------- */
function openDrawer(ticker) {
  const x = DATA.universe.find((u) => u.ticker === ticker);
  const p = DATA.portfolio.find((h) => h.ticker === ticker);
  if (!x && !p) return;
  const d = x || {};
  const dims = [
    ["Valuation", d.val, 25], ["Growth", d.grw, 20], ["Quality", d.qual, 20],
    ["Balance Sheet", d.bs, 20], ["Capital Alloc", d.cap, 20],
  ];
  const has = (v) => v != null && v !== "";
  const kv = [];
  if (has(d.gf_value)) kv.push(["GF Value", fmtUSD(d.gf_value, 2)]);
  if (has(d.mktcap_b)) kv.push(["Market cap", "$" + fmtNum(d.mktcap_b, 1) + "B"]);
  if (has(d.shariah_grade)) kv.push(["Shariah (Musaffa)", d.shariah_grade]);
  if (has(d.confidence)) kv.push(["Confidence", d.confidence]);
  if (has(d.insider)) kv.push(["Insider", d.insider]);
  if (has(d.buzz)) kv.push(["Buzz", `${d.buzz} — ${d.buzz_signal || ""}`]);
  if (p) {
    kv.push(["Your position", `${fmtNum(p.shares, 2)} sh · ${fmtUSD(p.value, 0)}`]);
    kv.push(["Your gain", `${fmtUSD(p.gain, 0)} (${fmtPct(p.gain_pct)})`]);
    kv.push(["Weight", fmtNum(p.weight_pct, 1) + "%"]);
  }

  const verdict = d.verdict || (p && p.verdict);
  document.getElementById("drawer-panel").innerHTML = `
    <div class="drawer-head">
      <div>
        <h2>${ticker}</h2>
        <div class="name">${d.name || (p && p.name) || ""}</div>
      </div>
      <button class="drawer-close" aria-label="Close">×</button>
    </div>
    <div class="drawer-tags">
      ${verdict ? verdictBadge(verdict) : ""}
      ${has(d.qarp) ? `<span class="chip">QARP ${fmtNum(d.qarp, 1)}</span>` : ""}
      ${has(d.dcf) ? `<span class="chip">DCF ${fmtNum(d.dcf, 1)}/5</span>` : ""}
      ${has(d.mech) ? `<span class="chip">Quality ${d.mech}/105</span>` : ""}
      ${has(d.sector) ? `<span class="chip">${d.sector}</span>` : ""}
      ${has(d.price) ? `<span class="chip">${fmtUSD(d.price, 2)}${has(d.day_pct) ? ` · <span class="${signClass(d.day_pct)}">${fmtPct(d.day_pct)}</span>` : ""}</span>` : ""}
    </div>
    ${x ? `<h4>Quality dimensions</h4><div class="dims">${dims.map(([l, v, m]) => `
      <div class="dim"><div class="dl">${l}</div><div class="dv">${has(v) ? v : "—"}<span class="muted" style="font-size:12px;font-weight:500"> /${m}</span></div>
      <div class="dbar"><div class="dfill" style="width:${has(v) ? (v / m * 100).toFixed(0) : 0}%"></div></div></div>`).join("")}</div>` : ""}
    ${kv.length ? `<div class="kv">${kv.map(([k, v]) => `<span class="k">${k}</span><span class="vv">${v}</span>`).join("")}</div>` : ""}
    ${has(d.dcf_note) ? `<h4>DCF / thesis note</h4><div class="dcf-note">${d.dcf_note}</div>` : ""}`;

  const drawer = document.getElementById("drawer");
  drawer.hidden = false;
  document.querySelector(".drawer-close").addEventListener("click", closeDrawer);
  document.querySelector(".drawer-bg").addEventListener("click", closeDrawer);
}
function closeDrawer() { document.getElementById("drawer").hidden = true; }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

/* ---------- tabs ---------- */
function initTabs() {
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".tabpanel").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      document.getElementById("tab-" + t.dataset.tab).classList.add("active");
    }));
}

/* ---------- boot ---------- */
function renderAll() {
  document.getElementById("asof-date").textContent = DATA.meta.date;
  renderKpis();
  renderOverview();
  renderUniverseControls();
  renderUniverseTable();
  renderPortfolio();
  initTabs();
}

async function boot() {
  let payload;
  try {
    const res = await fetch("payload.enc", { cache: "no-store" });
    payload = await res.json();
    if (payload.date) document.getElementById("gate-date").textContent = payload.date;
  } catch (e) {
    showErr("Could not load encrypted data. Is payload.enc present?");
    return;
  }

  const form = document.getElementById("gate-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("gate-btn");
    const pw = document.getElementById("gate-pw").value;
    if (!pw) return;
    btn.disabled = true; btn.textContent = "Unlocking…";
    hideErr();
    try {
      DATA = await decryptPayload(payload, pw);
      document.getElementById("gate").hidden = true;
      document.getElementById("app").hidden = false;
      sessionStorage.setItem("jc_pw", pw); // remember within this tab session only
      renderAll();
    } catch (err) {
      showErr("Wrong password.");
      btn.disabled = false; btn.textContent = "Unlock";
      document.getElementById("gate-pw").select();
    }
  });

  // auto-unlock within the same browser tab session
  const saved = sessionStorage.getItem("jc_pw");
  if (saved) {
    try {
      DATA = await decryptPayload(payload, saved);
      document.getElementById("gate").hidden = true;
      document.getElementById("app").hidden = false;
      renderAll();
    } catch (e) { sessionStorage.removeItem("jc_pw"); }
  }

  document.getElementById("lock-btn").addEventListener("click", () => {
    sessionStorage.removeItem("jc_pw");
    location.reload();
  });
}

function showErr(msg) { const e = document.getElementById("gate-err"); e.textContent = msg; e.hidden = false; }
function hideErr() { document.getElementById("gate-err").hidden = true; }

boot();
