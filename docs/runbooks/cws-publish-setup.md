# One-time setup: programmatic publishing to the Chrome Web Store

You only do this once. After it's set up, every future release is one
command: `pnpm publish:cws`.

This setup is **optional** — you can always upload zips manually via the
dev console. The script is just for when you want to ship a v0.0.2 from
the terminal without clicking through the web UI.

## Prereqs

- You've already created the CWS dev account (one-time $5 paid)
- You've published the first version of the extension manually (the
  listing metadata — name, screenshots, etc. — must already exist; the
  API can't set those)

## 1. Create a Google Cloud project (or reuse one)

1. Visit <https://console.cloud.google.com/>
2. Top-left project picker → **New Project**
3. Name it `fast-browser-cws` (or anything; it's just for OAuth scoping)
4. Skip the org if asked
5. Once created, select it

## 2. Enable the Chrome Web Store API

1. In the project, go to <https://console.cloud.google.com/apis/library/chromewebstore.googleapis.com>
2. Click **Enable**

## 3. Create OAuth consent screen

1. <https://console.cloud.google.com/apis/credentials/consent>
2. Choose **External** user type (it's "external" even though only you'll use it)
3. Fill in:
   - **App name**: `fast-browser publishing`
   - **User support email**: your email
   - **Developer contact info**: your email
4. Save and continue past the Scopes screen (no need to add any)
5. Test users → **Add users** → add your own email
6. Save

## 4. Create OAuth credentials

1. <https://console.cloud.google.com/apis/credentials>
2. **Create credentials** → **OAuth client ID**
3. Application type: **Desktop app**
4. Name: `fast-browser publisher cli`
5. Click **Create**
6. A modal shows your **Client ID** and **Client secret** — copy both,
   you'll need them in step 6

## 5. Get the extension ID from the dev console

After your first successful manual submission:

1. <https://chrome.google.com/webstore/devconsole/> → Items → click your item
2. The URL contains the extension's appId — it's the 32-character string
   after `/edit/` (looks like `abcdefghijklmnopqrstuvwxyz123456`)
3. Copy it

## 6. Generate a refresh token

A refresh token is the long-lived credential that lets the script auth
without a browser. It's a one-time generation.

Easiest path — use Google's OAuth Playground:

1. <https://developers.google.com/oauthplayground/>
2. Click the gear icon (top-right) → check **Use your own OAuth credentials**
3. Paste your **Client ID** and **Client secret** from step 4
4. Close settings
5. In the left panel, scroll to the bottom and type in the custom scope:
   ```
   https://www.googleapis.com/auth/chromewebstore
   ```
6. Click **Authorize APIs**
7. Sign in with the same Google account that owns the CWS listing
8. Allow access (you'll see a Google warning that the app is unverified —
   click Advanced → Continue; it's your own OAuth client)
9. You're redirected back. Click **Exchange authorization code for tokens**
10. Copy the **Refresh token** value

## 7. Add to .env

Append to `/Users/jaymaheshwari/Projects/Personal/fast-browser/.env`:

```bash
CWS_CLIENT_ID=...your client ID from step 4...
CWS_CLIENT_SECRET=...your client secret from step 4...
CWS_REFRESH_TOKEN=...refresh token from step 6...
CWS_EXTENSION_ID=...32-char ID from step 5...
```

`.env` is gitignored — these never leave your machine.

## 8. Verify

```bash
pnpm publish:cws --dry-run
```

You should see `▸ Authenticated.` followed by `▸ Dry run — exiting before upload.`

If you see an auth error, the most common cause is that the refresh
token expired (Google revokes them after 6 months of inactivity for
unverified apps). Repeat step 6.

## How to release v0.0.2 (and beyond)

```bash
# 1. Bump version in BOTH files (must match)
#    - packages/extension/manifest.json     "version": "0.0.2"
#    - packages/extension/package.json      "version": "0.0.2"

# 2. Commit + tag (optional but good hygiene)
git add packages/extension/{manifest.json,package.json}
git commit -m "release: v0.0.2"
git tag v0.0.2
git push --tags

# 3. Ship to CWS
pnpm publish:cws
```

That's it. The script builds PRODUCTION=1, zips, uploads, and triggers
publish. New version is live within hours (longer for major changes that
trigger re-review).

## Variants

```bash
# Upload but don't publish yet (review in dev console first)
pnpm publish:cws --upload-only

# Just verify auth, don't touch anything
pnpm publish:cws --dry-run
```

## When the script fails

| Error | Likely cause | Fix |
|---|---|---|
| `Missing CWS_*` | env var not loaded | Verify `.env` has all four keys and re-source |
| `Token exchange failed (401)` | refresh token expired / revoked | Redo step 6 |
| `Upload failed (403)` | OAuth client doesn't have the right scope, OR the Google account doesn't own that extension ID | Verify in OAuth playground; ensure you signed in with the dev-account Google in step 6 |
| `Upload uploadState=FAILURE` with `MANIFEST_VERSION_NOT_INCREMENTED` | you forgot to bump the version | Bump `version` in both `manifest.json` and `package.json` |
| `Publish failed (400)` with `ITEM_NOT_UPDATABLE` | a prior upload is still pending review | Wait for the previous submission to finish reviewing |
