import { safeParseJson } from "../safe-parse.js";
import { type AskJsonOpts, type AskJsonResult, LlmError, type Provider } from "../types.js";

export interface GeminiProviderOpts {
  apiKey: string;
  /** Default: gemini-2.5-flash-lite (cheapest fast actor). */
  model?: string;
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  error?: { code: number; message: string; status: string };
}

// Pricing per 1M tokens for cost estimation (May 2026, GA tier).
const PRICING_USD_PER_M: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
};

export class GeminiProvider implements Provider {
  readonly name = "gemini";
  readonly model: string;
  private readonly apiKey: string;

  constructor(opts: GeminiProviderOpts) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? "gemini-2.5-flash-lite";
  }

  async askJson<T>(opts: AskJsonOpts): Promise<AskJsonResult<T>> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: "user", parts: [{ text: opts.user }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.1,
        maxOutputTokens: opts.maxTokens ?? 512,
        responseMimeType: "application/json",
        ...(opts.schema ? { responseSchema: stripJsonSchemaTitles(opts.schema) } : {}),
      },
    };

    const t0 = Date.now();
    let resp: Response;
    let attempts = 0;
    while (true) {
      attempts++;
      resp = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }, opts.timeoutMs ?? 60_000);
      if (resp.status !== 429 || attempts >= 2) break;
      // Honor retry hint if present, else back off 15s.
      const text = await resp.clone().text().catch(() => "");
      const m = text.match(/retry in ([\d.]+)s/i);
      const sleepMs = m?.[1] ? Math.min(30_000, Math.ceil(Number(m[1]) * 1000) + 500) : 15_000;
      await new Promise((r) => setTimeout(r, sleepMs));
    }
    const latencyMs = Date.now() - t0;

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new LlmError(
        resp.status === 401 || resp.status === 403 ? "auth" : resp.status === 429 ? "rate_limited" : "server",
        `gemini ${resp.status}: ${text.slice(0, 500)}`,
      );
    }
    const json = (await resp.json()) as GenerateContentResponse;
    if (json.error) {
      throw new LlmError("server", `gemini error: ${json.error.message}`);
    }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const parsed = safeParseJson<T>(text);
    if (!parsed.ok) {
      throw new LlmError("parse_failed", `gemini returned non-JSON: ${text.slice(0, 200)}`);
    }
    const inputTokens = json.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = json.usageMetadata?.candidatesTokenCount ?? 0;
    const pricing = PRICING_USD_PER_M[this.model];
    const usage = {
      inputTokens,
      outputTokens,
      ...(pricing
        ? { costUsd: (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000 }
        : {}),
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
      throw new LlmError("timeout", `gemini request timed out after ${timeoutMs}ms`);
    }
    throw new LlmError("transport", (e as Error).message);
  } finally {
    clearTimeout(t);
  }
}

// Gemini's responseSchema doesn't accept JSON Schema "title" or "$schema" keys.
function stripJsonSchemaTitles(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripJsonSchemaTitles);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (k === "title" || k === "$schema" || k === "additionalProperties") continue;
      out[k] = stripJsonSchemaTitles(v);
    }
    return out;
  }
  return schema;
}
