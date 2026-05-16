import type { BrowserDriver } from "../driver.js";
import { DriverError } from "../driver.js";
import type { PerceptionFrame } from "../perception/types.js";
import type { Action, ActionResult } from "./vocabulary.js";

/**
 * Execute an Action against a BrowserDriver, validating that any
 * `targetNodeId` exists in the current PerceptionFrame.
 *
 * The executor MUST NOT re-resolve element identity by selector or index
 * (the predecessor's bug). The PerceptionFrame is the single source of
 * truth for what's addressable this turn; if the model picks a stale
 * node, we surface `unknown_target` cleanly.
 */
export async function execute(
  frame: PerceptionFrame,
  action: Action,
  driver: BrowserDriver,
): Promise<ActionResult> {
  switch (action.type) {
    case "click": {
      const node = frame.interactive.find((n) => n.backendNodeId === action.targetNodeId);
      if (!node) {
        return { ok: false, error: "unknown_target", summary: `node ${action.targetNodeId} not in current frame` };
      }
      if (node.disabled) {
        return { ok: false, error: "disabled", summary: `${node.role} '${node.name}' is disabled` };
      }
      try {
        await driver.click(node.backendNodeId);
        return { ok: true, summary: `clicked ${node.role} '${node.name}'` };
      } catch (e) {
        return errToResult(e, `click ${node.role} '${node.name}'`);
      }
    }

    case "type": {
      const node = frame.interactive.find((n) => n.backendNodeId === action.targetNodeId);
      if (!node) {
        return { ok: false, error: "unknown_target", summary: `node ${action.targetNodeId} not in current frame` };
      }
      if (node.disabled) {
        return { ok: false, error: "disabled", summary: `${node.role} '${node.name}' is disabled` };
      }
      try {
        await driver.type(node.backendNodeId, action.value);
        if (action.submit) {
          // Best-effort submit: click any nearby button or just Enter via Input.
          // Defer Enter dispatch to the driver via evaluate for now.
          await driver
            .evaluate(`(() => { const el = document.activeElement; if (el && el.form) el.form.requestSubmit?.(); })()`)
            .catch(() => {/* */});
        }
        return { ok: true, summary: `typed ${JSON.stringify(action.value)} into ${node.role} '${node.name}'` };
      } catch (e) {
        return errToResult(e, `type into ${node.role} '${node.name}'`);
      }
    }

    case "scroll": {
      try {
        await driver.scroll(action.direction, action.amount);
        return { ok: true, summary: `scrolled ${action.direction} ${action.amount}px` };
      } catch (e) {
        return errToResult(e, `scroll ${action.direction}`);
      }
    }

    case "goto": {
      try {
        await driver.navigate(action.url);
        return { ok: true, summary: `navigated to ${action.url}` };
      } catch (e) {
        return errToResult(e, `goto ${action.url}`);
      }
    }

    case "wait_for": {
      try {
        if (action.ms !== undefined) {
          await new Promise((r) => setTimeout(r, action.ms));
          return { ok: true, summary: `waited ${action.ms}ms` };
        }
        if (action.textContains) {
          // Poll the visible text walk for up to 5s.
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            const text = await driver.getVisibleText();
            if (text.some((t) => t.text.includes(action.textContains!))) {
              return { ok: true, summary: `waited until "${action.textContains}" appeared` };
            }
            await new Promise((r) => setTimeout(r, 200));
          }
          return { ok: false, error: "timeout", summary: `"${action.textContains}" did not appear within 5s` };
        }
        return { ok: true, summary: "wait_for: noop (no ms or textContains)" };
      } catch (e) {
        return errToResult(e, `wait_for`);
      }
    }

    case "done": {
      return { ok: true, terminal: true, summary: action.result };
    }
  }
}

function errToResult(e: unknown, context: string): ActionResult {
  if (e instanceof DriverError) {
    const code = e.code === "disabled" ? "disabled" : e.code === "unknown_target" ? "unknown_target" : "internal";
    return { ok: false, error: code, summary: `${context} → DriverError(${e.code}): ${e.message}` };
  }
  const msg = (e as Error)?.message ?? String(e);
  if (/timeout/i.test(msg)) {
    return { ok: false, error: "timeout", summary: `${context} → ${msg}` };
  }
  return { ok: false, error: "internal", summary: `${context} → ${msg}` };
}
