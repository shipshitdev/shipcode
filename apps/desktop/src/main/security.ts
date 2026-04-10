/**
 * Validates a URL before it's passed to Electron's `shell.openExternal`.
 *
 * Defense-in-depth checks (ALL must pass):
 *   1. String type + length <= 2048 characters
 *   2. Parses as a WHATWG URL
 *   3. Protocol is `https:` only
 *   4. No userinfo (username/password in the URL)
 *   5. Hostname (lowercased) is `github.com` or a `*.github.com` subdomain
 *
 * On success, returns the WHATWG-normalized `href` so the caller never passes
 * the raw (potentially denormalized) user-supplied string downstream.
 */

export type UrlValidation = { ok: true; href: string } | { ok: false; reason: string };

const MAX_LENGTH = 2048;

export function isSafeExternalUrl(url: unknown): UrlValidation {
  if (typeof url !== 'string') return { ok: false, reason: 'not-string' };
  if (url.length > MAX_LENGTH) return { ok: false, reason: 'length-exceeded' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }

  if (parsed.protocol !== 'https:') return { ok: false, reason: 'not-https' };
  if (parsed.username || parsed.password) return { ok: false, reason: 'userinfo-not-allowed' };

  const host = parsed.hostname.toLowerCase();
  if (host !== 'github.com' && !host.endsWith('.github.com')) {
    return { ok: false, reason: 'host-not-allowed' };
  }

  return { ok: true, href: parsed.href };
}
