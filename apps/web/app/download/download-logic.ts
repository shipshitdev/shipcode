// Pure logic behind the /download page, split out so it can be unit-tested in
// the web package's node test environment (page.tsx itself is a thin client
// wrapper that runs this in a useEffect). No DOM/window access here.

export const RELEASE_REPO = 'shipshitdev/shipcode';
export const RELEASES_URL = `https://github.com/${RELEASE_REPO}/releases`;
export const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;

export type Arch = 'arm64' | 'x64';

type GitHubRelease = {
  assets?: Array<{ browser_download_url?: unknown; name?: unknown }>;
};

/**
 * Resolve the target arch from the page's query string. Defaults to arm64 —
 * every Mac sold since 2020 — because browsers can't reliably report Apple
 * Silicon vs Intel; the site's "Intel Mac?" link passes `?arch=x64`.
 */
export function resolveArch(search: string): Arch {
  const arch = new URLSearchParams(search).get('arch')?.toLowerCase();
  if (arch === 'x64' || arch === 'intel' || arch === 'x86_64') return 'x64';
  return 'arm64';
}

/**
 * Pick the DMG download URL for the given arch from a GitHub release payload.
 * Returns null unless a matching asset exists AND its URL is a genuine
 * releases/download asset (guards against a tampered/unexpected payload).
 */
export function pickDmgUrl(release: GitHubRelease, arch: Arch): string | null {
  const assetPattern = new RegExp(`-${arch}\\.dmg$`, 'i');
  const asset = release.assets?.find(
    ({ name }) => typeof name === 'string' && assetPattern.test(name),
  );
  const url = asset?.browser_download_url;
  const expectedPrefix = `https://github.com/${RELEASE_REPO}/releases/download/`;
  if (typeof url !== 'string' || !url.startsWith(expectedPrefix)) return null;
  return url;
}

/**
 * Fetch the latest release and resolve the DMG URL for `arch`, falling back to
 * the releases page on any failure (network, non-2xx, missing asset). Never
 * throws — the caller navigates to whatever this returns.
 */
export async function resolveLatestDmgUrl(
  arch: Arch,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  try {
    const response = await fetchImpl(LATEST_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      // Fail fast to the releases-page fallback if GitHub is slow, rather than
      // leaving the visitor on "Preparing your download…" indefinitely.
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return RELEASES_URL;
    const release = (await response.json()) as GitHubRelease;
    return pickDmgUrl(release, arch) ?? RELEASES_URL;
  } catch {
    return RELEASES_URL;
  }
}

export interface StartDownloadHandlers {
  /** Injected for tests; defaults to global fetch in the browser. */
  fetchImpl?: typeof fetch;
  /** Perform the navigation (production: window.location.replace). */
  navigate: (url: string) => void;
  /** Optional: surface the resolved URL for a manual fallback link. */
  onResolved?: (url: string) => void;
}

/**
 * Orchestrates the whole /download flow — parse arch, resolve the latest DMG,
 * expose it for the manual link, then navigate. Kept here (not in the client
 * component) so the effect logic is unit-testable in the node test env; the
 * page's useEffect is a thin wrapper around this.
 */
export async function startDownload(
  search: string,
  handlers: StartDownloadHandlers,
): Promise<void> {
  const url = await resolveLatestDmgUrl(resolveArch(search), handlers.fetchImpl);
  handlers.onResolved?.(url);
  handlers.navigate(url);
}
