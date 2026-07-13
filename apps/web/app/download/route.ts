// Smart download redirect: 307s to the correct macOS DMG of the LATEST GitHub
// release, so the site's Download button always serves the current version with
// no hardcoded version and no manual updates. Ported from the landings repo's
// redirectToLatestRelease, extended for ShipCode's two-arch (arm64 + x64) DMGs.
//
// Runs per-request as a serverless function (reads headers, hits the GitHub
// API), so it must never be statically optimized.
export const dynamic = 'force-dynamic';

const RELEASE_REPO = 'shipshitdev/shipcode';
const RELEASES_URL = `https://github.com/${RELEASE_REPO}/releases`;

const NON_MAC_PLATFORM = /Android|CrOS|iPad|iPhone|Linux|Windows/i;
const MAC_PLATFORM = /Macintosh|Mac OS X/i;

type GitHubRelease = {
  assets?: Array<{ browser_download_url?: unknown; name?: unknown }>;
};

function isMacRequest(request: Request): boolean {
  const clientPlatform = request.headers
    .get('sec-ch-ua-platform')
    ?.replaceAll('"', '')
    .trim();

  if (clientPlatform) {
    return clientPlatform.toLowerCase() === 'macos';
  }

  const userAgent = request.headers.get('user-agent') ?? '';
  if (MAC_PLATFORM.test(userAgent)) return true;
  if (NON_MAC_PLATFORM.test(userAgent)) return false;

  // Privacy browsers and CLI clients may omit platform data. The site ships a
  // macOS app, so macOS is the safe default when the platform is unknown.
  return true;
}

// Browsers can't reliably report Apple Silicon vs Intel (Safari sends no arch
// hint; Chrome's Sec-CH-UA-Arch needs an opt-in handshake; Rosetta lies in the
// UA). So default to arm64 — every Mac sold since 2020 — and let the explicit
// `?arch=x64` (aliases: intel) link on the site cover Intel holdouts.
function resolveArch(request: Request): 'arm64' | 'x64' {
  const arch = new URL(request.url).searchParams.get('arch')?.toLowerCase();
  if (arch === 'x64' || arch === 'intel' || arch === 'x86_64') return 'x64';
  return 'arm64';
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 307,
    headers: {
      'Cache-Control': 'private, no-store',
      Location: location,
      Vary: 'Sec-CH-UA-Platform, User-Agent',
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!isMacRequest(request)) return redirect(RELEASES_URL);

  const arch = resolveArch(request);

  try {
    const response = await fetch(
      `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        // Cache the release lookup for 15 min so a burst of downloads doesn't
        // hammer (or get rate-limited by) the unauthenticated GitHub API.
        next: { revalidate: 900 },
      } as RequestInit & { next: { revalidate: number } },
    );

    if (!response.ok) return redirect(RELEASES_URL);

    const release = (await response.json()) as GitHubRelease;
    // Asset names look like ShipCode-<version>-<arch>.dmg — match on the arch
    // suffix so the version is never hardcoded here.
    const assetPattern = new RegExp(`-${arch}\\.dmg$`, 'i');
    const asset = release.assets?.find(
      ({ name }) => typeof name === 'string' && assetPattern.test(name),
    );
    const downloadUrl = asset?.browser_download_url;
    const expectedPrefix = `https://github.com/${RELEASE_REPO}/releases/download/`;

    if (typeof downloadUrl !== 'string' || !downloadUrl.startsWith(expectedPrefix)) {
      return redirect(RELEASES_URL);
    }

    return redirect(downloadUrl);
  } catch {
    return redirect(RELEASES_URL);
  }
}
