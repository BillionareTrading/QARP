#!/usr/bin/env python3
"""
verify_publish.py — revision guard for the QARP site.

Enforces the one invariant every "shipped a stale version" bug violated:
  index.html's ?v= == sha256(styles.css + crypto.js + app.js)[:8]   (stamp matches content)
  AND the LIVE site serves exactly those committed files at that stamp.

  python verify_publish.py          # local stamp-consistency (instant, no network)
  python verify_publish.py --live   # + poll the live site until it matches local (tolerates
                                     #   GitHub Pages propagation lag), then PASS; FAIL on timeout

Exit 0 = PASS; exit 1 = FAIL (prints exactly what is stale / mismatched).
"""
import sys, os, re, time, hashlib, urllib.request, json

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = ["styles.css", "crypto.js", "app.js"]
SITE = "https://billionaretrading.github.io/QARP"
UA = {"User-Agent": "Mozilla/5.0 (verify_publish)"}
POLL_TRIES, POLL_GAP = 6, 15   # up to ~90s for Pages to propagate


def _read(p):
    with open(os.path.join(HERE, p), "rb") as f:
        return f.read()


def _sha(b):
    return hashlib.sha256(b).hexdigest()


def _expected_ver():
    h = hashlib.sha256()
    for a in ASSETS:
        h.update(_read(a))
    return h.hexdigest()[:8]


def _ver_in(html):
    m = re.search(r"app\.js\?v=([0-9a-f]+)", html)
    return m.group(1) if m else None


def _fetch(path):
    return urllib.request.urlopen(urllib.request.Request(SITE + "/" + path, headers=UA), timeout=25).read()


def _check_live(local_ver):
    """One live pass. Returns list of failures (empty = matches local)."""
    fails = []
    rindex = _fetch("index.html?cb=%d" % int(time.time())).decode("utf-8", "ignore")
    rver = _ver_in(rindex)
    if rver != local_ver:
        fails.append("LIVE index stamp v=%s != local v=%s" % (rver, local_ver))
    for a in ASSETS:
        try:
            if _sha(_fetch(a + "?cb=%d" % int(time.time()))) != _sha(_read(a)):
                fails.append("LIVE %s differs from local committed bytes" % a)
        except Exception as e:
            fails.append("LIVE %s fetch failed: %s" % (a, str(e)[:60]))
    try:
        bz = json.loads(_fetch("signals.json?cb=v")).get("bz_news", [])
        if bz and not any("relevance" in n for n in bz):
            fails.append("LIVE signals.json has NO relevance scores (news enrichment lost)")
    except Exception:
        pass
    # THE TIMES front page: the daily column must be present + non-empty, and must not lag the
    # payload beyond app.js's render tolerance (4 calendar days). If it does, the front page
    # silently drops to the generic "Shariah universe trades mixed…" fallback — the exact
    # regression this guard now exists to catch. Mirrors leadFresh() in app.js.
    try:
        from datetime import date as _date
        try:
            meta_date = json.loads(open(os.path.join(HERE, "data.json")).read()).get("meta", {}).get("date", "")
        except Exception:
            meta_date = ""
        bj = json.loads(_fetch("daily_brief.json?cb=%d" % int(time.time())))
        if not (bj.get("headline") and bj.get("body_html")):
            fails.append("LIVE daily_brief.json missing headline/body — Times page falls back to the generic auto-headline")
        bd = bj.get("date", "")
        if meta_date and bd:
            lag = (_date.fromisoformat(meta_date) - _date.fromisoformat(bd)).days
            if lag > 4:
                fails.append("LIVE Times column lags the payload by %dd (column %s vs payload %s) -> front page shows the generic fallback" % (lag, bd, meta_date))
    except Exception as e:
        fails.append("LIVE daily_brief.json fetch/parse failed: %s" % str(e)[:60])
    return fails


def main():
    fails = []
    local_index = open(os.path.join(HERE, "index.html"), encoding="utf-8").read()
    exp, loc = _expected_ver(), _ver_in(open(os.path.join(HERE, "index.html"), encoding="utf-8").read())

    # 1) LOCAL: stamp must match current asset content (catches an un-re-stamped / reverted index)
    if loc != exp:
        fails.append("LOCAL stamp stale: index.html says v=%s but assets hash to v=%s -> run stamp_assets.py" % (loc, exp))

    # 2) LIVE: poll until the served site matches local, tolerating propagation lag
    if "--live" in sys.argv and not fails:
        live_fails = ["(not checked)"]
        for i in range(POLL_TRIES):
            try:
                live_fails = _check_live(loc)
            except Exception as e:
                live_fails = ["LIVE fetch failed: %s" % str(e)[:80]]
            if not live_fails:
                break
            if i < POLL_TRIES - 1:
                time.sleep(POLL_GAP)
        fails += live_fails

    if fails:
        print("REVISION CHECK: FAIL")
        for f in fails:
            print("  x " + f)
        return 1
    print("REVISION CHECK: PASS (v=%s%s)" % (loc, " - live matches local" if "--live" in sys.argv else " - local stamp current"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
