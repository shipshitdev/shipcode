import type { ActivityQueries, NotificationsQueries, SettingsQueries } from '@shipcode/db';
import type { NotificationRecord, Thread } from '@shipcode/shared';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  setBadgeMock,
  notificationShowMock,
  notificationOnMock,
  notificationIsSupportedMock,
  notificationClickHandlers,
} = vi.hoisted(() => ({
  setBadgeMock: vi.fn(),
  notificationShowMock: vi.fn(),
  notificationOnMock: vi.fn(),
  notificationIsSupportedMock: vi.fn(() => true),
  notificationClickHandlers: [] as Array<() => void>,
}));

vi.mock('electron', () => {
  class NotificationMock {
    static isSupported = notificationIsSupportedMock;

    on(event: string, handler: () => void) {
      notificationOnMock(event, handler);
      if (event === 'click') notificationClickHandlers.push(handler);
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
    automationId: null,
    lastError: null,
    failurePhase: null,
    failureCount: 0,
    pausedPhase: null,
    pausedAt: null,
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
    doneAt: null,
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
    notificationClickHandlers.length = 0;
    notificationIsSupportedMock.mockReturnValue(true);
    (notificationQueries.listActive as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (notificationQueries.listByThread as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (settingsQueries.get as ReturnType<typeof vi.fn>).mockReturnValue({
      notificationsEnabled: true,
      notificationOsEnabled: true,
      notificationBadgeEnabled: true,
      notificationSoundEnabled: false,
      notificationEvents: {
        approval: true,
        failed: true,
        completed: true,
        verificationExhausted: true,
        ciBlocked: true,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.skipIf(process.platform !== 'darwin')('refreshBadge counts completed notifications', () => {
    (notificationQueries.listActive as ReturnType<typeof vi.fn>).mockReturnValue([
      makeNotificationRecord({ id: 'completed-1', kind: 'completed' }),
      makeNotificationRecord({ id: 'failed-1', kind: 'failed' }),
      makeNotificationRecord({ id: 'awaiting-1', kind: 'approval' }),
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
    expect(notificationQueries.dismissByThread).toHaveBeenCalledWith(thread.id);
  });

  it('fires approval-needed notifications with direct copy', () => {
    const thread = makeThread({ status: 'approval', title: 'Review pricing page' });
    const record = makeNotificationRecord({
      id: 'approval-1',
      kind: 'approval',
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
    service.fire('approval', thread);

    expect(notificationQueries.create).toHaveBeenCalledWith({
      threadId: thread.id,
      projectId: thread.projectId,
      kind: 'approval',
      title: 'Approval needed',
      body: 'Review pricing page is waiting for approval before execution',
    });
    expect(webContentsSendMock).toHaveBeenCalledWith('notification:fire', record);
  });

  it('fires verification-exhausted and CI-blocked notification copy variants', () => {
    const thread = makeThread({ id: 'thread-copy', title: '' });
    (notificationQueries.create as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(
        makeNotificationRecord({ id: 'verification-1', kind: 'verification_exhausted' }),
      )
      .mockReturnValueOnce(
        makeNotificationRecord({ id: 'verification-2', kind: 'verification_exhausted' }),
      )
      .mockReturnValueOnce(makeNotificationRecord({ id: 'ci-1', kind: 'ci_blocked' }));
    const service = new NotificationService(
      mainWindow,
      notificationQueries,
      settingsQueries,
      activityQueries,
    );

    service.fire('verification_exhausted', thread, 'Tests failed with a long summary');
    service.fire('verification_exhausted', makeThread({ id: 'thread-copy-2', title: '' }));
    service.fire('ci_blocked', makeThread({ id: 'thread-copy-3', title: 'CI thread' }));

    expect(notificationQueries.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        title: 'Target verification failed',
        body: expect.stringContaining('Tests failed with a long summary'),
      }),
    );
    expect(notificationQueries.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        body: expect.stringContaining('hit the retry limit'),
      }),
    );
    expect(notificationQueries.create).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        title: 'CI blocked',
        body: 'CI thread has failing pull request checks',
      }),
    );
  });

  it('suppresses a generic failure immediately after verification exhausted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-08T10:00:00Z'));
    const thread = makeThread({ status: 'failed' });
    (notificationQueries.create as ReturnType<typeof vi.fn>).mockReturnValue(
      makeNotificationRecord({ kind: 'failed' }),
    );
    const service = new NotificationService(
      mainWindow,
      notificationQueries,
      settingsQueries,
      activityQueries,
    );

    service.markVerificationExhausted(thread.id);
    service.fire('failed', thread);

    expect(notificationQueries.create).not.toHaveBeenCalled();
    expect(webContentsSendMock).not.toHaveBeenCalledWith('notification:fire', expect.anything());

    vi.setSystemTime(new Date('2026-05-08T10:00:03Z'));
    service.fire('failed', thread);
    expect(notificationQueries.create).toHaveBeenCalledTimes(1);
  });

  it('dedupes identical thread notifications inside the dedupe window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-08T10:00:00Z'));
    const thread = makeThread({ status: 'failed' });
    const service = new NotificationService(
      mainWindow,
      notificationQueries,
      settingsQueries,
      activityQueries,
    );
    (notificationQueries.create as ReturnType<typeof vi.fn>).mockReturnValue(
      makeNotificationRecord({ kind: 'failed' }),
    );

    service.fire('failed', thread);
    service.fire('failed', thread);
    vi.setSystemTime(new Date('2026-05-08T10:00:03Z'));
    service.fire('failed', thread);

    expect(notificationQueries.create).toHaveBeenCalledTimes(2);
  });

  it('focuses the thread when an OS notification is clicked', () => {
    const thread = makeThread({ status: 'failed' });
    const service = new NotificationService(
      mainWindow,
      notificationQueries,
      settingsQueries,
      activityQueries,
    );
    (mainWindow.isMinimized as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    (notificationQueries.create as ReturnType<typeof vi.fn>).mockReturnValue(
      makeNotificationRecord({ kind: 'failed' }),
    );

    service.fire('failed', thread);
    notificationClickHandlers[0]?.();

    expect(mainWindow.restore).toHaveBeenCalled();
    expect(mainWindow.show).toHaveBeenCalled();
    expect(mainWindow.focus).toHaveBeenCalled();
    expect(webContentsSendMock).toHaveBeenCalledWith('notification:focus-thread', {
      threadId: thread.id,
      projectId: thread.projectId,
    });
  });

  it('ignores OS notification clicks after the window is destroyed', () => {
    const thread = makeThread({ status: 'failed' });
    const service = new NotificationService(
      mainWindow,
      notificationQueries,
      settingsQueries,
      activityQueries,
    );
    (mainWindow.isDestroyed as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    (notificationQueries.create as ReturnType<typeof vi.fn>).mockReturnValue(
      makeNotificationRecord({ kind: 'failed' }),
    );

    service.fire('failed', thread);
    (mainWindow.isDestroyed as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    notificationClickHandlers[0]?.();

    expect(mainWindow.show).not.toHaveBeenCalled();
    expect(webContentsSendMock).not.toHaveBeenCalledWith(
      'notification:focus-thread',
      expect.anything(),
    );
  });

  it('skips OS notifications and badge refresh when those settings are disabled', () => {
    (settingsQueries.get as ReturnType<typeof vi.fn>).mockReturnValue({
      notificationsEnabled: true,
      notificationOsEnabled: false,
      notificationBadgeEnabled: false,
      notificationSoundEnabled: true,
      notificationEvents: {
        approval: true,
        failed: true,
        completed: true,
        verificationExhausted: true,
        ciBlocked: true,
      },
    });
    (notificationQueries.create as ReturnType<typeof vi.fn>).mockReturnValue(
      makeNotificationRecord(),
    );
    const service = new NotificationService(
      mainWindow,
      notificationQueries,
      settingsQueries,
      activityQueries,
    );

    service.fire('failed', makeThread({ status: 'failed' }));

    expect(notificationShowMock).not.toHaveBeenCalled();
    expect(setBadgeMock).not.toHaveBeenCalled();
  });

  it('does not create records when notifications or event kinds are disabled', () => {
    const service = new NotificationService(
      mainWindow,
      notificationQueries,
      settingsQueries,
      activityQueries,
    );

    (settingsQueries.get as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      notificationsEnabled: false,
      notificationEvents: {
        approval: true,
        failed: true,
        completed: true,
        verificationExhausted: true,
        ciBlocked: true,
      },
    });
    service.fire('completed', makeThread());

    (settingsQueries.get as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      notificationsEnabled: true,
      notificationEvents: {
        approval: true,
        failed: true,
        completed: false,
        verificationExhausted: true,
        ciBlocked: true,
      },
    });
    service.fire('completed', makeThread({ id: 'thread-2' }));

    expect(notificationQueries.create).not.toHaveBeenCalled();
  });

  it('lists and dismisses active notifications while updating renderer state', () => {
    const service = new NotificationService(
      mainWindow,
      notificationQueries,
      settingsQueries,
      activityQueries,
    );
    const active = [
      makeNotificationRecord({ id: 'notification-1' }),
      makeNotificationRecord({ id: 'notification-2', kind: 'failed' }),
    ];
    (notificationQueries.listActive as ReturnType<typeof vi.fn>).mockReturnValue(active);
    (notificationQueries.listByThread as ReturnType<typeof vi.fn>).mockReturnValue(active);

    expect(service.listActive()).toBe(active);

    service.dismissByThread('thread-1');
    expect(notificationQueries.dismissByThread).toHaveBeenCalledWith('thread-1');
    expect(webContentsSendMock).toHaveBeenCalledWith('notification:dismiss', {
      id: 'notification-1',
    });
    expect(webContentsSendMock).toHaveBeenCalledWith('notification:dismiss', {
      id: 'notification-2',
    });

    service.dismiss('notification-1');
    expect(notificationQueries.dismiss).toHaveBeenCalledWith('notification-1');
    expect(webContentsSendMock).toHaveBeenCalledWith('notification:dismiss', {
      id: 'notification-1',
    });

    service.dismissAll();
    expect(notificationQueries.dismissAll).toHaveBeenCalled();
    expect(webContentsSendMock).toHaveBeenCalledWith('notification:dismiss', {
      id: 'notification-2',
    });
  });

  it('does not send dismiss events when the main window is destroyed', () => {
    (mainWindow.isDestroyed as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const service = new NotificationService(
      mainWindow,
      notificationQueries,
      settingsQueries,
      activityQueries,
    );
    (notificationQueries.listByThread as ReturnType<typeof vi.fn>).mockReturnValue([
      makeNotificationRecord({ id: 'notification-thread' }),
    ]);
    (notificationQueries.listActive as ReturnType<typeof vi.fn>).mockReturnValue([
      makeNotificationRecord({ id: 'notification-active' }),
    ]);

    service.dismissByThread('thread-1');
    service.dismiss('notification-1');
    service.dismissAll();

    expect(webContentsSendMock).not.toHaveBeenCalledWith('notification:dismiss', expect.anything());
  });
});
