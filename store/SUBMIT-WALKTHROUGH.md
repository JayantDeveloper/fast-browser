# Chrome Web Store — Unlisted submission walkthrough

Everything in `store/` is ready to upload. Below is the exact click-by-click
flow at <https://chrome.google.com/webstore/devconsole/>.

## Files you'll attach

| Asset | Path | Purpose |
|---|---|---|
| Extension zip | `store/fast-browser-0.0.1.zip` (36 KB) | The thing being published |
| Small promo tile (440×280) | `store/promo-small-440x280.png` | Required |
| Marquee promo tile (1400×560) | `store/promo-marquee-1400x560.png` | Optional but improves listing |
| Screenshot 1 | `store/sidepanel-idle.png` (1280×800) | Required (need ≥1) |
| Screenshot 2 | `store/sidepanel-running.png` | Strongly recommended |
| Screenshot 3 | `store/sidepanel-done.png` | Strongly recommended |
| Screenshot 4 | `store/options.png` | Strongly recommended |
| Listing copy | `store/listing-copy.md` | Source of truth for every text field |
| Privacy policy URL | <https://jayantdeveloper.github.io/fast-browser/privacy.html> | Hosted on GitHub Pages |

## One-time, before the first submission

1. Go to <https://chrome.google.com/webstore/devconsole/>.
2. Sign in with the Google account that should own the listing (probably
   your JayantDeveloper-tied account).
3. Accept the developer agreement and pay the **$5 one-time fee** via
   Google Pay. Required for any submission.
4. (Optional but recommended) In **Account → Verified contact info**,
   add an email address Google can reach you on. Reviewers email here
   if they have questions.

## Creating the listing

In the dev console:

1. Click **Items** in the left nav → **Add new item**.
2. Upload `store/fast-browser-0.0.1.zip`.
3. After it processes (~10 seconds), you land on the **Store listing** tab.

## Filling the Store listing tab

Copy from `store/listing-copy.md`. Specifically:

- **Item name** (45 char max):
  ```
  fast-browser — local AI browser agent
  ```

- **Short description** (132 char max):
  ```
  A local AI agent that completes web tasks in your active tab. Bring your own Anthropic / Gemini / OpenRouter API key — no server.
  ```

- **Detailed description**: copy the entire fenced block under
  `## Detailed description` in `listing-copy.md`.

- **Category**: **Productivity**.

- **Language**: **English**.

- **Icon**: already in the zip's manifest (`icons/icon-128.png`).
  Dev console auto-detects.

- **Screenshots** (drag-drop, in order):
  1. `store/sidepanel-idle.png`
  2. `store/sidepanel-running.png`
  3. `store/sidepanel-done.png`
  4. `store/options.png`

- **Small promo tile**: `store/promo-small-440x280.png`.

- **Marquee promo tile**: `store/promo-marquee-1400x560.png`.

## Privacy practices tab

- **Single purpose**:
  ```
  A side-panel agent that completes web tasks in the user's active tab using a user-supplied LLM API key.
  ```

- **Permission justifications** (each gets its own text box):

  - **`debugger`**:
    ```
    Required to read the Accessibility Tree of the user's active tab via the Chrome DevTools Protocol (Accessibility.getFullAXTree) and to dispatch input events (Input.dispatchMouseEvent, Input.insertText) on that tab. The user explicitly starts each task from the side panel; the extension only attaches the debugger to the tab they target and detaches when the task ends. Chrome's required yellow infobar makes the attachment visible to the user at all times.
    ```

  - **`scripting`**:
    ```
    Used to evaluate a small, hard-coded JavaScript function in the active tab's page context (via Runtime.evaluate) that returns a list of visible text blocks (headings, paragraphs, list items, table cells) for the agent's perception layer. No code is fetched from the network.
    ```

  - **`storage`**:
    ```
    chrome.storage.local stores the user's API keys, model preference, and saved task presets on their device. chrome.storage.session stores the per-task trajectory checkpoint so a long-running task can resume after a service-worker eviction. No data is sent to any server controlled by the extension.
    ```

  - **`alarms`**:
    ```
    Used to register a 24-second alarm during an active task so Chrome doesn't terminate the MV3 service worker mid-task (per the documented MV3 service-worker lifecycle: 30-second idle eviction). Alarm is cleared when the task ends.
    ```

  - **`sidePanel`**:
    ```
    The entire user interface lives in the side panel — task input, live trajectory of the agent's actions, and the final result. The chrome.action onClicked handler opens the side panel on user gesture.
    ```

  - **`tabs`**:
    ```
    chrome.tabs.query is used to resolve which tab the user wants the agent to act on (the active tab in the focused window).
    ```

  - **`activeTab`**:
    ```
    Granted at the moment the user clicks the toolbar action; required by the chrome.sidePanel API.
    ```

  - **`offscreen`**:
    ```
    Reserved for service-worker keep-alive helpers; not used in this version.
    ```

  - **`host_permissions: <all_urls>`**:
    ```
    The user chooses which page to act on. The extension never reads or modifies any tab unless the user explicitly starts a task there from the side panel. We cannot enumerate eligible URLs in advance because the user might want to automate any web page they visit.
    ```

- **Data usage disclosures**:
  - Check **"I am not collecting any of the following user data"** — true (no telemetry, no analytics, no remote server).
  - **Personally identifiable info**: none.
  - **Financial info**: none.
  - **Authentication info**: API keys are user-supplied and stored locally only.
  - **Personal communications**: none.
  - **Location**: none.
  - **Web history**: page contents are sent only to the user's chosen LLM provider, per-task, when the user starts a task. Not retained by the extension. Not shared with any other third party.
  - **User activity**: same as above.
  - **Website content**: same as above.

- **Certifications** (check all):
  - [x] I do not sell or transfer user data to third parties outside of the approved use cases.
  - [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
  - [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

- **Privacy policy URL**:
  ```
  https://jayantdeveloper.github.io/fast-browser/privacy.html
  ```

## Distribution tab

- **Visibility**: **Unlisted**.
  - This means the listing isn't returned by search or by browsing the
    store, but anyone with the direct URL can install. Exactly what you
    want for "DM mom a link."
- **Regions**: **All regions**.

## Submitting

1. Click **Submit for review** in the top-right.
2. Confirm in the modal.
3. Wait. Initial review for an extension using `debugger` typically takes
   **2–3 business days**. You'll get an email when it's published or if
   the reviewer has questions.

## After it's published

1. Copy the listing URL from the dev console (it'll be
   `https://chromewebstore.google.com/detail/fast-browser-local-ai-bro/<some-id>`).
2. DM that URL to mom.
3. She clicks it → **Add to Chrome** → **Add extension** confirmation.
4. She still needs to paste her own API key in the Options page once
   (the public zip can't carry a key). Two clicks: toolbar icon → Settings
   → paste → Save. Then she's done forever.

## Updating later

When you ship a new version:

1. Bump the `version` field in both `packages/extension/manifest.json`
   and `packages/extension/package.json` (e.g. `0.0.1` → `0.0.2`).
2. Rebuild:
   ```bash
   cd packages/extension
   PRODUCTION=1 pnpm exec tsx build.ts
   cd ../..
   rm -f store/fast-browser-*.zip
   cd packages/extension
   zip -qr ../../store/fast-browser-$(node -p "require('./package.json').version").zip dist/ -x '*.map'
   ```
3. In the dev console → Items → fast-browser → **Package** tab → **Upload
   new package** → pick the new zip.
4. Click **Submit for review**. Updates that don't change permissions
   are usually reviewed within hours.

Mom's extension auto-updates within a few hours of publish — she doesn't
need to do anything.

## If the reviewer rejects you

Most common rejection reasons for `debugger`-using extensions:

| Reason | Fix |
|---|---|
| "Permissions too broad — please justify each permission's necessity." | Re-read the permission justifications above; the reviewer wants explicit wording about *why each permission is necessary, not just what it does*. Add "this is the minimal permission required because…" framing. |
| "Single purpose unclear." | Re-state the single purpose as one sentence describing user benefit, not implementation. |
| "Privacy policy is unreachable." | Confirm the GitHub Pages URL still returns 200. We tested it; it should be fine. |
| "Extension does not function as described." | Reviewer probably didn't add an API key. The Options-page UI shows three provider fields; consider adding a one-liner to the description that says "Configure your API key in Settings before running your first task." |

If anything else comes back, paste the reviewer's email to me and I'll
draft a response.
