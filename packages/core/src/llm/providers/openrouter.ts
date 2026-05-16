import { safeParseJson } from "../safe-parse.js";
import { type AskJsonOpts, type AskJsonResult, LlmError, type Provider } from "../types.js";

export interface OpenRouterProviderOpts {
  apiKey: string;
  /** OpenRouter model slug. Default: `openai/gpt-oss-120b:free` (free tier, fast). */
  model?: string;
  /** Optional referrer / app name for OpenRouter analytics. */
  appName?: string;
}

interface ChatCompletionResponse {
  id?: string;
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: { code?: number; message?: string };
}

export class OpenRouterProvider implements Provider {
  readonly name = "openrouter";
  readonly model: string;
  private readonly apiKey: string;
  private readonly appName: string;

  constructor(opts: OpenRouterProviderOpts) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? "openai/gpt-oss-120b:free";
    this.appName = opts.appName ?? "fast-browser";
  }

  async askJson<T>(opts: AskJsonOpts): Promise<AskJsonResult<T>> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      temperature: opts.temperature ?? 0.1,
      max_tokens: opts.maxTokens ?? 512,
      response_format: opts.schema
        ? { type: "json_schema", json_schema: { name: "action", strict: true, schema: opts.schema } }
        : { type: "json_object" },
    };

    const t0 = Date.now();
    const resp = await fetchWithTimeout(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "HTTP-Referer": "https://github.com/jaymaheshwari/fast-browser",
          "X-Title": this.appName,
        },
        body: JSON.stringify(body),
      },
      opts.timeoutMs ?? 60_000,
    );
    const latencyMs = Date.now() - t0;

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new LlmError(
        resp.status === 401 || resp.status === 403 ? "auth" : resp.status === 429 ? "rate_limited" : "server",
        `openrouter ${resp.status}: ${text.slice(0, 500)}`,
      );
    }
    const json = (await resp.json()) as ChatCompletionResponse;
    if (json.error) {
      throw new LlmError("server", `openrouter error: ${json.error.message ?? JSON.stringify(json.error)}`);
    }
    const text = json.choices?.[0]?.message?.content ?? "";
    const parsed = safeParseJson<T>(text);
    if (!parsed.ok) {
      throw new LlmError("parse_failed", `openrouter returned non-JSON: ${text.slice(0, 200)}`);
    }
    const usage = {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    };
    const result: AskJsonResult<T> = { data: parsed.data, usage, latencyMs };
    if (parsed.repaired) result.repaired = true;
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
      throw new LlmError("timeout", `openrouter request timed out after ${timeoutMs}ms`);
    }
    throw new LlmError("transport", (e as Error).message);
  } finally {
    clearTimeout(t);
  }
}
