import 'server-only';

/**
 * Thin client for FredDB (https://db.fredyang.com/robot).
 *
 * The store is a plain key/value map: values are raw text and there is no TTL,
 * so callers serialise their own envelope and carry their own expiry.
 *
 * Every call is bounded by a short timeout. Nothing here retries — a cache is
 * only worth having while it is faster than the source of truth.
 */

const TIMEOUT_MS = 200;
const DEFAULT_BASE_URL = 'https://db.fredyang.com';

/**
 * Read env vars at call time, never at module scope. Module-scope capture
 * freezes whatever happened to be loaded when the module was first imported,
 * which hides later changes from both the runtime and the tests.
 */
function config() {
  return {
    apiKey: process.env.FREDB_API_KEY ?? '',
    baseUrl: process.env.FREDB_BASE_URL || DEFAULT_BASE_URL,
  };
}

/** Keys look like `posting:list:open`, so they must be encoded into the path. */
function keyUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/key/${encodeURIComponent(key)}`;
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Returns null for any miss (including a 404). Throws if the store is unreachable. */
export async function fredbGet(key: string): Promise<string | null> {
  const { apiKey, baseUrl } = config();
  return withTimeout(async (signal) => {
    const res = await fetch(keyUrl(baseUrl, key), {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey },
      cache: 'no-store',
      signal,
    });
    if (!res.ok) return null;
    return res.text();
  });
}

export async function fredbPut(key: string, value: string): Promise<void> {
  const { apiKey, baseUrl } = config();
  await withTimeout(async (signal) => {
    const res = await fetch(keyUrl(baseUrl, key), {
      method: 'PUT',
      headers: { 'X-Api-Key': apiKey },
      body: value,
      cache: 'no-store',
      signal,
    });
    if (!res.ok) throw new Error(`FredDB PUT failed with ${res.status}`);
  });
}

export async function fredbDelete(key: string): Promise<void> {
  const { apiKey, baseUrl } = config();
  await withTimeout(async (signal) => {
    const res = await fetch(keyUrl(baseUrl, key), {
      method: 'DELETE',
      headers: { 'X-Api-Key': apiKey },
      cache: 'no-store',
      signal,
    });
    if (!res.ok) throw new Error(`FredDB DELETE failed with ${res.status}`);
  });
}
