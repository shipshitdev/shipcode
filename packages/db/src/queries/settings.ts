import type { DatabaseSync } from 'node:sqlite'
import type { AppSettings, NotificationEventToggles } from '@shipcode/shared'
import { DEFAULT_SETTINGS, DEFAULT_NOTIFICATION_EVENTS, DEFAULT_STATUS_LABEL_MAPPINGS, expandWorktreeRoot } from '@shipcode/shared'
import { transaction } from '../utils'

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return fallback
}

function parseNotificationEvents(raw: string | undefined): NotificationEventToggles {
  if (!raw) return { ...DEFAULT_NOTIFICATION_EVENTS }
  try {
    const parsed = JSON.parse(raw) as Partial<NotificationEventToggles>
    return { ...DEFAULT_NOTIFICATION_EVENTS, ...parsed }
  } catch {
    return { ...DEFAULT_NOTIFICATION_EVENTS }
  }
}

function readNullable(raw: string | undefined): string | null {
  if (raw == null || raw === '' || raw === 'null') return null
  return raw
}

export class SettingsQueries {
  constructor(private db: DatabaseSync) {}

  get(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    const stored: Record<string, string> = {}
    for (const row of rows) {
      stored[row.key] = row.value
    }

    return {
      theme: (stored.theme as AppSettings['theme']) ?? DEFAULT_SETTINGS.theme,
      defaultWorktreeEnabled: parseBool(stored.defaultWorktreeEnabled, DEFAULT_SETTINGS.defaultWorktreeEnabled),
      terminalScrollback: stored.terminalScrollback ? parseInt(stored.terminalScrollback, 10) : DEFAULT_SETTINGS.terminalScrollback,
      plannerModel: (stored.plannerModel as AppSettings['plannerModel']) ?? DEFAULT_SETTINGS.plannerModel,
      reviewerModel: (stored.reviewerModel as AppSettings['reviewerModel']) ?? DEFAULT_SETTINGS.reviewerModel,
      executorModel: (stored.executorModel as AppSettings['executorModel']) ?? DEFAULT_SETTINGS.executorModel,
      githubPollingEnabled: parseBool(stored.githubPollingEnabled, DEFAULT_SETTINGS.githubPollingEnabled),
      githubPollingIntervalMs: stored.githubPollingIntervalMs ? parseInt(stored.githubPollingIntervalMs, 10) : DEFAULT_SETTINGS.githubPollingIntervalMs,
      githubBotUsername: stored.githubBotUsername ?? DEFAULT_SETTINGS.githubBotUsername,
      autoPickupEnabled: parseBool(stored.autoPickupEnabled, DEFAULT_SETTINGS.autoPickupEnabled),
      statusLabelMappings: stored.statusLabelMappings ? JSON.parse(stored.statusLabelMappings) : DEFAULT_STATUS_LABEL_MAPPINGS,
      onboardingVersion: stored.onboardingVersion ? parseInt(stored.onboardingVersion, 10) : DEFAULT_SETTINGS.onboardingVersion,
      worktreeRoot: readWorktreeRoot(stored.worktreeRoot),
      notificationsEnabled: parseBool(stored.notificationsEnabled, DEFAULT_SETTINGS.notificationsEnabled),
      notificationOsEnabled: parseBool(stored.notificationOsEnabled, DEFAULT_SETTINGS.notificationOsEnabled),
      notificationBadgeEnabled: parseBool(stored.notificationBadgeEnabled, DEFAULT_SETTINGS.notificationBadgeEnabled),
      notificationSoundEnabled: parseBool(stored.notificationSoundEnabled, DEFAULT_SETTINGS.notificationSoundEnabled),
      notificationEvents: parseNotificationEvents(stored.notificationEvents),
      verifierModel: (stored.verifierModel as AppSettings['verifierModel']) ?? DEFAULT_SETTINGS.verifierModel,
      openrouterEnabled: parseBool(stored.openrouterEnabled, DEFAULT_SETTINGS.openrouterEnabled),
      openrouterPlannerModel: readNullable(stored.openrouterPlannerModel),
      openrouterReviewerModel: readNullable(stored.openrouterReviewerModel),
      openrouterVerifierModel: readNullable(stored.openrouterVerifierModel),
      openrouterExecutorModel: readNullable(stored.openrouterExecutorModel),
      openrouterDefaultPaidModel: stored.openrouterDefaultPaidModel ?? DEFAULT_SETTINGS.openrouterDefaultPaidModel,
      openrouterDefaultFreeModel: stored.openrouterDefaultFreeModel ?? DEFAULT_SETTINGS.openrouterDefaultFreeModel,
      openrouterExplicitFallback: stored.openrouterExplicitFallback ?? DEFAULT_SETTINGS.openrouterExplicitFallback,
    }
  }

  set(patch: Partial<AppSettings>): void {
    // Validate worktreeRoot up-front so malformed values (relative paths, ~user/…) never reach the DB.
    if ('worktreeRoot' in patch && patch.worktreeRoot != null && patch.worktreeRoot !== '') {
      expandWorktreeRoot(patch.worktreeRoot)
    }

    const upsert = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )

    const entries = Object.entries(patch).map(([k, v]) => {
      if (v === null || v === undefined) return [k, ''] as [string, string]
      if (typeof v === 'object') return [k, JSON.stringify(v)] as [string, string]
      return [k, String(v)] as [string, string]
    })
    transaction(this.db, () => {
      for (const [key, value] of entries) {
        upsert.run(key, value)
      }
    })
  }
}

function readWorktreeRoot(raw: string | undefined): string | null {
  // Treat missing, empty string, and the JS literal 'null' (legacy from pre-fix serializer)
  // as "use the default".
  if (raw == null || raw === '' || raw === 'null') return null
  return raw
}
