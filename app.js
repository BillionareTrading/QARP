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
  since: { t: "Since ranked", d: "Price change since this stock was first ranked (the genesis date shown beneath the %). Green = up, red = down — the actual outcome of the call so far." },
  vtrend: { t: "Verdict trend", d: "How the verdict has moved from first ranking to now. 'held' = unchanged; otherwise e.g. 'S.BUY → BUY'. Colour shows direction (upgrade/downgrade) — note a downgrade can still be a winning call if the price rose. Hover/tap for the full dated path." },
  scorecard: { t: "Track record", d: "Each name is grouped by the verdict it FIRST received, then we measure its price change since that date. If the framework works, returns should step down from Strong Buy to Avoid. Alpha = that return minus the S&P over the same window, isolating skill from market drift." },
  ic: { t: "Information Coefficient", d: "Spearman rank correlation between each name's first verdict and its return since. Method: rank all names by verdict, rank them again by return, then correlate the two rank-lists — ρ = cov(rank_verdict, rank_return) / (σ_v · σ_r). With no ties this equals 1 − 6·Σd² / [n(n²−1)], where d is each name's rank difference. Scale −1…+1: +1 = perfect ordering, 0 = no signal, negative = backwards. Real factor ICs are small (+0.05–0.10 is good) — read the trend over many days, not one." },
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
  "#db2777", "#ea580c", "#64748b", "#ca8a04", "#e11d48",
  "#0d9488", "#4f46e5",
];
const VERDICT_ORDER = ["STRONGEST", "STRONG BUY", "BUY", "HOLD-QUAL", "AVOID", "STRONG AVOID"];
const VERDICT_COLOR = {
  "STRONGEST": "#0e7a4f", "STRONG BUY": "#16a34a", "BUY": "#0891b2",
  "HOLD-QUAL": "#b45309", "AVOID": "#64748b", "STRONG AVOID": "#be123c",
};
const VERDICT_ABBR = {
  "STRONGEST": "BEST", "STRONG BUY": "S.BUY", "BUY": "BUY",
  "HOLD-QUAL": "HOLD", "AVOID": "AVOID", "STRONG AVOID": "S.AVOID",
};
const vAbbr = (v) => VERDICT_ABBR[v] || v || "?";
// Verdict-trend cell: "held", or "S.BUY → BUY" colored by DIRECTION (upgrade green /
// downgrade amber) with the full dated path on hover. Direction is informational, not
// a value judgment — a downgrade can be a winning call (the Since % column shows outcome).
// Trend = the sequence of DELIBERATE call verdicts (changes only on a re-score, never on
// the daily price re-rank). "held" = one call, never re-scored.
function verdictTrend(x) {
  const path = x.verdict_path || [];
  if (!path.length) return `<span class="muted">—</span>`;
  if (!x.verdict_changed)
    return `<span class="vt-held" title="Called ${x.first_date}: ${path[0]} — not re-scored">held</span>`;
  const a = path[0], b = path[path.length - 1];
  const dir = VERDICT_ORDER.indexOf(b) < VERDICT_ORDER.indexOf(a) ? "up" : "down";
  return `<span class="vt-${dir}" title="Called ${x.first_date}: ${path.join(" → ")}">${vAbbr(a)} → ${vAbbr(b)}</span>`;
}
function verdictTrendSort(x) {   // + = upgraded, - = downgraded, 0 = held/none
  const path = x.verdict_path || [];
  if (!x.verdict_changed || path.length < 2) return 0;
  return VERDICT_ORDER.indexOf(path[0]) - VERDICT_ORDER.indexOf(path[path.length - 1]);
}

/* ---------- SVG donut ---------- */
function donut(items, size = 132, thickness = 22) {
  const total = items.reduce((s, it) => s + it.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const gap = items.length > 1 ? 2 : 0; // thin white gap so segments never look merged
  let offset = 0;
  const segs = items.map((it, i) => {
    const frac = it.value / total;
    const len = frac * circ;
    const dashLen = Math.max(0.5, len - gap);
    const dash = `${dashLen} ${circ - dashLen}`;
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
  const todayNote = marketOpenNow() ? "live" : `at ${lastCloseName(DATA.meta.date)} close`;
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

function isoOf(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function lastCloseName(iso) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(asOfDate(iso) + "T12:00:00").getDay()];
}
function lastTradingDate(iso) {
  // roll a weekend date back to Friday
  const d = new Date(iso + "T12:00:00");
  if (d.getDay() === 6) d.setDate(d.getDate() - 1);
  else if (d.getDay() === 0) d.setDate(d.getDate() - 2);
  return isoOf(d);
}
function lastSessionDate() {
  // most recent COMPLETED US session relative to ET now (weekday before 9:30 -> prior trading day)
  const etDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = new Date(etDate + "T12:00:00");
  const p = nyParts(); let h = parseInt(p.hour, 10); if (h === 24) h = 0;
  if (h * 60 + parseInt(p.minute, 10) < 570) d.setDate(d.getDate() - 1); // before 9:30 ET -> yesterday's session
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1); // skip weekends
  return isoOf(d);
}
function asOfDate(iso) {
  // the data is at most as fresh as its stamp AND as the last real session — show the earlier
  const a = lastTradingDate(iso), b = lastSessionDate();
  return a < b ? a : b;
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
    `<p class="card-note" style="margin:6px 0 16px">${DATA.universe.length} Shariah-compliant names scored</p>
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
  { key: "since", label: "Since", fmt: (x) => x.since_pct == null
      ? `<span class="muted">—</span>`
      : `<span class="cell-since ${signClass(x.since_pct)}">${fmtPct(x.since_pct)}</span><span class="since-date">${x.first_date ? x.first_date.slice(5) : ""}</span>`,
    sortVal: (x) => (x.since_pct == null ? -1e9 : x.since_pct) },
  { key: "vtrend", label: "Verdict △", align: "left", fmt: (x) => verdictTrend(x), sortVal: verdictTrendSort },
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

function renderTopHoldings() {
  const el = document.getElementById("p-holdings-bars");
  if (!el) return;
  const holds = [...DATA.portfolio].sort((a, b) => b.value - a.value);
  const total = holds.reduce((s, h) => s + h.value, 0) || 1;
  const shown = holds.slice(0, 6);
  const ws = shown.map((h) => h.value / total * 100);
  const maxW = Math.max(...ws, 1);                 // biggest holding fills the bar; rest scale down
  const bars = shown.map((h, i) =>
    `<div class="hbar-row"><span class="hbar-tk">${esc(h.ticker)}</span><span class="hbar-track"><span class="hbar-fill" style="width:${Math.max(4, ws[i] / maxW * 100).toFixed(1)}%;background:${SECTOR_COLORS[i % SECTOR_COLORS.length]}"></span></span><span class="hbar-pct">${ws[i].toFixed(1)}%</span></div>`
  ).join("");
  // faded company logos in two straight, evenly-spread rows
  const logos = shown.map((h) =>
    `<img class="hbar-logo" src="https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/${encodeURIComponent(h.ticker)}.png" alt="" loading="lazy" onerror="this.remove()">`
  ).join("");
  el.innerHTML = `<div class="hbar-list">${bars}</div><div class="hbar-logos">${logos}</div>`;
}

function renderPortfolio() {
  renderKpis(); // KPI strip lives inside this panel now
  renderTopHoldings();

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

/* ---------- Track Record / Verdict Scorecard ---------- */
// IC-over-time sparkline. Shows a placeholder until there are >=3 logged days,
// then auto-draws the line (the daily build appends to scorecard.history).
function renderTrend(hist) {
  const pts = (hist || []).filter((h) => h.ic != null);
  if (pts.length < 3) {
    return `<div class="card sc-trend">
      <div class="sc-trend-h">Signal over time${infoBtn("ic")}</div>
      <div class="sc-trend-empty">The IC line appears here once there are a few days to plot — <b>${pts.length} point${pts.length === 1 ? "" : "s"}</b> so far. It logs one per trading day automatically.</div>
    </div>`;
  }
  const ics = pts.map((p) => p.ic);
  let lo = Math.min(...ics, 0), hi = Math.max(...ics, 0);
  const pad = (hi - lo) * 0.15 || 0.1; lo -= pad; hi += pad;
  const W = 300, H = 70;
  const x = (i) => (i / (pts.length - 1)) * W;
  const y = (v) => H - ((v - lo) / (hi - lo)) * H;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.ic).toFixed(1)}`).join(" ");
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.ic).toFixed(1)}" r="2.5" class="sc-trend-dot"/>`).join("");
  const zero = (lo < 0 && hi > 0) ? `<line x1="0" y1="${y(0).toFixed(1)}" x2="${W}" y2="${y(0).toFixed(1)}" class="sc-trend-zero"/>` : "";
  const last = pts[pts.length - 1];
  return `<div class="card sc-trend">
    <div class="sc-trend-h">Signal over time <span class="sc-trend-cur ${signClass(last.ic)}">IC ${last.ic > 0 ? "+" : ""}${last.ic.toFixed(2)}</span>${infoBtn("ic")}</div>
    <svg class="sc-trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${zero}<path d="${line}" class="sc-trend-line"/>${dots}</svg>
    <div class="sc-trend-x"><span>${pts[0].date.slice(5)}</span><span>${last.date.slice(5)}</span></div>
  </div>`;
}

let callsFilter = "ALL";
const tierFold = (v) => ({ "STRONGEST": "STRONG BUY", "STRONG AVOID": "AVOID" }[v] || v);
// The calls log: every verdict ever issued, as a locked trade with entry price + return.
function renderCallsLog() {
  const calls = DATA.calls || [];
  if (!calls.length) return "";
  const tiers = ["ALL", "STRONG BUY", "BUY", "HOLD-QUAL", "AVOID"];
  const shown = calls.filter((c) => callsFilter === "ALL" || tierFold(c.verdict) === callsFilter);
  const chips = tiers.map((t) =>
    `<button class="call-chip ${t === callsFilter ? "active" : ""}" type="button" data-callf="${t}">${t === "ALL" ? "All" : vAbbr(t)}</button>`).join("");
  const rows = shown.map((c) => `<tr>
      <td class="left"><span class="tick">${c.ticker}</span></td>
      <td class="left"><span class="badge sm ${verdictSlug(c.verdict)}">${vAbbr(c.verdict)}</span></td>
      <td>${c.start_date ? c.start_date.slice(5) : ""}</td>
      <td>${fmtUSD(c.start_price, 2)}</td>
      <td>${fmtUSD(c.exit_price, 2)}</td>
      <td class="${signClass(c.return_pct)}"><b>${fmtPct(c.return_pct, 1)}</b></td>
      <td class="${signClass(c.alpha_pct)}">${c.alpha_pct == null ? "—" : fmtPct(c.alpha_pct, 1)}</td>
      <td>${c.open ? `<span class="call-open">open</span>` : `<span class="muted">closed</span>`}</td>
    </tr>`).join("");
  return `<div class="card calls-card">
    <div class="calls-h">Every call <span class="muted">— ${calls.length} total · each locked at its entry; return marks to current price</span></div>
    <div class="call-chips">${chips}</div>
    <div class="table-wrap calls-scroll"><table class="calls-table">
      <thead><tr><th class="left">Ticker</th><th class="left">Verdict</th><th>Called</th><th>Entry</th><th>Now</th><th>Return</th><th>vs S&amp;P</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function renderScorecard() {
  const host = document.getElementById("scorecard");
  if (!host) return;
  const sc = DATA.scorecard;
  if (!sc || !sc.tiers || !sc.tiers.length) {
    host.innerHTML = `<div class="card"><p class="muted">Track record builds as verdicts age — check back soon.</p></div>`;
    return;
  }
  const tiers = sc.tiers;
  const total = tiers.reduce((s, t) => s + t.n, 0);
  const maxAbs = Math.max(...tiers.map((t) => Math.abs(t.avg_since)), 0.1);
  // diverging bar chart: avg return by tier, zero-centered
  const bars = tiers.map((t) => {
    const w = Math.abs(t.avg_since) / maxAbs * 50;
    const pos = t.avg_since >= 0;
    const style = pos ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`;
    return `<div class="sc-bar-row">
      <div class="sc-bar-label">${vAbbr(t.tier)}</div>
      <div class="sc-bar-track"><div class="sc-bar-zero"></div><div class="sc-bar-fill ${pos ? "pos" : "neg"}" style="${style}"></div></div>
      <div class="sc-bar-val ${signClass(t.avg_since)}">${fmtPct(t.avg_since, 1)}</div>
    </div>`;
  }).join("");
  const cards = tiers.map((t) => {
    const hitLabel = t.tier === "AVOID" ? "% fell" : t.tier === "HOLD-QUAL" ? "% flat (±2%)" : "% rose";
    const oc = t.closed ? `${t.open} open · ${t.closed} closed` : `all open`;
    return `<div class="sc-card">
      <span class="badge ${verdictSlug(t.tier)}">${t.tier}</span>
      <div class="sc-n">${t.n} call${t.n === 1 ? "" : "s"} · ${oc}</div>
      <div class="sc-main ${signClass(t.avg_since)}">${fmtPct(t.avg_since, 2)}</div>
      <div class="sc-main-sub">avg return since called</div>
      <div class="sc-row"><span>vs S&amp;P (alpha)</span><b class="${signClass(t.avg_alpha)}">${t.avg_alpha == null ? "—" : fmtPct(t.avg_alpha, 2)}</b></div>
      <div class="sc-row"><span>${hitLabel}</span><b>${t.hit_rate == null ? "—" : t.hit_rate + "%"}</b></div>
      <div class="sc-row"><span>Best</span><b class="pos">${t.best.ticker} ${fmtPct(t.best.since, 0)}</b></div>
      <div class="sc-row"><span>Worst</span><b class="neg">${t.worst.ticker} ${fmtPct(t.worst.since, 0)}</b></div>
    </div>`;
  }).join("");
  const spreadTxt = sc.spread == null ? "" :
    `<div class="sc-spread">Strong&nbsp;Buy beats Avoid by <b class="${signClass(sc.spread)}">${fmtPct(sc.spread, 1).replace("%", " pts")}</b></div>`;
  const icTxt = sc.ic == null ? "" :
    `<span class="sc-ic">Rank signal (IC) <b class="${signClass(sc.ic)}">${sc.ic > 0 ? "+" : ""}${sc.ic.toFixed(2)}</b>${infoBtn("ic")}</span>`;
  const matTxt = sc.days_tracked == null ? "" :
    `<span class="sc-mat">Day ${sc.days_tracked} of ~${sc.target_days || 20} — early read</span>`;
  host.innerHTML = `
    <div class="card sc-headline">
      <div class="sc-q">Does the ranking rank?${infoBtn("scorecard")}</div>
      ${spreadTxt}
      <div class="sc-meta">${icTxt}${matTxt}</div>
      <div class="sc-bars">${bars}</div>
      <div class="sc-note">Each <b>call</b> is a verdict locked at its entry price — it stays put until the name is re-scored (not on daily price moves). Return marks to current price. ${total} calls since ${sc.since || ""}. Early sample — watch the IC + spread trend as it matures.</div>
    </div>
    ${renderTrend(sc.history)}
    <div class="sc-grid">${cards}</div>
    ${renderCallsLog()}`;
  host.querySelectorAll(".call-chip").forEach((b) =>
    b.addEventListener("click", () => { callsFilter = b.dataset.callf; renderScorecard(); }));
}

/* ---------- tabs ---------- */
function initTabs() {
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".tabpanel").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      document.getElementById("tab-" + t.dataset.tab).classList.add("active");
      if (t.dataset.tab === "informed") enterInformed(); else leaveInformed();
      if (t.dataset.tab === "universe") resumeUniverseCycler(); else pauseUniverseCycler();
    }));
}

/* ---------- live prices (Finnhub, browser-side) ---------- */
const LIVE_INTERVAL_MS = 60000;  // holdings refresh ~every 60s (≈17 calls/min)
const UNIVERSE_PUMP_MS = 2000;   // 1 universe name per 2s (≈30/min); cycles the universe live
// Live quotes go through our Cloudflare Worker (DATA.meta.quote_proxy) — it holds the
// Finnhub key server-side and caches/dedupes, so the key never reaches the browser.
const THROTTLE_MS = 45000;       // on a 429, pause all polling this long (free tier = 60 calls/min)
// Combined budget ≈ 17 + 12 = 29 calls/min — comfortable headroom under the free 60/min cap.
let liveTimer = null;
let uniTimer = null;
let uniQueue = [];
let uniIdx = 0;
let lastAccount = null;
let lastGoodTs = 0;
let lastGoodClock = "";
let throttleUntil = 0;           // when >now, we're backing off after a rate-limit (429)

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
  pill.classList.remove("closed", "stale", "delayed");
  if (state === "closed") pill.classList.add("closed");
  if (state === "stale") pill.classList.add("stale");
  if (state === "delayed") pill.classList.add("delayed");
  document.getElementById("live-text").textContent = text;
}
async function fetchQuote(ticker) {
  const base = DATA.meta && DATA.meta.quote_proxy;
  const res = await fetch(`${base}/quote?symbol=${encodeURIComponent(ticker)}`, { cache: "no-store" });
  if (res.status === 429) { throttleUntil = Date.now() + THROTTLE_MS; throw new Error("429"); } // rate-limited -> back off
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json(); // { c, d, dp, h, l, o, pc, t }  (Worker passes Finnhub's shape through)
}
async function liveTick() {
  const key = DATA.meta && DATA.meta.quote_proxy;
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
  } else if (lastGoodTs) {
    // Couldn't refresh this tick — just keep showing the last good time. The timestamp is
    // the honesty signal (it stops advancing if data stalls). Only after a long gap add a
    // quiet "· delayed"; NEVER flip to an alarming "Reconnecting" state.
    const stale = Date.now() - lastGoodTs > 300000; // 5 min
    setLivePill("live", `LIVE · ${lastGoodClock}${stale ? " · delayed" : ""}`);
  } else {
    setLivePill("live", "LIVE · connecting…");
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
  // Cycler: quote ONE non-held universe name per pump, patch its cells. A rate-limited name
  // just fails silently and we move on next pump — no global pause, so updates keep flowing.
  if (!(DATA.meta && DATA.meta.quote_proxy) || !uniQueue.length) return;
  if (!marketOpenNow()) return; // pill state is owned by the holdings tick
  const ticker = uniQueue[uniIdx % uniQueue.length];
  uniIdx++;
  fetchQuote(ticker, DATA.meta.quote_proxy).then((q) => {
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
  pauseUniverseCycler();
  if (!(DATA.meta && DATA.meta.quote_proxy)) return; // no proxy -> stay on daily snapshot
  lastAccount = DATA.meta.portfolio_totals.account;
  // Holdings poll every 60s; the universe cycler streams the rest one-by-one (runs only while
  // the Shariah-Compliant tab is open). On a rate-limit, individual fetches just skip — the
  // pill never alarms — so live updates keep flowing as fast as the free key allows.
  const held = new Set(DATA.portfolio.map((h) => h.ticker));
  uniQueue = DATA.universe.map((x) => x.ticker).filter((t) => !held.has(t));
  uniIdx = 0;
  liveTick();
  liveTimer = setInterval(liveTick, LIVE_INTERVAL_MS);
}
function pauseUniverseCycler() { if (uniTimer) { clearInterval(uniTimer); uniTimer = null; } }
function resumeUniverseCycler() {
  if (!uniTimer && DATA && DATA.meta && DATA.meta.quote_proxy && uniQueue.length) {
    uniTimer = setInterval(universeTick, UNIVERSE_PUMP_MS);
  }
}

/* ---------- Stay Informed: market snapshot + news ---------- */
const INDEXES = [
  { label: "S&P 500", sub: "via SPY", sym: "SPY" },
  { label: "Nasdaq 100", sub: "via QQQ", sym: "QQQ" },
];
const NEWS_FILTERS = [
  { name: "Top Stories", cat: "general" },
  { name: "Technology", sym: "MSFT" },
  { name: "Semiconductors", sym: "NVDA" },
  { name: "Healthcare", sym: "LLY" },
  { name: "Financials", sym: "JPM" },
  { name: "Energy", sym: "XOM" },
  { name: "Consumer", sym: "AMZN" },
  { name: "Industrials", sym: "CAT" },
];
let newsFilter = "Top Stories";
let informedTimer = null;
let informedLoaded = false;

// external/news content is DATA — always escape it before inserting as HTML
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : "#"; }
function relTime(sec) {
  const diff = Math.max(0, Date.now() / 1000 - sec);
  if (diff < 3600) return Math.max(1, Math.floor(diff / 60)) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

function asOfLabel(tsSec) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(tsSec * 1000)) + " ET";
  } catch (e) { return ""; }
}
async function renderIndexes() {
  const key = DATA.meta && DATA.meta.quote_proxy;
  const row = document.getElementById("idx-row");
  if (!row) return;
  if (!key) { row.innerHTML = `<div class="idx-card"><span class="muted">Live market data needs the API key.</span></div>`; return; }
  let latestT = 0;
  const cards = await Promise.all(INDEXES.map(async (ix) => {
    try {
      const q = await fetchQuote(ix.sym, key);
      if (!q || typeof q.c !== "number" || !q.c) throw new Error("no data");
      if (q.t && q.t > latestT) latestT = q.t;
      const up = (q.d || 0) >= 0;
      return `<div class="idx-card ${up ? "up" : "down"}">
        <div class="idx-name">${esc(ix.label)} <span class="idx-tick">· ${esc(ix.sym)} ETF</span></div>
        <div class="idx-pct ${up ? "pos" : "neg"}">${up ? "▲" : "▼"} ${Math.abs(q.dp).toFixed(2)}%</div>
        <div class="idx-price">$${fmtNum(q.c, 2)} <span class="${up ? "pos" : "neg"}">${q.d >= 0 ? "+" : "−"}$${fmtNum(Math.abs(q.d), 2)}</span></div>
      </div>`;
    } catch (e) {
      return `<div class="idx-card"><div class="idx-top"><span class="idx-name">${esc(ix.label)}</span></div><div class="idx-level muted">—</div></div>`;
    }
  }));
  row.innerHTML = cards.join("");
  const asof = document.getElementById("idx-asof");
  if (asof) asof.textContent = latestT ? "as of " + asOfLabel(latestT) : "";
}

function renderNewsFilters() {
  const el = document.getElementById("news-filters");
  if (!el) return;
  el.innerHTML = NEWS_FILTERS.map((f, i) => {
    const chip = `<button class="news-chip ${f.name === newsFilter ? "active" : ""}" type="button" data-news="${esc(f.name)}">${esc(f.name)}</button>`;
    // divider after the overall feed, before the sector chips
    const div = (f.cat && NEWS_FILTERS[i + 1] && !NEWS_FILTERS[i + 1].cat) ? `<span class="news-div"></span>` : "";
    return chip + div;
  }).join("");
  el.querySelectorAll(".news-chip").forEach((c) =>
    c.addEventListener("click", () => loadNews(c.dataset.news)));
}

// stories WITH a real photo -> image card
function photoCardHtml(it) {
  const url = safeUrl(it.url), img = safeUrl(it.image);
  return `<a class="news-card" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
    <div class="news-card-media"><img class="news-cover" src="${esc(img)}" alt="" loading="lazy" onerror="this.style.display='none'"></div>
    <div class="news-card-body">
      <div class="news-card-title">${esc(it.headline)}</div>
      <div class="news-card-foot"><span class="news-foot-l">${it._tk ? `<span class="news-tk">${esc(it._tk)}</span>` : ""}<span class="news-src">${esc(it.source || "—")}</span></span><span class="news-time">${relTime(it.datetime)}</span></div>
    </div>
  </a>`;
}
// stories WITHOUT a photo -> slim headline row (agency name + time, no image box)
function newsRowHtml(it) {
  const url = safeUrl(it.url);
  const lead = it._tk ? `<span class="news-tk">${esc(it._tk)}</span>` : `<span class="news-row-dot"></span>`;
  return `<a class="news-row" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
    ${lead}
    <span class="news-row-title">${esc(it.headline)}</span>
    <span class="news-row-right"><span class="news-src">${esc(it.source || "—")}</span><span class="news-time">${relTime(it.datetime)}</span></span>
  </a>`;
}
// split items into photo cards + headline rows (shared by Stay Informed and Portfolio news)
function renderNewsFeed(container, items, emptyLabel) {
  items = items.filter((it) => it && it.headline && it.url);
  if (!items.length) { container.innerHTML = `<p class="muted">${esc(emptyLabel || "No recent headlines.")}</p>`; return; }
  const freq = {};
  items.forEach((it) => { const im = safeUrl(it.image); if (im !== "#") freq[im] = (freq[im] || 0) + 1; });
  const isRealPhoto = (it) => { const im = safeUrl(it.image); return im !== "#" && !/logo/i.test(im) && (freq[im] || 0) <= 2; };
  const photos = items.filter(isRealPhoto);
  const rows = items.filter((it) => !isRealPhoto(it));
  container.innerHTML =
    (photos.length ? `<div class="news-grid">${photos.map(photoCardHtml).join("")}</div>` : "") +
    (rows.length ? `<div class="news-rows">${rows.map(newsRowHtml).join("")}</div>` : "");
}

async function loadNews(filterName) {
  newsFilter = filterName || newsFilter;
  renderNewsFilters();
  const list = document.getElementById("news-list");
  const key = DATA.meta && DATA.meta.finnhub_key;   // news calls Finnhub directly (not the quote Worker)
  if (!list) return;
  if (!key) { list.innerHTML = `<p class="muted">Live news needs the API key.</p>`; return; }
  list.innerHTML = `<p class="news-loading">Loading headlines…</p>`;
  const f = NEWS_FILTERS.find((x) => x.name === newsFilter) || NEWS_FILTERS[0];
  let url;
  if (f.cat) {
    url = `https://finnhub.io/api/v1/news?category=${f.cat}&token=${key}`;
  } else {
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    const from = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    url = `https://finnhub.io/api/v1/company-news?symbol=${f.sym}&from=${from}&to=${to}&token=${key}`;
  }
  try {
    const res = await fetch(url, { cache: "no-store" });
    let items = await res.json();
    if (!Array.isArray(items)) throw new Error("bad response");
    items = items.filter((it) => it && it.headline && it.url).slice(0, 30);
    renderNewsFeed(list, items, `No recent headlines for ${newsFilter}.`);
  } catch (e) {
    list.innerHTML = `<p class="muted">Couldn't load news right now — try Refresh.</p>`;
  }
}

function enterInformed() {
  if (!informedLoaded) { renderNewsFilters(); loadNews("Top Stories"); informedLoaded = true; }
  renderIndexes();
  if (informedTimer) clearInterval(informedTimer);
  informedTimer = setInterval(renderIndexes, 60000); // refresh the index screens while viewing
}
function leaveInformed() {
  if (informedTimer) { clearInterval(informedTimer); informedTimer = null; }
}
function initInformed() {
  renderNewsFilters();
  const rb = document.getElementById("news-refresh");
  if (rb) rb.addEventListener("click", () => { renderIndexes(); loadNews(newsFilter); });
}

/* ---------- Portfolio sub-tabs: News + Key Dates ---------- */
let pNewsLoaded = false, pDatesLoaded = false;

async function loadPortfolioNews() {
  const key = DATA.meta && DATA.meta.finnhub_key;   // company-news calls Finnhub directly
  const list = document.getElementById("pnews-list");
  if (!list) return;
  if (!key) { list.innerHTML = `<p class="muted">Live news needs the API key.</p>`; return; }
  list.innerHTML = `<p class="news-loading">Loading your holdings' news…</p>`;
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - 10 * 86400000).toISOString().slice(0, 10);
  const results = await Promise.all(DATA.portfolio.map(async (h) => {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${h.ticker}&from=${from}&to=${to}&token=${key}`, { cache: "no-store" });
      const arr = await res.json();
      return Array.isArray(arr) ? arr.slice(0, 4).map((it) => ({ ...it, _tk: h.ticker })) : [];
    } catch (e) { return []; }
  }));
  const seen = new Set();
  let merged = results.flat().filter((it) => { if (!it || !it.url || seen.has(it.url)) return false; seen.add(it.url); return true; });
  merged.sort((a, b) => (b.datetime || 0) - (a.datetime || 0));
  renderNewsFeed(list, merged.slice(0, 42), "No recent news for your holdings.");
}

function pDateRowHtml(e) {
  const d = new Date(e.date + "T12:00:00");
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  const daysOut = Math.round((d - new Date()) / 86400000);
  const hour = e.hour === "bmo" ? "before open" : e.hour === "amc" ? "after close" : "";
  return `<div class="date-row">
    <div class="date-when"><span class="date-day">${mon} ${d.getDate()}</span><span class="date-wd">${wd}${daysOut >= 0 ? ` · ${daysOut}d` : ""}</span></div>
    <div class="date-main"><span class="news-tk">${esc(e.tk)}</span> <span class="date-label">Earnings${hour ? ` · ${hour}` : ""}</span></div>
    ${e.epsEst != null ? `<span class="date-extra">est. EPS ${fmtNum(e.epsEst, 2)}</span>` : ""}
  </div>`;
}

async function loadPortfolioDates() {
  const key = DATA.meta && DATA.meta.finnhub_key;   // earnings calendar calls Finnhub directly
  const el = document.getElementById("pdates-list");
  if (!el) return;
  if (!key) { el.innerHTML = `<p class="muted">Live calendar needs the API key.</p>`; return; }
  el.innerHTML = `<p class="news-loading">Loading earnings dates…</p>`;
  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 130 * 86400000).toISOString().slice(0, 10);
  const results = await Promise.all(DATA.portfolio.map(async (h) => {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${h.ticker}&token=${key}`, { cache: "no-store" });
      const j = await res.json();
      const ev = (j.earningsCalendar || [])[0];
      return (ev && ev.date) ? { tk: h.ticker, date: ev.date, hour: ev.hour, epsEst: ev.epsEstimate } : null;
    } catch (e) { return null; }
  }));
  const events = results.filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  el.innerHTML = events.length
    ? `<div class="dates-card"><h4 class="dates-h">Upcoming earnings</h4><div class="dates-rows">${events.map(pDateRowHtml).join("")}</div></div>`
    : `<p class="muted">No upcoming earnings dates found.</p>`;
}

function initPortfolioSubtabs() {
  document.querySelectorAll("#p-subtabs .subtab").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#p-subtabs .subtab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll("#tab-portfolio .psub").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById("psub-" + b.dataset.psub).classList.add("active");
      if (b.dataset.psub === "news" && !pNewsLoaded) { pNewsLoaded = true; loadPortfolioNews(); }
      if (b.dataset.psub === "dates" && !pDatesLoaded) { pDatesLoaded = true; loadPortfolioDates(); }
    }));
}

function initUniverseSubtabs() {
  document.querySelectorAll("#u-subtabs .subtab").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#u-subtabs .subtab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll("#tab-universe .usub").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById("usub-" + b.dataset.usub).classList.add("active");
      // the universe price-cycler only needs to run while the Universe table is showing
      if (b.dataset.usub === "universe") resumeUniverseCycler(); else pauseUniverseCycler();
    }));
}

/* ---------- boot ---------- */
function renderAll() {
  document.getElementById("asof-date").textContent = asOfDate(DATA.meta.date);
  renderVerdictSummary();
  renderUniverseControls();
  renderUniverseTable();
  renderScorecard();
  renderPortfolio();
  initTabs();
  startLive();
}

async function boot() {
  let payload;
  try {
    const res = await fetch("payload.enc", { cache: "no-store" });
    payload = await res.json();
    if (payload.date) document.getElementById("gate-date").textContent = asOfDate(payload.date);
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
initInformed();
initPortfolioSubtabs();
initUniverseSubtabs();
boot();
