export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface AskJsonOpts {
  /** System prompt — kept stable across a run for cache-friendliness. */
  system: string;
  /** User prompt — the per-step state. */
  user: string;
  /**
   * JSON Schema describing the expected output shape. Providers that
   * support grammar-constrained decoding will use this; others will
   * include it in the prompt and rely on JSON-mode + safe-parse fallback.
   */
  schema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  /**
   * Hint to enable provider-specific prompt caching markers on the system
   * prompt (Anthropic cache_control, etc). No-op on providers without it.
   */
  cacheableSystem?: boolean;
  /** Optional per-call timeout. Default 60s. */
  timeoutMs?: number;
}

export interface AskJsonResult<T = unknown> {
  data: T;
  usage: Usage;
  /** ms spent waiting on the provider (network + inference). */
  latencyMs: number;
  /** True when JSON had to be repaired (saw markdown fences, trailing prose, etc). */
  repaired?: boolean;
}

export interface Provider {
  /** Display name e.g. "gemini". */
  name: string;
  /** Model identifier e.g. "gemini-2.5-flash-lite". */
  model: string;
  askJson<T>(opts: AskJsonOpts): Promise<AskJsonResult<T>>;
}

export class LlmError extends Error {
  override readonly name = "LlmError";
  constructor(
    public readonly code:
      | "auth"
      | "rate_limited"
      | "parse_failed"
      | "timeout"
      | "transport"
      | "server"
      | "internal",
    message: string,
    public readonly attempts?: number,
  ) {
    super(message);
  }
}
