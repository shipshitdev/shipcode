export interface LoginItemApp {
  isPackaged: boolean;
  setLoginItemSettings(settings: { openAtLogin: boolean }): void;
}

export type LaunchAtLoginApplyResult = 'applied' | 'not-packaged' | 'unsupported-platform';

export function applyLaunchAtLoginSetting(
  electronApp: LoginItemApp,
  openAtLogin: boolean,
  platform = process.platform,
): LaunchAtLoginApplyResult {
  if (platform !== 'darwin') return 'unsupported-platform';
  if (!electronApp.isPackaged) return 'not-packaged';

  electronApp.setLoginItemSettings({ openAtLogin });
  return 'applied';
}
