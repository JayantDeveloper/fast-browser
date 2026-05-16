/**
 * Defensive JSON parser. The model occasionally wraps its JSON in ```
 * fences or appends stray prose; this peels those layers before failing.
 *
 * Returns `{ ok: true, data }` on success or `{ ok: false }` on failure
 * — no throws.
 */
export function safeParseJson<T = unknown>(raw: string): { ok: true; data: T; repaired: boolean } | { ok: false } {
  if (!raw) return { ok: false };
  let s = raw.trim();
  let repaired = false;

  // Strip ```json ... ``` or ``` ... ```
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  if (fence?.[1]) {
    s = fence[1].trim();
    repaired = true;
  }

  // Direct parse
  try {
    return { ok: true, data: JSON.parse(s) as T, repaired };
  } catch {
    /* fall through */
  }

  // Try the substring between the first '{' and last '}' (handles trailing prose).
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return { ok: true, data: JSON.parse(s.slice(start, end + 1)) as T, repaired: true };
    } catch {
      /* */
    }
  }

  // Same for arrays.
  const aStart = s.indexOf("[");
  const aEnd = s.lastIndexOf("]");
  if (aStart !== -1 && aEnd > aStart) {
    try {
      return { ok: true, data: JSON.parse(s.slice(aStart, aEnd + 1)) as T, repaired: true };
    } catch {
      /* */
    }
  }

  return { ok: false };
}
