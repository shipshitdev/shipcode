// Suppress ExperimentalWarning from node:sqlite (RC module in Node v24).
// This runs before require('@shipcode/db') in CJS output (vite builds main as CJS).
const _origEmit = process.emit.bind(process);
process.emit = ((event: string | symbol, ...args: unknown[]) => {
  const warning = args[0];
  if (
    event === 'warning' &&
    typeof warning === 'object' &&
    warning !== null &&
    'name' in warning &&
    warning.name === 'ExperimentalWarning'
  ) {
    return false;
  }
  return _origEmit(event, ...args);
}) as typeof process.emit;

// Prevent unhandled errors (e.g. EIO on shutdown, destroyed WebContents race)
// from showing Electron's crash dialog. Log to file instead.
import log from './logger.service';

process.on('uncaughtException', (err) => {
  log.error('[main] uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  log.error('[main] unhandled rejection:', reason);
});

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';

app.setName('ShipCode');

import fs from 'node:fs';
import path from 'node:path';
import {
  createClaudeCliProvider,
  createCodexCliProvider,
  createOpenRouterProvider,
  createProviderRegistry,
  ProcessManager,
} from '@shipcode/agents';
import {
  ActivityQueries,
  AutomationQueries,
  CheckpointQueries,
  CostsQueries,
  closeDatabase,
  DashboardQueries,
  DiffQueries,
  GitHubIssueQueries,
  getDatabase,
  HeatmapQueries,
  IssueEdgeQueries,
  NotificationsQueries,
  PipelineStepQueries,
  PlanQueries,
  ProjectQueries,
  ReviewQueries,
  SettingsQueries,
  SkillsQueries,
  TerminalEventQueries,
  ThreadQueries,
  VerificationQueries,
} from '@shipcode/db';
import { createPipeline } from '@shipcode/pipeline';
import {
  HEARTBEAT_TIMEOUT_MS,
  type PipelinePhase,
  PROCESS_STALL_TIMEOUT_MS,
} from '@shipcode/shared';
import { AutomationScheduler } from './automation-scheduler';
import { ChatNotificationService } from './chat-notification-service';
import { registerIpcHandlers } from './ipc';
import { transitionThreadPhase } from './ipc/helpers';
import { notifyIssueGraphPipelinePhaseChange } from './ipc/register-issue-graph-handlers';
import { NotificationService } from './notification-service';
import { createElectronEmitter } from './pipeline-bridge';
import { PipelineScheduler } from './pipeline-scheduler';
import { UpdateService } from './update-service';

let mainWindow: BrowserWindow | null = null;
let processManager: ProcessManager | null = null;
let pipeline: ReturnType<typeof createPipeline> | null = null;
let threadQueries: ThreadQueries | null = null;
let updateService: UpdateService | null = null;
let confirmQuit = false;
let quitConfirmationInFlight = false;

function formatActivePipelineNames(
  active: Array<{ threadId: string }>,
  threads: ThreadQueries | null,
): string {
  return active
    .map((pipelineSummary) => {
      const thread = threads?.getById(pipelineSummary.threadId);
      return `• ${thread?.title ?? pipelineSummary.threadId}`;
    })
    .join('\n');
}

function restoreMainWindowAfterQuitCancel(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

async function confirmQuitForActivePipelines(threads: ThreadQueries | null): Promise<boolean> {
  if (quitConfirmationInFlight) return false;

  const active = pipeline?.listActive() ?? [];
  if (active.length === 0) return true;

  quitConfirmationInFlight = true;
  try {
    const names = formatActivePipelineNames(active, threads);
    const { response } = await dialog.showMessageBox(requireMainWindow(), {
      type: 'warning',
      title: 'Pipelines still running',
      message: `${active.length} pipeline${active.length !== 1 ? 's are' : ' is'} still running`,
      detail: `${names}\n\nQuitting will cancel their progress.`,
      buttons: ['Cancel & Quit', 'Keep Running'],
      defaultId: 1,
      cancelId: 1,
    });

    if (response !== 0) {
      restoreMainWindowAfterQuitCancel();
      return false;
    }

    return true;
  } finally {
    quitConfirmationInFlight = false;
  }
}

function loadLocalEnvFiles() {
  const desktopRoot = path.resolve(__dirname, '..', '..');
  const repoRoot = path.resolve(desktopRoot, '..', '..');
  const candidates = [
    path.join(repoRoot, '.env'),
    path.join(repoRoot, '.env.local'),
    path.join(desktopRoot, '.env'),
    path.join(desktopRoot, '.env.local'),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, 'utf8');

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
      const eqIndex = normalized.indexOf('=');
      if (eqIndex <= 0) continue;

      const key = normalized.slice(0, eqIndex).trim();
      if (!key || process.env[key] !== undefined) continue;

      let value = normalized.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  }
}

function requireMainWindow(): BrowserWindow {
  if (!mainWindow) throw new Error('Main window not initialized');
  return mainWindow;
}

function requirePipeline(): ReturnType<typeof createPipeline> {
  if (!pipeline) throw new Error('Pipeline not initialized');
  return pipeline;
}

const DIST = path.join(__dirname, '..');
loadLocalEnvFiles();
const RENDERER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_HTML = path.join(DIST, 'index.html');

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
    mainWindow?.show();
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
    heatmap: new HeatmapQueries(db),
    issueEdges: new IssueEdgeQueries(db),
    checkpoints: new CheckpointQueries(db),
    activity: new ActivityQueries(db),
    automations: new AutomationQueries(db),
    notifications: new NotificationsQueries(db),
    dashboard: new DashboardQueries(db),
    costs: new CostsQueries(db),
    skills: new SkillsQueries(db),
    terminalEvents: new TerminalEventQueries(db),
    pipelineSteps: new PipelineStepQueries(db),
  };
  threadQueries = queries.threads;

  // Notification service — reads settings, writes notifications + activity,
  // emits OS notifications and dock badges. Must be constructed before the
  // pipeline emitter because the emitter fans out to it.
  const notificationService = new NotificationService(
    mainWindow,
    queries.notifications,
    queries.settings,
    queries.activity,
  );
  const chatNotificationService = new ChatNotificationService(queries.settings, queries.projects);

  // Initialize pipeline state machine.
  // onPipelineTerminal is set after pipeline is created (late-binding).
  let onPipelineTerminal: ((event: { threadId: string; phase: PipelinePhase }) => void) | undefined;
  let onExecutionSlotFreed: (() => void) | undefined;
  const emitter = createElectronEmitter(mainWindow, {
    activity: queries.activity,
    terminalEvents: queries.terminalEvents,
    threads: queries.threads,
    automations: queries.automations,
    notifications: notificationService,
    chatNotifications: chatNotificationService,
    onPipelineTerminal: (event) => onPipelineTerminal?.(event),
    onExecutionSlotFreed: () => onExecutionSlotFreed?.(),
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

  const pipelineDeps = {
    emitter,
    processManager,
    threads: queries.threads,
    plans: queries.plans,
    reviews: queries.reviews,
    diffs: queries.diffs,
    verifications: queries.verifications,
    githubIssues: queries.githubIssues,
    checkpoints: queries.checkpoints,
    projects: queries.projects,
    settings: queries.settings,
    providers,
    skills: queries.skills,
    pipelineSteps: queries.pipelineSteps,
  };
  pipeline = createPipeline(pipelineDeps as Parameters<typeof createPipeline>[0]);
  const activePipeline = requirePipeline();

  const pipelineScheduler = new PipelineScheduler({
    queries,
    pipeline: activePipeline,
    emitter,
    getMainWindow: requireMainWindow,
  });

  const automationScheduler = new AutomationScheduler({
    automations: queries.automations,
    pipelineScheduler,
  });
  automationScheduler.start();

  // Queue promotion: start the next queued issue when a pipeline slot opens.
  onPipelineTerminal = (event) => {
    try {
      notifyIssueGraphPipelinePhaseChange(event);
      pipelineScheduler.onSlotFreed();
    } catch (err) {
      log.error('[queue] promotion error:', err);
    }
  };

  // Execution queue promotion: start the next approved-but-waiting thread
  // when a project execution slot opens (pipeline reaches completed/failed/idle).
  onExecutionSlotFreed = () => {
    pipelineScheduler.onExecutionSlotFreed();
  };

  // Startup: promote any queued items from a previous session.
  setTimeout(() => {
    const settings = queries.settings.get();
    for (let i = 0; i < settings.maxConcurrentPipelines; i++) {
      onPipelineTerminal?.({ threadId: '', phase: 'idle' });
    }
    // Also drain any threads that were approved pre-restart and waiting for execution.
    pipelineScheduler.drainExecutionQueue();
  }, 0);

  // Apply persisted log level (default is 'debug' from logger.service.ts init)
  log.transports.file.level = queries.settings.get().devLogLevel;

  // Update service: poll GitHub releases for newer ShipCode builds.
  // Notify-only — install via `brew upgrade --cask shipcode`.
  updateService = new UpdateService(mainWindow);
  updateService.start();

  // Register IPC handlers
  registerIpcHandlers(
    ipcMain,
    requireMainWindow(),
    queries,
    processManager,
    activePipeline,
    emitter,
    notificationService,
    chatNotificationService,
    updateService,
    automationScheduler,
  );

  // Watchdog: reset threads stuck in active phases (handles renderer refresh + crash scenarios).
  // HEARTBEAT_TIMEOUT_MS = 120s. Fires every 30s; skips threads that are live in activePipelines.
  // Also kills agent ptys whose stdout has gone silent for PROCESS_STALL_TIMEOUT_MS — a hung
  // claude/codex child can outlive its phase and pin a thread in 'executing' indefinitely
  // without tripping the heartbeat watchdog above.
  const watchdogTimer = setInterval(() => {
    try {
      const activeIds = new Set(activePipeline.listActive().map((s) => s.threadId));
      for (const thread of queries.threads.getStuck(HEARTBEAT_TIMEOUT_MS)) {
        if (activeIds.has(thread.id)) continue;
        const errorMsg = 'Pipeline timed out — process was likely interrupted by an app refresh.';
        transitionThreadPhase(requireMainWindow(), queries, emitter, {
          threadId: thread.id,
          phase: 'failed',
          errorMessage: errorMsg,
        });
        log.info(`[watchdog] reset stuck thread ${thread.id} → failed`);
      }

      const stalledIds = processManager?.killStalled(PROCESS_STALL_TIMEOUT_MS) ?? [];
      for (const procId of stalledIds) {
        const proc = processManager?.get(procId);
        const tid = proc?.threadId;
        log.warn(
          `[watchdog] killed stalled ${proc?.type ?? 'process'} ${procId} (thread=${tid ?? 'n/a'})`,
        );
        if (!tid) continue;
        transitionThreadPhase(requireMainWindow(), queries, emitter, {
          threadId: tid,
          phase: 'failed',
          errorMessage: `Agent process stalled — no output for ${Math.round(PROCESS_STALL_TIMEOUT_MS / 1000)}s. Killed by watchdog.`,
        });
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
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(RENDERER_HTML);
  }

  mainWindow.on('close', async (event) => {
    if (confirmQuit) return;
    const active = pipeline?.listActive() ?? [];
    if (active.length === 0) return;

    event.preventDefault();
    if (await confirmQuitForActivePipelines(queries.threads)) {
      confirmQuit = true;
      mainWindow?.close();
    }
  });

  mainWindow.on('closed', () => {
    clearInterval(watchdogTimer);
    updateService?.stop();
    updateService = null;
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
          label: 'GitHub',
          click: () => shell.openExternal('https://github.com/shipshitdev/shipcode'),
        },
        {
          label: '@shipshitdev on X',
          click: () => shell.openExternal('https://x.com/shipshitdev'),
        },
        {
          label: 'ShipShitShow on YouTube',
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
// If pipelines are running and the quit has not been confirmed, show a dialog first.
let killInFlight = false;
app.on('before-quit', async (event) => {
  // Second pass after we re-trigger via app.exit() — let it through.
  if (killInFlight) return;

  if (!confirmQuit) {
    const active = pipeline?.listActive() ?? [];
    if (active.length > 0) {
      event.preventDefault();
      if (!(await confirmQuitForActivePipelines(threadQueries))) return;
      confirmQuit = true;
    }
  }

  // Synchronous killAll() returns before pty children actually die, so the
  // Electron process exits while claude/codex orphans linger. Block quit until
  // all ptys emit `exit` (or SIGKILL escalation lands).
  event.preventDefault();
  killInFlight = true;
  try {
    await processManager?.killAllAndWait(5000);
  } catch (err) {
    log.error('[main] killAllAndWait failed during quit:', err);
  }
  app.exit(0);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
