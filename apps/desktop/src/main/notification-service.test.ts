import type { ActivityQueries, NotificationsQueries, SettingsQueries } from '@shipcode/db';
import type { NotificationRecord, Thread } from '@shipcode/shared';
import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { setBadgeMock, notificationShowMock, notificationOnMock, notificationIsSupportedMock } =
  vi.hoisted(() => ({
    setBadgeMock: vi.fn(),
    notificationShowMock: vi.fn(),
    notificationOnMock: vi.fn(),
    notificationIsSupportedMock: vi.fn(() => true),
  }));

vi.mock('electron', () => {
  class NotificationMock {
    static isSupported = notificationIsSupportedMock;

    on(event: string, handler: () => void) {
      notificationOnMock(event, handler);
      return this;
    }

    show() {
      notificationShowMock();
    }
  }

  return {
    app: {
      dock: {
        setBadge: setBadgeMock,
      },
    },
    BrowserWindow: class BrowserWindowMock {},
    Notification: NotificationMock,
  };
});

import { NotificationService } from './notification-service';

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Test thread',
    prompt: 'Do the thing',
    status: 'completed',
    worktreeBranch: null,
    worktreePath: null,
    plannerModel: 'claude',
    reviewerModel: 'claude',
    executorModel: 'claude',
    verifierModel: 'claude',
    reviewRound: 0,
    clarificationRound: 0,
    clarificationRequest: null,
    clarificationAnswers: [],
    answeredClarification: null,
    verificationStatus: null,
    verificationRetries: 0,
    autonomous: false,
    baseBranch: null,
    forkPointSha: null,
    githubIssueNumber: 42,
    githubPrNumber: 101,
    githubRepo: 'owner/repo',
    lastError: null,
    failurePhase: null,
    failureCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plannerResolvedModel: null,
    reviewerResolvedModel: null,
    revisorResolvedModel: null,
    executorResolvedModel: null,
    verifierResolvedModel: null,
    kind: 'pipeline' as const,
    totalTokensPrompt: 0,
    totalTokensCompletion: 0,
    totalCostUsd: 0,
    ...overrides,
  };
}

function makeNotificationRecord(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 'notification-1',
    threadId: 'thread-1',
    projectId: 'project-1',
    kind: 'completed',
    title: 'Ready to ship',
    body: 'Test thread completed — PR is ready',
    createdAt: new Date().toISOString(),
    dismissedAt: null,
    ...overrides,
  };
}

describe('NotificationService', () => {
  const webContentsSendMock = vi.fn();
  const mainWindow = {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: {
      send: webContentsSendMock,
    },
  } as unknown as BrowserWindow;

  const notificationQueries = {
    create: vi.fn(),
    listActive: vi.fn(),
    listByThread: vi.fn(),
    dismissByThread: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  } as unknown as NotificationsQueries;

  const settingsQueries = {
    get: vi.fn(),
  } as unknown as SettingsQueries;

  const activityQueries = {
    create: vi.fn(),
  } as unknown as ActivityQueries;

  beforeEach(() => {
    vi.clearAllMocks();
    (notificationQueries.listActive as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (settingsQueries.get as ReturnType<typeof vi.fn>).mockReturnValue({
      notificationsEnabled: true,
      notificationOsEnabled: true,
      notificationBadgeEnabled: true,
      notificationSoundEnabled: false,
      notificationEvents: {
        awaitingApproval: true,
        failed: true,
        completed: true,
        verificationExhausted: true,
        ciBlocked: true,
      },
    });
  });

  it.skipIf(process.platform !== 'darwin')('refreshBadge counts completed notifications', () => {
    (notificationQueries.listActive as ReturnType<typeof vi.fn>).mockReturnValue([
      makeNotificationRecord({ id: 'completed-1', kind: 'completed' }),
      makeNotificationRecord({ id: 'failed-1', kind: 'failed' }),
      makeNotificationRecord({ id: 'awaiting-1', kind: 'awaiting_approval' }),
    ]);

    const service = new NotificationService(
      mainWindow,
      notificationQueries,
      settingsQueries,
      activityQueries,
    );
    service.refreshBadge();

    expect(setBadgeMock).toHaveBeenCalledWith('3');
  });

  it('fires completed notifications as informational toasts and activity entries', () => {
    const thread = makeThread();
    const record = makeNotificationRecord();
    (notificationQueries.create as ReturnType<typeof vi.fn>).mockReturnValue(record);

    const service = new NotificationService(
      mainWindow,
      notificationQueries,
      settingsQueries,
      activityQueries,
    );
    service.fire('completed', thread);

    expect(notificationQueries.create).toHaveBeenCalledWith({
      threadId: thread.id,
      projectId: thread.projectId,
      kind: 'completed',
      title: 'Ready to ship',
      body: 'Test thread completed — PR is ready',
    });
    expect(activityQueries.create).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: thread.id,
        projectId: thread.projectId,
        kind: 'notification_fired',
        metadata: { notificationId: record.id, notificationKind: 'completed' },
      }),
    );
    expect(webContentsSendMock).toHaveBeenCalledWith('notification:fire', record);
    expect(notificationShowMock).toHaveBeenCalledTimes(1);
  });

  it('fires approval-needed notifications with direct copy', () => {
    const thread = makeThread({ status: 'awaiting_approval', title: 'Review pricing page' });
    const record = makeNotificationRecord({
      id: 'approval-1',
      kind: 'awaiting_approval',
      title: 'Approval needed',
      body: 'Review pricing page is waiting for approval before execution',
    });
    (notificationQueries.create as ReturnType<typeof vi.fn>).mockReturnValue(record);

    const service = new NotificationService(
      mainWindow,
      notificationQueries,
      settingsQueries,
      activityQueries,
    );
    service.fire('awaiting_approval', thread);

    expect(notificationQueries.create).toHaveBeenCalledWith({
      threadId: thread.id,
      projectId: thread.projectId,
      kind: 'awaiting_approval',
      title: 'Approval needed',
      body: 'Review pricing page is waiting for approval before execution',
    });
    expect(webContentsSendMock).toHaveBeenCalledWith('notification:fire', record);
  });
});
