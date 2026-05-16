# Changelog

All notable changes to fast-browser. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.0.1] — 2026-05-16

First public release.

### Added

- `core` agent loop with hybrid AxTree + visible-text + viewport-filtered perception, stable `backendNodeId` action addressing, structured trajectory.
- `core` LLM provider abstraction with three implementations: Anthropic (Claude Haiku 4.5 / Sonnet 4.6), Gemini (2.5 Flash-Lite / Flash), OpenRouter (any model). Per-provider grammar-constrained JSON, prompt caching hints, 429 retry.
- `core` robustness primitives: per-origin cookie/consent dismissal, oscillation detection, in-memory selector cache, scroll-to-find, network-idle gating.
- `adapter-cdp-shared`: `CdpDriverBase` + visibility filter + visible-text walker + ready-wait, all transport-agnostic.
- `adapter-cdp-node`: `BrowserDriver` against a launched Chromium via `chrome-remote-interface` (CLI / benchmark transport).
- `adapter-cdp-extension`: `BrowserDriver` against `chrome.debugger` (extension transport).
- `cli`: `fast-browser run` for one-off tasks, `fast-browser bench` for batched task lists.
- `bench`: W3Schools 40-question quiz, real-world (HN / Wikipedia / DDG), WebVoyager subset task definitions + recorded baselines.
- `extension`: MV3 + sidepanel UI + options page + service worker. Per-step trajectory persistence to `chrome.storage.session`. `chrome.alarms` keepalive. Test hook for Playwright e2e (stripped from production builds).
- 85 tests across 4 packages including a Playwright e2e that loads the unpacked extension and exercises real `chrome.debugger.attach`.
- GitHub Actions CI (build + typecheck + tests on push/PR).
- GitHub Pages site at <https://jayantdeveloper.github.io/fast-browser/> hosting the privacy policy.

### Benchmark receipts

- W3Schools 40-question HTML quiz (Anthropic Claude Haiku 4.5): **40 / 40** in 4m44s, **$0.31**.
- Hacker News top story extraction: 1 step, 2.1s, $0.006.
- Random Wikipedia article + first sentence: 1 step, 4.2s, $0.003.
- arXiv paper title: 1 step, 1.3s, $0.003.

### Known issues

- Chrome shows a yellow "fast-browser started debugging this browser" infobar while a task runs. This is a `chrome.debugger`-permission UX requirement, not removable by the extension.
- Some heavy JS-rendered SPAs (npm.com, GitHub repo header) hide text from the visible-text walker. Planned: opt-in `Runtime.evaluate(document.body.innerText)` fallback.
- Selector cache is in-memory only; cross-session persistence is deferred.
- Live Gemini Flash-Lite full-quiz cost validation is blocked by free-tier daily quota; per-step cost ($0.000132) and projection ($0.016 per quiz, ~20× cheaper than Haiku) confirmed from partial runs.
