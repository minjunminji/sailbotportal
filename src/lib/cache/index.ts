import 'server-only';
import { fredbGet, fredbPut, fredbDelete } from './fredb';

const FAILURE_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 60_000;

let consecutiveFailures = 0;
let breakerOpenedAt = 0;

/** Test-only hook. */
export function __resetBreaker() {
  consecutiveFailures = 0;
  breakerOpenedAt = 0;
}

function breakerIsOpen(): boolean {
  if (consecutiveFailures < FAILURE_THRESHOLD) return false;
  if (Date.now() - breakerOpenedAt > BREAKER_COOLDOWN_MS) {
    consecutiveFailures = 0;
    return false;
  }
  return true;
}

function recordFailure() {
  consecutiveFailures += 1;
  if (consecutiveFailures === FAILURE_THRESHOLD) breakerOpenedAt = Date.now();
}

type Envelope<T> = { data: T; expiresAt: number };

/**
 * Unwraps a stored value, returning null for anything that is not a live hit:
 * absent, corrupt, or expired.
 *
 * A corrupt value deliberately does NOT count toward the breaker. The store
 * answered — it just answered with garbage, which FredDB warns is possible.
 * Counting it would let one poisoned key disable the cache for every key, and
 * because the value stays poisoned it would re-trip after every cooldown. The
 * write-behind below overwrites it instead.
 *
 * The hit is boxed so that a legitimately falsy cached value is still a hit.
 */
function readEnvelope<T>(raw: string | null): { data: T } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Envelope<T>;
    if (typeof parsed?.expiresAt !== 'number' || parsed.expiresAt <= Date.now()) return null;
    return { data: parsed.data };
  } catch {
    return null;
  }
}

/**
 * Cache-aside with silent fallback. The cache is never allowed to fail the
 * request: every error path returns the fallback value.
 *
 * Cache PUBLIC data only. Never applications — FredDB states plainly that
 * data may be lost, and applicant records are PII.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fallback: () => Promise<T>,
): Promise<T> {
  if (!process.env.FREDB_API_KEY || breakerIsOpen()) {
    return fallback();
  }

  let raw: string | null;
  try {
    raw = await fredbGet(key);
    consecutiveFailures = 0;
  } catch {
    recordFailure();
    return fallback();
  }

  const hit = readEnvelope<T>(raw);
  if (hit) return hit.data;

  const fresh = await fallback();

  // Write-behind, deliberately not awaited into the response path.
  const envelope: Envelope<T> = { data: fresh, expiresAt: Date.now() + ttlSeconds * 1000 };
  void fredbPut(key, JSON.stringify(envelope)).catch(() => recordFailure());

  return fresh;
}

/** Best-effort invalidation. Never throws. */
export async function invalidate(key: string): Promise<void> {
  if (!process.env.FREDB_API_KEY) return;
  try {
    await fredbDelete(key);
  } catch {
    recordFailure();
  }
}

export const cacheKeys = {
  openPostings: () => 'posting:list:open',
  posting: (slug: string) => `posting:${slug}`,
};
