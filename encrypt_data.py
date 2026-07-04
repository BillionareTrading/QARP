#!/usr/bin/env python3
"""
encrypt_data.py — encrypt data.json into payload.enc for the password-gated site.

The website is a STATIC site (GitHub Pages / Netlify free / local file). Those
hosts can't gate data behind a real server login, so instead we encrypt the
data client-side: the host only ever stores ciphertext, and the browser
decrypts it in-memory after you type the password. Wrong password -> the
AES-GCM auth tag fails -> nothing renders.

Crypto (must stay in lockstep with crypto.js in the browser):
  - key  = PBKDF2-HMAC-SHA256(password, salt, ITERATIONS) -> 256-bit
  - enc  = AES-256-GCM(key, iv=12B nonce) over the UTF-8 JSON
  - cryptography's AESGCM.encrypt returns ciphertext||tag, which is exactly
    what Web Crypto's subtle.decrypt expects. Salt=16B, IV=12B, both random.

Password source (first that exists wins):
  1. $SITE_PASSWORD env var          (used by the daily cron, non-interactive)
  2. .site_password file (one line)  (local secret, gitignored)
  3. interactive getpass prompt      (manual run)

Run after every data.json refresh:  python3 encrypt_data.py
"""

import base64
import getpass
import gzip
import json
import os
import sys

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data.json")
OUT = os.path.join(HERE, "payload.enc")
PW_FILE = os.path.join(HERE, ".site_password")
ITERATIONS = 250_000


def get_password() -> str:
    env = os.environ.get("SITE_PASSWORD")
    if env:
        return env
    if os.path.exists(PW_FILE):
        with open(PW_FILE) as f:
            pw = f.read().strip()
        if pw:
            return pw
    if not sys.stdin.isatty():
        sys.exit("ERROR: no $SITE_PASSWORD and no .site_password, and not a TTY to prompt.")
    pw = getpass.getpass("Set/enter site password: ")
    confirm = getpass.getpass("Confirm password: ")
    if pw != confirm:
        sys.exit("ERROR: passwords do not match.")
    if not pw:
        sys.exit("ERROR: empty password.")
    return pw


def load_finnhub_key() -> str:
    """Finnhub API key for live in-browser quotes. Read from a local secret so
    it travels INSIDE the encrypted payload (never in a public file)."""
    env = os.environ.get("FINNHUB_KEY")
    if env:
        return env.strip()
    p = os.path.join(HERE, ".finnhub_key")
    if os.path.exists(p):
        with open(p) as f:
            return f.read().strip()
    return ""


def main() -> None:
    with open(DATA) as f:
        data = json.load(f)

    # ---- PUBLISH SAFETY GUARD (added after the 2026-06-26 stale-price incident) ----
    # A build run WITHOUT --fetch writes the script's hardcoded fallback prices. Shipping that
    # corrupts every price/value on the site. build_master_sheet.py sets meta.prices_live=True
    # only after a healthy live fetch; refuse to encrypt anything else. (Flag absent => older
    # build, allowed for back-compat. Use --allow-stale to override on purpose.)
    _live = data.get("meta", {}).get("prices_live")
    if _live is False and "--allow-stale" not in sys.argv:
        sys.exit("REFUSING TO PUBLISH: data.json has prices_live=false — it was built without a "
                 "live --fetch, so its prices are stale fallbacks. Rebuild with "
                 "'build_master_sheet.py --fetch --live --json', then re-encrypt. "
                 "(Pass --allow-stale only if you deliberately want non-live data.)")

    # Live QUOTES go through the Cloudflare Worker (meta.quote_proxy) — key hidden there.
    # But the low-frequency News + Earnings-calendar features still call Finnhub directly,
    # so the key travels INSIDE the encrypted payload (readable only after unlocking with
    # the password — never in a public file). (Could move those to the Worker later too.)
    fk = load_finnhub_key()
    if fk:
        data.setdefault("meta", {})["finnhub_key"] = fk
    # v2: gzip before encrypting — the payload carries full company profiles now, and
    # compressed JSON is ~3-4x smaller. crypto.js auto-detects: decrypted bytes starting
    # with the gzip magic (0x1f 0x8b) are inflated first; old v1 payloads (raw JSON,
    # starts with '{') still parse, so the transition is backward-compatible.
    plaintext = gzip.compress(json.dumps(data, separators=(",", ":")).encode("utf-8"), 6)

    password = get_password().encode("utf-8")
    salt = os.urandom(16)
    iv = os.urandom(12)

    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS)
    key = kdf.derive(password)

    ciphertext = AESGCM(key).encrypt(iv, plaintext, None)  # returns ct||tag

    payload = {
        "v": 2,   # v2 = plaintext is gzipped JSON (crypto.js sniffs the gzip magic)
        "kdf": "PBKDF2-SHA256",
        "iterations": ITERATIONS,
        "cipher": "AES-256-GCM",
        "salt": base64.b64encode(salt).decode(),
        "iv": base64.b64encode(iv).decode(),
        "ct": base64.b64encode(ciphertext).decode(),
        # plaintext metadata is safe to expose and lets the gate show a date
        # without decrypting; do NOT put holdings or the API key here.
        "date": data.get("meta", {}).get("date", ""),
    }
    with open(OUT, "w") as f:
        json.dump(payload, f)

    print(f"Wrote {OUT}  ({len(ciphertext)} bytes ciphertext, {ITERATIONS} PBKDF2 iters"
          f"{', +finnhub key' if fk else ''})")


if __name__ == "__main__":
    main()
