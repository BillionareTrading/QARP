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

    # Live QUOTES go through the Cloudflare Worker (meta.quote_proxy) — key hidden there.
    # But the low-frequency News + Earnings-calendar features still call Finnhub directly,
    # so the key travels INSIDE the encrypted payload (readable only after unlocking with
    # the password — never in a public file). (Could move those to the Worker later too.)
    fk = load_finnhub_key()
    if fk:
        data.setdefault("meta", {})["finnhub_key"] = fk
    plaintext = json.dumps(data, separators=(",", ":")).encode("utf-8")

    password = get_password().encode("utf-8")
    salt = os.urandom(16)
    iv = os.urandom(12)

    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS)
    key = kdf.derive(password)

    ciphertext = AESGCM(key).encrypt(iv, plaintext, None)  # returns ct||tag

    payload = {
        "v": 1,
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
