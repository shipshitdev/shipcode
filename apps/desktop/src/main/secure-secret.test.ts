import { describe, expect, it, vi } from 'vitest';
import {
  decryptSecureSecret,
  encryptSecureSecret,
  ensureEncryptedSecret,
  isSecureSecretValue,
  SECURE_SECRET_PREFIX,
} from './secure-secret';

describe('secure-secret', () => {
  const storage = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString().replace(/^enc:/, '')),
  };

  it('round-trips encrypted secrets', () => {
    const encrypted = encryptSecureSecret('https://discord.com/api/webhooks/1/abc', storage);
    expect(isSecureSecretValue(encrypted)).toBe(true);
    expect(encrypted.startsWith(SECURE_SECRET_PREFIX)).toBe(true);
    expect(decryptSecureSecret(encrypted, storage)).toBe('https://discord.com/api/webhooks/1/abc');
  });

  it('returns plaintext legacy values unchanged from decrypt', () => {
    expect(decryptSecureSecret('https://discord.com/api/webhooks/1/plain', storage)).toBe(
      'https://discord.com/api/webhooks/1/plain',
    );
  });

  it('migrates plaintext through ensureEncryptedSecret', () => {
    const result = ensureEncryptedSecret('secret-token', storage);
    expect(result.migrated).toBe(true);
    expect(isSecureSecretValue(result.value ?? '')).toBe(true);
  });
});
