# fast-browser

> A local AI agent that completes tasks in your active Chrome tab. Bring your own Anthropic / Gemini / OpenRouter API key — no server.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-85%20passing-brightgreen.svg)](#testing)

## Why

`browser-use` and friends are great but slow and pricey on real interactive
sites. fast-browser was rebuilt from the ground up around three priorities:

1. **Speed.** Median agent step is ~700–900ms with Haiku 4.5 (vs ~10s in
   the predecessor). Hybrid AxTree + visible-text + viewport-filter
   perception keeps prompts tight; cache-friendly prompt order amortises
   the system-prompt cost.
2. **Robustness.** First-class loop primitives the model doesn't have to
   "remember": per-origin cookie/consent dismissal, oscillation detection
   with stuck-state recovery, stable `backendNodeId` addressing (no more
   silently picking the wrong element after a DOM shift), network-idle
   gating for "done" detection.
3. **Local + extensible.** Same core code runs in the CLI (Node + Chrome
   over CDP) and in a Chrome extension (MV3 + `chrome.debugger`). Adding
   a third transport (Firefox over WebDriver-BiDi, say) is a single new
   adapter that subclasses `CdpDriverBase`.

## Receipts

| Benchmark | Result |
|---|---|
| **W3Schools 40-question HTML quiz** (Haiku 4.5) | 40 / 40, 4m44s, $0.31 |
| Same quiz on the predecessor (browser-use-style baseline) | 0 / 20, 14m32s |
| Hacker News top story extraction (Haiku 4.5) | 1 step, 2.1s, $0.006 |
| Random Wikipedia article + first sentence (Haiku 4.5) | 1 step, 4.2s, $0.003 |
| Median agent step latency (Haiku 4.5) | ~785ms |
| Median agent step latency (Gemini Flash-Lite) | ~700ms, ~$0.000132/call |

Per-step cost projection: full 40-question quiz on Flash-Lite ≈ $0.016
(~20× cheaper than Haiku) — model quality permitting.

## What's in the repo

```
packages/
├── core/                       # Pure agent: perception, actions, loop, robustness, LLM clients
├── adapter-cdp-shared/         # CdpDriverBase + visibility filter + visible-text walker + ready-wait
├── adapter-cdp-node/           # CdpDriverBase impl over chrome-remote-interface (CLI)
├── adapter-cdp-extension/      # CdpDriverBase impl over chrome.debugger (extension)
├── cli/                        # `fast-browser run` and `fast-browser bench`
├── bench/                      # Benchmark task definitions + recorded baselines
└── extension/                  # MV3 Chrome extension (vanilla TS + esbuild)
```

`core/` deliberately depends on no transport — a contract test
verifies it never imports `playwright`, `chrome-remote-interface`, or
`chrome.*`. Both adapters subclass the shared `CdpDriverBase`, so the
agent loop is written once and runs unchanged in CLI and extension.

## Try it (CLI)

```bash
pnpm install
pnpm -r build

# Pick your provider:
export ANTHROPIC_API_KEY=sk-ant-...     # default; best quality
export GEMINI_API_KEY=...               # cheapest at scale
export OPENROUTER_API_KEY=sk-or-...     # free-tier dev fallback

# One-off task on a real page:
node packages/cli/dist/main.js run \
  "Find the top story on Hacker News and tell me its title and points." \
  --url https://news.ycombinator.com \
  --model anthropic:claude-haiku-4-5

# Or run the included benchmarks:
node packages/cli/dist/main.js bench \
  --tasks packages/bench/tasks/w3schools-quiz.json \
  --model anthropic:claude-haiku-4-5
```

## Try it (Chrome extension)

```bash
pnpm --filter @fast-browser/extension build
```

1. `chrome://extensions` → toggle **Developer mode** → **Load unpacked**.
2. Select `packages/extension/dist/`.
3. Click the toolbar icon → side panel opens → **Settings** → paste your
   API key → save.
4. Navigate to the page you want acted on.
5. Type a task in the side panel → **Run on active tab**.

Chrome will show a yellow "fast-browser started debugging this browser"
infobar while a task runs — required for `chrome.debugger`, can't be
hidden.

## Architecture in two diagrams

**Boundary:**

```
┌─────────────────────────────────────────────────────────────┐
│  core (pure: no I/O, no chrome.*, no playwright)            │
│  ─────────────────────────────────────────────────────────  │
│   loop/agent.ts  perception/  actions/  robustness/  llm/   │
└──────────────────────────┬──────────────────────────────────┘
                           │ BrowserDriver interface
                ┌──────────┴──────────┐
                │                     │
   ┌────────────▼────────────┐  ┌─────▼──────────────────┐
   │  adapter-cdp-node       │  │  adapter-cdp-extension │
   │  (CDP via WebSocket)    │  │  (chrome.debugger)     │
   └────────────┬────────────┘  └─────┬──────────────────┘
                │                     │
        ┌───────▼────┐          ┌─────▼────────┐
        │  CLI       │          │  MV3         │
        │  bench/    │          │  side panel  │
        └────────────┘          └──────────────┘
```

**Per-step loop:**

```
1. snapshot()      ─┐
   ─ ax tree       │ parallel (CDP)
   ─ visible text ─┘
2. consent.maybeDismiss()        ← per-origin one-shot, zero LLM cost
3. actor.askJson(prompt, schema) ← grammar-constrained
4. execute(frame, action, driver)
5. waitForReady() (network-idle)
6. loopDetect.observe()          ← escalation if stuck
7. record TrajectoryStep         ← also persisted to chrome.storage.session
```

## Documented gaps (PRs welcome)

- **Flash-Lite full-run cost validation** — per-step cost confirmed,
  full-quiz live-run blocked by free-tier daily quota; needs a paid key.
- **SPA text extraction** — visible-text walker covers headings /
  paragraphs / lists / labels / cells / spans / pre / code. Some heavy
  JS-rendered SPAs (npm.com, GitHub repo header) still hide text from
  the walker; planned: opt-in `Runtime.evaluate(document.body.innerText)`
  fallback when the AxTree has nothing relevant.
- **Selector cache persistence** — cache lives in-memory only; deferred
  cross-session persistence in chrome.storage.local.
- **Two-tier planner handoff** — loop has a stuck-notice fallback (works
  on the W3Schools benchmark); full planner-on-stuck escalation is
  scaffolded but not wired (`U8` in the plan).

## Testing

```bash
pnpm -r test          # 85 tests across 4 packages
pnpm -r typecheck
```

Includes a Playwright e2e that loads the unpacked extension into a real
Chromium and verifies `chrome.debugger.attach` against a fixture page.

## Bigger plan

The full design plan that this repo executes lives at
[`docs/plans/2026-05-15-001-feat-fast-browser-agent-plan.md`](docs/plans/2026-05-15-001-feat-fast-browser-agent-plan.md).

## License

MIT — see [LICENSE](LICENSE).
