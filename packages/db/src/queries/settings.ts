import type { DatabaseSync } from 'node:sqlite'
import type { AppSettings } from '@shipcode/shared'
import { DEFAULT_SETTINGS, DEFAULT_STATUS_LABEL_MAPPINGS } from '@shipcode/shared'
import { transaction } from '../utils'

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
      defaultWorktreeEnabled: stored.defaultWorktreeEnabled === 'true' ? true : (stored.defaultWorktreeEnabled === 'false' ? false : DEFAULT_SETTINGS.defaultWorktreeEnabled),
      terminalScrollback: stored.terminalScrollback ? parseInt(stored.terminalScrollback, 10) : DEFAULT_SETTINGS.terminalScrollback,
      plannerModel: (stored.plannerModel as AppSettings['plannerModel']) ?? DEFAULT_SETTINGS.plannerModel,
      reviewerModel: (stored.reviewerModel as AppSettings['reviewerModel']) ?? DEFAULT_SETTINGS.reviewerModel,
      githubPollingEnabled: stored.githubPollingEnabled === 'true' ? true : (stored.githubPollingEnabled === 'false' ? false : DEFAULT_SETTINGS.githubPollingEnabled),
      githubPollingIntervalMs: stored.githubPollingIntervalMs ? parseInt(stored.githubPollingIntervalMs, 10) : DEFAULT_SETTINGS.githubPollingIntervalMs,
      githubBotUsername: stored.githubBotUsername ?? DEFAULT_SETTINGS.githubBotUsername,
      autoPickupEnabled: stored.autoPickupEnabled === 'true' ? true : (stored.autoPickupEnabled === 'false' ? false : DEFAULT_SETTINGS.autoPickupEnabled),
      statusLabelMappings: stored.statusLabelMappings ? JSON.parse(stored.statusLabelMappings) : DEFAULT_STATUS_LABEL_MAPPINGS,
    }
  }

  set(patch: Partial<AppSettings>): void {
    const upsert = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )

    const entries = Object.entries(patch).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)] as [string, string])
    transaction(this.db, () => {
      for (const [key, value] of entries) {
        upsert.run(key, value)
      }
    })
  }
}
