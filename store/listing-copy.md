# fast-browser — Chrome Web Store Listing Copy

All copy ready to paste into the [Web Store dashboard](https://chrome.google.com/webstore/devconsole/).

---

## Name (45 char max)

```
fast-browser — local AI browser agent
```
*(36 chars)*

## Short description (132 char max)

```
A local AI agent that completes web tasks in your active tab. Bring your own Anthropic / Gemini / OpenRouter API key — no server.
```
*(127 chars)*

## Category

**Productivity**

## Language

English

## Detailed description

```
fast-browser is a Chrome side-panel extension that completes web tasks in
your active tab using a fast, low-latency AI loop. You bring your own LLM
API key (Anthropic, Google Gemini, or OpenRouter); fast-browser never
sends your data to a server it controls.

⚡ FAST
- Median ~700-900ms per agent step (Claude Haiku 4.5 / Gemini Flash-Lite)
- Hybrid perception — accessibility tree + structural visible-text walk +
  viewport visibility filter — keeps prompts small and cheap
- Per-step state fingerprint with built-in loop detection so the agent
  never gets stuck repeating itself silently

🔒 LOCAL
- No telemetry. No analytics. No remote server.
- API keys live in chrome.storage.local on your device
- Page data is sent to your chosen LLM provider per-step and discarded
- Open-source

🧠 ROBUST
- Per-origin cookie/consent dismissal (zero LLM cost)
- Loop detection with stuck-state recovery prompt
- Structured action vocabulary (click, type, scroll, goto, wait_for, done)
  with stable backendNodeId addressing — never silently picks the wrong
  element after a DOM shift
- Trajectory checkpointed across service-worker evictions

🌐 PROVIDER FLEXIBLE
- Anthropic Claude (Haiku 4.5 default for the best speed / quality / cost
  tradeoff today)
- Google Gemini (2.5 Flash-Lite is ~20x cheaper for the same task)
- OpenRouter (free-tier and paid models, including DeepSeek, Qwen, Llama)
- Switch any time in Settings

📊 BENCHMARK
- W3Schools 40-question HTML quiz: 100% (40/40) in 4m44s with Claude
  Haiku 4.5, $0.31 per run
- Hacker News top story / random Wikipedia article: 1 step each, sub-cent

WHEN TO USE IT
- "Find the cheapest flight from X to Y on $airline.com"
- "Take this quiz and tell me my score"
- "Read this article and summarize the conclusion"
- "Fill out this contact form with these details"
- Any task that involves reading and acting on the page in front of you

HOW IT WORKS
1. Click the toolbar icon to open the side panel
2. Open Settings, paste your API key, save
3. Navigate to the page you want acted on
4. Type the task in the side panel, click Run
5. Watch the agent work step by step in the trajectory view

CHROME WILL SHOW A YELLOW BAR
While a task runs, Chrome shows "fast-browser started debugging this
browser" on the active tab. This is required for the agent to read the
accessibility tree and dispatch input events. The bar disappears the
moment the task finishes.

OPEN-SOURCE
github.com/jaymaheshwari/fast-browser
```

## Promotional images

Need 4 sizes:
- **Small tile**: 440×280 PNG
- **Marquee**: 1400×560 PNG (optional, for editorial features)
- **Screenshot 1**: 1280×800 — side panel idle with a task typed in
- **Screenshot 2**: 1280×800 — side panel mid-run with trajectory cards
- **Screenshot 3**: 1280×800 — side panel done state with score readback
- **Screenshot 4**: 1280×800 — options page with provider selector

## Single purpose statement (required)

```
A side-panel agent that completes web tasks in the user's active tab
using a user-supplied LLM API key.
```

## Permission justifications (required when submitting)

- **`debugger`**: Required to read the accessibility tree of the active
  tab and dispatch input events to it. Without this permission the agent
  cannot perceive or act on the page.
- **`scripting`**: Required to evaluate a visible-text walker inside the
  active tab's page context.
- **`storage`**: API keys and preferences via chrome.storage.local; per-task
  trajectory via chrome.storage.session.
- **`alarms`**: Keeps the service worker alive during agent tasks longer
  than 30 seconds, per Chrome's MV3 SW lifecycle.
- **`sidePanel`**: The agent UI lives in the side panel.
- **`tabs`, `activeTab`**: To resolve the user-targeted active tab and
  attach the debugger to it.
- **`host_permissions: <all_urls>`**: The user picks which page to act on.
  fast-browser never reads or modifies any tab unless the user explicitly
  starts a task there.

## Privacy policy URL

Once hosted, paste here:

```
https://<your-host>/fast-browser/privacy.html
```

The source markdown is at `store/privacy-policy.md`.
