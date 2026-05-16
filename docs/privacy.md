# fast-browser — Privacy Policy

_Last updated: 2026-05-16_

## TL;DR

fast-browser is a browser agent that completes tasks in your active tab using
your own LLM API key. **It runs entirely in your browser.** No telemetry, no
analytics, no remote server. Your tasks, page contents, and API keys never
leave your device — except for the LLM calls *you explicitly initiate* to
the provider whose key you configured.

## What fast-browser does

When you start a task in the side panel, fast-browser:

1. Attaches to your **active tab** via `chrome.debugger`. Chrome shows a
   yellow infobar on that tab while it is attached. This is required by
   Chrome and cannot be hidden by the extension.
2. Reads the page's accessibility tree and visible text, plus the URL and
   title.
3. Sends that data — along with your task description and recent action
   history — to the LLM provider you configured (Anthropic / Google
   Gemini / OpenRouter), using your API key.
4. Executes the action the LLM returns (click / type / scroll / navigate)
   on the active tab.
5. Repeats until the task completes or hits the step limit.

## Data handled

| Data | Where it goes | Retained? |
|---|---|---|
| Your API keys | `chrome.storage.local` on this device only | Until you remove or uninstall |
| Your task description | Sent to your chosen LLM provider per their terms | Per provider policy |
| Page accessibility tree, visible text, URL, title of the **active tab** while a task runs | Sent to your chosen LLM provider per their terms | Per provider policy |
| Trajectory of actions taken in a task | `chrome.storage.session` (cleared when the browser session ends or task succeeds) | Until task completes or browser session ends |
| Anything else | — | Nothing |

## What fast-browser does NOT do

- ❌ No telemetry, analytics, or remote server collection.
- ❌ No background data collection — only runs when you explicitly start a task.
- ❌ No reading of tabs other than the one you target.
- ❌ No storing of page contents — page data is sent to your LLM provider
  per-step and discarded when the task ends.
- ❌ No selling or sharing of any data.

## Third-party LLM providers

When you choose a provider and start a task, fast-browser sends per-step
prompts (containing the task description, recent action history, current
page accessibility tree, and visible text) to that provider over HTTPS:

- **Anthropic Claude** — see [anthropic.com/privacy](https://www.anthropic.com/legal/privacy)
- **Google Gemini** — see [policies.google.com/privacy](https://policies.google.com/privacy)
- **OpenRouter** — see [openrouter.ai/privacy](https://openrouter.ai/privacy)

Your API key is sent to the corresponding provider as the `Authorization`
header of those HTTPS calls. fast-browser never sees your usage or
billing on those services.

## Permissions explained

| Permission | Why |
|---|---|
| `debugger` | Required to read the page's accessibility tree and dispatch input events. The single biggest permission; required for the agent to function. Triggers Chrome's yellow infobar on the active tab while a task runs. |
| `scripting` | Required to evaluate the visible-text walker in the page context. |
| `storage` | API keys, model preferences (`chrome.storage.local`); trajectory checkpoint (`chrome.storage.session`). |
| `alarms` | Used to keep the service worker awake during long tasks. |
| `sidePanel` | The task UI lives in the side panel. |
| `tabs`, `activeTab` | To find the active tab to attach to. |
| `<all_urls>` host permission | To attach to whatever site you're on. fast-browser never touches a tab unless you explicitly start a task on it. |

## Contact

Open an issue at the project repository, or email the maintainer at
the address listed in the Web Store listing.

## Changes

Material changes to this policy will be reflected here and in the
extension's release notes.
