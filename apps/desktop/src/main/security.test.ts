import { describe, expect, it } from 'vitest';
import { isSafeExternalUrl } from './security';

describe('isSafeExternalUrl', () => {
  it('accepts a plain https github.com issue URL', () => {
    const result = isSafeExternalUrl('https://github.com/foo/bar/issues/42');
    expect(result).toEqual({ ok: true, href: 'https://github.com/foo/bar/issues/42' });
  });

  it('rejects non-github hosts', () => {
    const result = isSafeExternalUrl('https://example.com/path');
    expect(result).toEqual({ ok: false, reason: 'host-not-allowed' });
  });

  it('rejects http (requires https)', () => {
    const result = isSafeExternalUrl('http://github.com/foo/bar');
    expect(result).toEqual({ ok: false, reason: 'not-https' });
  });

  it('rejects URLs containing userinfo (user:pass@host)', () => {
    const result = isSafeExternalUrl('https://user:pass@github.com/foo/bar');
    expect(result).toEqual({ ok: false, reason: 'userinfo-not-allowed' });
  });

  it('accepts uppercase github host and returns a normalized href', () => {
    const result = isSafeExternalUrl('https://GITHUB.COM/foo/bar/issues/1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // WHATWG URL normalizes the host to lowercase
      expect(result.href).toBe('https://github.com/foo/bar/issues/1');
    }
  });

  it('rejects URLs longer than 2048 characters', () => {
    const long = 'https://github.com/foo/bar?q=' + 'a'.repeat(3000);
    const result = isSafeExternalUrl(long);
    expect(result).toEqual({ ok: false, reason: 'length-exceeded' });
  });

  it('accepts gist.github.com as a valid *.github.com subdomain', () => {
    const result = isSafeExternalUrl('https://gist.github.com/owner/abc123');
    expect(result.ok).toBe(true);
  });

  it('rejects non-string inputs', () => {
    expect(isSafeExternalUrl(null)).toEqual({ ok: false, reason: 'not-string' });
    expect(isSafeExternalUrl(undefined)).toEqual({ ok: false, reason: 'not-string' });
    expect(isSafeExternalUrl(42 as unknown)).toEqual({ ok: false, reason: 'not-string' });
  });

  it('rejects malformed URLs', () => {
    expect(isSafeExternalUrl('not a url')).toEqual({ ok: false, reason: 'invalid-url' });
  });
});
