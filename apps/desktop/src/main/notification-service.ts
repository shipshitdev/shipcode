import type { ActivityQueries, NotificationsQueries, SettingsQueries } from '@shipcode/db';
import {
  filterAttentionRequiredNotifications,
  type NotificationKind,
  notificationEventFlagForKind,
  type Thread,
} from '@shipcode/shared';
import { app, type BrowserWindow, Notification } from 'electron';

const DEDUPE_WINDOW_MS = 2_000;

function buildCopy(
  kind: NotificationKind,
  thread: Thread,
  testSummary?: string,
): { title: string; body: string } {
  const label = thread.title || `Thread ${thread.id.slice(0, 6)}`;
  switch (kind) {
    case 'approval':
      return {
        title: 'Approval needed',
        body: `${label} is waiting for approval before execution`,
      };
    case 'failed':
      return {
        title: 'Pipeline stopped',
        body: `${label} failed in the target project or worktree`,
      };
    case 'completed':
      return { title: 'Ready to ship', body: `${label} completed — PR is ready` };
    case 'verification_exhausted':
      return {
        title: 'Target verification failed',
        body: testSummary
          ? `${label} — ${testSummary.slice(0, 180)}`
          : `${label} hit the retry limit while running build/test commands in the worktree`,
      };
    case 'ci_blocked':
      return {
        title: 'CI blocked',
        body: `${label} has failing pull request checks`,
      };
  }
}

interface LastFired {
  kind: NotificationKind;
  t: number;
}

export class NotificationService {
  private lastFiredByThread = new Map<string, LastFired>();
  // When verification-exhausted fires, we suppress the subsequent generic
  // 'failed' notification for this thread within the dedupe window so the
  // user only sees one notification for the same underlying event.
  private verificationExhaustedAt = new Map<string, number>();

  constructor(
    private mainWindow: BrowserWindow,
    private notifications: NotificationsQueries,
    private settings: SettingsQueries,
    private activity: ActivityQueries,
  ) {}

  markVerificationExhausted(threadId: string) {
    const now = Date.now();
    this.pruneDedupeState(now);
    this.verificationExhaustedAt.set(threadId, now);
  }

  fire(kind: NotificationKind, thread: Thread, testSummary?: string) {
    const now = Date.now();
    this.pruneDedupeState(now);
    const settings = this.settings.get();
    if (!settings.notificationsEnabled) return;

    const flag = notificationEventFlagForKind(kind);
    if (!settings.notificationEvents[flag]) return;

    // Suppress 'failed' if verification-exhausted just fired for this thread.
    if (kind === 'failed') {
      const exhaustedAt = this.verificationExhaustedAt.get(thread.id);
      if (exhaustedAt && now - exhaustedAt < DEDUPE_WINDOW_MS) {
        return;
      }
    }

    // Dedupe identical (threadId, kind) within the window.
    const last = this.lastFiredByThread.get(thread.id);
    if (last && last.kind === kind && now - last.t < DEDUPE_WINDOW_MS) {
      return;
    }
    this.lastFiredByThread.set(thread.id, { kind, t: now });

    // Clear prior notifications (failed, verification_exhausted, etc.) before
    // creating the completed notification so stale failures don't linger in the inbox.
    if (kind === 'completed') {
      this.dismissByThread(thread.id);
    }

    const { title, body } = buildCopy(kind, thread, testSummary);

    const record = this.notifications.create({
      threadId: thread.id,
      projectId: thread.projectId,
      kind,
      title,
      body,
    });

    this.activity.create({
      threadId: thread.id,
      projectId: thread.projectId,
      kind: 'notification_fired',
      actor: 'system',
      title,
      subtitle: body,
      metadata: { notificationId: record.id, notificationKind: kind },
    });

    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('notification:fire', record);
    }

    if (settings.notificationOsEnabled && Notification.isSupported()) {
      const n = new Notification({
        title,
        body,
        silent: !settings.notificationSoundEnabled,
      });
      n.on('click', () => {
        if (this.mainWindow.isDestroyed()) return;
        if (this.mainWindow.isMinimized()) this.mainWindow.restore();
        this.mainWindow.show();
        this.mainWindow.focus();
        this.mainWindow.webContents.send('notification:focus-thread', {
          threadId: thread.id,
          projectId: thread.projectId,
        });
      });
      n.show();
    }

    if (settings.notificationBadgeEnabled) this.refreshBadge();
  }

  private pruneDedupeState(now: number): void {
    for (const [threadId, last] of this.lastFiredByThread) {
      if (now - last.t >= DEDUPE_WINDOW_MS) this.lastFiredByThread.delete(threadId);
    }
    for (const [threadId, exhaustedAt] of this.verificationExhaustedAt) {
      if (now - exhaustedAt >= DEDUPE_WINDOW_MS) {
        this.verificationExhaustedAt.delete(threadId);
      }
    }
  }

  refreshBadge() {
    const count = filterAttentionRequiredNotifications(this.notifications.listActive()).length;
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setBadge(count > 0 ? String(count) : '');
    }
  }

  listActive() {
    return this.notifications.listActive();
  }

  dismissByThread(threadId: string) {
    const active = this.notifications.listByThread(threadId);
    this.notifications.dismissByThread(threadId);
    this.refreshBadge();
    if (!this.mainWindow.isDestroyed()) {
      for (const n of active) {
        this.mainWindow.webContents.send('notification:dismiss', { id: n.id });
      }
    }
  }

  dismiss(id: string) {
    this.notifications.dismiss(id);
    this.refreshBadge();
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('notification:dismiss', { id });
    }
  }

  dismissAll() {
    const active = this.notifications.listActive();
    this.notifications.dismissAll();
    this.refreshBadge();
    if (!this.mainWindow.isDestroyed()) {
      for (const n of active) {
        this.mainWindow.webContents.send('notification:dismiss', { id: n.id });
      }
    }
  }
}
