import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { buildLocalPreviewHost, LocalPreviewProxy } from './local-preview-proxy';

describe('buildLocalPreviewHost', () => {
  it('slugifies project and branch names into a localhost host', () => {
    expect(buildLocalPreviewHost('ShipCode App', 'feat/Issue-12')).toBe(
      'shipcode-shipcode-app-feat-issue-12.localhost',
    );
  });

  it('strips punctuation and dangling separators from the generated host', () => {
    expect(buildLocalPreviewHost('***', '!!!')).toBe('shipcode.localhost');
  });

  it('truncates long slugs to 60 characters before the localhost suffix', () => {
    const host = buildLocalPreviewHost('a'.repeat(80), 'b'.repeat(80));
    expect(host.endsWith('.localhost')).toBe(true);
    expect(host.slice(0, -'.localhost'.length).length).toBe(60);
  });
});

describe('LocalPreviewProxy', () => {
  const proxies: LocalPreviewProxy[] = [];
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(proxies.splice(0).map((proxy) => proxy.stop()));
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
          }),
      ),
    );
  });

  function listen(server: http.Server): Promise<number> {
    servers.push(server);
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('expected a TCP address'));
          return;
        }
        resolve(address.port);
      });
    });
  }

  async function startProxy(preferredPort?: number): Promise<LocalPreviewProxy> {
    const proxy = new LocalPreviewProxy();
    proxies.push(proxy);
    await proxy.start(preferredPort === undefined ? {} : { port: preferredPort });
    return proxy;
  }

  it('starts once, reuses the bound port, and rejects register before start', async () => {
    const proxy = new LocalPreviewProxy();
    proxies.push(proxy);

    expect(() =>
      proxy.register({ host: 'preview.localhost', target: 'http://127.0.0.1:9' }),
    ).toThrow('Local preview proxy is not running');

    const port = await proxy.start({ port: 18750 });
    expect(port).toBeGreaterThan(0);
    expect(await proxy.start()).toBe(port);
  });

  it('returns 502 for unknown hosts and proxy target failures', async () => {
    const proxy = await startProxy();
    const url = proxy.register({
      host: 'shipcode-preview.localhost:9999',
      target: 'http://127.0.0.1:1/',
    });

    const unknown = await fetch(`http://127.0.0.1:${proxy.port}/missing`, {
      headers: { host: 'unknown.localhost' },
    });
    expect(unknown.status).toBe(502);
    expect(await unknown.text()).toContain('No ShipCode preview route registered');

    const failed = await fetch(`${url}/down`);
    expect(failed.status).toBe(502);
    expect(await failed.text()).toContain('Preview proxy error:');
  });

  it('forwards HTTP requests to the registered target and forgets unregistered hosts', async () => {
    const target = http.createServer((req, res) => {
      res.writeHead(201, { 'x-preview': 'ok' });
      res.end(`hello:${req.url}`);
    });
    const targetPort = await listen(target);
    const proxy = await startProxy();
    const previewUrl = proxy.register({
      host: 'ShipCode-Demo.localhost',
      target: `http://127.0.0.1:${targetPort}/`,
    });

    const ok = await fetch(`${previewUrl}/page`);
    expect(ok.status).toBe(201);
    expect(ok.headers.get('x-preview')).toBe('ok');
    expect(await ok.text()).toBe('hello:/page');

    proxy.unregister('ShipCode-Demo.localhost:3750');
    const afterUnregister = await fetch(`${previewUrl}/page`);
    expect(afterUnregister.status).toBe(502);
  });

  it('picks the next free port when the preferred port is already bound', async () => {
    const blocker = http.createServer();
    const occupied = await listen(blocker);
    const proxy = await startProxy(occupied);

    expect(proxy.port).not.toBe(occupied);
    expect(proxy.port).toBeGreaterThan(0);
  });

  it('stop is idempotent when the proxy was never started', async () => {
    const proxy = new LocalPreviewProxy();
    await expect(proxy.stop()).resolves.toBeUndefined();
    await expect(proxy.stop()).resolves.toBeUndefined();
  });
});
