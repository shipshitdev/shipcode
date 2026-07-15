import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, request, test } from '@playwright/test';

import { type StaticServer, serveStatic } from '../../fixtures/static-server';

type RouteKind = 'web-route' | 'docs-route';

interface RouteSurface {
  id: string;
  kind: RouteKind;
  title: string;
  path: string;
}

interface PageCoverageManifest {
  surfaces: Array<RouteSurface | { id: string; kind: string; title: string; path?: string }>;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(HERE, '..', '..', '..', 'page-coverage.manifest.json');
const coverage = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as PageCoverageManifest;

const WEB_ROUTE_IDS = ['web-home', 'web-download'] as const;
const DOCS_ROUTE_IDS = [
  'docs-index',
  'docs-getting-started',
  'docs-architecture',
  'docs-configuration',
  'docs-models',
  'docs-openrouter',
  'docs-cli-index',
  'docs-pipeline-overview',
  'docs-workflow',
  'docs-desktop-activity',
  'docs-desktop-automations',
  'docs-desktop-code',
  'docs-desktop-costs',
  'docs-desktop-git',
  'docs-desktop-inbox',
  'docs-desktop-insights',
  'docs-desktop-kanban',
  'docs-desktop-mission-control',
  'docs-desktop-overview',
  'docs-desktop-plan-viewer',
  'docs-desktop-project-settings',
  'docs-desktop-pull-requests',
  'docs-desktop-settings',
  'docs-desktop-skills',
  'docs-desktop-terminal',
] as const;

type CoveredRouteId = (typeof WEB_ROUTE_IDS)[number] | (typeof DOCS_ROUTE_IDS)[number];

const EXPECTED_ROUTE_TEXT: Record<CoveredRouteId, string> = {
  'web-home': 'AI pipeline that plans, reviews, executes, tests, verifies',
  'web-download': 'Preparing your download',
  'docs-index': 'Autonomous AI coding pipeline',
  'docs-getting-started': 'Which ShipCode do I need?',
  'docs-architecture': 'Turborepo monorepo',
  'docs-configuration': 'GitHub Labels',
  'docs-models': 'ShipCode can assign a provider, model, and reasoning effort',
  'docs-openrouter': 'first-class',
  'docs-cli-index': 'headless pipeline runner',
  'docs-pipeline-overview': 'state machine that processes GitHub issues',
  'docs-workflow': 'Repos can override the prompts ShipCode sends',
  'docs-desktop-activity': 'global timeline',
  'docs-desktop-automations': 'scheduled prompts tied to a project',
  'docs-desktop-code': 'read-only browser',
  'docs-desktop-costs': 'aggregates LLM spend',
  'docs-desktop-git': 'worktrees, branches, diffs',
  'docs-desktop-inbox': 'focused triage queue',
  'docs-desktop-insights': 'summarizes activity and spend',
  'docs-desktop-kanban': 'Each column corresponds',
  'docs-desktop-mission-control': 'old name',
  'docs-desktop-overview': 'primary way to run the pipeline',
  'docs-desktop-plan-viewer': 'renders a generated pipeline plan',
  'docs-desktop-project-settings': 'per-project settings modal',
  'docs-desktop-pull-requests': 'lists repository PRs',
  'docs-desktop-settings': 'covers every globally configurable',
  'docs-desktop-skills': 'edit the prompts',
  'docs-desktop-terminal': 'streams the stdout/stderr',
};

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

function routeSurfaces(kind: RouteKind): RouteSurface[] {
  return coverage.surfaces
    .filter((surface): surface is RouteSurface => surface.kind === kind)
    .map((surface) => {
      if (!surface.path) throw new Error(`${surface.id} is missing path`);
      return surface;
    });
}

function expectRouteIds(kind: RouteKind, expectedIds: readonly string[]): void {
  expect(routeSurfaces(kind).map((surface) => surface.id)).toEqual([...expectedIds]);
}

async function expectRouteOkWithContent(
  ctx: Awaited<ReturnType<typeof request.newContext>>,
  route: RouteSurface,
): Promise<void> {
  const res = await ctx.get(route.path);
  expect(res.status(), route.id).toBe(200);
  const expectedText = EXPECTED_ROUTE_TEXT[route.id as CoveredRouteId];
  if (!expectedText) throw new Error(`missing expected text for ${route.id}`);
  await expect(await res.text(), route.id).toContain(expectedText);
}

test.describe('web/docs route coverage manifest', () => {
  test('web routes return 200', async () => {
    expectRouteIds('web-route', WEB_ROUTE_IDS);

    const ctx = await request.newContext({ baseURL: webServer.url });
    try {
      for (const route of routeSurfaces('web-route')) {
        await expectRouteOkWithContent(ctx, route);
      }
    } finally {
      await ctx.dispose();
    }
  });

  test('docs routes return 200', async () => {
    expectRouteIds('docs-route', DOCS_ROUTE_IDS);

    const ctx = await request.newContext({ baseURL: docsServer.url });
    try {
      for (const route of routeSurfaces('docs-route')) {
        await expectRouteOkWithContent(ctx, route);
      }
    } finally {
      await ctx.dispose();
    }
  });
});
