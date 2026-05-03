import type { ProjectQueries, SettingsQueries } from '@shipcode/db';
import type { Project, Thread } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatNotificationService } from './chat-notification-service';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'ShipCode',
    path: '/tmp/shipcode',
    gitRemote: 'git@github.com:shipshitdev/shipcode.git',
    githubRepoId: null,
    githubRepoFullName: null,
    starterIssueNumber: null,
    starterIssueCreatedAt: null,
    githubProjectUrl: null,
    githubStatusMapping: null,
    plannerModelOverride: null,
    reviewerModelOverride: null,
    executorModelOverride: null,
    verifierModelOverride: null,
    plannerModelIdOverride: null,
    reviewerModelIdOverride: null,
    executorModelIdOverride: null,
    verifierModelIdOverride: null,
    plannerReasoningEffortOverride: null,
    reviewerReasoningEffortOverride: null,
    executorReasoningEffortOverride: null,
    verifierReasoningEffortOverride: null,
    revisionCountOverride: null,
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Test task',
    prompt: 'Do it',
    status: 'awaiting_approval',
    kind: 'pipeline' as const,
    worktreeBranch: null,
    worktreePath: null,
    plannerModel: 'claude',
    reviewerModel: 'codex',
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
    githubPrNumber: 99,
    githubRepo: 'shipshitdev/shipcode',
    automationId: null,
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
    totalTokensPrompt: 0,
    totalTokensCompletion: 0,
    totalCostUsd: 0,
    doneAt: null,
    ...overrides,
  };
}

describe('ChatNotificationService', () => {
  const getSettingsMock = vi.fn();
  const setSettingsMock = vi.fn();
  const getProjectMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));
    getSettingsMock.mockReturnValue({
      ...DEFAULT_SETTINGS,
      discordEnabled: true,
      discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
      telegramEnabled: true,
      telegramBotToken: '123456:abcdefghijklmnopqrstuvwx',
      telegramDefaultChatId: '-1001234567890',
    });
    getProjectMock.mockReturnValue(makeProject());
  });

  it('sends actionable events to both configured providers', async () => {
    const service = new ChatNotificationService(
      { get: getSettingsMock, set: setSettingsMock } as unknown as SettingsQueries,
      { getById: getProjectMock } as unknown as ProjectQueries,
    );

    service.fire('awaiting_approval', makeThread());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).toHaveBeenCalledTimes(2);
    const discordBody = JSON.parse(
      ((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string,
    ) as {
      content?: string;
    };
    expect(discordBody.content).toContain('ShipCode: Needs approval');
    expect(setSettingsMock).toHaveBeenCalledTimes(2);
  });

  it('respects chat notification event toggles', async () => {
    getSettingsMock.mockReturnValue({
      ...DEFAULT_SETTINGS,
      discordEnabled: true,
      discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
      telegramEnabled: false,
      chatNotificationEvents: {
        ...DEFAULT_SETTINGS.chatNotificationEvents,
        awaitingApproval: false,
      },
    });
    const service = new ChatNotificationService(
      { get: getSettingsMock, set: setSettingsMock } as unknown as SettingsQueries,
      { getById: getProjectMock } as unknown as ProjectQueries,
    );

    service.fire('awaiting_approval', makeThread());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses project overrides when routing is custom', async () => {
    getProjectMock.mockReturnValue(
      makeProject({
        discordRouting: 'custom',
        discordWebhookUrlOverride: 'https://discord.com/api/webhooks/999/override',
        telegramRouting: 'custom',
        telegramChatIdOverride: '-100555',
      }),
    );
    const service = new ChatNotificationService(
      { get: getSettingsMock, set: setSettingsMock } as unknown as SettingsQueries,
      { getById: getProjectMock } as unknown as ProjectQueries,
    );

    await service.sendTest('discord', 'project-1');
    await service.sendTest('telegram', 'project-1');

    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toContain('/999/override');
    expect(calls[1][1]?.body).toContain('-100555');
  });

  it('dedupes identical notifications within the dedupe window', async () => {
    const service = new ChatNotificationService(
      { get: getSettingsMock, set: setSettingsMock } as unknown as SettingsQueries,
      { getById: getProjectMock } as unknown as ProjectQueries,
    );

    service.fire('failed', makeThread({ status: 'failed' }));
    service.fire('failed', makeThread({ status: 'failed' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
