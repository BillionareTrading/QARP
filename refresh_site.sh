#!/bin/bash
# refresh_site.sh — re-encrypt the site data after a data.json refresh.
# Reads the password from .site_password (so it runs non-interactively from cron).
# Call this AFTER build_master_sheet.py regenerates Website/data.json each day.
#
#   ./refresh_site.sh                 # re-encrypt only
#   PUSH=1 ./refresh_site.sh          # re-encrypt AND git-push payload.enc (if hosted via git)

set -e
cd "$(dirname "$0")"

if [ ! -f .site_password ]; then
  echo "refresh_site: no .site_password file — skipping (set one to enable auto-encrypt)." >&2
  exit 0
fi

# Use the same interpreter the cron uses (anaconda) when available; PATH in
# cron is minimal, so don't rely on a bare `python3`.
PY="/opt/anaconda3/bin/python3"
[ -x "$PY" ] || PY="python3"
"$PY" encrypt_data.py
echo "refresh_site: payload.enc regenerated."

if [ "$PUSH" = "1" ] && [ -d .git ]; then
  git add payload.enc
  git commit -m "data refresh $(cat payload.enc | python3 -c 'import sys,json;print(json.load(sys.stdin)["date"])')" --quiet || true
  git push --quiet && echo "refresh_site: pushed to remote."
fi
