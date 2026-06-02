import fs from 'node:fs';
import path from 'node:path';
import type {
  AboutPanelOptionsOptions,
  BrowserWindowConstructorOptions,
  MenuItemConstructorOptions,
} from 'electron';

export interface ThreadTitleLookup {
  getById(threadId: string): { title?: string | null } | null | undefined;
}

export function formatActivePipelineNames(
  active: Array<{ threadId: string }>,
  threads: ThreadTitleLookup | null,
): string {
  return active
    .map((pipelineSummary) => {
      const thread = threads?.getById(pipelineSummary.threadId);
      return `• ${thread?.title ?? pipelineSummary.threadId}`;
    })
    .join('\n');
}

export function loadLocalEnvFiles(options?: {
  dirname?: string;
  env?: NodeJS.ProcessEnv;
  existsSync?: (filePath: string) => boolean;
  readFileSync?: (filePath: string, encoding: BufferEncoding) => string;
}): void {
  const dirname = options?.dirname ?? __dirname;
  const env = options?.env ?? process.env;
  const existsSync = options?.existsSync ?? fs.existsSync;
  const readFileSync = options?.readFileSync ?? fs.readFileSync;
  const desktopRoot = path.resolve(dirname, '..', '..');
  const repoRoot = path.resolve(desktopRoot, '..', '..');
  const candidates = [
    path.join(repoRoot, '.env'),
    path.join(repoRoot, '.env.local'),
    path.join(desktopRoot, '.env'),
    path.join(desktopRoot, '.env.local'),
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, 'utf8');

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
      const envMatch = /^([^=]+)=(.*)$/.exec(normalized);
      if (!envMatch) continue;

      const key = envMatch[1].trim();
      if (!key || env[key] !== undefined) continue;

      let value = envMatch[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      env[key] = value;
    }
  }
}

export interface ApplicationMenuDeps {
  updateService?: { checkNow(): unknown } | null;
  openExternal(url: string): unknown;
}

export function buildApplicationMenuTemplate({
  updateService,
  openExternal,
}: ApplicationMenuDeps): MenuItemConstructorOptions[] {
  return [
    {
      label: 'ShipCode',
      submenu: [
        { label: 'About ShipCode', role: 'about' },
        {
          label: 'Check for Update…',
          click: () => updateService?.checkNow(),
        },
        {
          label: 'GitHub Repository',
          click: () => openExternal('https://github.com/shipshitdev/shipcode'),
        },
        { type: 'separator' },
        { label: 'Hide ShipCode', role: 'hide' },
        { label: 'Hide Others', role: 'hideOthers' },
        { label: 'Show All', role: 'unhide' },
        { type: 'separator' },
        { label: 'Quit ShipCode', role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Window',
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { role: 'close' },
      ],
    },
    {
      label: 'Community',
      submenu: [
        {
          label: 'GitHub',
          click: () => openExternal('https://github.com/shipshitdev/shipcode'),
        },
        {
          label: '@shipshitdev on X',
          click: () => openExternal('https://x.com/shipshitdev'),
        },
        {
          label: 'ShipShitShow on YouTube',
          click: () => openExternal('https://www.youtube.com/@shipshitshow'),
        },
      ],
    },
  ];
}

export function buildMainWindowOptions(dist: string): BrowserWindowConstructorOptions {
  return {
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#050607',
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(dist, 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };
}

export function buildAboutPanelOptions(
  applicationVersion: string,
  year = new Date().getFullYear(),
): AboutPanelOptionsOptions {
  return {
    applicationName: 'ShipCode',
    applicationVersion,
    copyright: `Copyright © ${year} ShipCode`,
    website: 'https://github.com/shipshitdev/shipcode',
  };
}

export function buildContentSecurityPolicy(rendererUrl: string | undefined): string {
  const scriptSrc = rendererUrl ? "'self' 'unsafe-eval' 'unsafe-inline'" : "'self'";
  const connectSrc = rendererUrl ? "'self' ws://localhost:5173 http://localhost:5173" : "'self'";
  const mediaSrc = rendererUrl ? "'self' http://localhost:5173" : "'self' blob:";

  return `default-src 'none'; script-src ${scriptSrc}; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src ${connectSrc}; img-src 'self' data: https:; font-src 'self' data:; media-src ${mediaSrc}`;
}

export type RendererLoadTarget =
  | { kind: 'url'; url: string; openDevTools: true }
  | { kind: 'file'; filePath: string; openDevTools: false };

export function buildRendererLoadTarget(
  rendererUrl: string | undefined,
  rendererHtml: string,
): RendererLoadTarget {
  return rendererUrl
    ? { kind: 'url', url: rendererUrl, openDevTools: true }
    : { kind: 'file', filePath: rendererHtml, openDevTools: false };
}

/**
 * Decide whether an in-window navigation to `target` may proceed.
 *
 * The renderer holds the privileged `window.shipcode` preload bridge (IPC →
 * shell spawn, settings, process control). Navigating the main window to an
 * attacker origin would carry that bridge into untrusted JavaScript — and the
 * production CSP (`script-src 'self'`) still permits same-origin scripts on
 * that page. So only the bundled renderer is allowed to load: the Vite
 * dev-server origin in development, or `file:` URLs in a packaged build. Every
 * other navigation must be blocked; external web links open in the OS browser.
 */
export function isAllowedNavigationTarget(
  target: string,
  rendererUrl: string | undefined,
): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (rendererUrl) {
    try {
      return url.origin === new URL(rendererUrl).origin;
    } catch {
      return false;
    }
  }
  return url.protocol === 'file:';
}

/** True when `target` is an http(s) URL safe to hand to `shell.openExternal`. */
export function isExternalWebUrl(target: string): boolean {
  try {
    const { protocol } = new URL(target);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function shouldQuitWhenAllWindowsClosed(platform = process.platform): boolean {
  return platform !== 'darwin';
}

export function formatStalledProcessMessage(timeoutMs: number): string {
  return `Agent process stalled — no output for ${Math.round(timeoutMs / 1000)}s. Killed by watchdog.`;
}
