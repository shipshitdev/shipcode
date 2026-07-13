import { describe, expect, it, vi } from 'vitest';
import {
  type Arch,
  pickDmgUrl,
  RELEASES_URL,
  resolveArch,
  resolveLatestDmgUrl,
  startDownload,
} from './download-logic';

const DL_PREFIX = 'https://github.com/shipshitdev/shipcode/releases/download/v0.2.0';
const ARM = `${DL_PREFIX}/ShipCode-0.2.0-arm64.dmg`;
const X64 = `${DL_PREFIX}/ShipCode-0.2.0-x64.dmg`;

const RELEASE = {
  assets: [
    { name: 'ShipCode-0.2.0-arm64.dmg', browser_download_url: ARM },
    { name: 'ShipCode-0.2.0-x64.dmg', browser_download_url: X64 },
    { name: 'ShipCode-0.2.0-arm64.zip', browser_download_url: `${DL_PREFIX}/ShipCode-0.2.0-arm64.zip` },
  ],
};

function jsonResponse(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 502 });
}

describe('resolveArch', () => {
  it('defaults to arm64 with no query', () => {
    expect(resolveArch('')).toBe('arm64');
  });
  it.each(['?arch=x64', '?arch=intel', '?arch=x86_64', '?arch=X64'])(
    'maps %s to x64',
    (q) => expect(resolveArch(q)).toBe('x64'),
  );
  it('falls back to arm64 for an unknown arch', () => {
    expect(resolveArch('?arch=sparc')).toBe('arm64');
  });
});

describe('pickDmgUrl', () => {
  it('returns the arch-matched DMG url', () => {
    expect(pickDmgUrl(RELEASE, 'arm64')).toBe(ARM);
    expect(pickDmgUrl(RELEASE, 'x64')).toBe(X64);
  });
  it('returns null when the arch DMG is absent', () => {
    expect(pickDmgUrl({ assets: [RELEASE.assets[1]] }, 'arm64')).toBeNull();
  });
  it('returns null for a non-releases-download url (tamper guard)', () => {
    const bad = { assets: [{ name: 'ShipCode-0.2.0-arm64.dmg', browser_download_url: 'https://evil/x.dmg' }] };
    expect(pickDmgUrl(bad, 'arm64')).toBeNull();
  });
  it('returns null when assets is missing entirely', () => {
    expect(pickDmgUrl({}, 'arm64')).toBeNull();
  });
});

describe('resolveLatestDmgUrl', () => {
  it('resolves the arch DMG on a successful fetch', async () => {
    const f = vi.fn(async () => jsonResponse(RELEASE));
    await expect(resolveLatestDmgUrl('arm64', f as unknown as typeof fetch)).resolves.toBe(ARM);
    await expect(resolveLatestDmgUrl('x64', f as unknown as typeof fetch)).resolves.toBe(X64);
  });
  it('falls back to the releases page on a non-2xx response', async () => {
    const f = vi.fn(async () => jsonResponse({}, false));
    await expect(resolveLatestDmgUrl('arm64', f as unknown as typeof fetch)).resolves.toBe(RELEASES_URL);
  });
  it('falls back to the releases page when the DMG asset is missing', async () => {
    const f = vi.fn(async () => jsonResponse({ assets: [] }));
    await expect(resolveLatestDmgUrl('arm64', f as unknown as typeof fetch)).resolves.toBe(RELEASES_URL);
  });
  it('falls back to the releases page when fetch throws', async () => {
    const f = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(resolveLatestDmgUrl('arm64' as Arch, f as unknown as typeof fetch)).resolves.toBe(
      RELEASES_URL,
    );
  });
});

describe('startDownload', () => {
  it('navigates to the resolved DMG and reports it for the manual link', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(RELEASE)) as unknown as typeof fetch;
    const navigate = vi.fn();
    const onResolved = vi.fn();
    await startDownload('?arch=x64', { fetchImpl, navigate, onResolved });
    expect(onResolved).toHaveBeenCalledWith(X64);
    expect(navigate).toHaveBeenCalledWith(X64);
  });

  it('navigates to the releases page on failure', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false)) as unknown as typeof fetch;
    const navigate = vi.fn();
    await startDownload('', { fetchImpl, navigate });
    expect(navigate).toHaveBeenCalledWith(RELEASES_URL);
  });
});
