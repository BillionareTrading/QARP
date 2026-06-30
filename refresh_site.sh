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
  # DEVICE-FREE FEEDS: the cloud (GitHub Actions) owns news/signals, 13F, the column and the book
  # read — and enriches signals with OpenAI embeddings. This machine must NEVER publish those, or it
  # overwrites the enriched feed with a keyless one. Drop any local drift on them, sync, then push
  # ONLY the encrypted price payload.
  git checkout -- signals.json gurus.json daily_brief.json book_brief.json 2>/dev/null || true
  git pull --rebase --quiet origin main 2>/dev/null || true
  # PRE-PUBLISH GATE: stamp consistency + the payload must not outrun the (about-to-be-live) feeds
  # beyond the render tolerance, or the Times front page drops to the generic fallback. Abort if so.
  if ! "$PY" verify_publish.py; then
    echo "refresh_site: PRE-PUBLISH GATE FAILED — not pushing. Regenerate today's column or hold." >&2
    exit 1
  fi
  git add payload.enc 2>/dev/null
  git commit -m "price refresh $(cat payload.enc | python3 -c 'import sys,json;print(json.load(sys.stdin)["date"])')" --quiet || true
  git push --quiet origin main && echo "refresh_site: pushed to remote."
fi
