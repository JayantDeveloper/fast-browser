# fast-browser

High-throughput local browser agent with an extension-ready core. Successor to `local-browser/`.

**Status:** Phase 1 (CLI engine) in progress. Phase 2 (Chrome extension) deferred.

See [`docs/plans/2026-05-15-001-feat-fast-browser-agent-plan.md`](docs/plans/2026-05-15-001-feat-fast-browser-agent-plan.md) for the full plan.

## Layout

- `packages/core/` — agent loop, perception, actions, robustness, LLM client. Zero I/O dependencies.
- `packages/adapter-cdp-node/` — `BrowserDriver` against a launched Chromium via `chrome-remote-interface`.
- `packages/adapter-cdp-extension/` — `BrowserDriver` against `chrome.debugger` (Phase 2).
- `packages/cli/` — `fast-browser run` and `fast-browser bench` entrypoints.
- `packages/bench/` — benchmark harness + task definitions.
- `packages/extension/` — WXT/MV3 Chrome extension (Phase 2).

## Dev

```bash
pnpm install
pnpm test
pnpm build
```
