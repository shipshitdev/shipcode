import type { SettingsQueries } from '@shipcode/db';
import type { AppSettings } from '@shipcode/shared';
import {
  decryptSecureSecret,
  encryptSecureSecret,
  isSecureSecretValue,
  type SafeStorageAdapter,
} from './secure-secret';

const CREDENTIAL_KEYS = ['discordWebhookUrl', 'telegramBotToken'] as const;

type CredentialKey = (typeof CREDENTIAL_KEYS)[number];

export type { SafeStorageAdapter } from './secure-secret';

export interface NotificationCredentialSettingsReader {
  getMainSettings(): AppSettings;
}

function defaultStorage(): SafeStorageAdapter {
  // Lazy require so unit tests can inject a SafeStorageAdapter without loading
  // the Electron binary (which may not be downloaded in CI worktrees).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { safeStorage } = require('electron') as {
    safeStorage: SafeStorageAdapter;
  };
  return safeStorage;
}

export class NotificationCredentialStore implements NotificationCredentialSettingsReader {
  private storage: SafeStorageAdapter | null;

  constructor(
    private readonly settings: SettingsQueries,
    storage?: SafeStorageAdapter,
  ) {
    // Do not evaluate defaultStorage() as a default parameter — that runs on
    // every construct path, including tests that never touch credentials, and
    // forces an Electron binary download on first require.
    this.storage = storage ?? null;
  }

  private getStorage(): SafeStorageAdapter {
    if (!this.storage) {
      this.storage = defaultStorage();
    }
    return this.storage;
  }

  migratePlaintextCredentials(): void {
    const current = this.settings.get();
    const encryptedPatch: Partial<Pick<AppSettings, CredentialKey>> = {};

    for (const key of CREDENTIAL_KEYS) {
      const value = current[key];
      if (!value || isSecureSecretValue(value)) continue;
      encryptedPatch[key] = this.encrypt(value);
    }

    if (Object.keys(encryptedPatch).length > 0) {
      this.settings.set(encryptedPatch);
    }
  }

  getMainSettings(): AppSettings {
    this.migratePlaintextCredentials();
    const current = this.settings.get();
    return {
      ...current,
      discordWebhookUrl: this.decryptRequired(current.discordWebhookUrl),
      telegramBotToken: this.decryptRequired(current.telegramBotToken),
    };
  }

  getRendererSettings(): AppSettings {
    return {
      ...this.settings.get(),
      discordWebhookUrl: null,
      telegramBotToken: null,
    };
  }

  set(patch: Partial<AppSettings>): void {
    const persistedPatch = { ...patch };

    for (const key of CREDENTIAL_KEYS) {
      if (!Object.hasOwn(patch, key)) continue;
      const value = patch[key];
      persistedPatch[key] = value ? this.encrypt(value) : null;
    }

    this.settings.set(persistedPatch);
  }

  private encrypt(value: string): string {
    try {
      return encryptSecureSecret(value, this.getStorage());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('unavailable')) {
        throw new Error('Secure notification credential storage is unavailable');
      }
      throw new Error('Secure notification credential encryption failed');
    }
  }

  private decryptRequired(value: string | null): string | null {
    if (!value) return null;
    if (!isSecureSecretValue(value)) {
      throw new Error('Notification credential migration did not complete');
    }
    try {
      return decryptSecureSecret(value, this.getStorage());
    } catch {
      throw new Error('Secure notification credential decryption failed');
    }
  }
}
