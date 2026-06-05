# Deploying the Jaleel Capital QARP dashboard (GitHub Pages)

The site is a static, **client-side-encrypted** dashboard. The host only ever
stores `payload.enc` (AES-256 ciphertext). Your plaintext `data.json` and
`.site_password` are git-ignored and **never leave this Mac**.

Do the steps in order. Steps 1–4 are one-time. Step 5 makes it auto-update daily.

---

## 1. Set YOUR password and regenerate the encrypted payload

The `payload.enc` currently on disk was encrypted with a throwaway test password.
Replace it with one only you know. **Choose a strong passphrase** (4–5 random
words, e.g. `copper-violin-anchor-mantle`) — since the ciphertext is public, the
password is the only thing protecting it.

```bash
cd "/Users/jaleel/claude/Jaleel Capital QARP/Website"

# Store the password locally (git-ignored) so the daily cron can re-encrypt:
printf '%s' 'YOUR-STRONG-PASSPHRASE-HERE' > .site_password
chmod 600 .site_password

# Regenerate the encrypted payload with your password:
python3 encrypt_data.py        # prints "Wrote .../payload.enc"
```

Test it: open `index.html` (or the preview) and confirm your new password unlocks it.

---

## 2. Create a free GitHub account + an empty repo

1. Sign up at <https://github.com/signup> (free).
2. Create a new repo: <https://github.com/new>
   - Name it e.g. `qarp` (any name).
   - **Public** (free GitHub Pages needs public — that's fine, the data is encrypted).
   - Do **not** add a README/.gitignore/license (the repo already has files).
3. Copy the repo URL, e.g. `https://github.com/YOURNAME/qarp.git`.

---

## 3. First commit + push

```bash
cd "/Users/jaleel/claude/Jaleel Capital QARP/Website"

git add -A                       # payload.enc included; data.json/.site_password are ignored
git commit -m "QARP dashboard — initial deploy"
git branch -M main
git remote add origin https://github.com/YOURNAME/qarp.git   # <-- your URL
git push -u origin main
```

macOS will prompt for GitHub credentials on first push and cache them in the
Keychain, so future automated pushes won't prompt again. (If asked for a
password, use a **Personal Access Token**, not your account password:
<https://github.com/settings/tokens> → "Generate new token (classic)" → `repo` scope.)

> Sanity check before pushing: `git ls-files | grep -E 'data.json|.site_password'`
> should print **nothing**. If it prints a filename, stop — those must never be pushed.

---

## 4. Turn on GitHub Pages

In the repo on github.com: **Settings → Pages**
- **Source:** "Deploy from a branch"
- **Branch:** `main`, folder `/ (root)` → **Save**

Wait ~1 minute. Your site is live at:

```
https://YOURNAME.github.io/qarp/
```

Bookmark that on your phone. Enter your passphrase to unlock.

---

## 5. (Recommended) Auto-refresh the live site every day

Your cron already regenerates `Website/data.json` daily. To have the site
re-encrypt and redeploy itself, add ONE line to the end of `daily_update.sh`
(right after the tracker is generated):

```bash
# keep the website in sync with the daily data refresh
PUSH=1 "$PROJ/Website/refresh_site.sh" >> "$LOG" 2>&1
```

That calls `refresh_site.sh`, which re-encrypts `data.json` → `payload.enc`
(using `.site_password`) and pushes it. After your first manual push (step 3)
the Keychain has your credentials, so this runs unattended. Now every daily
price refresh flows automatically to your phone.

> I can add this line for you if you'd like — just say so.

---

## Changing your password later
Re-run step 1 with a new passphrase (update `.site_password`, run
`python3 encrypt_data.py`), then `git add payload.enc && git commit -m "rotate" && git push`.

## What's safe to be public (it all is, by design)
`index.html`, `app.js`, `crypto.js`, `styles.css` — generic UI code.
`payload.enc` — AES-256-GCM ciphertext, useless without your passphrase.
Everything sensitive (`data.json`, `.site_password`) is in `.gitignore`.
