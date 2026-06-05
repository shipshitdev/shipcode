import { access } from 'node:fs/promises';
import type { DesktopAppHealth, DesktopAppHealthMap, ProjectOpenTarget } from '@shipcode/shared';

const DESKTOP_APP_LABELS: Record<ProjectOpenTarget, string> = {
  cursor: 'Cursor',
  finder: 'Finder',
  terminal: 'Terminal',
  ghostty: 'Ghostty',
  vscode: 'Visual Studio Code',
  t3code: 'T3 Code',
};

function unavailableDesktopApp(key: ProjectOpenTarget, error: string): DesktopAppHealth {
  return {
    key,
    label: DESKTOP_APP_LABELS[key],
    available: false,
    path: null,
    error,
  };
}

const ALWAYS_AVAILABLE_APPS: Set<ProjectOpenTarget> = new Set(['finder', 'terminal']);

const ALWAYS_AVAILABLE_PATHS: Partial<Record<ProjectOpenTarget, string>> = {
  finder: '/System/Library/CoreServices/Finder.app',
  terminal: '/System/Applications/Utilities/Terminal.app',
};

const DESKTOP_APP_BUNDLE_NAMES: Record<ProjectOpenTarget, string> = {
  cursor: 'Cursor.app',
  finder: 'Finder.app',
  terminal: 'Terminal.app',
  ghostty: 'Ghostty.app',
  vscode: 'Visual Studio Code.app',
  t3code: 'T3 Code (Alpha).app',
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function checkDesktopAppByName(
  key: ProjectOpenTarget,
  _appName: string,
): Promise<DesktopAppHealth> {
  if (process.platform !== 'darwin') {
    return unavailableDesktopApp(key, 'Desktop app detection is currently macOS-only');
  }

  if (ALWAYS_AVAILABLE_APPS.has(key)) {
    return {
      key,
      label: DESKTOP_APP_LABELS[key],
      available: true,
      path: ALWAYS_AVAILABLE_PATHS[key] ?? null,
      error: null,
    };
  }

  const bundleName = DESKTOP_APP_BUNDLE_NAMES[key];
  const candidates = [
    `/Applications/${bundleName}`,
    `${process.env.HOME}/Applications/${bundleName}`,
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return {
        key,
        label: DESKTOP_APP_LABELS[key],
        available: true,
        path: candidate,
        error: null,
      };
    }
  }

  return unavailableDesktopApp(key, `${DESKTOP_APP_LABELS[key]} is not installed`);
}

export async function checkDesktopApps(): Promise<DesktopAppHealthMap> {
  const [cursor, finder, terminal, ghostty, vscode, t3code] = await Promise.all([
    checkDesktopAppByName('cursor', 'Cursor'),
    checkDesktopAppByName('finder', 'Finder'),
    checkDesktopAppByName('terminal', 'Terminal'),
    checkDesktopAppByName('ghostty', 'Ghostty'),
    checkDesktopAppByName('vscode', 'Visual Studio Code'),
    checkDesktopAppByName('t3code', 'T3 Code'),
  ]);

  return { cursor, finder, terminal, ghostty, vscode, t3code };
}
