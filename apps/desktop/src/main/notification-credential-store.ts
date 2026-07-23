import type { SettingsQueries } from '@shipcode/db';
import type { AppSettings } from '@shipcode/shared';
import { safeStorage } from 'electron';

const ENCRYPTED_VALUE_PREFIX = 'safe-storage:v1:';
const CREDENTIAL_KEYS = ['discordWebhookUrl', 'telegramBotToken'] as const;

type CredentialKey = (typeof CREDENTIAL_KEYS)[number];

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface NotificationCredentialSettingsReader {
  getMainSettings(): AppSettings;
}

function isEncryptedValue(value: string): boolean {
  return value.startsWith(ENCRYPTED_VALUE_PREFIX);
}

export class NotificationCredentialStore implements NotificationCredentialSettingsReader {
  constructor(
    private readonly settings: SettingsQueries,
    private readonly storage: SafeStorageAdapter = safeStorage,
  ) {}

  migratePlaintextCredentials(): void {
    const current = this.settings.get();
    const encryptedPatch: Partial<Pick<AppSettings, CredentialKey>> = {};

    for (const key of CREDENTIAL_KEYS) {
      const value = current[key];
      if (!value || isEncryptedValue(value)) continue;
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
      discordWebhookUrl: this.decrypt(current.discordWebhookUrl),
      telegramBotToken: this.decrypt(current.telegramBotToken),
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
    this.assertAvailable();
    try {
      const encrypted = this.storage.encryptString(value);
      return `${ENCRYPTED_VALUE_PREFIX}${encrypted.toString('base64')}`;
    } catch {
      throw new Error('Secure notification credential encryption failed');
    }
  }

  private decrypt(value: string | null): string | null {
    if (!value) return null;
    if (!isEncryptedValue(value)) {
      throw new Error('Notification credential migration did not complete');
    }

    this.assertAvailable();
    try {
      const encoded = value.slice(ENCRYPTED_VALUE_PREFIX.length);
      return this.storage.decryptString(Buffer.from(encoded, 'base64'));
    } catch {
      throw new Error('Secure notification credential decryption failed');
    }
  }

  private assertAvailable(): void {
    if (!this.storage.isEncryptionAvailable()) {
      throw new Error('Secure notification credential storage is unavailable');
    }
  }
}
