import type { BrowserDriver } from "../driver.js";
import type { PerceptionFrame } from "../perception/types.js";

// Names matched (case-insensitive) on button/link AxNodes. Order matters —
// most specific first. We deliberately keep this short; over-matching
// "Continue" risks dismissing actual form buttons.
const CONSENT_NAME_PATTERNS: RegExp[] = [
  /^(accept all|allow all|agree to all)\b/i,
  /^(accept cookies?|agree( to)? cookies?)\b/i,
  /^(accept|agree|allow|i agree|i understand|got it)\s*[!.]?\s*$/i,
  /^(only necessary|reject all|decline)$/i, // some users prefer reject
];

const CONSENT_NEAR_REGEX = /cookie|consent|gdpr|privacy/i;

export interface ConsentResult {
  dismissed: boolean;
  reason: string;
}

/**
 * Per-origin one-shot consent dismissal. Mutates `dismissedOrigins`.
 *
 * Heuristic: scan ax for a button/link whose name matches one of the
 * accept patterns. Prefer matches whose containing landmark mentions
 * cookie/consent/gdpr/privacy if such landmark info is available.
 *
 * Cheap to call: zero LLM cost, single CDP click on the matched node.
 */
export async function maybeDismissConsent(
  driver: BrowserDriver,
  frame: PerceptionFrame,
  dismissedOrigins: Set<string>,
): Promise<ConsentResult> {
  const origin = safeOrigin(frame.meta.url);
  if (!origin || dismissedOrigins.has(origin)) {
    return { dismissed: false, reason: "already-handled" };
  }

  // Quick check: is there ANYTHING that looks consent-shaped on the page?
  // Skip the full scan if there's no cookie/consent text anywhere.
  const haystack = (frame.meta.title + " " + frame.text.map((t) => t.text).join(" ")).slice(0, 4000);
  if (!CONSENT_NEAR_REGEX.test(haystack) && !frame.interactive.some((n) => CONSENT_NEAR_REGEX.test(n.name))) {
    dismissedOrigins.add(origin);
    return { dismissed: false, reason: "no-consent-detected" };
  }

  for (const pattern of CONSENT_NAME_PATTERNS) {
    const match = frame.interactive.find(
      (n) => (n.role === "button" || n.role === "link") && pattern.test(n.name) && !n.disabled,
    );
    if (match) {
      try {
        await driver.click(match.backendNodeId);
        await driver.waitForReady({ timeoutMs: 2000, stableMs: 200 }).catch(() => {});
        dismissedOrigins.add(origin);
        return { dismissed: true, reason: `clicked '${match.name}'` };
      } catch (e) {
        return { dismissed: false, reason: `click-failed: ${(e as Error).message}` };
      }
    }
  }

  // No match — assume there's no banner, mark origin handled.
  dismissedOrigins.add(origin);
  return { dismissed: false, reason: "no-pattern-match" };
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
