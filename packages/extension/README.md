# @fast-browser/extension

MV3 Chrome extension that drives the user's active tab via `chrome.debugger`,
using the same `core` agent loop the CLI uses.

## Build

```bash
pnpm --filter @fast-browser/extension build
```

Outputs an unpacked extension at `packages/extension/dist/`.

## Load it

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked**, select `packages/extension/dist/`.
4. Click the puzzle-piece icon in the toolbar, pin **fast-browser**.
5. Open the side panel via the toolbar icon.
6. Click **Settings**, paste your provider API key (Anthropic / Gemini /
   OpenRouter), pick a model, save.
7. Navigate to the page you want the agent to act on.
8. Type a task in the side panel, click **Run on active tab**.

Chrome will show a yellow infobar — "fast-browser started debugging this
browser" — while a task runs. This is required for `chrome.debugger`
access and cannot be hidden by the extension.

## Architecture

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest. Requests `debugger`, `scripting`, `storage`, `alarms`, `sidePanel`, `tabs`, `activeTab`. |
| `src/background.ts` | Service worker. Owns the agent loop, wires `ChromeDebuggerDriver` to the active tab, posts `TrajectoryStep` events to the side panel. |
| `src/sidepanel/` | Task input, live trajectory, final result. Long-lived `runtime.connect` port to the SW. |
| `src/options/` | Provider keys, default model, max steps. Persists via `chrome.storage.local`. |
| `src/provider-factory.ts` | Builds the correct LLM `Provider` from saved settings. |
| `src/settings-storage.ts` | `chrome.storage.local` wrapper for `AgentSettings`. |
| `src/messages.ts` | Typed protocol shared between SW and panel. |

The actual perception / action / loop / robustness code lives in
`@fast-browser/core` and `@fast-browser/adapter-cdp-extension`. This
package is a thin host.
