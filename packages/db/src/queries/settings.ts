import type { DatabaseSync } from 'node:sqlite';
import type {
  AppSettings,
  IntegrationDeliveryStatus,
  NotificationEventToggles,
} from '@shipcode/shared';
import {
  DEFAULT_CHAT_NOTIFICATION_EVENTS,
  DEFAULT_NOTIFICATION_EVENTS,
  DEFAULT_SETTINGS,
  DEFAULT_STATUS_LABEL_MAPPINGS,
  expandWorktreeRoot,
} from '@shipcode/shared';
import { transaction } from '../utils';

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

function parseEventToggles<T extends NotificationEventToggles>(
  raw: string | undefined,
  defaults: T,
): T {
  if (!raw) return { ...defaults };
  try {
    const parsed = JSON.parse(raw) as Partial<T>;
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

function parseNotificationEvents(raw: string | undefined): NotificationEventToggles {
  return parseEventToggles(raw, DEFAULT_NOTIFICATION_EVENTS);
}

function parseChatNotificationEvents(raw: string | undefined): NotificationEventToggles {
  return parseEventToggles(raw, DEFAULT_CHAT_NOTIFICATION_EVENTS);
}

function parseDeliveryStatus(raw: string | undefined): IntegrationDeliveryStatus | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as IntegrationDeliveryStatus;
  } catch {
    return null;
  }
}

function readNullable(raw: string | undefined): string | null {
  if (raw == null || raw === '' || raw === 'null') return null;
  return raw;
}

const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const PROJECT_OPEN_TARGETS = ['cursor', 'finder', 'terminal', 'ghostty', 'vscode'] as const;
const FONT_SIZES = [12, 13, 14, 15] as const;
const CONTEXT_GENERATOR_CLIS = ['claude', 'codex'] as const;

function isReasoningEffort(value: unknown): value is AppSettings['plannerReasoningEffort'] {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value);
}

function isProjectOpenTarget(value: unknown): value is AppSettings['projectOpenTarget'] {
  return typeof value === 'string' && (PROJECT_OPEN_TARGETS as readonly string[]).includes(value);
}

function isFontSize(value: unknown): value is AppSettings['fontSize'] {
  return typeof value === 'number' && (FONT_SIZES as readonly number[]).includes(value);
}

function isContextGeneratorCli(value: unknown): value is AppSettings['prdRewriteCli'] {
  return typeof value === 'string' && (CONTEXT_GENERATOR_CLIS as readonly string[]).includes(value);
}

export class SettingsQueries {
  constructor(private db: DatabaseSync) {}

  get(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as {
      key: string;
      value: string;
    }[];
    const stored: Record<string, string> = {};
    for (const row of rows) {
      stored[row.key] = row.value;
    }

    return {
      theme: (stored.theme as AppSettings['theme']) ?? DEFAULT_SETTINGS.theme,
      fontStyle: (stored.fontStyle as AppSettings['fontStyle']) ?? DEFAULT_SETTINGS.fontStyle,
      fontSize: isFontSize(stored.fontSize ? parseInt(stored.fontSize, 10) : Number.NaN)
        ? (parseInt(stored.fontSize!, 10) as AppSettings['fontSize'])
        : DEFAULT_SETTINGS.fontSize,
      defaultWorktreeEnabled: parseBool(
        stored.defaultWorktreeEnabled,
        DEFAULT_SETTINGS.defaultWorktreeEnabled,
      ),
      terminalScrollback: stored.terminalScrollback
        ? parseInt(stored.terminalScrollback, 10)
        : DEFAULT_SETTINGS.terminalScrollback,
      projectOpenTarget: isProjectOpenTarget(stored.projectOpenTarget)
        ? stored.projectOpenTarget
        : DEFAULT_SETTINGS.projectOpenTarget,
      plannerModel:
        (stored.plannerModel as AppSettings['plannerModel']) ?? DEFAULT_SETTINGS.plannerModel,
      reviewerModel:
        (stored.reviewerModel as AppSettings['reviewerModel']) ?? DEFAULT_SETTINGS.reviewerModel,
      executorModel:
        (stored.executorModel as AppSettings['executorModel']) ?? DEFAULT_SETTINGS.executorModel,
      prdRewriteCli: isContextGeneratorCli(stored.prdRewriteCli)
        ? stored.prdRewriteCli
        : DEFAULT_SETTINGS.prdRewriteCli,
      prdRewriteClaudeModel:
        readNullable(stored.prdRewriteClaudeModel) ?? DEFAULT_SETTINGS.prdRewriteClaudeModel,
      prdRewriteCodexModel:
        readNullable(stored.prdRewriteCodexModel) ?? DEFAULT_SETTINGS.prdRewriteCodexModel,
      prdRewriteReasoningEffort: isReasoningEffort(stored.prdRewriteReasoningEffort)
        ? (stored.prdRewriteReasoningEffort as AppSettings['prdRewriteReasoningEffort'])
        : DEFAULT_SETTINGS.prdRewriteReasoningEffort,
      githubPollingEnabled: parseBool(
        stored.githubPollingEnabled,
        DEFAULT_SETTINGS.githubPollingEnabled,
      ),
      githubPollingIntervalMs: stored.githubPollingIntervalMs
        ? parseInt(stored.githubPollingIntervalMs, 10)
        : DEFAULT_SETTINGS.githubPollingIntervalMs,
      githubBotUsername: stored.githubBotUsername ?? DEFAULT_SETTINGS.githubBotUsername,
      autoPickupEnabled: parseBool(stored.autoPickupEnabled, DEFAULT_SETTINGS.autoPickupEnabled),
      statusLabelMappings: stored.statusLabelMappings
        ? JSON.parse(stored.statusLabelMappings)
        : DEFAULT_STATUS_LABEL_MAPPINGS,
      onboardingVersion: stored.onboardingVersion
        ? parseInt(stored.onboardingVersion, 10)
        : DEFAULT_SETTINGS.onboardingVersion,
      projectSortOrder:
        (stored.projectSortOrder as AppSettings['projectSortOrder']) ??
        DEFAULT_SETTINGS.projectSortOrder,
      worktreeRoot: readWorktreeRoot(stored.worktreeRoot),
      worktreeBranchFormat: stored.worktreeBranchFormat || DEFAULT_SETTINGS.worktreeBranchFormat,
      plannerMaxTurns: clampInt(stored.plannerMaxTurns, 1, 20, DEFAULT_SETTINGS.plannerMaxTurns),
      maxReviewRounds: clampInt(stored.maxReviewRounds, 1, 5, DEFAULT_SETTINGS.maxReviewRounds),
      requireApproval: parseBool(stored.requireApproval, DEFAULT_SETTINGS.requireApproval),
      plannerReasoningEffort: isReasoningEffort(stored.plannerReasoningEffort)
        ? (stored.plannerReasoningEffort as AppSettings['plannerReasoningEffort'])
        : DEFAULT_SETTINGS.plannerReasoningEffort,
      reviewerReasoningEffort: isReasoningEffort(stored.reviewerReasoningEffort)
        ? (stored.reviewerReasoningEffort as AppSettings['reviewerReasoningEffort'])
        : DEFAULT_SETTINGS.reviewerReasoningEffort,
      executorReasoningEffort: isReasoningEffort(stored.executorReasoningEffort)
        ? (stored.executorReasoningEffort as AppSettings['executorReasoningEffort'])
        : DEFAULT_SETTINGS.executorReasoningEffort,
      verifierReasoningEffort: isReasoningEffort(stored.verifierReasoningEffort)
        ? (stored.verifierReasoningEffort as AppSettings['verifierReasoningEffort'])
        : DEFAULT_SETTINGS.verifierReasoningEffort,
      notificationsEnabled: parseBool(
        stored.notificationsEnabled,
        DEFAULT_SETTINGS.notificationsEnabled,
      ),
      notificationOsEnabled: parseBool(
        stored.notificationOsEnabled,
        DEFAULT_SETTINGS.notificationOsEnabled,
      ),
      notificationBadgeEnabled: parseBool(
        stored.notificationBadgeEnabled,
        DEFAULT_SETTINGS.notificationBadgeEnabled,
      ),
      notificationSoundEnabled: parseBool(
        stored.notificationSoundEnabled,
        DEFAULT_SETTINGS.notificationSoundEnabled,
      ),
      notificationEvents: parseNotificationEvents(stored.notificationEvents),
      discordEnabled: parseBool(stored.discordEnabled, DEFAULT_SETTINGS.discordEnabled),
      discordWebhookUrl: readNullable(stored.discordWebhookUrl),
      discordLastDeliveryStatus: parseDeliveryStatus(stored.discordLastDeliveryStatus),
      telegramEnabled: parseBool(stored.telegramEnabled, DEFAULT_SETTINGS.telegramEnabled),
      telegramBotToken: readNullable(stored.telegramBotToken),
      telegramDefaultChatId: readNullable(stored.telegramDefaultChatId),
      telegramLastDeliveryStatus: parseDeliveryStatus(stored.telegramLastDeliveryStatus),
      chatNotificationEvents: parseChatNotificationEvents(stored.chatNotificationEvents),
      verifierModel:
        (stored.verifierModel as AppSettings['verifierModel']) ?? DEFAULT_SETTINGS.verifierModel,
      openrouterPlannerModel: readNullable(stored.openrouterPlannerModel),
      openrouterReviewerModel: readNullable(stored.openrouterReviewerModel),
      openrouterVerifierModel: readNullable(stored.openrouterVerifierModel),
      openrouterExecutorModel: readNullable(stored.openrouterExecutorModel),
      openrouterDefaultPaidModel:
        stored.openrouterDefaultPaidModel ?? DEFAULT_SETTINGS.openrouterDefaultPaidModel,
      openrouterDefaultFreeModel:
        stored.openrouterDefaultFreeModel ?? DEFAULT_SETTINGS.openrouterDefaultFreeModel,
      openrouterExplicitFallback:
        stored.openrouterExplicitFallback ?? DEFAULT_SETTINGS.openrouterExplicitFallback,
      testCommand: readNullable(stored.testCommand) ?? null,
      testingContext: readNullable(stored.testingContext) ?? null,
      maxConcurrentPipelines: clampInt(
        stored.maxConcurrentPipelines,
        1,
        10,
        DEFAULT_SETTINGS.maxConcurrentPipelines,
      ),
    };
  }

  set(patch: Partial<AppSettings>): void {
    // Validate worktreeRoot up-front so malformed values (relative paths, ~user/…) never reach the DB.
    if ('worktreeRoot' in patch && patch.worktreeRoot != null && patch.worktreeRoot !== '') {
      expandWorktreeRoot(patch.worktreeRoot);
    }
    if ('maxReviewRounds' in patch && patch.maxReviewRounds != null) {
      const n = Number(patch.maxReviewRounds);
      if (!Number.isFinite(n) || n < 1 || n > 5) throw new Error('maxReviewRounds must be 1–5');
    }
    if ('plannerMaxTurns' in patch && patch.plannerMaxTurns != null) {
      const n = Number(patch.plannerMaxTurns);
      if (!Number.isFinite(n) || n < 1 || n > 20) throw new Error('plannerMaxTurns must be 1–20');
    }
    if ('maxConcurrentPipelines' in patch && patch.maxConcurrentPipelines != null) {
      const n = Number(patch.maxConcurrentPipelines);
      if (!Number.isFinite(n) || n < 1 || n > 10)
        throw new Error('maxConcurrentPipelines must be 1–10');
    }
    for (const key of [
      'plannerReasoningEffort',
      'reviewerReasoningEffort',
      'executorReasoningEffort',
      'verifierReasoningEffort',
      'prdRewriteReasoningEffort',
    ] as const) {
      if (key in patch && patch[key] != null) {
        if (!isReasoningEffort(patch[key])) {
          throw new Error(`${key} must be none|minimal|low|medium|high|xhigh`);
        }
      }
    }
    if ('projectOpenTarget' in patch && patch.projectOpenTarget != null) {
      if (!isProjectOpenTarget(patch.projectOpenTarget)) {
        throw new Error('projectOpenTarget must be cursor|finder|terminal|ghostty|vscode');
      }
    }
    if ('fontSize' in patch && patch.fontSize != null) {
      if (!isFontSize(patch.fontSize)) {
        throw new Error('fontSize must be one of 12|13|14|15');
      }
    }
    if ('prdRewriteCli' in patch && patch.prdRewriteCli != null) {
      if (!isContextGeneratorCli(patch.prdRewriteCli)) {
        throw new Error('prdRewriteCli must be claude|codex');
      }
    }
    if ('worktreeBranchFormat' in patch && patch.worktreeBranchFormat != null) {
      validateBranchFormat(patch.worktreeBranchFormat);
    }

    const upsert = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );

    const entries = Object.entries(patch).map(([k, v]) => {
      if (v === null || v === undefined) return [k, ''] as [string, string];
      if (typeof v === 'object') return [k, JSON.stringify(v)] as [string, string];
      return [k, String(v)] as [string, string];
    });
    transaction(this.db, () => {
      for (const [key, value] of entries) {
        upsert.run(key, value);
      }
    });
  }
}

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = raw ? parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/** Reject branch format strings that would produce invalid git ref names. */
function validateBranchFormat(format: string): void {
  if (!format.includes('{id}')) {
    throw new Error('worktreeBranchFormat must contain {id} for uniqueness');
  }
  // Substitute tokens with safe sample values, then check for illegal ref-name chars.
  const sample = format.replace(/\{id\}/g, '1').replace(/\{slug\}/g, 'test');
  // Reject characters git check-ref-format would refuse: space, ~, ^, :, \, ?, *, [, ..,
  // double slashes, trailing slash, trailing dot, @{, control chars.
  if (/[\s~^:?*[\]\\@{]|\.\.|\/{2,}/.test(sample)) {
    throw new Error('worktreeBranchFormat contains characters invalid in a git branch name');
  }
  if (
    sample.startsWith('-') ||
    sample.startsWith('.') ||
    sample.endsWith('.lock') ||
    sample.endsWith('/') ||
    sample.endsWith('.')
  ) {
    throw new Error('worktreeBranchFormat produces an invalid git branch name');
  }
}

function readWorktreeRoot(raw: string | undefined): string | null {
  // Treat missing, empty string, and the JS literal 'null' (legacy from pre-fix serializer)
  // as "use the default".
  if (raw == null || raw === '' || raw === 'null') return null;
  return raw;
}
