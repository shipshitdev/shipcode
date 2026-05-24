import http, { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { type AddressInfo, createServer } from 'node:net';

export interface LocalPreviewRoute {
  host: string;
  target: string;
}

export interface LocalPreviewProxyOptions {
  port?: number;
}

async function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

async function firstAvailablePort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 50; port++) {
    if (await portAvailable(port)) return port;
  }
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/:\d+$/, '');
}

export function buildLocalPreviewHost(projectSlug: string, branchSlug: string): string {
  const slug = `shipcode-${projectSlug}-${branchSlug}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'shipcode-preview'}.localhost`;
}

export class LocalPreviewProxy {
  private server: http.Server | null = null;
  private routes = new Map<string, string>();
  port: number | null = null;

  async start(options: LocalPreviewProxyOptions = {}): Promise<number> {
    if (this.server && this.port) return this.port;
    const port = await firstAvailablePort(options.port ?? 3750);
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(port, '127.0.0.1', () => resolve());
    });
    this.port = port;
    return port;
  }

  register(route: LocalPreviewRoute): string {
    if (!this.port) throw new Error('Local preview proxy is not running');
    const host = normalizeHost(route.host);
    this.routes.set(host, route.target.replace(/\/$/, ''));
    return `http://${host}:${this.port}`;
  }

  unregister(host: string): void {
    this.routes.delete(normalizeHost(host));
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.port = null;
    this.routes.clear();
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const host = normalizeHost(req.headers.host ?? '');
    const target = this.routes.get(host);
    if (!target) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`No ShipCode preview route registered for ${host}`);
      return;
    }

    const targetUrl = new URL(req.url ?? '/', target);
    const proxyRequest = (targetUrl.protocol === 'https:' ? httpsRequest : httpRequest)(
      targetUrl,
      {
        method: req.method,
        headers: {
          ...req.headers,
          host: targetUrl.host,
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyRequest.on('error', (err) => {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Preview proxy error: ${err.message}`);
    });
    req.pipe(proxyRequest);
  }
}
