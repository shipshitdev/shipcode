export const SITE_ORIGIN = 'https://shipcode.shipshit.dev';

/** Homepage canonical / og:url — host only, no trailing slash (matches sibling marketing sites). */
export const SITE_CANONICAL = SITE_ORIGIN;

export const WEB_APP_PATHS = ['/', '/download'] as const;

export const homeDiscoveryMetadata = {
  alternates: {
    canonical: SITE_CANONICAL,
  },
  openGraph: {
    url: SITE_CANONICAL,
  },
} as const;

export function sitemapUrl(path: string): string {
  return path === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`;
}
