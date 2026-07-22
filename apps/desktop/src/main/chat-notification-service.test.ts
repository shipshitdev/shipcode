import type { ProjectQueries, SettingsQueries } from '@shipcode/db';
import type { PipelinePhase, Project, Thread } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatNotificationService } from './chat-notification-service';
import log from './logger.service';

vi.mock('./logger.service', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

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
    status: 'approval',
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
    pausedPhase: null,
    pausedAt: null,
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

  function makeService() {
    return new ChatNotificationService(
      { get: getSettingsMock, set: setSettingsMock } as unknown as SettingsQueries,
      { getById: getProjectMock } as unknown as ProjectQueries,
    );
  }

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

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends actionable events to both configured providers', async () => {
    const service = makeService();

    service.fire('approval', makeThread());
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

  it('reads decrypted credentials through the main-process credential boundary', async () => {
    getSettingsMock.mockReturnValue({
      ...DEFAULT_SETTINGS,
      discordEnabled: true,
      discordWebhookUrl: 'safe-storage:v1:ciphertext',
      telegramEnabled: false,
    });
    const getMainSettings = vi.fn(() => ({
      ...DEFAULT_SETTINGS,
      discordEnabled: true,
      discordWebhookUrl: 'https://discord.com/api/webhooks/123/decrypted',
      telegramEnabled: false,
    }));
    const service = new ChatNotificationService(
      { get: getSettingsMock, set: setSettingsMock } as unknown as SettingsQueries,
      { getById: getProjectMock } as unknown as ProjectQueries,
      { getMainSettings },
    );

    await service.sendTest('discord');

    expect(getMainSettings).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://discord.com/api/webhooks/123/decrypted',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('respects chat notification event toggles', async () => {
    getSettingsMock.mockReturnValue({
      ...DEFAULT_SETTINGS,
      discordEnabled: true,
      discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
      telegramEnabled: false,
      chatNotificationEvents: {
        ...DEFAULT_SETTINGS.chatNotificationEvents,
        approval: false,
      },
    });
    const service = makeService();

    service.fire('approval', makeThread());
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
    const service = makeService();

    await service.sendTest('discord', 'project-1');
    await service.sendTest('telegram', 'project-1');

    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toContain('/999/override');
    expect(calls[1][1]?.body).toContain('-100555');
  });

  it('dedupes identical notifications within the dedupe window', async () => {
    const service = makeService();

    service.fire('failed', makeThread({ status: 'failed' }));
    service.fire('failed', makeThread({ status: 'failed' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('logs background delivery persistence failures instead of rejecting unobserved', async () => {
    getSettingsMock.mockReturnValue({
      ...DEFAULT_SETTINGS,
      discordEnabled: true,
      discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
      telegramEnabled: false,
    });
    setSettingsMock.mockImplementationOnce(() => {
      throw new Error('settings write failed');
    });
    const service = makeService();

    service.fire('failed', makeThread({ status: 'failed' }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(log.error).toHaveBeenCalledWith(
      '[chat-notifications] discord delivery failed',
      expect.objectContaining({ message: 'settings write failed' }),
    );
  });

  it('skips delivery when the project no longer exists', async () => {
    getProjectMock.mockReturnValue(null);
    const service = makeService();

    service.fire('approval', makeThread());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).not.toHaveBeenCalled();
    expect(setSettingsMock).not.toHaveBeenCalled();
  });

  it('respects project-level disabled routing', async () => {
    getProjectMock.mockReturnValue(
      makeProject({
        discordRouting: 'disabled',
        telegramRouting: 'disabled',
      }),
    );
    const service = makeService();

    await expect(service.sendTest('discord', 'project-1')).resolves.toEqual({
      ok: false,
      message: 'Discord is not configured for this scope',
    });
    await expect(service.sendTest('telegram', 'project-1')).resolves.toEqual({
      ok: false,
      message: 'Telegram is not configured for this scope',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('records a failed delivery status after retry exhaustion', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited by provider', { status: 429 })),
    );
    const service = makeService();

    const resultPromise = service.sendTest('discord');
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await resultPromise;

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining('HTTP 429'),
    });
    expect(setSettingsMock).toHaveBeenCalledWith({
      discordLastDeliveryStatus: expect.objectContaining({
        provider: 'discord',
        destination: 'discord-webhook',
        lastSuccessAt: null,
        lastError: expect.stringContaining('HTTP 429'),
      }),
    });
  });

  it('formats all terminal notification kinds with fallback task text and failure summary', async () => {
    getSettingsMock.mockReturnValue({
      ...DEFAULT_SETTINGS,
      discordEnabled: true,
      discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
      telegramEnabled: true,
      telegramBotToken: '123456:abcdefghijklmnopqrstuvwx',
      telegramDefaultChatId: '-1001234567890',
      chatNotificationEvents: {
        ...DEFAULT_SETTINGS.chatNotificationEvents,
        completed: true,
      },
    });
    const service = makeService();

    service.fire(
      'completed',
      makeThread({
        id: 'thread-completed',
        title: '',
        status: 'completed',
        githubRepo: null,
        githubIssueNumber: null,
        githubPrNumber: null,
      }),
    );
    service.fire(
      'verification_exhausted',
      makeThread({
        id: 'thread-verify',
        status: 'failed',
      }),
      'x'.repeat(250),
    );
    service.fire(
      'ci_blocked',
      makeThread({
        id: 'thread-ci',
        status: 'blocked' as PipelinePhase,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const bodies = (fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      ([, init]) => JSON.parse((init as RequestInit).body as string) as { content?: string },
    );
    expect(bodies.some((body) => body.content?.includes('ShipCode: Ready to ship'))).toBe(true);
    expect(bodies.some((body) => body.content?.includes('Task: Thread thread'))).toBe(true);
    expect(
      bodies.some((body) => body.content?.includes('ShipCode: Target verification failed')),
    ).toBe(true);
    expect(bodies.some((body) => body.content?.includes(`Failure: ${'x'.repeat(200)}`))).toBe(true);
    expect(bodies.some((body) => body.content?.includes('ShipCode: CI blocked'))).toBe(true);
  });

  it('rejects globally disabled and invalid provider configuration for test sends', async () => {
    getSettingsMock.mockReturnValue({
      ...DEFAULT_SETTINGS,
      discordEnabled: false,
      discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
      telegramEnabled: false,
      telegramBotToken: '123456:abcdefghijklmnopqrstuvwx',
      telegramDefaultChatId: '-1001234567890',
    });
    const service = makeService();

    await expect(service.sendTest('discord')).resolves.toEqual({
      ok: false,
      message: 'Discord is not configured for this scope',
    });
    await expect(service.sendTest('telegram')).resolves.toEqual({
      ok: false,
      message: 'Telegram is not configured for this scope',
    });

    getSettingsMock.mockReturnValue({
      ...DEFAULT_SETTINGS,
      discordEnabled: true,
      discordWebhookUrl: 'https://example.com/not-discord',
      telegramEnabled: true,
      telegramBotToken: 'bad-token',
      telegramDefaultChatId: '',
    });

    await expect(service.sendTest('discord')).resolves.toEqual({
      ok: false,
      message: 'Discord is not configured for this scope',
    });
    await expect(service.sendTest('telegram')).resolves.toEqual({
      ok: false,
      message: 'Telegram is not configured for this scope',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects blank custom project routes instead of falling back to global destinations', async () => {
    getProjectMock.mockReturnValue(
      makeProject({
        discordRouting: 'custom',
        discordWebhookUrlOverride: '   ',
        telegramRouting: 'custom',
        telegramChatIdOverride: '   ',
      }),
    );
    const service = makeService();

    await expect(service.sendTest('discord', 'project-1')).resolves.toEqual({
      ok: false,
      message: 'Discord is not configured for this scope',
    });
    await expect(service.sendTest('telegram', 'project-1')).resolves.toEqual({
      ok: false,
      message: 'Telegram is not configured for this scope',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses global routes for missing project scopes and rejects null custom destinations', async () => {
    getProjectMock.mockReturnValueOnce(null);
    const service = makeService();

    await expect(service.sendTest('discord', 'missing-project')).resolves.toEqual({
      ok: true,
      message: 'Discord test sent',
    });

    getProjectMock.mockReturnValue(
      makeProject({
        discordRouting: 'custom',
        discordWebhookUrlOverride: null,
        telegramRouting: 'custom',
        telegramChatIdOverride: null,
      }),
    );
    await expect(service.sendTest('discord', 'project-1')).resolves.toEqual({
      ok: false,
      message: 'Discord is not configured for this scope',
    });
    await expect(service.sendTest('telegram', 'project-1')).resolves.toEqual({
      ok: false,
      message: 'Telegram is not configured for this scope',
    });

    getSettingsMock.mockReturnValue({
      ...DEFAULT_SETTINGS,
      discordEnabled: true,
      discordWebhookUrl: null,
      telegramEnabled: true,
      telegramBotToken: null,
      telegramDefaultChatId: null,
    });
    getProjectMock.mockReturnValue(null);
    await expect(service.sendTest('discord')).resolves.toEqual({
      ok: false,
      message: 'Discord is not configured for this scope',
    });
    await expect(service.sendTest('telegram')).resolves.toEqual({
      ok: false,
      message: 'Telegram is not configured for this scope',
    });

    getSettingsMock.mockReturnValue({
      ...DEFAULT_SETTINGS,
      discordEnabled: false,
      telegramEnabled: true,
      telegramBotToken: '123456:abcdefghijklmnopqrstuvwx',
      telegramDefaultChatId: null,
    });
    await expect(service.sendTest('telegram')).resolves.toEqual({
      ok: false,
      message: 'Telegram is not configured for this scope',
    });
  });

  it('reports Telegram delivery failures and fetch exceptions after retries', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );
    const service = makeService();

    const telegramResultPromise = service.sendTest('telegram');
    await vi.advanceTimersByTimeAsync(2_000);
    const telegramResult = await telegramResultPromise;

    expect(telegramResult).toMatchObject({
      ok: false,
      message: 'Telegram test failed: HTTP 500',
    });
    expect(setSettingsMock).toHaveBeenCalledWith({
      telegramLastDeliveryStatus: expect.objectContaining({
        provider: 'telegram',
        destination: '-1001234567890',
        lastError: 'HTTP 500',
      }),
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('network is down'))),
    );
    const discordResultPromise = service.sendTest('discord');
    await vi.advanceTimersByTimeAsync(2_000);
    const discordResult = await discordResultPromise;

    expect(discordResult).toMatchObject({
      ok: false,
      message: 'Discord test failed: network is down',
    });
    expect(setSettingsMock).toHaveBeenCalledWith({
      discordLastDeliveryStatus: expect.objectContaining({
        lastError: 'network is down',
      }),
    });
  });
});
