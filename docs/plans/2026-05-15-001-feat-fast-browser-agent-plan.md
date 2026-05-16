---
title: "feat: fast-browser — high-throughput local browser agent with extension-ready core"
type: feat
status: active
date: 2026-05-15
---

# feat: fast-browser — high-throughput local browser agent with extension-ready core

**Target repo:** `fast-browser` (new, sibling to `local-browser`). All paths in this plan are repo-relative to that new project root.

## Summary

Build a TypeScript browser agent on raw CDP with hybrid AxTree + visible-text perception, a two-tier actor/planner model loop, and first-class robustness primitives (cookie dismiss, loop detection, selector cache, scroll-to-find, network-idle gating). Ship the same core behind two `BrowserDriver` adapters — `cdp-node` for the CLI/benchmark harness, `chrome.debugger` for an MV3 Chrome extension — so the loop, perception, prompt shape, and history management are written once and reused.

---

## Problem Frame

`local-browser/` works as a proof-of-concept but fails the bar: ~10s per step on real pages, 0/20 task completion on the W3Schools HTML quiz at 80 steps / 14:32 wall-time, looped on a cookie banner and a post-submit redirect. The two root causes from the code audit and external research are: (1) AxTree-only perception silently drops question-stem text and unmarked answer choices on quizzes, articles, and forms (`local-browser/perception.py:15-28, 41-72`); (2) `_click`/`_type` re-run `get_actionables` against a *fresh* DOM and re-address by index, so any reflow between perception and execution silently picks the wrong element (`local-browser/actions.py:54, 80`). Layered on those: no recovery for stuck loops, no cookie/consent dismissal, fixed `wait_for_timeout(500)` instead of event-driven readiness, history flattened to 5 truncated strings.

A second pressure: today's project is Python+Playwright. The eventual product is a Chrome extension, which must be TypeScript and uses `chrome.debugger` instead of Playwright. A patch-on-patch path locks in the wrong substrate; a clean rewrite with an adapter boundary lets the extension reuse the core verbatim.

---

## Requirements

- R1. **Beat browser-use baseline on speed** — ≤ 2s median per step (50th percentile) on WebVoyager-subset pages, with the actor model alone. Today's loop is ~10s/step.
- R2. **Beat browser-use baseline on completion** — ≥ 80% pass rate on the W3Schools HTML quiz (20 questions, end-to-end submission with score readback) and ≥ 60% on a 25-task WebVoyager subset. Today: 0% on the quiz.
- R3. **Hybrid perception** — every turn the model sees both interactive elements (AxTree-derived, addressable) AND the readable text of the focused region (so quizzes, articles, instructions are not invisible).
- R4. **Stable element addressing** — actions reference `backendNodeId` snapshotted at perception time. Index-by-position is forbidden in the action layer.
- R5. **Robustness primitives are loop-level, not model-level** — cookie/consent auto-dismiss runs once per new origin; oscillation detection forces escalation after 2 repeats; scroll-into-view runs before every click; "done" detection waits on `Page.frameStoppedLoading` + URL stability, not a fixed timer.
- R6. **Two-tier model strategy** — a small grammar-constrained "actor" runs every step (Gemini 2.5 Flash-Lite, Groq Llama 3.3 70B paid, or Claude Haiku 4.5); a stronger "planner" runs only on stuck-state escalation (Claude Sonnet 4.6 or GPT-5). Provider is pluggable; prompt caching is on by default for providers that support it.
- R7. **Adapter-shaped core** — `core/` has zero references to `chrome.debugger`, `playwright`, or `chrome-remote-interface`. All browser I/O goes through a `BrowserDriver` interface implemented by `adapters/cdp-node` (Phase 1) and `adapters/cdp-extension` (Phase 2). Adding a third driver (e.g., Firefox via `webdriver-bidi`) must touch zero core files.
- R8. **Chrome extension ship-ready in Phase 2** — MV3, sidepanel UI, BYO API key, streams actions to the panel, survives service-worker eviction during tasks ≥ 5 minutes, installable as an unpacked extension and submittable to the Chrome Web Store. Reference architecture: Nanobrowser.
- R9. **Benchmark harness produces machine-readable results** — every run emits a JSON record `{task, success, steps, wall_ms, cost_usd, model, errors[]}` so we can track regressions.
- R10. **No silent failures** — every action emits a structured `ActionResult` (success | failed-with-reason); the loop owns recovery, not the model.

---

## Scope Boundaries

- Multi-tab / multi-account orchestration (defer)
- Anti-bot evasion, fingerprint spoofing, CAPTCHA solving (defer; route to Steel.dev / hCaptcha if needed later)
- Hosted SaaS, billing, auth (out of scope — BYO key only)
- Cross-browser (Firefox, Safari) — Chromium only
- Self-training, RL, or fine-tuning on browsing trajectories (out of scope)
- A new benchmark suite — we lean on W3Schools quiz + a 25-task WebVoyager subset
- Touching `~/Projects/Personal/PRBrief/` or any other PassivePilot fleet project

### Deferred to Follow-Up Work

- Selector cache persistence across sessions (Phase 1 keeps it in-memory only; cross-session is a future iteration).
- Vision-mode escalation tier (the planner can request a screenshot when stuck, but a dedicated set-of-mark vision agent is deferred — Skyvern's vision-only path is expensive).
- Web Store submission (listing copy, screenshots, privacy policy) — gated on Phase 2 acceptance.
- A "record-and-replay" UX where users teach flows by demonstration.

---

## Context & Research

### Relevant Code and Patterns

- `local-browser/local_agent.py` — current loop shape (single async loop, JSON-action contract, `ActionError`-as-feedback). The contract survives; the I/O substrate does not.
- `local-browser/perception.py:15-28` — hardcoded role list. The new perception layer extends this idea with a structural text walk.
- `local-browser/actions.py:54, 80` — index re-resolution. **Replaced** with `backendNodeId` addressing.
- `local-browser/llm_client.py:23-38` — `_parse_json` defensive coercion. **Reused** in TS form (`safeParseJson`).
- `local-browser/llm_client.py:43-51` — hardcoded free-tier rotation. **Replaced** with provider config.
- `PRBrief/` — only relevant as a reference for the WXT + sidepanel + BYO-key UX shape; not a code dependency.

### Institutional Learnings

- None directly applicable — this is a new project. The lesson from this codebase's prior PoC is captured in Problem Frame: index re-resolution and AxTree-only perception are the two failure modes that drove the rewrite.

### External References

- [browser-use 1.0 — Speed Matters](https://browser-use.com/posts/speed-matters) — DOM-first perception, KV-cache-friendly prompt order (history before live state), output tokens cost ~215× input tokens, 10-15-token action vocabulary.
- [browser-use — Playwright→CDP migration](https://browser-use.com/posts/playwright-to-cdp) — eliminating the Node.js Playwright bridge cuts thousands of CDP RTTs.
- [Stagehand v3 Caching](https://www.browserbase.com/blog/stagehand-caching) — SHA256(URL+DOM hash+method+schema) selector cache, ~80% second-run speedup, 48hr TTL.
- [Skyvern 2.0 — Planner-Actor-Validator](https://www.skyvern.com/blog/skyvern-2-0-state-of-the-art-web-navigation-with-85-8-on-webvoyager-eval/) — 45% → 68.7% (planner) → 85.85% (validator) on WebVoyager. Validates the multi-tier idea even though we keep vision optional.
- [Agent-E (WebVoyager 73.2%)](https://arxiv.org/abs/2407.13032) — planner/navigator separation worth ~16 pts.
- [SpecCache (arXiv 2510.16276)](https://arxiv.org/html/2510.16276v1) — web-environment latency = up to 53.7% of total task time; speculative DOM pre-fetch cuts environment overhead 3.2×. Inspires the "speculative perception during LLM inference" optimization (deferred to U7 if budget allows).
- [Don't Break the Cache (arXiv 2601.06007)](https://arxiv.org/html/2601.06007v2) — Anthropic prompt cache: 78.5% cost reduction; cache threshold ≥ 1024 tokens.
- [BenchLM May 2026](https://benchlm.ai/llm-speed) — Gemini 2.5 Flash-Lite ~990ms wall (5k in / 100 out); Haiku 4.5 ~1.3s; Sonnet 4.6 ~3.7s.
- [Nanobrowser (github.com/nanobrowser/nanobrowser)](https://github.com/nanobrowser/nanobrowser) — reference MV3 architecture: SW orchestrator + sidepanel + Puppeteer/CDP. ~12k★, Web Store live. Closest analog to what we are shipping.
- [WXT framework (wxt.dev)](https://wxt.dev/) — 2026 consensus build tool for MV3 + TS + sidepanel.
- [chrome.debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger) — same CDP we use in cdp-node, attached via `chrome.debugger.attach(tabId, "1.3")`. Yellow infobar is unavoidable; Web Store accepts it (Nanobrowser is live).
- [browser-use issue #191 — endless loop detection](https://github.com/browser-use/browser-use/issues/191) — validates that loop detection at the agent layer (not the model layer) is necessary.

---

## Key Technical Decisions

- **TypeScript everywhere, no Python.** The eventual extension is TS-only. Keeping the CLI in Python would mean a second port later and would prevent direct code reuse with the extension. Trade-off: throws away the working Python PoC. Mitigation: PoC stays in `local-browser/` as a reference; new repo is `fast-browser/`.
- **Raw CDP, not Playwright.** browser-use measured Playwright's Node-bridge as material overhead at agent loop scale; `chrome.debugger` speaks CDP natively, so a Playwright-shaped core would not survive the extension port. We use [`chrome-remote-interface`](https://github.com/cyrus-and/chrome-remote-interface) (Node) as the cdp-node driver and `chrome.debugger` for the extension driver — same CDP commands, different transport.
- **Adapter boundary at the `BrowserDriver` interface.** Methods: `attach`, `navigate`, `getAxSnapshot`, `getVisibleText`, `screenshot`, `click(backendNodeId)`, `type(backendNodeId, text)`, `scroll`, `waitForLoadState`, `evaluate`, `detach`. Both drivers implement this. Core never imports a transport.
- **Hybrid perception per turn**: (a) AxTree from CDP `Accessibility.getFullAXTree`, filtered to interactive roles AND named landmarks, with stable `backendNodeId` per element; (b) a structural visible-text walk from CDP `DOM.getDocument` + `DOM.getNodeForLocation` that emits the readable text of the viewport's main content region (paragraphs, headings, list items, labels) as separate non-addressable lines; (c) screenshot only when the planner explicitly requests it. Token budget for perception: ~3k.
- **Action vocabulary stays at 6 verbs** — `click`, `type`, `scroll`, `goto`, `wait_for`, `done` — but addressing changes to `{type, targetNodeId, ...}`. This keeps output ≤ 15 tokens (browser-use's KV-cache lesson) and sustains the existing `ActionError`-as-feedback pattern.
- **History before live state in the prompt.** System + task + history (stable across the run) sit in the cached prefix; the live URL + AxTree + visible-text scrape sit in the uncached suffix. Anthropic + OpenAI cache the prefix and skip recompute on cache hits.
- **Two-tier model defaults.** Actor: Gemini 2.5 Flash-Lite (default; cheapest grammar-constrained JSON, ~1s wall). Planner: Claude Sonnet 4.6 (default; reasoning quality on stuck states). Both pluggable via config. Provider abstraction supports Anthropic, OpenAI, Google, Groq, OpenRouter.
- **Loop-detection escalation, not retry.** When the same `(URL, action)` fingerprint repeats twice OR the page state fingerprint is unchanged after 3 actions, the loop hands the trajectory to the planner with a "you are stuck — propose a recovery action" prompt. Avoids the tight oscillation seen in today's quiz run.
- **Cookie/consent pre-dismiss is a per-origin one-shot.** On first navigation to a new origin, run a heuristic dismissal (CSS selector library against common consent banner shapes — `[id*="cookie"] button`, `[class*="consent"] [role="button"]:has-text("Accept")`, etc.). Cache "this origin is dismissed" for the session. Avoids burning a model step on a known-shape problem.
- **Selector cache by `(URL pattern, action intent)`** — when an action succeeds, cache `{urlPattern, intent, backendNodeId selector chain}`. On a cache hit, the loop tries the cached selector first and only invokes the actor on cache miss. In-memory only in Phase 1; persistence deferred.
- **Test-first execution posture for `core/`.** The core is small, pure, and must be correct — write characterization tests for the perception pipeline and unit tests for the action vocabulary before integration. Adapter and extension code defer to integration testing because they are I/O-bound.

---

## Open Questions

### Resolved During Planning

- **Build tool for the extension?** WXT — explicit research consensus, Plasmo is in maintenance mode.
- **CDP transport for cdp-node?** `chrome-remote-interface` — battle-tested, lighter than Puppeteer, no headless-shell baggage. Launch Chrome with `--remote-debugging-port=9222` and attach.
- **Default actor model?** Gemini 2.5 Flash-Lite. Cheapest, fast TTFT, native `response_schema`.
- **Where does the plan file live?** `fast-browser/docs/plans/` — seeds the new repo's documentation home.
- **Vision-mode tier?** Deferred — Skyvern's vision-only path is expensive and our hybrid AxTree+text covers most failure modes. Add later as a planner-requested escalation.

### Deferred to Implementation

- Exact selector chain shape for the persistent cache key (snapshot once we see what `Accessibility.getFullAXTree` actually returns for stable identifiers across reloads).
- Whether to use `chrome.debugger` directly or `puppeteer-core` over the same protocol in the extension — Nanobrowser uses Puppeteer-core; the trade-off is dependency size vs. hand-written CDP. Decide during U11 once the cdp-node driver shape is settled.
- Specific token budgets per AxTree/visible-text section (calibrate empirically against Gemini Flash-Lite cache thresholds).
- Whether to checkpoint trajectory state to `chrome.storage.session` after every action or every N actions (depends on observed SW eviction frequency during U12).

---

## Output Structure

```text
fast-browser/
├── package.json                      # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── docs/
│   └── plans/
│       └── 2026-05-15-001-feat-fast-browser-agent-plan.md
├── packages/
│   ├── core/                         # zero I/O, pure agent logic
│   │   ├── src/
│   │   │   ├── driver.ts             # BrowserDriver interface
│   │   │   ├── perception/
│   │   │   │   ├── ax-tree.ts
│   │   │   │   ├── visible-text.ts
│   │   │   │   └── snapshot.ts       # combines both into one PerceptionFrame
│   │   │   ├── actions/
│   │   │   │   ├── vocabulary.ts     # action types + ActionResult
│   │   │   │   └── executor.ts       # consumes a PerceptionFrame + Action -> ActionResult
│   │   │   ├── loop/
│   │   │   │   ├── agent.ts          # the per-step loop
│   │   │   │   ├── history.ts        # cache-friendly trajectory
│   │   │   │   └── escalation.ts     # loop detection + planner handoff
│   │   │   ├── robustness/
│   │   │   │   ├── consent.ts        # cookie/consent pre-dismiss
│   │   │   │   ├── loop-detect.ts
│   │   │   │   ├── selector-cache.ts
│   │   │   │   └── ready.ts          # network-idle + URL-stable
│   │   │   ├── llm/
│   │   │   │   ├── provider.ts       # abstract Provider interface
│   │   │   │   ├── providers/        # gemini.ts, anthropic.ts, openai.ts, groq.ts, openrouter.ts
│   │   │   │   ├── prompts.ts
│   │   │   │   └── routing.ts        # actor vs planner selection
│   │   │   └── index.ts
│   │   └── test/
│   │       ├── perception/
│   │       ├── actions/
│   │       ├── loop/
│   │       └── robustness/
│   ├── adapter-cdp-node/             # Node + chrome-remote-interface
│   │   ├── src/
│   │   │   ├── driver.ts             # BrowserDriver impl
│   │   │   └── launch.ts             # Chrome process management
│   │   └── test/
│   ├── adapter-cdp-extension/        # chrome.debugger
│   │   ├── src/
│   │   │   ├── driver.ts
│   │   │   └── attach.ts
│   │   └── test/
│   ├── cli/                          # benchmark + dev entry
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   └── bench.ts
│   │   └── test/
│   ├── bench/                        # benchmark harness + tasks
│   │   ├── tasks/
│   │   │   ├── w3schools-quiz.json
│   │   │   └── webvoyager-subset.json
│   │   ├── src/
│   │   │   ├── runner.ts
│   │   │   └── report.ts
│   │   └── results/                  # gitignored, JSON per run
│   └── extension/                    # WXT MV3
│       ├── wxt.config.ts
│       ├── entrypoints/
│       │   ├── background.ts         # service worker — owns the agent loop
│       │   ├── sidepanel/
│       │   │   ├── index.html
│       │   │   └── App.tsx
│       │   ├── options/
│       │   │   └── App.tsx           # BYO key + provider config
│       │   └── content.ts            # minimal — only if chrome.debugger gaps require it
│       ├── public/
│       │   ├── icons/
│       │   └── privacy-policy.md
│       └── test/
└── README.md
```

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
flowchart LR
    subgraph CLI[CLI / Benchmark Process]
      C1[cli/main.ts]
      C2[bench/runner.ts]
    end
    subgraph EXT[Chrome Extension]
      E1[entrypoints/background.ts<br/>service worker]
      E2[entrypoints/sidepanel/App.tsx]
      E3[entrypoints/options/App.tsx]
    end
    subgraph CORE[core — zero I/O]
      L[loop/agent.ts]
      P[perception/snapshot.ts]
      A[actions/executor.ts]
      R[robustness/*]
      LL[llm/routing.ts]
      H[loop/history.ts]
    end
    subgraph DRV[Driver implementations]
      DN[adapter-cdp-node]
      DE[adapter-cdp-extension]
    end

    C1 --> L
    C2 --> L
    E1 --> L
    E2 -. port .-> E1
    E3 -. settings .-> E1

    L --> P
    L --> A
    L --> R
    L --> LL
    L --> H

    P -- BrowserDriver --> DN
    P -- BrowserDriver --> DE
    A -- BrowserDriver --> DN
    A -- BrowserDriver --> DE

    DN -. CDP/WebSocket .-> Chrome[Chrome --remote-debugging-port]
    DE -. chrome.debugger .-> ChromeExt[User's open tab]

    LL -. https .-> Cloud[Anthropic / Google / OpenAI / Groq / OpenRouter]
```

The contract: `core/` only knows about the `BrowserDriver` interface. The CLI imports `core` + `adapter-cdp-node`. The extension imports `core` + `adapter-cdp-extension`. The agent loop, perception, action vocabulary, robustness primitives, prompt shape, and history management are written once.

Per-step shape:

```text
loop tick:
  1. driver.getAxSnapshot()  ──┐  parallelized
     driver.getVisibleText() ──┘  (both CDP commands)
  2. snapshot = combine(ax, text)        # PerceptionFrame
  3. consent.maybeDismiss(snapshot)      # one-shot per origin
  4. cached = selectorCache.lookup(url, intent_from_history)
     if hit: action = cached
     else:   action = await actor.askJson(prompt(snapshot, history))
  5. loopDetect.observe(snapshot, action)
     if stuck: action = await planner.recover(history, snapshot)
  6. result = await executor.run(snapshot, action, driver)
  7. history.append({snapshot.fingerprint, action, result})
  8. if result.ok and action.type == 'done': return result
  9. await ready.settle(driver)          # network-idle or URL-stable
```

---

## Implementation Units

### Phase 1 — Core engine + CLI

- U1. **Project scaffold + `BrowserDriver` interface**

  **Goal:** Establish the pnpm workspace, TS config, and the `BrowserDriver` interface that pins the adapter contract.

  **Requirements:** R7

  **Dependencies:** none

  **Files:**
  - Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `README.md`
  - Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/driver.ts`, `packages/core/src/index.ts`
  - Test: `packages/core/test/driver.contract.test.ts` (interface shape assertion via type-level tests)

  **Approach:**
  - pnpm workspace with `packages/*`. Strict TS, ESM-first.
  - `BrowserDriver` exposes: `attach({tabId? | url})`, `navigate(url)`, `getAxSnapshot(): Promise<AxNode[]>`, `getVisibleText(viewport?): Promise<TextBlock[]>`, `screenshot(): Promise<Buffer>`, `click(backendNodeId)`, `type(backendNodeId, text)`, `scroll(direction, amount)`, `waitForReady()`, `evaluate(expr)`, `detach()`.
  - `AxNode` carries `backendNodeId`, `role`, `name`, `value`, `bounds`, `disabled`, `focusable`. Indices are derived in `core/perception`, never exposed to drivers.

  **Patterns to follow:** Nanobrowser package layout (single TS monorepo, multiple entrypoints).

  **Test scenarios:**
  - Happy path: a stub driver implementing the interface compiles and round-trips a `navigate → getAxSnapshot → click → detach` sequence.
  - Edge case: drivers MUST reject `click(backendNodeId)` for an unknown node with a typed `DriverError`.
  - Edge case: type-level test asserts the interface has no transport-specific types (no `import` from `chrome-remote-interface` or `chrome.debugger`).

  **Verification:** `pnpm -r build` succeeds; `pnpm --filter @fast-browser/core test` passes; `grep -r "playwright\|chrome\.debugger\|chrome-remote-interface" packages/core/src` returns empty.

- U2. **`adapter-cdp-node` driver**

  **Goal:** Implement `BrowserDriver` against `chrome-remote-interface` against a Chromium instance launched with `--remote-debugging-port`.

  **Requirements:** R7

  **Dependencies:** U1

  **Files:**
  - Create: `packages/adapter-cdp-node/package.json`, `packages/adapter-cdp-node/src/launch.ts`, `packages/adapter-cdp-node/src/driver.ts`
  - Test: `packages/adapter-cdp-node/test/driver.integration.test.ts`

  **Approach:**
  - `launch.ts` spawns Chrome (`@puppeteer/browsers` to fetch a pinned revision) with `--remote-debugging-port=0 --user-data-dir=<tmp>`. Reads the chosen port from stderr.
  - `driver.ts` connects via `chrome-remote-interface`, enables domains: `Page`, `DOM`, `Runtime`, `Accessibility`, `Network`, `Input`. All `BrowserDriver` methods are thin CDP calls.
  - `getAxSnapshot` → `Accessibility.getFullAXTree`, then map to `AxNode[]`.
  - `click(backendNodeId)` → `DOM.scrollIntoViewIfNeeded` → `DOM.getBoxModel` → `Input.dispatchMouseEvent(mousePressed/mouseReleased)` at center coordinates. **No** index or selector re-resolution.
  - `type(backendNodeId, text)` → focus via `DOM.focus` → `Input.insertText`.

  **Patterns to follow:** browser-use's CDP migration write-up — direct CDP, no Playwright bridge.

  **Test scenarios:**
  - Happy path: launch Chrome, navigate to `https://example.com`, snapshot returns a non-empty AxTree containing the `link` to "More information".
  - Happy path: click the link by `backendNodeId`, then `waitForReady()` resolves, then snapshot reflects the new URL.
  - Edge case: `click(backendNodeId)` for a node that has scrolled off-screen scrolls into view first, then clicks.
  - Edge case: `click(backendNodeId)` for a disabled element returns `DriverError("disabled")` without retrying.
  - Error path: if Chrome dies mid-session, every driver method rejects with `DriverError("disconnected")` and `detach()` is idempotent.

  **Verification:** integration test suite runs end-to-end against a real Chromium and passes.

- U3. **Hybrid perception layer**

  **Goal:** Produce a `PerceptionFrame` per step combining (a) addressable interactive elements (AxTree-derived), (b) readable visible text (structural walk), (c) page metadata (URL, title, scroll position).

  **Requirements:** R3, R4

  **Dependencies:** U1

  **Files:**
  - Create: `packages/core/src/perception/ax-tree.ts`, `packages/core/src/perception/visible-text.ts`, `packages/core/src/perception/snapshot.ts`, `packages/core/src/perception/types.ts`
  - Test: `packages/core/test/perception/ax-tree.test.ts`, `packages/core/test/perception/visible-text.test.ts`, `packages/core/test/perception/snapshot.test.ts`

  **Execution note:** Test-first. Perception is the failure root cause from `local-browser/` — characterize the desired output against fixture pages before implementing.

  **Approach:**
  - `ax-tree.ts` consumes `BrowserDriver.getAxSnapshot()`, filters to interactive roles (`button|link|textbox|checkbox|radio|combobox|menuitem|tab|switch|searchbox|spinbutton|option`) AND landmark roles (`main|article|region|form|navigation`), preserves `backendNodeId`, drops `name` truncation (today's 200-char cap kills semantic info — `local-browser/perception.py:36`), keeps full names.
  - `visible-text.ts` consumes `BrowserDriver.getVisibleText()` which under the hood runs a CDP `Runtime.evaluate` returning a structured walk of headings (`h1-h6`), paragraphs, list items, labels, and table cells visible in the viewport (or expanded one viewport above/below). Each block is non-addressable, just text. This is what fixes the W3Schools quiz failure.
  - `snapshot.ts` combines both into a single `PerceptionFrame { url, title, ax: AxNode[], text: TextBlock[], fingerprint: string }`. Fingerprint is `sha256(url + sorted(backendNodeIds) + first 256 chars of visible text)` — used by loop-detection.
  - The serialized prompt form: `[N] role 'name' (= value)` lines for interactive, then a `--- visible text ---` block of `text:` lines.

  **Patterns to follow:** browser-use 1.0's DOM distillation; Stagehand's structured extraction; existing `local-browser/perception.py:80-100` shape.

  **Test scenarios:**
  - Happy path: against a fixture HTML page with 3 buttons, 1 textbox, and 2 paragraphs, the snapshot has 4 ax nodes and 2 text blocks; serialized prompt fits in <500 tokens.
  - Edge case: against a quiz fixture (a `<form>` with `<p>` question stem and `<input type="radio">` choices), the question stem appears in the visible-text block and the radios appear as 4 addressable ax nodes.
  - Edge case: a page with 200 buttons emits all 200 AxNodes (no `max_per_role=60` cap from the predecessor) but the prompt-serialization step warns when token count exceeds the configured budget.
  - Edge case: a page with two visually identical buttons (same role+name) produces two distinct AxNodes with distinct backendNodeIds (no `(role, name)` dedup from the predecessor — `local-browser/perception.py:60`).
  - Integration: against a live Chrome via `adapter-cdp-node`, snapshot of `https://example.com` returns the "More information" link as an addressable ax node and "This domain is for use in illustrative examples in documents" as a visible-text block.

  **Verification:** all tests pass; the W3Schools quiz fixture (saved HTML) produces a snapshot where every question and every answer choice is present in either `ax` or `text`.

- U4. **Action vocabulary + executor**

  **Goal:** Define the 6-verb action schema and an executor that runs an action against a `PerceptionFrame + BrowserDriver`, returning a typed `ActionResult`. Stable `backendNodeId` addressing throughout.

  **Requirements:** R4, R10

  **Dependencies:** U1, U2, U3

  **Files:**
  - Create: `packages/core/src/actions/vocabulary.ts`, `packages/core/src/actions/executor.ts`
  - Test: `packages/core/test/actions/vocabulary.test.ts`, `packages/core/test/actions/executor.test.ts`

  **Execution note:** Test-first.

  **Approach:**
  - `vocabulary.ts` exports: `Click {targetNodeId}`, `Type {targetNodeId, value}`, `Scroll {direction, amount}`, `Goto {url}`, `WaitFor {selector|text|ms}`, `Done {result}`. Discriminated union keyed on `type`.
  - `executor.ts`: validates `targetNodeId` exists in the current `PerceptionFrame` (rejects if not — never re-resolves against a fresh DOM, the predecessor's bug at `local-browser/actions.py:54, 80`); for `click`/`type`, calls `driver.click(backendNodeId)` / `driver.type(backendNodeId, value)`; returns `ActionResult { ok, summary, error? }`.
  - Errors are typed: `unknown_target | disabled | timeout | navigation_failed | parse_error`.

  **Patterns to follow:** existing `ActionError`-as-feedback pattern from `local-browser/actions.py:12` — preserved, but with structured error codes.

  **Test scenarios:**
  - Happy path: each verb against a stub `BrowserDriver` produces the expected driver call and an `ok` ActionResult.
  - Edge case: `Click {targetNodeId: 999}` against a frame where node 999 does not exist returns `{ok:false, error:"unknown_target"}` and never touches the driver. (Regression test for the predecessor's silent index drift.)
  - Edge case: `Type` against a node that the driver reports disabled returns `{ok:false, error:"disabled"}` with the node's name in the summary.
  - Edge case: `Done` is a terminal action — executor returns `ok:true` and the loop knows to stop.
  - Error path: driver throws mid-action → executor wraps as `{ok:false, error:"timeout"}` (or appropriate code) without crashing the loop.

  **Verification:** unit tests pass; a property-based test asserts that no executor code path ever calls `driver` without a node first appearing in the input `PerceptionFrame`.

- U5. **Provider-pluggable LLM client with structured output + prompt caching**

  **Goal:** A `Provider` abstraction with concrete implementations for Gemini, Anthropic, OpenAI, Groq, OpenRouter. All return typed JSON via grammar-constrained outputs where supported; all enable prompt caching where supported.

  **Requirements:** R6

  **Dependencies:** U1

  **Files:**
  - Create: `packages/core/src/llm/provider.ts`, `packages/core/src/llm/providers/gemini.ts`, `packages/core/src/llm/providers/anthropic.ts`, `packages/core/src/llm/providers/openai.ts`, `packages/core/src/llm/providers/groq.ts`, `packages/core/src/llm/providers/openrouter.ts`, `packages/core/src/llm/prompts.ts`, `packages/core/src/llm/types.ts`
  - Test: `packages/core/test/llm/provider.contract.test.ts`, recorded HTTP fixtures under `packages/core/test/llm/fixtures/`

  **Approach:**
  - `Provider.askJson<T>({system, user, schema, cacheableSystem?: boolean}): Promise<T>` — returns typed parsed JSON or throws `LlmError`.
  - Gemini: `generateContent` with `responseSchema`. Native structured output.
  - Anthropic: `messages` with `tools` + `tool_choice` for forced JSON. `cache_control` markers on system prompt when `cacheableSystem: true` and prompt ≥ 1024 tokens.
  - OpenAI: `response_format: {type: 'json_schema', json_schema: ...}`.
  - Groq: JSON mode via `response_format: {type: 'json_object'}` + schema in system prompt (Groq does not yet have full schema enforcement on free tier — flagged in research).
  - OpenRouter: passes through to the underlying model; structured output reliability is per-model (may need post-parse retry).
  - Centralized retry policy: 1 retry on 5xx/timeout; on parse failure, send the malformed string back with a "fix-the-JSON" repair prompt.
  - Carry forward `_parse_json` defensive coercion logic from `local-browser/llm_client.py:23-38` as `safeParseJson` in TS.

  **Patterns to follow:** Vercel AI SDK's provider abstraction shape (single `generateObject` interface across providers).

  **Test scenarios:**
  - Happy path: each provider, against a recorded fixture response, returns the expected typed object.
  - Edge case: a provider that returns JSON wrapped in markdown fences is parsed via `safeParseJson` fallback.
  - Edge case: a provider that returns invalid JSON triggers a single repair-prompt retry; if that also fails, throws `LlmError("parse_failed", attempts: 2)`.
  - Edge case: with `cacheableSystem: true` and prompt < 1024 tokens, the cache marker is omitted (avoids the Anthropic minimum-size error).
  - Error path: 429 from the provider triggers exponential backoff with `Retry-After` honored.

  **Verification:** all provider contract tests pass against recorded fixtures; one live smoke test per provider behind an env-var gate.

- U6. **Agent loop, history, prompt assembly**

  **Goal:** The per-step loop that ties perception + action + LLM + history together, with cache-friendly prompt ordering and structured trajectory storage.

  **Requirements:** R1, R3, R4, R6, R10

  **Dependencies:** U3, U4, U5

  **Files:**
  - Create: `packages/core/src/loop/agent.ts`, `packages/core/src/loop/history.ts`, `packages/core/src/loop/types.ts`
  - Test: `packages/core/test/loop/agent.test.ts`, `packages/core/test/loop/history.test.ts`

  **Approach:**
  - `History` stores a structured `TrajectoryStep[]` with `{stepIndex, urlBefore, snapshotFingerprint, action, result, urlAfter}`. Replaces `local-browser/local_agent.py:52-54`'s 5-line truncation. The serialized form for the prompt is configurable (default: last 8 steps, with success/failure summaries, no full snapshots).
  - `agent.ts` runs the loop from the High-Level Technical Design's pseudo-code. Cache-friendly prompt order: `[ system | task | history-serialized ] [ url | ax-serialized | text-serialized | "Next action:" ]`. The first bracket is marked cacheable.
  - Configurable `maxSteps`, `actorProvider`, `plannerProvider`, `onStep` callback (used by the extension to stream to sidepanel).
  - Returns `RunResult { success, steps, wallMs, costUsdEstimate, finalResult, errors[] }`.

  **Patterns to follow:** browser-use's prompt order (history before live state). Today's `local-browser/local_agent.py:51-65` `build_prompt` shape, restructured.

  **Test scenarios:**
  - Happy path: with stub provider returning a `done` action immediately, the loop terminates after 1 step, returns `success:true, steps:1`.
  - Happy path: with stub provider returning `click → done` against a 2-element fixture, loop terminates after 2 steps.
  - Edge case: `maxSteps` reached without `done` returns `success:false, finalResult:"max_steps_reached"`, not an exception.
  - Edge case: actor returns invalid JSON, repair retry succeeds → loop continues; if both fail → step is recorded as `parse_error` and loop continues (does not crash).
  - Integration: `onStep` callback is invoked exactly once per step with the trajectory step.
  - Integration: prompt-cache marker is present on the system+task+history block when `cacheableSystem: true`.

  **Verification:** loop tests pass; a fixture run against a saved AxTree sequence (no real driver) reproduces a known trajectory deterministically.

- U7. **Robustness primitives**

  **Goal:** Loop-level handling of cookie/consent banners, oscillation detection, scroll-to-find, post-action readiness, and selector cache. These are the primitives that close the gap between "works on demos" and "completes real interactive sites."

  **Requirements:** R2, R5

  **Dependencies:** U3, U4, U6

  **Files:**
  - Create: `packages/core/src/robustness/consent.ts`, `packages/core/src/robustness/loop-detect.ts`, `packages/core/src/robustness/selector-cache.ts`, `packages/core/src/robustness/ready.ts`, `packages/core/src/robustness/scroll-find.ts`, `packages/core/src/robustness/consent-rules.ts` (declarative selector library)
  - Test: `packages/core/test/robustness/consent.test.ts`, `packages/core/test/robustness/loop-detect.test.ts`, `packages/core/test/robustness/selector-cache.test.ts`, `packages/core/test/robustness/ready.test.ts`

  **Execution note:** Test-first. These are small, pure functions that the loop composes — easy to TDD and high leverage for completion rates.

  **Approach:**
  - `consent.ts`: on first navigation to a new origin, walks the AxTree against `consent-rules.ts` (CSS-shape patterns: `[id*="cookie"] [role="button"]`, `[class*="consent"] button:has-text(/accept|agree|ok/i)`, common vendor frames `#onetrust-accept-btn-handler`, `[aria-label="Accept all"]`, etc.). Clicks the first match if found; caches origin → dismissed for the session. Costs zero model calls on the happy path.
  - `loop-detect.ts`: maintains a sliding window of the last 5 `(url, action.type, action.targetNodeId)` fingerprints. Trips when the same triple appears 2× in a row OR the snapshot fingerprint is unchanged for 3 consecutive steps. Trip → loop calls planner with `recover` prompt, planner emits a `Goto`, `WaitFor`, or alternative action.
  - `selector-cache.ts`: in-memory `Map<{urlPattern, intentHash}, BackendNodeIdSelector>`. URL pattern is the path with query params stripped. Intent hash is `sha256(history.lastNonNavActionSummary)`. On cache hit, the loop bypasses the actor for that step.
  - `ready.ts`: after every non-`wait_for` action, polls `Page.frameStoppedLoading` + URL stability + DOM `mutationCount==0` for 200ms windows, max 3s. Replaces `local-browser/local_agent.py:136`'s fixed 500ms.
  - `scroll-find.ts`: when the actor wants to click an element name not present in the current snapshot, attempt a structured scroll-and-resnapshot up to N times before reporting `unknown_target`.

  **Patterns to follow:** browser-use issue #191 / #2452 fixes; Stagehand's selector cache; consent-handler libraries (e.g., the `i-still-dont-care-about-cookies` ruleset is a starting reference for `consent-rules.ts`).

  **Test scenarios:**
  - Consent — Happy: against a fixture page with `<button id="onetrust-accept-btn-handler">Accept all</button>`, `consent.maybeDismiss(snapshot)` returns `dismissed:true` and emits a click action.
  - Consent — Edge: a page with no consent banner returns `dismissed:false` in <50ms (no model call, no driver call).
  - Consent — Edge: dismissed origins are not re-checked on subsequent navigations within the same origin.
  - Loop-detect — Happy: a sequence of `[click@5, click@5]` against the same URL trips the detector on the 2nd repeat.
  - Loop-detect — Edge: a sequence of `[click@5, click@7, click@5]` does NOT trip (alternation is allowed).
  - Loop-detect — Integration: when the detector trips, the loop's next call is to the planner (verified via spy provider).
  - Selector cache — Happy: after a successful `click@5` on URL `/quiz`, a subsequent loop step on URL `/quiz` with the same intent hash uses the cached selector and skips the actor call.
  - Selector cache — Edge: a cache hit that resolves to a no-longer-present `backendNodeId` falls back to a normal actor call and evicts the entry.
  - Ready — Happy: after a click that triggers navigation, `ready.settle` resolves once `Page.frameStoppedLoading` fires.
  - Ready — Edge: an action that does not trigger navigation returns within 200ms.

  **Verification:** primitives' unit tests pass; an integration test runs a 3-step `[consent-dismiss → click → done]` sequence end-to-end against a fixture page in <2s.

- U8. **Two-tier model strategy: actor + planner with escalation triggers**

  **Goal:** The loop routes ordinary steps to the actor and stuck-state steps to the planner, with explicit escalation triggers and a planner-recovery prompt.

  **Requirements:** R6

  **Dependencies:** U5, U6, U7

  **Files:**
  - Create: `packages/core/src/llm/routing.ts`, `packages/core/src/loop/escalation.ts`
  - Modify: `packages/core/src/loop/agent.ts`
  - Test: `packages/core/test/loop/escalation.test.ts`, `packages/core/test/llm/routing.test.ts`

  **Approach:**
  - `routing.ts`: `selectProvider({phase: 'step' | 'recover', config}): Provider` returns the actor for ordinary steps, the planner for `recover` phase.
  - `escalation.ts`: triggers are (a) `loop-detect` tripped, (b) 2 consecutive `parse_error` from actor, (c) actor explicitly emitted `{type:"done", result:"stuck"}`. On trigger, builds a recovery prompt: full last 12 trajectory steps + current snapshot + "you are stuck — propose a single recovery action: a `goto`, a `wait_for`, or a different element click. Do not repeat the last action."
  - The planner can also be invoked once at the start of long tasks (planner emits a high-level plan in natural language that gets prepended to the actor's system prompt — Agent-E pattern). Configurable: off by default for short tasks, on for tasks tagged `complex` in the bench harness.

  **Patterns to follow:** Agent-E (planner once per task) and Skyvern Validator (separate model checks state).

  **Test scenarios:**
  - Happy: ordinary step routes to actor.
  - Edge: loop-detect trip causes the next step to route to planner with `recover` prompt.
  - Edge: planner returns a recovery action; loop executes it; if it succeeds, future steps return to actor.
  - Edge: 3 consecutive escalations (planner also stuck) → loop returns `success:false, finalResult:"unrecoverable"`.

  **Verification:** routing tests pass; integration test simulating a stuck loop (stub driver always returns the same snapshot) shows: actor → actor → planner-recover → planner-recover → unrecoverable.

- U9. **Benchmark harness + W3Schools quiz + WebVoyager subset**

  **Goal:** A reproducible benchmark that runs a task list end-to-end and emits machine-readable results.

  **Requirements:** R1, R2, R9

  **Dependencies:** U1–U8

  **Files:**
  - Create: `packages/bench/package.json`, `packages/bench/src/runner.ts`, `packages/bench/src/report.ts`, `packages/bench/tasks/w3schools-quiz.json`, `packages/bench/tasks/webvoyager-subset.json`
  - Create: `packages/cli/package.json`, `packages/cli/src/main.ts`, `packages/cli/src/bench.ts`
  - Test: `packages/bench/test/runner.test.ts` (against fixture tasks against stub driver)

  **Approach:**
  - `runner.ts` accepts `(tasks, agentConfig)`, runs each task, emits `BenchResult { task, success, steps, wallMs, costUsdEstimate, model, errors[] }` per task and a summary.
  - `tasks/w3schools-quiz.json`: `{name, url, task, success_check}` where `success_check` is a snapshot predicate (e.g., text contains "/20" and the score number > 0).
  - `tasks/webvoyager-subset.json`: 25 hand-picked WebVoyager tasks across e-commerce, info-lookup, and form-fill categories.
  - `cli/src/main.ts`: `fast-browser run "<task>" --url <url> --watch --model gemini-2.5-flash-lite` for ad-hoc use.
  - `cli/src/bench.ts`: `fast-browser bench --tasks tasks/w3schools-quiz.json --model gemini-2.5-flash-lite --concurrency 1` outputs a JSONL report.

  **Patterns to follow:** WebVoyager's task JSON format; Stagehand's eval harness shape.

  **Test scenarios:**
  - Happy: runner against a 1-task fixture with stub driver returns the expected `BenchResult`.
  - Edge: runner respects per-task `maxSteps` and reports `timeout` failure when exceeded.
  - Edge: a task that throws in the agent loop is reported as `{success:false, errors: [stack]}` and does not abort the run of remaining tasks.
  - Integration (manual gate, `BENCH_LIVE=1`): the W3Schools quiz task produces `success:true, steps<60, wallMs<300_000`. This is the headline acceptance test for R1+R2.

  **Verification:** `pnpm bench --tasks w3schools-quiz.json` (with a real API key) produces a JSONL report with `success:true` and median step latency <2000ms.

### Phase 2 — Chrome extension

- U10. **WXT extension scaffold + manifest + sidepanel skeleton**

  **Goal:** An installable MV3 extension scaffold with sidepanel UI, options page, service worker, and the right permission set.

  **Requirements:** R8

  **Dependencies:** U1

  **Files:**
  - Create: `packages/extension/package.json`, `packages/extension/wxt.config.ts`, `packages/extension/entrypoints/background.ts`, `packages/extension/entrypoints/sidepanel/index.html`, `packages/extension/entrypoints/sidepanel/App.tsx`, `packages/extension/entrypoints/options/App.tsx`, `packages/extension/public/icons/*`, `packages/extension/public/privacy-policy.md`
  - Test: `packages/extension/test/manifest.test.ts` (asserts permissions and entrypoints)

  **Approach:**
  - WXT config: target `chrome-mv3`, declare `entrypoints/background.ts`, sidepanel, options.
  - Manifest permissions: `"debugger"`, `"scripting"`, `"storage"`, `"alarms"`, `"sidePanel"`, `"tabs"`, `"offscreen"`. Host permissions: `"<all_urls>"`.
  - Sidepanel: minimal React app with three states — "Idle (paste task)", "Running (live action timeline)", "Done (final result + cost)".
  - Options page: BYO API keys per provider, default model selection, cache toggles.
  - Background: stub `agent loop runner` that responds to `chrome.runtime.onMessage({type: 'startTask', task, url})`.

  **Patterns to follow:** Nanobrowser's entrypoint layout; WXT's React + sidepanel template.

  **Test scenarios:**
  - Happy: `pnpm --filter extension build` produces a `dist/` loadable as an unpacked extension.
  - Happy: clicking the toolbar icon opens the sidepanel.
  - Edge: manifest test asserts `"debugger"` is present and `"persistent": true` is absent (MV3 requirement).

  **Verification:** load unpacked, click icon, see sidepanel; options page accepts and persists an API key.

- U11. **`adapter-cdp-extension` driver via `chrome.debugger`**

  **Goal:** Implement `BrowserDriver` against `chrome.debugger.attach` so `core/` runs unmodified inside the extension.

  **Requirements:** R7, R8

  **Dependencies:** U10, U2

  **Files:**
  - Create: `packages/adapter-cdp-extension/package.json`, `packages/adapter-cdp-extension/src/driver.ts`, `packages/adapter-cdp-extension/src/attach.ts`
  - Test: `packages/adapter-cdp-extension/test/driver.smoke.test.ts` (manual gated; runs in extension dev mode)

  **Approach:**
  - `attach.ts`: `chrome.debugger.attach({tabId}, "1.3")` then enable `Page`, `DOM`, `Runtime`, `Accessibility`, `Network`, `Input`. Detach on task complete.
  - `driver.ts`: every `BrowserDriver` method translates to `chrome.debugger.sendCommand({tabId}, "Domain.method", params)` — same CDP commands as `adapter-cdp-node`. Yellow infobar is unavoidable; document in privacy policy.
  - Decision deferred from planning: whether to use `puppeteer-core` over the same chrome.debugger transport (Nanobrowser does this) vs. raw CDP. Current bias is raw — fewer dependencies, cleaner symmetry with `adapter-cdp-node`.

  **Patterns to follow:** Nanobrowser's `background/index.ts` chrome.debugger usage; `chrome.debugger` API docs.

  **Test scenarios:**
  - Happy: with the extension loaded and an open tab on `https://example.com`, `driver.attach({tabId})` succeeds, `getAxSnapshot()` returns a non-empty AxTree.
  - Edge: attempting to attach to a `chrome://` URL or the Web Store fails with `DriverError("disallowed_url")` cleanly.
  - Edge: if the user closes the tab mid-task, the driver emits `disconnected` and the agent loop shuts down gracefully (no zombie `chrome.debugger` session).

  **Verification:** smoke test in extension dev mode passes; the same `core/loop/agent.ts` runs end-to-end against this driver with no source changes.

- U12. **Service-worker keepalive + state checkpointing**

  **Goal:** Long-running tasks (≥5 min) survive MV3's 30-second idle eviction by combining `chrome.alarms`, sidepanel port keepalive, and `chrome.storage.session` checkpointing.

  **Requirements:** R8

  **Dependencies:** U10

  **Files:**
  - Create: `packages/extension/src/lifecycle/keepalive.ts`, `packages/extension/src/lifecycle/checkpoint.ts`
  - Modify: `packages/extension/entrypoints/background.ts`
  - Test: `packages/extension/test/keepalive.test.ts` (chrome API mocks)

  **Approach:**
  - `keepalive.ts`: register a `chrome.alarms.create('agent-keepalive', {periodInMinutes: 0.4})` (24s) when a task starts. Listener is a no-op handler that only exists to wake the SW.
  - `checkpoint.ts`: after every loop step, persist `{taskId, currentStep, history, snapshotFingerprint, urlAtStart}` to `chrome.storage.session`. On SW boot, check for an in-progress task and resume.
  - The sidepanel maintains a long-lived port `chrome.runtime.connect({name: 'agent-stream'})` whenever it is open; SW uses port liveness as a cheap "user is watching" signal and prefers the port over alarms when available.

  **Patterns to follow:** the keepalive engineering reference (alarms + ports work; `setInterval` does not).

  **Test scenarios:**
  - Happy: task that takes 60 seconds with the alarm registered completes without SW eviction (mocked timer).
  - Edge: SW eviction mid-task → on reboot, checkpoint is read, task resumes from the same step.
  - Edge: sidepanel close mid-task → alarm-only keepalive takes over, task continues.
  - Edge: task completion clears the checkpoint (no zombie state on next session).

  **Verification:** keepalive test suite passes; manual: a 5-minute scripted task completes against a real Chrome.

- U13. **Sidepanel UI: streaming, action timeline, settings**

  **Goal:** A polished sidepanel that streams agent activity to the user, shows the trajectory, exposes start/stop/pause, and links to options.

  **Requirements:** R8

  **Dependencies:** U10, U12

  **Files:**
  - Modify: `packages/extension/entrypoints/sidepanel/App.tsx`
  - Create: `packages/extension/entrypoints/sidepanel/components/TaskInput.tsx`, `Timeline.tsx`, `StatusBar.tsx`, `SettingsLink.tsx`
  - Modify: `packages/extension/entrypoints/options/App.tsx`
  - Test: `packages/extension/test/sidepanel.test.tsx` (React Testing Library)

  **Approach:**
  - `App.tsx` opens a port to the SW, dispatches `startTask`, listens for `step`, `error`, `done` messages.
  - Timeline: per-step card with `{action.type, action.target?, result.summary, latencyMs, costUsd}`.
  - Status bar: total wall time, total cost, current model.
  - Stop button sends `cancelTask` to SW; SW detaches `chrome.debugger` cleanly.

  **Patterns to follow:** PRBrief's panel UX (collapsible, single-purpose, paste-key-and-go); Nanobrowser's chat-style timeline.

  **Test scenarios:**
  - Happy: typing a task and clicking Run sends `startTask` message; subsequent step events render timeline cards.
  - Edge: clicking Stop mid-task immediately disables Run and emits `cancelTask`.
  - Edge: with no API key configured, Run is disabled and a link to Options is shown.

  **Verification:** sidepanel renders correctly in extension dev mode; one full end-to-end task (`https://example.com`, "click the more info link and tell me what page you land on") runs and shows a clean timeline.

- U14. **End-to-end extension benchmark on the W3Schools quiz**

  **Goal:** Re-run the W3Schools quiz benchmark from the extension itself (not the CLI). This is the headline acceptance test for the whole project: same task that failed at 14:32 / 0% in the predecessor must pass in <5 minutes / >80%.

  **Requirements:** R1, R2, R8

  **Dependencies:** U9, U11, U12, U13

  **Files:**
  - Create: `packages/extension/test/e2e/w3schools-quiz.test.ts` (Playwright-driven; loads the extension, opens the panel, runs the task, asserts success)
  - Create: `packages/bench/results/extension-baseline.json` (recorded result)

  **Approach:**
  - Use Playwright with `chromium.launchPersistentContext({args: ['--load-extension=...']})` to launch Chrome with the extension installed.
  - The test opens the sidepanel via a script, types the task, clicks Run, and waits for a `done` event.
  - Asserts: task completes in `<300_000ms`, the timeline shows the score readback, cost recorded.

  **Test scenarios:**
  - Happy: the W3Schools quiz completes successfully end-to-end.
  - Edge: 3 consecutive runs to measure variance; success rate ≥ 80% across runs.

  **Verification:** the test passes; `bench/results/extension-baseline.json` is committed as the reference.

---

## System-Wide Impact

- **Interaction graph:** `core/` is the orchestration boundary. Drivers are pure I/O. The extension's SW is the only place where MV3 lifecycle concerns leak in.
- **Error propagation:** every driver error is a typed `DriverError`; every action error is a typed `ActionError`; every LLM error is a typed `LlmError`. The loop catches all three and decides recover-vs-abort. No bare `catch (e)` anywhere.
- **State lifecycle risks:** `chrome.debugger` sessions can leak if the SW crashes mid-task — `checkpoint.ts` must include a "stale debugger session" check on boot and call `chrome.debugger.detach` defensively. Selector cache eviction must be honored when navigation invalidates `backendNodeId`s.
- **API surface parity:** every action available in the CLI must be available in the extension. The benchmark harness (Phase 1) and the e2e extension test (U14) assert this empirically.
- **Integration coverage:** unit tests cover `core/`; integration tests with a real Chromium cover `adapter-cdp-node` (Phase 1); Playwright e2e test covers the loaded extension end-to-end (U14). Skipping any of these layers risks a "passes unit tests, fails on real sites" regression.
- **Unchanged invariants:** `local-browser/` is **not** modified — it stays as a working PoC reference. `PRBrief/` is untouched.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Hybrid perception still misses content (e.g., elements behind shadow DOM, content in cross-origin iframes) | CDP `Accessibility.getFullAXTree` traverses iframes and shadow DOM by default — verified in U2 integration tests. If gaps appear, the planner's `recover` prompt can request a screenshot fallback. |
| `chrome.debugger` yellow infobar deters users | Document in privacy policy; surface it in the sidepanel's first-run flow ("Chrome will show a yellow bar; this is required for the agent to act on your behalf"). Reference Nanobrowser's UX. |
| Web Store rejection of `debugger` permission | Nanobrowser is live with the same permission. If rejected, Phase 2 still ships as an unpacked extension; Web Store is not gating. |
| LLM provider rate limits make benchmarks unreproducible | Provider abstraction supports OpenRouter free-tier rotation as a dev-tier fallback. Production tier requires paid API keys (BYO). |
| Selector cache pollutes results across reloads (false positives) | In-memory only in Phase 1. Eviction on cache miss / `unknown_target`. Persistence is deferred. |
| `chrome.storage.session` exceeds quota on long tasks | Cap history serialization to last 8 steps; full trajectory written to disk only on task completion. |
| Two-tier router escalates too eagerly and inflates planner cost | Loop-detect threshold tunable; default conservative (3 unchanged-fingerprint steps OR 2-repeat exact-action). Bench harness reports planner-call rate per task. |
| The W3Schools site changes its DOM and breaks the test | The headline benchmark is intentionally a public, frequently-updated site — that is the point. Failure on a real-site DOM change is a real signal. Pin a snapshot for unit tests; let the e2e test track upstream. |

---

## Documentation / Operational Notes

- `README.md` at the repo root: install, dev quickstart for both CLI and extension, BYO key setup, link to this plan.
- `packages/extension/public/privacy-policy.md`: data flow (BYO key, no telemetry, `chrome.debugger` notice).
- Each package gets its own minimal README pointing at the plan.
- Benchmark results under `packages/bench/results/` are gitignored except the baseline files (`*-baseline.json`).
- No CI in Phase 1; Phase 2 adds a GitHub Actions workflow that runs `pnpm test` on PRs.

---

## Phased Delivery

### Phase 1 — Core engine + CLI (target: 1 week)

- U1 → U2 → U3 → U4 → U5 → U6 → U7 → U8 → U9.
- Acceptance: `pnpm bench --tasks w3schools-quiz.json --model gemini-2.5-flash-lite` produces `success:true` with median step latency <2000ms.

### Phase 2 — Chrome extension (target: 1 week after Phase 1)

- U10 → U11 → U12 → U13 → U14.
- Acceptance: the W3Schools quiz benchmark passes end-to-end from the loaded extension; SW survives ≥5 minutes of activity; sidepanel streams a clean timeline.

---

## Sources & References

- Origin code: `local-browser/local_agent.py`, `local-browser/perception.py`, `local-browser/actions.py`, `local-browser/llm_client.py`
- Reference extension: [Nanobrowser](https://github.com/nanobrowser/nanobrowser)
- CDP migration evidence: [browser-use Playwright→CDP](https://browser-use.com/posts/playwright-to-cdp)
- Speed lessons: [browser-use Speed Matters](https://browser-use.com/posts/speed-matters)
- Caching: [Don't Break the Cache (arXiv 2601.06007)](https://arxiv.org/html/2601.06007v2), [Stagehand caching](https://www.browserbase.com/blog/stagehand-caching)
- Two-tier pattern: [Agent-E (arXiv 2407.13032)](https://arxiv.org/abs/2407.13032), [Skyvern Planner-Actor-Validator](https://www.skyvern.com/blog/skyvern-2-0-state-of-the-art-web-navigation-with-85-8-on-webvoyager-eval/)
- MV3 + sidepanel + chrome.debugger: [chrome.debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger), [WXT framework](https://wxt.dev/), [SW lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- Model latency: [BenchLM May 2026](https://benchlm.ai/llm-speed)
- Loop detection prior: [browser-use #191](https://github.com/browser-use/browser-use/issues/191), [browser-use #2452](https://github.com/browser-use/browser-use/issues/2452)
