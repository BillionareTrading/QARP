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

/* ---------- PRIVACY SPLIT: the owner tier (2026-08-09) ----------
   Dollar amounts + share counts are NOT in the payload — they ship separately in
   private.enc, encrypted with the OWNER passcode. Until that blob is unlocked the
   fields are simply absent from DATA and every $ render shows a blurred redaction.
   Percentages (day%, P/L%, weight%), per-share prices, avg_cost and fw_x stay
   public. NEVER render a private field without going through pUSD/pSH or an
   explicit privUnlocked() branch. */
let PRIV = null;                 // decrypted private blob; null = locked
let lastPrivateIv = null;
const privUnlocked = () => !!PRIV;
const lockUSD = () => `<span class="priv-blur" role="button" title="Amounts are owner-locked — click to unlock">$•,•••</span>`;
const lockSH = () => `<span class="priv-blur" role="button" title="Amounts are owner-locked — click to unlock">•• sh</span>`;
const pUSD = (v, dp = 0) => (v == null && !privUnlocked() ? lockUSD() : fmtUSD(v, dp));

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
  pe: { t: "P/E — trailing → forward", d: "Price ÷ earnings on the last 12 months (trailing) vs. the next 12 months' estimate (forward). Shown side by side so the trailing-vs-forward gap is visible at a glance. A big drop (e.g. 23 → 7) means earnings are expected to surge — trailing understates how cheap it is; a rise means earnings are expected to fall. ↻ marks a CYCLICAL: for those, the DCF is anchored on forward / through-cycle earnings, not the distorted trailing number. N/A = no positive earnings on that basis (a loss). Not part of the QARP score — a read-through for auditing the valuation." },
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

// Single source of truth for the portfolio's day P&L. EXACT: each holding's day change is today's
// value minus yesterday's (value / (1 + day%/100)) — NOT value*day%, which OVERSTATES when a holding
// has a big % move (RKLB +16% made the front page read +$139 vs the true +$103). Used everywhere.
function portfolioDayPnl() {
  if (!privUnlocked()) {
    // Locked: dollar values are absent, but the SAME exact math survives in weight space —
    // prev_i ∝ w_i/(1+d_i), so pct = Σ(wPrev·d)/ΣwPrev is identical to the $ version
    // (the account denominator cancels). The $ figure itself stays owner-only (null).
    let acc = 0, wsum = 0;
    (DATA.portfolio || []).forEach((h) => {
      if (typeof h.day_pct !== "number" || typeof h.weight_pct !== "number") return;
      const wPrev = h.weight_pct / (1 + h.day_pct / 100);
      acc += wPrev * h.day_pct; wsum += wPrev;
    });
    return { usd: null, pct: wsum ? acc / wsum : 0 };
  }
  let prev = 0, now = 0;
  (DATA.portfolio || []).forEach((h) => {
    if (typeof h.day_pct !== "number") return;
    prev += h.value / (1 + h.day_pct / 100);
    now += h.value;
  });
  const usd = now - prev;
  return { usd, pct: prev ? (usd / prev) * 100 : 0 };
}

/* ---------- render: KPIs ---------- */
function renderKpis() {
  const t = DATA.meta.portfolio_totals;
  const { usd: dayChg, pct: dayPct } = portfolioDayPnl();   // exact, shared with the front page
  // "Today · live" during the session; after the bell the card itself switches to the prior close
  const sessionLive = marketOpenNow() && asOfDate(DATA.meta.date) === lastSessionDate();
  const todayLabel = sessionLive ? "Today" : `${lastCloseName(DATA.meta.date)} close`;
  const todayNote = sessionLive ? "live" : "";
  // Locked view: every $ tile shows a blurred redaction; %s stay live. The delta under
  // Today/Unrealized is a percent, so those cards stay informative for visitors.
  const dayCls = privUnlocked() ? signClass(dayChg) : signClass(dayPct);
  const cards = [
    { label: "Account Value", value: pUSD(t.account, 0), delta: privUnlocked() ? `${fmtUSD(t.cash, 2)} cash` : "owner-locked", dClass: "muted" },
    { label: todayLabel, note: todayNote, value: privUnlocked() ? fmtUSD(dayChg, 0) : fmtPct(dayPct), delta: privUnlocked() ? fmtPct(dayPct) : "book move", dClass: dayCls },
    { label: "Unrealized P/L", note: "open holdings only", value: privUnlocked() ? fmtUSD(t.gain, 0) : fmtPct(t.gain_pct), delta: privUnlocked() ? fmtPct(t.gain_pct) : "on cost", dClass: privUnlocked() ? signClass(t.gain) : signClass(t.gain_pct) },
    { label: "Cost Basis", value: pUSD(t.cost, 0), delta: `${DATA.portfolio.length} holdings`, dClass: "muted" },
  ];
  if (t.div_income_yr || !privUnlocked()) cards.push({ label: "Dividends", note: "annual", value: pUSD(t.div_income_yr, 0) + "/yr",
    delta: privUnlocked() && t.positions ? fmtPct(t.div_income_yr / t.positions * 100, 2).replace("+", "") + " yield" : "", dClass: "muted" });
  cards.push({ label: "Zakat", note: "2.5% · yearly", value: pUSD(zakatOnBook(), 0),
    delta: "on book + cash", dClass: "muted" });
  const lockChip = privUnlocked()
    ? `<button type="button" class="kpi kpi-lock unlocked" id="owner-lock-chip" title="Amounts are visible on this device — click to hide them again"><div class="label">Owner</div><div class="value">🔓</div><div class="delta muted">amounts visible · hide</div></button>`
    : `<button type="button" class="kpi kpi-lock" id="owner-lock-chip" title="Dollar amounts and share counts are hidden — the owner passcode reveals them"><div class="label">Owner</div><div class="value">🔒</div><div class="delta muted">amounts hidden · unlock</div></button>`;
  document.getElementById("kpis").innerHTML = cards.map((c) => `
    <div class="kpi">
      <div class="label">${c.label}${c.note ? ` <span class="kpi-note">· ${c.note}</span>` : ""}</div>
      <div class="value">${c.value}</div>
      <div class="delta ${c.dClass}">${c.delta}</div>
    </div>`).join("") + lockChip;
}

function isoOf(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function lastCloseName(iso) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(asOfDate(iso) + "T12:00:00").getDay()];
}
function fullDayName(iso) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(asOfDate(iso) + "T12:00:00").getDay()];
}
// Sidebar qualifier for the front page: "today" while the session is live, else a highlighted
// "as of <Weekday>'s close" so a glance never mistakes the last close for the current day.
function sessionSub() {
  // Say "today" only while the session is live AND the loaded build is actually the current session.
  // Before the post-open cloud rebuild lands, the data is still the prior close — label it honestly.
  const dataIsCurrent = asOfDate(DATA.meta.date) === lastSessionDate();
  return (marketOpenNow() && dataIsCurrent)
    ? `<span class="side-sub">today</span>`
    : `<span class="side-sub closed">as of ${fullDayName(DATA.meta.date)}'s close</span>`;
}
// Plain-text version: "today" while live + current, else the prior session's weekday ("Friday").
function sessionWord() {
  const dataIsCurrent = asOfDate(DATA.meta.date) === lastSessionDate();
  return (marketOpenNow() && dataIsCurrent) ? "today" : fullDayName(DATA.meta.date);
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

// Is a cloud-written column/brief recent enough to SHOW (vs the generic data-driven fallback)?
// The cloud feeds (column, briefs, signals) can trail a freshly-priced payload by a session —
// early in a trading day before the cloud has rewritten today's column, or across a weekend.
// A real, dated column from yesterday beats the generic fallback every time, so tolerate up to
// 4 calendar days of lag and label it by its own date; only fall back if it's absent or ancient.
function leadFresh(d) {
  if (!d || !DATA.meta) return false;
  const lag = (new Date(asOfDate(DATA.meta.date) + "T12:00:00") - new Date(d + "T12:00:00")) / 86400000;
  return lag <= 4;   // column at most ~4 days behind the displayed session
}

/* ---------- which index list is showing (US Equities | Global) ---------- */
let uIndex = "US Equities";
const uList = () => DATA.universe.filter((x) => (x.index || "US Equities") === uIndex);

/* ---------- render: Overview ---------- */
/* ---------- Additions desk: where new money could go (event-hooked, never momentum) ---------- */
function renderAdditions() {
  const host = document.getElementById("additions-desk");
  if (!host || !DATA.additions) return;
  const a = DATA.additions;
  const gaps = (a.sector_gaps || []).map((g) =>
    `<span class="gap-chip">${esc(g.macro)} <b>${g.book_pct}%</b></span>`).join("");
  const rows = (a.candidates || []).map((c) => `
    <div class="add-row" data-ticker="${c.ticker}" role="button" tabindex="0">
      <span class="tick">${c.ticker}<span class="name">${esc(c.name || "")}</span></span>
      <span class="add-meta">${verdictBadge(c.verdict)} <span class="qarp-cell">${fmtNum(c.qarp, 1)}</span>
        <span class="add-gate g-${(c.gate || "").toLowerCase()}">${c.gate}</span>
        <span class="add-mac">${esc(c.macro)}</span></span>
      <span class="add-why">${(c.why || []).map(esc).join(" · ")}</span>
    </div>`).join("");
  host.innerHTML = `<div class="card additions-card">
    <h3>Where new money could go <span class="fw-sub">the additions desk</span></h3>
    <p class="add-intro">The book's discipline is to cure concentration by <b>addition</b>, not selling.
      These are unheld <b>BUY-or-better</b> names with the tape actionable (gate GO/TURN) and a live
      <b>event hook</b> — a catalyst, insider buying, a sector signal, or a gap in the book. Max two per
      sector so the list itself diversifies.</p>
    ${gaps ? `<div class="gap-strip"><span class="gap-label">Book gaps</span>${gaps}</div>` : ""}
    ${rows || `<p class="muted">No qualified additions right now — no unheld BUY+ name has both an actionable tape and a live event hook. An empty list is honest; check back after the next build.</p>`}
    <p class="add-foot">Candidates to research — not advice. Event-hooked only, refreshed with every build (${esc((DATA.meta || {}).date || "")}). Tap a name for its full breakdown.</p>
  </div>`;
  host.querySelectorAll(".add-row").forEach((r) =>
    r.addEventListener("click", () => openDrawer(r.dataset.ticker)));
}

/* ---------- Desk discipline: re-score SLA queue + quarterly Shariah re-screen nag ---------- */
function renderDeskDiscipline() {
  const host = document.getElementById("desk-discipline");
  if (!host || !DATA.meta) return;
  const parts = [];
  const drift = DATA.meta.drift;
  if (drift && drift.flagged && drift.flagged.length) {
    // SLA: flagged names get re-scored within 5 trading days (~7 calendar); older = overdue
    const ageDays = Math.round((new Date(asOfDate(DATA.meta.date) + "T12:00:00") - new Date(drift.date + "T12:00:00")) / 86400000);
    const overdue = ageDays > 7;
    const chips = drift.flagged.slice(0, 12).map((f) =>
      `<button type="button" class="drift-chip${f.weight >= 3 ? " hot" : ""}" data-ticker="${f.ticker}"
        title="${esc((f.reasons || []).join("; "))}">${f.ticker}<span class="dw">${f.weight}</span></button>`).join("");
    const more = drift.flagged.length > 12 ? `<span class="muted">+${drift.flagged.length - 12} more</span>` : "";
    parts.push(`<div class="drift-card${overdue ? " overdue" : ""}">
      <div class="drift-head"><b>Re-score queue</b> — ${drift.flagged.length} name${drift.flagged.length > 1 ? "s" : ""} drifted
        (weekly check, ${drift.date}) <span class="drift-sla">${overdue ? "SLA OVERDUE — re-score within 5 trading days" : "SLA: re-score within 5 trading days"}</span></div>
      <div class="drift-chips">${chips}${more}</div>
      <div class="drift-note">Fundamentals moved since the hand-score (earnings, targets, margins) — the daily price re-rank can't see this. Tap a name, read "what drifted" on hover.</div>
    </div>`);
  }
  host.innerHTML = parts.join("");
  host.hidden = !parts.length;
  host.querySelectorAll(".drift-chip").forEach((b) =>
    b.addEventListener("click", () => openDrawer(b.dataset.ticker)));
}

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
  // sweep-up rules (2026-07-08): 28 sectors were leaking their RAW 20-28 char names through
  // the fallback and blowing the column wide (the Sector<->Price white-space complaint).
  [["tech-", "research-subscription"], "Technology"],
  [["consumer-education"], "Consumer Disc."],
  [["consumer"], "Consumer Disc."],
  [["reit", "realestate"], "Real Estate"],
];
function sectorGroup(s) {
  const sl = (s || "").toLowerCase();
  for (const [kws, g] of MACRO_SECTOR_RULES) if (kws.some((k) => sl.includes(k))) return g;
  return s || "—"; // fallback: show the raw sector if a future build adds one we don't map yet
}

/* ---------- P/E cell: trailing → forward, with the distortion flagged ---------- */
function peCell(x) {
  const t = x.trailing_pe, f = x.forward_pe;
  if (t == null && f == null) return `<span class="muted">N/A</span>`;
  const tStr = t != null ? fmtNum(t, 1) : "—";
  const fStr = f != null ? fmtNum(f, 1) : "—";
  let cls = "";
  if (t != null && f != null) {
    if (f < t * 0.7) cls = "pe-cheapen";      // forward much cheaper — earnings surge (e.g. MU 23→7)
    else if (f > t * 1.3) cls = "pe-richen";  // forward richer — earnings expected to fall (peak risk)
  }
  const cyc = x.cyclical
    ? ` <span class="pe-cyc" title="Cyclical — DCF anchored on forward, not trailing">↻</span>` : "";
  return `<span class="pe-cell ${cls}">${tStr}<span class="pe-arrow">→</span>${fStr}</span>${cyc}`;
}

/* ---------- render: Universe table ---------- */
const U_COLS = [
  { key: "rank", label: "#", align: "left", fmt: (x) => `<span class="muted">${x.rank}</span>` },
  { key: "ticker", label: "Name", align: "left", fmt: (x) => `<span class="tick">${x.ticker}<span class="name">${x.name}</span></span>` },
  { key: "sector", label: "Sector", align: "left", fmt: (x) => `<span class="muted" title="${esc(x.sector || "")}">${sectorGroup(x.sector)}</span>`, sortVal: (x) => sectorGroup(x.sector) },
  { key: "price", label: "Price", fmt: (x) => `<span class="cell-px">${fmtUSD(x.price, 2)}</span>` },
  { key: "day_pct", label: "Day", fmt: (x) => `<span class="cell-day ${signClass(x.day_pct)}">${fmtPct(x.day_pct)}</span>` },
  { key: "div", label: "Dividends", fmt: (x) => x.div_rate
      ? `<span class="div-rate">${fmtUSD(x.div_rate, 2)}<span class="div-unit">/sh</span></span><span class="div-yld">${x.div_yield != null ? x.div_yield + "%" : ""}</span>`
      : `<span class="muted">N/A</span>`,
    sortVal: (x) => x.div_yield || 0 },
  { key: "qarp", label: "QARP", fmt: (x) => `<span class="qarp-cell">${fmtNum(x.qarp, 1)}</span>` },
  { key: "dcf", label: "DCF", fmt: (x) => fmtNum(x.dcf, 1) },
  { key: "pe", label: "P/E t→f", align: "left", fmt: (x) => peCell(x),
    sortVal: (x) => (x.forward_pe != null ? x.forward_pe : (x.trailing_pe != null ? x.trailing_pe : 1e6)) },
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
  // intro copy reflects the active list (US Equities vs Global)
  const intro = document.getElementById("u-intro");
  if (intro) intro.innerHTML = uIndex === "Global"
    ? `<b>Global</b> names outside the S&amp;P 1500, screened for Shariah compliance — the compliant ones are scored on <b>QARP</b> (quality + value) and ranked below. This list grows as we add more global companies.`
    : `Every company in the <b>S&amp;P 1500</b> (large, mid &amp; small cap) was screened for Shariah compliance — the ones that pass are scored on <b>QARP</b> (quality + value) and ranked below. Sort, filter, or tap any name for its full breakdown.`;
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

// Top horizontal scrollbar for the universe table: a 14px dummy strip above the wrap
// whose inner width mirrors the table's scrollWidth; scrolling either bar moves both.
// (The native bar sits at the BOTTOM of the 396-row table — unreachable mid-scroll.)
let uHScrollWired = false;
function syncUniverseHScroll() {
  const bar = document.getElementById("u-hscroll");
  const inner = document.getElementById("u-hscroll-inner");
  const wrap = document.getElementById("u-wrap");
  const tbl = document.getElementById("u-table");
  if (!bar || !wrap || !tbl) return;
  inner.style.width = tbl.scrollWidth + "px";
  const nav = document.getElementById("u-hnav");
  if (nav) nav.style.display = tbl.scrollWidth > wrap.clientWidth + 2 ? "" : "none";
  if (!uHScrollWired) {
    let lock = false;
    bar.addEventListener("scroll", () => { if (lock) return; lock = true; wrap.scrollLeft = bar.scrollLeft; lock = false; });
    wrap.addEventListener("scroll", () => { if (lock) return; lock = true; bar.scrollLeft = wrap.scrollLeft; lock = false; });
    // mouse-friendly nudge arrows: click = a wide smooth step, hold = fast glide
    const step = (dir, px, behavior) => wrap.scrollBy({ left: dir * px, behavior });
    [["u-harrow-l", -1], ["u-harrow-r", 1]].forEach(([id, dir]) => {
      const b = document.getElementById(id);
      if (!b) return;
      let hold = null;
      b.addEventListener("click", () => step(dir, 480, "smooth"));
      b.addEventListener("mousedown", () => { hold = setInterval(() => step(dir, 190, "auto"), 90); });
      ["mouseup", "mouseleave"].forEach((ev) => b.addEventListener(ev, () => clearInterval(hold)));
    });
    uHScrollWired = true;
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
  syncUniverseHScroll();
}

/* ---------- render: Portfolio ---------- */
const P_COLS = [
  { key: "ticker", label: "Name", align: "left", fmt: (x) => `<span class="tick">${x.ticker}<span class="name">${x.name}</span></span>` },
  { key: "price", label: "Price", fmt: (x) => `<span class="cell-px">${fmtUSD(x.price, 2)}</span>` },
  // avg cost is PER-SHARE (scale-free) — published as avg_cost so it survives the privacy
  // split; the shares/cost fallback keeps working after the owner unlock merges them in.
  { key: "avgcost", label: "Avg Cost", fmt: (x) => `<span class="muted">${fmtUSD(x.avg_cost != null ? x.avg_cost : (x.shares ? x.cost / x.shares : null), 2)}</span>`, sortVal: (x) => (x.avg_cost != null ? x.avg_cost : (x.shares ? x.cost / x.shares : 0)) },
  { key: "day_pct", label: "Day", fmt: (x) => `<span class="cell-day ${signClass(x.day_pct)}">${fmtPct(x.day_pct)}</span>` },
  { key: "shares", label: "Shares", fmt: (x) => (x.shares == null && !privUnlocked() ? lockSH() : fmtNum(x.shares, 2)), sortVal: (x) => (x.shares != null ? x.shares : x.weight_pct || 0) },
  { key: "value", label: "Value", fmt: (x) => pUSD(x.value, 0), sortVal: (x) => (x.value != null ? x.value : x.weight_pct || 0) },
  { key: "gain", label: "Unrlzd $", fmt: (x) => (x.gain == null && !privUnlocked() ? lockUSD() : `<span class="${signClass(x.gain)}">${fmtUSD(x.gain, 0)}</span>`), sortVal: (x) => (x.gain != null ? x.gain : x.gain_pct || 0) },
  { key: "gain_pct", label: "Unrlzd %", fmt: (x) => `<span class="${signClass(x.gain_pct)}">${fmtPct(x.gain_pct)}</span>` },
  { key: "weight_pct", label: "Weight", fmt: (x) => fmtNum(x.weight_pct, 1) + "%" },
  { key: "div_income", label: "Div /yr", fmt: (x) => x.div_income != null
      ? `<span class="div-rate">${fmtUSD(x.div_income, 2)}</span>`
      : (!privUnlocked() && x.div_rate ? lockUSD() : `<span class="muted">N/A</span>`),
    sortVal: (x) => (x.div_income != null ? x.div_income : x.div_rate || 0) },
  { key: "qarp", label: "QARP", fmt: (x) => `<span class="qarp-cell">${fmtNum(x.qarp, 1)}</span>` },
  { key: "verdict", label: "Verdict", align: "left", fmt: (x) => verdictBadge(x.verdict), sortVal: (x) => VERDICT_ORDER.indexOf(x.verdict) },
  { key: "calls", label: "Calls", align: "left", fmt: (x) => callsCell(x.ticker, x.price),
    sortVal: (x) => openCallReturn(x.ticker, x.price) },
];
let pSort = { key: "weight_pct", dir: -1 };   // weight order == value order, works locked or unlocked

function renderTopHoldings() {
  const el = document.getElementById("p-holdings-bars");
  if (!el) return;
  // weight_pct shares the denominator across rows, so ratios match the old value math
  // exactly — and it survives the privacy split (values are owner-tier).
  const holds = [...DATA.portfolio].sort((a, b) => (b.weight_pct || 0) - (a.weight_pct || 0));
  const total = holds.reduce((s, h) => s + (h.weight_pct || 0), 0) || 1;
  const shown = holds.slice(0, 6);
  const ws = shown.map((h) => (h.weight_pct || 0) / total * 100);
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
    donut(secs.map((s) => ({ value: s.weight_pct, color: s.color }))) +   // % shares — sector $ no longer ships
    legend(secs.map((s) => ({ label: s.sector, right: s.weight_pct + "%", color: s.color })));

  renderSectorPerformance();
  renderPortfolioTable();
  renderRealized();
}

// Realized — closed trades from the Abyan records. Sortable (pSort/uSort pattern),
// with a stats band computed from the rows: total earned, trade count, win rate, best
// trade. Wins render in the site's positive green (user call 2026-07-08: "it's literally
// my earnings, make it look good") — this is the book's trophy case, not a data dump.
let rSort = { key: "date_sold", dir: -1 };
const R_COLS = [
  { key: "ticker", label: "Company", align: "left", sortVal: (r) => r.ticker },
  { key: "date_bought", label: "Bought", sortVal: (r) => r.date_bought || "" },
  { key: "date_sold", label: "Sold", sortVal: (r) => r.date_sold || "" },
  { key: "held", label: "Held", sortVal: (r) => (r.date_bought && r.date_sold) ? (new Date(r.date_sold) - new Date(r.date_bought)) : -1 },
  { key: "gain", label: "Gain", sortVal: (r) => (r.gain != null ? r.gain : r.gain_pct || 0) },
  { key: "gain_pct", label: "Return", sortVal: (r) => r.gain_pct == null ? -1e9 : r.gain_pct },
];
function renderRealized() {
  const el = document.getElementById("realized");
  if (!el) return;
  const all = DATA.realized || [];
  if (!all.length) { el.hidden = true; return; }
  el.hidden = false;

  // ---- stats band (computed live from the rows, so future sells update it) ----
  // Locked: gain $ is owner-tier, but wins/best are decidable from gain_pct (public).
  const unlocked = privUnlocked();
  const total = unlocked ? all.reduce((s, r) => s + r.gain, 0) : null;
  const wins = all.filter((r) => (unlocked ? r.gain : r.gain_pct || 0) >= 0).length;
  const best = all.reduce((b, r) => ((unlocked ? r.gain > b.gain : (r.gain_pct || -1e9) > (b.gain_pct || -1e9)) ? r : b), all[0]);
  document.getElementById("realized-stats").innerHTML = `
    <div class="rz-hero">
      <span class="rz-total-label">Total realized earnings</span>
      <span class="rz-total">${unlocked ? "+$" + total.toLocaleString("en-US", {minimumFractionDigits: 2}) : lockUSD()}</span>
    </div>
    <div class="rz-chips">
      <span class="rz-chip"><b>${all.length}</b> closed trades</span>
      <span class="rz-chip rz-chip-pos"><b>${wins}</b> profitable · ${Math.round(wins / all.length * 100)}%</span>
      <span class="rz-chip">Best: <b>${best.ticker}</b> ${unlocked ? "+$" + best.gain.toFixed(2) : fmtPct(best.gain_pct)}</span>
      <span class="rz-chip">Zakat on realized · 2.5%: <b>${unlocked ? fmtUSD(Math.max(0, total) * ZAKAT_RATE, 2) : lockUSD()}</b></span>
    </div>`;

  // ---- sortable table ----
  const col = R_COLS.find((c) => c.key === rSort.key) || R_COLS[2];
  const rows = [...all].sort((a, b) => {
    const va = col.sortVal(a), vb = col.sortVal(b);
    if (typeof va === "string") return rSort.dir * va.localeCompare(vb);
    return rSort.dir * (va - vb);
  });
  const d = (iso) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: iso.slice(0,4) !== String(new Date().getFullYear()) ? "2-digit" : undefined }) : "—";
  const held = (r) => {
    if (!r.date_bought || !r.date_sold) return "—";
    const days = Math.round((new Date(r.date_sold) - new Date(r.date_bought)) / 86400000);
    const t = days < 21 ? `${days} d` : days < 70 ? `${Math.round(days / 7)} w` : `${Math.round(days / 30.4)} mo`;
    return r.buy_est ? `~${t}` : t;
  };
  document.querySelector("#realized-table thead").innerHTML = `<tr>${R_COLS.map((c) => {
    const arrow = rSort.key === c.key ? `<span class="arrow">${rSort.dir > 0 ? "▲" : "▼"}</span>` : "";
    return `<th class="${c.align === "left" ? "left" : ""}" data-key="${c.key}">${c.label}${arrow}</th>`;
  }).join("")}</tr>`;
  document.querySelector("#realized-table tbody").innerHTML = rows.map((r) => `
    <tr>
      <td class="left"><b>${r.ticker}</b> <span class="realized-name">${r.name}</span>
        <span class="realized-sh">${r.shares == null ? lockSH() : (+r.shares).toLocaleString(undefined, {maximumFractionDigits: 2}) + " sh"}</span></td>
      <td>${r.buy_est ? '<span class="realized-approx">~</span>' : ""}${d(r.date_bought)} · $${r.buy_px.toFixed(2)}</td>
      <td>${d(r.date_sold)} · $${r.sell_px.toFixed(2)}</td>
      <td>${held(r)}</td>
      <td>${r.gain == null ? lockUSD() : `<span class="${r.gain >= 0 ? "rz-gain" : "rz-loss"}">${r.gain >= 0 ? "+" : "−"}$${Math.abs(r.gain).toFixed(2)}</span>`}</td>
      <td><span class="${(r.gain != null ? r.gain : r.gain_pct || 0) >= 0 ? "rz-gain" : "rz-loss"}">${r.gain_pct == null ? "—" : (r.gain_pct >= 0 ? "+" : "−") + Math.abs(r.gain_pct).toFixed(1) + "%"}</span></td>
    </tr>`).join("");
  document.querySelectorAll("#realized-table thead th").forEach((th) =>
    th.addEventListener("click", () => {
      const k = th.dataset.key;
      if (rSort.key === k) rSort.dir *= -1;
      else rSort = { key: k, dir: k === "ticker" ? 1 : -1 };
      renderRealized();
    }));
}

// Performance by sector — per-sector gain% bars, best -> worst.
function renderSectorPerformance() {
  const perfEl = document.getElementById("sector-perf");
  if (!perfEl) return;
  const secs = (DATA.sectors || []).filter((s) => s.gain_pct != null);   // sector cost $ no longer ships
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
  const ab = d.about || (p && p.about) || null;   // sourced company profile (build-time, Yahoo)
  if (ab && has(ab.industry)) kv.push(["Industry", esc(ab.industry)]);
  if (ab && has(ab.emp)) kv.push(["Employees", Number(ab.emp).toLocaleString("en-US")]);
  if (ab && has(ab.web)) kv.push(["Website", `<a href="${safeUrl(ab.web)}" target="_blank" rel="noopener">${esc(String(ab.web).replace(/^https?:\/\//, ""))}</a>`]);
  if (has(d.gf_value)) kv.push(["GF Value", fmtUSD(d.gf_value, 2)]);
  if (has(d.trailing_pe) || has(d.forward_pe)) {
    const t = has(d.trailing_pe) ? fmtNum(d.trailing_pe, 1) : "—";
    const f = has(d.forward_pe) ? fmtNum(d.forward_pe, 1) : "—";
    const tag = d.cyclical ? ` <span class="pe-cyc" title="Cyclical — DCF anchored on forward earnings, not trailing">↻ cyclical</span>` : "";
    kv.push(["P/E (trailing → forward)", `${t} → ${f}${tag}`]);
  }
  if (has(d.mktcap_b)) kv.push(["Market cap", "$" + fmtNum(d.mktcap_b, 1) + "B"]);
  if (has(d.shariah_grade)) {
    // "as of" = the newer of the quarterly screen and the hand verdict; flag if >120d old
    let sh = d.shariah_grade;
    if (has(d.shariah_asof)) {
      const ageDays = Math.round((new Date(asOfDate(DATA.meta.date) + "T12:00:00") - new Date(d.shariah_asof + "T12:00:00")) / 86400000);
      sh += ` <span class="muted">· as of ${d.shariah_asof}</span>` +
            (ageDays > 120 ? ` <span class="stale-flag" title="Verdict older than 120 days — re-verify on Musaffa">⚠ stale</span>` : "");
    }
    kv.push(["Shariah (Musaffa)", sh]);
  }
  if (has(d.first_date)) kv.push(["Scored / re-scored", `${d.first_date} <span class="muted">(current call opened)</span>`]);
  if (has(d.confidence)) kv.push(["Confidence", d.confidence]);
  if (d.catalyst) kv.push(["Catalyst (preview)", `<b>${d.catalyst.label}</b> — ${esc(d.catalyst.note || "")}`]);
  if (has(d.insider)) kv.push(["Insider (6-mo Form 4)", d.insider]);
  if (has(d.buzz)) kv.push(["Buzz", `${d.buzz} — ${d.buzz_signal || ""}`]);
  if (p) {
    kv.push(["Jaleel's position", privUnlocked() ? `${fmtNum(p.shares, 2)} sh · ${fmtUSD(p.value, 0)}` : `${lockSH()} · ${lockUSD()}`]);
    kv.push(["Jaleel's gain", `${privUnlocked() ? fmtUSD(p.gain, 0) : lockUSD()} (${fmtPct(p.gain_pct)})`]);
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
      <span class="chip" style="cursor:pointer;color:var(--brand);font-weight:700" onclick="closeDrawer();openChart('${ticker}')">Open chart →</span>
      ${(DATA.estimates && (DATA.estimates.docket || []).some((x) => x.tk === ticker))
        ? `<span class="chip" style="cursor:pointer;color:var(--brass);font-weight:700" onclick="closeDrawer();openEstimates('${ticker}')">Estimates →</span>` : ""}
    </div>
    ${x ? `<h4>Quality dimensions</h4><div class="dims">${dims.map(([l, v, m]) => `
      <div class="dim"><div class="dl">${l}</div><div class="dv">${has(v) ? v : "—"}<span class="muted" style="font-size:12px;font-weight:500"> /${m}</span></div>
      <div class="dbar"><div class="dfill" style="width:${has(v) ? (v / m * 100).toFixed(0) : 0}%"></div></div></div>`).join("")}</div>` : ""}
    ${kv.length ? `<div class="kv">${kv.map(([k, v]) => `<span class="k">${k}</span><span class="vv">${v}</span>`).join("")}</div>` : ""}
    ${d.sec_fin ? `<h4>Latest filed quarter <span class="muted" style="font-weight:400">(SEC · as-reported)</span></h4>
      <div class="drawer-fin">
        ${d.sec_fin.revenue ? `<span class="fin-stat">Revenue <b>${esc(d.sec_fin.revenue.fmt)}</b> ${d.sec_fin.revenue.yoy != null ? `<i class="${d.sec_fin.revenue.yoy >= 0 ? "pos" : "neg"}">${d.sec_fin.revenue.yoy >= 0 ? "+" : ""}${d.sec_fin.revenue.yoy}% YoY</i>` : ""}</span>` : ""}
        ${d.sec_fin.eps ? `<span class="fin-stat">Dil. EPS <b>${d.sec_fin.eps.val < 0 ? "−$" + Math.abs(d.sec_fin.eps.val) : "$" + d.sec_fin.eps.val}</b> ${d.sec_fin.eps.yoy != null ? `<i class="${d.sec_fin.eps.yoy >= 0 ? "pos" : "neg"}">${d.sec_fin.eps.yoy >= 0 ? "+" : ""}${d.sec_fin.eps.yoy}% YoY</i>` : ""}</span>` : ""}
        ${d.sec_fin.net_income ? `<span class="fin-stat">Net income <b>${esc(d.sec_fin.net_income.fmt)}</b>${d.sec_fin.revenue && d.sec_fin.revenue.val ? ` <i class="${d.sec_fin.net_income.val < 0 ? "neg" : "pos"}">${(d.sec_fin.net_income.val / d.sec_fin.revenue.val * 100).toFixed(1)}% margin</i>` : ""}</span>` : ""}
        <span class="fin-src">${d.sec_fin.url ? `<a href="${esc(safeUrl(d.sec_fin.url))}" target="_blank" rel="noopener noreferrer" onclick="openSecDoc(event, this)">${esc(d.sec_fin.form || "")} filed ${esc(d.sec_fin.filed || "")} · EDGAR</a>` : esc(d.sec_fin.period || "")}</span>
      </div>` : ""}
    ${ab && ab.desc ? `<h4>What the company does</h4><div class="dcf-note">${esc(ab.desc)}</div>` : ""}
    ${has(d.dcf_note) ? `<h4>DCF / thesis note</h4><div class="dcf-note">${d.dcf_note}</div>` : ""}
    ${bzHoldingNewsHtml(ticker)}
    <section id="drawer-pulse" class="drawer-pulse"></section>
    <section id="drawer-cread" class="drawer-pulse"></section>`;

  renderDrawerPulse(ticker, d.name || (p && p.name) || ticker);
  renderClaudeRead(ticker);
  const secLink = document.querySelector("#drawer-panel .fin-src a");
  if (secLink) resolveSecHref(secLink);   // rewrite directory -> document before the click
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
    const u = (DATA.universe || []).find((x) => x.ticker === ticker) || {};
    const S = (typeof SIGNALS !== "undefined" && SIGNALS) || {};
    const hn = S.holding_news && S.holding_news[ticker];
    // Search strategy rides in context: without it Grok issues 1-2 narrow queries, retrieves
    // ~nothing, and every name reads "quiet" (TSLA came back with 4 posts). With it: 8 queries,
    // 25+ posts, real counted reads. Verified 2026-07-08 on TSLA (62, 11/6) vs FELE (honest quiet).
    const STRATEGY = "REQUIRED: run 4+ x_search queries (cashtag, bare ticker, company name, name+stock; Top AND Latest, last 24h). Collect 25+ candidate posts before judging; conclude quiet ONLY if all searches together yield <5 substantive posts.";
    const context = [
      u.day_pct != null ? `stock ${u.day_pct >= 0 ? "up" : "down"} ${Math.abs(u.day_pct).toFixed(1)}% ${sessionWord()}` : "",
      hn && hn.title ? `headline: ${String(hn.title).slice(0, 80)}` : "",
      STRATEGY,
    ].filter(Boolean).join(" · ").slice(0, 400);
    const res = await fetch(GROK_PROXY, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol: ticker, name, context }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j || j.error || !j.pulse) return fail();
    PULSE_CACHE[ticker] = { data: j.pulse, ts: Date.now() };
    el.innerHTML = PULSE_HEAD + pulseBodyHtml(j.pulse, Date.now());
    wirePulse(ticker, name);
  } catch (e) { fail(); }
}

function pulseBodyHtml(p, ts) {
  const lbl = p.sentiment_label || "Quiet";
  const quiet = p.sentiment_score == null || /quiet/i.test(lbl);
  const cls = /bull/i.test(lbl) ? "pos" : /bear/i.test(lbl) ? "neg" : "muted";
  const posts = (Array.isArray(p.posts) ? p.posts : []).filter((x) => x && x.handle).slice(0, 3);
  const counts = (p.bullish_n != null && p.bearish_n != null)
    ? `<span class="pulse-counts"><b class="pos">${p.bullish_n}▲</b> / <b class="neg">${p.bearish_n}▼</b>${p.neutral_n ? ` / ${p.neutral_n}·` : ""}</span>` : "";
  const vol = p.posts_24h != null ? ` · ${fmtNum(p.posts_24h, 0)} posts/24h` : "";
  const postsHtml = posts.length
    ? posts.map((x) => `<div class="pulse-post"><span class="pulse-handle">${esc(x.handle)}</span> ${esc(x.text || "")}</div>`).join("")
    : "";
  if (quiet) {
    // A quiet tape is a finding, not a failure — say it plainly instead of a fake Neutral 50.
    return `
      <div class="pulse-top"><span class="pulse-score muted">Quiet on X</span><span class="pulse-buzz">no crowd signal${vol}</span></div>
      <div class="pulse-theme">${esc(p.theme || "No meaningful chatter in the last 24h — normal for a name like this between catalysts; buzz tends to spike around earnings and news.")}</div>
      ${postsHtml}
      <div class="pulse-foot">Fetched ${pulseAgo(ts)} · social signal, not advice · <button type="button" class="pulse-link" data-act="get">refresh</button></div>`;
  }
  const score = Math.max(0, Math.min(100, Math.round(p.sentiment_score)));
  return `
    <div class="pulse-top">
      <span class="pulse-score ${cls}">${esc(lbl)} · ${score}</span>
      ${counts}
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
    u.gf_value != null ? `GuruFocus fair value ${fmtUSD(u.gf_value, 2)} vs price ${fmtUSD(u.price, 2)}${u.day_pct != null ? ` (${fmtPct(u.day_pct)} ${sessionWord()})` : ""}.` : (u.price != null ? `Price ${fmtUSD(u.price, 2)}.` : ""),
    u.dcf_note ? `Valuation/thesis note: ${String(u.dcf_note).replace(/<[^>]+>/g, "")}` : "",
    u.shariah_grade ? `Shariah (Musaffa): ${u.shariah_grade}.` : "",
    u.catalyst ? `Catalyst (shadow factor): ${u.catalyst.label} — ${u.catalyst.note || ""}` : "",
    u.insider ? `Insider activity: ${u.insider}.` : "",
    u.mktcap_b != null ? `Market cap ~$${fmtNum(u.mktcap_b, 1)}B.` : "",
    news && news.title ? `Latest headline (Benzinga): ${news.title}` : "",
    p ? (privUnlocked() ? `User OWNS this: ${fmtNum(p.shares, 2)} sh, ${fmtPct(p.gain_pct)} unrealized.`
                        : `User OWNS this: ${fmtPct(p.gain_pct)} unrealized (size owner-private).`) : "Not currently held.",
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
  // Maturity indicator. `target_days` is the EARLY-READ BAR (~20 trading days ~= 1 month),
  // NOT a finish line — past it the sample stops being "early" and is merely short. This
  // string was unconditional until 2026-07-29 and had been printing the self-contradicting
  // "Day 41 of ~20 — early read" ever since day 21. Landmarks: 21d ~= a month, 63d ~= a
  // quarter, 252d ~= a year.
  const matTxt = sc.days_tracked == null ? "" : (() => {
    const d = sc.days_tracked, bar = sc.target_days || 20;
    const txt = d < bar ? `Day ${d} of ~${bar} — early read`
              : d < 63  ? `Day ${d} — past the ~${bar}-day bar, under a quarter`
              : d < 252 ? `Day ${d} — ${Math.round(d / 21)}-month sample`
                        : `Day ${d} — ${(d / 252).toFixed(1)}-year sample`;
    return `<span class="sc-mat">${txt}</span>`;
  })();
  host.innerHTML = `
    <div class="card sc-headline">
      <div class="sc-q">Does the ranking rank?${infoBtn("scorecard")}</div>
      ${spreadTxt}
      <div class="sc-meta">${icTxt}${matTxt}</div>
      <div class="sc-bars">${bars}</div>
      <div class="sc-note">Each <b>call</b> is a verdict locked at its entry price — it stays put until the name is re-scored (not on daily price moves). Return marks to current price. ${total} calls since ${sc.since || ""}. ${sc.days_tracked != null && sc.days_tracked >= 63 ? "Watch" : "Early sample — watch"} the IC + spread trend as it matures.</div>
    </div>
    ${renderTrend(sc.history)}
    <div class="sc-grid">${cards}</div>
    ${renderDcaSim()}`;
}

/* ---------- the $1,000 test: plain-English proof under the track record ---------- */
function renderDcaSim() {
  const s = DATA.dca_sim;
  if (!s || s.framework == null || s.sp500 == null) return "";
  const fwPct = (s.framework / s.invested - 1) * 100;
  const spPct = (s.sp500 / s.invested - 1) * 100;
  const edge = fwPct - spPct;
  return `<div class="card dca-card">
    <h3>The $1,000 test <span class="fw-sub">same dollars, same days — only the picks differ</span></h3>
    <p class="dca-intro">Take <b>$1,000</b> and split it into equal daily installments since the ledger began
      (<b>${esc(s.since)}</b>, ${s.days} sessions). Each day, buy that day's <b>STRONG&nbsp;BUY</b> list,
      equal-weight, at the closing price — stop buying a name the day its verdict changes, never sell.
      Then do the identical thing with the <b>S&amp;P&nbsp;500</b>.</p>
    <div class="dca-race">
      <div class="dca-lane">
        <div class="dca-label">QARP STRONG BUYs <span class="muted">(${s.names_bought} names bought)</span></div>
        <div class="dca-value ${signClass(fwPct)}">${fmtUSD(s.framework, 0)}</div>
        <div class="dca-pct ${signClass(fwPct)}">${fmtPct(fwPct, 1)}</div>
      </div>
      <div class="dca-vs">vs</div>
      <div class="dca-lane">
        <div class="dca-label">S&amp;P 500 <span class="muted">(same method)</span></div>
        <div class="dca-value ${signClass(spPct)}">${fmtUSD(s.sp500, 0)}</div>
        <div class="dca-pct ${signClass(spPct)}">${fmtPct(spPct, 1)}</div>
      </div>
    </div>
    <div class="dca-edge">${edge >= 0 ? "The framework is ahead by" : "The framework trails by"}
      <b class="${signClass(edge)}">${fmtPct(Math.abs(edge), 1).replace("+", "")}</b> over this stretch.</div>
    <p class="dca-foot">Simulated at daily adjusted closes (split-safe), no costs or taxes, verdicts from the
      calls ledger exactly as they stood each day. A short window — read the trend, not one snapshot.
      Informational only, not advice.</p>
  </div>`;
}

/* ---------- tabs ---------- */
function initTabs() {
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll(".tabpanel").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      t.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
      document.getElementById("tab-" + t.dataset.tab).classList.add("active");
      if (t.dataset.tab === "informed") enterInformed(); else leaveInformed();
      if (t.dataset.tab === "daily") enterDaily(); else leaveDaily();
      if (t.dataset.tab === "universe") { resumeUniverseCycler(); syncUniverseHScroll(); } else pauseUniverseCycler();
      if (t.dataset.tab === "charts") enterCharts(); else leaveCharts();
      if (t.dataset.tab === "estimates") enterEstimates();
    }));
}

function initGuide() {
  const g = document.getElementById("tab-guide");
  if (!g || g._wired) return;
  g._wired = true;
  g.querySelectorAll("[data-goto]").forEach((el) => el.addEventListener("click", () => {
    const b = document.querySelector('.tab[data-tab="' + el.dataset.goto + '"]');
    if (b) { b.click(); window.scrollTo(0, 0); }
  }));
  const tryBtn = g.querySelector("#guide-try-stock");
  if (tryBtn) tryBtn.addEventListener("click", () => {
    // The example MUST be a Shariah-compliant universe name. Picking the largest holding
    // outright opened RKLB — NON-COMPLIANT, so it is not in the ranked universe at all and
    // its drawer has no QARP breakdown and no Shariah grade, i.e. none of the three things
    // this button promises to show. Largest COMPLIANT holding first (a name he actually
    // owns makes the best example), then fall back to the top-ranked universe name.
    const inUniverse = new Set((DATA.universe || []).map((r) => r.ticker));
    const h = [...(DATA.portfolio || [])]
      .filter((p) => inUniverse.has(p.ticker) && p.shariah !== "NON-COMPLIANT")
      .sort((x, y) => (y.weight_pct || 0) - (x.weight_pct || 0))[0] || (DATA.universe || [])[0];
    if (h) openDrawer(h.ticker);
  });
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

  // Lead — The Market Today. On reload, paint the last cached column INSTANTLY (no fallback flash);
  // loadDailyBrief refreshes it below. Only show the data-driven fallback when there's no fresh cache.
  let _cl = null;
  try { _cl = JSON.parse(sessionStorage.getItem("jc_lead") || "null"); } catch (e) {}
  if (_cl && _cl.html && leadFresh(_cl.date)) {
    document.getElementById("paper-lead").innerHTML = _cl.html;
  } else if (uni.length) {
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
    const { usd: todayUsd, pct: todayPct } = portfolioDayPnl();   // exact, shared with the KPI strip
    const pUp = port.filter((h) => h.day_pct > 0).length, pDown = port.filter((h) => h.day_pct < 0).length;
    const ps = [...port].sort((a, b) => b.day_pct - a.day_pct);
    const mv = (h) => `<li><span class="mv-tk">${esc(h.ticker)}</span><span class="${signClass(h.day_pct)}">${fmtPct(h.day_pct)}</span></li>`;
    document.getElementById("paper-portfolio").innerHTML =
      `<div class="side-head">Jaleel's Portfolio ${sessionSub()}</div>`
      + `<p class="side-body">Jaleel's book is <b class="${signClass(todayPct)}">${todayPct >= 0 ? "up" : "down"} ${fmtPct(Math.abs(todayPct))}</b>${todayUsd != null ? ` (${todayUsd >= 0 ? "+" : "−"}${fmtUSD(Math.abs(todayUsd), 0)})` : ""} on the day — ${pUp} green, ${pDown} red.</p>`
      + `<ul class="mv-list">${ps.slice(0, 3).map(mv).join("")}${ps.slice(-2).reverse().map(mv).join("")}</ul>`;
  }
  // Sector Watch
  if (uni.length) {
    document.getElementById("paper-sectors").innerHTML =
      `<div class="side-head">Sector Watch ${sessionSub()}</div>`
      + `<ul class="mv-list">${secMoves().map((m) => `<li><span class="mv-tk">${esc(m.s)}</span><span class="${signClass(m.avg)}">${fmtPct(m.avg)}</span></li>`).join("")}</ul>`;
  }
  // Movers
  if (uni.length) {
    const sorted = [...uni].sort((a, b) => b.day_pct - a.day_pct);
    const row = (x) => `<li><span class="mv-tk">${esc(x.ticker)}</span><span class="${signClass(x.day_pct)}">${fmtPct(x.day_pct)}</span></li>`;
    document.getElementById("paper-movers").innerHTML =
      `<div class="side-head">Movers ${sessionSub()}</div>`
      + `<div class="mv-cols"><div><div class="mv-lbl pos">Gainers</div><ul class="mv-list">${sorted.slice(0, 4).map(row).join("")}</ul></div>`
      + `<div><div class="mv-lbl neg">Decliners</div><ul class="mv-list">${sorted.slice(-4).reverse().map(row).join("")}</ul></div></div>`;
  }
  // Number of the Day — NYT-style boxed stat pulled from live data
  const ndEl = document.getElementById("paper-numday");
  if (ndEl && uni.length) {
    const sorted = [...uni].sort((a, b) => b.day_pct - a.day_pct);
    const g = sorted[0];
    const ups = uni.filter((x) => x.day_pct > 0).length, downs = uni.filter((x) => x.day_pct < 0).length;
    ndEl.innerHTML = `<div class="numday-label">Number of the Day ${sessionSub()}</div>`
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
  const fresh = !!(b && b.date && b.body_html && leadFresh(b.date));
  if (fresh && b.body_html) {
    const el = document.getElementById("paper-lead");
    if (el) {
      const laggy = DATA.meta && b.date < asOfDate(DATA.meta.date);   // a real column, but trailing the live session
      el.innerHTML = `<div class="lead-kicker">${esc(b.kicker || "The Market Today")}</div>`
        + `<h2 class="lead-head">${esc(b.headline || "")}</h2>`
        + `<div class="lead-byline">By The Market Desk${laggy ? ` · as of ${fullDayName(b.date)}’s close` : (b.generated_at ? " · " + esc(b.generated_at) : "")}</div>`
        + `<div class="lead-body">${b.body_html}</div>`;
      try { sessionStorage.setItem("jc_lead", JSON.stringify({ date: b.date, html: el.innerHTML })); } catch (e) {}
    }
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
  const sub = held ? (held.shares != null ? `${fmtNum(held.shares, 2)} sh` : `${fmtNum(held.weight_pct, 1)}% wt`) : (r.sub || "cluster");
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
  const held = new Set((typeof DATA !== "undefined" && DATA.portfolio) ? DATA.portfolio.map((h) => h.ticker) : []);
  return arr
    .filter((n) => n.title && n.url && (!relOnly || n.rel) && (!tickers || (n.tickers || []).some((t) => tickers.has(t))))
    .map((n) => ({ headline: n.title, url: n.url, source: "Benzinga", datetime: n.ts, image: "",
                   _rel: typeof n.relevance === "number" ? n.relevance : null,   // embedding relevance score
                   _hold: !!n.rel,                                               // mentions a holding/universe name
                   _tk: tickers ? (n.tickers || []).find((t) => tickers.has(t))
                                : ((n.tickers || []).find((t) => held.has(t)) || null) }));
}
function mergeNews(primary, extra, sortBy) {
  const seen = new Set();
  const all = [...primary, ...extra].filter((it) => it && it.url && !seen.has(it.url) && seen.add(it.url));
  if (sortBy === "relevance") {
    const rk = (x) => (x._rel == null ? -1 : x._rel);   // unscored (Finnhub) items sink below scored ones
    all.sort((a, b) => (rk(b) - rk(a)) || ((b.datetime || 0) - (a.datetime || 0)));
  } else {
    all.sort((a, b) => (b.datetime || 0) - (a.datetime || 0));
  }
  return all;
}

// Caption + Latest/Most-relevant toggle — makes the embedding dedup + scoring visible & usable.
function renderNewsSort() {
  const el = document.getElementById("news-sort");
  if (!el) return;
  const opt = (v, label) => `<button type="button" class="news-sort-btn ${newsSort === v ? "active" : ""}" data-sort="${v}">${label}</button>`;
  el.innerHTML = `<span class="news-sort-cap">Finance-only &middot; duplicates removed &middot; scored for relevance</span>`
    + `<span class="news-sort-btns">${opt("latest", "Latest")}${opt("relevance", "Most relevant")}</span>`;
  el.querySelectorAll(".news-sort-btn").forEach((b) => b.addEventListener("click", () => {
    if (newsSort !== b.dataset.sort) { newsSort = b.dataset.sort; loadNews(); }
  }));
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

// (Smart Money 13F subtab REMOVED 2026-08-05 — owner: "useless and of no value".
//  gurus.py + the daily.yml refresh step went with it.)

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
// v2 (2026-08-05, owner-directed after RKLB said TRIM from $150 to $55 and through the
// bounce): the old rule was verdict arithmetic — an AVOID holding scored -2 and could never
// escape TRIM (best analyst reading lands exactly on the threshold), with price, cost,
// momentum and catalysts not inputs at all. New shape: the verdict sets the long-term stance,
// but the DAILY call is forward-looking — catalysts + the Street + the tape + cost basis.
// TRIM only ever fires INTO STRENGTH (in profit, uptrend, catalysts exhausted) — never at a
// loss below cost (standing rule: concentration is cured by addition, weakness is for DCA).
// Sizing doctrine v2 (user-approved 2026-08-07): a FULL position scales with the
// live book instead of a static dollar line (the old $1,050 was ~5% of a $21k book
// and drifted as the book grew). Conviction buys a bigger allowance, inside a band:
//   BUY and below .... 6% of book     STRONG BUY / STRONGEST .... 8% of book
// floor $1,000. Keep in sync with earnings_desk.py full_weight_usd().
const FULL_WEIGHT_FLOOR = 1000;
function bookValueUsd() {
  return ((DATA && DATA.portfolio) || []).reduce((s, h) => s + (h.value || 0), 0);
}
function fullWeightUsd(verdict) {
  const pct = (verdict === "STRONG BUY" || verdict === "STRONGEST") ? 0.08 : 0.06;
  return Math.max(FULL_WEIGHT_FLOOR, bookValueUsd() * pct);
}
function holdingCall(tk) {
  const pb = (SIGNALS && SIGNALS.portfolio_brief && SIGNALS.portfolio_brief[tk]) || {};
  const h = DATA.portfolio.find((x) => x.ticker === tk) || {};
  const row = (DATA.universe || []).find((x) => x.ticker === tk) || h;   // non-compliant: portfolio row carries mom/catalyst
  const qarp = pb.qarp || h.verdict || "";
  const cons = pb.consensus || null;
  const sev = riskSevFor(tk);
  const gate = (gateNow(Object.assign({}, row, { price: h.price })) || {}).state || null;
  const avgCost = h.avg_cost != null ? h.avg_cost : (h.shares ? h.cost / h.shares : null);
  const inProfit = avgCost != null && h.price >= avgCost;
  // at-full check: live dollars when the owner blob is unlocked; otherwise the build-baked
  // fw_x multiple (same doctrine, refreshed every cloud publish). Without this branch the
  // locked engine read (0 >= $1,000) and could never call a position full.
  const full = privUnlocked() ? (h.value || 0) >= fullWeightUsd(qarp) : (h.fw_x || 0) >= 1;
  const chip = row.catalyst || null;
  const chipHook = !!(chip && (chip.label === "SET" || chip.label === "WATCH"));
  // a near-unanimous bullish panel is a standing forward signal even between news cycles
  const panelHook = !!(cons && cons.label === "Strong Buy" && !cons.bearish && cons.total >= 8 && cons.bullish / cons.total >= 0.7);
  const hooks = [];
  if (chipHook) hooks.push(`catalyst ${chip.label}`);
  if (panelHook) hooks.push(`Street ${cons.bullish}/${cons.total} bullish, 0 bearish`);
  const en = (SIGNALS && SIGNALS.earnings_next && SIGNALS.earnings_next[tk]) || null;
  const daysToPrint = en ? Math.round((new Date(en) - Date.now()) / 86400000) : null;
  const eventRisk = daysToPrint != null && daysToPrint >= 0 && daysToPrint <= 5;
  const Q = { STRONGEST: 2, "STRONG BUY": 2, BUY: 1, "HOLD-QUAL": 0, AVOID: -2, "STRONG AVOID": -3 };
  const bits = [];
  if (qarp) bits.push(`QARP ${qarp}`);
  if (cons && cons.label) bits.push(`analysts ${cons.label}`);
  if (gate) bits.push(`gate ${gate}`);
  if (avgCost != null) bits.push(`${inProfit ? "above" : "below"} avg cost ${fmtUSD(avgCost, 2)}`);
  if (hooks.length) bits.push(hooks.join(" + "));
  if (sev) bits.push(`${sev} risk flag`);
  if (eventRisk) bits.push(`earnings ${en} = event risk`);
  let call = "HOLD", dca = false, extra = "";
  const qpts = Q[qarp] ?? 0;
  if (qpts >= 1) {
    // BUY+ holdings: accumulate when the tape and calendar allow, position not yet full
    if (!full && gate !== "WAIT" && sev !== "elevated" && !eventRisk) { call = "ADD"; }
    else { extra = full ? " At full weight — adds go to underweight names." :
           eventRisk ? " Print this week caps it at Hold." :
           sev === "elevated" ? " News flag caps it at Hold." :
           " Knife gate (below 20DMA) caps it at Hold."; }
  } else if (qpts <= -2) {
    // AVOID-class holding: long-term exit stands, but timing is catalysts + strength
    if (hooks.length && !inProfit && !full && sev !== "elevated" && !eventRisk) {
      call = "ADD"; dca = true; extra = " DCA into weakness — catalysts and the Street argue the fall is sentiment, not thesis.";
    } else if (inProfit && (gate === "GO" || gate === "TURN") && (!hooks.length || sev === "elevated")) {
      call = "TRIM"; extra = " Exit into strength — in profit, uptrend, no pending catalyst holding the exit open.";
    } else if (inProfit && hooks.length) {
      extra = " In profit but catalysts pending — let them play before exiting into strength.";
    } else if (hooks.length) {
      extra = full ? " Catalysts pending; DCA blocked at full weight — hold for strength." :
                     " Catalysts pending — patience over a sell-at-a-loss.";
    } else {
      extra = ` Below cost with no catalyst — exit discipline: sell strength, not weakness (watch ${avgCost != null ? fmtUSD(avgCost, 2) : "avg cost"}).`;
    }
  }
  // HOLD-QUAL (qpts 0): always HOLD — flags and catalysts annotate, never flip the badge alone
  return { call, dca, reason: bits.join(" · ") + "." + extra, qarp, sev };
}
function renderCalls() {
  const el = document.getElementById("calls-list");
  if (!el) return;
  const pb = (SIGNALS && SIGNALS.portfolio_brief) || {};
  const holds = [...DATA.portfolio].sort((a, b) => (b.weight_pct || 0) - (a.weight_pct || 0));
  el.innerHTML = holds.map((h) => {
    const c = holdingCall(h.ticker);
    const name = (pb[h.ticker] || {}).name || h.name || h.ticker;
    const cl = c.call.toLowerCase();
    return `<div class="call-row ${cl}">
      <div class="call-tk"><span class="ctk">${esc(h.ticker)}</span><span class="cnm">${esc(name)}</span></div>
      <span class="call-badge ${cl}">${c.call}${c.dca ? " · DCA" : ""}</span>
      <div class="call-reason">${esc(c.reason)}</div>
    </div>`;
  }).join("");
}

// Per-holding latest reported financials (SEC EDGAR XBRL — official as-filed GAAP numbers).
function renderEarnings() {
  const el = document.getElementById("earnings-list");
  if (!el) return;
  // SOURCE (changed 2026-07-31): each holding's own sec_fin, from sec_financials.py — the same
  // primary-source pipeline the Filings subtab and the drawer use. It was reading
  // SIGNALS.financials, a SECOND XBRL fetcher that treats any failed EDGAR request as "this
  // company doesn't use this tag" and so silently fell back to discontinued legacy revenue
  // tags: ABT showed FY2017, SPGI Q3 FY2018, EXE FY2020, and KO was missing altogether.
  // Those ancient filings carry no matching EPS/net-income points, which is why the panel
  // rendered a lone Revenue line. sec_fin drops non-recent points instead of degrading.
  const pb = (SIGNALS && SIGNALS.portfolio_brief) || {};
  const holds = [...DATA.portfolio].sort((a, b) => (b.value || 0) - (a.value || 0));
  const yoy = (y) => (y == null ? "" : `<span class="er-yoy ${y >= 0 ? "pos" : "neg"}">${y >= 0 ? "+" : ""}${y}% YoY</span>`);
  const stat = (label, val, y) => `<div class="er-stat"><div class="er-l">${label}</div><div class="er-v">${val} ${yoy(y)}</div></div>`;
  const fdate = (d) => { try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch (e) { return d; } };
  el.innerHTML = holds.map((h) => {
    const f = h.sec_fin;
    const name = (pb[h.ticker] || {}).name || h.name || h.ticker;
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
    const pt = r.pt ? `target ${esc(r.pt)} vs ${fmtUSD(r.price, 0)} ${sessionWord()}` : "";
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
  const asof = marketOpenNow() ? "" : `<span class="pt-item pt-asof">as of ${fullDayName(DATA.meta.date)}'s close</span>`;
  el.innerHTML = cards.join("") + asof;
}


/* ---------- live prices (Finnhub, browser-side) ---------- */
const LIVE_INTERVAL_MS = 60000;  // holdings refresh ~every 60s (≈17 calls/min)
const UNIVERSE_PUMP_MS = 2400;   // 1 universe name per 2.4s (≈25/min; was 1.2s but cycler+holdings
                                 // ≈67/min blew the 60/min Finnhub quota and starved the holdings
                                 // tick — 2026-07-27 stuck-"connecting" incident); rank order, so
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
  // NYSE holiday (full close) — reuse the same set that rolls the "as of" date back. Without
  // this, a WEEKDAY holiday during market hours (e.g. Fri Jul 3 2026, observed Independence Day)
  // reads as "live". Compute today's ET date and check it against the holiday calendar.
  const etIso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (NYSE_HOLIDAYS.has(etIso)) return false;
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
  // Backing off after a 429 (throttleUntil was SET but never READ before 2026-07-27 —
  // the dead throttle let ticks keep burning quota mid-rate-limit, so the holdings
  // tick could stay starved forever, pinning the pill on "connecting…").
  if (Date.now() < throttleUntil) {
    if (lastGoodTs) setLivePill("live", `LIVE · ${lastGoodClock} · delayed`);
    return;
  }

  let ok = 0, fail = 0;
  await Promise.all(DATA.portfolio.map(async (h) => {
    try {
      const q = await fetchQuote(h.ticker, key);
      if (q && typeof q.c === "number" && q.c > 0) {
        h.price = q.c;
        if (typeof q.dp === "number") h.day_pct = +q.dp.toFixed(2);
        if (h.shares != null) {   // owner tier merged: full dollar recompute
          h.value = +(h.shares * q.c).toFixed(2);
          h.gain = +(h.value - h.cost).toFixed(2);
          h.gain_pct = +((h.gain / h.cost) * 100).toFixed(2);
        } else if (h.avg_cost) {  // locked: gain% still tracks live off the public avg cost
          h.gain_pct = +((q.c / h.avg_cost - 1) * 100).toFixed(2);
        }
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
    if (privUnlocked()) {   // dollar totals only exist on the owner tier
      const positions = DATA.portfolio.reduce((s, h) => s + h.value, 0);
      DATA.portfolio.forEach((h) => (h.weight_pct = +(h.value / positions * 100).toFixed(1)));
      const t = DATA.meta.portfolio_totals;
      t.positions = +positions.toFixed(2);
      t.account = +(positions + t.cash).toFixed(2);
      t.gain = +(positions - t.cost).toFixed(2);
      t.gain_pct = +((t.gain / t.cost) * 100).toFixed(2);
      flashAccount(t.account);
    }
    renderPortfolio();      // re-renders the KPI strip (inside this panel) + donut + table
    patchLivePrices();      // reflect holdings' live price/day in the Universe + Overview tabs
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
  if (Date.now() < throttleUntil) return; // honor the 429 backoff — holdings tick gets the quota first
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
let newsSort = "latest";   // "latest" (chronological) | "relevance" (embedding score)
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
const lastIdxQuote = {};   // sym -> last good quote; a rate-limited refresh must never blank a card
async function renderIndexes() {
  const key = DATA.meta && DATA.meta.quote_proxy;
  const row = document.getElementById("idx-row");
  if (!row) return;
  if (!key) { row.innerHTML = `<div class="idx-card"><span class="muted">Live market data needs the API key.</span></div>`; return; }
  let latestT = 0;
  // 2026-07-28 (user saw an empty S&P card + a day-old stamp): honor the 429 backoff like the
  // other loops, and on any fetch failure fall back to the last good quote — the honest "as of"
  // stamp below (driven by q.t) is what signals staleness, never a blank card.
  // 2026-08-04 (user: "always not working"): the two index fetches starve behind the holdings
  // burst on the shared 60/min key, so a fresh session could sit on "—" forever. Seed the
  // fallback from the BUILD-TIME quote baked into the payload (meta.index_quotes) — the as-of
  // stamp stays honest; a live fetch overwrites the bake the moment one gets through.
  const baked = (DATA.meta && DATA.meta.index_quotes) || {};
  for (const ix of INDEXES) {
    if (!lastIdxQuote[ix.sym] && baked[ix.sym] && baked[ix.sym].c) {
      lastIdxQuote[ix.sym] = Object.assign({ _baked: true }, baked[ix.sym]);
    }
  }
  const throttled = Date.now() < throttleUntil;
  const cards = await Promise.all(INDEXES.map(async (ix) => {
    let q = null;
    if (!throttled) {
      try {
        q = await fetchQuote(ix.sym, key);
        if (!q || typeof q.c !== "number" || !q.c) q = null;
        else lastIdxQuote[ix.sym] = q;
      } catch (e) { q = null; }
    }
    if (!q) q = lastIdxQuote[ix.sym] || null;
    if (!q) return `<div class="idx-card"><div class="idx-top"><span class="idx-name">${esc(ix.label)}</span></div><div class="idx-level muted">—</div></div>`;
    if (q.t && q.t > latestT) latestT = q.t;
    const up = (q.d || 0) >= 0;
    return `<div class="idx-card ${up ? "up" : "down"}">
      <div class="idx-name">${esc(ix.label)} <span class="idx-tick">· ${esc(ix.sym)} ETF</span></div>
      <div class="idx-pct ${up ? "pos" : "neg"}">${up ? "▲" : "▼"} ${Math.abs(q.dp).toFixed(2)}%</div>
      <div class="idx-price">$${fmtNum(q.c, 2)} <span class="${up ? "pos" : "neg"}">${q.d >= 0 ? "+" : "−"}$${fmtNum(Math.abs(q.d), 2)}</span></div>
    </div>`;
  }));
  row.innerHTML = cards.join("");
  const asof = document.getElementById("idx-asof");
  if (asof) asof.textContent = latestT ? "as of " + asOfLabel(latestT) : "";
  // One retry per cycle: the 60s holdings burst usually empties the minute's quota right
  // before this runs — a lone re-attempt a few seconds later routinely sneaks through.
  // 2026-08-04: time the retry to land AFTER the 429 backoff expires (the old fixed 4.5s
  // fired mid-throttle and wasted itself), and keep retrying while a card is missing or
  // still showing the build-time bake.
  if (INDEXES.some((ix) => !lastIdxQuote[ix.sym] || lastIdxQuote[ix.sym]._baked) && !renderIndexes._retry) {
    renderIndexes._retry = true;
    const wait = Math.max(4500, (throttleUntil || 0) - Date.now() + 1500);
    setTimeout(async () => { await renderIndexes(); renderIndexes._retry = false; }, wait);
  }
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
  const lead = it._tk ? `<span class="news-tk">${esc(it._tk)}</span>` : `<span class="news-row-dot${it._relHi ? " hi" : ""}"></span>`;
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
function renderNewsFeed(container, items, emptyLabel, sortBy) {
  items = items.filter((it) => it && it.headline && it.url && isTrustedSource(it));
  if (!items.length) { container.innerHTML = `<p class="muted">${esc(emptyLabel || "No recent headlines.")}</p>`; return; }
  // mark the top tercile of scored stories so the embedding relevance is visible at a glance
  const scored = items.map((it) => it._rel).filter((r) => typeof r === "number").sort((x, y) => y - x);
  const relHi = scored.length >= 4 ? scored[Math.floor(scored.length / 3)] : Infinity;
  items.forEach((it) => { it._relHi = typeof it._rel === "number" && it._rel >= relHi; });
  if (sortBy === "relevance") {   // ranked list: most-relevant first, no photo-cards-on-top split
    container.innerHTML = `<div class="news-rows">${items.map(newsRowHtml).join("")}</div>`;
    return;
  }
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
  renderNewsSort();
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
  renderNewsFeed(list, mergeNews(bz, items, newsSort), `No recent headlines for ${newsFilter}.`, newsSort);
}

function enterInformed() {
  if (!informedLoaded) { renderNewsFilters(); loadNews("Top Stories"); informedLoaded = true; }
  renderIndexes();
  if (informedTimer) clearInterval(informedTimer);
  informedTimer = setInterval(renderIndexes, 65000); // 65s: deliberately de-synced from the 60s holdings burst
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
  const el = document.getElementById("pdates-list");
  if (!el) return;
  el.innerHTML = `<p class="news-loading">Loading earnings dates…</p>`;
  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 130 * 86400000).toISOString().slice(0, 10);
  // PRIMARY: the server-computed map (Benzinga ∪ Finnhub, refreshed every signals run) —
  // the old all-at-once browser fetch tripped rate limits (silent gaps) and took Finnhub's
  // first row instead of the NEAREST date (wrong quarter when two were in the window).
  const srv = (typeof SIGNALS !== "undefined" && SIGNALS && SIGNALS.earnings_next) || {};
  // Estimates Desk enrichment (2026-08-07): the dormant hour/est-EPS row slots
  // light up for names the desk covers (payload-carried, no extra fetches)
  const edm = {};
  ((DATA.estimates && DATA.estimates.docket) || []).forEach((x) => { edm[x.tk] = x; });
  const events = [];
  const missing = [];
  for (const h of (DATA.portfolio || [])) {
    const d = srv[h.ticker];
    const x = edm[h.ticker];
    if (d && d >= from) events.push({ tk: h.ticker, date: d, src: "srv",
      hour: x && x.print_date === d ? x.hour : undefined,
      epsEst: x && x.print_date === d && x.eps ? x.eps.avg : undefined });
    else missing.push(h.ticker);
  }
  // FALLBACK: live Finnhub for names the server map lacks — SEQUENTIAL + paced (no burst),
  // and always the MINIMUM future date, never [0]
  const key = DATA.meta && DATA.meta.finnhub_key;
  if (key) {
    for (const tk of missing) {
      try {
        const res = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${tk}&token=${key}`, { cache: "no-store" });
        const j = await res.json();
        const ds = (j.earningsCalendar || []).map((e) => e.date).filter((d) => d && d >= from).sort();
        if (ds.length) events.push({ tk, date: ds[0], src: "live" });
        await new Promise((r) => setTimeout(r, 250));
      } catch (e) { /* leave missing */ }
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  const still = (DATA.portfolio || []).map((h) => h.ticker).filter((t) => !events.some((e) => e.tk === t));
  el.innerHTML = events.length
    ? `<div class="dates-card"><h4 class="dates-h">Upcoming earnings</h4><div class="dates-rows">${events.map(pDateRowHtml).join("")}</div>
       ${still.length ? `<p class="muted" style="font-size:11.5px;margin:8px 0 0">No confirmed date yet: ${still.join(", ")} (calendars fill in as companies announce).</p>` : ""}</div>`
    : `<p class="muted">No upcoming earnings dates found.</p>`;
}

function initPortfolioSubtabs() {
  document.querySelectorAll("#p-subtabs .subtab").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("#p-subtabs .subtab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll("#tab-portfolio .psub").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      document.getElementById("psub-" + b.dataset.psub).classList.add("active");
      if (b.dataset.psub === "signals") { renderCalls(); renderSignals(); renderAdditions(); }
      if (b.dataset.psub === "briefing") renderBriefing();
      if (b.dataset.psub === "earnings") renderEarnings();
      if (b.dataset.psub === "news" && !pNewsLoaded) { pNewsLoaded = true; loadPortfolioNews(); }
      if (b.dataset.psub === "dates") loadPortfolioDates();
    }));
}

/* ---------- Zakat, integrated into the Portfolio (user pref 2026-07-27: no separate
   tab, no per-holding list — just the numbers, where the money is shown).
   Book: Zoya-style per-holding age — held <12mo = 100% of market value zakatable,
   >=12mo = 30% liquid-assets proxy. Ages come from the desk's earliest record of the
   name (can only UNDERSTATE true age -> stricter 100% -> the safe direction); unknown
   = 100%. Cash is fully zakatable. Realized: 2.5% of net realized gains (all closed
   trades so far are <12mo holds). Scholars differ on method — the Method note in the
   old subtab was retired with it; the user owns the ruling, we own the arithmetic. */
const ZAKAT_RATE = 0.025, ZAKAT_PROXY = 0.30, ZAKAT_LT_DAYS = 365;
function zakatAcquired(ticker) {
  let first = null;
  (DATA.calls || []).forEach((c) => {
    if (c.ticker === ticker && c.start_date && (!first || c.start_date < first)) first = c.start_date;
  });
  return first;
}
function zakatHeldDays(ticker) {
  const d = zakatAcquired(ticker);
  return d ? Math.floor((Date.now() - new Date(d + "T00:00:00Z")) / 86400000) : null;
}
function zakatOnBook() {
  if (!privUnlocked()) return null;   // computed purely from owner-tier values
  const cash = (DATA.meta.portfolio_totals && DATA.meta.portfolio_totals.cash) || 0;
  const base = DATA.portfolio.reduce((s, h) => {
    const days = zakatHeldDays(h.ticker);
    const f = (days !== null && days >= ZAKAT_LT_DAYS) ? ZAKAT_PROXY : 1;
    return s + (h.value || 0) * f;
  }, 0) + cash;
  return base * ZAKAT_RATE;
}

// Secondary views shown ONLY under S&P 500: Universe table vs Track Record scorecard.
function setSpView(view) {
  document.querySelectorAll("#sp-views .subtab").forEach((x) =>
    x.classList.toggle("active", x.dataset.spview === view));
  document.getElementById("usub-universe").classList.toggle("active", view === "universe");
  document.getElementById("usub-record").classList.toggle("active", view === "record");
  document.getElementById("usub-filings").classList.toggle("active", view === "filings");
  if (view === "record") {
    renderScorecard();
    pauseUniverseCycler();
  } else if (view === "filings") {
    renderFilings();
    pauseUniverseCycler();
  } else {
    uIndex = "US Equities";
    renderVerdictSummary(); renderDeskDiscipline();
    renderUniverseControls();
    renderUniverseTable();
    resumeUniverseCycler();
  }
}

/* ---------- Filings: latest SEC-filed quarter for every scored name ---------- */
// The build can only link the accession DIRECTORY (sec_financials.py works from XBRL
// company-facts, which carry the accession number but no document name — the raw file
// listing the reader used to land on). The document name lives in EDGAR's submissions API,
// which is CORS-open, so resolve it AT CLICK TIME: open the directory immediately (popup
// blockers require a synchronous open; it doubles as the honest fallback), then redirect
// that tab to the primary document once the accession matches. Holdings' Briefing chips
// already get the resolved URL from the cloud (benzinga_signals.py) — this brings the
// other 500+ names to the same reading experience without a universe-wide EDGAR crawl.
const SEC_SUBS = new Map();   // cik10 -> Promise<filings.recent>; one fetch per company per session
function secRecent(cik10) {
  if (!SEC_SUBS.has(cik10)) {
    SEC_SUBS.set(cik10, fetch("https://data.sec.gov/submissions/CIK" + cik10 + ".json")
      .then((r) => r.json()).then((d) => d.filings.recent)
      .catch((e) => { SEC_SUBS.delete(cik10); throw e; }));   // failed fetches don't poison the memo
  }
  return SEC_SUBS.get(cik10);
}
function secParse(url) { return (url || "").match(/edgar\/data\/(\d+)\/(\d+)\/?$/); }
function secDocUrl(f, cik, accn) {
  for (let i = 0; i < f.accessionNumber.length; i++) {
    if (f.accessionNumber[i].replace(/-/g, "") === accn && f.primaryDocument[i]) {
      return "https://www.sec.gov/Archives/edgar/data/" + Number(cik) + "/" + accn + "/" + f.primaryDocument[i];
    }
  }
  return null;
}
// Preferred path: rewrite the anchor IN PLACE as soon as it renders (drawer open) — by the
// time the reader clicks, it is a plain link straight to the document; no window.open, no
// popup-blocker or Safari cross-origin-redirect concerns, and cmd/middle-click work too.
async function resolveSecHref(a) {
  const m = secParse(a.getAttribute("href"));
  if (!m) return;
  try {
    const doc = secDocUrl(await secRecent(m[1].padStart(10, "0")), m[1], m[2]);
    if (doc) { a.href = doc; a.removeAttribute("onclick"); }
  } catch (_) { /* keep the directory href + the click-time fallback below */ }
}
// Click-time fallback (Filings' 500 rows aren't prefetched; a slow prefetch may not have
// landed): open the directory synchronously (popup blockers need the user gesture; it is
// also the honest fallback), then redirect that tab once the document name resolves.
async function openSecDoc(ev, a) {
  ev.stopPropagation();                       // Filings rows also open the drawer on click
  const url = a.href;
  const m = secParse(url);
  const w = m ? window.open(url, "_blank") : null;
  if (!w) return;                             // popup blocked or already a document link — default nav
  ev.preventDefault();
  try {
    const doc = secDocUrl(await secRecent(m[1].padStart(10, "0")), m[1], m[2]);
    if (doc) { a.href = doc; a.removeAttribute("onclick"); w.location = doc; }
  } catch (_) { /* the directory tab is already open — the honest fallback */ }
}
let filingsSort = { key: "filed", dir: -1 };
function renderFilings() {
  const host = document.getElementById("filings-table");
  if (!host) return;
  const rows = (DATA.universe || []).filter((r) => r.sec_fin);
  const naRows = (DATA.universe || []).filter((r) => !r.sec_fin);
  const sv = (r) => {
    const f = r.sec_fin;
    switch (filingsSort.key) {
      case "ticker": return r.ticker;
      case "revyoy": return (f.revenue && f.revenue.yoy != null) ? f.revenue.yoy : -1e9;
      case "epsyoy": return (f.eps && f.eps.yoy != null) ? f.eps.yoy : -1e9;
      case "ni": return (f.net_income && f.net_income.val != null) ? f.net_income.val : -1e18;
      case "nm": return (f.net_income && f.revenue && f.revenue.val) ? f.net_income.val / f.revenue.val : -1e9;
      case "qarp": return r.qarp || 0;
      default: return f.filed || "";
    }
  };
  rows.sort((a, b) => (sv(a) > sv(b) ? 1 : sv(a) < sv(b) ? -1 : 0) * filingsSort.dir);
  const yoy = (y) => y == null ? '<span class="muted">—</span>'
    : `<span class="${y >= 0 ? "pos" : "neg"}">${y >= 0 ? "+" : ""}${y}%</span>`;
  const arrow = (k) => filingsSort.key === k ? (filingsSort.dir === 1 ? " ↑" : " ↓") : "";
  host.innerHTML = `<div class="table-wrap"><table class="u-table"><thead><tr>
      <th class="left" data-fk="ticker">Name${arrow("ticker")}</th>
      <th class="left">Quarter</th>
      <th data-fk="qarp">QARP${arrow("qarp")}</th>
      <th>Revenue</th><th data-fk="revyoy">Rev YoY${arrow("revyoy")}</th>
      <th>Dil. EPS</th><th data-fk="epsyoy">EPS YoY${arrow("epsyoy")}</th>
      <th data-fk="ni">Net income${arrow("ni")}</th>
      <th data-fk="nm">Net margin${arrow("nm")}</th>
      <th class="left" data-fk="filed">Filing${arrow("filed")}</th></tr></thead><tbody>
    ${rows.map((r) => { const f = r.sec_fin; return `<tr data-ticker="${r.ticker}">
      <td class="left"><span class="tick">${r.ticker}<span class="name">${esc(r.name || "")}</span></span></td>
      <td class="left"><span class="muted">${esc((f.period || "").replace("Q ended ", ""))}</span></td>
      <td><span class="qarp-cell">${fmtNum(r.qarp, 1)}</span></td>
      <td>${f.revenue ? esc(f.revenue.fmt) : '<span class="muted">—</span>'}</td>
      <td>${yoy(f.revenue && f.revenue.yoy)}</td>
      <td>${f.eps ? (f.eps.val < 0 ? "−$" + Math.abs(f.eps.val) : "$" + f.eps.val) : '<span class="muted">—</span>'}</td>
      <td>${yoy(f.eps && f.eps.yoy)}</td>
      <td>${f.net_income ? `<span class="${f.net_income.val < 0 ? "neg" : ""}">${esc(f.net_income.fmt)}</span>` : '<span class="muted">—</span>'}</td>
      <td>${(f.net_income && f.revenue && f.revenue.val) ? `<span class="${f.net_income.val < 0 ? "neg" : "pos"}">${(f.net_income.val / f.revenue.val * 100).toFixed(1)}%</span>` : '<span class="muted">—</span>'}</td>
      <td class="left">${f.url ? `<a class="er-link" href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener noreferrer" onclick="openSecDoc(event, this)">${esc(f.form || "")} · ${esc(f.filed || "")}</a>` : esc(f.filed || "")}</td>
    </tr>`; }).join("")}
  </tbody></table></div>
  ${naRows.length ? `<p class="muted" style="margin-top:10px;font-size:12px">${naRows.length} name${naRows.length > 1 ? "s" : ""} without SEC XBRL (foreign filers / recent listings): ${naRows.map((r) => r.ticker).join(", ")}.</p>` : ""}`;
  host.querySelectorAll("th[data-fk]").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.fk;
    if (filingsSort.key === k) filingsSort.dir *= -1;
    else filingsSort = { key: k, dir: k === "ticker" ? 1 : -1 };
    renderFilings();
  }));
  host.querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => openDrawer(tr.dataset.ticker)));
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
        renderVerdictSummary(); renderDeskDiscipline();
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
  // DISABLED 2026-07-01 per user: the book brief was persistently inaccurate. Kept hidden.
  // To re-enable, delete the next line.
  el.hidden = true; return;
  // The book read is a POST-CLOSE reflection — irrelevant during the live session, so show it
  // only when the market is closed (after the close, overnight, pre-open, weekends/holidays).
  if (marketOpenNow()) { el.hidden = true; return; }
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
  // The book read is a POST-CLOSE reflection of the session b.date — label it by ITS OWN date,
  // not the live price payload, so during the next session it stays "as of <that day>'s close"
  // instead of mislabeling the prior-close write-up as "today".
  const asOf = b.date ? `<span class="side-sub closed">as of ${fullDayName(b.date)}'s close</span>` : sessionSub();
  el.innerHTML = `<div class="book-head"><h3>Jaleel's book ${asOf}</h3><span class="book-when">${esc(b.generated_at || "")}</span></div>`
    + `<div class="book-body">${b.your_book}</div>${attHtml}`
    + `<div class="book-foot">Written by Claude &middot; informational only, not advice</div>`;
  el.hidden = false;
  el.querySelectorAll(".book-att-row").forEach((r) => r.addEventListener("click", () => openDrawer(r.dataset.tk)));
}

function renderAll() {
  document.getElementById("asof-date").textContent = asOfDate(DATA.meta.date);
  renderVerdictSummary(); renderDeskDiscipline();
  renderUniverseControls();
  renderUniverseTable();
  renderScorecard();
  renderEtfs();
  renderVenture();
  renderPortfolio();
  loadSignals();         // fetch signals.json + live trigger prices, then render the Signals card
  loadBookBrief();       // fetch book_brief.json — Claude's daily "your book" read + attention digest
  enterDaily();          // Daily is the landing tab — render it + start its refresh
  initTabs();
  initGuide();
  startLive();
  startAutoRefresh();
}

let refreshTimer = null, lastPayloadIv = null;
const REFRESH_INTERVAL_MS = 7 * 60000;   // mid-session poll: pull the cloud's freshest build into an open tab
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(softRefresh, REFRESH_INTERVAL_MS);
}
// Re-render every payload-driven view from the current DATA, WITHOUT re-binding tab/guide handlers
// or restarting the live ticker — those are wired once at unlock.
function rerenderFromData() {
  document.getElementById("asof-date").textContent = asOfDate(DATA.meta.date);
  renderVerdictSummary(); renderDeskDiscipline();
  renderUniverseControls();
  renderUniverseTable();
  renderScorecard();
  renderEtfs();
  renderVenture();
  renderPortfolio();
  loadSignals();
  loadBookBrief();
  enterDaily();   // re-renders the front page (sidebars + the as-of label) and resets its own timer
}
// While the market is open, re-pull payload.enc; if the cloud has published a newer build (new IV),
// swap it in and re-render so an already-open tab updates within minutes — no manual reload needed.
async function softRefresh() {
  if (!marketOpenNow()) return;
  const pw = sessionStorage.getItem("jc_pw");
  if (!pw) return;
  try {
    const p = await (await fetch("payload.enc", { cache: "no-store" })).json();
    if (p && p.iv && p.iv === lastPayloadIv) return;   // identical ciphertext -> no new build, skip
    const fresh = await decryptPayload(p, pw);
    DATA = fresh; lastPayloadIv = p.iv;
    await refreshPrivateIntoData();   // a fresh DATA wiped the merged owner fields — re-merge BEFORE rendering
    rerenderFromData();
  } catch (e) { /* transient (offline / mid-publish) — keep showing the current data */ }
}

/* ---------- PRIVACY SPLIT: owner unlock machinery ---------- */
// Merge the decrypted private blob back into DATA (the reverse of the build-side split),
// then recompute dollars against whatever live prices have arrived since the build.
function mergePrivate(priv) {
  if (!priv || !DATA) return;
  PRIV = priv;
  (DATA.portfolio || []).forEach((h) => {
    const m = priv.portfolio && priv.portfolio[h.ticker];
    if (m) Object.assign(h, m);
  });
  if (priv.totals && DATA.meta && DATA.meta.portfolio_totals) Object.assign(DATA.meta.portfolio_totals, priv.totals);
  const R = DATA.realized || [], PR = priv.realized || [];
  R.forEach((r, i) => {
    const key = `${r.ticker}|${r.date_sold || ""}`;
    const pr = (PR[i] && PR[i].k === key) ? PR[i] : PR.find((x) => x.k === key);   // index first, key on skew
    if (pr) { r.shares = pr.shares; r.gain = pr.gain; }
  });
  // live prices may have moved since this blob was built — recompute value/gain/totals
  const t = (DATA.meta && DATA.meta.portfolio_totals) || {};
  let positions = 0;
  (DATA.portfolio || []).forEach((h) => {
    if (h.shares != null && h.price != null) {
      h.value = +(h.shares * h.price).toFixed(2);
      if (h.cost != null) { h.gain = +(h.value - h.cost).toFixed(2); if (h.cost) h.gain_pct = +((h.gain / h.cost) * 100).toFixed(2); }
    }
    positions += h.value || 0;
  });
  if (positions && t.cash != null) {
    t.positions = +positions.toFixed(2);
    t.account = +(positions + t.cash).toFixed(2);
    if (t.cost) { t.gain = +(positions - t.cost).toFixed(2); t.gain_pct = +((t.gain / t.cost) * 100).toFixed(2); }
  }
}
// Fetch + decrypt private.enc with the remembered owner passcode and merge it in.
// Wrong stored passcode (rotated) -> forget it and stay locked; network trouble -> keep
// the last good blob so an open tab never loses the owner view mid-session.
async function refreshPrivateIntoData() {
  const opw = localStorage.getItem("jc_owner_pw");
  if (!opw) return false;
  let p = null;
  try { p = await (await fetch("private.enc", { cache: "no-store" })).json(); }
  catch (e) { if (PRIV) mergePrivate(PRIV); return !!PRIV; }
  try {
    if (p && p.iv && p.iv === lastPrivateIv && PRIV) { mergePrivate(PRIV); return true; }
    const priv = await decryptPayload(p, opw);
    lastPrivateIv = p.iv;
    mergePrivate(priv);
    return true;
  } catch (e) {   // fetched fine but wouldn't decrypt = passcode changed
    localStorage.removeItem("jc_owner_pw");
    if (PRIV) mergePrivate(PRIV);
    return !!PRIV;
  }
}
// The small owner-gate modal (built on demand; newsprint tokens in styles.css .og-*).
function openOwnerGate() {
  if (privUnlocked()) return;
  if (document.getElementById("owner-gate")) return;
  const wrap = document.createElement("div");
  wrap.id = "owner-gate";
  wrap.innerHTML = `
    <div class="og-bg"></div>
    <form class="og-card">
      <h3>Owner unlock</h3>
      <p class="og-note">Dollar amounts and share counts are hidden on shared views. Enter the owner passcode to reveal them on this device.</p>
      <input type="password" id="og-pw" autocomplete="current-password" placeholder="Owner passcode" aria-label="Owner passcode">
      <div class="og-row"><button type="submit" class="og-btn">Unlock</button><button type="button" class="og-cancel">Cancel</button></div>
      <p class="og-err" hidden>Wrong passcode.</p>
    </form>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector(".og-bg").addEventListener("click", close);
  wrap.querySelector(".og-cancel").addEventListener("click", close);
  wrap.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = document.getElementById("og-pw").value;
    if (!pw) return;
    const btn = wrap.querySelector(".og-btn");
    btn.disabled = true; btn.textContent = "Unlocking…";
    try {
      const p = await (await fetch("private.enc", { cache: "no-store" })).json();
      const priv = await decryptPayload(p, pw);
      lastPrivateIv = p.iv;
      localStorage.setItem("jc_owner_pw", pw);   // per-device: enter once, stays unlocked
      mergePrivate(priv);
      close();
      rerenderFromData();
    } catch (err) {
      btn.disabled = false; btn.textContent = "Unlock";
      const el = wrap.querySelector(".og-err"); el.hidden = false;
      document.getElementById("og-pw").select();
    }
  });
  document.getElementById("og-pw").focus();
}
function ownerRelock() {
  localStorage.removeItem("jc_owner_pw");
  location.reload();   // cleanest way to purge merged dollars from every render
}
// One delegated listener: the KPI lock chip + every blurred redaction opens the gate.
document.addEventListener("click", (e) => {
  if (e.target.closest("#owner-lock-chip")) { privUnlocked() ? ownerRelock() : openOwnerGate(); return; }
  if (e.target.closest(".priv-blur")) openOwnerGate();
});

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
      lastPayloadIv = payload.iv;
      gate.hidden = true; app.hidden = false;
      sessionStorage.setItem("jc_pw", pw);   // remember within this tab session only
      // owner tier: silently restore the amounts on a remembered device BEFORE first paint
      await refreshPrivateIntoData();
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
  const size = document.getElementById("c-size");
  const qual = document.getElementById("c-qual");
  const dcf = document.getElementById("c-dcf");
  if (!qual || !dcf) return;
  const qv = document.getElementById("c-qv"), dv = document.getElementById("c-dv");
  const out = document.getElementById("c-out"), vb = document.getElementById("c-vb");
  // verdict bands with their live badge colours (match the site's verdict palette)
  const BANDS = [[85, "STRONGEST", "#0e7a4f"], [72, "STRONG BUY", "#16a34a"], [66, "BUY", "#0891b2"],
                 [60, "HOLD-QUAL", "#b45309"], [35, "AVOID", "#64748b"], [0, "STRONG AVOID", "#be123c"]];
  const update = () => {
    const Q = +qual.value, D = +dcf.value, w = size ? +size.value : 0.6;  // cap-conditional blend
    qv.textContent = Q; dv.textContent = D.toFixed(1);
    const qarp = w * (Q / 105 * 100) + (1 - w) * (D / 5 * 100);
    out.textContent = qarp.toFixed(1);
    const b = BANDS.find((x) => qarp >= x[0]) || BANDS[BANDS.length - 1];
    vb.textContent = b[1]; vb.style.background = b[2];
  };
  qual.addEventListener("input", update);
  dcf.addEventListener("input", update);
  if (size) size.addEventListener("change", update);
  update();

  // Scroll-reveal for the report sections. IntersectionObserver handles the on-scroll
  // stagger; a tab-open fallback force-reveals everything so the panel can NEVER render
  // blank if the observer misses (e.g. elements were display:none while the tab was hidden).
  const els = document.querySelectorAll(".qm .reveal");
  const revealAll = () => els.forEach((el) => el.classList.add("in"));
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.1 });
    els.forEach((el) => io.observe(el));
    const tabBtn = document.querySelector('[data-tab="framework"]');
    if (tabBtn) tabBtn.addEventListener("click", () => setTimeout(revealAll, 80));
  } else {
    revealAll();
  }
}

/* ---------- Ask-the-bot chat (Claude via the Cloudflare Worker proxy) ---------- */
// Set BOT_PROXY to your deployed Worker URL (see qarp-bot-worker.js). The browser
// builds a compact context from the live data and sends {system, messages}; the
// Worker adds the API key and streams Claude's reply. Until BOT_PROXY is set, the
// widget explains how to connect it.
const BOT_PROXY = "https://qarp-bot.murshidjaleel-990.workers.dev";   // deployed Cloudflare Worker (proxies to Anthropic; key server-side)
let botHistory = [];

/* full dossier for one name — the bot's retrieval unit (everything the drawer knows) */
function botDossier(tk) {
  const u = (DATA.universe || []).find((x) => x.ticker === tk);
  const p = (DATA.portfolio || []).find((x) => x.ticker === tk);
  if (!u && !p) return "";
  const d = u || {};
  const L = [`=== ${tk} — ${d.name || (p && p.name) || ""} ===`];
  if (u) {
    L.push(`Rank #${d.rank}/${DATA.universe.length}. QARP ${d.qarp} → ${d.verdict}. Quality ${d.mech}/105 (Valuation ${d.val}/25, Growth ${d.grw}/20, Moat&Returns ${d.qual}/20, BalanceSheet ${d.bs}/20, CapitalAlloc ${d.cap}/20); DCF value ${d.dcf}/5.`);
    L.push(`Price $${d.price}${d.day_pct != null ? ` (${fmtPct(d.day_pct)} day)` : ""}; mktcap $${d.mktcap_b}B; P/E trailing→forward ${d.trailing_pe != null ? d.trailing_pe : "n/a"}→${d.forward_pe != null ? d.forward_pe : "n/a"}${d.cyclical ? " (CYCLICAL — DCF anchored on forward earnings, not trailing)" : ""}.`);
    if (d.mom) L.push(`Momentum gate: ${d.mom.state} (${fmtPct(d.mom.vs50)} vs 50-day). Gate times entries; it never changes the score.`);
    if (d.catalyst) L.push(`Catalyst (shadow preview, not in the live score): ${d.catalyst.label} — ${(d.catalyst.note || "").replace(/<[^>]+>/g, "")}`);
    if (d.insider) L.push(`Insider (6-mo Form 4, refreshed with the build): ${d.insider}.`);
    if (d.shariah_grade) L.push(`Shariah (Musaffa, AAOIFI): ${d.shariah_grade}, verdict as of ${d.shariah_asof || "n/a"}.`);
    if (d.first_date) L.push(`Current call opened ${d.first_date} @ $${d.first_price}; since ${fmtPct(d.since_pct)} vs S&P ${fmtPct(d.since_sp_pct)} (alpha ${fmtPct(d.alpha_pct)}). Verdict path: ${(d.verdict_path || []).join(" → ")}.`);
    if (d.dcf_note) L.push(`Valuation & thesis note (the desk's own reasoning): ${String(d.dcf_note).replace(/<[^>]+>/g, "")}`);
  }
  const ab = d.about || (p && p.about);
  if (ab && ab.desc) L.push(`What the company does: ${ab.desc.slice(0, 480)}${ab.desc.length > 480 ? "…" : ""} (Industry: ${ab.industry || "?"}${ab.emp ? `, ~${Number(ab.emp).toLocaleString("en-US")} employees` : ""}.)`);
  if (p) L.push(privUnlocked()
    ? `JALEEL HOLDS IT: ${fmtNum(p.shares, 2)} sh, value ${fmtUSD(p.value, 0)} = ${p.weight_pct}% of the book, unrealized ${fmtUSD(p.gain, 0)} (${fmtPct(p.gain_pct)}).`
    : `JALEEL HOLDS IT: ${p.weight_pct}% of the book, unrealized ${fmtPct(p.gain_pct)}. (Position sizes are owner-private — never state or estimate dollar amounts or share counts.)`);
  return L.join("\n");
}

/* which names does the question mention? tickers (short ones must be typed UPPERCASE) + company names */
function botMatchTickers(q) {
  const raw = " " + (q || "") + " ", ql = raw.toLowerCase();
  const seen = new Set(), found = [];
  for (const x of [...(DATA.universe || []), ...(DATA.portfolio || [])]) {
    if (seen.has(x.ticker) || found.length >= 4) continue;
    const tk = x.ticker;
    const esc2 = tk.replace(".", "\\.");
    const tkHit = tk.length <= 3
      ? new RegExp(`(^|[^A-Za-z0-9])${esc2}([^A-Za-z0-9]|$)`).test(raw)              // short: exact case
      : new RegExp(`(^|[^a-z0-9])${esc2.toLowerCase()}([^a-z0-9]|$)`).test(ql);       // long: any case
    const nm = ((x.name || "").split(/[ ,.]/)[0] || "").toLowerCase();
    const nmHit = nm.length > 3 && ql.includes(nm);
    if (tkHit || nmHit) { seen.add(tk); found.push(tk); }
  }
  return found;
}

function buildBotContext(question) {
  const t = (DATA.meta && DATA.meta.portfolio_totals) || {};
  const holds = (DATA.portfolio || []).map((h) => `${h.ticker} ${h.weight_pct}%${privUnlocked() ? " " + fmtUSD(h.value, 0) : ""} ${fmtPct(h.gain_pct)} (${h.verdict || "?"})`).join("; ");
  const calls = (DATA.portfolio || []).map((h) => { try { return `${h.ticker}:${holdingCall(h.ticker).call}`; } catch (e) { return ""; } }).filter(Boolean).join(", ");
  const top = [...(DATA.universe || [])].filter((u) => u.qarp != null).sort((a, b) => b.qarp - a.qarp).slice(0, 15).map((u) => `${u.ticker} ${fmtNum(u.qarp, 0)} ${u.verdict}${u.mom ? " " + u.mom.state : ""}`).join("; ");
  const S = (typeof SIGNALS !== "undefined" && SIGNALS) || {};
  const risk = (S.risk || []).map((r) => `${r.ticker} (${r.tag})`).join(", ");
  const sectors = (S.sectors || []).map((s) => `${s.sector} ${s.dir}`).join(", ");
  const cats = (S.catalysts || []).map((x) => `${x.when}: ${x.what}`).join("; ");
  const A = DATA.additions || {};
  const adds = (A.candidates || []).map((x) => `${x.ticker} (${x.verdict}, ${x.macro}: ${(x.why || [])[0] || ""})`).join("; ");
  const gaps = (A.sector_gaps || []).map((g) => `${g.macro} ${g.book_pct}%`).join(", ");
  const drift = ((DATA.meta || {}).drift || {});
  // meta.drift is DRIFT_META ({date, flagged[]}) some days and a bare count on others —
  // the bare-count shape made this .map throw and killed the whole Ask bot.
  const driftLine = (Array.isArray(drift.flagged) ? drift.flagged : []).map((f) => `${f.ticker}(w${f.weight})`).join(", ");
  const dossiers = botMatchTickers(question).map(botDossier).filter(Boolean).join("\n\n");
  return [
    "You are the desk analyst for the Jaleel Capital QARP dashboard — a Shariah-compliant, capital-preservation-first equity framework. Answer like a sharp senior analyst: direct answer first, then the reasoning, citing the actual numbers from the context. Challenge consensus, note both sides, never sugar-coat. Use ONLY the data below — never invent a price, verdict, Shariah status, or figure; if it isn't here, say so and suggest naming the ticker (full dossiers load for names mentioned in the question). Informational only — NOT financial advice. Keep answers TIGHT — under ~250 words unless asked to go deeper; end with a one-line NET: takeaway so the answer never cuts off mid-thought.",
    "METHOD (compressed): QARP = w×(Quality/105×100) + (1−w)×(DCF/5×100); w slides with size 60% (≥$15B) → 75% (≤$0.3B) because small-cap DCFs are unreliable — quality/survival weighs more. Quality pillars: Valuation 25, Growth 20, Moat&Returns 20, BalanceSheet 20, CapitalAllocation 20. DCF 1–5 from triangulated fair value (AlphaSpread + analyst consensus + GF Value, conservative leg wins; first score capped at 4); re-banded DAILY against live price from a fixed anchor. CYCLICALS (semis, energy, chemicals, homebuilders…) are FORWARD-anchored — trailing P/E lies at troughs (looks dear when cheap) and peaks (looks cheap when dear). AI-disruption software capped at DCF 4. Bands: ≥85 STRONGEST, ≥72 STRONG BUY, ≥66 BUY, ≥60 HOLD-QUAL, 35–59 AVOID, <35 STRONG AVOID. Momentum gate (GO/TURN/WAIT vs 50/20-day) times entries only. Catalyst (SET/WATCH/WEAK/NONE) is a shadow preview. Gate 1 = AAOIFI Shariah (Musaffa, stricter-view-wins; quarterly re-screen). House rules: concentration is cured by ADDING elsewhere, never selling a name below fair value; an upcoming earnings print is event risk, not a reason to buy.",
    privUnlocked()
      ? `Data as of ${DATA.meta && DATA.meta.date}. Account ${fmtUSD(t.account, 0)}, cash ${fmtUSD(t.cash, 2)}, unrealized ${fmtUSD(t.gain, 0)} (${fmtPct(t.gain_pct)}).`
      : `Data as of ${DATA.meta && DATA.meta.date}. Book unrealized ${fmtPct(t.gain_pct)}. (The account's dollar size is owner-private — never state or estimate dollar amounts or share counts.)`,
    `Holdings (weight${privUnlocked() ? ", value" : ""}, P/L, verdict): ${holds}.`,
    `Daily Add/Hold/Trim calls: ${calls}.`,
    `Top of the universe by QARP: ${top}.`,
    `Additions desk (unheld, event-hooked candidates): ${adds || "none today"}. Book sector gaps: ${gaps || "none"}.`,
    `Re-score queue (fundamentals drifted, ${drift.date || "n/a"}): ${driftLine || "empty"}.`,
    `Signals — macro: ${(S.macro && S.macro.headline) || "n/a"}. Risk flags: ${risk || "none"}. Sector tape: ${sectors || "n/a"}. Catalysts ahead: ${cats || "n/a"}.`,
    dossiers ? `FULL DOSSIERS for names in this question:\n\n${dossiers}` : "",
  ].filter(Boolean).join("\n\n");
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
      body: JSON.stringify({ system: buildBotContext(text), messages: botHistory }),
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

// asset-version bump 2026-06-30: force browser refetch (Stay Informed relevance UI was cache-stale)

/* =====================================================================================
   CHARTS TAB — "the Chart Room" + "Chart School"                          (2026-08-07)
   Boundary: charts inform TIMING only — nothing here reads into verdicts or signals.
   Data: charts/<TKR>.json = ~520 settled daily OHLCV bars (cloud-appended post-close);
   the TODAY candle is drawn live from the Finnhub quote (o/h/l/c) while the market is
   open. All indicators (MA/RSI/S&R) compute client-side from the bars. Levels are drawn
   BY RULE (swing pivots, 2.5%-clustered, >=2 touches) — never by hand, never invented.
   ===================================================================================== */
const CR = {
  tkr: null, bars: null, live: null,   // live = {o,h,l,c,d} synthetic today-candle
  range: "6M", scale: "D",
  ovl: { sr: true, ma: true, cost: true, earn: true, vol: true },
  cache: new Map(), timer: null, signals: null, lastGeo: null,
};
const CR_RANGES = { "3M": 63, "6M": 126, "1Y": 251, "2Y": 9999 };

function crSMA(vals, w) {
  const out = new Array(vals.length).fill(null); let s = 0;
  for (let i = 0; i < vals.length; i++) {
    s += vals[i]; if (i >= w) s -= vals[i - w];
    if (i >= w - 1) out[i] = s / w;
  }
  return out;
}
function crRSI(vals, w = 14) {
  const out = new Array(vals.length).fill(null);
  let ag = null, al = null, g = 0, l = 0;
  for (let i = 1; i < vals.length; i++) {
    const ch = vals[i] - vals[i - 1], up = Math.max(ch, 0), dn = Math.max(-ch, 0);
    if (i <= w) { g += up; l += dn; if (i === w) { ag = g / w; al = l / w; } }
    else { ag = (ag * (w - 1) + up) / w; al = (al * (w - 1) + dn) / w; }
    if (ag !== null) out[i] = 100 - 100 / (1 + (al > 1e-12 ? ag / al : 1e9));
  }
  return out;
}
// Swing pivots (k=3) + clustered S/R levels over the trailing window — the same rule the
// backtest used: a level is real only when >=2 confirmed swings agree within 2.5%.
function crLevels(bars, look = 190) {
  const K = 3, n = bars.c.length, piv = [];
  const lo = Math.max(K, n - look);
  for (let i = lo; i < n - K; i++) {
    let isH = true, isL = true;
    for (let j = i - K; j <= i + K; j++) {
      if (bars.h[j] > bars.h[i]) isH = false;
      if (bars.l[j] < bars.l[i]) isL = false;
    }
    if (isH) piv.push({ i, p: bars.h[i] });
    if (isL) piv.push({ i, p: bars.l[i] });
  }
  piv.sort((a, b) => a.p - b.p);
  const cls = [];
  for (const pv of piv) {
    const cl = cls.find((c) => Math.abs(pv.p - c.level) / c.level < 0.025);
    if (cl) { cl.m.push(pv); cl.level = cl.m.reduce((s, x) => s + x.p, 0) / cl.m.length; }
    else cls.push({ level: pv.p, m: [pv] });
  }
  return cls.filter((c) => c.m.length >= 2)
    .map((c) => ({ level: c.level, touches: c.m.length, last: bars.d[Math.max(...c.m.map((x) => x.i))] }));
}
async function crLoadBars(tkr) {
  if (CR.cache.has(tkr)) return CR.cache.get(tkr);
  const r = await fetch(`charts/${encodeURIComponent(tkr)}.json?v=${(DATA.meta && DATA.meta.date) || ""}`, { cache: "no-store" });
  if (!r.ok) throw new Error("no chart data");
  const j = await r.json();
  CR.cache.set(tkr, j);
  return j;
}
async function crSignals() {
  if (CR.signals) return CR.signals;
  try { CR.signals = await (await fetch("signals.json", { cache: "no-store" })).json(); }
  catch (e) { CR.signals = {}; }
  return CR.signals;
}
function crRowFor(tkr) {
  return DATA.universe.find((x) => x.ticker === tkr) || null;
}
function crHolding(tkr) {
  return DATA.portfolio.find((x) => x.ticker === tkr) || null;
}
// weekly resample (ISO week buckets by Monday) — MAs/RSI recompute on the resampled series
function crWeekly(bars) {
  const out = { d: [], o: [], h: [], l: [], c: [], v: [] };
  let wk = null;
  for (let i = 0; i < bars.d.length; i++) {
    const dt = new Date(bars.d[i] + "T00:00:00Z");
    const mon = new Date(dt); mon.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    const key = mon.toISOString().slice(0, 10);
    if (key !== wk) {
      wk = key;
      out.d.push(bars.d[i]); out.o.push(bars.o[i]); out.h.push(bars.h[i]);
      out.l.push(bars.l[i]); out.c.push(bars.c[i]); out.v.push(bars.v[i]);
    } else {
      const j = out.d.length - 1;
      out.d[j] = bars.d[i];
      out.h[j] = Math.max(out.h[j], bars.h[i]);
      out.l[j] = Math.min(out.l[j], bars.l[i]);
      out.c[j] = bars.c[i]; out.v[j] += bars.v[i];
    }
  }
  return out;
}
// merged view = settled bars + (optionally) the live today-candle
function crView() {
  const b = CR.bars;
  if (!b) return null;
  const m = { d: b.d.slice(), o: b.o.slice(), h: b.h.slice(), l: b.l.slice(), c: b.c.slice(), v: b.v.slice() };
  if (CR.live && CR.live.d > m.d[m.d.length - 1]) {
    m.d.push(CR.live.d); m.o.push(CR.live.o); m.h.push(CR.live.h);
    m.l.push(CR.live.l); m.c.push(CR.live.c); m.v.push(0);
  }
  return CR.scale === "W" ? crWeekly(m) : m;
}

function crBuildSvg(view, feats) {
  const N = view.c.length;
  const win = Math.min(CR_RANGES[CR.range] || 126, N);
  const s0 = N - win;
  const X0 = 8, X1 = 826, Y0 = 16, Y1 = 356, VY0 = 372, VY1 = 436, W = 906, H = 462;
  const SLOTS = win + 6;
  const xs = (j) => X0 + (X1 - X0) * (j + 0.5) / SLOTS;
  let lo = Infinity, hi = -Infinity;
  for (let i = s0; i < N; i++) { lo = Math.min(lo, view.l[i]); hi = Math.max(hi, view.h[i]); }
  if (CR.ovl.cost && feats.avgCost) { lo = Math.min(lo, feats.avgCost); hi = Math.max(hi, feats.avgCost); }
  const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
  const ys = (p) => Y1 - (Y1 - Y0) * (p - lo) / (hi - lo);
  let vmax = 1;
  for (let i = s0; i < N; i++) vmax = Math.max(vmax, view.v[i]);
  const yv = (v) => VY1 - (VY1 - VY0) * v / vmax;
  const cw = Math.max(1.2, (X1 - X0) / SLOTS * 0.62);
  const f1 = (x) => x.toFixed(1);
  const parts = [];
  // grid + y labels
  const span = hi - lo;
  const step = span > 400 ? 100 : span > 160 ? 50 : span > 80 ? 20 : span > 40 ? 10 : span > 16 ? 5 : span > 8 ? 2 : 1;
  for (let gp = Math.ceil(lo / step) * step; gp < hi; gp += step) {
    parts.push(`<line x1="${X0}" y1="${f1(ys(gp))}" x2="${X1}" y2="${f1(ys(gp))}" stroke="#e7e2d3"/>`);
    parts.push(`<text x="${X1 + 8}" y="${f1(ys(gp) + 3.5)}" class="cr-ax">${step < 2 ? gp.toFixed(1) : gp.toFixed(0)}</text>`);
  }
  // month/quarter ticks
  let seenM = "";
  for (let i = s0; i < N; i++) {
    const mk = view.d[i].slice(0, 7);
    if (mk !== seenM) {
      seenM = mk;
      const j = i - s0;
      if (j > 2) {
        const mo = new Date(view.d[i] + "T00:00:00Z");
        const lab = mo.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
        const showYr = mo.getUTCMonth() === 0;
        if (win <= 140 || mo.getUTCMonth() % 3 === 0) {
          parts.push(`<line x1="${f1(xs(j))}" y1="${Y0}" x2="${f1(xs(j))}" y2="${VY1}" stroke="#eeeadd"/>`);
          parts.push(`<text x="${f1(xs(j))}" y="${VY1 + 16}" class="cr-ax" text-anchor="middle">${showYr ? lab + " ’" + String(mo.getUTCFullYear()).slice(2) : lab}</text>`);
        }
      }
    }
  }
  // S/R zones — bands/lines in-plot, labels on the right-gutter TAG RAIL.
  // (The old in-plot boxes stacked onto each other and the candles painted
  // over them — user: "can't read the checkpoints". Rail tags are collision-
  // resolved below; dates live in the Trader's Read, tags stay compact.)
  const px = view.c[N - 1], yp = ys(px);
  const rail = [{ y: yp, trueY: yp, pri: 0, fill: "#15181f",
                  txt: px >= 100 ? px.toFixed(0) : px.toFixed(2) }];
  const srLines = [];
  if (CR.ovl.sr) {
    for (const c of feats.levels.filter((c) => c.level > lo && c.level < hi)) {
      const col = c.level >= px ? "#9a6b25" : "#1a2a55";
      const band = c.level * 0.006, ya = ys(c.level + band), yb = ys(c.level - band), ly = ys(c.level);
      srLines.push(`<rect x="${X0}" y="${f1(ya)}" width="${X1 - X0}" height="${f1(yb - ya)}" fill="${col}" opacity="0.08"/>`);
      srLines.push(`<line x1="${X0}" y1="${f1(ly)}" x2="${X1}" y2="${f1(ly)}" stroke="${col}" stroke-dasharray="1 3" opacity="0.7"/>`);
      rail.push({ y: ly, trueY: ly, pri: 2, fill: col,
                  txt: `${c.level >= px ? "R" : "S"} ${c.level >= 100 ? c.level.toFixed(0) : c.level.toFixed(1)} · ${c.touches}t` });
    }
  }
  // MAs
  if (CR.ovl.ma) {
    const mas = [[feats.ma20, "#2c3f77", ""], [feats.ma50, "#9a6b25", ""], [feats.ma200, "#8b8e97", "4 3"]];
    for (const [ser, col, dash] of mas) {
      const pts = [];
      for (let i = s0; i < N; i++) if (ser[i] != null) pts.push(`${f1(xs(i - s0))},${f1(ys(ser[i]))}`);
      if (pts.length > 1) parts.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${col}" stroke-width="1.4"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`);
    }
  }
  // candles + volume
  const cnd = [], vol = [];
  for (let i = s0; i < N; i++) {
    const up = view.c[i] >= view.o[i], col = up ? "#15803d" : "#be123c";
    const x = xs(i - s0);
    const isLive = CR.live && CR.scale === "D" && view.d[i] === CR.live.d;
    cnd.push(`<line x1="${f1(x)}" y1="${f1(ys(view.h[i]))}" x2="${f1(x)}" y2="${f1(ys(view.l[i]))}" stroke="${col}"/>`);
    const top = ys(Math.max(view.o[i], view.c[i]));
    const bot = Math.max(ys(Math.min(view.o[i], view.c[i])), top + 1);
    cnd.push(`<rect x="${f1(x - cw / 2)}" y="${f1(top)}" width="${f1(cw)}" height="${f1(bot - top)}" fill="${col}"${isLive ? ' opacity="0.75"' : ""}/>`);
    if (view.v[i] > 0) vol.push(`<rect x="${f1(x - cw / 2)}" y="${f1(yv(view.v[i]))}" width="${f1(cw)}" height="${f1(VY1 - yv(view.v[i]))}" fill="${col}" opacity="0.35"/>`);
  }
  parts.push(`<g>${cnd.join("")}</g>`);
  if (srLines.length) parts.push(`<g>${srLines.join("")}</g>`);  // level lines above candles — the checkpoints must be visible
  if (CR.ovl.vol) parts.push(`<g>${vol.join("")}<text x="${X0 + 2}" y="${VY0 + 9}" class="cr-ax">volume</text></g>`);
  // avg cost — dashed line in-plot, label on the rail
  if (CR.ovl.cost && feats.avgCost && feats.avgCost > lo && feats.avgCost < hi) {
    const yc = ys(feats.avgCost);
    parts.push(`<line x1="${X0}" y1="${f1(yc)}" x2="${X1}" y2="${f1(yc)}" stroke="#1a2a55" stroke-width="1.3" stroke-dasharray="7 4"/>`);
    rail.push({ y: yc, trueY: yc, pri: 1, fill: "#2c3f77", txt: `avg ${feats.avgCost.toFixed(2)}` });
  }
  // earnings marker (right gutter)
  if (CR.ovl.earn && feats.earn) {
    const xe = xs(win + 3);
    parts.push(`<g><line x1="${f1(xe)}" y1="${Y0}" x2="${f1(xe)}" y2="${Y1}" stroke="#b45309" stroke-width="1.2" stroke-dasharray="3 3"/>
      <rect x="${f1(xe - 36)}" y="${Y0}" width="72" height="28" rx="3" fill="#fdf3e7" stroke="#b45309" stroke-width="0.8"/>
      <text x="${f1(xe)}" y="${Y0 + 12}" class="cr-srlab" fill="#b45309" text-anchor="middle">earnings</text>
      <text x="${f1(xe)}" y="${Y0 + 23}" class="cr-srlab" fill="#b45309" text-anchor="middle">${feats.earn.slice(5)}</text></g>`);
  }
  // right-gutter tag rail: sort by y, sweep apart to a minimum gap, clamp to
  // the plot, connector ticks point displaced tags back at their true level
  const TAGW = 74, GAPR = 17;
  rail.sort((a, b) => a.y - b.y || a.pri - b.pri);
  for (let i = 1; i < rail.length; i++) rail[i].y = Math.max(rail[i].y, rail[i - 1].y + GAPR);
  const overflow = rail[rail.length - 1].y - (Y1 - 6);
  if (overflow > 0) for (const t of rail) t.y -= overflow;
  for (let i = 0; i < rail.length; i++)
    rail[i].y = Math.max(rail[i].y, (i ? rail[i - 1].y + GAPR : Y0 + 8));
  for (const t of rail) {
    if (Math.abs(t.y - t.trueY) > 4)
      parts.push(`<line x1="${X1}" y1="${f1(t.trueY)}" x2="${X1 + 2}" y2="${f1(t.y)}" stroke="${t.fill}" stroke-width="0.8" opacity="0.55"/>`);
    parts.push(`<rect x="${X1 + 2}" y="${f1(t.y - 8)}" width="${TAGW}" height="16" rx="2" fill="${t.fill}"${t.pri === 2 ? ' opacity="0.93"' : ""}/>
      <text x="${X1 + 2 + TAGW / 2}" y="${f1(t.y + 3.5)}" class="cr-tag" fill="#fbfbf7" text-anchor="middle">${t.txt}</text>`);
  }
  // crosshair skeleton
  parts.push(`<g id="cr-xhair" style="display:none">
    <line id="cr-xv" y1="${Y0}" y2="${VY1}" stroke="#454b57" stroke-width="0.7" stroke-dasharray="2 2"/>
    <line id="cr-xh" x1="${X0}" x2="${X1}" stroke="#454b57" stroke-width="0.7" stroke-dasharray="2 2"/></g>`);
  CR.lastGeo = { X0, X1, Y0, Y1, VY1, SLOTS, lo, hi, s0, win, W, H };
  return `<svg id="cr-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

function crFeatures(tkr, view) {
  const b = view;
  const closes = b.c;
  const feats = {};
  feats.ma20 = crSMA(closes, 20); feats.ma50 = crSMA(closes, 50); feats.ma200 = crSMA(closes, 200);
  feats.rsi = crRSI(closes);
  feats.levels = crLevels(b, CR.scale === "W" ? 104 : 190);
  const h = crHolding(tkr);
  feats.avgCost = h ? (h.avg_cost != null ? h.avg_cost : (h.shares ? h.cost / h.shares : null)) : null;
  feats.hi52 = Math.max(...b.h.slice(-252)); feats.lo52 = Math.min(...b.l.slice(-252));
  const n = closes.length;
  feats.px = closes[n - 1];
  const v5 = b.v.slice(-6, -1).filter(Boolean), v20 = b.v.slice(-21, -1).filter(Boolean);
  feats.volRatio = v5.length && v20.length ? (v5.reduce((a, x) => a + x, 0) / v5.length) / (v20.reduce((a, x) => a + x, 0) / v20.length) : null;
  return feats;
}

function crTradersRead(tkr, view, feats) {
  const n = view.c.length, px = feats.px;
  const above = feats.levels.filter((c) => c.level >= px).sort((a, b) => a.level - b.level);
  const below = feats.levels.filter((c) => c.level < px).sort((a, b) => b.level - a.level);
  const r1 = above[0], r2 = above[1], s1 = below[0], s2 = below[1];
  const fp = (p) => "$" + (p >= 100 ? p.toFixed(0) : p.toFixed(1));
  const ma50 = feats.ma50[n - 1], ma200 = feats.ma200[n - 1], ma20 = feats.ma20[n - 1];
  const rsi = feats.rsi[n - 1];
  // trend prose from structure
  let trend;
  if (ma200 && px > ma200 && ma50 && px > ma50) trend = `Uptrend — price above the rising long-term averages; pullbacks to the averages are the pattern to watch.`;
  else if (ma200 && px < ma200 && ma50 && px < ma50) trend = `Downtrend — price below both the 50 and 200-day averages; rallies into overhead supply tend to stall until a base forms.`;
  else trend = `Transition — price is between its major averages; repair after a fall (or first crack in a trend). Structure decides from here.`;
  // washout state
  let wash = "";
  if (rsi != null && rsi < 30) wash = `<span class="cr-wash">KNIFE ZONE — RSI ${rsi.toFixed(0)}; the tested pattern waits for the cross BACK above 30</span>`;
  else {
    for (let i = Math.max(1, n - 5); i < n; i++) {
      if (feats.rsi[i - 1] != null && feats.rsi[i - 1] < 30 && feats.rsi[i] >= 30) {
        wash = `<span class="cr-wash stamped">REBOUND STAMPED ${view.d[i].slice(5)} — RSI crossed back above 30</span>`; break;
      }
    }
  }
  const u = crRowFor(tkr);
  const gate = u && u.mom ? momGate(u) : (ma20 && ma50 ? `<span class="mg mg-${px >= ma50 ? "go" : px >= ma20 ? "turn" : "wait"}">${px >= ma50 ? "GO" : px >= ma20 ? "TURN" : "WAIT"}</span>` : "—");
  const sig = CR.signals || {};
  const earn = sig.earnings_next && sig.earnings_next[tkr];
  const rows = [];
  rows.push(["Trend", trend]);
  rows.push(["Gate", `${gate} ${ma20 && ma50 ? `MA20 ${fp(ma20)} · MA50 ${fp(ma50)}${ma200 ? ` · MA200 ${fp(ma200)}` : ""}` : ""}`]);
  rows.push(["Resistance", r1 ? `${fp(r1.level)} overhead (${r1.touches} touches, last ${r1.last.slice(5)})${r2 ? `, then ${fp(r2.level)}` : ""}.` : `No tested ceiling inside this window — price is in open air near its highs.`]);
  rows.push(["Support", s1 ? `${fp(s1.level)} below (${s1.touches} touches, last ${s1.last.slice(5)})${s2 ? `, then ${fp(s2.level)}` : ""}.` : `No tested floor inside this window — the last defended shelf is below the visible range.`]);
  rows.push(["RSI(14)", rsi != null ? `${rsi.toFixed(0)} — ${rsi < 30 ? "oversold; panic zone" : rsi > 70 ? "overbought; stretched" : "neutral"}. ${wash}` : "—"]);
  if (feats.volRatio != null) rows.push(["Volume", `5-day avg ${feats.volRatio.toFixed(1)}× the 20-day — ${feats.volRatio > 1.15 ? "expanding; moves carry more conviction" : feats.volRatio < 0.85 ? "contracting; quiet tape" : "steady"}.`]);
  rows.push(["52-week", `${fp(feats.lo52)} — ${fp(feats.hi52)}; now ${((px / feats.hi52 - 1) * 100).toFixed(0)}% from the high.`]);
  if (earn) rows.push(["Event", `Earnings ${earn} — gaps ignore levels; a fresh setup after the print beats a position through it.`]);
  const html = rows.map(([k, v]) => `<div class="cr-trrow"><span class="cr-trk">${k}</span><span>${v}</span></div>`).join("");
  // playbooks (honest: risk structures, not signals — with the study numbers)
  let pb = "";
  if (r1 && ma20) {
    const entry = r1.level * 1.005, target = r2 ? r2.level : (ma50 && ma50 > entry ? ma50 : feats.hi52);
    const stop = s1 ? Math.min(s1.level * 0.99, ma20 * 0.99) : ma20 * 0.99;
    const rr = (target - entry) / Math.max(entry - stop, 0.01);
    pb += `<div class="cr-pb"><div class="cr-pbh">Breakout structure <span class="cr-lessonlink" onclick="openLesson(9)">lesson 09 →</span></div>
      A close above <b>${fp(entry)}</b> (the ${r1.touches}-touch ceiling) opens the road toward <b>${fp(target)}</b>; stop under <b>${fp(stop)}</b> → reward-to-risk ≈ <b>${rr > 0 ? rr.toFixed(1) : "—"}</b>.
      <i>Our own 50-name test: breakouts alone carried no edge — this is a risk template, not a signal.</i></div>`;
  }
  if (s1) {
    pb += `<div class="cr-pb"><div class="cr-pbh">Pullback structure <span class="cr-lessonlink" onclick="openLesson(4)">lesson 04 →</span></div>
      Patient bids at the <b>${fp(s1.level)}</b> shelf (${s1.touches} touches), stop just beneath it — tighter risk, better price, may never fill.
      <i>Best used with the washout stamp below.</i></div>`;
  }
  pb += `<div class="cr-pb cr-pb-study"><div class="cr-pbh">What our data says <span class="cr-lessonlink" onclick="openLesson(11)">lesson 11 →</span></div>
    Across 50 of our own names, the only entry timing that stayed positive everywhere: <b>buy weakness after it stabilizes</b> —
    RSI crossing back above 30 ran ≈ +2–4% vs untimed entry over the next quarter (fails ~1 name in 3; suggestive, not proven). Chasing strength tested at zero.</div>`;
  return `<h3>the Trader’s Read</h3>
    <div class="cr-read-note">Auto-written from this chart’s computed features — education, not a signal. Levels are rule-drawn (swing clusters, touch-counted).</div>
    ${html}<h3 style="margin-top:16px">Entry structures</h3>${pb}`;
}

function crRenderRoom() {
  const el = document.getElementById("cr-room-body");
  if (!CR.bars) { el.innerHTML = `<div class="cr-empty">Pick a name to open its chart.</div>`; return; }
  const tkr = CR.tkr;
  const view = crView();
  const feats = crFeatures(tkr, view);
  const sig = CR.signals || {};
  feats.earn = sig.earnings_next && sig.earnings_next[tkr];
  const u = crRowFor(tkr), h = crHolding(tkr);
  const name = (u && u.name) || (h && h.name) || "";
  const sect = (u && u.sector) || "";
  const px = (h && h.price) || (u && u.price) || feats.px;
  const dp = (h && h.day_pct) != null ? h.day_pct : (u && u.day_pct);
  const verd = (u && u.verdict) || (h && h.verdict) || "";
  const wt = h ? ` · ${h.weight_pct}% of book` : "";
  const svg = crBuildSvg(view, feats);
  el.innerHTML = `
    <div class="cr-grid"><div>
      <div class="cr-tickhead">
        <span class="cr-tk">${esc(tkr)}</span><span class="cr-nm">${esc(name)}${sect ? " · " + esc(sect) : ""}${wt}</span>
        <span class="cr-px">${fmtUSD(px, 2)}</span>
        ${dp != null ? `<span class="cr-dd ${signClass(dp)}">${fmtPct(dp)}</span>` : ""}
        ${verd ? verdictBadge(verd) : ""}
        <span class="cr-chip52">52w ${feats.lo52 >= 100 ? feats.lo52.toFixed(0) : feats.lo52.toFixed(1)} — ${feats.hi52 >= 100 ? feats.hi52.toFixed(0) : feats.hi52.toFixed(1)}</span>
      </div>
      <div class="cr-ctl">
        <div class="cr-ranges">
          ${Object.keys(CR_RANGES).map((r) => `<button class="cr-rbtn${CR.range === r ? " on" : ""}" data-crr="${r}">${r}</button>`).join("")}
          <span class="cr-rsep"></span>
          <button class="cr-rbtn cr-scale${CR.scale === "D" ? " on" : ""}" data-crs="D">D</button>
          <button class="cr-rbtn cr-scale${CR.scale === "W" ? " on" : ""}" data-crs="W">W</button>
        </div>
        <div class="cr-ovl">
          <label><input type="checkbox" data-cro="sr"${CR.ovl.sr ? " checked" : ""}>S/R levels</label>
          <label><input type="checkbox" data-cro="ma"${CR.ovl.ma ? " checked" : ""}>MA 20·50·200</label>
          ${feats.avgCost ? `<label><input type="checkbox" data-cro="cost"${CR.ovl.cost ? " checked" : ""}>my cost</label>` : ""}
          ${feats.earn ? `<label><input type="checkbox" data-cro="earn"${CR.ovl.earn ? " checked" : ""}>earnings</label>` : ""}
          <label><input type="checkbox" data-cro="vol"${CR.ovl.vol ? " checked" : ""}>volume</label>
        </div>
      </div>
      <div class="cr-chartcard"><div id="cr-readout"></div>${svg}</div>
      <div class="cr-foot">Settled daily bars through ${esc(CR.bars.asof || "")}${CR.live ? " + today’s live candle from the quote feed" : ""}.
        Levels are computed from swing highs &amp; lows (2.5%-clustered, touch-counted) — drawn by rule, never by hand. Crosshair: move your cursor over the chart.</div>
      ${crDeskPlan(tkr, view, feats)}
    </div>
    <div class="cr-read">${crTradersRead(tkr, view, feats)}</div></div>`;
  // wire controls
  el.querySelectorAll("[data-crr]").forEach((b) => b.addEventListener("click", () => { CR.range = b.dataset.crr; crRenderRoom(); }));
  el.querySelectorAll("[data-crs]").forEach((b) => b.addEventListener("click", () => { CR.scale = b.dataset.crs; crRenderRoom(); }));
  el.querySelectorAll("[data-cro]").forEach((c) => c.addEventListener("change", () => { CR.ovl[c.dataset.cro] = c.checked; crRenderRoom(); }));
  crWireCrosshair(view);
  crMarkChips();
}
function crWireCrosshair(view) {
  const svg = document.getElementById("cr-svg"), ro = document.getElementById("cr-readout");
  if (!svg || !CR.lastGeo) return;
  const G = CR.lastGeo;
  svg.addEventListener("mousemove", (e) => {
    const r = svg.getBoundingClientRect();
    const vx = (e.clientX - r.left) * G.W / r.width, vy = (e.clientY - r.top) * G.H / r.height;
    const xh = document.getElementById("cr-xhair");
    if (vx < G.X0 || vx > G.X1 || vy > G.VY1) { xh.style.display = "none"; ro.style.display = "none"; return; }
    let j = Math.round((vx - G.X0) * G.SLOTS / (G.X1 - G.X0) - 0.5);
    j = Math.max(0, Math.min(j, G.win - 1));
    const i = G.s0 + j;
    const bx = G.X0 + (G.X1 - G.X0) * (j + 0.5) / G.SLOTS;
    xh.style.display = "";
    document.getElementById("cr-xv").setAttribute("x1", bx); document.getElementById("cr-xv").setAttribute("x2", bx);
    document.getElementById("cr-xh").setAttribute("y1", vy); document.getElementById("cr-xh").setAttribute("y2", vy);
    const cp = (G.lo + (G.Y1 - vy) * (G.hi - G.lo) / (G.Y1 - G.Y0));
    ro.style.display = "";
    const fm = (x) => x >= 100 ? x.toFixed(1) : x.toFixed(2);
    ro.innerHTML = `<b>${view.d[i]}</b> &nbsp;O ${fm(view.o[i])} &nbsp;H ${fm(view.h[i])} &nbsp;L ${fm(view.l[i])} &nbsp;C <b>${fm(view.c[i])}</b>${view.v[i] ? ` &nbsp;V ${(view.v[i] / 1e6).toFixed(1)}M` : ""}${vy <= G.Y1 ? ` &nbsp;·&nbsp; ${fm(cp)}` : ""}`;
  });
  svg.addEventListener("mouseleave", () => {
    const xh = document.getElementById("cr-xhair");
    if (xh) xh.style.display = "none";
    ro.style.display = "none";
  });
}
async function crLiveCandle() {
  // today's candle, live: Finnhub quote carries o/h/l/c for the current session
  if (!CR.tkr || !CR.bars || !marketOpenNow()) return;
  if (Date.now() < throttleUntil) return;
  try {
    const q = await fetchQuote(CR.tkr);
    if (q && q.c > 0 && q.o > 0 && q.t) {
      const qd = new Date(q.t * 1000).toISOString().slice(0, 10);
      if (qd > CR.bars.d[CR.bars.d.length - 1]) {
        CR.live = { d: qd, o: q.o, h: q.h, l: q.l, c: q.c };
        crRenderRoom();
      }
    }
  } catch (e) { /* quiet — the settled chart is already honest */ }
}
async function openChart(tkr) {
  const btn = document.querySelector('.tab[data-tab="charts"]');
  if (btn && !btn.classList.contains("active")) btn.click();
  crShowSub("room");
  CR.tkr = tkr; CR.live = null;
  try { localStorage.setItem("jc_chart_tkr", tkr); } catch (e) {}
  const el = document.getElementById("cr-room-body");
  el.innerHTML = `<div class="cr-empty">Loading ${esc(tkr)}…</div>`;
  try {
    await crSignals();
    CR.bars = await crLoadBars(tkr);
    crRenderRoom();
    crLiveCandle();
  } catch (e) {
    CR.bars = null;
    el.innerHTML = `<div class="cr-empty">No chart data for ${esc(tkr)} yet — bars are baked daily; new names appear after the next cloud build.</div>`;
  }
}
function crMarkChips() {
  document.querySelectorAll(".cr-chip").forEach((c) => c.classList.toggle("on", c.dataset.tk === CR.tkr));
}
function crAllNames() {
  const seen = new Set(), out = [];
  for (const p of DATA.portfolio) { if (!seen.has(p.ticker)) { seen.add(p.ticker); out.push({ t: p.ticker, n: p.name || "" }); } }
  for (const u of DATA.universe) { if (!seen.has(u.ticker)) { seen.add(u.ticker); out.push({ t: u.ticker, n: u.name || "" }); } }
  return out;
}
function crShowSub(which) {
  document.querySelectorAll("#c-subtabs .csub-btn").forEach((b) => b.classList.toggle("active", b.dataset.csub === which));
  document.querySelectorAll("#tab-charts .csub").forEach((p) => p.classList.toggle("active", p.id === "csub-" + which));
  document.getElementById("cr-title").textContent = which === "school" ? "Chart School" : "the Chart Room";
  if (which === "school") renderSchool();
}
function openLesson(nn) {
  crShowSub("school");
  const anchor = document.getElementById("cs-l" + nn);
  if (anchor) anchor.scrollIntoView({ block: "start", behavior: "smooth" });
}
function enterCharts() {
  if (!CR.tkr) {
    let last = null;
    try { last = localStorage.getItem("jc_chart_tkr"); } catch (e) {}
    const biggest = DATA.portfolio.slice().sort((a, b) => b.value - a.value)[0];
    openChart(last || (biggest && biggest.ticker) || DATA.universe[0].ticker);
    const chips = document.getElementById("cr-holdchips");
    if (chips && !chips.childElementCount) {
      chips.innerHTML = DATA.portfolio.slice().sort((a, b) => b.value - a.value).slice(0, 8)
        .map((p) => `<button class="cr-chip" data-tk="${esc(p.ticker)}">${esc(p.ticker)}</button>`).join("");
      chips.querySelectorAll(".cr-chip").forEach((c) => c.addEventListener("click", () => openChart(c.dataset.tk)));
    }
  }
  if (CR.timer) clearInterval(CR.timer);
  CR.timer = setInterval(crLiveCandle, 60000);
}
function leaveCharts() { if (CR.timer) { clearInterval(CR.timer); CR.timer = null; } }
function initCharts() {
  document.querySelectorAll("#c-subtabs .csub-btn").forEach((b) =>
    b.addEventListener("click", () => crShowSub(b.dataset.csub)));
  const inp = document.getElementById("cr-search"), list = document.getElementById("cr-search-list");
  if (!inp) return;
  let selIdx = -1;
  function hide() { list.hidden = true; selIdx = -1; }
  function show(items) {
    if (!items.length) { hide(); return; }
    list.innerHTML = items.map((x, i) => `<div class="cr-search-item${i === selIdx ? " sel" : ""}" data-tk="${esc(x.t)}"><b>${esc(x.t)}</b><span>${esc(x.n)}</span></div>`).join("");
    list.hidden = false;
    list.querySelectorAll(".cr-search-item").forEach((r) => r.addEventListener("mousedown", (e) => { e.preventDefault(); openChart(r.dataset.tk); inp.value = ""; hide(); }));
  }
  function matches() {
    const q = inp.value.trim().toUpperCase();
    // DATA is a top-level `let`, NOT window.DATA — typeof is the only safe pre-unlock probe
    if (!q || typeof DATA === "undefined" || !DATA) return [];
    const all = crAllNames();
    const pri = all.filter((x) => x.t.startsWith(q));
    const sec = all.filter((x) => !x.t.startsWith(q) && (x.t.includes(q) || x.n.toUpperCase().includes(q)));
    return pri.concat(sec).slice(0, 12);
  }
  inp.addEventListener("input", () => { selIdx = -1; show(matches()); });
  inp.addEventListener("keydown", (e) => {
    const items = matches();
    if (e.key === "ArrowDown") { e.preventDefault(); selIdx = Math.min(selIdx + 1, items.length - 1); show(items); }
    else if (e.key === "ArrowUp") { e.preventDefault(); selIdx = Math.max(selIdx - 1, 0); show(items); }
    else if (e.key === "Enter") { e.preventDefault(); const pick = items[Math.max(selIdx, 0)]; if (pick) { openChart(pick.t); inp.value = ""; hide(); } }
    else if (e.key === "Escape") hide();
  });
  inp.addEventListener("blur", () => setTimeout(hide, 150));
}
initCharts();

/* ---------- Chart School: the curriculum ---------- */
function crMiniChart(kind, bars) {
  const n = bars.c.length, s0 = Math.max(0, n - 30);
  const seg = { o: bars.o.slice(s0), h: bars.h.slice(s0), l: bars.l.slice(s0), c: bars.c.slice(s0) };
  const m = seg.c.length;
  let lo = Math.min(...seg.l), hi = Math.max(...seg.h);
  const mx = (j) => 5 + j * 106 / (m - 1);
  const my = (p) => 62 - 54 * (p - lo) / (hi - lo);
  const parts = [];
  if (kind === "line") {
    parts.push(`<polyline points="${seg.c.map((c, j) => `${mx(j).toFixed(1)},${my(c).toFixed(1)}`).join(" ")}" fill="none" stroke="#1a2a55" stroke-width="1.5"/>`);
  } else if (kind === "bars") {
    for (let j = 0; j < m; j++) {
      const col = seg.c[j] >= seg.o[j] ? "#15803d" : "#be123c", x = mx(j);
      parts.push(`<line x1="${x.toFixed(1)}" y1="${my(seg.h[j]).toFixed(1)}" x2="${x.toFixed(1)}" y2="${my(seg.l[j]).toFixed(1)}" stroke="${col}"/>`);
      parts.push(`<line x1="${(x - 1.6).toFixed(1)}" y1="${my(seg.o[j]).toFixed(1)}" x2="${x.toFixed(1)}" y2="${my(seg.o[j]).toFixed(1)}" stroke="${col}"/>`);
      parts.push(`<line x1="${x.toFixed(1)}" y1="${my(seg.c[j]).toFixed(1)}" x2="${(x + 1.6).toFixed(1)}" y2="${my(seg.c[j]).toFixed(1)}" stroke="${col}"/>`);
    }
  } else if (kind === "candle" || kind === "ha") {
    let series = seg;
    if (kind === "ha") {
      let ho = null, hc = null; const hs = { o: [], h: [], l: [], c: [] };
      for (let j = 0; j < m; j++) {
        const c2 = (seg.o[j] + seg.h[j] + seg.l[j] + seg.c[j]) / 4;
        const o2 = ho === null ? (seg.o[j] + seg.c[j]) / 2 : (ho + hc) / 2;
        hs.o.push(o2); hs.c.push(c2); hs.h.push(Math.max(seg.h[j], o2, c2)); hs.l.push(Math.min(seg.l[j], o2, c2));
        ho = o2; hc = c2;
      }
      series = hs;
    }
    for (let j = 0; j < m; j++) {
      const col = series.c[j] >= series.o[j] ? "#15803d" : "#be123c", x = mx(j);
      parts.push(`<line x1="${x.toFixed(1)}" y1="${my(series.h[j]).toFixed(1)}" x2="${x.toFixed(1)}" y2="${my(series.l[j]).toFixed(1)}" stroke="${col}" stroke-width="0.8"/>`);
      const t = my(Math.max(series.o[j], series.c[j])), b = Math.max(my(Math.min(series.o[j], series.c[j])), t + 0.8);
      parts.push(`<rect x="${(x - 1.4).toFixed(1)}" y="${t.toFixed(1)}" width="2.8" height="${(b - t).toFixed(1)}" fill="${col}"/>`);
    }
  }
  return `<svg viewBox="0 0 116 70" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}
function renderSchool() {
  const el = document.getElementById("cs-body");
  if (!el || el._rendered) return;
  el._rendered = true;
  const TOC = [
    "Reading a candle", "Chart types", "Trend & market structure", "Support, resistance & the role flip",
    "Volume — the fuel gauge", "Moving averages & our Gate", "Continuation patterns", "Reversal patterns",
    "Breakouts — and bull traps", "Entries, stops & risk-reward", "What our own data says",
  ];
  const card = (nn, title, fig, body, live, liveTk) => `
    <div class="cs-card${nn === 11 ? " cs-wide" : ""}" id="cs-l${nn}">
      <span class="cs-lk">Lesson ${String(nn).padStart(2, "0")}</span><h4>${title}</h4>
      ${fig ? `<figure>${fig}</figure>` : ""}${body}
      ${live ? `<span class="cs-live" onclick="openChart('${liveTk}')">See it live: ${live} →</span>` : ""}</div>`;
  const D = "cs-dlab", DB = "cs-dlab-b";
  const figCandle = `<svg viewBox="0 0 280 150" xmlns="http://www.w3.org/2000/svg">
    <line x1="90" y1="18" x2="90" y2="132" stroke="#15803d" stroke-width="2"/><rect x="72" y="45" width="36" height="60" fill="#15803d"/>
    <text x="120" y="22" class="${D}">high</text><text x="120" y="50" class="${D}">close</text>
    <text x="120" y="108" class="${D}">open</text><text x="120" y="133" class="${D}">low</text>
    <line x1="210" y1="30" x2="210" y2="120" stroke="#be123c" stroke-width="2"/><rect x="192" y="52" width="36" height="45" fill="#be123c"/>
    <text x="56" y="145" class="${D}">buyer’s day</text><text x="180" y="145" class="${D}">seller’s day</text></svg>`;
  const figTrend = `<svg viewBox="0 0 280 150" xmlns="http://www.w3.org/2000/svg">
    <polyline points="10,120 40,86 62,104 96,62 120,84 156,40 180,58 214,22" fill="none" stroke="#15803d" stroke-width="2"/>
    <circle cx="62" cy="104" r="3" fill="none" stroke="#15803d" stroke-width="1.4"/><circle cx="120" cy="84" r="3" fill="none" stroke="#15803d" stroke-width="1.4"/>
    <text x="12" y="30" class="${DB}" fill="#15803d">uptrend: higher highs + higher lows</text>
    <text x="52" y="122" class="${D}">HL</text><text x="112" y="100" class="${D}">HL</text>
    <polyline points="216,118 236,96 248,112 266,84" fill="none" stroke="#be123c" stroke-width="1.6"/>
    <text x="272" y="138" class="${D}" fill="#be123c" text-anchor="end">break of structure = first warning</text></svg>`;
  const figSR = `<svg viewBox="0 0 280 150" xmlns="http://www.w3.org/2000/svg">
    <line x1="12" y1="78" x2="268" y2="78" stroke="#9a6b25" stroke-width="1.4" stroke-dasharray="5 3"/>
    <polyline points="14,120 40,84 58,112 84,82 104,116 128,80 150,58 172,40 192,60 210,74 228,52 252,30" fill="none" stroke="#1a2a55" stroke-width="2"/>
    <circle cx="40" cy="84" r="3.5" fill="none" stroke="#be123c" stroke-width="1.5"/><circle cx="84" cy="82" r="3.5" fill="none" stroke="#be123c" stroke-width="1.5"/>
    <circle cx="128" cy="80" r="3.5" fill="none" stroke="#be123c" stroke-width="1.5"/><circle cx="210" cy="74" r="3.5" fill="none" stroke="#15803d" stroke-width="1.5"/>
    <text x="26" y="103" class="${D}">3 touches = resistance</text><text x="140" y="48" class="${D}">breakout</text>
    <text x="196" y="95" class="${D}">retest → support</text>
    <path d="M210,64 l0,-14 l-4,5 m4,-5 l4,5" stroke="#15803d" stroke-width="1.6" fill="none"/></svg>`;
  const figVol = `<svg viewBox="0 0 280 150" xmlns="http://www.w3.org/2000/svg">
    <line x1="12" y1="60" x2="268" y2="60" stroke="#9a6b25" stroke-width="1.2" stroke-dasharray="5 3"/>
    <polyline points="14,100 40,72 62,90 88,66 112,84 134,64 150,52 172,40" fill="none" stroke="#1a2a55" stroke-width="2"/>
    ${[14,26,38,50,62,74,86,98,110,122].map((x,i)=>`<rect x="${x+2}" y="${132-8-(i%3)*4}" width="6" height="${8+(i%3)*4}" fill="#8b8e97" opacity="0.5"/>`).join("")}
    <rect x="136" y="108" width="6" height="32" fill="#15803d" opacity="0.8"/><rect x="148" y="102" width="6" height="38" fill="#15803d" opacity="0.8"/>
    <rect x="160" y="112" width="6" height="28" fill="#15803d" opacity="0.8"/>
    <text x="132" y="100" class="${DB}" fill="#15803d">volume expands = real</text>
    <text x="16" y="30" class="${D}">a breakout without volume is a rumor</text></svg>`;
  const figMA = `<svg viewBox="0 0 280 150" xmlns="http://www.w3.org/2000/svg">
    <polyline points="12,40 34,58 52,46 70,72 88,62 106,92 124,84 142,108 160,96 178,116 196,102 214,86 232,72 252,56" fill="none" stroke="#15181f" stroke-width="1.6"/>
    <path d="M12,60 C 60,64 110,96 160,110 C 190,114 225,96 252,74" fill="none" stroke="#2c3f77" stroke-width="1.6"/>
    <path d="M12,78 C 70,74 130,96 190,104 C 215,106 235,100 252,92" fill="none" stroke="#9a6b25" stroke-width="1.6"/>
    <circle cx="238" cy="82" r="4" fill="#fbfbf7" stroke="#15803d" stroke-width="2"/>
    <text x="252" y="66" class="${DB}" fill="#15803d" text-anchor="end">cross = GO</text>
    <text x="140" y="132" class="${D}" text-anchor="middle">under both = WAIT · between = TURN · above = GO</text>
    <text x="16" y="55" class="${D}" fill="#2c3f77">MA20</text><text x="16" y="92" class="${D}" fill="#9a6b25">MA50</text></svg>`;
  const figCont = `<svg viewBox="0 0 280 150" xmlns="http://www.w3.org/2000/svg">
    <polyline points="10,120 26,100 40,108 56,84 70,92 84,66" fill="none" stroke="#1a2a55" stroke-width="2"/>
    <polyline points="84,66 94,74 104,68 114,78 124,72" fill="none" stroke="#1a2a55" stroke-width="1.5"/>
    <line x1="80" y1="60" x2="128" y2="70" stroke="#9a6b25" stroke-dasharray="4 3"/><line x1="84" y1="82" x2="130" y2="90" stroke="#9a6b25" stroke-dasharray="4 3"/>
    <polyline points="124,72 140,52 154,38" fill="none" stroke="#15803d" stroke-width="2.2"/>
    <text x="14" y="52" class="${D}">flag</text>
    <polyline points="168,118 184,92 196,104 210,84 222,94 236,80 250,88 262,78" fill="none" stroke="#1a2a55" stroke-width="1.8"/>
    <line x1="180" y1="86" x2="264" y2="74" stroke="#9a6b25" stroke-dasharray="4 3"/><line x1="176" y1="122" x2="264" y2="92" stroke="#9a6b25" stroke-dasharray="4 3"/>
    <text x="188" y="140" class="${D}">triangle: range tightens, then resolves</text></svg>`;
  const figRev = `<svg viewBox="0 0 280 150" xmlns="http://www.w3.org/2000/svg">
    <polyline points="10,120 30,60 48,88 68,58 88,124" fill="none" stroke="#1a2a55" stroke-width="2"/>
    <line x1="16" y1="90" x2="92" y2="90" stroke="#be123c" stroke-dasharray="4 3"/>
    <text x="16" y="140" class="${D}">double top: M shape, neckline breaks</text>
    <polyline points="150,120 168,84 182,98 198,52 214,96 230,80 248,122" fill="none" stroke="#1a2a55" stroke-width="2"/>
    <line x1="156" y1="98" x2="252" y2="98" stroke="#be123c" stroke-dasharray="4 3"/>
    <text x="164" y="140" class="${D}">head &amp; shoulders</text></svg>`;
  const figBrk = `<svg viewBox="0 0 280 150" xmlns="http://www.w3.org/2000/svg">
    <line x1="12" y1="64" x2="130" y2="64" stroke="#9a6b25" stroke-width="1.3" stroke-dasharray="5 3"/>
    <polyline points="14,110 34,72 52,96 74,68 92,88 110,58 124,44" fill="none" stroke="#15803d" stroke-width="2"/>
    <text x="16" y="38" class="${DB}" fill="#15803d">clean break: close + volume + hold</text>
    <line x1="152" y1="64" x2="268" y2="64" stroke="#9a6b25" stroke-width="1.3" stroke-dasharray="5 3"/>
    <polyline points="154,108 176,70 192,92 210,58 224,52 238,74 252,102 264,118" fill="none" stroke="#be123c" stroke-width="2"/>
    <circle cx="224" cy="52" r="4" fill="none" stroke="#be123c" stroke-width="1.5"/>
    <text x="160" y="140" class="${D}" fill="#be123c">bull trap: pokes above, closes back under</text></svg>`;
  const figRR = `<svg viewBox="0 0 280 150" xmlns="http://www.w3.org/2000/svg">
    <line x1="30" y1="96" x2="250" y2="96" stroke="#1a2a55" stroke-width="1.4"/>
    <line x1="30" y1="118" x2="250" y2="118" stroke="#be123c" stroke-width="1.2" stroke-dasharray="4 3"/>
    <line x1="30" y1="40" x2="250" y2="40" stroke="#15803d" stroke-width="1.2" stroke-dasharray="4 3"/>
    <text x="34" y="90" class="${D}">entry — at the level, never mid-air</text>
    <text x="34" y="132" class="${D}" fill="#be123c">stop — where the idea is WRONG</text>
    <text x="34" y="34" class="${D}" fill="#15803d">target — next tested level</text>
    <path d="M262,96 L262,118" stroke="#be123c" stroke-width="2"/><path d="M262,96 L262,40" stroke="#15803d" stroke-width="2"/>
    <text x="268" y="112" class="${D}" fill="#be123c">1R</text><text x="268" y="66" class="${D}" fill="#15803d">2.5R</text></svg>`;
  const study = `
    <p><b>We do not teach folklore here.</b> Before this page shipped, we backtested the entry rules it explains on our own
    universe — 15 random names, then 74 rule variants, then the winners frozen and retested on 35 names the search had never
    seen (50 names, 5 years, entry at next day’s open, every method judged against each stock’s own drift — code audited for
    look-ahead, results reproduced independently). The full result, unvarnished:</p>
    <table class="cs-tbl"><tr><th>Entry rule</th><th>Sample 1 (15)</th><th>Sample 2 (15)</th><th>Sample 3 (20)</th><th>Verdict</th></tr>
    <tr><td>Breakout (fresh 50-day high)</td><td class="neg">−0.4%</td><td class="neg">−1.2%</td><td>—</td><td>no edge, worst stop-race odds</td></tr>
    <tr><td>Breakout + heavy volume</td><td class="neg">−2.1%</td><td class="neg">−4.8%</td><td>—</td><td>negative both samples</td></tr>
    <tr><td>Pullback to support (uptrend)</td><td class="neg">−2.0%</td><td>+0.7%</td><td>—</td><td>negative in every robustness run</td></tr>
    <tr><td>Golden cross / MA50 reclaim</td><td>≈0</td><td>flips sign</td><td>—</td><td>regime-dependent noise</td></tr>
    <tr><td><b>RSI(14) rebound through 30</b></td><td class="pos">+2.0% · 11/15</td><td class="pos">+1.9% · 9/15</td><td class="pos">+4.1% · 14/20</td><td><b>only rule positive everywhere</b></td></tr></table>
    <p>Read the last row honestly: <b>+2–4% median over the following quarter, works on roughly 2 names in 3, and the sample
    cannot statistically separate it from timing luck</b> (oversold rebounds cluster in market-wide selloffs, so 50 names are
    really a handful of independent episodes). No rule reached 80% of names — nothing does; anyone claiming otherwise is
    selling an overfit backtest. What survives: <b>entries don’t create edge — they structure risk.</b> The one directional
    truth in our data favors <b>buying weakness after it stabilizes</b> on already-vetted names, never chasing strength.
    That is exactly how this desk already adds. The verdict decides <i>what</i>; the washout stamp helps with <i>when</i>.</p>`;
  el.innerHTML = `
    <div class="cs-cols">
      <div class="cs-toc"><h3>the Curriculum</h3>
        <ol>${TOC.map((t, i) => `<li onclick="openLesson(${i + 1})">${t}</li>`).join("")}</ol>
        <p class="cs-toc-note">Short lessons, hand-drawn figures, and — where we make a claim — our own tested numbers.
        Every “see it live” opens a real chart from this universe.</p></div>
      <div><div class="cs-lgrid">
        ${card(1, "Reading a candle", figCandle,
          `<p>One candle is one session’s argument between buyers and sellers: the <b>body</b> is where it settled, the
          <b>wicks</b> are where it was refused. Long lower wicks at a support level mean buyers showed up into the fall —
          that is the entire grammar; everything else is sentences built from it.</p>`, "the July defense on RKLB", "RKLB")}
        ${card(2, "Chart types", `<div class="cs-types" id="cs-types"></div>`,
          `<p>The same days, four dialects. <b>Line</b> shows the path, <b>OHLC bars</b> add each day’s range,
          <b>candlesticks</b> make the buyer/seller fight visible at a glance, and <b>Heikin-Ashi</b> averages the noise away
          to show the trend’s spine. The Chart Room speaks candlestick; know the others exist.</p>`, null, null)}
        ${card(3, "Trend & market structure", figTrend,
          `<p>A trend is just a staircase: <b>higher highs and higher lows</b> going up, lower ones going down. The market
          tips its hand at the joints — when a stock stops making higher lows, the staircase is broken <i>before</i> the
          averages notice. Structure first, indicators second.</p>`, "NVDA’s staircase", "NVDA")}
        ${card(4, "Support, resistance & the role flip", figSR,
          `<p>A level the market rejects repeatedly is a memory. <b>Support</b> is where regret and waiting bids live;
          <b>resistance</b> is where trapped buyers wait to get out even. When price finally breaks a ceiling and
          <b>retests it from above</b>, the trapped side flips — the old ceiling becomes a floor, with the stop just
          beneath it. Our levels are computed, never drawn by eye: swing points, clustered, touch-counted.</p>`, "the tested shelf on SAP", "SAP")}
        ${card(5, "Volume — the fuel gauge", figVol,
          `<p>Price says what moved; volume says <b>who showed up</b>. A breakout on expanding volume is participation; the
          same candle on silence is a rumor. In our own test, volume alone rescued nothing (breakout + heavy volume still
          tested negative) — treat it as a <b>veto</b>, not a green light.</p>`, null, null)}
        ${card(6, "Moving averages & our Gate", figMA,
          `<p>An MA is the crowd’s average memory of price. Trend traders don’t predict — they stand aside below it, lean in
          above it. This is precisely the <b>GO / TURN / WAIT</b> gate printed all over this site; in the Chart Room you
          finally <i>see</i> the lines it reads.</p>`, "the gate on your largest holding", "RKLB")}
        ${card(7, "Continuation patterns", figCont,
          `<p>Strong moves rest. <b>Flags</b> (a tight drift against the trend) and <b>triangles</b> (range compressing to a
          point) are the market catching its breath — the move that follows usually resolves in the direction it was already
          going. The measured target is the prior move’s height stacked on the break.</p>`, null, null)}
        ${card(8, "Reversal patterns", figRev,
          `<p><b>Double tops</b> (an M that breaks its neckline) and <b>head-and-shoulders</b> mark exhaustion: each rally
          attracts fewer buyers until the last support gives. They matter most after long runs — a reversal pattern at the
          start of a trend is usually just a pullback wearing a costume.</p>`, null, null)}
        ${card(9, "Breakouts — and bull traps", figBrk,
          `<p>The textbook loves breakouts; our data doesn’t. A <b>clean break</b> needs a close through the level, volume,
          and a hold — and even then, across 50 of our names, fresh-high breakouts carried <b>no edge</b> over just owning
          the stock. The <b>bull trap</b> — a poke above that closes back under — is why: obvious levels attract obvious
          orders. If you play them, play the <i>retest</i>, and let lesson 11 calibrate your expectations.</p>`, null, null)}
        ${card(10, "Entries, stops & risk-reward", figRR,
          `<p>An entry’s real job is to define <b>where you’re wrong, cheaply</b>. Enter at a tested level so the stop sits
          just beneath it; the target is the next tested level. Risk one unit to make two or three — then position size so
          the one unit is survivable. This page’s playbooks are these templates with live numbers; none of them is a
          signal.</p>`, "a live R:R on EFX", "EFX")}
        ${card(11, "What our own data says", null, study, null, null)}
      </div></div></div>`;
  // lesson-2 minis from real bars (whatever chart is loaded; RKLB as fallback)
  const fillTypes = (bars, tk) => {
    const t = document.getElementById("cs-types");
    if (!t) return;
    t.innerHTML = [["line", "Line"], ["bars", "OHLC bars"], ["candle", "Candlesticks"], ["ha", "Heikin-Ashi"]]
      .map(([k, lab]) => `<figure>${crMiniChart(k, bars)}<figcaption>${lab}</figcaption></figure>`).join("")
      + `<div style="grid-column:1/-1;font:italic 11px 'PT Serif',var(--serif);color:var(--ink-3)">real ${esc(tk)} bars, last 30 sessions</div>`;
  };
  if (CR.bars) fillTypes(CR.bars, CR.tkr);
  else crLoadBars("RKLB").then((b) => fillTypes(b, "RKLB")).catch(() => {});
}

/* ---------- the Desk Plan: enter / stop / sell, computed from the chart's own levels ----------
   Advisory overlay for the owner (he executes, he holds responsibility). Numbers come from
   tested structure only — shelves, ceilings, averages — never invented. It reconciles with
   the framework: the verdict decides WHAT deserves capital; this strip advises WHERE. */
function crDeskPlan(tkr, view, feats) {
  const n = view.c.length, px = feats.px;
  const above = feats.levels.filter((c) => c.level >= px * 1.005).sort((a, b) => a.level - b.level);
  const below = feats.levels.filter((c) => c.level < px * 0.995).sort((a, b) => b.level - a.level);
  const s1 = below[0], s2 = below[1], r1 = above[0], r2 = above[1];
  const rsi = feats.rsi[n - 1], ma50 = feats.ma50[n - 1], ma20 = feats.ma20[n - 1];
  const fp = (p) => "$" + (p >= 1000 ? p.toFixed(0) : p >= 100 ? p.toFixed(1) : p.toFixed(2));
  const h = crHolding(tkr), u = crRowFor(tkr);
  const verd = (u && u.verdict) || (h && h.verdict) || "";
  const sig = CR.signals || {};
  const earn = sig.earnings_next && sig.earnings_next[tkr];
  // ---- ENTER ----
  let entry = null, entryTxt = "—", entrySub = "", entryTone = "";
  if (rsi != null && rsi < 30) {
    entryTxt = "not yet";
    entrySub = `RSI ${rsi.toFixed(0)} — knife zone. Our tested rule: wait for the cross back above 30, then bid ${s1 ? "the " + fp(s1.level) + " shelf" : "the base that forms"}.`;
    entryTone = "wait";
  } else if (s1 && (px - s1.level) / s1.level <= 0.015) {
    entry = px; entryTxt = fp(px);
    entrySub = `Enter here — price is sitting on the ${s1.touches}-touch shelf at ${fp(s1.level)}.`;
  } else if (s1) {
    entry = s1.level; entryTxt = fp(s1.level);
    entrySub = `Patient limit at the ${s1.touches}-touch shelf, ${((s1.level / px - 1) * 100).toFixed(1)}% below (last defended ${s1.last.slice(5)}).`;
  } else if (ma50 && ma50 < px * 0.995) {
    entry = ma50; entryTxt = fp(ma50);
    entrySub = `No tested shelf in range — the rising 50-day average (${fp(ma50)}) is the fallback bid.`;
  } else {
    entrySub = "No tested floor beneath the price — stand aside until one forms.";
    entryTone = "wait";
  }
  // ---- STOP ----
  let stop = null, stopTxt = "—", stopSub = "Without an entry there is nothing to protect.";
  if (entry) {
    stop = entry * 0.97;
    if (s2 && s2.level * 0.99 > stop) stop = s2.level * 0.99;
    stopTxt = fp(stop);
    stopSub = `${((stop / entry - 1) * 100).toFixed(1)}% under the entry — the shelf failing is the idea failing. Swing stop: honor it. Accumulating per the verdict instead? A break means re-check, not auto-sell.`;
  }
  // ---- SELL ----
  let target = null, targetTxt = "—", targetSub = "", rrChip = "";
  if (r1) {
    // The chart decides WHERE, never WHETHER: the verdict / weight / event decides whether
    // to sell; the ceiling only picks the best-paid spot once that decision exists.
    target = r1.level; targetTxt = fp(r1.level);
    const avg = h ? (h.avg_cost != null ? h.avg_cost : (h.shares ? h.cost / h.shares : null)) : null;
    targetSub = `The ${r1.touches}-touch ceiling, +${((r1.level / px - 1) * 100).toFixed(1)}% — ${r1.touches} rejections = trapped supply waiting there, though each absorbed test also weakens it${r2 ? ` (a close through flips the map toward ${fp(r2.level)})` : ""}. `;
    if (/AVOID/.test(verd) && h && avg && target > avg) {
      targetSub += `<b>Swing entries harvest here.</b> The position: this is the trim spot — into strength, above your cost, partial — because the <i>verdict</i> (not the chart) wants this capital elsewhere.`;
    } else if (h && avg && target <= avg) {
      targetSub += `<b>Swing entries harvest here.</b> The position: this sits below your ${fp(avg)} cost — no selling at a loss; the exit question waits for strength or a verdict change.`;
    } else if (/STRONG|BUY/.test(verd) && !/AVOID/.test(verd)) {
      targetSub += `<b>Swing entries harvest here</b> — it completes the R:R taken. The investment does NOT auto-sell: the verdict still prices upside, and take-profit rules tested <i>negative</i> in our own study — treat this as a checkpoint, not an exit.`;
    } else {
      targetSub += `<b>Swing entries harvest here.</b> Held as an investment, it is a checkpoint — the chart picks the spot; whether to sell belongs to the verdict.`;
    }
  } else if (feats.hi52 > px * 1.01) {
    target = feats.hi52; targetTxt = fp(feats.hi52);
    targetSub = `No tested ceiling overhead — the 52-week high is the last mark on the map.`;
  } else {
    targetSub = `Open air — at the highs there is no ceiling to sell into; trail the 20-day average${ma20 ? " (" + fp(ma20) + ")" : ""} instead of picking a number.`;
  }
  if (entry && stop && target && target > entry) {
    const rr = (target - entry) / Math.max(entry - stop, 0.01);
    rrChip = `<span class="cr-rr">R:R ${rr.toFixed(1)}</span>`;
  }
  // ---- the advisor's line ----
  const heldAvg = h ? (h.avg_cost != null ? h.avg_cost : (h.shares ? h.cost / h.shares : null)) : null;
  const held = h
    ? (privUnlocked() && h.shares != null
        ? `You hold ${h.shares % 1 ? h.shares.toFixed(1) : h.shares} sh at ${fp(h.shares ? h.cost / h.shares : heldAvg)} (${h.gain_pct >= 0 ? "+" : ""}${(h.gain_pct || 0).toFixed(1)}%). `
        : `You hold this at ${heldAvg != null ? fp(heldAvg) + " avg" : "cost"} (${h.gain_pct >= 0 ? "+" : ""}${(h.gain_pct || 0).toFixed(1)}%). `)
    : "";
  let frame;
  if (/STRONG|BUY/.test(verd) && !/AVOID/.test(verd)) frame = `The framework backs this name (${verd}) — this plan times the add.`;
  else if (/HOLD/.test(verd)) frame = `Framework says ${verd} — quality without a discount; take entries strictly at the levels or not at all.`;
  else if (/AVOID/.test(verd)) frame = `The framework does NOT back this name (${verd}) — anything entered here is a trade, sized small, stop honored without debate.`;
  else frame = `No framework verdict on this name — chart-only read; size accordingly.`;
  // warn only when the print is close enough to be event risk (<=7 calendar days)
  const earnDays = earn ? Math.round((new Date(earn + "T00:00:00Z") - Date.now()) / 86400000) : null;
  const earnWarn = earn && earnDays != null && earnDays >= 0 && earnDays <= 7
    ? ` <b class="cr-plan-warn">⚠ Earnings ${earn} (${earnDays === 0 ? "today" : earnDays + "d"}) — halve size into the print or wait for it; gaps ignore levels.</b>` : "";
  return `<div class="cr-plan">
    <div class="cr-plan-head"><h3>the Desk Plan</h3>
      <span class="cr-plan-note">my advisory read of this chart — you hold the wheel · not licensed advice</span></div>
    <div class="cr-plan-grid">
      <div class="cr-pbox${entryTone ? " " + entryTone : ""}"><div class="cr-pbox-k">Enter</div>
        <div class="cr-pbox-v">${entryTxt}</div><div class="cr-pbox-s">${entrySub}</div></div>
      <div class="cr-pbox stop"><div class="cr-pbox-k">Stop loss</div>
        <div class="cr-pbox-v">${stopTxt}</div><div class="cr-pbox-s">${stopSub}</div></div>
      <div class="cr-pbox sell"><div class="cr-pbox-k">Sell / target ${rrChip}</div>
        <div class="cr-pbox-v">${targetTxt}</div><div class="cr-pbox-s">${targetSub}</div></div>
    </div>
    <div class="cr-plan-say">${held}${frame}${earnWarn}</div>
  </div>`;
}

/* ============================== THE ESTIMATES DESK ==============================
   8th tab (2026-08-07). Renders entirely from DATA.estimates — payload-carried,
   cloud-maintained (earnings_desk.py). No client fetches: consensus, reactions,
   takes, playbooks and the scorecard all arrive in the encrypted payload.
   Doctrine: the Desk times the question around a print; verdicts own whether. */

function edMoney(n) {
  if (n == null || n === 0) return "—";  // 0 = Yahoo's empty-pool placeholder, never real revenue
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${fmtNum(n, 2)}`;
}
function edDots(c) { return "●".repeat(c || 0) + "○".repeat(5 - (c || 0)); }
function edDateTxt(iso) {
  const d = new Date(iso + "T12:00:00");
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
  const wd = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
  return `${wd} ${mon} ${d.getDate()}`;
}
function edDaysOut(iso) {
  return Math.round((new Date(iso + "T12:00:00") - new Date()) / 86400000);
}
function edHourTxt(h) { return h === "amc" ? "after the close" : h === "bmo" ? "before the open" : ""; }
function edCallChip(kind, call, conf) {
  if (!call) return `<span class="ed-chip ed-na">—</span>`;
  const cls = call === "BEAT" || call === "RAISE" || call === "UP" ? "ed-beat"
    : call === "MISS" || call === "CUT" || call === "DOWN" ? "ed-down"
    : call === "NO CALL" ? "ed-na" : "ed-inline";
  const dots = call === "NO CALL" ? "" : ` <span class="ed-conf">${edDots(conf)}</span>`;
  return `<span class="ed-chip ${cls}">${esc(call)}</span>${dots}`;
}
function edBarTxt(e) {
  const l = e.ladder || {};
  if (l.now == null || l.d90 == null || !l.d90) return `<span class="ed-co">—</span>`;
  const pct = ((l.now - l.d90) / Math.abs(l.d90)) * 100;
  if (pct >= 1) return `<span class="ed-up">raised ▴ ${pct.toFixed(1)}%</span>`;
  if (pct <= -1) return `<span class="ed-dn">cut ▾ ${Math.abs(pct).toFixed(1)}%</span>`;
  return `<span class="ed-co">flat</span>`;
}

/* programmatic ladder SVG — y strictly proportional to value (the mis-drawn
   hand-placed draft chart is exactly the bug class this prevents) */
function edLadderSvg(l) {
  const pts = [["90d", l.d90], ["60d", l.d60], ["30d", l.d30], ["7d", l.d7], ["now", l.now]]
    .filter((p) => p[1] != null);
  if (pts.length < 3) return "";
  const vals = pts.map((p) => p[1]);
  const mx = Math.max(...vals), mn = Math.min(...vals);
  const span = mx - mn || Math.abs(mx) * 0.02 || 1;
  const X = (i) => 22 + (i * 256) / (pts.length - 1);
  const Y = (v) => 13 + ((mx - v) * 20) / span;
  const line = pts.map((p, i) => `${X(i)},${Y(p[1]).toFixed(1)}`).join(" ");
  const dots = pts.map((p, i) =>
    `<circle cx="${X(i)}" cy="${Y(p[1]).toFixed(1)}" r="${i === pts.length - 1 ? 3.4 : 2.6}" fill="${i === pts.length - 1 ? "#9a6b25" : "#1a2a55"}"/>`).join("");
  const labels = pts.map((p, i) =>
    `<text x="${X(i)}" y="54" font-size="8.5" fill="${i === pts.length - 1 ? "#9a6b25" : "#8b8e97"}" text-anchor="middle"${i === pts.length - 1 ? ' font-weight="bold"' : ""}>${p[0]} ${fmtNum(p[1], Math.abs(p[1]) < 1 ? 3 : 2)}</text>`).join("");
  return `<svg viewBox="0 0 300 58" width="100%" style="max-width:320px">
    <line x1="8" y1="44" x2="292" y2="44" stroke="#e2ddcf" stroke-width="1"/>
    <polyline points="${line}" fill="none" stroke="#1a2a55" stroke-width="2"/>${dots}${labels}</svg>`;
}

/* surprise record — dollar deltas on near-zero bases (surprise % is noise there) */
function edSurpriseSvg(surprises, epsAvg) {
  const hs = (surprises || []).slice(-4);
  if (!hs.length) return "";
  const nearZero = Math.abs(epsAvg == null ? 1 : epsAvg) < 0.10;
  const vals = hs.map((h) => nearZero ? h.abs : (h.pct == null ? 0 : h.pct * 100));
  const mx = Math.max(...vals.map(Math.abs)) || 1;
  const bars = hs.map((h, i) => {
    const v = vals[i];
    const hgt = Math.max(2, (Math.abs(v) * 24) / mx);
    const up = v >= 0;
    const x = 30 + i * 70;
    const lbl = nearZero ? `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(2)}` : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
    return `<rect x="${x}" y="${up ? 31 - hgt : 31}" width="34" height="${hgt.toFixed(1)}" fill="${up ? "#15803d" : "#be123c"}" opacity=".82"/>
      <text x="${x + 17}" y="59" font-size="8.5" fill="#8b8e97" text-anchor="middle">${esc((h.q || "").slice(0, 7))} ${lbl}</text>`;
  }).join("");
  return `<svg viewBox="0 0 300 64" width="100%" style="max-width:320px">
    <line x1="8" y1="31" x2="292" y2="31" stroke="#cdc7b6" stroke-width="1"/>${bars}</svg>`;
}

function edPosChips(e) {
  const out = [];
  if (e.held) out.push(`<span class="ed-chip ed-hold">HELD ${fmtNum(e.weight_pct, 1)}%</span>`);
  if (e.verdict) {
    const bad = e.verdict === "AVOID" || e.verdict === "STRONG AVOID";
    out.push(`<span class="ed-chip ${bad ? "ed-avoid" : ""}">${esc(e.verdict)}${e.qarp ? " " + fmtNum(e.qarp, 1) : ""}</span>`);
  }
  return out.join(" ");
}

/* docket rows — stacked flex rows, can never overflow the sheet (the 10-column
   table clipped its right half on desktop and demanded pinch-zoom on mobile) */
function edDocketRowHtml(e) {
  const days = edDaysOut(e.print_date);
  const c = e.calls || {}, eps = e.eps || {}, rev = e.rev || {}, rx = e.reactions || {};
  const when = `${edDateTxt(e.print_date)}${e.hour ? " · " + e.hour.toUpperCase() : ""}`;
  const tchip = days === 0 ? ` <span class="ed-chip ed-warn">PRINTS TODAY</span>` : days > 0 ? ` · T−${days}` : "";
  const figs = e.skip
    ? `<span class="ed-co">${esc(e.skip.reason)} — event coverage only, no faked call</span>`
    : [
        eps.avg != null ? `EPS ${fmtNum(eps.avg, Math.abs(eps.avg) < 1 ? 3 : 2)} <span class="ed-co">(${eps.n} an.)</span>` : null,
        rev.avg ? `rev ${edMoney(rev.avg)}${rev.growth != null ? ` <span class="${signClass(rev.growth * 100)}">${fmtPct(rev.growth * 100)}</span>` : ""}` : null,
        `bar ${edBarTxt(e)}`,
        rx.median_abs != null ? `moves ±${fmtNum(rx.median_abs, 1)}%` : null,
      ].filter(Boolean).join(`<span class="ed-co"> · </span>`);
  const calls = e.skip ? "" : c.print
    ? `<span class="ed-lbl2">PRINT</span>${edCallChip("print", c.print, c.print_conf)}
       <span class="ed-lbl2">GUIDE</span>${edCallChip("guide", c.guide, c.guide_conf)}
       <span class="ed-lbl2">TAPE</span>${edCallChip("tape", c.tape, c.tape_conf)}`
    /* a name that reached its print takeless is a MISS the desk owns out loud —
       blank calls here used to read as "pending" forever (NABL, 2026-08-10) */
    : e.no_call
    ? `<span class="ed-pendchip ed-warn">NO CALL — printed before a take was written (${esc(e.no_call.hour || "hour unknown")})</span>`
    : `<span class="ed-pendchip">numbers live — the take lands at T−10</span>`;
  return `<div class="ed-drow" onclick="edOpenCard('${esc(e.tk)}')">
    <div class="ed-drow-top">
      <span class="ed-tk">${esc(e.tk)}</span> <span class="ed-co">${esc(e.name || "")}</span> ${edPosChips(e)}
      <span class="ed-drow-when">${when}${tchip}</span>
    </div>
    <div class="ed-drow-figs">${figs}</div>
    <div class="ed-drow-calls">${calls}<span class="ed-drow-open">open card →</span></div>
  </div>`;
}

function edDocketHtml(docket) {
  return `<div class="ed-sec-h"><h2>The Docket</h2><span class="ed-sub">Confirmed prints, next 3 weeks · tap a row</span></div>
  ${docket.map(edDocketRowHtml).join("")}
  <p class="ed-legend">PRINT beat/inline/miss · GUIDE raise/hold/cut · TAPE up/down/muted on the reaction close ·
  every name with numbers gets all three calls (owner's standing order) · ●○ conviction 1–5, 1 = minimal edge —
  the side the desk would lean with real money · only data-absent names (semi-annual reporters) go uncalled</p>
  <details class="ed-more"><summary>How names get on the docket</summary>
  Holdings always; unheld names at BUY or better; plus names under an active re-score watch. Everything else prints
  without a take. Names enter when a confirmed date comes inside 21 days; takes are written from 10 days out,
  re-checked every desk run and rewritten when the inputs move — the last pre-print snapshot is what grades.</details>`;
}

function edOpenCard(tk) {
  const card = document.getElementById("ed-card-" + tk);
  if (!card) return;
  card.classList.remove("ed-closed");
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}
function edToggleCard(tk) {
  const card = document.getElementById("ed-card-" + tk);
  if (card) card.classList.toggle("ed-closed");
}

function edCalStripHtml() {
  const srv = (typeof SIGNALS !== "undefined" && SIGNALS && SIGNALS.earnings_next) || {};
  const from = new Date().toISOString().slice(0, 10);
  const items = (DATA.portfolio || [])
    .map((h) => ({ tk: h.ticker, date: srv[h.ticker] }))
    .filter((x) => x.date && x.date >= from)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!items.length) return "";
  // group by month so the strip reads as a calendar, not a word-soup line
  const MON = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const groups = [];
  for (const x of items) {
    const d = new Date(x.date + "T12:00:00");
    const m = MON[d.getMonth()];
    if (!groups.length || groups[groups.length - 1].m !== m) groups.push({ m, es: [] });
    groups[groups.length - 1].es.push(`<span class="ed-e"><i>${esc(x.tk)}</i> ${d.getDate()}</span>`);
  }
  return `<div class="ed-calstrip"><span class="ed-cal-lbl">THE BOOK'S PRINTS AHEAD</span>${groups.map((g) =>
    `<span class="ed-cal-mon">${g.m}</span>${g.es.join("")}`).join("")}</div>`;
}

function edCardHtml(e) {
  const eps = e.eps || {}, rev = e.rev || {}, rvs = e.revisions || {}, rx = e.reactions || {};
  const days = edDaysOut(e.print_date);
  const when = `${edDateTxt(e.print_date).toUpperCase()}${e.hour ? " · " + edHourTxt(e.hour).toUpperCase() : ""}${e.date_estimated ? "" : " · CONFIRMED"}${days > 0 ? ` · T−${days}` : days === 0 ? " · TODAY" : ""}`;
  if (e.skip) {
    const fy = ((e.skip.annual || {}).fy_eps) || {};
    const fyr = ((e.skip.annual || {}).fy_rev) || {};
    return `<div class="ed-note-card" id="ed-card-${esc(e.tk)}">
      <span class="ed-tk">${esc(e.tk)}</span> <b>${esc(e.name)} · ${edDateTxt(e.print_date)}${e.verdict ? " · " + esc(e.verdict) + (e.qarp ? " " + fmtNum(e.qarp, 1) : "") : ""}</b>
      — ${esc(e.skip.reason)}. ${fy.avg != null ? `Annual anchor: FY EPS ${fmtNum(fy.avg, 2)} (n=${fy.n || "?"})${fyr.avg != null ? `, revenue ${edMoney(fyr.avg)} (n=${fyr.n || "?"})` : ""}.` : ""}
      <b>The Desk does not fake a call it cannot ground</b> — this name gets event-risk coverage only: the date,
      the anchor, and the post-print re-score check.</div>`;
  }
  const ladder = edLadderSvg(e.ladder || {});
  const spr = edSurpriseSvg(e.surprises, eps.avg);
  const rxRows = (rx.rows || []).slice(0, 8).map((r) =>
    `<tr><td>${edDateTxt(r.date)} <span class="ed-co">${esc(r.timing || "")}</span></td>
     <td class="${r.gap == null ? "" : signClass(r.gap)}">${r.gap == null ? "—" : fmtPct(r.gap)}</td>
     <td class="${signClass(r.close)}">${fmtPct(r.close)}</td></tr>`).join("");
  const c = e.calls || {};
  const take = e.take || {};
  const runup = e.runup || {};
  const revline = (e.revlog || []).map((r) =>
    `<br>REVISED ${esc(r.at)}: ${esc(r.call)} ${esc(r.from)} → ${esc(r.to)}`).join("");
  const gradeDay = e.hour === "bmo" ? e.print_date : null;
  return `<div class="ed-card${e.collapsed ? " ed-closed" : ""}" id="ed-card-${esc(e.tk)}">
    <div class="ed-card-head" onclick="edToggleCard('${esc(e.tk)}')">
      <span class="ed-caret">▾</span>
      <span class="ed-name">${esc(e.name)}</span><span class="ed-tk">${esc(e.tk)}</span>
      ${edPosChips(e)}
      ${e.held && e.gain_pct != null ? `<span class="ed-chip">${e.gain_pct >= 0 ? "in profit +" + fmtNum(e.gain_pct, 1) + "%" : "below cost −" + fmtNum(Math.abs(e.gain_pct), 1) + "%"}</span>` : ""}
      <span class="ed-chip" style="cursor:pointer;color:var(--brand);font-weight:700" onclick="event.stopPropagation();openChart('${esc(e.tk)}')">Desk Plan →</span>
      <span class="ed-when">${when}</span>
    </div>
    <div class="ed-card-body">
      <div class="ed-numbers">
        <div class="ed-blk-h">Consensus — ${e.period ? "quarter ending " + esc(e.period) : "this quarter"}</div>
        <div class="ed-kv"><span class="ed-k">EPS consensus (${eps.n || "?"} analysts)</span>
          <span class="ed-v">${fmtNum(eps.avg, 3)} ${eps.low != null ? `[${fmtNum(eps.low, 2)} … ${fmtNum(eps.high, 2)}]` : ""}</span></div>
        <div class="ed-kv"><span class="ed-k">Revenue consensus (${rev.n || "?"} analysts)</span>
          <span class="ed-v">${edMoney(rev.avg)}${rev.growth != null ? ` <span class="${signClass(rev.growth * 100)}">${fmtPct(rev.growth * 100)} y/y</span>` : ""}</span></div>
        <div class="ed-kv"><span class="ed-k">Revisions</span>
          <span class="ed-v"><span class="${rvs.up7 ? "ed-up" : "ed-co"}">${rvs.up7 || 0}↑</span>/<span class="${rvs.dn7 ? "ed-dn" : "ed-co"}">${rvs.dn7 || 0}↓</span> 7d ·
          <span class="${rvs.up30 ? "ed-up" : "ed-co"}">${rvs.up30 || 0}↑</span>/<span class="${rvs.dn30 ? "ed-dn" : "ed-co"}">${rvs.dn30 || 0}↓</span> 30d</span></div>
        ${ladder ? `<div class="ed-blk-h">The bar, last 90 days</div>${ladder}` : ""}
        ${spr ? `<div class="ed-blk-h">Surprise record — last ${Math.min(4, (e.surprises || []).length)} prints</div>${spr}` : ""}
        ${rxRows ? `<div class="ed-blk-h">How this name trades its prints</div>
          <table class="ed-rx"><tr><th>Print</th><th>Gap</th><th>Close</th></tr>${rxRows}</table>
          <div class="ed-kv" style="margin-top:8px"><span class="ed-k">Median move · worst · best</span>
            <span class="ed-v">±${fmtNum(rx.median_abs, 1)}% · ${fmtPct(rx.worst)} · ${fmtPct(rx.best)}</span></div>` : ""}
        ${runup.d5 != null ? `<div class="ed-kv"><span class="ed-k">Into the print</span>
          <span class="ed-v"><span class="${signClass(runup.d5)}">${fmtPct(runup.d5)} 5d</span> · ${fmtPct(runup.d20)} 20d · ${fmtPct(runup.d60)} 60d</span></div>` : ""}
      </div>
      <div class="ed-call-side">
        <div class="ed-calls">
          <div class="ed-callrow"><span class="ed-lbl">PRINT</span>${edCallChip("print", c.print, c.print_conf)}</div>
          <div class="ed-callrow"><span class="ed-lbl">GUIDE</span>${edCallChip("guide", c.guide, c.guide_conf)}</div>
          <div class="ed-callrow"><span class="ed-lbl">TAPE</span>${edCallChip("tape", c.tape, c.tape_conf)}</div>
        </div>
        ${take.bar_read ? `<div class="ed-blk-h">The bar</div><div class="ed-kv" style="border:0"><span class="ed-v" style="text-align:left;font-family:var(--sans);font-size:12.5px;color:var(--ink-2)">${take.bar_read}</span></div>` : ""}
        ${take.html ? `<div class="ed-take">${take.html}</div>`
          : `<p class="ed-pending">Take pending — the Desk writes it from T−10; the numbers on this card are live now.</p>`}
        <div class="ed-playbook"><div class="ed-pb-h">PRE-PRINT PLAYBOOK${e.held ? ` — HELD ${fmtNum(e.weight_pct, 1)}%` : " — NOT HELD"}</div>
          <div class="ed-pb-b">${e.playbook_html || ""}</div></div>
        <div class="ed-whytag">at-call: px ${fmtNum(e.px, 2)} · cons ${fmtNum(eps.avg, 3)} (n=${eps.n || "?"}) · ${rvs.up7 || 0}↑/${rvs.dn7 || 0}↓ 7d${take.written_at ? ` · written ${esc(take.written_at)}` : ""} · grades ${gradeDay ? "same session" : "next session"} + guide at T+7${e.mech_calls ? `<br>shadow baseline (arithmetic only, graded alongside): ${esc(e.mech_calls.print)} / ${esc(e.mech_calls.guide)} / ${esc(e.mech_calls.tape)}` : ""}${revline}</div>
      </div>
    </div>
  </div>`;
}

function edScorecardHtml(sc) {
  const t = (sc && sc.tallies) || {};
  const anyGraded = ["print", "tape", "guide"].some((k) => t[k] && (t[k].HIT + t[k].MISS + t[k].ABSTAIN) > 0);
  const vcls = (v) => v === "HIT" ? "ed-hit" : v === "MISS" ? "ed-missv" : "ed-abst";
  const rows = ((sc && sc.rows) || []).map((r) => {
    const g = r.grades || {};
    const cell = (k) => {
      const call = (r.calls || {})[k];
      const gr = g[k];
      if (!gr) return `<td>${esc(call || "—")} <span class="ed-co">${edDaysOut(r.print_date) >= 0 ? "frozen" : "awaiting"}</span></td>`;
      return `<td>${esc(call || "—")} → ${esc(gr.outcome || "?")} <span class="${vcls(gr.verdict)}">${esc(gr.verdict)}</span></td>`;
    };
    return `<tr><td class="ed-tk">${esc(r.tk)}</td><td>${edDateTxt(r.print_date)}</td>${cell("print")}${cell("guide")}${cell("tape")}</tr>`;
  }).join("");
  const mt = (sc && sc.mech_tallies) || {};
  const ht = (sc && sc.hi_tallies) || {};
  const tally = (k, lbl) => {
    const x = t[k] || { HIT: 0, MISS: 0, ABSTAIN: 0 };
    const m = mt[k] || { HIT: 0, MISS: 0 };
    const hx = ht[k] || { HIT: 0, MISS: 0 };
    const n = x.HIT + x.MISS, mn = m.HIT + m.MISS, hn = hx.HIT + hx.MISS;
    return `${lbl} ${n ? Math.round((100 * x.HIT) / n) + "% of " + n : "—"}${hn ? ` <span class="ed-co">(●●●+ ${Math.round((100 * hx.HIT) / hn)}%)</span>` : ""}${mn ? ` <span class="ed-co">(baseline ${Math.round((100 * m.HIT) / mn)}%)</span>` : ""}${x.ABSTAIN ? ` (+${x.ABSTAIN} legacy abstains)` : ""}`;
  };
  return `<div class="ed-sec-h"><h2>The Scorecard</h2><span class="ed-sub">Every call graded · abstentions counted · nothing memory-holed</span></div>
  <div class="ed-score">
    ${anyGraded
      ? `<div class="ed-big">${tally("print", "PRINT")} · ${tally("guide", "GUIDE")} · ${tally("tape", "TAPE")}</div>`
      : `<div class="ed-big">No graded calls yet — the first frozen calls grade off the next wave.</div>`}
    <p>Every call freezes when written (the at-call line under each take). A take may be rewritten up to the print
    as inputs move — each rewrite appends a visible revision line, and <b>the last pre-print snapshot is what
    grades</b>. Low-conviction calls grade like any other — hit rates split by conviction, so a forced coin-flip can't inflate the record. If these calls turn out no better than a coin,
    this table will say so.</p>
    <p class="ed-lifecycle">LIFECYCLE&nbsp; <b>T−n</b> → <b>PRINTS TODAY</b> → <b>AWAITING REACTION</b> (print grade posts same night · tape next session · guide at T+7) → <b>GRADED</b></p>
    ${rows ? `<table class="ed-ledger"><tr><th>Name</th><th>Print</th><th>Print call</th><th>Guide call</th><th>Tape call</th></tr>${rows}</table>` : ""}
    <div class="ed-grade-rules">
      <div class="ed-g"><b>PRINT — graded vs actuals.</b> Beat/miss against reported EPS vs the frozen consensus.
        Inline band: ±2% (±$0.01 where the base is near zero — surprise % is noise there).</div>
      <div class="ed-g"><b>TAPE — graded vs the reaction session.</b> AMC → next session, BMO → same session, from our
        own bar data; ambiguous timings grade close-to-close only. "Muted" = under half the name's typical move.</div>
      <div class="ed-g"><b>GUIDE — graded vs the forward bar.</b> Where the current-FY consensus stands 7 sessions
        after the print vs the freeze: raised (+2%), cut (−2%), else held. Slower, but objective.</div>
      <div class="ed-g"><b>THE SHADOW BASELINE.</b> Every house call is graded against a frozen arithmetic-only
        call — beat-rate + revision tilt + run-up vs typical move, no news, no judgment (rules pre-registered,
        never tuned). If the analysis layer doesn't beat the arithmetic, this table will show it.</div>
    </div>
  </div>`;
}

function edHowHtml() {
  return `<div class="ed-how">
    <div class="ed-box"><h4>① THE PRINT — beat · inline · miss</h4>
      <p>Will the reported number land above or below the consensus bar? Called from the company's own surprise
      record, the direction analysts are moving, and how tight their range is.</p></div>
    <div class="ed-box"><h4>② THE GUIDE — raise · hold · cut</h4>
      <p>The quarter is history the moment it prints — the forward guide is what re-prices the stock.
      Often the only call that matters.</p></div>
    <div class="ed-box"><h4>③ THE TAPE — up · down · muted</h4>
      <p>What's already priced in. A beat over a bar the market has silently raised sells off; a "miss" against
      slashed estimates can rally. This call frames what a print is worth once it lands.</p></div>
  </div>
  <p class="ed-boundary">The Desk decides <b>when</b> around a print. The verdict still decides <b>whether</b> — nothing here overrides QARP.</p>`;
}

function renderEstimates() {
  const el = document.getElementById("ed-body");
  if (!el || typeof DATA === "undefined" || !DATA) return;
  const est = DATA.estimates;
  if (!est || !(est.docket || []).length) {
    el.innerHTML = `<p class="muted" style="padding:24px 0">The desk is being seeded — the next cloud run fills it. Nothing is faked in the meantime.</p>`;
    return;
  }
  const docket = est.docket;
  // this week expanded, further-out collapsed to their headline — ten open cards
  // stacked was an endless scroll (user: "fix the UX")
  const week = docket.filter((e) => edDaysOut(e.print_date) <= 7);
  const later = docket.filter((e) => edDaysOut(e.print_date) > 7);
  later.forEach((e) => { if (!e.skip) e.collapsed = true; });
  el.innerHTML = edHowHtml() + edCalStripHtml() + edDocketHtml(docket)
    + (week.length ? `<div class="ed-sec-h"><h2>This Week's Wave</h2><span class="ed-sub">Numbers left · the house call right · as of ${esc(est.asof || "")}</span></div>`
        + week.map(edCardHtml).join("") : "")
    + (later.length ? `<div class="ed-sec-h"><h2>Further Out</h2><span class="ed-sub">Tap a card to open it</span></div>`
        + later.map(edCardHtml).join("") : "")
    + edScorecardHtml(est.scorecard)
    + `<p class="ed-legend" style="margin-top:18px">SOURCES — consensus, revisions &amp; surprise history: Yahoo estimate
    pools (canonical), dates &amp; AMC/BMO cross-checked against the Finnhub calendar where available · reaction history:
    the Desk's own daily bars · takes: house model, frozen at-call, graded after — causal reads beyond the data are
    marked "house read." The Desk times entries around prints; verdicts own the buy/sell question. Not licensed advice.</p>`;
}

function enterEstimates() { renderEstimates(); }
function openEstimates(tk) {
  const btn = document.querySelector('.tab[data-tab="estimates"]');
  if (btn && !btn.classList.contains("active")) btn.click();
  setTimeout(() => {
    const card = document.getElementById("ed-card-" + tk);
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 60);
}
