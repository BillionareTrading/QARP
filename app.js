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
  mech: { t: "Quality (out of 105)", d: "The quality half of QARP — the sum of five dimensions: Valuation, Growth, Moat & Returns, Balance Sheet, and Capital Allocation." },
  verdict: { t: "Verdict", d: "The QARP score turned into a call: ≥85 Strongest, ≥72 Strong Buy, ≥66 Buy, ≥60 Hold-Qual, 35–59 Avoid, <35 Strong Avoid." },
  gate: { t: "Momentum gate", d: "Value decides WHAT to buy; the tape decides WHEN. GO = price above its 50-day average (uptrend — a Buy verdict is actionable). TURN = reclaimed the 20-day but still under the 50-day (bottoming attempt, early). WAIT = below both — the knife is still falling; the verdict stands but acting on it means fighting the tape. Kept beside QARP, never mixed into the score." },
  calls: { t: "Calls", d: "Every verdict this name has received, as dated calls. Each call locks its entry price when issued: closed calls (🔒) show the return locked when the verdict changed on a re-score; the open call (→) marks to the live price. Daily price moves never change a call — only deliberate re-scores do." },
  catalyst: { t: "Catalyst (PREVIEW — not in QARP yet)", d: "Does the cheapness have a near-term path to close, or is it a value trap? SET = strong catalyst (insider cluster/CEO buying, tape confirming). WATCH = developing. WEAK = cheap but no specific driver. NONE = no catalyst and insiders leaving — value-trap risk. ⚠ = under the proposed rule this name's 'cheap' score would be capped (cheap with no catalyst). SHADOW MODE: shown for evaluation, does NOT affect the live QARP/verdict until the Day-20 review. See CATALYST_FACTOR_PROPOSAL.md." },
  div: { t: "Dividends", d: "Forward annual dividend per share, with the yield (rate ÷ current price) beneath. N/A = the company pays no dividend. Refreshed in the daily build." },
  div_income: { t: "Dividend income", d: "What Jaleel's position pays per year: shares × annual dividend rate. N/A = non-payer. The KPI strip shows the portfolio total." },
  gain: { t: "Unrealized P/L", d: "Paper profit/loss on positions you still hold (current value minus cost basis). It is NOT money in the bank — it changes with every tick and excludes anything already sold. Realized profits from completed sells will be tracked separately." },
  gain_pct: { t: "Unrealized P/L %", d: "The same unrealized paper profit/loss, as a percent of what you paid for the position." },
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
// Calls column: every deliberate verdict (a "call"), dated, with its return — closed
// calls show the LOCKED return (entry -> re-score price); the open call marks to the
// live price. Built from DATA.calls grouped by ticker (lazy, cached).
let _callsByTk = null;
function callsFor(tk) {
  if (!_callsByTk) {
    _callsByTk = {};
    (DATA.calls || []).forEach((c) => (_callsByTk[c.ticker] = _callsByTk[c.ticker] || []).push(c));
    Object.values(_callsByTk).forEach((l) => l.sort((a, b) => (a.start_date || "").localeCompare(b.start_date || "")));
  }
  return _callsByTk[tk] || [];
}
function openCallReturn(tk, livePx) {
  const open = callsFor(tk).find((c) => c.open);
  if (!open || !open.start_price) return -1e9;
  return ((livePx || open.exit_price) / open.start_price - 1) * 100;
}
function callsCell(tk, livePx) {
  const list = callsFor(tk);
  if (!list.length) return `<span class="muted">—</span>`;
  return list.map((c) => {
    const ret = c.open && livePx && c.start_price ? (livePx / c.start_price - 1) * 100 : c.return_pct;
    const when = c.open
      ? `${(c.start_date || "").slice(5)} →`
      : `${(c.start_date || "").slice(5)}–${(c.end_date || "").slice(5)}`;
    return `<div class="call-line ${c.open ? "open" : "closed"}" title="${c.verdict} called ${c.start_date} @ $${c.start_price}${c.open ? " — open, marks to current price" : ` — closed ${c.end_date} @ $${c.exit_price} (locked)`}">
      <span class="badge sm ${verdictSlug(c.verdict)}">${vAbbr(c.verdict)}</span>
      <span class="call-when">${when}</span>
      <b class="${signClass(ret)}">${fmtPct(ret, 1)}</b>${c.open ? "" : `<span class="call-lock">🔒</span>`}
    </div>`;
  }).join("");
}
// Momentum gate (overlay — beside QARP, never inside it). Value decides WHAT, the
// tape decides WHEN: GO = above 50DMA, TURN = reclaimed 20DMA, WAIT = knife falling.
// LIVE: state recomputes from the current price against the day's MA levels on every
// price tick (the averages only move once a day, so this is the correct intraday gate).
function gateNow(x) {
  const m = x.mom;
  if (!m) return null;
  if (m.ma50 && m.ma20 && x.price > 0) {
    const state = x.price >= m.ma50 ? "GO" : x.price >= m.ma20 ? "TURN" : "WAIT";
    return { state, vs50: +((x.price / m.ma50 - 1) * 100).toFixed(1) };
  }
  return m; // old payloads without MA levels: fall back to build-time state
}
function momGate(x) {
  const m = gateNow(x);
  if (!m) return `<span class="muted">—</span>`;
  const t = { GO: "tape confirms — actionable", TURN: "bottoming attempt — early", WAIT: "below 20 & 50-day — knife still falling" }[m.state];
  return `<span class="mg mg-${m.state.toLowerCase()}" title="${t} (${m.vs50 >= 0 ? "+" : ""}${m.vs50}% vs 50-day avg — live)">${m.state}</span>`;
}
function patchGateCells(ticker, u) {
  document.querySelectorAll(`#u-table tr[data-ticker="${ticker}"] .mg, #p-table tr[data-ticker="${ticker}"] .mg`)
    .forEach((el) => { el.outerHTML = momGate(u); });
}
// Catalyst tag (PREVIEW / shadow — does not affect QARP yet). Colour by strength; ⚠ = the
// proposed DCF cap would downgrade this name's "cheap" score (cheap with no catalyst = value trap).
function catalystCell(x) {
  const c = x.catalyst;
  if (!c) return `<span class="muted">—</span>`;
  const cls = { SET: "cat-set", WATCH: "cat-watch", WEAK: "cat-weak", NONE: "cat-none" }[c.label] || "cat-weak";
  const note = esc(c.note || `Catalyst ${c.label}`);   // per-company explanation on hover
  const warn = c.would_cut ? `<span class="cat-warn" title="${note}">⚠</span>` : "";
  return `<span class="cat ${cls}" title="${note}">${c.label}</span>${warn}`;
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
    { label: "Unrealized P/L", note: "open holdings only", value: fmtUSD(t.gain, 0), delta: fmtPct(t.gain_pct), dClass: signClass(t.gain) },
    { label: "Cost Basis", value: fmtUSD(t.cost, 0), delta: `${DATA.portfolio.length} holdings`, dClass: "muted" },
  ];
  if (t.div_income_yr) cards.push({ label: "Dividends", note: "annual", value: fmtUSD(t.div_income_yr, 0) + "/yr",
    delta: t.positions ? fmtPct(t.div_income_yr / t.positions * 100, 2).replace("+", "") + " yield" : "", dClass: "muted" });
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
// US market holidays (NYSE) — kept in sync with daily_update.sh. A "trading day" is a
// weekday that is NOT one of these, so the price "as of" rolls back over holidays too.
const NYSE_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19",
  "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
  "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
function isClosedDay(d) {
  const dow = d.getDay();
  return dow === 0 || dow === 6 || NYSE_HOLIDAYS.has(isoOf(d));
}
function lastTradingDate(iso) {
  const d = new Date(iso + "T12:00:00");
  while (isClosedDay(d)) d.setDate(d.getDate() - 1);   // roll weekends/holidays back to the prior session
  return isoOf(d);
}
function lastSessionDate() {
  // most recent COMPLETED US session relative to ET now (weekday before 9:30 -> prior trading day)
  const etDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = new Date(etDate + "T12:00:00");
  const p = nyParts(); let h = parseInt(p.hour, 10); if (h === 24) h = 0;
  if (h * 60 + parseInt(p.minute, 10) < 570) d.setDate(d.getDate() - 1); // before 9:30 ET -> yesterday's session
  while (isClosedDay(d)) d.setDate(d.getDate() - 1);   // skip weekends + market holidays
  return isoOf(d);
}
function asOfDate(iso) {
  // the data is at most as fresh as its stamp AND as the last real session — show the earlier
  const a = lastTradingDate(iso), b = lastSessionDate();
  return a < b ? a : b;
}

/* ---------- which index list is showing (S&P 500 | Global) ---------- */
let uIndex = "S&P 500";
const uList = () => DATA.universe.filter((x) => (x.index || "S&P 500") === uIndex);

/* ---------- render: Overview ---------- */
function renderVerdictSummary() {
  // verdict distribution — stacked proportion bar + count tiles (top of Shariah-Compliant tab)
  const list = uList();
  const counts = {};
  list.forEach((x) => (counts[x.verdict] = (counts[x.verdict] || 0) + 1));
  const total = list.length || 1;
  const order = VERDICT_ORDER.filter((v) => counts[v]);
  const bar = order.map((v) =>
    `<span style="width:${(counts[v] / total * 100).toFixed(2)}%;background:${VERDICT_COLOR[v]}" title="${v}: ${counts[v]}"></span>`).join("");
  const tiles = order.map((v) => `
    <div class="vstat">
      <div class="vstat-num" style="color:${VERDICT_COLOR[v]}">${counts[v]}</div>
      ${verdictBadge(v)}
    </div>`).join("");
  document.getElementById("verdict-chart").innerHTML =
    `<p class="card-note" style="margin:6px 0 16px">${list.length} ${uIndex} Shariah-compliant names scored</p>
     <div class="vbar-stack">${bar}</div>
     <div class="vstats">${tiles}</div>`;
}

/* ---------- sector grouping: collapse the ~120 granular industries into a
   handful of macro buckets so the Sector column/filter is usable (a lot of
   names per group). First matching keyword wins; order resolves overlaps
   (Semis before Tech, Beauty before Retail, consumer Internet before generic). */
const MACRO_SECTOR_RULES = [
  [["semi"], "Semiconductors"],
  [["beauty"], "Consumer Staples"],
  [["internet-delivery", "internet-gaming", "internet-mobility", "restaurant", "apparel", "homebuild", "retail", "auto-auction", "consumer-products", "footwear", "luxury"], "Consumer Disc."],
  [["staples", "beverage", "consumer-health", "consumer health"], "Consumer Staples"],
  [["pharma", "biotech", "healthcare", "health-", "life-sciences", "diagnostic", "medtech", "animal-health", "lab-instrument", "medical"], "Healthcare"],
  [["software", "internet", "cyber", "network", "iot", "datactr", "data-ctr", "storage", "tech-hardware", "electronics", "comms-equipment", "it-reseller", "auto-tech", "semis-ip"], "Technology"],
  [["energy", "solar", "fuelcell"], "Energy"],
  [["financial"], "Financials"],
  [["chemical", "steel", "metal", "agricultur", "packaging", "glass", "lithium", "aggregate", "material", "industrial-gas", "timber"], "Materials"],
  [["industrial", "construction", "rail", "logistic", "truck", "waste", "business-services", "electrical", "distribution", "hvac", "infra", "safety", "warehouse", "testing", "certification", "water", "aerospace", "machinery", "elevator", "bearing", "automation", "power", "diversified", "test-measurement", "instruments"], "Industrials"],
];
function sectorGroup(s) {
  const sl = (s || "").toLowerCase();
  for (const [kws, g] of MACRO_SECTOR_RULES) if (kws.some((k) => sl.includes(k))) return g;
  return s || "—"; // fallback: show the raw sector if a future build adds one we don't map yet
}

/* ---------- render: Universe table ---------- */
const U_COLS = [
  { key: "rank", label: "#", align: "left", fmt: (x) => `<span class="muted">${x.rank}</span>` },
  { key: "ticker", label: "Name", align: "left", fmt: (x) => `<span class="tick">${x.ticker}<span class="name">${x.name}</span></span>` },
  { key: "sector", label: "Sector", align: "left", fmt: (x) => `<span class="muted">${sectorGroup(x.sector)}</span>`, sortVal: (x) => sectorGroup(x.sector) },
  { key: "price", label: "Price", fmt: (x) => `<span class="cell-px">${fmtUSD(x.price, 2)}</span>` },
  { key: "day_pct", label: "Day", fmt: (x) => `<span class="cell-day ${signClass(x.day_pct)}">${fmtPct(x.day_pct)}</span>` },
  { key: "div", label: "Dividends", fmt: (x) => x.div_rate
      ? `<span class="div-rate">${fmtUSD(x.div_rate, 2)}<span class="div-unit">/sh</span></span><span class="div-yld">${x.div_yield != null ? x.div_yield + "%" : ""}</span>`
      : `<span class="muted">N/A</span>`,
    sortVal: (x) => x.div_yield || 0 },
  { key: "qarp", label: "QARP", fmt: (x) => `<span class="qarp-cell">${fmtNum(x.qarp, 1)}</span>` },
  { key: "dcf", label: "DCF", fmt: (x) => fmtNum(x.dcf, 1) },
  { key: "mech", label: "Q /105", fmt: (x) => x.mech },
  { key: "verdict", label: "Verdict", align: "left", fmt: (x) => verdictBadge(x.verdict), sortVal: (x) => VERDICT_ORDER.indexOf(x.verdict) },
  { key: "gate", label: "Gate", fmt: (x) => momGate(x),
    sortVal: (x) => { const m = gateNow(x); return m ? { GO: 2, TURN: 1, WAIT: 0 }[m.state] : -1; } },
  { key: "catalyst", label: "Catalyst", fmt: (x) => catalystCell(x), sortVal: (x) => (x.catalyst ? x.catalyst.score : -1) },
  { key: "calls", label: "Calls", align: "left", fmt: (x) => callsCell(x.ticker, x.price),
    sortVal: (x) => openCallReturn(x.ticker, x.price) },
];
let uSort = { key: "rank", dir: 1 };

function renderUniverseControls() {
  const list = uList();
  // intro copy reflects the active list (S&P 500 vs Global)
  const intro = document.getElementById("u-intro");
  if (intro) intro.innerHTML = uIndex === "Global"
    ? `<b>Global</b> names outside the S&amp;P 500, screened for Shariah compliance — the compliant ones are scored on <b>QARP</b> (quality + value) and ranked below. This list grows as we add more global companies.`
    : `Every <b>S&amp;P 500</b> company was screened for Shariah compliance — the ones that pass are scored on <b>QARP</b> (quality + value) and ranked below. Sort, filter, or tap any name for its full breakdown.`;
  // repopulate filters for THIS list (idempotent — keep each select's first "All" option)
  const verdSel = document.getElementById("u-verdict");
  const secSel = document.getElementById("u-sector");
  verdSel.length = 1; secSel.length = 1;
  document.getElementById("u-search").value = "";
  VERDICT_ORDER.filter((v) => list.some((x) => x.verdict === v))
    .forEach((v) => verdSel.add(new Option(v, v)));
  const secCounts = {};
  list.forEach((x) => { const g = sectorGroup(x.sector); secCounts[g] = (secCounts[g] || 0) + 1; });
  Object.entries(secCounts).sort((a, b) => b[1] - a[1])
    .forEach(([g, n]) => secSel.add(new Option(`${g} (${n})`, g)));
  if (!renderUniverseControls._wired) {
    ["u-search", "u-verdict", "u-sector"].forEach((id) =>
      document.getElementById(id).addEventListener("input", renderUniverseTable));
    renderUniverseControls._wired = true;
  }
}

function renderUniverseTable() {
  const q = document.getElementById("u-search").value.trim().toLowerCase();
  const fv = document.getElementById("u-verdict").value;
  const fs = document.getElementById("u-sector").value;
  const list = uList();
  let rows = list.filter((x) =>
    (!q || x.ticker.toLowerCase().includes(q) || x.name.toLowerCase().includes(q)) &&
    (!fv || x.verdict === fv) && (!fs || sectorGroup(x.sector) === fs));

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

  document.getElementById("u-count").textContent = `${rows.length} of ${list.length}`;
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
  { key: "gain", label: "Unrlzd $", fmt: (x) => `<span class="${signClass(x.gain)}">${fmtUSD(x.gain, 0)}</span>` },
  { key: "gain_pct", label: "Unrlzd %", fmt: (x) => `<span class="${signClass(x.gain_pct)}">${fmtPct(x.gain_pct)}</span>` },
  { key: "weight_pct", label: "Weight", fmt: (x) => fmtNum(x.weight_pct, 1) + "%" },
  { key: "div_income", label: "Div /yr", fmt: (x) => x.div_income
      ? `<span class="div-rate">${fmtUSD(x.div_income, 2)}</span>`
      : `<span class="muted">N/A</span>`,
    sortVal: (x) => x.div_income || 0 },
  { key: "qarp", label: "QARP", fmt: (x) => `<span class="qarp-cell">${fmtNum(x.qarp, 1)}</span>` },
  { key: "verdict", label: "Verdict", align: "left", fmt: (x) => verdictBadge(x.verdict), sortVal: (x) => VERDICT_ORDER.indexOf(x.verdict) },
  { key: "calls", label: "Calls", align: "left", fmt: (x) => callsCell(x.ticker, x.price),
    sortVal: (x) => openCallReturn(x.ticker, x.price) },
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

  renderSectorPerformance();
  renderPortfolioTable();
}

// Performance by sector — per-sector gain% bars, best -> worst.
function renderSectorPerformance() {
  const perfEl = document.getElementById("sector-perf");
  if (!perfEl) return;
  const secs = (DATA.sectors || []).filter((s) => s.gain_pct != null && s.cost);
  if (!secs.length) { perfEl.innerHTML = `<p class="muted">No sector performance yet.</p>`; return; }
  const perf = [...secs].sort((a, b) => b.gain_pct - a.gain_pct);
  const maxAbs = Math.max(1, ...perf.map((s) => Math.abs(s.gain_pct)));
  perfEl.innerHTML = perf.map((s) => {
    const pos = s.gain_pct >= 0, w = (Math.abs(s.gain_pct) / maxAbs * 100).toFixed(0);
    return `<div class="sp-row"><span class="sp-lbl">${s.sector}</span>`
      + `<span class="sp-track"><span class="sp-fill ${pos ? "pos" : "neg"}" style="width:${w}%"></span></span>`
      + `<span class="sp-val ${signClass(s.gain_pct)}">${fmtPct(s.gain_pct)}</span></div>`;
  }).join("");
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
    ["Valuation", d.val, 25], ["Growth", d.grw, 20], ["Moat & Returns", d.qual, 20],
    ["Balance Sheet", d.bs, 20], ["Capital Alloc", d.cap, 20],
  ];
  const has = (v) => v != null && v !== "";
  const kv = [];
  if (has(d.gf_value)) kv.push(["GF Value", fmtUSD(d.gf_value, 2)]);
  if (has(d.mktcap_b)) kv.push(["Market cap", "$" + fmtNum(d.mktcap_b, 1) + "B"]);
  if (has(d.shariah_grade)) kv.push(["Shariah (Musaffa)", d.shariah_grade]);
  if (has(d.confidence)) kv.push(["Confidence", d.confidence]);
  if (d.catalyst) kv.push(["Catalyst (preview)", `<b>${d.catalyst.label}</b> — ${esc(d.catalyst.note || "")}`]);
  if (has(d.insider)) kv.push(["Insider", d.insider]);
  if (has(d.buzz)) kv.push(["Buzz", `${d.buzz} — ${d.buzz_signal || ""}`]);
  if (p) {
    kv.push(["Jaleel's position", `${fmtNum(p.shares, 2)} sh · ${fmtUSD(p.value, 0)}`]);
    kv.push(["Jaleel's gain", `${fmtUSD(p.gain, 0)} (${fmtPct(p.gain_pct)})`]);
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
    ${has(d.dcf_note) ? `<h4>DCF / thesis note</h4><div class="dcf-note">${d.dcf_note}</div>` : ""}
    ${bzHoldingNewsHtml(ticker)}
    <section id="drawer-pulse" class="drawer-pulse"></section>
    <section id="drawer-cread" class="drawer-pulse"></section>`;

  renderDrawerPulse(ticker, d.name || (p && p.name) || ticker);
  renderClaudeRead(ticker);
  const drawer = document.getElementById("drawer");
  drawer.hidden = false;
  document.querySelector(".drawer-close").addEventListener("click", closeDrawer);
  document.querySelector(".drawer-bg").addEventListener("click", closeDrawer);
}
function closeDrawer() { document.getElementById("drawer").hidden = true; }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

/* ---------- Social Pulse — live X read via the Grok Worker, ON-DEMAND in the drawer ----------
   A fetch costs a few cents, so it only runs when YOU press the button — never automatically.
   Results are cached for the browser session, so re-opening the same stock is free.            */
const GROK_PROXY = "https://qarp-grok.murshidjaleel-990.workers.dev";
const PULSE_CACHE = {};
const PULSE_HEAD = `<h4 class="pulse-h">Social pulse<span class="pulse-sub">live · X via Grok</span></h4>`;

function renderDrawerPulse(ticker, name) {
  const el = document.getElementById("drawer-pulse");
  if (!el) return;
  const cached = PULSE_CACHE[ticker];
  if (cached) { el.innerHTML = PULSE_HEAD + pulseBodyHtml(cached.data, cached.ts); }
  else {
    el.innerHTML = PULSE_HEAD
      + `<button type="button" class="pulse-btn" data-act="get">Get live read from X</button>`
      + `<div class="pulse-note">Reads X right now via Grok · a few cents per read · social signal, not advice</div>`;
  }
  wirePulse(ticker, name);
}

function wirePulse(ticker, name) {
  const el = document.getElementById("drawer-pulse");
  if (el) el.querySelectorAll("[data-act='get']").forEach((b) =>
    b.addEventListener("click", () => fetchPulse(ticker, name)));
}

async function fetchPulse(ticker, name) {
  const el = document.getElementById("drawer-pulse");
  if (!el) return;
  el.innerHTML = PULSE_HEAD + `<div class="pulse-loading"><span class="pulse-spin"></span>Reading X…</div>`;
  const fail = () => { el.innerHTML = PULSE_HEAD + `<div class="pulse-err">Couldn't reach X right now. <button type="button" class="pulse-link" data-act="get">Try again</button></div>`; wirePulse(ticker, name); };
  try {
    const res = await fetch(GROK_PROXY, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: ticker, name }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j || j.error || !j.pulse) return fail();
    PULSE_CACHE[ticker] = { data: j.pulse, ts: Date.now() };
    el.innerHTML = PULSE_HEAD + pulseBodyHtml(j.pulse, Date.now());
    wirePulse(ticker, name);
  } catch (e) { fail(); }
}

function pulseBodyHtml(p, ts) {
  const lbl = p.sentiment_label || "Neutral";
  const cls = /bull/i.test(lbl) ? "pos" : /bear/i.test(lbl) ? "neg" : "muted";
  const score = p.sentiment_score != null ? Math.max(0, Math.min(100, Math.round(p.sentiment_score))) : 50;
  const vol = p.posts_24h != null ? ` · ${fmtNum(p.posts_24h, 0)} posts/24h` : "";
  const posts = (Array.isArray(p.posts) ? p.posts : []).filter((x) => x && x.handle).slice(0, 3);
  const postsHtml = posts.length
    ? posts.map((x) => `<div class="pulse-post"><span class="pulse-handle">${esc(x.handle)}</span> ${esc(x.text || "")}</div>`).join("")
    : `<div class="pulse-quiet">X is quiet on this name right now.</div>`;
  return `
    <div class="pulse-top">
      <span class="pulse-score ${cls}">${esc(lbl)} · ${score}</span>
      <span class="pulse-buzz">${esc(p.buzz || "")}${vol}</span>
    </div>
    <div class="pulse-bar"><div class="pulse-fill ${cls}" style="width:${score}%"></div></div>
    ${p.theme ? `<div class="pulse-theme">${esc(p.theme)}</div>` : ""}
    <div class="pulse-posts">${postsHtml}</div>
    <div class="pulse-foot">Fetched ${pulseAgo(ts)} · social signal, not advice · <button type="button" class="pulse-link" data-act="get">refresh</button></div>`;
}

function pulseAgo(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  return m <= 0 ? "just now" : m === 1 ? "1 min ago" : `${m} min ago`;
}

/* ---------- Claude's read — on-demand bull / bear / what-would-change-it in the drawer ----------
   Reuses the qarp-bot Worker (Anthropic). Button-gated, session-cached, grounded ONLY in this
   page's data. If the Grok social pulse was already fetched for this name, it's folded in.        */
const CREAD_CACHE = {};
const CREAD_HEAD = `<h4 class="pulse-h">Claude's read<span class="pulse-sub">bull · bear · what changes it</span></h4>`;

function renderClaudeRead(ticker) {
  const el = document.getElementById("drawer-cread");
  if (!el) return;
  const cached = CREAD_CACHE[ticker];
  if (cached) el.innerHTML = CREAD_HEAD + creadBodyHtml(cached.data, cached.ts);
  else el.innerHTML = CREAD_HEAD
    + `<button type="button" class="pulse-btn cread-btn" data-cact="get">Get Claude's read</button>`
    + `<div class="pulse-note">Bull case · bear case · what would change the call — grounded in this page's data</div>`;
  wireCread(ticker);
}
function wireCread(ticker) {
  const el = document.getElementById("drawer-cread");
  if (el) el.querySelectorAll("[data-cact='get']").forEach((b) => b.addEventListener("click", () => fetchClaudeRead(ticker)));
}
function buildCreadContext(ticker) {
  const u = (DATA.universe || []).find((x) => x.ticker === ticker) || {};
  const p = (DATA.portfolio || []).find((x) => x.ticker === ticker);
  const S = (typeof SIGNALS !== "undefined" && SIGNALS) || {};
  const news = S.holding_news && S.holding_news[ticker];
  const pulse = PULSE_CACHE[ticker] && PULSE_CACHE[ticker].data;
  return [
    `${ticker} — ${u.name || (p && p.name) || ""}${u.sector ? " · " + u.sector : ""}`,
    `QARP ${fmtNum(u.qarp, 1)} (${u.verdict || "n/a"}); Quality ${u.mech || "?"}/105 [Valuation ${u.val}/25 · Growth ${u.grw}/20 · Moat&Returns ${u.qual}/20 · BalanceSheet ${u.bs}/20 · CapitalAlloc ${u.cap}/20]; DCF ${u.dcf}/5 (5=cheap).`,
    u.gf_value != null ? `GuruFocus fair value ${fmtUSD(u.gf_value, 2)} vs price ${fmtUSD(u.price, 2)}${u.day_pct != null ? ` (${fmtPct(u.day_pct)} today)` : ""}.` : (u.price != null ? `Price ${fmtUSD(u.price, 2)}.` : ""),
    u.dcf_note ? `Valuation/thesis note: ${String(u.dcf_note).replace(/<[^>]+>/g, "")}` : "",
    u.shariah_grade ? `Shariah (Musaffa): ${u.shariah_grade}.` : "",
    u.catalyst ? `Catalyst (shadow factor): ${u.catalyst.label} — ${u.catalyst.note || ""}` : "",
    u.insider ? `Insider activity: ${u.insider}.` : "",
    u.mktcap_b != null ? `Market cap ~$${fmtNum(u.mktcap_b, 1)}B.` : "",
    news && news.title ? `Latest headline (Benzinga): ${news.title}` : "",
    p ? `User OWNS this: ${fmtNum(p.shares, 2)} sh, ${fmtPct(p.gain_pct)} unrealized.` : "Not currently held.",
    pulse ? `Live X social pulse: ${pulse.sentiment_label} ${pulse.sentiment_score}/100, buzz ${pulse.buzz}. ${pulse.theme || ""}` : "",
  ].filter(Boolean).join("\n");
}
async function fetchClaudeRead(ticker) {
  const el = document.getElementById("drawer-cread");
  if (!el) return;
  el.innerHTML = CREAD_HEAD + `<div class="pulse-loading"><span class="pulse-spin"></span>Claude is reading…</div>`;
  const fail = () => { el.innerHTML = CREAD_HEAD + `<div class="pulse-err">Couldn't get the read right now. <button type="button" class="pulse-link" data-cact="get">Try again</button></div>`; wireCread(ticker); };
  if (!BOT_PROXY || BOT_PROXY.includes("YOUR-WORKER")) return fail();
  const system = "You are a sharp, skeptical equity analyst for an informed investor whose rule is to challenge the consensus and triangulate sources. Using ONLY the data provided, write a tight read: a BULL case, a BEAR case, and the SINGLE most important thing that would change the call. 2-3 sentences each, concrete and grounded — NEVER invent a number, fact, or event not in the data. Translate scores into plain investment reasoning; no jargon dumps. Informational only, not advice. Return ONLY a JSON object, no prose or code fences: {\"bull\":\"\",\"bear\":\"\",\"change\":\"\"}.";
  const user = `Write the read for ${ticker}.\n\nDATA:\n${buildCreadContext(ticker)}`;
  try {
    const res = await fetch(BOT_PROXY, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ system, messages: [{ role: "user", content: user }] }) });
    if (!res.ok || !res.body) return fail();
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "", acc = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const dts = line.slice(5).trim();
        if (!dts || dts === "[DONE]") continue;
        try { const ev = JSON.parse(dts); if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") acc += ev.delta.text; } catch (e) {}
      }
    }
    const a = acc.indexOf("{"), b = acc.lastIndexOf("}");
    if (a < 0 || b <= a) return fail();
    const data = JSON.parse(acc.slice(a, b + 1));
    if (!data.bull && !data.bear) return fail();
    CREAD_CACHE[ticker] = { data, ts: Date.now() };
    el.innerHTML = CREAD_HEAD + creadBodyHtml(data, Date.now());
    wireCread(ticker);
  } catch (e) { fail(); }
}
function creadBodyHtml(d, ts) {
  const blk = (lbl, txt, cls) => txt ? `<div class="cread-blk ${cls}"><span class="cread-lbl">${lbl}</span><p>${esc(txt)}</p></div>` : "";
  return blk("Bull case", d.bull, "bull") + blk("Bear case", d.bear, "bear") + blk("What would change it", d.change, "chg")
    + `<div class="pulse-foot">Claude · grounded in this page's data · not advice · <button type="button" class="pulse-link" data-cact="get">refresh</button></div>`;
}

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

// (The standalone calls-log table was removed — per-name call history now lives in the
// "Calls" column on the Universe and Portfolio tables.)

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
    <div class="sc-grid">${cards}</div>`;
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
      if (t.dataset.tab === "daily") enterDaily(); else leaveDaily();
      if (t.dataset.tab === "universe") resumeUniverseCycler(); else pauseUniverseCycler();
    }));
}

/* ---------- Daily: newspaper-style market front page (data-driven v1) ---------- */
let dailyTimer = null;
function enterDaily() {
  renderDaily();
  if (dailyTimer) clearInterval(dailyTimer);
  dailyTimer = setInterval(() => { renderDailyTicker(); loadDailyBrief(); loadSignals(); }, 5 * 60000); // refresh ticker + re-pull the brief + signals
}
function leaveDaily() { if (dailyTimer) { clearInterval(dailyTimer); dailyTimer = null; } }

function renderDaily() {
  const fEl = document.getElementById("paper-folio-meta");
  if (!fEl) return;
  const now = new Date();
  const fullDate = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(now).toUpperCase();
  const doy = Math.ceil((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  fEl.textContent = `VOL. I · No. ${doy} · NEW YORK, ${fullDate} (ET) · LATE MARKET EDITION`;

  const uni = (DATA.universe || []).filter((x) => x.day_pct != null);
  const port = (DATA.portfolio || []).filter((h) => h.day_pct != null);
  const secMoves = () => {
    const by = {};
    uni.forEach((x) => { const s = sectorGroup(x.sector); (by[s] = by[s] || []).push(x.day_pct); });
    return Object.entries(by).map(([s, a]) => ({ s, avg: a.reduce((p, q) => p + q, 0) / a.length })).sort((a, b) => b.avg - a.avg);
  };

  // Lead — The Market Today
  if (uni.length) {
    const ups = uni.filter((x) => x.day_pct > 0).length, downs = uni.filter((x) => x.day_pct < 0).length;
    const sorted = [...uni].sort((a, b) => b.day_pct - a.day_pct), g = sorted[0], l = sorted[sorted.length - 1];
    const sm = secMoves(), best = sm[0], worst = sm[sm.length - 1];
    const tone = ups > downs * 1.3 ? "broadly higher" : downs > ups * 1.3 ? "broadly lower" : "mixed";
    document.getElementById("paper-lead").innerHTML =
      `<div class="lead-kicker">The Market Today</div>`
      + `<h2 class="lead-head">Shariah universe trades ${tone}; ${esc(best.s)} leads, ${esc(worst.s)} lags</h2>`
      + `<div class="lead-byline">By The Market Desk · live data</div>`
      + `<p class="lead-body">The ${uni.length}-name Shariah-compliant universe traded <b>${tone}</b> today — <b class="pos">${ups} advancing</b>, <b class="neg">${downs} declining</b>. <b>${esc(best.s)}</b> was the strongest sector on average (<span class="${signClass(best.avg)}">${fmtPct(best.avg)}</span>), while <b>${esc(worst.s)}</b> was the weakest (<span class="${signClass(worst.avg)}">${fmtPct(worst.avg)}</span>). ${esc(g.name || g.ticker)} (${esc(g.ticker)}) led all names at <span class="pos">${fmtPct(g.day_pct)}</span>; ${esc(l.name || l.ticker)} (${esc(l.ticker)}) fell <span class="neg">${fmtPct(l.day_pct)}</span>. QARP rankings re-rate on these price moves; the hand-scored verdicts change only on a fundamentals re-score.</p>`;
  }
  // Your Portfolio Today
  if (port.length) {
    const todayUsd = port.reduce((a, h) => a + (h.value || 0) * (h.day_pct || 0) / 100, 0);
    const acct = (DATA.meta.portfolio_totals || {}).account || 0, todayPct = acct ? todayUsd / acct * 100 : 0;
    const pUp = port.filter((h) => h.day_pct > 0).length, pDown = port.filter((h) => h.day_pct < 0).length;
    const ps = [...port].sort((a, b) => b.day_pct - a.day_pct);
    const mv = (h) => `<li><span class="mv-tk">${esc(h.ticker)}</span><span class="${signClass(h.day_pct)}">${fmtPct(h.day_pct)}</span></li>`;
    document.getElementById("paper-portfolio").innerHTML =
      `<div class="side-head">Jaleel's Portfolio Today</div>`
      + `<p class="side-body">Jaleel's book is <b class="${signClass(todayPct)}">${todayPct >= 0 ? "up" : "down"} ${fmtPct(Math.abs(todayPct))}</b> (${todayUsd >= 0 ? "+" : "−"}${fmtUSD(Math.abs(todayUsd), 0)}) on the day — ${pUp} green, ${pDown} red.</p>`
      + `<ul class="mv-list">${ps.slice(0, 3).map(mv).join("")}${ps.slice(-2).reverse().map(mv).join("")}</ul>`;
  }
  // Sector Watch
  if (uni.length) {
    document.getElementById("paper-sectors").innerHTML =
      `<div class="side-head">Sector Watch <span class="side-sub">today</span></div>`
      + `<ul class="mv-list">${secMoves().map((m) => `<li><span class="mv-tk">${esc(m.s)}</span><span class="${signClass(m.avg)}">${fmtPct(m.avg)}</span></li>`).join("")}</ul>`;
  }
  // Movers
  if (uni.length) {
    const sorted = [...uni].sort((a, b) => b.day_pct - a.day_pct);
    const row = (x) => `<li><span class="mv-tk">${esc(x.ticker)}</span><span class="${signClass(x.day_pct)}">${fmtPct(x.day_pct)}</span></li>`;
    document.getElementById("paper-movers").innerHTML =
      `<div class="side-head">Movers</div>`
      + `<div class="mv-cols"><div><div class="mv-lbl pos">Gainers</div><ul class="mv-list">${sorted.slice(0, 4).map(row).join("")}</ul></div>`
      + `<div><div class="mv-lbl neg">Decliners</div><ul class="mv-list">${sorted.slice(-4).reverse().map(row).join("")}</ul></div></div>`;
  }
  // Number of the Day — NYT-style boxed stat pulled from live data
  const ndEl = document.getElementById("paper-numday");
  if (ndEl && uni.length) {
    const sorted = [...uni].sort((a, b) => b.day_pct - a.day_pct);
    const g = sorted[0];
    const ups = uni.filter((x) => x.day_pct > 0).length, downs = uni.filter((x) => x.day_pct < 0).length;
    ndEl.innerHTML = `<div class="numday-label">Number of the Day</div>`
      + `<div class="numday-fig ${signClass(g.day_pct)}">${fmtPct(g.day_pct)}</div>`
      + `<div class="numday-cap">${esc(g.name || g.ticker)} (${esc(g.ticker)}) led the Shariah universe. Breadth ran <b>${ups}</b> advancing to <b>${downs}</b> declining across ${uni.length} names.</div>`;
  }
  renderDailyTicker();
  loadDailyBrief();    // original lead column + briefs from daily_brief.json (NO external links)
  renderSectorSignals(); // sector-level event-driven signals (uses cached SIGNALS)
  renderLeadMore();    // fills the space under the lead with more market news (catalysts + risk)
}

// "Across the Market" — secondary news column under the lead, built from the live
// event-driven signals (catalysts + risk flags). Self-contained, no external links.
function renderLeadMore() {
  const el = document.getElementById("paper-lead-more");
  if (!el) return;
  const S = (typeof SIGNALS !== "undefined" && SIGNALS) || null;
  const strip = (s) => String(s || "").replace(/<[^>]+>/g, "");
  const items = [];
  ((S && S.catalysts) || []).forEach((c) => items.push({ h: c.what, b: strip(c.why), meta: [c.when, c.affects].filter(Boolean).join(" · ") }));
  ((S && S.risk) || []).forEach((r) => items.push({ h: `${r.ticker} — ${r.tag}`, b: strip(r.detail), meta: r.next ? "Next: " + r.next : "" }));
  const list = items.filter((x) => x.h && x.b).slice(0, 8);
  if (!list.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="lm-rule"></div><div class="lm-head">Across the Market</div><div class="lm-grid">`
    + list.map((it) => `<article class="lm-item"><h3 class="lm-h">${esc(it.h)}</h3><p class="lm-body">${esc(it.b)}</p>${it.meta ? `<div class="lm-meta">${esc(it.meta)}</div>` : ""}</article>`).join("")
    + `</div>`;
}

// The Daily page's written content comes from daily_brief.json — an original market column plus
// short original briefs. Everything is readable on the page; there are no links to click out to.
// (Non-sensitive market commentary — no holdings or dollar figures.)
async function loadDailyBrief() {
  let b = null;
  try {
    const res = await fetch(`daily_brief.json?cb=${Date.now()}`, { cache: "no-store" });
    if (res.ok) b = await res.json();
  } catch (e) { /* fall back gracefully */ }
  const fresh = !!(b && b.date && DATA.meta && b.date >= DATA.meta.date);
  if (fresh && b.body_html) {
    const el = document.getElementById("paper-lead");
    if (el) el.innerHTML = `<div class="lead-kicker">${esc(b.kicker || "The Market Today")}</div>`
      + `<h2 class="lead-head">${esc(b.headline || "")}</h2>`
      + `<div class="lead-byline">By The Market Desk${b.generated_at ? " · " + esc(b.generated_at) : ""}</div>`
      + `<div class="lead-body">${b.body_html}</div>`;
  }
  renderBriefs(fresh && Array.isArray(b.briefs) ? b.briefs : null);
}

// Always-fresh briefs built from live data (sector signals + universe breadth/movers + catalysts),
// used whenever the routine-written briefs aren't current — so the section is NEVER empty/stale.
function autoBriefs() {
  const strip = (s) => (s || "").replace(/<[^>]+>/g, "");
  const out = [];
  const S = (typeof SIGNALS !== "undefined" && SIGNALS) ? SIGNALS : null;
  if (S && Array.isArray(S.sectors)) {
    S.sectors.slice(0, 3).forEach((s) => {
      const tone = s.dir === "up" ? "trading higher" : s.dir === "down" ? "trading lower" : "mixed";
      out.push({ headline: `${s.sector} ${tone}`, body: strip(s.note) || strip(s.driver) });
    });
  }
  const uni = (DATA.universe || []).filter((x) => x.day_pct != null);
  if (uni.length) {
    const ups = uni.filter((x) => x.day_pct > 0).length, downs = uni.filter((x) => x.day_pct < 0).length;
    const by = {};
    uni.forEach((x) => { const g = sectorGroup(x.sector); (by[g] = by[g] || []).push(x.day_pct); });
    const sm = Object.entries(by).map(([s, a]) => ({ s, avg: a.reduce((p, q) => p + q, 0) / a.length })).sort((a, b) => b.avg - a.avg);
    if (sm.length) out.push({ headline: `Breadth: ${ups} up, ${downs} down`, body: `Across the ${uni.length}-name Shariah universe, ${sm[0].s} led on average (${fmtPct(sm[0].avg)}) while ${sm[sm.length - 1].s} lagged (${fmtPct(sm[sm.length - 1].avg)}).` });
    const sorted = [...uni].sort((a, b) => b.day_pct - a.day_pct), g = sorted[0], l = sorted[sorted.length - 1];
    out.push({ headline: `${g.ticker} ${fmtPct(g.day_pct)} · ${l.ticker} ${fmtPct(l.day_pct)}`, body: `${g.name || g.ticker} led the board; ${l.name || l.ticker} was the weakest name on the day.` });
  }
  if (S && Array.isArray(S.catalysts) && S.catalysts.length) {
    const c = S.catalysts[0];
    out.push({ headline: `On the radar: ${c.what}`, body: strip(c.why) });
  }
  return out.filter((b) => b.headline && b.body);
}

// Briefs: routine-written when fresh, else auto-built from live data (never the stale placeholder).
function renderBriefs(briefs) {
  const el = document.getElementById("paper-wire");
  if (!el) return;
  let auto = false;
  if (!Array.isArray(briefs) || !briefs.length) { briefs = autoBriefs(); auto = true; }
  if (!briefs.length) { el.innerHTML = `<div class="wire-head">Market Briefs</div><p class="muted">Live market briefs update through the session.</p>`; return; }
  el.innerHTML = `<div class="wire-head">Market Briefs${auto ? ` <span class="wire-auto">live data</span>` : ""}</div><div class="wire-grid">` + briefs.map((br) =>
    `<article class="wire-item"><h4 class="wire-h">${esc(br.headline || "")}</h4><p class="wire-sum">${esc(br.body || "")}</p></article>`).join("") + `</div>`;
}

/* ---------- Signals — event-driven (news / geopolitics), no price triggers ---------- */
// Content comes from signals.json (fetched plaintext, like daily_brief.json). Every signal
// is justified by a real news event or geopolitical factor — the WHEN is when the event lands,
// the WHY is the event itself. No price levels, no buy/sell instructions. Portfolio tab gets
// macro + per-holding risk + upcoming catalysts; the Daily page gets the sector signals.
let SIGNALS = null;
const SEV_LABEL = { elevated: "Elevated", watch: "Watch", policy: "Policy", mild: "Mild" };
const DIR_ICON = { up: "ti-trending-up", down: "ti-trending-down", "two-sided": "ti-arrows-up-down", mixed: "ti-arrows-up-down" };
const DIR_LABEL = { up: "Tailwind", down: "Headwind", "two-sided": "Two-sided", mixed: "Mixed" };

async function loadSignals() {
  try {
    const res = await fetch(`signals.json?cb=${Date.now()}`, { cache: "no-store" });
    if (res.ok) SIGNALS = await res.json();
  } catch (e) { /* fall back gracefully */ }
  renderSignals();
  renderSectorSignals();
  renderRatings();
  renderBriefing();
  renderEarnings();
  renderCalls();
  renderLeadMore();
}

function renderSignals() {
  const el = document.getElementById("signals-card");
  if (!el) return;
  if (!SIGNALS) { el.innerHTML = `<div class="muted sig-empty">Signals load with the Portfolio tab — check back shortly.</div>`; return; }
  const s = SIGNALS;
  const riskRows = (s.risk || []).map(sigRiskRow).join("");
  const catRows = (s.catalysts || []).map(sigCatalystRow).join("");
  el.innerHTML = `
    <div class="sig-head">
      <div class="sig-kicker">Signals</div>
      <div class="sig-asof">${esc(s.generated_at || asOfDate(s.date))} · news-driven</div>
    </div>
    <div class="sig-title">What's moving Jaleel's book — and the events that decide it</div>
    ${s.macro ? `<div class="sig-macro"><i class="ti ti-broadcast" aria-hidden="true"></i><div><b>Macro:</b> ${s.macro.body || esc(s.macro.headline || "")}</div></div>` : ""}
    <div class="sig-sec-label"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Risk radar — Jaleel's holdings</div>
    <div class="sig-rows">${riskRows || `<div class="muted sig-empty">No risk flags.</div>`}</div>
    <div class="sig-sec-label up"><i class="ti ti-calendar-event" aria-hidden="true"></i> Catalysts ahead — the news that could move it</div>
    <div class="sig-rows">${catRows || `<div class="muted sig-empty">No catalysts queued.</div>`}</div>
    <div class="sig-foot"><i class="ti ti-info-circle" aria-hidden="true"></i> Every signal is tied to a real news event or geopolitical factor — informational, not predictions or advice. No price targets.${s.sources ? ` <span class="sig-src">Sources: ${esc(s.sources)}.</span>` : ""}</div>`;
}

function sigRiskRow(r) {
  const held = DATA.portfolio.find((h) => h.ticker === r.ticker);
  const sub = held ? `${fmtNum(held.shares, 2)} sh` : (r.sub || "cluster");
  return `<div class="sig-row sev-${r.sev}">
    <div class="sig-tk"><span class="tk">${esc(r.ticker)}</span><span class="sig-sh">${esc(sub)}</span></div>
    <div class="sig-mid">
      <div class="sig-l1"><span class="sig-tag t-${r.sev}">${SEV_LABEL[r.sev] || r.sev}</span><span class="sig-flag">${esc(r.tag || "")}</span></div>
      <div class="sig-detail">${r.detail || ""}</div>
    </div>
    <div class="sig-next"><span class="nlbl">Next</span><span class="nval">${esc(r.next || "—")}</span></div>
  </div>`;
}

// A catalyst = a dated/identified news or geopolitical event + its read-through. No price levels.
function sigCatalystRow(c) {
  const dir = c.dir || "two-sided";
  return `<div class="sig-row cat dir-${dir}">
    <div class="sig-when"><i class="ti ${DIR_ICON[dir] || "ti-arrows-up-down"}" aria-hidden="true"></i><span class="cat-when">${esc(c.when || "")}</span></div>
    <div class="sig-mid">
      <div class="sig-l1"><span class="cat-what">${esc(c.what || "")}</span>${c.affects ? `<span class="cat-affects">${esc(c.affects)}</span>` : ""}<span class="cat-dir d-${dir}">${DIR_LABEL[dir] || dir}</span></div>
      <div class="sig-detail">${esc(c.why || "")}</div>
    </div>
  </div>`;
}

// Daily page: sector-level signals, each driven by a news / geopolitical factor.
function renderSectorSignals() {
  const el = document.getElementById("paper-signals");
  if (!el) return;
  const secs = (SIGNALS && SIGNALS.sectors) || [];
  if (!secs.length) { el.innerHTML = ""; return; }
  const cards = secs.map((s) => {
    const dir = s.dir || "mixed";
    return `<article class="ssig-card dir-${dir}">
      <div class="ssig-top"><i class="ti ${DIR_ICON[dir] || "ti-arrows-up-down"}" aria-hidden="true"></i><span class="ssig-name">${esc(s.sector || "")}</span><span class="ssig-dir d-${dir}">${DIR_LABEL[dir] || dir}</span></div>
      <div class="ssig-driver">${esc(s.driver || "")}</div>
      <p class="ssig-note">${esc(s.note || "")}</p>
      ${s.src ? `<div class="ssig-src"><i class="ti ti-circle-check" aria-hidden="true"></i>${esc(s.src)}</div>` : ""}
    </article>`;
  }).join("");
  const src = (SIGNALS && SIGNALS.sources) ? `<div class="ssig-foot">${esc(SIGNALS.sources)}</div>` : "";
  el.innerHTML = `<div class="side-head">Sector Signals <span class="side-sub">why, not just how much</span></div>`
    + `<div class="ssig-grid">${cards}</div>${src}`;
}

// Drawer: latest Benzinga "why is it moving" / news for a held name (server-baked, fresh only).
function bzHoldingNewsHtml(ticker) {
  const hn = SIGNALS && SIGNALS.holding_news && SIGNALS.holding_news[ticker];
  if (!hn || !hn.title) return "";
  return `<h4>Latest headline <span class="bz-tag">Benzinga</span></h4>`
    + `<a class="bz-news" href="${esc(safeUrl(hn.url))}" target="_blank" rel="noopener noreferrer">`
    + `${hn.wiim ? `<span class="bz-wiim">Why it's moving</span> ` : ""}${esc(hn.title)} `
    + `<span class="bz-time">${relTime(hn.ts)}</span></a>`;
}

// Benzinga news (server-baked) mapped into the shared news-feed shape, for multi-source merge.
function bzFeed({ tickers = null, relOnly = false } = {}) {
  const arr = (SIGNALS && SIGNALS.bz_news) || [];
  return arr
    .filter((n) => n.title && n.url && (!relOnly || n.rel) && (!tickers || (n.tickers || []).some((t) => tickers.has(t))))
    .map((n) => ({ headline: n.title, url: n.url, source: "Benzinga", datetime: n.ts, image: "",
                   _tk: tickers ? (n.tickers || []).find((t) => tickers.has(t)) : null }));
}
function mergeNews(primary, extra) {
  const seen = new Set();
  const all = [...primary, ...extra].filter((it) => it && it.url && !seen.has(it.url) && seen.add(it.url));
  all.sort((a, b) => (b.datetime || 0) - (a.datetime || 0));
  return all;
}

// Analyst-Ratings feed (Stay Informed subtab) — Benzinga, your holdings/universe flagged.
// Per-holding Briefing: analyst consensus (Finnhub) + SEC filings (EDGAR) + news (Benzinga) + QARP.
function consClass(label) {
  const l = (label || "").toLowerCase();
  return l.includes("sell") ? "bear" : l.includes("buy") ? "bull" : "neutral";
}
function renderBriefing() {
  const el = document.getElementById("briefing-list");
  if (!el) return;
  const pb = (SIGNALS && SIGNALS.portfolio_brief) || {};
  if (!Object.keys(pb).length) { el.innerHTML = `<p class="muted">The briefing loads with the daily signals run — check back shortly.</p>`; return; }
  const holds = [...DATA.portfolio].sort((a, b) => (b.value || 0) - (a.value || 0));
  const filLink = (x, label) => x ? `<a href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener noreferrer" class="bf-fil">${esc(label)} <span class="bf-fdate">${esc(x.date)}</span></a>` : "";
  el.innerHTML = holds.map((h) => {
    const b = pb[h.ticker];
    if (!b) return "";
    const c = b.consensus, f = b.filings;
    let bar = "";
    if (c && c.total) {
      const w = (n) => (n / c.total * 100).toFixed(1);
      bar = `<div class="bf-bar" title="${c.bullish} bullish · ${c.hold} hold · ${c.bearish} bearish">
        ${c.bullish ? `<span class="bf-b" style="width:${w(c.bullish)}%"></span>` : ""}
        ${c.hold ? `<span class="bf-h" style="width:${w(c.hold)}%"></span>` : ""}
        ${c.bearish ? `<span class="bf-n" style="width:${w(c.bearish)}%"></span>` : ""}</div>`;
    }
    const news = b.news && b.news.title
      ? `<a class="bf-news" href="${esc(safeUrl(b.news.url))}" target="_blank" rel="noopener noreferrer">${b.news.wiim ? `<span class="bz-wiim">Why it's moving</span> ` : ""}${esc(b.news.title)} <span class="bz-time">${relTime(b.news.ts)}</span></a>`
      : "";
    const hasFil = f && (f.periodic || f.latest8k || f.insider30d);
    return `<article class="bf-card">
      <div class="bf-head">
        <span class="bf-tk">${esc(h.ticker)}</span>
        <span class="bf-name">${esc(b.name || "")}</span>
        ${b.qarp ? verdictBadge(b.qarp) : ""}
        <span class="bf-day ${signClass(h.day_pct)}">${fmtPct(h.day_pct)}</span>
      </div>
      ${c ? `<div class="bf-cons">
        <div class="bf-cons-top"><span class="bf-clabel ${consClass(c.label)}">Analysts: ${esc(c.label)}</span>
        <span class="bf-ccount"><b class="pos">${c.bullish}</b> bullish · ${c.hold} hold · <b class="neg">${c.bearish}</b> bearish <span class="muted">of ${c.total}</span></span></div>
        ${bar}</div>` : `<div class="bf-cons muted">No analyst-consensus data.</div>`}
      ${hasFil ? `<div class="bf-sec"><span class="bf-sec-l"><i class="ti ti-file-text" aria-hidden="true"></i> SEC filings</span>
        ${filLink(f.periodic, f.periodic ? f.periodic.form : "")}${filLink(f.latest8k, "8-K")}
        ${f.insider30d ? `<span class="bf-insider" title="Form 4 insider transactions, last 30 days">${f.insider30d} insider filings (30d)</span>` : ""}</div>` : ""}
      ${news ? `<div class="bf-newswrap">${news}</div>` : ""}
      ${b.explain ? `<p class="bf-explain">${b.explain}</p>` : ""}
    </article>`;
  }).join("");
}

// Smart Money — notable investors' latest 13F holdings (SEC EDGAR), fetched like signals.json.
let GURUS = null;
async function loadGurus() {
  try {
    const res = await fetch(`gurus.json?cb=${Date.now()}`, { cache: "no-store" });
    if (res.ok) GURUS = await res.json();
  } catch (e) { /* graceful */ }
  renderGurus();
}
function renderGurus() {
  const el = document.getElementById("gurus-list");
  if (!el) return;
  if (!GURUS || !(GURUS.funds || []).length) { el.innerHTML = `<p class="muted">Smart-money holdings load shortly — refreshed weekly from SEC 13F filings.</p>`; return; }
  const fdate = (d) => { try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch (e) { return d; } };
  const banner = `<div class="gu-caveat"><i class="ti ti-alert-triangle" aria-hidden="true"></i><div><b>Read this first:</b> ${esc(GURUS.disclaimer || "")}</div></div>`;
  const cards = GURUS.funds.map((f) => {
    const rows = (f.holdings || []).map((h) => `<div class="gu-row">
      <div class="gu-bar"><span style="width:${Math.min(100, h.pct)}%"></span></div>
      <div class="gu-nm"><span class="gu-nmtxt">${esc(h.name)}</span>${h.overlap ? `<span class="gu-own">you own ${esc(h.overlap)}</span>` : ""}</div>
      <div class="gu-pct">${h.pct}%</div>
      <div class="gu-val">${esc(h.value)}</div>
    </div>`).join("");
    return `<article class="gu-card">
      <div class="gu-head">
        <div><span class="gu-mgr">${esc(f.manager)}</span><span class="gu-fund">${esc(f.fund)}</span></div>
        <a class="gu-link" href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener noreferrer">13F <i class="ti ti-external-link" aria-hidden="true"></i></a>
      </div>
      ${f.blurb ? `<p class="gu-blurb">${esc(f.blurb)}</p>` : ""}
      <div class="gu-meta"><span class="gu-period">Q${esc(quarterOf(f.period))} · ${esc(f.period)}</span><span class="gu-lag">filed ${esc(fdate(f.filed))}</span><span>${f.positions} positions</span><span>${esc(f.total)} disclosed</span></div>
      <div class="gu-holdings">${rows}</div>
    </article>`;
  }).join("");
  el.innerHTML = banner + `<div class="gu-grid">${cards}</div>`;
}
function quarterOf(period) {
  try { const m = +period.slice(5, 7); return Math.ceil(m / 3); } catch (e) { return "?"; }
}

// ---- Daily call: Add / Hold / Trim per holding (transparent rule, not opinion) ----
// Combines three independent inputs already on the site: QARP verdict + analyst consensus
// (Finnhub) + any news risk flag. Scored, thresholded — every input is shown in the reason.
function riskSevFor(tk) {
  for (const r of ((SIGNALS && SIGNALS.risk) || [])) {
    const tks = (r.ticker || "").split("·").map((x) => x.trim());
    const subTks = (r.sub || "").match(/[A-Z]{2,5}/g) || [];
    if (tks.includes(tk) || subTks.includes(tk)) return r.sev;
  }
  return null;
}
function holdingCall(tk) {
  const pb = (SIGNALS && SIGNALS.portfolio_brief && SIGNALS.portfolio_brief[tk]) || {};
  const qarp = pb.qarp || (DATA.portfolio.find((h) => h.ticker === tk) || {}).verdict || "";
  const cons = pb.consensus || null;
  const sev = riskSevFor(tk);
  const Q = { STRONGEST: 2, "STRONG BUY": 2, BUY: 1, "HOLD-QUAL": 0, AVOID: -2, "STRONG AVOID": -3 };
  const C = { "Strong Buy": 1, Buy: 0.5, Hold: 0, Sell: -1, "Strong Sell": -1.5 };
  const R = { elevated: -1.5, watch: -0.5, policy: -0.5, mild: -0.25 };
  const score = (Q[qarp] ?? 0) + (C[cons && cons.label] ?? 0) + (R[sev] ?? 0);
  let call = score >= 1.5 ? "ADD" : score <= -1.0 ? "TRIM" : "HOLD";
  // conservative override: don't ADD into an elevated news flag or an AVOID, even if cheap
  let capped = false;
  if (call === "ADD" && (sev === "elevated" || qarp === "AVOID" || qarp === "STRONG AVOID")) { call = "HOLD"; capped = true; }
  const bits = [];
  if (qarp) bits.push(`QARP ${qarp}`);
  if (cons && cons.label) bits.push(`analysts ${cons.label}`);
  bits.push(sev ? `${sev} risk flag` : "no risk flags");
  let reason = bits.join(" · ") + ".";
  if (capped) reason += " The news flag caps it at Hold despite the cheap score.";
  return { call, reason, qarp, sev };
}
function renderCalls() {
  const el = document.getElementById("calls-list");
  if (!el) return;
  const pb = (SIGNALS && SIGNALS.portfolio_brief) || {};
  const holds = [...DATA.portfolio].sort((a, b) => (b.value || 0) - (a.value || 0));
  el.innerHTML = holds.map((h) => {
    const c = holdingCall(h.ticker);
    const name = (pb[h.ticker] || {}).name || h.name || h.ticker;
    const cl = c.call.toLowerCase();
    return `<div class="call-row ${cl}">
      <div class="call-tk"><span class="ctk">${esc(h.ticker)}</span><span class="cnm">${esc(name)}</span></div>
      <span class="call-badge ${cl}">${c.call}</span>
      <div class="call-reason">${esc(c.reason)}</div>
    </div>`;
  }).join("");
}

// Per-holding latest reported financials (SEC EDGAR XBRL — official as-filed GAAP numbers).
function renderEarnings() {
  const el = document.getElementById("earnings-list");
  if (!el) return;
  const fn = (SIGNALS && SIGNALS.financials) || {};
  const pb = (SIGNALS && SIGNALS.portfolio_brief) || {};
  if (!Object.keys(fn).length) { el.innerHTML = `<p class="muted">The latest filings load with the daily signals run — check back shortly.</p>`; return; }
  const holds = [...DATA.portfolio].sort((a, b) => (b.value || 0) - (a.value || 0));
  const yoy = (y) => (y == null ? "" : `<span class="er-yoy ${y >= 0 ? "pos" : "neg"}">${y >= 0 ? "+" : ""}${y}% YoY</span>`);
  const stat = (label, val, y) => `<div class="er-stat"><div class="er-l">${label}</div><div class="er-v">${val} ${yoy(y)}</div></div>`;
  const fdate = (d) => { try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch (e) { return d; } };
  el.innerHTML = holds.map((h) => {
    const f = fn[h.ticker];
    const name = (pb[h.ticker] || {}).name || h.ticker;
    if (!f) {
      return `<article class="er-row na"><div class="er-head"><span class="er-tk">${esc(h.ticker)}</span><span class="er-name">${esc(name)}</span></div><div class="er-na">Not available via SEC EDGAR (foreign filer — files 20-F/6-K).</div></article>`;
    }
    const link = f.url
      ? `<a href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener noreferrer" class="er-link">${esc(f.form)} · filed ${esc(fdate(f.filed))} <i class="ti ti-external-link" aria-hidden="true"></i></a>`
      : `<span class="er-link plain">${esc(f.form)} · filed ${esc(fdate(f.filed))}</span>`;
    return `<article class="er-row">
      <div class="er-head"><span class="er-tk">${esc(h.ticker)}</span><span class="er-name">${esc(name)}</span><span class="er-period">${esc(f.period)}</span><span class="er-filed">${link}</span></div>
      <div class="er-stats">
        ${f.revenue ? stat("Revenue", esc(f.revenue.fmt), f.revenue.yoy) : ""}
        ${f.eps ? stat("Diluted EPS", (f.eps.val < 0 ? "−$" + Math.abs(f.eps.val) : "$" + f.eps.val), f.eps.yoy) : ""}
        ${f.net_income ? stat("Net income", esc(f.net_income.fmt), null) : ""}
        ${f.margin != null ? stat("Net margin", f.margin + "%", null) : ""}
      </div>
      <div class="er-note">As reported (GAAP) — may differ from the “adjusted” figures quoted in headlines.</div>
    </article>`;
  }).join("");
}

const STANCE_TXT = { bullish: "Bullish", neutral: "Neutral", bearish: "Bearish" };
function renderRatings() {
  const el = document.getElementById("ratings-list");
  if (!el) return;
  const rows = (SIGNALS && SIGNALS.ratings) || [];
  if (!rows.length) { el.innerHTML = `<p class="muted">No recent analyst calls on Jaleel's holdings or universe names — this refreshes with the daily signals run.</p>`; return; }
  const fmtDate = (d) => { try { const x = new Date(d + "T12:00:00"); return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][x.getMonth()] + " " + x.getDate(); } catch (e) { return d; } };
  el.innerHTML = rows.map((r) => {
    const up = r.upside;
    const sign = up == null ? "flat" : up > 3 ? "pos" : up < -3 ? "neg" : "flat";
    const upTxt = up == null ? "no price target" : `sees ${up >= 0 ? "+" : ""}${up}% from here`;
    const own = r.held ? `<span class="rt-own held">YOU OWN</span>` : r.uni ? `<span class="rt-own uni">universe</span>` : "";
    const pt = r.pt ? `target ${esc(r.pt)} vs ${fmtUSD(r.price, 0)} today` : "";
    return `<div class="rt-row sign-${sign}">
      <div class="rt-head"><span class="rt-tk">${esc(r.ticker)}</span>${own}<span class="rt-date">${fmtDate(r.date)} · ${esc(r.firm || "")} ${esc((r.action || "").toLowerCase())}</span></div>
      <div class="rt-read">
        <span class="rt-stance s-${r.stance}">${STANCE_TXT[r.stance] || r.stance}</span>
        <span class="rt-up ${sign}">${upTxt}</span>
        ${pt ? `<span class="rt-ptline">${pt}</span>` : ""}
      </div>
      ${r.qarp ? `<div class="rt-ours"><span class="rt-ours-l">This site's own view:</span> ${verdictBadge(r.qarp)}</div>` : ""}
    </div>`;
  }).join("");
}

async function renderDailyTicker() {
  const el = document.getElementById("paper-ticker");
  if (!el || !(DATA.meta && DATA.meta.quote_proxy)) return;
  const syms = [{ l: "S&P 500", s: "SPY" }, { l: "Nasdaq", s: "QQQ" }, { l: "Dow", s: "DIA" }];
  const cards = await Promise.all(syms.map(async (ix) => {
    try {
      const q = await fetchQuote(ix.s);
      if (!q || typeof q.dp !== "number") throw 0;
      const up = (q.d || 0) >= 0;
      return `<span class="pt-item"><b>${esc(ix.l)}</b> <span class="${up ? "pos" : "neg"}">${up ? "▲" : "▼"} ${Math.abs(q.dp).toFixed(2)}%</span></span>`;
    } catch (e) { return `<span class="pt-item"><b>${esc(ix.l)}</b> <span class="muted">—</span></span>`; }
  }));
  el.innerHTML = cards.join("");
}


/* ---------- live prices (Finnhub, browser-side) ---------- */
const LIVE_INTERVAL_MS = 60000;  // holdings refresh ~every 60s (≈17 calls/min)
const UNIVERSE_PUMP_MS = 1200;   // 1 universe name per 1.2s (≈50/min); cycles in rank order, so
                                 // the top names you're looking at go live first (~4min full pass)
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
        if (u) {
          u.price = q.c; if (typeof q.dp === "number") u.day_pct = +q.dp.toFixed(2);
          if (u.mom) patchGateCells(h.ticker, u);   // gate re-evaluates on the live price
        }
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
      if (u) {
        u.price = q.c; if (typeof q.dp === "number") u.day_pct = +q.dp.toFixed(2);
        if (u.mom) patchGateCells(ticker, u);   // live gate re-check on every sweep
      }
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
// Only surface news from trusted, freely-accessible financial sources — no paywalls / sign-up walls
// (Bloomberg, WSJ, FT, Barron's, Seeking Alpha are excluded; they gate articles behind a login).
// Two checks because Finnhub gives DIRECT urls for general news but finnhub.io REDIRECTS for
// company news (real publisher only in the `source` field) — so we match domain OR source name.
const TRUSTED_NEWS_DOMAINS = [
  "reuters.com", "apnews.com", "cnbc.com", "yahoo.com", "marketwatch.com", "fool.com",
  "investing.com", "benzinga.com", "forbes.com", "nasdaq.com", "zacks.com", "kiplinger.com",
  "thestreet.com", "barchart.com", "prnewswire.com", "globenewswire.com", "businesswire.com",
];
const TRUSTED_NEWS_SOURCES = [
  "reuters", "associated press", "cnbc", "yahoo", "marketwatch", "motley fool", "fool",
  "investing.com", "benzinga", "forbes", "nasdaq", "zacks", "kiplinger", "thestreet",
  "barchart", "chartmill", "pr newswire", "prnewswire", "globenewswire", "business wire", "businesswire",
];
function newsDomain(u) {
  try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch (e) { return ""; }
}
function isTrustedSource(it) {
  const d = newsDomain(it.url);
  if (TRUSTED_NEWS_DOMAINS.some((t) => d === t || d.endsWith("." + t))) return true;
  const s = (it.source || "").toLowerCase();
  return TRUSTED_NEWS_SOURCES.some((t) => s.includes(t));
}

// RELEVANCE gate for the broad "general" feed (it mixes in lifestyle/culture stories that have
// nothing to do with markets). Keep ONLY items that carry a real market/finance/economics signal,
// and hard-drop a few unambiguous non-finance topics. Company-news (per-ticker) skips this — it's
// already relevant by definition.
const NEWS_OFFTOPIC = /\b(romance novel|gay romance|love stor|horoscope|astrology|zodiac|recipe|celebrity|kardashian|royal wedding|dating app|skincare|makeup|fashion week|red carpet|box office|gift guide)\b/i;
const NEWS_FINANCE = /(\bstocks?\b|\bshares?\b|\bmarket|nasdaq|dow jones|s&p|\bindex(es)?\b|earnings|revenue|profit|guidance|dividend|\bipo\b|merger|acquisition|buyout|federal reserve|\bfed\b|interest rate|rate (cut|hike)|inflation|\bcpi\b|\bppi\b|\bgdp\b|jobs report|payrolls?|unemployment|tariff|crude|oil price|\bbond|\byield|treasury|\bdollar\b|\bcrypto|bitcoin|analyst|upgrade|downgrade|price target|quarterly|sec filing|buyback|layoffs?|valuation|hedge fund|\betf\b|wall street|econom(y|ic|ics)|recession|stimulus|deficit|billion|trillion|\$[0-9]|\b[0-9]+%)/i;
function isMarketRelevant(it) {
  const t = ((it.headline || "") + " " + (it.summary || "")).toLowerCase();
  if (NEWS_OFFTOPIC.test(t)) return false;
  return NEWS_FINANCE.test(t);
}

// split items into photo cards + headline rows (shared by Stay Informed and Portfolio news)
function renderNewsFeed(container, items, emptyLabel) {
  items = items.filter((it) => it && it.headline && it.url && isTrustedSource(it));
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
  if (!list) return;
  list.innerHTML = `<p class="news-loading">Loading headlines…</p>`;
  const f = NEWS_FILTERS.find((x) => x.name === newsFilter) || NEWS_FILTERS[0];

  // BACKBONE: Benzinga is finance-only and server-baked — no key, never blanks the feed.
  const bz = f.sym ? bzFeed({ tickers: new Set([f.sym]) }) : bzFeed({}).slice(0, 50);

  // BREADTH (best-effort): Finnhub adds Reuters/AP/etc. General/sector feeds are relevance-gated;
  // company-news is already on-ticker. A Finnhub failure must NOT hide the Benzinga backbone.
  let items = [];
  const key = DATA.meta && DATA.meta.finnhub_key;
  if (key) {
    let url;
    if (f.cat) url = `https://finnhub.io/api/v1/news?category=${f.cat}&token=${key}`;
    else {
      const now = new Date(), to = now.toISOString().slice(0, 10);
      const from = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
      url = `https://finnhub.io/api/v1/company-news?symbol=${f.sym}&from=${from}&to=${to}&token=${key}`;
    }
    try {
      const raw = await fetch(url, { cache: "no-store" }).then((r) => r.json());
      if (Array.isArray(raw)) {
        items = raw.filter((it) => it && it.headline && it.url);
        if (f.cat) items = items.filter(isMarketRelevant);   // drop the general feed's lifestyle noise
        items = items.slice(0, 30);
      }
    } catch (e) { /* keep the Benzinga backbone */ }
  }
  renderNewsFeed(list, mergeNews(bz, items), `No recent headlines for ${newsFilter}.`);
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
  document.querySelectorAll("#i-subtabs .subtab").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#i-subtabs .subtab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll("#tab-informed .isub").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById("isub-" + b.dataset.isub).classList.add("active");
      if (b.dataset.isub === "ratings") renderRatings();
    }));
}

/* ---------- Portfolio sub-tabs: News + Key Dates ---------- */
let pNewsLoaded = false, pDatesLoaded = false;

async function loadPortfolioNews() {
  const key = DATA.meta && DATA.meta.finnhub_key;   // company-news calls Finnhub directly
  const list = document.getElementById("pnews-list");
  if (!list) return;
  if (!key) { list.innerHTML = `<p class="muted">Live news needs the API key.</p>`; return; }
  list.innerHTML = `<p class="news-loading">Loading Jaleel's holdings' news…</p>`;
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
  // multi-source: blend in Benzinga items tagged to a holding
  const bz = bzFeed({ tickers: new Set(DATA.portfolio.map((h) => h.ticker)) });
  merged = mergeNews(merged, bz);
  renderNewsFeed(list, merged.slice(0, 48), "No recent news for Jaleel's holdings.");
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
      if (b.dataset.psub === "signals") { renderCalls(); renderSignals(); }
      if (b.dataset.psub === "briefing") renderBriefing();
      if (b.dataset.psub === "earnings") renderEarnings();
      if (b.dataset.psub === "gurus") renderGurus();
      if (b.dataset.psub === "news" && !pNewsLoaded) { pNewsLoaded = true; loadPortfolioNews(); }
      if (b.dataset.psub === "dates" && !pDatesLoaded) { pDatesLoaded = true; loadPortfolioDates(); }
    }));
}

// Secondary views shown ONLY under S&P 500: Universe table vs Track Record scorecard.
function setSpView(view) {
  document.querySelectorAll("#sp-views .subtab").forEach((x) =>
    x.classList.toggle("active", x.dataset.spview === view));
  document.getElementById("usub-universe").classList.toggle("active", view === "universe");
  document.getElementById("usub-record").classList.toggle("active", view === "record");
  if (view === "record") {
    renderScorecard();
    pauseUniverseCycler();
  } else {
    uIndex = "S&P 500";
    renderVerdictSummary();
    renderUniverseControls();
    renderUniverseTable();
    resumeUniverseCycler();
  }
}

function initUniverseSubtabs() {
  const spViews = document.getElementById("sp-views");
  document.querySelectorAll("#u-subtabs .subtab").forEach((b) =>
    b.addEventListener("click", () => {
      const u = b.dataset.usub;
      document.querySelectorAll("#u-subtabs .subtab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll("#tab-universe .usub").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      spViews.hidden = (u !== "sp500");   // the Universe/Track-Record row belongs to S&P 500 only
      if (u === "etfs") {
        document.getElementById("usub-etfs").classList.add("active");
        renderEtfs();
        pauseUniverseCycler();
      } else if (u === "venture") {
        document.getElementById("usub-venture").classList.add("active");
        renderVenture();
        pauseUniverseCycler();
      } else if (u === "global") {
        uIndex = "Global";
        document.getElementById("usub-universe").classList.add("active");
        renderVerdictSummary();
        renderUniverseControls();
        renderUniverseTable();
        resumeUniverseCycler();
      } else {                            // sp500 -> show the secondary nav, default to Universe
        setSpView("universe");
      }
    }));
  document.querySelectorAll("#sp-views .subtab").forEach((b) =>
    b.addEventListener("click", () => setSpView(b.dataset.spview)));
}

/* ---------- boot ---------- */
/* ---------- render: Shariah-compliant ETF directory (baskets, not QARP-scored) ---------- */
const fmtAUM = (v) => v == null ? "—" : (v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : "$" + Math.round(v / 1e6) + "M");
const ETF_COLS = [
  { key: "ticker", label: "Fund", align: "left", fmt: (x) => `<span class="tick">${x.ticker}<span class="name">${x.name}</span></span>` },
  { key: "issuer", label: "Issuer", align: "left", fmt: (x) => `<span class="muted">${x.issuer}</span>` },
  { key: "asset_class", label: "Class", align: "left", fmt: (x) => `<span class="muted">${x.asset_class}</span>` },
  { key: "methodology", label: "Methodology", align: "left", fmt: (x) => `<span class="muted" style="font-size:12px">${x.methodology}</span>` },
  { key: "expense", label: "Expense", fmt: (x) => x.expense != null ? x.expense.toFixed(2) + "%" : "—" },
  { key: "aum", label: "AUM", fmt: (x) => fmtAUM(x.aum) },
  { key: "price", label: "Price", fmt: (x) => `<span class="cell-px">${fmtUSD(x.price, 2)}</span>` },
  { key: "day_pct", label: "Day", fmt: (x) => `<span class="cell-day ${signClass(x.day_pct)}">${fmtPct(x.day_pct)}</span>` },
  { key: "yield", label: "Yield", fmt: (x) => x.yield != null ? x.yield.toFixed(2) + "%" : "—", sortVal: (x) => x.yield ?? -1 },
  { key: "ytd", label: "YTD", fmt: (x) => `<span class="${signClass(x.ytd)}">${x.ytd != null ? (x.ytd > 0 ? "+" : "") + x.ytd.toFixed(1) + "%" : "—"}</span>`, sortVal: (x) => x.ytd ?? -999 },
];
let etfSort = { key: "aum", dir: -1 };  // default: biggest funds first

function renderEtfs() {
  const data = DATA.etfs || [];
  const sel = document.getElementById("etf-class");
  if (sel && sel.length <= 1) [...new Set(data.map((x) => x.asset_class))].forEach((c) => sel.add(new Option(c, c)));
  if (!renderEtfs._wired) {
    ["etf-search", "etf-class"].forEach((id) => document.getElementById(id).addEventListener("input", renderEtfs));
    renderEtfs._wired = true;
  }
  const q = document.getElementById("etf-search").value.trim().toLowerCase();
  const fc = document.getElementById("etf-class").value;
  let rows = data.filter((x) =>
    (!q || x.ticker.toLowerCase().includes(q) || x.name.toLowerCase().includes(q)) && (!fc || x.asset_class === fc));
  const col = ETF_COLS.find((c) => c.key === etfSort.key);
  const val = col.sortVal || ((x) => x[etfSort.key]);
  rows.sort((a, b) => {
    const va = val(a), vb = val(b);
    if (typeof va === "string") return etfSort.dir * va.localeCompare(vb);
    return etfSort.dir * ((va ?? 0) - (vb ?? 0));
  });
  document.querySelector("#etf-table thead").innerHTML = `<tr>${ETF_COLS.map((c) => {
    const arrow = etfSort.key === c.key ? `<span class="arrow">${etfSort.dir > 0 ? "▲" : "▼"}</span>` : "";
    return `<th class="${c.align === "left" ? "left" : ""}" data-key="${c.key}">${c.label}${arrow}</th>`;
  }).join("")}</tr>`;
  document.querySelector("#etf-table tbody").innerHTML = rows.map((x) =>
    `<tr>${ETF_COLS.map((c) => `<td class="${c.align === "left" ? "left" : ""}">${c.fmt(x)}</td>`).join("")}</tr>`).join("");
  document.getElementById("etf-count").textContent = `${rows.length} ETF${rows.length === 1 ? "" : "s"}`;
  document.querySelectorAll("#etf-table thead th").forEach((th) =>
    th.addEventListener("click", () => {
      const k = th.dataset.key;
      if (etfSort.key === k) etfSort.dir *= -1;
      else etfSort = { key: k, dir: ["ticker", "issuer", "asset_class", "methodology"].includes(k) ? 1 : -1 };
      renderEtfs();
    }));
}

/* ---------- render: Venture directory (Musaffa-HALAL high-risk small-caps, NOT QARP-scored) ---------- */
const VEN_COLS = [
  { key: "ticker", label: "Company", align: "left", fmt: (x) => `<span class="tick">${x.ticker}<span class="name">${x.name} · ${x.desc}</span></span>` },
  { key: "grade", label: "Musaffa", align: "left", fmt: (x) => `<span class="chip" style="font-size:11px">${x.grade || "—"}</span>` },
  { key: "mc", label: "Mkt Cap", fmt: (x) => x.mc != null ? "$" + x.mc.toFixed(1) + "B" : "—" },
  { key: "rg", label: "Rev g", fmt: (x) => `<span class="${signClass(x.rg)}">${x.rg != null ? (x.rg > 0 ? "+" : "") + Math.round(x.rg) + "%" : "—"}</span>`, sortVal: (x) => x.rg ?? -999 },
  { key: "gm", label: "Gross M", fmt: (x) => x.gm != null ? Math.round(x.gm) + "%" : "—" },
  { key: "prof", label: "Profit", fmt: (x) => x.prof ? `<span class="pos">✓</span>` : `<span class="muted">—</span>`, sortVal: (x) => x.prof ? 1 : 0 },
  { key: "moat", label: "Moat", fmt: (x) => `${x.moat}/5`, sortVal: (x) => x.moat ?? 0 },
  { key: "vscore", label: "Venture Score", fmt: (x) => `<span class="qarp-cell">${fmtNum(x.vscore, 1)}</span>` },
  { key: "price", label: "Price", fmt: (x) => `<span class="cell-px">${fmtUSD(x.price, 2)}</span>` },
  { key: "day_pct", label: "Day", fmt: (x) => `<span class="cell-day ${signClass(x.day_pct)}">${fmtPct(x.day_pct)}</span>` },
];
let venSort = { key: "vscore", dir: -1 };

function renderVenture() {
  const data = DATA.venture || [];
  if (!renderVenture._wired) {
    document.getElementById("ven-search").addEventListener("input", renderVenture);
    renderVenture._wired = true;
  }
  const q = document.getElementById("ven-search").value.trim().toLowerCase();
  let rows = data.filter((x) => !q || x.ticker.toLowerCase().includes(q) || x.name.toLowerCase().includes(q));
  const col = VEN_COLS.find((c) => c.key === venSort.key);
  const val = col.sortVal || ((x) => x[venSort.key]);
  rows.sort((a, b) => {
    const va = val(a), vb = val(b);
    if (typeof va === "string") return venSort.dir * va.localeCompare(vb);
    return venSort.dir * ((va ?? 0) - (vb ?? 0));
  });
  document.querySelector("#ven-table thead").innerHTML = `<tr>${VEN_COLS.map((c) => {
    const arrow = venSort.key === c.key ? `<span class="arrow">${venSort.dir > 0 ? "▲" : "▼"}</span>` : "";
    return `<th class="${c.align === "left" ? "left" : ""}" data-key="${c.key}">${c.label}${arrow}</th>`;
  }).join("")}</tr>`;
  document.querySelector("#ven-table tbody").innerHTML = rows.map((x) =>
    `<tr>${VEN_COLS.map((c) => `<td class="${c.align === "left" ? "left" : ""}">${c.fmt(x)}</td>`).join("")}</tr>`).join("");
  document.getElementById("ven-count").textContent = `${rows.length} name${rows.length === 1 ? "" : "s"}`;
  document.querySelectorAll("#ven-table thead th").forEach((th) =>
    th.addEventListener("click", () => {
      const k = th.dataset.key;
      if (venSort.key === k) venSort.dir *= -1;
      else venSort = { key: k, dir: ["ticker", "grade"].includes(k) ? 1 : -1 };
      renderVenture();
    }));
}

/* ---------- "Your book" daily read + "Needs your attention" digest (Claude, cloud-written) ---------- */
async function loadBookBrief() {
  const el = document.getElementById("book-brief");
  if (!el) return;
  try {
    const res = await fetch(`book_brief.json?cb=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) { el.hidden = true; return; }
    renderBookBrief(el, await res.json());
  } catch (e) { el.hidden = true; }
}
function renderBookBrief(el, b) {
  if (!b || !b.your_book) { el.hidden = true; return; }
  const att = (b.attention || []).filter((a) => a && a.ticker);
  const SEV = { act: "Act", watch: "Watch", note: "Note" };
  const attHtml = att.length ? `<div class="book-att"><div class="book-att-h">Needs attention</div>`
    + att.map((a) => {
      const s = (a.severity || "note").toLowerCase();
      return `<button type="button" class="book-att-row" data-tk="${esc(a.ticker)}">`
        + `<span class="book-sev ${SEV[s] ? s : "note"}">${SEV[s] || "Note"}</span>`
        + `<span class="book-att-tk">${esc(a.ticker)}</span>`
        + `<span class="book-att-txt"><b>${esc(a.headline || "")}</b> ${esc(a.note || "")}</span></button>`;
    }).join("") + `</div>` : "";
  el.innerHTML = `<div class="book-head"><h3>Jaleel's book today</h3><span class="book-when">${esc(b.generated_at || "")}</span></div>`
    + `<div class="book-body">${b.your_book}</div>${attHtml}`
    + `<div class="book-foot">Written by Claude from Jaleel's live data · informational only, not advice</div>`;
  el.hidden = false;
  el.querySelectorAll(".book-att-row").forEach((r) => r.addEventListener("click", () => openDrawer(r.dataset.tk)));
}

function renderAll() {
  document.getElementById("asof-date").textContent = asOfDate(DATA.meta.date);
  renderVerdictSummary();
  renderUniverseControls();
  renderUniverseTable();
  renderScorecard();
  renderEtfs();
  renderVenture();
  renderPortfolio();
  loadSignals();         // fetch signals.json + live trigger prices, then render the Signals card
  loadGurus();           // fetch gurus.json (13F holdings) for the Smart Money subtab
  loadBookBrief();       // fetch book_brief.json — Claude's daily "your book" read + attention digest
  enterDaily();          // Daily is the landing tab — render it + start its refresh
  initTabs();
  startLive();
}

async function boot() {
  const gate = document.getElementById("gate"), app = document.getElementById("app");
  const form = document.getElementById("gate-form"), btn = document.getElementById("gate-btn");
  const pwEl = document.getElementById("gate-pw");

  // Kick off the (large, ~0.4MB) encrypted-data download as a PROMISE — but do NOT block wiring
  // up the form on it. Previously the submit handler was attached only after this await, so a
  // password typed during the ~2s cold download triggered the form's DEFAULT submit and reloaded
  // the page (looping "stuck, won't open"). Now the form is wired immediately and unlock() waits.
  let payload = null, payloadErr = null;
  const payloadReady = fetch("payload.enc", { cache: "no-store" })
    .then((r) => r.json())
    .then((p) => { payload = p; if (p && p.date) document.getElementById("gate-date").textContent = asOfDate(p.date); })
    .catch((e) => { payloadErr = e; });

  async function unlock(pw, fromSaved) {
    if (!pw) return;
    btn.disabled = true; btn.textContent = "Unlocking…"; hideErr();
    await payloadReady;                      // wait for the data if it's still downloading
    if (payloadErr || !payload) {
      showErr("Couldn't load data — check your connection and try again.");
      btn.disabled = false; btn.textContent = "Unlock"; return;
    }
    try {
      DATA = await decryptPayload(payload, pw);
      gate.hidden = true; app.hidden = false;
      sessionStorage.setItem("jc_pw", pw);   // remember within this tab session only
      renderAll();
    } catch (err) {
      if (fromSaved) { sessionStorage.removeItem("jc_pw"); btn.disabled = false; btn.textContent = "Unlock"; }
      else { showErr("Wrong password."); btn.disabled = false; btn.textContent = "Unlock"; pwEl.select(); }
    }
  }

  // Wire the form IMMEDIATELY so an early Enter/click can never reload the page mid-download.
  form.addEventListener("submit", (e) => { e.preventDefault(); unlock(pwEl.value, false); });
  document.getElementById("lock-btn").addEventListener("click", () => { sessionStorage.removeItem("jc_pw"); location.reload(); });

  // auto-unlock within the same tab session (also waits for the payload via unlock())
  const saved = sessionStorage.getItem("jc_pw");
  if (saved) unlock(saved, true);
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

/* ---------- Ask-the-bot chat (Claude via the Cloudflare Worker proxy) ---------- */
// Set BOT_PROXY to your deployed Worker URL (see qarp-bot-worker.js). The browser
// builds a compact context from the live data and sends {system, messages}; the
// Worker adds the API key and streams Claude's reply. Until BOT_PROXY is set, the
// widget explains how to connect it.
const BOT_PROXY = "https://qarp-bot.murshidjaleel-990.workers.dev";   // deployed Cloudflare Worker (proxies to Anthropic; key server-side)
let botHistory = [];

function buildBotContext() {
  const t = (DATA.meta && DATA.meta.portfolio_totals) || {};
  const holds = (DATA.portfolio || []).map((h) => `${h.ticker} ${fmtNum(h.shares, 2)}sh ${fmtPct(h.gain_pct)} (QARP ${h.verdict || "?"})`).join("; ");
  const calls = (DATA.portfolio || []).map((h) => { try { return `${h.ticker}:${holdingCall(h.ticker).call}`; } catch (e) { return ""; } }).filter(Boolean).join(", ");
  const top = [...(DATA.universe || [])].filter((u) => u.qarp != null).sort((a, b) => b.qarp - a.qarp).slice(0, 12).map((u) => `${u.ticker} ${fmtNum(u.qarp, 0)} ${u.verdict}`).join("; ");
  const S = (typeof SIGNALS !== "undefined" && SIGNALS) || {};
  const risk = (S.risk || []).map((r) => `${r.ticker} (${r.tag})`).join(", ");
  const sectors = (S.sectors || []).map((s) => `${s.sector} ${s.dir}`).join(", ");
  return [
    "You are the assistant for the Jaleel Capital QARP dashboard — a Shariah-compliant equity tool. Answer questions about Jaleel's portfolio, the market, the holdings, the QARP framework, and investing generally. Be concise, direct, and honest. Informational only — NOT financial advice. Never fabricate a price, a Shariah verdict, or a figure; if it isn't in the context below, say you don't have it. When asked about a holding, use its QARP verdict + daily call + any risk flag.",
    "QARP = 0.6×(Quality/105×100) + 0.4×(DCF/5×100). Bands: ≥85 STRONGEST, ≥72 STRONG BUY, ≥66 BUY, ≥60 HOLD-QUAL, 35–59 AVOID, <35 STRONG AVOID. Gate 1 = Shariah (AAOIFI, via Musaffa). Default stance: conservative / capital-preservation.",
    `Data as of ${DATA.meta && DATA.meta.date}. Account ≈ ${fmtUSD(t.account, 0)}, cash ${fmtUSD(t.cash, 2)}, unrealized P/L ${fmtUSD(t.gain, 0)} (${fmtPct(t.gain_pct)}).`,
    `Holdings: ${holds}.`,
    `Daily calls (Add/Hold/Trim): ${calls}.`,
    `Top universe by QARP: ${top}.`,
    `Signals — macro: ${(S.macro && S.macro.headline) || "n/a"}. Risk flags: ${risk || "none"}. Sectors: ${sectors || "n/a"}.`,
  ].join("\n\n");
}

function botAppend(role, text) {
  const log = document.getElementById("bot-log");
  const row = document.createElement("div");
  row.className = "bot-msg " + role;
  row.textContent = text;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
  return row;
}

async function botSend(text) {
  botAppend("user", text);
  if (!BOT_PROXY || BOT_PROXY.includes("YOUR-WORKER")) {
    botAppend("assistant", "The bot isn't connected yet. Deploy the Cloudflare Worker (qarp-bot-worker.js), add your ANTHROPIC_API_KEY secret, then paste its URL into BOT_PROXY in app.js.");
    return;
  }
  botHistory.push({ role: "user", content: text });
  if (botHistory.length > 16) botHistory = botHistory.slice(-16);
  const bubble = botAppend("assistant", "…");
  try {
    const res = await fetch(BOT_PROXY, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ system: buildBotContext(), messages: botHistory }),
    });
    if (!res.ok || !res.body) { bubble.textContent = `Bot error (${res.status}). Check the Worker + API key.`; return; }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "", acc = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const d = line.slice(5).trim();
        if (!d || d === "[DONE]") continue;
        try {
          const ev = JSON.parse(d);
          if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") {
            acc += ev.delta.text; bubble.textContent = acc;
            document.getElementById("bot-log").scrollTop = 1e9;
          } else if (ev.type === "error") {
            bubble.textContent = "Bot error: " + (ev.error && ev.error.message || "unknown");
          }
        } catch (e) { /* ignore keep-alives */ }
      }
    }
    if (acc) botHistory.push({ role: "assistant", content: acc });
    else if (bubble.textContent === "…") bubble.textContent = "(no response)";
  } catch (e) {
    bubble.textContent = "Couldn't reach the bot — is the Worker URL right?";
  }
}

function initBot() {
  const fab = document.getElementById("bot-fab"), panel = document.getElementById("bot-panel");
  if (!fab || !panel) return;
  const open = () => { panel.hidden = false; fab.hidden = true; setTimeout(() => document.getElementById("bot-input").focus(), 50);
    if (!document.getElementById("bot-log").children.length) botAppend("assistant", "Hi — ask me about Jaleel's holdings, a QARP verdict, the signals, or the market. e.g. \"Why is LULU a hold?\" or \"What should I watch this week?\""); };
  fab.addEventListener("click", open);
  document.getElementById("bot-close").addEventListener("click", () => { panel.hidden = true; fab.hidden = false; });
  document.getElementById("bot-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = document.getElementById("bot-input"); const v = inp.value.trim();
    if (!v) return; inp.value = ""; botSend(v);
  });
}

initTips();
initFrameworkCalc();
initInformed();
initPortfolioSubtabs();
initUniverseSubtabs();
initBot();
boot();
