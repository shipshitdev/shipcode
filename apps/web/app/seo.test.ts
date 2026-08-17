import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { metadata as downloadMetadata } from './download/layout';
import { listDocPaths, listPublicPagePaths, mdxFileToDocsPath } from './public-pages';
import robots, { dynamic as robotsDynamic } from './robots';
import {
  homeDiscoveryMetadata,
  SITE_CANONICAL,
  SITE_ORIGIN,
  sitemapUrl,
  WEB_APP_PATHS,
} from './site';
import sitemap, { dynamic as sitemapDynamic } from './sitemap';

describe('public marketing SEO', () => {
  it('keeps the canonical host on shipcode.shipshit.dev', () => {
    expect(SITE_ORIGIN).toBe('https://shipcode.shipshit.dev');
    expect(SITE_CANONICAL).toBe('https://shipcode.shipshit.dev');
    expect(sitemapUrl('/')).toBe('https://shipcode.shipshit.dev/');
    expect(sitemapUrl('/docs')).toBe('https://shipcode.shipshit.dev/docs');
    expect(homeDiscoveryMetadata.alternates.canonical).toBe(SITE_CANONICAL);
    expect(homeDiscoveryMetadata.openGraph.url).toBe(SITE_CANONICAL);
    expect(downloadMetadata.alternates?.canonical).toBe(`${SITE_ORIGIN}/download`);
    expect(downloadMetadata.openGraph?.url).toBe(`${SITE_ORIGIN}/download`);
  });

  it('maps real MDX files to public /docs routes and skips folder indexes', () => {
    expect(mdxFileToDocsPath('index.mdx')).toBe('/docs');
    expect(mdxFileToDocsPath('cli/index.mdx')).toBe('/docs/cli');
    expect(mdxFileToDocsPath('desktop/overview.mdx')).toBe('/docs/desktop/overview');
    expect(mdxFileToDocsPath('getting-started.mdx')).toBe('/docs/getting-started');
  });

  it('lists only real public pages from docs content plus / and /download', () => {
    const paths = listPublicPagePaths();

    expect(paths.slice(0, WEB_APP_PATHS.length)).toEqual([...WEB_APP_PATHS]);
    expect(paths).toContain('/docs');
    expect(paths).toContain('/docs/getting-started');
    expect(paths).toContain('/docs/desktop/overview');
    expect(paths).toContain('/docs/pipeline/overview');
    expect(paths).toContain('/docs/cli');
    expect(paths).toContain('/download');
    expect(paths).not.toContain('/llms.txt');
    expect(paths).not.toContain('/docs/desktop');
    expect(paths).not.toContain('/docs/pipeline');
    expect(paths.filter((path) => path.startsWith('/docs'))).toEqual(listDocPaths());
  });

  it('falls back to /docs when the content tree is missing', () => {
    expect(listDocPaths(join(tmpdir(), 'shipcode-docs-missing'))).toEqual(['/docs']);
  });

  it('does not invent routes from a tiny content tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'shipcode-docs-'));
    mkdirSync(join(dir, 'desktop'));
    writeFileSync(join(dir, 'index.mdx'), '# Intro\n');
    writeFileSync(join(dir, 'desktop', 'overview.mdx'), '# Overview\n');
    writeFileSync(join(dir, '_meta.tsx'), 'export default {}\n');

    expect(listDocPaths(dir)).toEqual(['/docs', '/docs/desktop/overview']);
  });

  it('builds a sitemap of those public URLs and a robots.txt Sitemap pointer', () => {
    const entries = sitemap();
    const urls = entries.map((entry) => entry.url);

    expect(urls[0]).toBe('https://shipcode.shipshit.dev/');
    expect(urls).toContain('https://shipcode.shipshit.dev/download');
    expect(urls).toContain('https://shipcode.shipshit.dev/docs');
    expect(urls).toContain('https://shipcode.shipshit.dev/docs/desktop/overview');
    expect(urls).not.toContain('https://shipcode.shipshit.dev/llms.txt');

    const home = entries.find((entry) => entry.url === 'https://shipcode.shipshit.dev/');
    expect(home?.priority).toBe(1);
    expect(home?.changeFrequency).toBe('weekly');

    const robotsFile = robots();
    expect(robotsFile.sitemap).toBe('https://shipcode.shipshit.dev/sitemap.xml');
    expect(robotsFile.rules).toEqual({
      userAgent: '*',
      allow: '/',
    });
    expect(robotsDynamic).toBe('force-static');
    expect(sitemapDynamic).toBe('force-static');
  });
});
