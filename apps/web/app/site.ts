export const SITE_ORIGIN = 'https://shipcode.shipshit.dev';

/** Homepage canonical / og:url — host only, no trailing slash (matches sibling marketing sites). */
export const SITE_CANONICAL = SITE_ORIGIN;

export const WEB_APP_PATHS = ['/', '/download'] as const;

/** Nested Open Graph is shallow-merged by Next.js, so child routes must restate these fields. */
export const openGraphDefaults = {
  title: 'ShipCode — Autonomous AI Coding Pipeline',
  description: 'From issue queue to reviewed PR. Install from the ShipCode Homebrew tap.',
  siteName: 'ShipCode',
  type: 'website' as const,
  images: [
    {
      url: '/og.png',
      width: 1200,
      height: 630,
      alt: 'ShipCode — From issue queue to reviewed PR',
    },
  ],
};

export function discoveryMetadata(path: (typeof WEB_APP_PATHS)[number] = '/') {
  const url = path === '/' ? SITE_CANONICAL : `${SITE_ORIGIN}${path}`;
  return {
    alternates: {
      canonical: url,
    },
    openGraph: {
      ...openGraphDefaults,
      url,
    },
  };
}

export const homeDiscoveryMetadata = discoveryMetadata('/');

export function sitemapUrl(path: string): string {
  return path === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`;
}
