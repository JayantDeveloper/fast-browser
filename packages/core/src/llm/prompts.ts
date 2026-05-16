import type { Action } from "../actions/vocabulary.js";

/**
 * The action JSON schema. Providers that support grammar-constrained
 * decoding (Gemini, OpenAI structured outputs) will use this directly;
 * others rely on it being in the prompt + safe-parse fallback.
 *
 * Note the discriminated union encoding: a single `oneOf` with each
 * variant fully-specified. Some providers (Gemini) reject discriminator
 * patterns; we keep this conservative so the same schema works everywhere.
 */
export const ACTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  description: "A single browser action to execute this turn.",
  properties: {
    type: {
      type: "string",
      enum: ["click", "type", "scroll", "goto", "wait_for", "done"],
    },
    targetNodeId: { type: "integer", description: "backendNodeId from the current frame. Required for click/type." },
    value: { type: "string", description: "Text to type. Required for type." },
    submit: { type: "boolean", description: "If true, requestSubmit the form after typing." },
    direction: { type: "string", enum: ["up", "down", "left", "right"], description: "Required for scroll." },
    amount: { type: "integer", description: "CSS pixels. Required for scroll." },
    url: { type: "string", description: "Required for goto." },
    ms: { type: "integer", description: "Wait duration (wait_for variant)." },
    textContains: { type: "string", description: "Wait until this substring appears in visible text (wait_for variant)." },
    result: { type: "string", description: "Required for done — the answer/result the agent reports." },
  },
  required: ["type"],
};

export const SYSTEM_PROMPT = `You drive a web browser to complete a user task.

Each turn you receive the current page state — interactive elements
(addressable by their backendNodeId) and the visible text (read-only
context). You emit ONE JSON action describing the next step.

Action shape (one of):
  {"type":"click","targetNodeId":<int>}
  {"type":"type","targetNodeId":<int>,"value":"<text>","submit":<bool optional>}
  {"type":"scroll","direction":"down","amount":600}
  {"type":"goto","url":"https://..."}
  {"type":"wait_for","ms":1000}
  {"type":"wait_for","textContains":"Score:"}
  {"type":"done","result":"<what you accomplished + any info the task asked you to report>"}

DECISION ALGORITHM (run every turn, in order):
1. Read the TASK. Compare to CURRENT URL, RECENT ACTIONS, and VISIBLE TEXT.
   If the task is fully achieved — including any answer the task asked
   you to *report* — emit "done" NOW with that answer in result. Do not
   continue clicking after the answer is visible.
2. If not done, pick the SINGLE most-progress next action.
   - **targetNodeId MUST be a number that appears AFTER "node=" in the
     CURRENT INTERACTIVE ELEMENTS list.** Numbers from history, memory,
     or "what feels right" are forbidden. If the element you want isn't
     in the current list, emit "scroll" or pick a different element —
     do NOT invent a node number.
   - Read the visible text — questions, instructions, and answer choices
     often appear there, not just in the interactive list.
3. If the same action just failed with "unknown_target", DO NOT repeat
   it with the same number. Pick a different element from the current
   frame, or scroll, or emit done with what you have.
4. Multi-step workflows (forms, quizzes): after submitting an answer,
   look for a "Next", "Continue", or "Submit" button before evaluating
   the next state.

Output ONE JSON object. No prose, no markdown fences. Just the JSON.`;

/**
 * Render the per-step user prompt. Cache-friendly order: fixed task and
 * history first (cacheable prefix), then mutable URL and frame (suffix).
 */
export function buildUserPrompt(parts: {
  task: string;
  historySerialized: string;
  frameSerialized: string;
  notice?: string;
}): string {
  const { task, historySerialized, frameSerialized, notice } = parts;
  return [
    `## Task`,
    task,
    "",
    `## Recent actions`,
    historySerialized || "(none yet)",
    "",
    `## Current page`,
    frameSerialized,
    notice ? `\n## Notice\n${notice}` : "",
    "",
    `Emit your single JSON action now.`,
  ].join("\n");
}

/**
 * Render an Action back to the JSON form the model produces. Used for
 * embedding into history.
 */
export function actionToJson(action: Action): string {
  return JSON.stringify(action);
}
