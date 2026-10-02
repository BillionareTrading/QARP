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

# --- SYNC FIRST, ON A CLEAN TREE (2026-10-02) ------------------------------------------------
# This used to run `git pull --rebase` AFTER encrypt_data.py. The encrypt always rewrites the
# tracked payload.enc / private.enc (fresh random salt), git refuses a rebase-pull on a dirty
# tree, and the error was swallowed — so the sync never happened and every push was rejected
# as soon as the cloud or the desk had pushed. Now the sync runs BEFORE the encrypt:
#   1. drop local drift on the files this script (payload/private) or the cloud (feeds, charts)
#      owns, so the tree is clean where it matters;
#   2. fetch, and if the only local-only commits are this script's own disposable price
#      refreshes, move to origin/main (`reset --keep` refuses rather than touch a file that
#      has local edits);
#   3. if this clone still is not origin/main plus nothing of its own — unpushed desk commits,
#      or local edits blocking the move — say so and stop BEFORE encrypting: no dirty blobs,
#      no doomed commit, and nothing unpushed gets published by this script.
# Fail open: a failed fetch or an unexpected git error falls through to the old behaviour
# (encrypt, commit, try to push); only a definite "not in sync" stops the tick.
if [ "$PUSH" = "1" ] && [ -d .git ]; then
  # A conflicted pull/rebase can leave a rebase-merge dir behind, after which EVERY later push
  # fails "behind remote" (bit us 2026-07-28). Clear any stale rebase state first — this
  # repo's local commits are always disposable price refreshes.
  if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
    git rebase --abort 2>/dev/null || rm -rf .git/rebase-merge .git/rebase-apply
  fi
  # Separate commands on purpose: one unmatched pathspec makes a combined checkout restore nothing.
  git checkout -- payload.enc 2>/dev/null || true
  git checkout -- private.enc 2>/dev/null || true
  # DEVICE-FREE FEEDS: the cloud (GitHub Actions) owns news/signals, 13F, the column and the book
  # read — and enriches signals with OpenAI embeddings. This machine must NEVER publish those, or it
  # overwrites the enriched feed with a keyless one. Drop any local drift on them; ONLY the
  # encrypted price payload is pushed below.
  git checkout -- signals.json daily_brief.json book_brief.json 2>/dev/null || true
  # charts/ bar files are CLOUD-owned (like signals.json): a local --fetch build may have
  # appended bars — discard so the local cron never races the cloud on 559 files.
  git checkout -- charts 2>/dev/null || true
  git fetch --quiet origin main || true
  # Files changed by commits that exist only here. Anything besides the two blobs is desk work.
  if LOCAL_ONLY=$(git diff --no-renames --name-only origin/main...HEAD 2>/dev/null); then
    LOCAL_ONLY=$(printf '%s\n' "$LOCAL_ONLY" | grep -vE '^(payload|private)\.enc$' || true)
    if [ -z "$LOCAL_ONLY" ]; then
      git reset --quiet --keep origin/main 2>/dev/null || true
    fi
  else
    # 2026-10-02: the comparison itself failed (no history in common with origin/main, or no
    # such ref). An empty list here must not read as "nothing of the desk's" - do not move HEAD.
    LOCAL_ONLY=""
  fi
  # exit 0 = HEAD contains origin/main, 1 = it does not, anything else = git error (fail open)
  git merge-base --is-ancestor origin/main HEAD 2>/dev/null && SYNC_RC=0 || SYNC_RC=$?
  if [ "$SYNC_RC" = "1" ] || [ -n "$LOCAL_ONLY" ]; then
    echo "refresh_site: NOT SYNCED with origin/main (unpushed desk commits or local edits in Website) - not publishing this tick." >&2
    exit 1
  fi
fi

"$PY" encrypt_data.py
echo "refresh_site: payload.enc regenerated."

if [ "$PUSH" = "1" ] && [ -d .git ]; then
  # (The sync with origin/main happened above, before the encrypt — no pull here any more.)
  # PRE-PUBLISH GATE: stamp consistency + the payload must not outrun the (about-to-be-live) feeds
  # beyond the render tolerance, or the Times front page drops to the generic fallback. Abort if so.
  if ! "$PY" verify_publish.py; then
    echo "refresh_site: PRE-PUBLISH GATE FAILED — not pushing. Regenerate today's column or hold." >&2
    exit 1
  fi
  git add payload.enc 2>/dev/null
  git add private.enc 2>/dev/null || true   # owner blob (PRIVACY SPLIT) — same commit as the payload
  git commit -m "price refresh $(cat payload.enc | python3 -c 'import sys,json;print(json.load(sys.stdin)["date"])')" --quiet -- payload.enc private.enc || true
  git push --quiet origin main && echo "refresh_site: pushed to remote."
fi
