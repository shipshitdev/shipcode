import { CURRENT_ONBOARDING_VERSION } from '@shipcode/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when the database does not exist yet', () => {
    existsSyncMock.mockReturnValueOnce(false);

    expect(requireOnboarding()).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('ShipCode is not set up yet. Run: shipcode onboard');
  });

  it('checks the relative data dir when HOME is unavailable', () => {
    delete process.env.HOME;
    existsSyncMock.mockReturnValueOnce(false);

    expect(requireOnboarding()).toBe(false);

    expect(existsSyncMock).toHaveBeenCalledWith('.shipcode/data/shipcode.db');
  });

  it('returns false when onboarding is behind the current version', () => {
    existsSyncMock.mockReturnValueOnce(true);
    getDatabaseMock.mockReturnValueOnce({});
    settingsGetMock.mockReturnValueOnce({
      onboardingVersion: CURRENT_ONBOARDING_VERSION - 1,
    });

    expect(requireOnboarding()).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('ShipCode setup is incomplete. Run: shipcode onboard');
  });

  it('returns true when onboarding is complete', () => {
    existsSyncMock.mockReturnValueOnce(true);
    getDatabaseMock.mockReturnValueOnce({});
    settingsGetMock.mockReturnValueOnce({
      onboardingVersion: CURRENT_ONBOARDING_VERSION,
    });

    expect(requireOnboarding()).toBe(true);
  });

  it('returns false when settings cannot be read', () => {
    existsSyncMock.mockReturnValueOnce(true);
    getDatabaseMock.mockImplementationOnce(() => {
      throw new Error('database locked');
    });

    expect(requireOnboarding()).toBe(false);
    expect(logSpy).toHaveBeenCalledWith('ShipCode setup is incomplete. Run: shipcode onboard');
  });
});
