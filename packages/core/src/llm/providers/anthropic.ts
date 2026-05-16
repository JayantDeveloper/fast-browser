import { safeParseJson } from "../safe-parse.js";
import { type AskJsonOpts, type AskJsonResult, LlmError, type Provider } from "../types.js";

export interface AnthropicProviderOpts {
  apiKey: string;
  /** Default: claude-haiku-4-5 (fast, schema-compliant tool use). */
  model?: string;
}

interface MessagesResponse {
  id?: string;
  content?: Array<{ type: string; text?: string; input?: unknown }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
  error?: { type: string; message: string };
}

const PRICING_USD_PER_M: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
};

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly apiKey: string;

  constructor(opts: AnthropicProviderOpts) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? "claude-haiku-4-5";
  }

  async askJson<T>(opts: AskJsonOpts): Promise<AskJsonResult<T>> {
    // Use a tool-use call to force structured output. Claude returns JSON in
    // the tool input rather than message text — far more reliable than asking
    // for JSON in the prompt.
    const tool = {
      name: "emit_action",
      description: "Emit the single browser action for this turn.",
      input_schema: opts.schema ?? {
        type: "object",
        properties: { type: { type: "string" } },
        required: ["type"],
      },
    };
    const body = {
      model: this.model,
      max_tokens: opts.maxTokens ?? 512,
      temperature: opts.temperature ?? 0.1,
      system: opts.cacheableSystem
        ? [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }]
        : opts.system,
      messages: [{ role: "user" as const, content: opts.user }],
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_action" } as const,
    };

    const t0 = Date.now();
    let resp: Response;
    let attempts = 0;
    while (true) {
      attempts++;
      resp = await fetchWithTimeout(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
        opts.timeoutMs ?? 60_000,
      );
      if (resp.status !== 429 || attempts >= 2) break;
      const text = await resp.clone().text().catch(() => "");
      const m = text.match(/retry.*?(\d+).*?(?:s|seconds)/i);
      const sleepMs = m?.[1] ? Math.min(30_000, Number(m[1]) * 1000 + 500) : 5_000;
      await new Promise((r) => setTimeout(r, sleepMs));
    }
    const latencyMs = Date.now() - t0;

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new LlmError(
        resp.status === 401 || resp.status === 403 ? "auth" : resp.status === 429 ? "rate_limited" : "server",
        `anthropic ${resp.status}: ${text.slice(0, 500)}`,
      );
    }
    const json = (await resp.json()) as MessagesResponse;
    if (json.error) {
      throw new LlmError("server", `anthropic error: ${json.error.message}`);
    }

    const toolUse = json.content?.find((c) => c.type === "tool_use");
    let data: T;
    let repaired = false;
    if (toolUse?.input !== undefined) {
      data = toolUse.input as T;
    } else {
      const text = json.content?.find((c) => c.type === "text")?.text ?? "";
      const parsed = safeParseJson<T>(text);
      if (!parsed.ok) throw new LlmError("parse_failed", `anthropic returned no tool_use and non-JSON text: ${text.slice(0, 200)}`);
      data = parsed.data;
      repaired = parsed.repaired;
    }

    const inputTokens = json.usage?.input_tokens ?? 0;
    const outputTokens = json.usage?.output_tokens ?? 0;
    const pricing = PRICING_USD_PER_M[this.model];
    const usage = {
      inputTokens,
      outputTokens,
      ...(pricing
        ? { costUsd: (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000 }
        : {}),
    };
    const result: AskJsonResult<T> = { data, usage, latencyMs };
    if (repaired) result.repaired = true;
    return result;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new LlmError("timeout", `anthropic request timed out after ${timeoutMs}ms`);
    }
    throw new LlmError("transport", (e as Error).message);
  } finally {
    clearTimeout(t);
  }
}
