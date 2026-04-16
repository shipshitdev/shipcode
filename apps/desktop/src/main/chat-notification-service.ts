import type { ProjectQueries, SettingsQueries } from '@shipcode/db';
import type {
  IntegrationDeliveryStatus,
  NotificationKind,
  Project,
  Thread,
} from '@shipcode/shared';
import { clampError, notificationEventFlagForKind } from '@shipcode/shared';
import log from './logger.service';

const DEDUPE_WINDOW_MS = 2_000;
const RETRY_DELAYS_MS = [0, 500, 1_500] as const;
const DISCORD_WEBHOOK_RE = /^https:\/\/(?:discord(?:app)?\.com)\/api\/webhooks\/[^/\s]+\/[^/\s]+$/i;
const TELEGRAM_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{20,}$/;

function kindLabel(kind: NotificationKind): string {
  switch (kind) {
    case 'awaiting_approval':
      return 'Awaiting approval';
    case 'failed':
      return 'Pipeline failed';
    case 'completed':
      return 'Ready to ship';
    case 'verification_exhausted':
      return 'Verification exhausted';
    case 'ci_blocked':
      return 'CI blocked';
  }
}

function buildGitHubIssueUrl(thread: Thread): string | null {
  if (!thread.githubRepo || !thread.githubIssueNumber) return null;
  return `https://github.com/${thread.githubRepo}/issues/${thread.githubIssueNumber}`;
}

function buildGitHubPrUrl(thread: Thread): string | null {
  if (!thread.githubRepo || !thread.githubPrNumber) return null;
  return `https://github.com/${thread.githubRepo}/pull/${thread.githubPrNumber}`;
}

function buildMessage(kind: NotificationKind, thread: Thread, project: Project): string {
  const lines = [
    `ShipCode: ${kindLabel(kind)}`,
    `Project: ${project.name}`,
    `Task: ${thread.title || `Thread ${thread.id.slice(0, 6)}`}`,
    `Status: ${thread.status}`,
  ];
  const issueUrl = buildGitHubIssueUrl(thread);
  const prUrl = buildGitHubPrUrl(thread);
  if (issueUrl) lines.push(`Issue: ${issueUrl}`);
  if (prUrl) lines.push(`PR: ${prUrl}`);
  return lines.join('\n');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DiscordRoute {
  webhookUrl: string;
  destination: string;
}

interface TelegramRoute {
  botToken: string;
  chatId: string;
  destination: string;
}

export class ChatNotificationService {
  private lastSentAt = new Map<string, number>();

  constructor(
    private settings: SettingsQueries,
    private projects: ProjectQueries,
  ) {}

  fire(kind: NotificationKind, thread: Thread) {
    void this.deliver(kind, thread);
  }

  async sendTest(provider: 'discord' | 'telegram', projectId: string | null = null) {
    const settings = this.settings.get();
    const project = projectId ? this.projects.getById(projectId) : null;
    const message = [
      'ShipCode test alert',
      `Scope: ${project?.name ?? 'Global settings'}`,
      `Time: ${new Date().toISOString()}`,
    ].join('\n');

    if (provider === 'discord') {
      const route = this.resolveDiscordRoute(settings, project);
      if (!route) return { ok: false, message: 'Discord is not configured for this scope' };
      const result = await this.sendDiscord(route, message);
      return {
        ok: !result.lastError,
        message: result.lastError
          ? `Discord test failed: ${result.lastError}`
          : 'Discord test sent',
      };
    }

    const route = this.resolveTelegramRoute(settings, project);
    if (!route) return { ok: false, message: 'Telegram is not configured for this scope' };
    const result = await this.sendTelegram(route, message);
    return {
      ok: !result.lastError,
      message: result.lastError
        ? `Telegram test failed: ${result.lastError}`
        : 'Telegram test sent',
    };
  }

  private async deliver(kind: NotificationKind, thread: Thread) {
    const settings = this.settings.get();
    if (!settings.chatNotificationEvents[notificationEventFlagForKind(kind)]) return;

    const project = this.projects.getById(thread.projectId);
    if (!project) return;

    const message = buildMessage(kind, thread, project);
    const dedupeBase = `${thread.id}:${kind}`;

    const discordRoute = this.resolveDiscordRoute(settings, project);
    if (discordRoute && this.shouldSend(`discord:${dedupeBase}`)) {
      void this.sendDiscord(discordRoute, message);
    }

    const telegramRoute = this.resolveTelegramRoute(settings, project);
    if (telegramRoute && this.shouldSend(`telegram:${dedupeBase}`)) {
      void this.sendTelegram(telegramRoute, message);
    }
  }

  private shouldSend(key: string): boolean {
    const now = Date.now();
    const last = this.lastSentAt.get(key);
    if (last && now - last < DEDUPE_WINDOW_MS) {
      return false;
    }
    this.lastSentAt.set(key, now);
    return true;
  }

  private resolveDiscordRoute(
    settings: ReturnType<SettingsQueries['get']>,
    project: Project | null,
  ): DiscordRoute | null {
    if (!settings.discordEnabled) return null;
    const routing = project?.discordRouting ?? 'inherit';
    if (routing === 'disabled') return null;
    const webhookUrl =
      routing === 'custom'
        ? (project?.discordWebhookUrlOverride?.trim() ?? '')
        : (settings.discordWebhookUrl?.trim() ?? '');
    if (!webhookUrl || !DISCORD_WEBHOOK_RE.test(webhookUrl)) return null;
    return { webhookUrl, destination: 'discord-webhook' };
  }

  private resolveTelegramRoute(
    settings: ReturnType<SettingsQueries['get']>,
    project: Project | null,
  ): TelegramRoute | null {
    if (!settings.telegramEnabled) return null;
    const botToken = settings.telegramBotToken?.trim() ?? '';
    if (!botToken || !TELEGRAM_TOKEN_RE.test(botToken)) return null;
    const routing = project?.telegramRouting ?? 'inherit';
    if (routing === 'disabled') return null;
    const chatId =
      routing === 'custom'
        ? (project?.telegramChatIdOverride?.trim() ?? '')
        : (settings.telegramDefaultChatId?.trim() ?? '');
    if (!chatId) return null;
    return { botToken, chatId, destination: chatId };
  }

  private async sendDiscord(
    route: DiscordRoute,
    message: string,
  ): Promise<IntegrationDeliveryStatus> {
    const status = await this.postWithRetry('discord', route.destination, route.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
    this.settings.set({ discordLastDeliveryStatus: status });
    return status;
  }

  private async sendTelegram(
    route: TelegramRoute,
    message: string,
  ): Promise<IntegrationDeliveryStatus> {
    const status = await this.postWithRetry(
      'telegram',
      route.destination,
      `https://api.telegram.org/bot${route.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: route.chatId,
          text: message,
          disable_web_page_preview: true,
        }),
      },
    );
    this.settings.set({ telegramLastDeliveryStatus: status });
    return status;
  }

  private async postWithRetry(
    provider: 'discord' | 'telegram',
    destination: string,
    url: string,
    init: RequestInit,
  ): Promise<IntegrationDeliveryStatus> {
    const status: IntegrationDeliveryStatus = {
      provider,
      destination,
      lastAttemptAt: new Date().toISOString(),
      lastSuccessAt: null,
      lastError: null,
    };

    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
      if (RETRY_DELAYS_MS[attempt] > 0) {
        await delay(RETRY_DELAYS_MS[attempt]);
      }

      try {
        const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
        if (response.ok) {
          status.lastSuccessAt = new Date().toISOString();
          status.lastError = null;
          return status;
        }

        const body = clampError(await response.text());
        status.lastError = `HTTP ${response.status}${body ? `: ${body}` : ''}`;
      } catch (error) {
        status.lastError = clampError(error);
      }
    }

    log.warn(`[chat-notifications] ${provider} delivery failed`, status);
    return status;
  }
}
