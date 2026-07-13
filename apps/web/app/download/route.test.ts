import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const RELEASES_URL = 'https://github.com/shipshitdev/shipcode/releases';
const DL_PREFIX = 'https://github.com/shipshitdev/shipcode/releases/download/v0.2.0';

function req(opts: { url?: string; ua?: string; platform?: string } = {}): Request {
  const headers = new Headers();
  if (opts.ua) headers.set('user-agent', opts.ua);
  if (opts.platform) headers.set('sec-ch-ua-platform', `"${opts.platform}"`);
  return new Request(opts.url ?? 'https://shipcode.shipshit.dev/download', { headers });
}

function mockLatestRelease(assets: Array<{ name: string; browser_download_url: string }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ assets }), { status: 200 })),
  );
}

const BOTH_DMGS = [
  { name: 'ShipCode-0.2.0-arm64.dmg', browser_download_url: `${DL_PREFIX}/ShipCode-0.2.0-arm64.dmg` },
  { name: 'ShipCode-0.2.0-x64.dmg', browser_download_url: `${DL_PREFIX}/ShipCode-0.2.0-x64.dmg` },
  { name: 'ShipCode-0.2.0-arm64.zip', browser_download_url: `${DL_PREFIX}/ShipCode-0.2.0-arm64.zip` },
];

const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

describe('GET /download', () => {
  beforeEach(() => mockLatestRelease(BOTH_DMGS));
  afterEach(() => vi.unstubAllGlobals());

  it('redirects non-Mac clients to the releases page (no API call needed)', async () => {
    const res = await GET(req({ ua: WIN_UA }));
    expect(res.status).toBe(307);
    expect(res.headers.get('Location')).toBe(RELEASES_URL);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('respects the Sec-CH-UA-Platform header over the UA for non-Mac', async () => {
    const res = await GET(req({ ua: MAC_UA, platform: 'Windows' }));
    expect(res.headers.get('Location')).toBe(RELEASES_URL);
  });

  it('serves the arm64 DMG by default for Mac', async () => {
    const res = await GET(req({ ua: MAC_UA }));
    expect(res.status).toBe(307);
    expect(res.headers.get('Location')).toBe(`${DL_PREFIX}/ShipCode-0.2.0-arm64.dmg`);
  });

  it('serves the x64 DMG when ?arch=x64', async () => {
    const res = await GET(req({ ua: MAC_UA, url: 'https://x/download?arch=x64' }));
    expect(res.headers.get('Location')).toBe(`${DL_PREFIX}/ShipCode-0.2.0-x64.dmg`);
  });

  it('accepts the intel alias for x64', async () => {
    const res = await GET(req({ ua: MAC_UA, url: 'https://x/download?arch=intel' }));
    expect(res.headers.get('Location')).toBe(`${DL_PREFIX}/ShipCode-0.2.0-x64.dmg`);
  });

  it('treats an unknown platform as Mac (site ships a macOS app)', async () => {
    const res = await GET(req({ ua: 'curl/8.0' }));
    expect(res.headers.get('Location')).toBe(`${DL_PREFIX}/ShipCode-0.2.0-arm64.dmg`);
  });

  it('falls back to releases when the GitHub API errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502 })));
    const res = await GET(req({ ua: MAC_UA }));
    expect(res.headers.get('Location')).toBe(RELEASES_URL);
  });

  it('falls back to releases when no matching DMG asset exists', async () => {
    mockLatestRelease([
      { name: 'ShipCode-0.2.0-x64.dmg', browser_download_url: `${DL_PREFIX}/ShipCode-0.2.0-x64.dmg` },
    ]);
    const res = await GET(req({ ua: MAC_UA })); // wants arm64, only x64 present
    expect(res.headers.get('Location')).toBe(RELEASES_URL);
  });

  it('rejects a download URL that is not a github releases asset', async () => {
    mockLatestRelease([
      { name: 'ShipCode-0.2.0-arm64.dmg', browser_download_url: 'https://evil.example/x.dmg' },
    ]);
    const res = await GET(req({ ua: MAC_UA }));
    expect(res.headers.get('Location')).toBe(RELEASES_URL);
  });

  it('falls back to releases when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    const res = await GET(req({ ua: MAC_UA }));
    expect(res.headers.get('Location')).toBe(RELEASES_URL);
  });

  it('marks the redirect uncacheable and varies on platform', async () => {
    const res = await GET(req({ ua: MAC_UA }));
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(res.headers.get('Vary')).toContain('Sec-CH-UA-Platform');
  });
});
