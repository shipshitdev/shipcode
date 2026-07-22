import type { SettingsQueries } from '@shipcode/db';
import { DEFAULT_SETTINGS, type AppSettings } from '@shipcode/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NotificationCredentialStore,
  type SafeStorageAdapter,
} from './notification-credential-store';

describe('NotificationCredentialStore', () => {
  let current: AppSettings;
  const get = vi.fn(() => current);
  const set = vi.fn((patch: Partial<AppSettings>) => {
    current = { ...current, ...patch };
  });
  const storage: SafeStorageAdapter = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value) => Buffer.from(`encrypted:${value}`)),
    decryptString: vi.fn((value) => value.toString().replace(/^encrypted:/, '')),
  };

  function makeStore(): NotificationCredentialStore {
    return new NotificationCredentialStore({ get, set } as unknown as SettingsQueries, storage);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.isEncryptionAvailable).mockReturnValue(true);
    vi.mocked(storage.encryptString).mockImplementation((value) =>
      Buffer.from(`encrypted:${value}`),
    );
    vi.mocked(storage.decryptString).mockImplementation((value) =>
      value.toString().replace(/^encrypted:/, ''),
    );
    current = {
      ...DEFAULT_SETTINGS,
      discordWebhookUrl: 'https://discord.com/api/webhooks/id/token',
      telegramBotToken: '123456:abcdefghijklmnopqrstuvwxyz',
    };
  });

  it('migrates both plaintext credentials atomically and decrypts them for main only', () => {
    const store = makeStore();

    store.migratePlaintextCredentials();

    expect(set).toHaveBeenCalledTimes(1);
    expect(current.discordWebhookUrl).toMatch(/^safe-storage:v1:/);
    expect(current.telegramBotToken).toMatch(/^safe-storage:v1:/);
    expect(current.discordWebhookUrl).not.toContain('discord.com');
    expect(current.telegramBotToken).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(store.getMainSettings()).toMatchObject({
      discordWebhookUrl: 'https://discord.com/api/webhooks/id/token',
      telegramBotToken: '123456:abcdefghijklmnopqrstuvwxyz',
    });
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('redacts persisted credentials from renderer settings', () => {
    const view = makeStore().getRendererSettings();

    expect(view.discordWebhookUrl).toBeNull();
    expect(view.telegramBotToken).toBeNull();
  });

  it('encrypts replacements and clears credentials without requiring encryption', () => {
    const store = makeStore();

    store.set({ discordWebhookUrl: 'https://discord.com/api/webhooks/new/token' });
    expect(current.discordWebhookUrl).toMatch(/^safe-storage:v1:/);

    vi.mocked(storage.isEncryptionAvailable).mockReturnValue(false);
    store.set({ discordWebhookUrl: null, telegramBotToken: null });
    expect(current.discordWebhookUrl).toBeNull();
    expect(current.telegramBotToken).toBeNull();
  });

  it('leaves recoverable values untouched when secure storage is unavailable', () => {
    vi.mocked(storage.isEncryptionAvailable).mockReturnValue(false);
    const store = makeStore();

    expect(() => store.migratePlaintextCredentials()).toThrow(
      'Secure notification credential storage is unavailable',
    );
    expect(set).not.toHaveBeenCalled();
    expect(current.discordWebhookUrl).toBe('https://discord.com/api/webhooks/id/token');
    expect(current.telegramBotToken).toBe('123456:abcdefghijklmnopqrstuvwxyz');
  });

  it('does not overwrite recoverable ciphertext when replacement encryption is unavailable', () => {
    const store = makeStore();
    store.migratePlaintextCredentials();
    const encryptedDiscordWebhook = current.discordWebhookUrl;
    vi.clearAllMocks();
    vi.mocked(storage.isEncryptionAvailable).mockReturnValue(false);

    expect(() =>
      store.set({ discordWebhookUrl: 'https://discord.com/api/webhooks/replacement/token' }),
    ).toThrow('Secure notification credential storage is unavailable');
    expect(set).not.toHaveBeenCalled();
    expect(current.discordWebhookUrl).toBe(encryptedDiscordWebhook);
  });

  it('does not persist a partial migration when encryption fails', () => {
    vi.mocked(storage.encryptString)
      .mockReturnValueOnce(Buffer.from('encrypted:discord'))
      .mockImplementationOnce(() => {
        throw new Error('keychain locked');
      });
    const store = makeStore();

    expect(() => store.migratePlaintextCredentials()).toThrow(
      'Secure notification credential encryption failed',
    );
    expect(set).not.toHaveBeenCalled();
  });
});
