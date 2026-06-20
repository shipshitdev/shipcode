import { expect, request, test } from '@playwright/test';

import { type StaticServer, serveStatic } from '../../fixtures/static-server';

/**
 * Web + Docs static-export smoke tests.
 *
 * Spins up two local HTTP servers (one for apps/web, one for apps/docs) and
 * uses Playwright's API request context to verify that key routes return 200
 * with the expected content fragments. No browser/page is required — pure HTTP.
 *
 * Build is skipped when apps/<app>/out already exists. On a cold machine the
 * first run may take a few minutes, so the suite timeout is generous.
 */

// Allow up to 5 minutes — static builds can take a while on a cold machine.
test.setTimeout(5 * 60 * 1_000);

let webServer: StaticServer;
let docsServer: StaticServer;

test.beforeAll(async () => {
  [webServer, docsServer] = await Promise.all([
    serveStatic('web', 4321),
    serveStatic('docs', 4322),
  ]);
});

test.afterAll(async () => {
  await Promise.all([webServer?.close(), docsServer?.close()]);
});

test.describe('web landing page', () => {
  test('GET / returns 200 and contains ShipCode', async () => {
    const ctx = await request.newContext({ baseURL: webServer.url });
    try {
      const res = await ctx.get('/');
      expect(res.status()).toBe(200);
      const body = await res.text();
      expect(body).toContain('ShipCode');
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe('docs routes', () => {
  let ctx: Awaited<ReturnType<typeof request.newContext>>;

  test.beforeAll(async () => {
    ctx = await request.newContext({ baseURL: docsServer.url });
  });

  test.afterAll(async () => {
    await ctx?.dispose();
  });

  test('GET / returns 200', async () => {
    const res = await ctx.get('/');
    expect(res.status()).toBe(200);
  });

  test('GET /getting-started returns 200 and contains Getting Started', async () => {
    const res = await ctx.get('/getting-started');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body.toLowerCase()).toContain('getting started');
  });

  test('GET /desktop/overview returns 200', async () => {
    const res = await ctx.get('/desktop/overview');
    expect(res.status()).toBe(200);
  });

  test('GET /cli returns 200', async () => {
    const res = await ctx.get('/cli');
    expect(res.status()).toBe(200);
  });
});
