import type Database from 'better-sqlite3'
import type { AppSettings } from '@shipcode/shared'
import { DEFAULT_SETTINGS } from '@shipcode/shared'

export class SettingsQueries {
  constructor(private db: Database.Database) {}

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
    }
  }

  set(patch: Partial<AppSettings>): void {
    const upsert = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )

    const transaction = this.db.transaction((entries: [string, string][]) => {
      for (const [key, value] of entries) {
        upsert.run(key, value)
      }
    })

    const entries = Object.entries(patch).map(([k, v]) => [k, String(v)] as [string, string])
    transaction(entries)
  }
}
