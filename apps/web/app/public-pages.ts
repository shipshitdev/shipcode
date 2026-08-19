import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEB_APP_PATHS } from './site';

export function defaultDocsContentDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../../docs/content');
}

export function mdxFileToDocsPath(relativePath: string): string {
  const withoutExt = relativePath.replace(/\.mdx$/, '').replaceAll('\\', '/');
  if (withoutExt === 'index') {
    return '/docs';
  }
  if (withoutExt.endsWith('/index')) {
    return `/docs/${withoutExt.slice(0, -'/index'.length)}`;
  }
  return `/docs/${withoutExt}`;
}

export function listDocPaths(contentDir = defaultDocsContentDir()): string[] {
  if (!existsSync(contentDir)) {
    return ['/docs'];
  }

  const paths: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.mdx')) {
        continue;
      }
      paths.push(mdxFileToDocsPath(relative(contentDir, full)));
    }
  };

  walk(contentDir);
  return [...new Set(paths)].sort();
}

export function listPublicPagePaths(contentDir = defaultDocsContentDir()): string[] {
  return [...WEB_APP_PATHS, ...listDocPaths(contentDir)];
}
