import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationRecord, Thread } from '@shipcode/shared';

const {
  setBadgeMock,
  notificationShowMock,
  notificationOnMock,
  notificationIsSupportedMock,
} = vi.hoisted(() => ({
  setBadgeMock: vi.fn(),
  notificationShowMock: vi.fn(),
  notificationOnMock: vi.fn(),
  notificationIsSupportedMock: vi.fn(() => true),
}));

vi.mock('electron', () => {
  class NotificationMock {
    static isSupported = notificationIsSupportedMock;

    constructor(_options: unknown) {}

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
    verificationStatus: null,
    verificationRetries: 0,
    autonomous: false,
    baseBranch: null,
    forkPointSha: null,
    githubIssueNumber: 42,
    githubPrNumber: 101,
    githubRepo: 'owner/repo',
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plannerResolvedModel: null,
    reviewerResolvedModel: null,
    revisorResolvedModel: null,
    executorResolvedModel: null,
    verifierResolvedModel: null,
    totalTokensPrompt: 0,
    totalTokensCompletion: 0,
    totalCostUsd: 0,
    ...overrides,
  };
}

function makeNotificationRecord(
  overrides: Partial<NotificationRecord> = {},
): NotificationRecord {
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
  } as any;

  const notifications = {
    create: vi.fn(),
    listActive: vi.fn(),
    listByThread: vi.fn(),
    dismissByThread: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  } as any;

  const settings = {
    get: vi.fn(),
  } as any;

  const activity = {
    create: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    settings.get.mockReturnValue({
      notificationsEnabled: true,
      notificationOsEnabled: true,
      notificationBadgeEnabled: true,
      notificationSoundEnabled: false,
      notificationEvents: {
        awaitingApproval: true,
        failed: true,
        completed: true,
        verificationExhausted: true,
      },
    });
  });

  it('refreshBadge ignores completed notifications', () => {
    notifications.listActive.mockReturnValue([
      makeNotificationRecord({ id: 'completed-1', kind: 'completed' }),
      makeNotificationRecord({ id: 'failed-1', kind: 'failed' }),
      makeNotificationRecord({ id: 'awaiting-1', kind: 'awaiting_approval' }),
    ]);

    const service = new NotificationService(mainWindow, notifications, settings, activity);
    service.refreshBadge();

    expect(setBadgeMock).toHaveBeenCalledWith('2');
  });

  it('fires completed notifications as informational toasts and activity entries', () => {
    const thread = makeThread();
    const record = makeNotificationRecord();
    notifications.create.mockReturnValue(record);

    const service = new NotificationService(mainWindow, notifications, settings, activity);
    service.fire('completed', thread);

    expect(notifications.create).toHaveBeenCalledWith({
      threadId: thread.id,
      projectId: thread.projectId,
      kind: 'completed',
      title: 'Ready to ship',
      body: 'Test thread completed — PR is ready',
    });
    expect(activity.create).toHaveBeenCalledWith(
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
});
