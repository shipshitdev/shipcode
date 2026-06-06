import { expect, test } from '../../fixtures/electron-app';

/**
 * Flow 9 — Notifications / Inbox
 *
 * Delivery path used throughout: the live push path via harness.fire('notification:fire').
 *
 * Why not the seeded-DB path: the notifications table has a NOT NULL FK on
 * thread_id → threads(id) ON DELETE CASCADE, so seeding with threadId:null
 * always throws a constraint error, which seed.ts silently swallows. Rather
 * than creating real thread rows in the seed (which pulls in more schema), all
 * tests drive state via the live push path.
 *
 * Why live push works in InboxView:
 * useIpc.ts 'notification:fire' handler calls addNotification(record) on the
 * Zustand store. InboxView.tsx merges store.notifications with its
 * notification:list query result, so live-pushed records appear immediately
 * without a DB round-trip.
 *
 * Navigation: harness.callStore('openInbox') sets viewMode='inbox' which
 * renders InboxView (lazy-loaded via Suspense).
 */

// ---------------------------------------------------------------------------
// Shared fixture notification payload (mirrors NotificationRecord shape)
// ---------------------------------------------------------------------------
const FIXTURE_NOTIFICATION = {
  id: 'e2e-notif-001',
  threadId: 'e2e-thread-001',
  projectId: null as string | null, // filled from seed.projectId per test
  kind: 'completed' as const,
  title: 'E2E fixture: issue completed',
  body: 'The pipeline finished successfully.',
  createdAt: new Date().toISOString(),
  dismissedAt: null as null,
};

// ---------------------------------------------------------------------------
// A: Row appears in InboxView via live push
// ---------------------------------------------------------------------------
test.describe('inbox — live push notification row (flow 9a)', () => {
  test('inbox renders live-pushed notification row', async ({ harness }) => {
    const { page, seed } = harness;

    const notification = {
      ...FIXTURE_NOTIFICATION,
      id: 'e2e-notif-row',
      title: 'E2E fixture: issue completed',
      projectId: seed.projectId,
    };

    // Push the notification before navigating to inbox so the store is
    // populated before the query merges on mount.
    await harness.fire('notification:fire', notification);

    // Navigate to inbox.
    await harness.callStore('openInbox');

    // Wait for the InboxView to mount (lazy Suspense).
    await expect(page.getByTestId('inbox-view')).toBeVisible({ timeout: 15_000 });

    // The notification title should appear as a link button in the table.
    await expect(
      page.getByRole('button', { name: /E2E fixture: issue completed/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// A2: Empty inbox — no notifications
// ---------------------------------------------------------------------------
test.describe('inbox — empty state (flow 9a2)', () => {
  test('inbox shows "All caught up" when no notifications exist', async ({ harness }) => {
    const { page } = harness;

    await harness.callStore('openInbox');

    await expect(page.getByTestId('inbox-view')).toBeVisible({ timeout: 15_000 });

    // Must show the empty state.
    await expect(page.getByText(/all caught up/i)).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// B: Live push path — notification:fire IPC
// ---------------------------------------------------------------------------
test.describe('inbox — live notification:fire push (flow 9b)', () => {
  test('fired notification appears in the store and the toaster', async ({ harness }) => {
    const { page, seed } = harness;

    // Start on the project view; the toaster is always rendered in App.
    await harness.callStore('selectProject', seed.projectId);
    await expect(page.locator('#root')).toBeVisible();

    const notification = {
      ...FIXTURE_NOTIFICATION,
      projectId: seed.projectId,
    };

    // Fire the push event.
    await harness.fire('notification:fire', notification);

    // The NotificationToaster slot should become visible.
    await expect(page.getByTestId('notification-toaster')).toBeVisible({ timeout: 10_000 });

    // The notification title should appear inside the toaster.
    await expect(
      page.getByTestId('notification-toaster').getByText(/E2E fixture: issue completed/i),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('fired notification is reflected in the Zustand store', async ({ harness }) => {
    const { seed } = harness;

    const notification = {
      ...FIXTURE_NOTIFICATION,
      id: 'e2e-notif-store-check',
      projectId: seed.projectId,
    };

    await harness.fire('notification:fire', notification);

    // Give the IPC handler one tick to process.
    await harness.page.waitForTimeout(500);

    const state = await harness.getState();
    const notifications = state.notifications as Array<{ id: string }>;
    expect(notifications.some((n) => n.id === 'e2e-notif-store-check')).toBe(true);
  });

  test('fired notification appears in InboxView after navigating to inbox', async ({ harness }) => {
    const { page, seed } = harness;

    const notification = {
      ...FIXTURE_NOTIFICATION,
      id: 'e2e-notif-inbox-live',
      title: 'E2E live push notification',
      projectId: seed.projectId,
    };

    // Fire before navigating to inbox; store receives it immediately.
    await harness.fire('notification:fire', notification);

    // Navigate to inbox.
    await harness.callStore('openInbox');

    // Wait for InboxView to render.
    await expect(page.getByTestId('inbox-view')).toBeVisible({ timeout: 15_000 });

    // InboxView merges store notifications with query data, so the live-pushed
    // row must appear even before notification:list returns it from the DB.
    await expect(
      page.getByRole('button', { name: /E2E live push notification/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('clicking notification open-detail button keeps inbox mounted', async ({ harness }) => {
    const { page, seed } = harness;

    // Use projectId but no threadId — goToIssue calls selectProject +
    // setViewMode('inbox') then returns early (threadId is null).
    // Net result: viewMode stays 'inbox' and InboxView remains visible.
    const notification = {
      ...FIXTURE_NOTIFICATION,
      id: 'e2e-notif-nav',
      title: 'E2E nav notification',
      projectId: seed.projectId,
      threadId: null as unknown as string,
    };

    await harness.fire('notification:fire', notification);
    await harness.callStore('openInbox');

    await expect(page.getByTestId('inbox-view')).toBeVisible({ timeout: 15_000 });

    // The row's title button has aria-label "Open issue detail: <title>"
    const titleButton = page.getByRole('button', { name: /E2E nav notification/i }).first();
    await expect(titleButton).toBeVisible({ timeout: 10_000 });

    // Click: goToIssue → selectProject(projectId) [sets viewMode='project'] →
    // setViewMode('inbox') → if (!threadId) return.
    // Final viewMode = 'inbox' → InboxView stays mounted.
    await titleButton.click();

    // The inbox view should remain visible after click (no crash, viewMode=inbox).
    await expect(page.getByTestId('inbox-view')).toBeVisible({ timeout: 5_000 });
  });

  test('notification:dismiss push removes notification from store', async ({ harness }) => {
    const notification = {
      ...FIXTURE_NOTIFICATION,
      id: 'e2e-notif-dismiss',
      projectId: harness.seed.projectId,
    };

    await harness.fire('notification:fire', notification);

    // Confirm it landed in the store.
    await harness.page.waitForTimeout(300);
    const stateBefore = await harness.getState();
    const before = stateBefore.notifications as Array<{ id: string }>;
    expect(before.some((n) => n.id === 'e2e-notif-dismiss')).toBe(true);

    // Now fire the dismiss push.
    await harness.fire('notification:dismiss', { id: 'e2e-notif-dismiss' });

    await harness.page.waitForTimeout(300);
    const stateAfter = await harness.getState();
    const after = stateAfter.notifications as Array<{ id: string }>;
    expect(after.some((n) => n.id === 'e2e-notif-dismiss')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C: Inbox sort + filter controls
// ---------------------------------------------------------------------------
test.describe('inbox — sort and filter controls (flow 9c)', () => {
  test('inbox renders both live-pushed notifications', async ({ harness }) => {
    const { page, seed } = harness;

    // Push two notifications with distinct kinds before navigating to inbox.
    await harness.fire('notification:fire', {
      id: 'e2e-notif-completed',
      threadId: 'e2e-thread-completed',
      projectId: seed.projectId,
      kind: 'completed',
      title: 'Completed notification',
      body: '',
      createdAt: new Date(Date.now() - 1000).toISOString(),
      dismissedAt: null,
    });
    await harness.fire('notification:fire', {
      id: 'e2e-notif-approval',
      threadId: 'e2e-thread-approval',
      projectId: seed.projectId,
      kind: 'approval',
      title: 'Needs approval notification',
      body: '',
      createdAt: new Date().toISOString(),
      dismissedAt: null,
    });

    await harness.callStore('openInbox');
    await expect(page.getByTestId('inbox-view')).toBeVisible({ timeout: 15_000 });

    // Both rows should appear somewhere in the table.
    await expect(page.getByRole('button', { name: /Completed notification/i }).first()).toBeVisible(
      { timeout: 10_000 },
    );
    await expect(
      page.getByRole('button', { name: /Needs approval notification/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('Needs approval filter hides non-approval rows', async ({ harness }) => {
    const { page, seed } = harness;

    // Push two notifications before navigating.
    await harness.fire('notification:fire', {
      id: 'e2e-filter-completed',
      threadId: 'e2e-thread-fc',
      projectId: seed.projectId,
      kind: 'completed',
      title: 'Completed notification',
      body: '',
      createdAt: new Date(Date.now() - 1000).toISOString(),
      dismissedAt: null,
    });
    await harness.fire('notification:fire', {
      id: 'e2e-filter-approval',
      threadId: 'e2e-thread-fa',
      projectId: seed.projectId,
      kind: 'approval',
      title: 'Needs approval notification',
      body: '',
      createdAt: new Date().toISOString(),
      dismissedAt: null,
    });

    await harness.callStore('openInbox');
    await expect(page.getByTestId('inbox-view')).toBeVisible({ timeout: 15_000 });

    // Wait for rows to appear before filtering.
    await expect(page.getByRole('button', { name: /Completed notification/i }).first()).toBeVisible(
      { timeout: 10_000 },
    );

    // Click the "Needs approval" toggle button in the PageHeader actions.
    // The button text is "Needs approval" and it is NOT an aria-label match
    // for a notification row (rows use "Open issue detail: <title>"). We
    // target the button by its exact text content to avoid ambiguity.
    await page.getByRole('button', { name: /^Needs approval$/i }).click();

    // The completed row should now be hidden.
    await expect(page.getByRole('button', { name: /Completed notification/i })).toBeHidden({
      timeout: 5_000,
    });

    // The approval row must remain.
    await expect(
      page.getByRole('button', { name: /Needs approval notification/i }).first(),
    ).toBeVisible();
  });

  test('sort order toggle button is present and clickable', async ({ harness }) => {
    const { page, seed } = harness;

    // Push at least one notification so the inbox shows content.
    await harness.fire('notification:fire', {
      id: 'e2e-sort-notif',
      threadId: 'e2e-thread-sort',
      projectId: seed.projectId,
      kind: 'completed',
      title: 'Sort test notification',
      body: '',
      createdAt: new Date().toISOString(),
      dismissedAt: null,
    });

    await harness.callStore('openInbox');
    await expect(page.getByTestId('inbox-view')).toBeVisible({ timeout: 15_000 });

    // The sort button starts as "Newest" — click to switch to Oldest.
    const sortButton = page.getByRole('button', { name: /newest|oldest/i }).first();
    await expect(sortButton).toBeVisible({ timeout: 5_000 });
    await sortButton.click();

    // After click the button text should read "Oldest".
    await expect(page.getByRole('button', { name: /oldest/i }).first()).toBeVisible({
      timeout: 3_000,
    });
  });
});
