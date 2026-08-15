/**
 * @jest-environment node
 */
import { cached, invalidate, cacheKeys, __resetBreaker } from '@/lib/cache';

const originalFetch = global.fetch;
const originalApiKey = process.env.FREDB_API_KEY;
const originalBaseUrl = process.env.FREDB_BASE_URL;

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/** A stored value the cache should accept as fresh. */
function envelope(data: unknown, ttlMs = 60_000) {
  return JSON.stringify({ data, expiresAt: Date.now() + ttlMs });
}

beforeEach(() => {
  __resetBreaker();
  jest.useFakeTimers();
  // `.env.local` ships a blank FREDB_API_KEY: the service is unavailable and
  // its provisioning endpoint 404s. `cached()` no-ops without a key, so every
  // fetch mock below would go unused. Give the tests a dummy key instead.
  process.env.FREDB_API_KEY = 'test-key';
  process.env.FREDB_BASE_URL = 'https://db.fredyang.com';
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
  restoreEnv('FREDB_API_KEY', originalApiKey);
  restoreEnv('FREDB_BASE_URL', originalBaseUrl);
});

describe('cached', () => {
  it('returns the fallback value on a cache miss', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as never;
    const result = await cached('k', 60, async () => 'from-db');
    expect(result).toBe('from-db');
  });

  it('returns the cached value on a hit without calling the fallback', async () => {
    const stored = JSON.stringify({ data: 'from-cache', expiresAt: Date.now() + 60_000 });
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => stored });
    global.fetch = fetchMock as never;

    const fallback = jest.fn();
    const result = await cached('k', 60, fallback);

    expect(result).toBe('from-cache');
    expect(fallback).not.toHaveBeenCalled();
    // The value can only have come from the cache read.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats an expired value as a miss', async () => {
    const stored = JSON.stringify({ data: 'stale', expiresAt: Date.now() - 1 });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => stored }) as never;

    const result = await cached('k', 60, async () => 'fresh');
    expect(result).toBe('fresh');
  });

  it('falls through when the cache throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never;
    const result = await cached('k', 60, async () => 'from-db');
    expect(result).toBe('from-db');
  });

  it('falls through when the cache exceeds the timeout', async () => {
    global.fetch = jest.fn().mockImplementation(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as never;

    const promise = cached('k', 60, async () => 'from-db');
    jest.advanceTimersByTime(250);
    await expect(promise).resolves.toBe('from-db');
  });

  it('stops calling the cache after repeated failures', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('down'));
    global.fetch = fetchMock as never;

    for (let i = 0; i < 5; i++) {
      await cached(`k${i}`, 60, async () => 'from-db');
    }
    const callsAfterTripping = fetchMock.mock.calls.length;

    await cached('k-later', 60, async () => 'from-db');
    expect(fetchMock.mock.calls.length).toBe(callsAfterTripping);
  });

  it('never lets a cache write failure reject the caller', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockRejectedValueOnce(new Error('write failed')) as never;

    await expect(cached('k', 60, async () => 'value')).resolves.toBe('value');
  });

  it('no-ops without ever calling fetch when FREDB_API_KEY is blank', async () => {
    process.env.FREDB_API_KEY = '';
    const fetchMock = jest.fn();
    global.fetch = fetchMock as never;

    await expect(cached('k', 60, async () => 'from-db')).resolves.toBe('from-db');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls through when the cached value is not valid JSON', async () => {
    // FredDB states data may be lost; a truncated write is a realistic outcome.
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, text: async () => '{"data":"trunca' }) as never;

    await expect(cached('k', 60, async () => 'from-db')).resolves.toBe('from-db');
  });

  it('does not count a corrupt value toward the breaker', async () => {
    // A corrupt value is not the service being down: the service answered.
    // Tripping on it would let one poisoned key disable the cache for every key.
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => 'not-json' });
    global.fetch = fetchMock as never;

    for (let i = 0; i < 5; i++) {
      await cached(`k${i}`, 60, async () => 'from-db');
    }
    const callsSoFar = fetchMock.mock.calls.length;

    await cached('k-later', 60, async () => 'from-db');
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsSoFar);
  });

  it('calls the cache again once the breaker cooldown has elapsed', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('down'));
    global.fetch = fetchMock as never;

    for (let i = 0; i < 5; i++) {
      await cached(`k${i}`, 60, async () => 'from-db');
    }
    const callsAfterTripping = fetchMock.mock.calls.length;

    // Still open.
    await cached('during-cooldown', 60, async () => 'from-db');
    expect(fetchMock.mock.calls.length).toBe(callsAfterTripping);

    jest.advanceTimersByTime(60_001);

    await expect(cached('after-cooldown', 60, async () => 'from-db')).resolves.toBe('from-db');
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterTripping);
  });

  it('resets the failure count after a successful read', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('down'));
    global.fetch = fetchMock as never;

    // Four failures: one short of the threshold.
    for (let i = 0; i < 4; i++) {
      await cached(`a${i}`, 60, async () => 'from-db');
    }

    // A hit, which must clear the tally.
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => envelope('from-cache') });
    await expect(cached('good', 60, async () => 'from-db')).resolves.toBe('from-cache');

    // Four more failures. Without the reset that would be eight in a row and
    // the breaker would be open by now.
    fetchMock.mockRejectedValue(new Error('down'));
    for (let i = 0; i < 4; i++) {
      await cached(`b${i}`, 60, async () => 'from-db');
    }
    const callsSoFar = fetchMock.mock.calls.length;

    await cached('still-tries', 60, async () => 'from-db');
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsSoFar);
  });

  it('URL-encodes the key in the request path', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => envelope('hit') });
    global.fetch = fetchMock as never;

    await cached(cacheKeys.openPostings(), 60, async () => 'from-db');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://db.fredyang.com/key/posting%3Alist%3Aopen');
    expect(init.method).toBe('GET');
    expect(init.headers['X-Api-Key']).toBe('test-key');
  });
});

describe('invalidate', () => {
  it('never throws when the cache is down', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down')) as never;
    await expect(invalidate(cacheKeys.posting('software-lead'))).resolves.toBeUndefined();
  });
});
