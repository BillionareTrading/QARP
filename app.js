// app.js — Jaleel Capital QARP dashboard. Renders entirely from the decrypted
// data.json payload. No external dependencies; charts are hand-rolled SVG.

"use strict";

let DATA = null;

/* ---------- formatting helpers ---------- */
const fmtUSD = (n, dp = 0) =>
  n == null ? "—" : (n < 0 ? "-" : "") + "$" + Math.abs(Number(n)).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtNum = (n, dp = 2) => (n == null ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }));
const fmtPct = (n, dp = 1) => (n == null ? "—" : (n >= 0 ? "+" : "") + Number(n).toFixed(dp) + "%");
const signClass = (n) => (n == null ? "" : n > 0 ? "pos" : n < 0 ? "neg" : "muted");

function verdictSlug(v) {
  return "v-" + String(v).toLowerCase().replace(/[^a-z]+/g, "");
}
function verdictBadge(v) {
  // Non-compliant / unscored holdings (e.g. V, RKLB) get a neutral outlined badge
  // instead of an empty cell — they're excluded from QARP on Shariah grounds.
  if (!v || v === "NOT SCORED") return `<span class="badge v-noncompliant">NON-COMPLIANT</span>`;
  return `<span class="badge ${verdictSlug(v)}">${v}</span>`;
}

/* ---------- header tooltips (tap the ⓘ) ---------- */
const TIPS = {
  qarp: { t: "QARP", d: "Quality At a Reasonable Price — a 0–100 score blending business quality (60%) with value/DCF (40%). Higher is better; 72+ is a Strong Buy. See the Framework tab for the full method." },
  dcf: { t: "DCF score (1–5)", d: "How cheap the stock is vs. an estimate of its fair value. 5 = deep value (>30% upside), 3 = fairly priced, 1 = expensive." },
  mech: { t: "Quality (out of 105)", d: "The quality half of QARP — the sum of five dimensions: Valuation, Growth, Quality, Balance Sheet, and Capital Allocation." },
  verdict: { t: "Verdict", d: "The QARP score turned into a call: ≥85 Strongest, ≥72 Strong Buy, ≥66 Buy, ≥60 Hold-Qual, 35–59 Avoid, <35 Strong Avoid." },
};
function infoBtn(key) {
  return TIPS[key] ? `<button class="info-btn" type="button" data-tip="${key}" aria-label="What is ${TIPS[key].t}?">i</button>` : "";
}
function initTips() {
  let tip = document.getElementById("tip");
  if (!tip) { tip = document.createElement("div"); tip.id = "tip"; tip.hidden = true; document.body.appendChild(tip); }
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".info-btn");
    if (btn) {
      e.preventDefault(); e.stopPropagation();
      const info = TIPS[btn.dataset.tip];
      if (!info) return;
      tip.innerHTML = `<span class="tip-title">${info.t}</span>${info.d}`;
      const tw = Math.min(250, window.innerWidth - 20);
      tip.style.width = tw + "px";
      tip.hidden = false;
      const r = btn.getBoundingClientRect();
      let left = Math.max(10, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 10));
      tip.style.left = left + "px";
      tip.style.top = (r.bottom + 8) + "px";
      const th = tip.getBoundingClientRect().height;
      if (r.bottom + 8 + th > window.innerHeight - 8) tip.style.top = Math.max(8, r.top - th - 8) + "px";
      return;
    }
    if (!tip.hidden && !e.target.closest("#tip")) tip.hidden = true;
  });
  window.addEventListener("scroll", () => { tip.hidden = true; }, true);
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
  // portfolio day change, derived from each holding's day_pct
  let dayPrev = 0, dayNow = 0;
  DATA.portfolio.forEach((h) => {
    const dp = typeof h.day_pct === "number" ? h.day_pct : 0;
    dayPrev += h.value / (1 + dp / 100);
    dayNow += h.value;
  });
  const dayChg = dayNow - dayPrev;
  const dayPct = dayPrev ? (dayChg / dayPrev) * 100 : 0;
  // clarify "Today": it's live during market hours, otherwise it's the last close
  const todayNote = marketOpenNow() ? "live" : `at ${dayName(DATA.meta.date)} close`;
  const cards = [
    { label: "Account Value", value: fmtUSD(t.account, 0), delta: `${fmtUSD(t.cash, 2)} cash`, dClass: "muted" },
    { label: "Today", note: todayNote, value: fmtUSD(dayChg, 0), delta: fmtPct(dayPct), dClass: signClass(dayChg) },
    { label: "Total Gain", value: fmtUSD(t.gain, 0), delta: fmtPct(t.gain_pct), dClass: signClass(t.gain) },
    { label: "Cost Basis", value: fmtUSD(t.cost, 0), delta: `${DATA.portfolio.length} holdings`, dClass: "muted" },
  ];
  document.getElementById("kpis").innerHTML = cards.map((c) => `
    <div class="kpi">
      <div class="label">${c.label}${c.note ? ` <span class="kpi-note">· ${c.note}</span>` : ""}</div>
      <div class="value">${c.value}</div>
      <div class="delta ${c.dClass}">${c.delta}</div>
    </div>`).join("");
}

function dayName(iso) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(iso + "T12:00:00").getDay()];
}

/* ---------- render: Overview ---------- */
function renderVerdictSummary() {
  // verdict distribution — stacked proportion bar + count tiles (top of Shariah-Compliant tab)
  const counts = {};
  DATA.universe.forEach((x) => (counts[x.verdict] = (counts[x.verdict] || 0) + 1));
  const total = DATA.universe.length || 1;
  const order = VERDICT_ORDER.filter((v) => counts[v]);
  const bar = order.map((v) =>
    `<span style="width:${(counts[v] / total * 100).toFixed(2)}%;background:${VERDICT_COLOR[v]}" title="${v}: ${counts[v]}"></span>`).join("");
  const tiles = order.map((v) => `
    <div class="vstat">
      <div class="vstat-num" style="color:${VERDICT_COLOR[v]}">${counts[v]}</div>
      ${verdictBadge(v)}
    </div>`).join("");
  document.getElementById("verdict-chart").innerHTML =
    `<p class="card-note" style="margin:-6px 0 14px">${DATA.universe.length} Shariah-compliant names scored</p>
     <div class="vbar-stack">${bar}</div>
     <div class="vstats">${tiles}</div>`;
}

/* ---------- render: Universe table ---------- */
const U_COLS = [
  { key: "rank", label: "#", align: "left", fmt: (x) => `<span class="muted">${x.rank}</span>` },
  { key: "ticker", label: "Name", align: "left", fmt: (x) => `<span class="tick">${x.ticker}<span class="name">${x.name}</span></span>` },
  { key: "sector", label: "Sector", align: "left", fmt: (x) => `<span class="muted">${x.sector}</span>` },
  { key: "price", label: "Price", fmt: (x) => `<span class="cell-px">${fmtUSD(x.price, 2)}</span>` },
  { key: "day_pct", label: "Day", fmt: (x) => `<span class="cell-day ${signClass(x.day_pct)}">${fmtPct(x.day_pct)}</span>` },
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
    return `<th class="${c.align === "left" ? "left" : ""}" data-key="${c.key}">${c.label}${arrow}${infoBtn(c.key)}</th>`;
  }).join("")}</tr>`;
  document.querySelector("#u-table tbody").innerHTML = rows.map((x) => `
    <tr data-ticker="${x.ticker}">${U_COLS.map((c) =>
      `<td class="${c.align === "left" ? "left" : ""}">${c.fmt(x)}</td>`).join("")}</tr>`).join("");

  document.getElementById("u-count").textContent = `${rows.length} of ${DATA.universe.length}`;
  document.querySelectorAll("#u-table thead th").forEach((th) =>
    th.addEventListener("click", (e) => {
      if (e.target.closest(".info-btn")) return; // tapping the ⓘ shouldn't sort
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
  { key: "price", label: "Price", fmt: (x) => `<span class="cell-px">${fmtUSD(x.price, 2)}</span>` },
  { key: "avgcost", label: "Avg Cost", fmt: (x) => `<span class="muted">${fmtUSD(x.shares ? x.cost / x.shares : 0, 2)}</span>`, sortVal: (x) => (x.shares ? x.cost / x.shares : 0) },
  { key: "day_pct", label: "Day", fmt: (x) => `<span class="cell-day ${signClass(x.day_pct)}">${fmtPct(x.day_pct)}</span>` },
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
  renderKpis(); // KPI strip lives inside this panel now

  // allocation donut by individual holding
  const holds = [...DATA.portfolio].sort((a, b) => b.value - a.value)
    .map((h, i) => ({ ...h, color: SECTOR_COLORS[i % SECTOR_COLORS.length] }));
  document.getElementById("p-sector-chart").innerHTML =
    donut(holds.map((h) => ({ value: h.value, color: h.color }))) +
    legend(holds.slice(0, 8).map((h) => ({ label: h.ticker, right: h.weight_pct + "%", color: h.color })));

  // allocation donut by broad sector (from the daily snapshot)
  const secs = DATA.sectors.map((s, i) => ({ ...s, color: SECTOR_COLORS[i % SECTOR_COLORS.length] }));
  document.getElementById("sector-chart").innerHTML =
    donut(secs.map((s) => ({ value: s.value, color: s.color }))) +
    legend(secs.map((s) => ({ label: s.sector, right: s.weight_pct + "%", color: s.color })));

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
    return `<th class="${c.align === "left" ? "left" : ""}" data-key="${c.key}">${c.label}${arrow}${infoBtn(c.key)}</th>`;
  }).join("")}</tr>`;
  document.querySelector("#p-table tbody").innerHTML = rows.map((x) => `
    <tr data-ticker="${x.ticker}">${P_COLS.map((c) =>
      `<td class="${c.align === "left" ? "left" : ""}">${c.fmt(x)}</td>`).join("")}</tr>`).join("");
  document.querySelectorAll("#p-table thead th").forEach((th) =>
    th.addEventListener("click", (e) => {
      if (e.target.closest(".info-btn")) return; // tapping the ⓘ shouldn't sort
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

/* ---------- live prices (Finnhub, browser-side) ---------- */
const LIVE_INTERVAL_MS = 60000;  // holdings refresh ~every 60s (≈17 calls/min)
const UNIVERSE_PUMP_MS = 2000;   // 1 universe name per 2s (≈30/min); full pass of ~190 names ≈ 6 min
const FINNHUB_URL = "https://finnhub.io/api/v1/quote";
// Combined budget ≈ 17 + 30 = 47 calls/min — safely under Finnhub's free 60/min cap.
let liveTimer = null;
let uniTimer = null;
let uniQueue = [];
let uniIdx = 0;
let lastAccount = null;
let lastGoodTs = 0;
let lastGoodClock = "";

function nyParts() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date()).reduce((o, p) => ((o[p.type] = p.value), o), {});
}
function marketOpenNow() {
  const p = nyParts();
  if (p.weekday === "Sat" || p.weekday === "Sun") return false;
  let h = parseInt(p.hour, 10); if (h === 24) h = 0;
  const mins = h * 60 + parseInt(p.minute, 10);
  return mins >= 570 && mins < 960; // 9:30 .. 16:00 ET
}
function nyClock() {
  const p = nyParts(); let h = parseInt(p.hour, 10); if (h === 24) h = 0;
  const ap = h >= 12 ? "PM" : "AM"; const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${p.minute}:${p.second} ${ap} ET`;
}
function setLivePill(state, text) {
  const pill = document.getElementById("live-pill");
  if (!pill) return;
  pill.hidden = false;
  pill.classList.remove("closed", "stale");
  if (state === "closed") pill.classList.add("closed");
  if (state === "stale") pill.classList.add("stale");
  document.getElementById("live-text").textContent = text;
}
async function fetchQuote(ticker, key) {
  const res = await fetch(`${FINNHUB_URL}?symbol=${encodeURIComponent(ticker)}&token=${key}`, { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json(); // { c, d, dp, h, l, o, pc, t }
}
async function liveTick() {
  const key = DATA.meta && DATA.meta.finnhub_key;
  if (!key) return;
  if (!marketOpenNow()) { setLivePill("closed", "Market closed"); return; }

  let ok = 0, fail = 0;
  await Promise.all(DATA.portfolio.map(async (h) => {
    try {
      const q = await fetchQuote(h.ticker, key);
      if (q && typeof q.c === "number" && q.c > 0) {
        h.price = q.c;
        if (typeof q.dp === "number") h.day_pct = +q.dp.toFixed(2);
        h.value = +(h.shares * q.c).toFixed(2);
        h.gain = +(h.value - h.cost).toFixed(2);
        h.gain_pct = +((h.gain / h.cost) * 100).toFixed(2);
        const u = DATA.universe.find((x) => x.ticker === h.ticker); // keep universe consistent (silent)
        if (u) { u.price = q.c; if (typeof q.dp === "number") u.day_pct = +q.dp.toFixed(2); }
        ok++;
      } else fail++;
    } catch (e) { fail++; }
  }));

  if (ok > 0) {
    const positions = DATA.portfolio.reduce((s, h) => s + h.value, 0);
    DATA.portfolio.forEach((h) => (h.weight_pct = +(h.value / positions * 100).toFixed(1)));
    const t = DATA.meta.portfolio_totals;
    t.positions = +positions.toFixed(2);
    t.account = +(positions + t.cash).toFixed(2);
    t.gain = +(positions - t.cost).toFixed(2);
    t.gain_pct = +((t.gain / t.cost) * 100).toFixed(2);
    renderPortfolio();      // re-renders the KPI strip (inside this panel) + donut + table
    patchLivePrices();      // reflect holdings' live price/day in the Universe + Overview tabs
    flashAccount(t.account);
    lastGoodTs = Date.now();
    lastGoodClock = nyClock();
    setLivePill("live", `LIVE · ${lastGoodClock}`);
  } else if (lastGoodTs && Date.now() - lastGoodTs < 90000) {
    setLivePill("live", `LIVE · ${lastGoodClock}`); // brief miss (e.g. rate-limit blip) — stay calm
  } else {
    setLivePill("stale", "Reconnecting…");
  }
}
function patchTickerCells(ticker, price, dp) {
  // Update a single ticker's price/day cells in the Universe table + Overview list,
  // in place (no re-render → sort/scroll/filter preserved).
  document.querySelectorAll(
    `#u-table tr[data-ticker="${ticker}"] .cell-px, #top-names tr[data-ticker="${ticker}"] .cell-px`
  ).forEach((el) => { el.textContent = fmtUSD(price, 2); });
  if (typeof dp === "number") {
    document.querySelectorAll(`#u-table tr[data-ticker="${ticker}"] .cell-day`).forEach((el) => {
      el.textContent = fmtPct(dp);
      el.className = "cell-day " + signClass(dp);
    });
  }
}
function patchLivePrices() {
  // reflect each holding's live price/day in the Universe + Overview tabs
  DATA.portfolio.forEach((h) => patchTickerCells(h.ticker, h.price, h.day_pct));
}
function universeTick() {
  // Throttled cycler: quote ONE non-held universe name per pump, patch its cells.
  if (!(DATA.meta && DATA.meta.finnhub_key) || !uniQueue.length) return;
  if (!marketOpenNow()) return; // pill state is owned by the holdings tick
  const ticker = uniQueue[uniIdx % uniQueue.length];
  uniIdx++;
  fetchQuote(ticker, DATA.meta.finnhub_key).then((q) => {
    if (q && typeof q.c === "number" && q.c > 0) {
      const u = DATA.universe.find((x) => x.ticker === ticker);
      if (u) { u.price = q.c; if (typeof q.dp === "number") u.day_pct = +q.dp.toFixed(2); }
      patchTickerCells(ticker, q.c, q.dp);
      lastGoodTs = Date.now();
    }
  }).catch(() => {});
}

function flashAccount(account) {
  if (lastAccount != null && account !== lastAccount) {
    const el = document.querySelector("#kpis .kpi .value");
    if (el) { el.classList.remove("flash-up", "flash-down"); void el.offsetWidth;
      el.classList.add(account > lastAccount ? "flash-up" : "flash-down"); }
  }
  lastAccount = account;
}
function startLive() {
  if (liveTimer) clearInterval(liveTimer);
  if (uniTimer) clearInterval(uniTimer);
  if (!(DATA.meta && DATA.meta.finnhub_key)) return; // no key -> stay on daily snapshot
  lastAccount = DATA.meta.portfolio_totals.account;
  // universe cycler quotes every NON-held universe name (held names refresh via the holdings tick)
  const held = new Set(DATA.portfolio.map((h) => h.ticker));
  uniQueue = DATA.universe.map((x) => x.ticker).filter((t) => !held.has(t));
  uniIdx = 0;
  liveTick();
  liveTimer = setInterval(liveTick, LIVE_INTERVAL_MS);     // holdings every 60s
  uniTimer = setInterval(universeTick, UNIVERSE_PUMP_MS);  // 1 universe name every 2s
}

/* ---------- boot ---------- */
function renderAll() {
  document.getElementById("asof-date").textContent = DATA.meta.date;
  renderVerdictSummary();
  renderUniverseControls();
  renderUniverseTable();
  renderPortfolio();
  initTabs();
  startLive();
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

/* ---------- Framework: interactive QARP calculator ---------- */
function verdictForScore(q) {
  return q >= 85 ? "STRONGEST" : q >= 72 ? "STRONG BUY" : q >= 66 ? "BUY"
    : q >= 60 ? "HOLD-QUAL" : q >= 35 ? "AVOID" : "STRONG AVOID";
}
function initFrameworkCalc() {
  const q = document.getElementById("calc-quality");
  const d = document.getElementById("calc-dcf");
  if (!q || !d) return;
  const update = () => {
    const quality = +q.value, dcf = +d.value;
    document.getElementById("calc-qval").textContent = quality;
    document.getElementById("calc-dval").textContent = dcf.toFixed(1);
    const qarp = 0.6 * (quality / 105 * 100) + 0.4 * (dcf / 5 * 100);
    document.getElementById("calc-qarp").textContent = qarp.toFixed(1);
    const v = verdictForScore(qarp);
    const vb = document.getElementById("calc-verdict");
    vb.textContent = v;
    vb.className = "badge " + verdictSlug(v);
  };
  q.addEventListener("input", update);
  d.addEventListener("input", update);
  update();
}

initTips();
initFrameworkCalc();
boot();
