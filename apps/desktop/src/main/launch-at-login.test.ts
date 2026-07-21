import { describe, expect, it, vi } from 'vitest';
import { applyLaunchAtLoginSetting, type LoginItemApp } from './launch-at-login';

function makeApp(isPackaged: boolean): LoginItemApp {
  return {
    isPackaged,
    setLoginItemSettings: vi.fn(),
  };
}

describe('applyLaunchAtLoginSetting', () => {
  it('applies the preference to packaged macOS apps', () => {
    const electronApp = makeApp(true);

    expect(applyLaunchAtLoginSetting(electronApp, true, 'darwin')).toBe('applied');
    expect(electronApp.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });

    applyLaunchAtLoginSetting(electronApp, false, 'darwin');
    expect(electronApp.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: false });
  });

  it('never registers a development build', () => {
    const electronApp = makeApp(false);

    expect(applyLaunchAtLoginSetting(electronApp, true, 'darwin')).toBe('not-packaged');
    expect(electronApp.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it('does not call unsupported platform APIs', () => {
    const electronApp = makeApp(true);

    expect(applyLaunchAtLoginSetting(electronApp, true, 'linux')).toBe('unsupported-platform');
    expect(electronApp.setLoginItemSettings).not.toHaveBeenCalled();
  });
});
