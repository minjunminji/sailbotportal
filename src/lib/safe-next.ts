export const DEFAULT_SIGNED_IN_PATH = '/admin';

/** Space, every C0 control character, and DEL. */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Reduces an untrusted `?next=` parameter to a same-origin path.
 *
 * Without this, anyone can mail a lead a link to our real login page that
 * hands their freshly-authenticated browser to an attacker's site the moment
 * they sign in. Anything that is not plainly a relative path falls back to the
 * default destination.
 */
export function safeNextPath(
  next: string | string[] | null | undefined,
  fallback: string = DEFAULT_SIGNED_IN_PATH,
): string {
  if (typeof next !== 'string' || next.length === 0) return fallback;

  // Whitespace and control characters are stripped or normalised by the
  // browser, so a smuggled scheme must never survive this check.
  if (hasControlCharacter(next)) return fallback;

  // Must be an absolute path on this origin. Both `//evil.example` and
  // `/\evil.example` are protocol-relative URLs once a browser parses them.
  if (!next.startsWith('/')) return fallback;
  if (next.startsWith('//') || next.startsWith('/\\')) return fallback;

  return next;
}
