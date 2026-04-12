import type { DatabaseSync } from 'node:sqlite';
import type { AppSettings, NotificationEventToggles } from '@shipcode/shared';
import {
  DEFAULT_SETTINGS,
  DEFAULT_NOTIFICATION_EVENTS,
  DEFAULT_STATUS_LABEL_MAPPINGS,
  expandWorktreeRoot,
} from '@shipcode/shared';
import { transaction } from '../utils';

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

function parseNotificationEvents(raw: string | undefined): NotificationEventToggles {
  if (!raw) return { ...DEFAULT_NOTIFICATION_EVENTS };
  try {
    const parsed = JSON.parse(raw) as Partial<NotificationEventToggles>;
    return { ...DEFAULT_NOTIFICATION_EVENTS, ...parsed };
  } catch {
    return { ...DEFAULT_NOTIFICATION_EVENTS };
  }
}

function readNullable(raw: string | undefined): string | null {
  if (raw == null || raw === '' || raw === 'null') return null;
  return raw;
}

const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;

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
      defaultWorktreeEnabled: parseBool(
        stored.defaultWorktreeEnabled,
        DEFAULT_SETTINGS.defaultWorktreeEnabled,
      ),
      terminalScrollback: stored.terminalScrollback
        ? parseInt(stored.terminalScrollback, 10)
        : DEFAULT_SETTINGS.terminalScrollback,
      plannerModel:
        (stored.plannerModel as AppSettings['plannerModel']) ?? DEFAULT_SETTINGS.plannerModel,
      reviewerModel:
        (stored.reviewerModel as AppSettings['reviewerModel']) ?? DEFAULT_SETTINGS.reviewerModel,
      executorModel:
        (stored.executorModel as AppSettings['executorModel']) ?? DEFAULT_SETTINGS.executorModel,
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
      worktreeBranchFormat:
        stored.worktreeBranchFormat || DEFAULT_SETTINGS.worktreeBranchFormat,
      plannerMaxTurns: clampInt(stored.plannerMaxTurns, 1, 20, DEFAULT_SETTINGS.plannerMaxTurns),
      maxReviewRounds: clampInt(stored.maxReviewRounds, 1, 5, DEFAULT_SETTINGS.maxReviewRounds),
      requireApproval: parseBool(stored.requireApproval, DEFAULT_SETTINGS.requireApproval),
      reviewerReasoningEffort: REASONING_EFFORTS.includes(stored.reviewerReasoningEffort as any)
        ? (stored.reviewerReasoningEffort as AppSettings['reviewerReasoningEffort'])
        : DEFAULT_SETTINGS.reviewerReasoningEffort,
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
      verifierModel:
        (stored.verifierModel as AppSettings['verifierModel']) ?? DEFAULT_SETTINGS.verifierModel,
      openrouterEnabled: parseBool(stored.openrouterEnabled, DEFAULT_SETTINGS.openrouterEnabled),
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
    if ('reviewerReasoningEffort' in patch && patch.reviewerReasoningEffort != null) {
      if (!REASONING_EFFORTS.includes(patch.reviewerReasoningEffort as any))
        throw new Error('reviewerReasoningEffort must be low|medium|high');
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
