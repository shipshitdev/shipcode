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
import { fixMainProcessPath } from './path-fix';
import { captureMainException, configureMainTelemetry } from './telemetry';

// Patch PATH for packaged builds so child processes (git, bun, codex, claude)
// resolve from the user's login-shell environment instead of Electron's
// minimal GUI inheritance. Must run before any execFileSync / spawn of
// these binaries (worktree creation, project setup, executor invocation).
const pathFixResult = fixMainProcessPath();
if (pathFixResult.applied) {
  log.info(
    `[main] PATH patched from login shell (${pathFixResult.newPathEntries?.length ?? 0} entries)`,
  );
} else if (pathFixResult.reason === 'shell_failed') {
  log.warn(`[main] PATH fix skipped: ${pathFixResult.shellError ?? 'unknown'}`);
}

process.on('uncaughtException', (err) => {
  log.error('[main] uncaught exception:', err);
  captureMainException(err, { tags: { surface: 'main', kind: 'uncaughtException' } });
});
process.on('unhandledRejection', (reason) => {
  log.error('[main] unhandled rejection:', reason);
  captureMainException(reason, { tags: { surface: 'main', kind: 'unhandledRejection' } });
});

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';

app.setName('ShipCode');

// E2E mode (SHIPCODE_E2E_MODE=1): the Playwright harness launches the real app
// against a seeded temp DB + fake `gh`. Suppress background loops, OS update
// polling, telemetry, and the splash window so the first BrowserWindow is the
// main window and no live network / timer behaviour makes specs flaky.
const E2E_MODE = process.env.SHIPCODE_E2E_MODE === '1';

import fs from 'node:fs';
import path from 'node:path';
import {
  createClaudeCliProvider,
  createCodexCliProvider,
  createCursorCliProvider,
  createGeminiCliProvider,
  createGrokCliProvider,
  createOpenRouterProvider,
  createProviderRegistry,
  GhCli,
  ProcessManager,
} from '@shipcode/agents';
import {
  ActivityQueries,
  AgentConversationQueries,
  AutomationQueries,
  CheckpointQueries,
  CostsQueries,
  closeDatabase,
  DashboardQueries,
  DiffQueries,
  FeatureQaResultQueries,
  GitHubIssueQueries,
  getDatabase,
  HeatmapQueries,
  IssueChatSessionQueries,
  IssueEdgeQueries,
  NotificationsQueries,
  PhaseLogQueries,
  PipelineAnalyticsQueries,
  PipelineRunQueries,
  PipelineStepQueries,
  PipelineWakeRequestQueries,
  PlanQueries,
  ProjectFailureQueries,
  ProjectQueries,
  PromptTelemetryQueries,
  ReviewFindingQueries,
  ReviewQueries,
  SettingsQueries,
  SkillResolutionLogQueries,
  SkillsQueries,
  TaskGraphQueries,
  TerminalEventQueries,
  ThreadQueries,
  TriageRuleQueries,
  VerificationQueries,
} from '@shipcode/db';
import { createPipeline, createReconciliationLoop } from '@shipcode/pipeline';
import {
  HEARTBEAT_TIMEOUT_MS,
  PIPELINE_PHASE,
  type PipelinePhase,
  PROCESS_STALL_TIMEOUT_MS,
} from '@shipcode/shared';
import { AutomationScheduler } from './automation-scheduler';
import { ChatNotificationService } from './chat-notification-service';
import {
  buildAboutPanelOptions,
  buildApplicationMenuTemplate,
  buildContentSecurityPolicy,
  buildMainWindowOptions,
  buildRendererLoadTarget,
  formatActivePipelineNames,
  formatStalledProcessMessage,
  isAllowedNavigationTarget,
  isExternalWebUrl,
  loadLocalEnvFiles,
  shouldQuitWhenAllWindowsClosed,
} from './index-helpers';
import { registerIpcHandlers } from './ipc';
import { transitionThreadPhase } from './ipc/helpers';
import { notifyIssueGraphPipelinePhaseChange } from './ipc/register-issue-graph-handlers';
import { NotificationService } from './notification-service';
import { createElectronEmitter } from './pipeline-bridge';
import { PipelineScheduler } from './pipeline-scheduler';
import { ResourceMonitor } from './resource-monitor';
import { SplashScreen } from './splash-screen';
import { UpdateService } from './update-service';
import { WorkflowWatchManager } from './workflow-watch-manager';

let mainWindow: BrowserWindow | null = null;
let processManager: ProcessManager | null = null;
let pipeline: ReturnType<typeof createPipeline> | null = null;
let threadQueries: ThreadQueries | null = null;
let updateService: UpdateService | null = null;
let confirmQuit = false;
let quitConfirmationInFlight = false;
const splashScreen = new SplashScreen();

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
  if (!E2E_MODE) splashScreen.create();
  splashScreen.update('window', 'active', 'Creating the main desktop window.');

  mainWindow = new BrowserWindow(buildMainWindowOptions(DIST));

  mainWindow.once('ready-to-show', () => {
    // E2E mode: keep the window hidden. Playwright drives the renderer through
    // webContents, so showing it only steals OS focus (and the macOS focus beep)
    // on every per-test launch. The renderer still loads while hidden.
    if (!E2E_MODE) mainWindow?.show();
    splashScreen.close();
  });

  // Initialize database
  splashScreen.completeThrough('window');
  splashScreen.update('database', 'active', 'Opening ShipCode local data.');
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = getDatabase(dataDir);

  // Initialize services
  splashScreen.completeThrough('database');
  splashScreen.update('services', 'active', 'Starting notifications, agents, and telemetry.');
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
    issueChatSessions: new IssueChatSessionQueries(db),
    issueEdges: new IssueEdgeQueries(db),
    checkpoints: new CheckpointQueries(db),
    activity: new ActivityQueries(db),
    automations: new AutomationQueries(db),
    notifications: new NotificationsQueries(db),
    dashboard: new DashboardQueries(db),
    costs: new CostsQueries(db),
    skills: new SkillsQueries(db),
    terminalEvents: new TerminalEventQueries(db),
    phaseLogs: new PhaseLogQueries(db),
    pipelineAnalytics: new PipelineAnalyticsQueries(db),
    pipelineRuns: new PipelineRunQueries(db),
    pipelineSteps: new PipelineStepQueries(db),
    wakeRequests: new PipelineWakeRequestQueries(db),
    promptTelemetry: new PromptTelemetryQueries(db),
    reviewFindings: new ReviewFindingQueries(db),
    agentConversations: new AgentConversationQueries(db),
    skillResolutionLogs: new SkillResolutionLogQueries(db),
    featureQaResults: new FeatureQaResultQueries(db),
    projectFailures: new ProjectFailureQueries(db),
    taskGraphs: new TaskGraphQueries(db),
    triageRules: new TriageRuleQueries(db),
  };
  threadQueries = queries.threads;

  if (!E2E_MODE) {
    void configureMainTelemetry(queries.settings.get()).catch((err) => {
      log.warn('[telemetry] init failed:', err);
    });
  }

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
  splashScreen.completeThrough('services');
  splashScreen.update('pipeline', 'active', 'Restoring queues and pipeline state.');
  // onPipelineTerminal is set after pipeline is created (late-binding).
  let onPipelineTerminal: ((event: { threadId: string; phase: PipelinePhase }) => void) | undefined;
  let onExecutionSlotFreed: (() => void) | undefined;
  let resourceMonitor: ResourceMonitor | null = null;
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
    gemini: createGeminiCliProvider(processManager),
    cursor: createCursorCliProvider(processManager),
    grok: createGrokCliProvider(processManager),
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
    taskGraphs: queries.taskGraphs,
    phaseLogs: queries.phaseLogs,
    pipelineRuns: queries.pipelineRuns,
    pipelineSteps: queries.pipelineSteps,
    promptTelemetry: queries.promptTelemetry,
    reviewFindings: queries.reviewFindings,
    agentConversations: queries.agentConversations,
    skillResolutionLogs: queries.skillResolutionLogs,
    featureQaResults: queries.featureQaResults,
    projectFailures: queries.projectFailures,
    cpuTaskGate: {
      canStartCpuTask: () => resourceMonitor?.canStartCpuTask() ?? { allowed: true },
      retryDelayMs: 5_000,
    },
  };
  pipeline = createPipeline(pipelineDeps as Parameters<typeof createPipeline>[0]);
  const activePipeline = requirePipeline();
  resourceMonitor = new ResourceMonitor(processManager, queries, activePipeline);

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
  if (!E2E_MODE) automationScheduler.start();

  // Reconciliation loop: polls running pipelines' GitHub issue state every 30s.
  // Cancels pipelines whose issue was closed or tagged with a terminal label.
  const reconciliationLoop = createReconciliationLoop({
    pipeline: activePipeline,
    issueStateProvider: {
      async getIssueState(projectPath: string, issueNumber: number) {
        const ghCli = new GhCli(projectPath);
        const issue = await ghCli.getIssue(issueNumber);
        return { state: issue.state, labels: issue.labels };
      },
    },
    onReconciliationCancel: (threadId, reason) => {
      onPipelineTerminal?.({ threadId, phase: PIPELINE_PHASE.idle });
      log.info(`[reconcile] ${reason}`);
    },
    log: (msg) => log.info(msg),
  });
  if (!E2E_MODE) reconciliationLoop.start();

  // Hot-reload WORKFLOW.md: watch each project's workflow file and refresh the
  // shared policy cache on change so prompt/concurrency edits apply to the next
  // pipeline without an app restart. In-flight pipelines keep their snapshot.
  const workflowWatchManager = new WorkflowWatchManager({
    onReload: (event) => {
      if (event.ok) {
        log.info(`[workflow-watch] reloaded ${event.path ?? '(none)'}`);
      } else {
        log.warn(`[workflow-watch] reload failed: ${event.warning?.message ?? 'unknown error'}`);
      }
      mainWindow?.webContents.send('workflow:reloaded', {
        path: event.path,
        ok: event.ok,
        warning: event.warning?.message ?? null,
      });
    },
  });
  // Sync watchers to the current project set: once now at startup, and again
  // whenever a project is added/relinked/removed/archived (wired through the IPC
  // handlers below). Without the re-sync, hot reload silently breaks for any
  // project list change made during the session and removed projects leak a
  // watcher until restart.
  const resyncWorkflowWatchers = (): void => {
    workflowWatchManager.sync(queries.projects.listVisible().map((project) => project.path));
  };
  resyncWorkflowWatchers();

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

  // Startup: any persisted active thread has no live process after an app relaunch.
  // Mark it failed immediately so Retry can do a semantic resume from the worktree.
  for (const thread of queries.threads.getOrphaned()) {
    const errorMsg =
      'Pipeline interrupted while ShipCode was closed. Retry resumes from persisted plan, logs, checkpoint, and worktree state.';
    const interruptedRun = queries.pipelineRuns.markInterruptedForThread(thread.id, errorMsg);
    const record = queries.terminalEvents.create(
      thread.id,
      {
        kind: 'lifecycle',
        message: errorMsg,
      },
      interruptedRun?.id ?? thread.currentRunId ?? null,
    );
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal:event', record);
    }
    transitionThreadPhase(requireMainWindow(), queries, emitter, {
      threadId: thread.id,
      phase: PIPELINE_PHASE.failed,
      errorMessage: errorMsg,
    });
    log.info(`[startup] marked orphaned active thread ${thread.id} as interrupted`);
  }

  // Startup: promote any queued items from a previous session.
  setTimeout(() => {
    const settings = queries.settings.get();
    splashScreen.update('pipeline', 'active', 'Promoting queued work from the last session.');
    for (let i = 0; i < settings.maxConcurrentPipelines; i++) {
      onPipelineTerminal?.({ threadId: '', phase: PIPELINE_PHASE.idle });
    }
    // Also drain any threads that were approved pre-restart and waiting for execution.
    pipelineScheduler.drainExecutionQueue();
  }, 0);

  // Apply persisted log level (default is 'debug' from logger.service.ts init)
  log.transports.file.level = queries.settings.get().devLogLevel;

  // Update service: poll GitHub releases for newer ShipCode builds.
  // Notify-only — install via `brew upgrade --cask shipcode`.
  updateService = new UpdateService(mainWindow);
  if (!E2E_MODE) updateService.start();

  // Register IPC handlers
  splashScreen.completeThrough('pipeline');
  splashScreen.update('ipc', 'active', 'Registering renderer IPC handlers.');
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
    resourceMonitor,
    resyncWorkflowWatchers,
  );

  // Watchdog: reset threads stuck in active phases (handles renderer refresh + crash scenarios).
  // HEARTBEAT_TIMEOUT_MS = 120s. Fires every 30s; skips threads that are live in activePipelines.
  // Also kills agent ptys whose stdout has gone silent for PROCESS_STALL_TIMEOUT_MS — a hung
  // claude/codex child can outlive its phase and pin a thread in 'executing' indefinitely
  // without tripping the heartbeat watchdog above.
  const watchdogTimer: ReturnType<typeof setInterval> | null = E2E_MODE
    ? null
    : setInterval(() => {
        try {
          const activeIds = new Set(activePipeline.listActive().map((s) => s.threadId));
          for (const thread of queries.threads.getStuck(HEARTBEAT_TIMEOUT_MS)) {
            if (activeIds.has(thread.id)) continue;
            const errorMsg =
              'Pipeline timed out — process was likely interrupted by an app refresh.';
            transitionThreadPhase(requireMainWindow(), queries, emitter, {
              threadId: thread.id,
              phase: PIPELINE_PHASE.failed,
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
              phase: PIPELINE_PHASE.failed,
              errorMessage: formatStalledProcessMessage(PROCESS_STALL_TIMEOUT_MS),
            });
          }
        } catch (err) {
          log.error('[watchdog] error during stuck-thread check:', err);
        }
      }, 30_000);

  // Content-Security-Policy — set before any content loads.
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildContentSecurityPolicy(RENDERER_URL)],
      },
    });
  });

  // Lock down navigation before any content loads. The renderer exposes the
  // privileged `window.shipcode` IPC bridge, so the window must never navigate
  // away from the bundled renderer (e.g. via a markdown link in an untrusted
  // GitHub issue body) to an attacker origin that would inherit that bridge,
  // and must never spawn child windows. External web links open in the OS
  // browser instead.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigationTarget(url, RENDERER_URL, RENDERER_HTML)) return;
    event.preventDefault();
    if (isExternalWebUrl(url)) void shell.openExternal(url);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load renderer
  splashScreen.completeThrough('ipc');
  splashScreen.update('renderer', 'active', 'Loading the ShipCode workspace.');
  const rendererTarget = buildRendererLoadTarget(RENDERER_URL, RENDERER_HTML);
  if (rendererTarget.kind === 'url') {
    mainWindow.loadURL(rendererTarget.url);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(rendererTarget.filePath);
  }

  mainWindow.webContents.once('did-fail-load', (_event, _code, description) => {
    splashScreen.update('renderer', 'error', description || 'Renderer failed to load.');
  });

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
    if (watchdogTimer) clearInterval(watchdogTimer);
    reconciliationLoop.stop();
    automationScheduler.stop();
    workflowWatchManager.dispose();
    updateService?.stop();
    updateService = null;
    mainWindow = null;
    processManager?.killAll();
    closeDatabase();
  });
}

app.whenReady().then(() => {
  app.setAboutPanelOptions(buildAboutPanelOptions(app.getVersion()));

  const menu = Menu.buildFromTemplate(
    buildApplicationMenuTemplate({
      updateService,
      openExternal: (url) => shell.openExternal(url),
    }),
  );
  Menu.setApplicationMenu(menu);
  createWindow();
});

app.on('window-all-closed', () => {
  if (shouldQuitWhenAllWindowsClosed()) {
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
