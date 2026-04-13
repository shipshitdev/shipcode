import { app, BrowserWindow, Notification } from 'electron';
import {
  filterAttentionRequiredNotifications,
  type NotificationKind,
  type Thread,
} from '@shipcode/shared';
import type { NotificationsQueries, SettingsQueries, ActivityQueries } from '@shipcode/db';

const DEDUPE_WINDOW_MS = 2_000;

function kindToEventFlag(
  kind: NotificationKind,
): keyof import('@shipcode/shared').NotificationEventToggles {
  switch (kind) {
    case 'awaiting_approval':
      return 'awaitingApproval';
    case 'failed':
      return 'failed';
    case 'completed':
      return 'completed';
    case 'verification_exhausted':
      return 'verificationExhausted';
    case 'ci_blocked':
      return 'ciBlocked';
  }
}

function buildCopy(kind: NotificationKind, thread: Thread): { title: string; body: string } {
  const label = thread.title || `Thread ${thread.id.slice(0, 6)}`;
  switch (kind) {
    case 'awaiting_approval':
      return {
        title: 'Plan ready for review',
        body: `${label} — tap to approve or request changes`,
      };
    case 'failed':
      return { title: 'Pipeline failed', body: `${label} ran into an error and stopped` };
    case 'completed':
      return { title: 'Ready to ship', body: `${label} completed — PR is ready` };
    case 'verification_exhausted':
      return {
        title: 'Verification failed',
        body: `${label} hit the retry limit and needs a human`,
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
    this.verificationExhaustedAt.set(threadId, Date.now());
  }

  fire(kind: NotificationKind, thread: Thread) {
    const settings = this.settings.get();
    if (!settings.notificationsEnabled) return;

    // Per-event toggle
    const flag = kindToEventFlag(kind);
    if (!settings.notificationEvents[flag]) return;

    // Suppress 'failed' if verification-exhausted just fired for this thread.
    if (kind === 'failed') {
      const exhaustedAt = this.verificationExhaustedAt.get(thread.id);
      if (exhaustedAt && Date.now() - exhaustedAt < DEDUPE_WINDOW_MS) {
        return;
      }
    }

    // Dedupe identical (threadId, kind) within the window.
    const last = this.lastFiredByThread.get(thread.id);
    if (last && last.kind === kind && Date.now() - last.t < DEDUPE_WINDOW_MS) {
      return;
    }
    this.lastFiredByThread.set(thread.id, { kind, t: Date.now() });

    const { title, body } = buildCopy(kind, thread);

    // Persist
    const record = this.notifications.create({
      threadId: thread.id,
      projectId: thread.projectId,
      kind,
      title,
      body,
    });

    // Log to activity feed
    this.activity.create({
      threadId: thread.id,
      projectId: thread.projectId,
      kind: 'notification_fired',
      actor: 'system',
      title,
      subtitle: body,
      metadata: { notificationId: record.id, notificationKind: kind },
    });

    // In-app toast (always when master enabled)
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('notification:fire', record);
    }

    // OS notification
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

    // Dock badge
    if (settings.notificationBadgeEnabled) this.refreshBadge();
  }

  refreshBadge() {
    const count = filterAttentionRequiredNotifications(this.notifications.listActive()).length;
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setBadge(count > 0 ? String(count) : '');
    }
    // Windows / Linux: no-op for now
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
