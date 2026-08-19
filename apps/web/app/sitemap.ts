import type { MetadataRoute } from 'next';
import { listPublicPagePaths } from './public-pages';
import { sitemapUrl } from './site';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  return listPublicPagePaths().map((path) => ({
    url: sitemapUrl(path),
    changeFrequency: path === '/' ? 'weekly' : 'monthly',
    priority: path === '/' ? 1 : path.startsWith('/docs') ? 0.8 : 0.6,
  }));
}
