# fast-browser — install guide for a non-technical user

What this is: a single-zip install that runs the agent in your Chrome
with the API key already configured. Designed for one specific person
(e.g. "send to mom"); do **not** post the zip publicly — it contains a
working LLM API key.

## Build the zip

```bash
cd packages/extension
SHARE=1 pnpm exec tsx build.ts
zip -qr ~/Desktop/fast-browser.zip dist/ -x '*.map'
```

What `SHARE=1` does that's different from a normal build:

| | `pnpm build` (dev) | `SHARE=1 pnpm exec tsx build.ts` | `PRODUCTION=1 pnpm exec tsx build.ts` |
|---|---|---|---|
| API keys from `.env` baked in | ✓ | ✓ | ✗ (stripped, build aborts if any leak) |
| Test/debug hook (`__fb_test`) | ✓ | ✗ (stripped) | ✗ (stripped) |
| Minified | ✗ | ✓ | ✓ |
| Sourcemaps | ✓ | ✗ | ✗ |
| Safe to publish? | no (key) | **no** (key) | yes |

Send the SHARE zip to **one** trusted person only. Send via AirDrop,
direct DM, or attachment — not GitHub, not a public link.

## What she does (3 steps)

1. Unzip `fast-browser.zip` somewhere stable (e.g. `~/Documents/fast-browser/`).
   She'll get a folder called `dist/`. Don't delete that folder; Chrome
   reads from it.
2. Open `chrome://extensions` in Chrome → toggle **Developer mode** on
   (top-right) → click **Load unpacked** → pick the `dist/` folder.
3. Click the puzzle-piece icon in Chrome's toolbar, pin **fast-browser**.

## How she uses it (3 clicks per task)

1. Navigate to the page she wants the agent to work on (e.g. the ARRS
   CME summary page she's already logged into).
2. Click the fast-browser toolbar icon → the side panel opens. The
   default preset (e.g. "ARRS — claim all CME credits") is already
   selected and the task is already filled in.
3. Click **Run on active tab**. Watch the trajectory; come back when
   the result section shows the summary.

A yellow "fast-browser started debugging this browser" infobar appears
in Chrome while a task runs. That's required by Chrome's debugger
permission; she can ignore it. It disappears when the task ends.

## Quirks she should know about

- **Developer mode warning.** Chrome shows "Disable developer mode
  extensions" each launch because the extension is loaded unpacked
  (not from the Web Store). She can dismiss the bubble; the extension
  keeps working. The only way to make this go away is publishing to
  the Chrome Web Store.
- **Don't delete the unzipped folder.** Chrome doesn't copy the files;
  it reads them from wherever they live. If she moves or deletes
  `dist/`, the extension breaks until she re-adds it.
- **Don't share the zip.** The API key inside bills to whoever owns
  it (probably you). If she forwards it to friends, they're spending
  your money.

## Pushing an update later

When you (or the code) changes, rebuild and re-zip:

```bash
cd packages/extension
SHARE=1 pnpm exec tsx build.ts
zip -qr ~/Desktop/fast-browser.zip dist/ -x '*.map'
```

Send the new zip. She:

1. Unzips, replacing the old `dist/` folder.
2. Opens `chrome://extensions` and clicks the circular reload icon on
   the fast-browser card.
3. Closes + reopens the side panel.

Her settings, preset selections, and chrome.storage data survive
the reload.
