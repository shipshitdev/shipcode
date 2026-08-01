import { CURRENT_ONBOARDING_VERSION } from '@shipcode/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { existsSyncMock, getDatabaseMock, settingsGetMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  getDatabaseMock: vi.fn(),
  settingsGetMock: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: existsSyncMock,
  },
}));

vi.mock('@shipcode/db', () => ({
  getDatabase: getDatabaseMock,
  SettingsQueries: class {
    get() {
      return settingsGetMock();
    }
  },
}));

import { requireOnboarding } from './guard';

describe('requireOnboarding', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const originalHome = process.env.HOME;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  afterEach(() => {
    // The failure paths set process.exitCode on purpose; clear it so the guard
    // under test cannot make the vitest worker itself report a failure.
    process.exitCode = undefined;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  it('returns false and marks the process failed when the database does not exist yet', () => {
    existsSyncMock.mockReturnValueOnce(false);

    expect(requireOnboarding()).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('ShipCode is not set up yet. Run: shipcode onboard');
    expect(process.exitCode).toBe(1);
  });

  it('checks the relative data dir when HOME is unavailable', () => {
    delete process.env.HOME;
    existsSyncMock.mockReturnValueOnce(false);

    expect(requireOnboarding()).toBe(false);

    expect(existsSyncMock).toHaveBeenCalledWith('.shipcode/data/shipcode.db');
    expect(process.exitCode).toBe(1);
  });

  it('returns false and marks the process failed when onboarding is behind the current version', () => {
    existsSyncMock.mockReturnValueOnce(true);
    getDatabaseMock.mockReturnValueOnce({});
    settingsGetMock.mockReturnValueOnce({
      onboardingVersion: CURRENT_ONBOARDING_VERSION - 1,
    });

    expect(requireOnboarding()).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('ShipCode setup is incomplete. Run: shipcode onboard');
    expect(process.exitCode).toBe(1);
  });

  it('returns true and leaves the exit code alone when onboarding is complete', () => {
    existsSyncMock.mockReturnValueOnce(true);
    getDatabaseMock.mockReturnValueOnce({});
    settingsGetMock.mockReturnValueOnce({
      onboardingVersion: CURRENT_ONBOARDING_VERSION,
    });

    expect(requireOnboarding()).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('returns false and marks the process failed when settings cannot be read', () => {
    existsSyncMock.mockReturnValueOnce(true);
    getDatabaseMock.mockImplementationOnce(() => {
      throw new Error('database locked');
    });

    expect(requireOnboarding()).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('ShipCode setup is incomplete. Run: shipcode onboard');
    expect(process.exitCode).toBe(1);
  });
});
