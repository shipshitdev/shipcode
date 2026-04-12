// Suppress ExperimentalWarning from node:sqlite (RC module in Node v24).
// This runs before require('@shipcode/db') in CJS output (vite builds main as CJS).
const _origEmit = process.emit.bind(process);
process.emit = function (event: string, ...args: any[]) {
  if (event === 'warning' && args[0]?.name === 'ExperimentalWarning') return false;
  return _origEmit(event, ...args);
} as typeof process.emit;

// Prevent unhandled errors (e.g. EIO on shutdown, destroyed WebContents race)
// from showing Electron's crash dialog. Log to file instead.
import log from 'electron-log/main';
log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = 'info';

process.on('uncaughtException', (err) => {
  log.error('[main] uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  log.error('[main] unhandled rejection:', reason);
});

import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
app.setName('ShipCode');
import path from 'node:path';
import fs from 'node:fs';
import {
  getDatabase,
  closeDatabase,
  ProjectQueries,
  ThreadQueries,
  PlanQueries,
  ReviewQueries,
  DiffQueries,
  SettingsQueries,
  VerificationQueries,
  GitHubIssueQueries,
  ActivityQueries,
  NotificationsQueries,
  DashboardQueries,
  CostsQueries,
  SkillsQueries,
} from '@shipcode/db';
import {
  ProcessManager,
  createClaudeCliProvider,
  createCodexCliProvider,
  createOpenRouterProvider,
  createProviderRegistry,
} from '@shipcode/agents';
import { registerIpcHandlers } from './ipc';
import { createPipeline } from '@shipcode/pipeline';
import { createElectronEmitter } from './pipeline-bridge';
import { NotificationService } from './notification-service';
import { HEARTBEAT_TIMEOUT_MS } from '@shipcode/shared';

let mainWindow: BrowserWindow | null = null;
let processManager: ProcessManager | null = null;

const DIST = path.join(__dirname, '..');
const RENDERER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_HTML = path.join(DIST, 'renderer', 'index.html');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#050607',
    show: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(DIST, 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show();
  });

  // Initialize database
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = getDatabase(dataDir);

  // Initialize services
  processManager = new ProcessManager();
  const queries = {
    projects: new ProjectQueries(db),
    threads: new ThreadQueries(db),
    plans: new PlanQueries(db),
    reviews: new ReviewQueries(db),
    diffs: new DiffQueries(db),
    settings: new SettingsQueries(db),
    verifications: new VerificationQueries(db),
    githubIssues: new GitHubIssueQueries(db),
    activity: new ActivityQueries(db),
    notifications: new NotificationsQueries(db),
    dashboard: new DashboardQueries(db),
    costs: new CostsQueries(db),
    skills: new SkillsQueries(db),
  };

  // Notification service — reads settings, writes notifications + activity,
  // emits OS notifications and dock badges. Must be constructed before the
  // pipeline emitter because the emitter fans out to it.
  const notificationService = new NotificationService(
    mainWindow,
    queries.notifications,
    queries.settings,
    queries.activity,
  );

  // Initialize pipeline state machine
  const emitter = createElectronEmitter(mainWindow, {
    activity: queries.activity,
    threads: queries.threads,
    notifications: notificationService,
  });

  // Provider registry — claude/codex CLIs + OpenRouter HTTP provider.
  // OpenRouter reads its API key lazily from env on each call, and its
  // model selections from the latest AppSettings, so config changes
  // take effect without restarting the app.
  const providers = createProviderRegistry({
    claude: createClaudeCliProvider(processManager),
    codex: createCodexCliProvider(processManager),
    openrouter: createOpenRouterProvider({
      getApiKey: () => process.env.OPENROUTER_API_KEY,
      getSettings: () => queries.settings.get(),
    }),
  });

  const pipeline = createPipeline({
    emitter,
    processManager,
    threads: queries.threads,
    plans: queries.plans,
    reviews: queries.reviews,
    verifications: queries.verifications,
    githubIssues: queries.githubIssues,
    settings: queries.settings,
    providers,
    skills: queries.skills,
  });

  // Register IPC handlers
  registerIpcHandlers(ipcMain, mainWindow, queries, processManager, pipeline, notificationService);

  // Watchdog: reset threads stuck in active phases (handles renderer refresh + crash scenarios).
  // HEARTBEAT_TIMEOUT_MS = 120s. Fires every 30s; skips threads that are live in activePipelines.
  const watchdogTimer = setInterval(() => {
    try {
      const activeIds = new Set(pipeline.listActive().map((s) => s.threadId));
      for (const thread of queries.threads.getStuck(HEARTBEAT_TIMEOUT_MS)) {
        if (activeIds.has(thread.id)) continue;
        const errorMsg = 'Pipeline timed out — process was likely interrupted by an app refresh.';
        queries.threads.updateStatus(thread.id, 'failed', errorMsg);
        const issue = queries.githubIssues.getByThreadId(thread.id);
        if (issue) queries.githubIssues.updatePipelineStatus(issue.id, 'failed');
        emitter.emit({ type: 'pipeline:phase', threadId: thread.id, phase: 'failed' });
        log.info(`[watchdog] reset stuck thread ${thread.id} → failed`);
      }
    } catch (err) {
      log.error('[watchdog] error during stuck-thread check:', err);
    }
  }, 30_000);

  // Content-Security-Policy — set before any content loads.
  // Dev relaxes script-src for Vite's eval-based HMR and allows the WS connection.
  // Prod is strict: no eval, no remote origins.
  // 'unsafe-inline' is required in dev for @vitejs/plugin-react's HMR preamble.
  const scriptSrc = RENDERER_URL ? "'self' 'unsafe-eval' 'unsafe-inline'" : "'self'";
  const connectSrc = RENDERER_URL ? "'self' ws://localhost:5173 http://localhost:5173" : "'self'";
  // Dev: notify.wav resolves to http://localhost:5173/...; prod: Vite bundles to blob: URL
  const mediaSrc = RENDERER_URL ? "'self' http://localhost:5173" : "'self' blob:";
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'none'; script-src ${scriptSrc}; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src ${connectSrc}; img-src 'self' data: https:; font-src 'self' data:; media-src ${mediaSrc}`,
        ],
      },
    });
  });

  // Load renderer
  if (RENDERER_URL) {
    mainWindow.loadURL(RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: 'bottom' });
  } else {
    mainWindow.loadFile(RENDERER_HTML);
  }

  mainWindow.on('closed', () => {
    clearInterval(watchdogTimer);
    mainWindow = null;
    processManager?.killAll();
    closeDatabase();
  });
}

app.whenReady().then(() => {
  const menu = Menu.buildFromTemplate([
    {
      label: 'ShipCode',
      submenu: [
        { label: 'About ShipCode', role: 'about' },
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
          label: '⭐  Star on GitHub',
          click: () => shell.openExternal('https://github.com/shipshitdev/shipcode'),
        },
        {
          label: '🍴  Fork on GitHub',
          click: () => shell.openExternal('https://github.com/shipshitdev/shipcode/fork'),
        },
        { type: 'separator' },
        {
          label: '𝕏  @shipshitdev on X',
          click: () => shell.openExternal('https://x.com/shipshitdev'),
        },
        {
          label: '▶  ShipShitShow on YouTube',
          click: () => shell.openExternal('https://www.youtube.com/@shipshitshow'),
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Kill all agent subprocesses before the Electron main process exits (Cmd+Q,
// force-quit, etc.) so claude/codex don't keep running as orphans.
app.on('before-quit', () => {
  processManager?.killAll();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
