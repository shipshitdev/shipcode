import type { DatabaseSync } from 'node:sqlite';
import type {
  AppSettings,
  CleanupCriteria,
  IntegrationDeliveryStatus,
  NotificationEventToggles,
} from '@shipcode/shared';
import {
  DEFAULT_CHAT_NOTIFICATION_EVENTS,
  DEFAULT_NOTIFICATION_EVENTS,
  DEFAULT_SETTINGS,
  DEFAULT_STATUS_LABEL_MAPPINGS,
} from '@shipcode/shared';
import { expandWorktreeRoot } from '@shipcode/shared/worktree-path';
import { transaction } from '../utils';

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

function parseNullableBool(raw: string | undefined): boolean | null {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
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
const TERMINAL_OPEN_TARGETS = ['terminal', 'ghostty'] as const;
const FONT_SIZES = [12, 13, 14, 15] as const;
const GENERATOR_CLIS = ['claude', 'codex'] as const;
const EXECUTOR_MODELS = ['claude', 'codex', 'openrouter'] as const;
const DEV_LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
const UPDATE_TRACKS = ['master', 'stable', 'nightly'] as const;
const AUTO_COMMIT_MODES = ['split', 'single'] as const;

function isAutoCommitMode(value: unknown): value is AppSettings['autoCommitMode'] {
  return typeof value === 'string' && (AUTO_COMMIT_MODES as readonly string[]).includes(value);
}

function parseCleanupCriteria(raw: string | undefined): CleanupCriteria {
  if (!raw) return { ...DEFAULT_SETTINGS.cleanupCriteria };
  try {
    const parsed = JSON.parse(raw) as Partial<CleanupCriteria>;
    return { ...DEFAULT_SETTINGS.cleanupCriteria, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS.cleanupCriteria };
  }
}

function isDevLogLevel(value: unknown): value is AppSettings['devLogLevel'] {
  return typeof value === 'string' && (DEV_LOG_LEVELS as readonly string[]).includes(value);
}

function isUpdateTrack(value: unknown): value is AppSettings['updateTrack'] {
  return typeof value === 'string' && (UPDATE_TRACKS as readonly string[]).includes(value);
}

function isReasoningEffort(value: unknown): value is AppSettings['plannerReasoningEffort'] {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value);
}

function isProjectOpenTarget(value: unknown): value is AppSettings['projectOpenTarget'] {
  return typeof value === 'string' && (PROJECT_OPEN_TARGETS as readonly string[]).includes(value);
}

function isTerminalOpenTarget(value: unknown): value is AppSettings['terminalOpenTarget'] {
  return typeof value === 'string' && (TERMINAL_OPEN_TARGETS as readonly string[]).includes(value);
}

function isFontSize(value: unknown): value is AppSettings['fontSize'] {
  return typeof value === 'number' && (FONT_SIZES as readonly number[]).includes(value);
}

function isGeneratorCli(value: unknown): value is AppSettings['prdRewriteCli'] {
  return typeof value === 'string' && (GENERATOR_CLIS as readonly string[]).includes(value);
}

function isExecutorModel(value: unknown): value is AppSettings['triageModel'] {
  return typeof value === 'string' && (EXECUTOR_MODELS as readonly string[]).includes(value);
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

    const parsedFontSize = stored.fontSize ? parseInt(stored.fontSize, 10) : Number.NaN;

    return {
      theme: (stored.theme as AppSettings['theme']) ?? DEFAULT_SETTINGS.theme,
      fontStyle: (stored.fontStyle as AppSettings['fontStyle']) ?? DEFAULT_SETTINGS.fontStyle,
      fontSize: isFontSize(parsedFontSize)
        ? (parsedFontSize as AppSettings['fontSize'])
        : DEFAULT_SETTINGS.fontSize,
      telemetryEnabled: parseNullableBool(stored.telemetryEnabled),
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
      terminalOpenTarget: isTerminalOpenTarget(stored.terminalOpenTarget)
        ? stored.terminalOpenTarget
        : DEFAULT_SETTINGS.terminalOpenTarget,
      plannerModel:
        (stored.plannerModel as AppSettings['plannerModel']) ?? DEFAULT_SETTINGS.plannerModel,
      reviewerModel:
        (stored.reviewerModel as AppSettings['reviewerModel']) ?? DEFAULT_SETTINGS.reviewerModel,
      executorModel:
        (stored.executorModel as AppSettings['executorModel']) ?? DEFAULT_SETTINGS.executorModel,
      triageModel: isExecutorModel(stored.triageModel)
        ? stored.triageModel
        : DEFAULT_SETTINGS.triageModel,
      triageModelId: readNullable(stored.triageModelId) ?? DEFAULT_SETTINGS.triageModelId,
      triageReasoningEffort: isReasoningEffort(stored.triageReasoningEffort)
        ? stored.triageReasoningEffort
        : DEFAULT_SETTINGS.triageReasoningEffort,
      triageAutoApplyThreshold: clampNumber(
        stored.triageAutoApplyThreshold,
        0,
        1,
        DEFAULT_SETTINGS.triageAutoApplyThreshold,
      ),
      prdRewriteCli: isGeneratorCli(stored.prdRewriteCli)
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
      addProjectStartsIn: readNullable(stored.addProjectStartsIn) ?? null,
      worktreeBranchFormat: stored.worktreeBranchFormat || DEFAULT_SETTINGS.worktreeBranchFormat,
      revisionCount: readRevisionCount(stored.revisionCount, DEFAULT_SETTINGS.revisionCount),
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
      maxConcurrentExecutions: clampInt(
        stored.maxConcurrentExecutions,
        1,
        10,
        DEFAULT_SETTINGS.maxConcurrentExecutions,
      ),
      instantDefaultPanes: clampInt(
        stored.instantDefaultPanes,
        1,
        4,
        DEFAULT_SETTINGS.instantDefaultPanes,
      ) as AppSettings['instantDefaultPanes'],
      devLogLevel: isDevLogLevel(stored.devLogLevel)
        ? stored.devLogLevel
        : DEFAULT_SETTINGS.devLogLevel,
      updateTrack: isUpdateTrack(stored.updateTrack)
        ? stored.updateTrack
        : DEFAULT_SETTINGS.updateTrack,
      autoCommitEnabled: parseBool(stored.autoCommitEnabled, DEFAULT_SETTINGS.autoCommitEnabled),
      autoCommitModel: stored.autoCommitModel || DEFAULT_SETTINGS.autoCommitModel,
      autoCommitMode: isAutoCommitMode(stored.autoCommitMode)
        ? stored.autoCommitMode
        : DEFAULT_SETTINGS.autoCommitMode,
      cleanupCriteria: parseCleanupCriteria(stored.cleanupCriteria),
    };
  }

  set(patch: Partial<AppSettings>): void {
    // Validate worktreeRoot up-front so malformed values (relative paths, ~user/…) never reach the DB.
    if ('worktreeRoot' in patch && patch.worktreeRoot != null && patch.worktreeRoot !== '') {
      expandWorktreeRoot(patch.worktreeRoot);
    }
    // Same path validation for addProjectStartsIn.
    if (
      'addProjectStartsIn' in patch &&
      patch.addProjectStartsIn != null &&
      patch.addProjectStartsIn !== ''
    ) {
      expandWorktreeRoot(patch.addProjectStartsIn);
    }
    if ('revisionCount' in patch && patch.revisionCount != null) {
      const n = Number(patch.revisionCount);
      if (!Number.isFinite(n) || n < 0 || n > 5) throw new Error('revisionCount must be 0–5');
    }
    if ('maxConcurrentPipelines' in patch && patch.maxConcurrentPipelines != null) {
      const n = Number(patch.maxConcurrentPipelines);
      if (!Number.isFinite(n) || n < 1 || n > 10)
        throw new Error('maxConcurrentPipelines must be 1–10');
    }
    if ('maxConcurrentExecutions' in patch && patch.maxConcurrentExecutions != null) {
      const n = Number(patch.maxConcurrentExecutions);
      if (!Number.isFinite(n) || n < 1 || n > 10)
        throw new Error('maxConcurrentExecutions must be 1–10');
    }
    for (const key of [
      'plannerReasoningEffort',
      'reviewerReasoningEffort',
      'executorReasoningEffort',
      'verifierReasoningEffort',
      'triageReasoningEffort',
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
    if ('terminalOpenTarget' in patch && patch.terminalOpenTarget != null) {
      if (!isTerminalOpenTarget(patch.terminalOpenTarget)) {
        throw new Error('terminalOpenTarget must be terminal|ghostty');
      }
    }
    if ('fontSize' in patch && patch.fontSize != null) {
      if (!isFontSize(patch.fontSize)) {
        throw new Error('fontSize must be one of 12|13|14|15');
      }
    }
    if ('telemetryEnabled' in patch && patch.telemetryEnabled != null) {
      if (typeof patch.telemetryEnabled !== 'boolean') {
        throw new Error('telemetryEnabled must be boolean|null');
      }
    }
    if ('prdRewriteCli' in patch && patch.prdRewriteCli != null) {
      if (!isGeneratorCli(patch.prdRewriteCli)) {
        throw new Error('prdRewriteCli must be claude|codex');
      }
    }
    if ('triageModel' in patch && patch.triageModel != null) {
      if (!isExecutorModel(patch.triageModel)) {
        throw new Error('triageModel must be claude|codex|openrouter');
      }
    }
    if ('triageAutoApplyThreshold' in patch && patch.triageAutoApplyThreshold != null) {
      const n = Number(patch.triageAutoApplyThreshold);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        throw new Error('triageAutoApplyThreshold must be 0–1');
      }
    }
    if ('worktreeBranchFormat' in patch && patch.worktreeBranchFormat != null) {
      validateBranchFormat(patch.worktreeBranchFormat);
    }
    if ('devLogLevel' in patch && patch.devLogLevel != null) {
      if (!isDevLogLevel(patch.devLogLevel)) {
        throw new Error('devLogLevel must be error|warn|info|debug');
      }
    }
    if ('updateTrack' in patch && patch.updateTrack != null) {
      if (!isUpdateTrack(patch.updateTrack)) {
        throw new Error('updateTrack must be master|stable|nightly');
      }
    }
    if ('autoCommitMode' in patch && patch.autoCommitMode != null) {
      if (!isAutoCommitMode(patch.autoCommitMode)) {
        throw new Error('autoCommitMode must be split|single');
      }
    }
    if ('autoCommitModel' in patch && patch.autoCommitModel != null) {
      if (typeof patch.autoCommitModel !== 'string' || patch.autoCommitModel.trim() === '') {
        throw new Error('autoCommitModel must be a non-empty string');
      }
    }
    if ('cleanupCriteria' in patch && patch.cleanupCriteria != null) {
      const c = patch.cleanupCriteria;
      const required: (keyof CleanupCriteria)[] = [
        'worktreeMergedPr',
        'worktreeClosedPr',
        'localBranchNoRemote',
        'worktreeNoPrCleanTree',
      ];
      for (const k of required) {
        if (typeof c[k] !== 'boolean') {
          throw new Error(`cleanupCriteria.${k} must be boolean`);
        }
      }
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

function clampNumber(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = raw ? Number(raw) : Number.NaN;
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
    sample.startsWith('/') ||
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

function readRevisionCount(
  raw: string | undefined,
  fallback: AppSettings['revisionCount'],
): AppSettings['revisionCount'] {
  return raw !== undefined
    ? (clampInt(raw, 0, 5, fallback) as AppSettings['revisionCount'])
    : fallback;
}
