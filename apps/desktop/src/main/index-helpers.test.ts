import { describe, expect, it, vi } from 'vitest';
import {
  buildAboutPanelOptions,
  buildApplicationMenuTemplate,
  buildContentSecurityPolicy,
  buildMainWindowOptions,
  buildRendererLoadTarget,
  formatActivePipelineNames,
  formatStalledProcessMessage,
  loadLocalEnvFiles,
  shouldQuitWhenAllWindowsClosed,
} from './index-helpers';

describe('formatActivePipelineNames', () => {
  it('uses thread titles when available and falls back to thread ids', () => {
    const threads = {
      getById: vi.fn((threadId: string) =>
        threadId === 'thread-1' ? { title: 'Fix onboarding' } : null,
      ),
    };

    expect(
      formatActivePipelineNames([{ threadId: 'thread-1' }, { threadId: 'thread-2' }], threads),
    ).toBe('• Fix onboarding\n• thread-2');
    expect(threads.getById).toHaveBeenCalledWith('thread-1');
    expect(threads.getById).toHaveBeenCalledWith('thread-2');
  });

  it('falls back to thread ids when the lookup is unavailable', () => {
    expect(formatActivePipelineNames([{ threadId: 'thread-3' }], null)).toBe('• thread-3');
  });
});

describe('loadLocalEnvFiles', () => {
  it('loads repo and desktop env files without overriding existing values', () => {
    const env: NodeJS.ProcessEnv = {
      EXISTING: 'keep',
    };
    const files = new Map([
      [
        '/repo/.env',
        `
# comment
OPENROUTER_API_KEY="repo-key"
EXISTING=replace
export SHIPCODE_ENV = 'repo'
INVALID_LINE
=missing-key
`,
      ],
      ['/repo/apps/desktop/.env.local', 'DESKTOP_ONLY=desktop\nOPENROUTER_API_KEY=desktop-key'],
    ]);
    const existsSync = vi.fn((filePath: string) => files.has(filePath));
    const readFileSync = vi.fn((filePath: string) => files.get(filePath) ?? '');

    loadLocalEnvFiles({
      dirname: '/repo/apps/desktop/dist/main',
      env,
      existsSync,
      readFileSync,
    });

    expect(existsSync).toHaveBeenCalledWith('/repo/.env');
    expect(existsSync).toHaveBeenCalledWith('/repo/.env.local');
    expect(existsSync).toHaveBeenCalledWith('/repo/apps/desktop/.env');
    expect(existsSync).toHaveBeenCalledWith('/repo/apps/desktop/.env.local');
    expect(readFileSync).toHaveBeenCalledTimes(2);
    expect(env).toMatchObject({
      OPENROUTER_API_KEY: 'repo-key',
      EXISTING: 'keep',
      SHIPCODE_ENV: 'repo',
      DESKTOP_ONLY: 'desktop',
    });
    expect(env['']).toBeUndefined();
  });

  it('ignores blank files and preserves quoted values that are not symmetrically quoted', () => {
    const env: NodeJS.ProcessEnv = {};

    loadLocalEnvFiles({
      dirname: '/repo/apps/desktop/dist/main',
      env,
      existsSync: () => true,
      readFileSync: () => `

HALF_QUOTED="value
SPACED = value with spaces
`,
    });

    expect(env.HALF_QUOTED).toBe('"value');
    expect(env.SPACED).toBe('value with spaces');
  });
});

describe('buildApplicationMenuTemplate', () => {
  it('builds app, edit, window, and community menus with working callbacks', () => {
    const checkNow = vi.fn();
    const openExternal = vi.fn();
    const template = buildApplicationMenuTemplate({
      updateService: { checkNow },
      openExternal,
    });

    expect(template.map((item) => item.label)).toEqual(['ShipCode', 'Edit', 'Window', 'Community']);

    const appMenu = template[0].submenu;
    const communityMenu = template[3].submenu;
    if (!Array.isArray(appMenu) || !Array.isArray(communityMenu)) {
      throw new Error('Expected concrete submenu arrays');
    }

    const checkForUpdate = appMenu.find((item) => item.label === 'Check for Update…');
    const repo = appMenu.find((item) => item.label === 'GitHub Repository');
    const communityGithub = communityMenu.find((item) => item.label === 'GitHub');
    const x = communityMenu.find((item) => item.label === '@shipshitdev on X');
    const youtube = communityMenu.find((item) => item.label === 'ShipShitShow on YouTube');

    checkForUpdate?.click?.({} as never, {} as never, {} as never);
    repo?.click?.({} as never, {} as never, {} as never);
    communityGithub?.click?.({} as never, {} as never, {} as never);
    x?.click?.({} as never, {} as never, {} as never);
    youtube?.click?.({} as never, {} as never, {} as never);

    expect(checkNow).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith('https://github.com/shipshitdev/shipcode');
    expect(openExternal).toHaveBeenCalledWith('https://x.com/shipshitdev');
    expect(openExternal).toHaveBeenCalledWith('https://www.youtube.com/@shipshitshow');
  });

  it('allows checking for updates before the update service exists', () => {
    const template = buildApplicationMenuTemplate({
      updateService: null,
      openExternal: vi.fn(),
    });
    const appMenu = template[0].submenu;
    if (!Array.isArray(appMenu)) throw new Error('Expected app submenu');

    expect(() =>
      appMenu
        .find((item) => item.label === 'Check for Update…')
        ?.click?.({} as never, {} as never, {} as never),
    ).not.toThrow();
  });
});

describe('main window and renderer bootstrap helpers', () => {
  it('builds stable main-window options with the preload path under dist', () => {
    expect(buildMainWindowOptions('/repo/apps/desktop/dist')).toMatchObject({
      width: 1400,
      height: 900,
      minWidth: 1024,
      minHeight: 680,
      backgroundColor: '#050607',
      show: false,
      titleBarStyle: 'hiddenInset',
      webPreferences: {
        preload: '/repo/apps/desktop/dist/preload/index.js',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
  });

  it('builds deterministic about panel metadata', () => {
    expect(buildAboutPanelOptions('1.2.3', 2026)).toEqual({
      applicationName: 'ShipCode',
      applicationVersion: '1.2.3',
      copyright: 'Copyright © 2026 ShipCode',
      website: 'https://github.com/shipshitdev/shipcode',
    });
  });

  it('builds dev and production content-security policies', () => {
    expect(buildContentSecurityPolicy('http://localhost:5173')).toContain(
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    );
    expect(buildContentSecurityPolicy('http://localhost:5173')).toContain(
      "connect-src 'self' ws://localhost:5173 http://localhost:5173",
    );
    expect(buildContentSecurityPolicy('http://localhost:5173')).toContain(
      "media-src 'self' http://localhost:5173",
    );

    expect(buildContentSecurityPolicy(undefined)).toContain("script-src 'self'");
    expect(buildContentSecurityPolicy(undefined)).toContain("connect-src 'self'");
    expect(buildContentSecurityPolicy(undefined)).toContain("media-src 'self' blob:");
  });

  it('chooses renderer URL loading in dev and file loading in production', () => {
    expect(buildRendererLoadTarget('http://localhost:5173', '/dist/index.html')).toEqual({
      kind: 'url',
      url: 'http://localhost:5173',
      openDevTools: true,
    });
    expect(buildRendererLoadTarget(undefined, '/dist/index.html')).toEqual({
      kind: 'file',
      filePath: '/dist/index.html',
      openDevTools: false,
    });
  });

  it('keeps macOS alive after all windows close and quits elsewhere', () => {
    expect(shouldQuitWhenAllWindowsClosed('darwin')).toBe(false);
    expect(shouldQuitWhenAllWindowsClosed('linux')).toBe(true);
    expect(shouldQuitWhenAllWindowsClosed('win32')).toBe(true);
  });

  it('formats stalled process watchdog messages from milliseconds', () => {
    expect(formatStalledProcessMessage(120_000)).toBe(
      'Agent process stalled — no output for 120s. Killed by watchdog.',
    );
    expect(formatStalledProcessMessage(1_499)).toContain('1s');
  });
});
