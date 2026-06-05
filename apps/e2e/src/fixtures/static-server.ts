import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');

export type StaticApp = 'web' | 'docs';

export interface StaticServer {
  url: string;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** Resolve a request path to a concrete file in the static export. */
function resolveFile(outDir: string, urlPath: string): string | null {
  const clean = decodeURIComponent(urlPath.split('?')[0]).replace(/\/+$/, '');
  const rel = clean === '' ? 'index.html' : clean.replace(/^\/+/, '');
  const candidates = [
    rel,
    `${rel}.html`,
    path.join(rel, 'index.html'),
    rel === 'index.html' ? rel : 'index.html',
  ];
  for (const candidate of candidates) {
    const full = path.join(outDir, candidate);
    if (!full.startsWith(outDir)) continue; // path-traversal guard
    if (existsSync(full) && statSync(full).isFile()) return full;
  }
  return null;
}

/**
 * Build (if needed) and serve a ShipCode static export (`apps/<app>/out`) on a
 * local port for smoke testing. Returns the base URL and a closer.
 */
export async function serveStatic(appName: StaticApp, port: number): Promise<StaticServer> {
  const outDir = path.join(REPO_ROOT, 'apps', appName, 'out');
  if (!existsSync(outDir)) {
    // eslint-disable-next-line no-console
    console.log(`[e2e] building @shipcode/${appName} static export…`);
    execFileSync('bun', ['--filter', `@shipcode/${appName}`, 'build'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: { ...process.env, DOCS_BASE_PATH: '' },
    });
  }

  const server = http.createServer((req, res) => {
    const file = resolveFile(outDir, req.url ?? '/');
    if (!file) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
    createReadStream(file).pipe(res);
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
