export const SECURE_SECRET_PREFIX = 'safe-storage:v1:';

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

function defaultStorage(): SafeStorageAdapter {
  // Lazy require so unit tests can mock `electron` before first encrypt/decrypt.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { safeStorage } = require('electron') as {
    safeStorage: SafeStorageAdapter;
  };
  return safeStorage;
}

export function isSecureSecretValue(value: string): boolean {
  return value.startsWith(SECURE_SECRET_PREFIX);
}

export function encryptSecureSecret(
  value: string,
  storage: SafeStorageAdapter = defaultStorage(),
): string {
  if (!storage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable');
  }
  try {
    const encrypted = storage.encryptString(value);
    return `${SECURE_SECRET_PREFIX}${encrypted.toString('base64')}`;
  } catch {
    throw new Error('Secure credential encryption failed');
  }
}

/**
 * Decrypt a value produced by {@link encryptSecureSecret}. Plaintext values
 * (legacy rows) are returned as-is so callers can migrate them.
 */
export function decryptSecureSecret(
  value: string | null | undefined,
  storage: SafeStorageAdapter = defaultStorage(),
): string | null {
  if (!value) return null;
  if (!isSecureSecretValue(value)) return value;
  if (!storage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable');
  }
  try {
    const encoded = value.slice(SECURE_SECRET_PREFIX.length);
    return storage.decryptString(Buffer.from(encoded, 'base64'));
  } catch {
    throw new Error('Secure credential decryption failed');
  }
}

/** Migrate a legacy plaintext secret to the encrypted form when needed. */
export function ensureEncryptedSecret(
  value: string | null | undefined,
  storage: SafeStorageAdapter = defaultStorage(),
): { value: string | null; migrated: boolean } {
  if (!value) return { value: null, migrated: false };
  if (isSecureSecretValue(value)) return { value, migrated: false };
  return { value: encryptSecureSecret(value, storage), migrated: true };
}
