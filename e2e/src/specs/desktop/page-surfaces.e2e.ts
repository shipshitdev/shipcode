import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

import { expect, type Harness, test } from '../../fixtures/electron-app';

type SurfaceKind =
  | 'desktop-view'
  | 'project-tab'
  | 'settings-section'
  | 'issue-tab'
  | 'web-route'
  | 'docs-route';

interface CoverageSurface {
  id: string;
  kind: SurfaceKind;
  title: string;
  path?: string;
}

interface PageCoverageManifest {
  surfaces: CoverageSurface[];
}

type ProjectTab = 'issues' | 'git' | 'code' | 'pull-requests' | 'terminal' | 'insights';
type SettingsSection =
  | 'about'
  | 'general'
  | 'integrations'
  | 'github'
  | 'notifications'
  | 'pipeline'
  | 'shortcuts'
  | 'archived'
  | 'developer'
  | 'auto-commit';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(HERE, '..', '..', '..', 'page-coverage.manifest.json');
const coverage = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as PageCoverageManifest;

const ISSUE_SURFACE = {
  issueNumber: 501,
  title: 'Surface coverage issue',
  body: 'Fixture issue used by the E2E page coverage smoke.',
  labels: ['feature'],
  state: 'open' as const,
};

const ISSUE_THREAD_ID = 'e2e-surface-thread';

const DESKTOP_VIEW_SURFACES = [
  {
    id: 'desktop-overview',
    action: 'openOverview',
    assert: async (page: Page) => {
      await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    id: 'desktop-activity',
    action: 'openActivity',
    assert: async (page: Page) => {
      await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    id: 'desktop-inbox',
    action: 'openInbox',
    assert: async (page: Page) => {
      await expect(page.getByTestId('inbox-view')).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    id: 'desktop-costs',
    action: 'openCosts',
    assert: async (page: Page) => {
      await expect(page.getByRole('heading', { name: 'Costs', exact: true })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    id: 'desktop-skills',
    action: 'openSkills',
    assert: async (page: Page) => {
      await expect(page.getByRole('heading', { name: 'Skills', exact: true })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    id: 'desktop-automations',
    action: 'openAutomations',
    assert: async (page: Page) => {
      await expect(page.getByRole('heading', { name: 'Automations', exact: true })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
] as const;

const PROJECT_TAB_SURFACES = [
  {
    id: 'project-issues',
    tab: 'issues',
    assert: async (page: Page) => {
      await expect(page.getByTestId(`issue-card-${ISSUE_SURFACE.issueNumber}`)).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    id: 'project-git',
    tab: 'git',
    assert: async (page: Page) => {
      await expect(page.getByText('Worktrees').first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: /Cleanup/i })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    id: 'project-code',
    tab: 'code',
    assert: async (page: Page) => {
      await expect(page.getByText('Worktree', { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText('README.md')).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    id: 'project-pull-requests',
    tab: 'pull-requests',
    assert: async (page: Page) => {
      await expect(page.getByTestId('pr-panel')).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    id: 'project-terminal',
    tab: 'terminal',
    assert: async (page: Page) => {
      await expect(page.getByText('No terminal sessions open')).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    id: 'project-insights',
    tab: 'insights',
    assert: async (page: Page) => {
      await expect(page.getByRole('heading', { name: 'Insights', exact: true })).toBeVisible({
        timeout: 15_000,
      });
    },
  },
] as const satisfies ReadonlyArray<{
  id: string;
  tab: ProjectTab;
  assert: (page: Page) => Promise<void>;
}>;

const SETTINGS_SURFACES = [
  { id: 'settings-general', section: 'general', heading: /^General$/ },
  { id: 'settings-integrations', section: 'integrations', heading: /^Integrations$/ },
  { id: 'settings-github', section: 'github', heading: /^GitHub$/ },
  { id: 'settings-notifications', section: 'notifications', heading: /^Notifications$/ },
  { id: 'settings-pipeline', section: 'pipeline', heading: /^Pipeline$/ },
  { id: 'settings-auto-commit', section: 'auto-commit', heading: /^Auto-commit & Cleanup$/ },
  { id: 'settings-shortcuts', section: 'shortcuts', heading: /^Keyboard Shortcuts$/ },
  { id: 'settings-archived', section: 'archived', heading: /^Archived$/ },
  { id: 'settings-developer', section: 'developer', heading: /^Developer$/ },
  { id: 'settings-about', section: 'about', heading: /^About$/ },
] as const satisfies ReadonlyArray<{
  id: string;
  section: SettingsSection;
  heading: RegExp;
}>;

const ISSUE_TAB_SURFACES = [
  { id: 'issue-tab-prd', name: /^Issue$/ },
  { id: 'issue-tab-console', name: /^Console$/ },
  { id: 'issue-tab-comments', name: /^Comments$/ },
  { id: 'issue-tab-history', name: /^Plans/ },
  { id: 'issue-tab-findings', name: /^Findings/ },
  { id: 'issue-tab-diff', name: /^Diff/ },
  { id: 'issue-tab-runs', name: /^Runs$/ },
  { id: 'issue-tab-activity', name: /^Activity/ },
  { id: 'issue-tab-conversations', name: /^Conversations$/ },
  { id: 'issue-tab-chat', name: /^Chat$/ },
] as const;

test.use({
  seedOptions: {
    onboarded: true,
    gitRepo: true,
    issues: [ISSUE_SURFACE],
  },
});

function idsFor(kind: SurfaceKind): string[] {
  return coverage.surfaces.filter((surface) => surface.kind === kind).map((surface) => surface.id);
}

function expectManifestIds(kind: SurfaceKind, expectedIds: readonly string[]): void {
  expect(idsFor(kind)).toEqual([...expectedIds]);
}

async function openIssueWithThread(harness: Harness): Promise<void> {
  const { page } = harness;

  await harness.callStore('selectProject', harness.seed.projectId);
  await expect(page.getByTestId(`issue-card-${ISSUE_SURFACE.issueNumber}`)).toBeVisible({
    timeout: 15_000,
  });
  await page.getByTestId(`issue-card-${ISSUE_SURFACE.issueNumber}`).click();
  await expect(page.getByRole('heading', { name: ISSUE_SURFACE.title })).toBeVisible({
    timeout: 10_000,
  });

  await page.evaluate((threadId) => {
    const store = (
      window as unknown as {
        __APP_STORE__?: {
          getState(): { activeIssue?: Record<string, unknown> | null };
          setState(patch: Record<string, unknown>): void;
        };
      }
    ).__APP_STORE__;
    if (!store) throw new Error('__APP_STORE__ not exposed');
    const activeIssue = store.getState().activeIssue;
    if (!activeIssue) throw new Error('activeIssue not set before thread patch');
    store.setState({
      activeIssue: { ...activeIssue, threadId },
      activeThreadId: threadId,
      terminalThreadId: threadId,
    });
  }, ISSUE_THREAD_ID);

  await expect(page.getByRole('tab', { name: /^Chat$/ })).toBeVisible({ timeout: 10_000 });
}

test.describe('desktop page coverage manifest', () => {
  test('top-level desktop views expose covered surfaces', async ({ harness }) => {
    expectManifestIds(
      'desktop-view',
      DESKTOP_VIEW_SURFACES.map((surface) => surface.id),
    );

    for (const surface of DESKTOP_VIEW_SURFACES) {
      await harness.callStore(surface.action);
      await surface.assert(harness.page);
    }
  });

  test('project tabs expose covered surfaces', async ({ harness }) => {
    expectManifestIds(
      'project-tab',
      PROJECT_TAB_SURFACES.map((surface) => surface.id),
    );

    await harness.callStore('selectProject', harness.seed.projectId);

    for (const surface of PROJECT_TAB_SURFACES) {
      await harness.callStore('setProjectTab', surface.tab);
      await surface.assert(harness.page);
    }
  });

  test('settings sections expose covered surfaces', async ({ harness }) => {
    expectManifestIds(
      'settings-section',
      SETTINGS_SURFACES.map((surface) => surface.id),
    );

    await harness.setState({ settingsVisible: true });

    for (const surface of SETTINGS_SURFACES) {
      await harness.callStore('setSettingsSection', surface.section);
      await expect(harness.page.getByRole('heading', { name: surface.heading })).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  test('issue detail tabs expose covered surfaces', async ({ harness }) => {
    expectManifestIds(
      'issue-tab',
      ISSUE_TAB_SURFACES.map((surface) => surface.id),
    );

    await openIssueWithThread(harness);

    for (const surface of ISSUE_TAB_SURFACES) {
      const tab = harness.page.getByRole('tab', { name: surface.name });
      await expect(tab).toBeVisible({ timeout: 10_000 });
      await tab.click();
      await expect(tab).toHaveAttribute('data-state', 'active');
    }
  });
});
