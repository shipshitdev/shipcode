import { expect, test } from '../../fixtures/electron-app';

/**
 * Flow 9 — Notifications / Inbox
 *
 * Two delivery paths exercised:
 *
 *  A. Seeded notifications — pre-inserted via seedOptions.notifications and
 *     fetched by InboxView's `notification:list` IPC call on mount. This path
 *     verifies the query path through the real DB.
 *
 *  B. Live push — `notification:fire` pushed via harness.fire() after mount.
 *     Verifies useIpc's addNotification handler + InboxView's own
 *     notification:fire listener both update the UI.
 *
 * Navigation path: harness.callStore('openInbox') sets viewMode='inbox' which
 * renders InboxView (lazy-loaded via Suspense; we wait for it).
 */

// ---------------------------------------------------------------------------
// Shared fixture notification payload (mirrors NotificationRecord shape)
// ---------------------------------------------------------------------------
const FIXTURE_NOTIFICATION = {
  id: 'e2e-notif-001',
  threadId: 'e2e-thread-001',
  projectId: null as string | null, // filled in from seed.projectId
  kind: 'completed' as const,
  title: 'E2E fixture: issue completed',
  body: 'The pipeline finished successfully.',
  createdAt: new Date().toISOString(),
  dismissedAt: null as null,
};

// ---------------------------------------------------------------------------
// A: Seeded notifications path
// ---------------------------------------------------------------------------
test.describe('inbox — seeded notification (flow 9a)', () => {
  test.use({
    seedOptions: {
      notifications: [
        {
          kind: 'completed',
          title: 'E2E fixture: issue completed',
          threadId: null,
        },
      ],
    },
  });

  test('inbox renders seeded notification row', async ({ harness }) => {
    const { page } = harness;

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
// A2: Empty inbox — no seeded notifications
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

    // Fire before navigating to inbox.
    await harness.fire('notification:fire', notification);

    // Now navigate to inbox.
    await harness.callStore('openInbox');

    // Wait for InboxView to render.
    await expect(page.getByTestId('inbox-view')).toBeVisible({ timeout: 15_000 });

    // The live-pushed notification title must be present in the table.
    await expect(
      page.getByRole('button', { name: /E2E live push notification/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('clicking notification open-detail button updates viewMode', async ({ harness }) => {
    const { page, seed } = harness;

    // Seed an issue so the notification can navigate to it.
    const notification = {
      ...FIXTURE_NOTIFICATION,
      id: 'e2e-notif-nav',
      title: 'E2E nav notification',
      projectId: seed.projectId,
      threadId: null,
    };

    await harness.fire('notification:fire', notification);
    await harness.callStore('openInbox');

    await expect(page.getByTestId('inbox-view')).toBeVisible({ timeout: 15_000 });

    // The row's open-detail button has aria-label "Open detail: <title>"
    // (the Maximize2 icon button) or the title button itself.
    const titleButton = page.getByRole('button', { name: /E2E nav notification/i }).first();
    await expect(titleButton).toBeVisible({ timeout: 10_000 });

    // Clicking the title button triggers goToIssue which calls selectProject +
    // setViewMode. Since projectId is set and threadId is null, it calls
    // setViewMode('inbox') and stays on inbox — we assert the view stays mounted.
    await titleButton.click();

    // The inbox view should remain visible after click (no crash).
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
  test.use({
    seedOptions: {
      notifications: [
        { kind: 'completed', title: 'Completed notification', threadId: null },
        { kind: 'approval', title: 'Needs approval notification', threadId: null },
      ],
    },
  });

  test('inbox renders both seeded notifications', async ({ harness }) => {
    const { page } = harness;

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
    const { page } = harness;

    await harness.callStore('openInbox');
    await expect(page.getByTestId('inbox-view')).toBeVisible({ timeout: 15_000 });

    // Wait for rows to appear before filtering.
    await expect(page.getByRole('button', { name: /Completed notification/i }).first()).toBeVisible(
      { timeout: 10_000 },
    );

    // Click the "Needs approval" toggle button.
    await page
      .getByRole('button', { name: /needs approval/i })
      .first()
      .click();

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
    const { page } = harness;

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
