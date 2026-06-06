#!/usr/bin/env python3
"""
stamp_assets.py — cache-busting for the static site.

Stamps a short content-hash version onto the CSS/JS links in index.html, e.g.
  <link href="styles.css?v=a1b2c3d4">  <script src="app.js?v=a1b2c3d4">

Because the version is a hash of the files' contents, it changes ONLY when the
code changes — so a deploy is picked up by browsers immediately (no hard-refresh),
while unchanged assets stay cached. payload.enc is already fetched no-store.

Run after editing app.js / styles.css / crypto.js, before committing index.html.
"""
import hashlib
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(HERE, "index.html")
ASSETS = ["styles.css", "crypto.js", "app.js"]

h = hashlib.sha256()
for a in ASSETS:
    with open(os.path.join(HERE, a), "rb") as f:
        h.update(f.read())
ver = h.hexdigest()[:8]

html = open(INDEX, encoding="utf-8").read()
new_html = re.sub(
    r'(href|src)="(styles\.css|crypto\.js|app\.js)(\?v=[0-9a-f]+)?"',
    rf'\1="\2?v={ver}"',
    html,
)

if new_html != html:
    with open(INDEX, "w", encoding="utf-8") as f:
        f.write(new_html)
    print(f"Stamped index.html assets with v={ver}")
else:
    print(f"index.html already at v={ver} (no change)")
