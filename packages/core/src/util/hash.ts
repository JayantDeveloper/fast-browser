/**
 * Deterministic non-cryptographic hash. Works in Node, browsers, and
 * service workers without requiring node:crypto or Web Crypto. Used for
 * snapshot fingerprints and selector cache keys — both need stability,
 * not security.
 *
 * Output is a 16-character lowercase hex string (FNV-1a 64-bit, computed
 * as two 32-bit halves and concatenated).
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * 32-bit FNV-1a. Returns an unsigned int.
 */
function fnv1a32(input: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // Math.imul + (hash >>> 0) keeps us in unsigned 32-bit territory.
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Returns a 16-char hex digest. Stable across runtimes.
 */
export function stableHash(input: string): string {
  const a = fnv1a32(input, FNV_OFFSET_BASIS);
  // Use a different seed so the two halves are independent — reduces
  // accidental collisions on similar inputs.
  const b = fnv1a32(input, a ^ 0xdeadbeef);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * Convenience: hash returning the first N hex chars.
 */
export function shortHash(input: string, length = 12): string {
  return stableHash(input).slice(0, length);
}
