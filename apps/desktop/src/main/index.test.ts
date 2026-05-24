import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appHandlers = new Map<string, (...args: unknown[]) => unknown>();
const windows: BrowserWindowMock[] = [];

const appMock = {
  setName: vi.fn(),
  getPath: vi.fn(() => '/tmp/shipcode-user-data'),
  getVersion: vi.fn(() => '1.2.3'),
  setAboutPanelOptions: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
  on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
    appHandlers.set(event, handler);
  }),
  quit: vi.fn(),
  exit: vi.fn(),
};

class BrowserWindowMock extends EventEmitter {
  static getAllWindows = vi.fn(() => windows);

  options: unknown;
  loadFile = vi.fn();
  loadURL = vi.fn();
  show = vi.fn();
  close = vi.fn(() => {
    this.emit('closed');
  });
  restore = vi.fn();
  focus = vi.fn();
  isDestroyed = vi.fn(() => false);
  isMinimized = vi.fn(() => false);
  isVisible = vi.fn(() => true);
  webContents = Object.assign(new EventEmitter(), {
    send: vi.fn(),
    openDevTools: vi.fn(),
    session: {
      webRequest: {
        onHeadersReceived: vi.fn(),
      },
    },
  });

  constructor(options: unknown) {
    super();
    this.options = options;
    windows.push(this);
  }
}

const dialogMock = {
  showMessageBox: vi.fn(async () => ({ response: 1 })),
};

const menuMock = {
  buildFromTemplate: vi.fn(() => ({ id: 'menu' })),
  setApplicationMenu: vi.fn(),
};

const shellMock = {
  openExternal: vi.fn(),
};
const originalPlatform = process.platform;
const originalProcessEmit = process.emit;
const originalUncaughtListeners = process.listeners('uncaughtException');
const originalUnhandledRejectionListeners = process.listeners('unhandledRejection');

const logMock = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  transports: { file: { level: 'debug' } },
};

const telemetryMock = {
  captureMainException: vi.fn(),
  configureMainTelemetry: vi.fn(async () => undefined),
};

const processManagerMock = {
  killStalled: vi.fn(() => [] as string[]),
  get: vi.fn(),
  killAll: vi.fn(),
  killAllAndWait: vi.fn(async () => undefined),
};

const pipelineMock = {
  listActive: vi.fn(() => [] as { threadId: string }[]),
};

const reconciliationLoopMock = {
  start: vi.fn(),
  stop: vi.fn(),
};

const pipelineSchedulerMock = {
  onSlotFreed: vi.fn(),
  onExecutionSlotFreed: vi.fn(),
  drainExecutionQueue: vi.fn(),
};

const automationSchedulerMock = {
  start: vi.fn(),
};

const updateServiceMock = {
  start: vi.fn(),
  stop: vi.fn(),
};

const splashScreenMock = {
  create: vi.fn(),
  update: vi.fn(),
  completeThrough: vi.fn(),
  close: vi.fn(),
};
const createOpenRouterProviderMock = vi.fn(() => ({ key: 'openrouter' }));
const createPipelineMock = vi.fn(() => pipelineMock);
const createReconciliationLoopMock = vi.fn(() => reconciliationLoopMock);
const createElectronEmitterMock = vi.fn(() => ({ emit: vi.fn() }));
const notifyIssueGraphPipelinePhaseChangeMock = vi.fn();
const transitionThreadPhaseMock = vi.fn();
const ghIssueMock = {
  state: 'OPEN',
  labels: ['shipcode'],
};
const ghGetIssueMock = vi.fn(async () => ghIssueMock);
const orphanedThreads: Array<{ id: string }> = [];
const stuckThreads: Array<{ id: string }> = [];
let throwOnGetStuck = false;

const settingsRecord = {
  devLogLevel: 'info',
  maxConcurrentPipelines: 2,
};

const construct = <T>(value: T) =>
  vi.fn(function mockConstructor() {
    return value;
  });

class QueryMock {
  get = vi.fn(() => settingsRecord);
  getById = vi.fn((id: string) => ({ id, title: `Thread ${id}` }));
  getOrphaned = vi.fn(() => orphanedThreads);
  getStuck = vi.fn(() => {
    if (throwOnGetStuck) throw new Error('watchdog database failed');
    return stuckThreads;
  });
  create = vi.fn((_threadId: string, record: unknown) => ({
    id: 'terminal-1',
    ...(record as Record<string, unknown>),
  }));
  markInterruptedForThread = vi.fn((_threadId: string, _errorMsg: string) => ({
    id: 'run-interrupted',
  }));
}

function installMocks() {
  vi.doMock('electron', () => ({
    app: appMock,
    BrowserWindow: BrowserWindowMock,
    dialog: dialogMock,
    ipcMain: {},
    Menu: menuMock,
    shell: shellMock,
  }));

  vi.doMock('./logger.service', () => ({ default: logMock }));
  vi.doMock('./telemetry', () => telemetryMock);
  vi.doMock('./splash-screen', () => ({
    SplashScreen: construct(splashScreenMock),
  }));
  vi.doMock('@shipcode/agents/source', () => ({
    createClaudeCliProvider: vi.fn(() => ({ key: 'claude' })),
    createCodexCliProvider: vi.fn(() => ({ key: 'codex' })),
    createGeminiCliProvider: vi.fn(() => ({ key: 'gemini' })),
    createOpenRouterProvider: createOpenRouterProviderMock,
    createProviderRegistry: vi.fn((providers) => providers),
    GhCli: vi.fn(function GhCliMock() {
      return { getIssue: ghGetIssueMock };
    }),
    ProcessManager: construct(processManagerMock),
  }));
  vi.doMock('@shipcode/db', () => ({
    ActivityQueries: QueryMock,
    AgentConversationQueries: QueryMock,
    AutomationQueries: QueryMock,
    CheckpointQueries: QueryMock,
    CostsQueries: QueryMock,
    closeDatabase: vi.fn(),
    DashboardQueries: QueryMock,
    DiffQueries: QueryMock,
    FeatureQaResultQueries: QueryMock,
    GitHubIssueQueries: QueryMock,
    getDatabase: vi.fn(() => ({ id: 'db' })),
    HeatmapQueries: QueryMock,
    IssueEdgeQueries: QueryMock,
    NotificationsQueries: QueryMock,
    PhaseLogQueries: QueryMock,
    PipelineAnalyticsQueries: QueryMock,
    PipelineRunQueries: QueryMock,
    PipelineStepQueries: QueryMock,
    PipelineWakeRequestQueries: QueryMock,
    PlanQueries: QueryMock,
    ProjectFailureQueries: QueryMock,
    ProjectQueries: QueryMock,
    PromptTelemetryQueries: QueryMock,
    ReviewQueries: QueryMock,
    SettingsQueries: QueryMock,
    SkillResolutionLogQueries: QueryMock,
    SkillsQueries: QueryMock,
    TerminalEventQueries: QueryMock,
    ThreadQueries: QueryMock,
    TriageRuleQueries: QueryMock,
    VerificationQueries: QueryMock,
  }));
  vi.doMock('@shipcode/db/source', () => ({
    TaskGraphQueries: QueryMock,
  }));
  vi.doMock('@shipcode/pipeline', () => ({
    createPipeline: createPipelineMock,
    createReconciliationLoop: createReconciliationLoopMock,
  }));
  vi.doMock('./automation-scheduler', () => ({
    AutomationScheduler: construct(automationSchedulerMock),
  }));
  vi.doMock('./chat-notification-service', () => ({
    ChatNotificationService: vi.fn(function ChatNotificationServiceMock() {}),
  }));
  vi.doMock('./notification-service', () => ({
    NotificationService: vi.fn(function NotificationServiceMock() {}),
  }));
  vi.doMock('./pipeline-bridge', () => ({
    createElectronEmitter: createElectronEmitterMock,
  }));
  vi.doMock('./pipeline-scheduler', () => ({
    PipelineScheduler: construct(pipelineSchedulerMock),
  }));
  vi.doMock('./resource-monitor', () => ({
    ResourceMonitor: construct({ canStartCpuTask: vi.fn(() => ({ allowed: true })) }),
  }));
  vi.doMock('./update-service', () => ({
    UpdateService: construct(updateServiceMock),
  }));
  vi.doMock('./ipc', () => ({
    registerIpcHandlers: vi.fn(),
  }));
  vi.doMock('./ipc/helpers', () => ({
    transitionThreadPhase: transitionThreadPhaseMock,
  }));
  vi.doMock('./ipc/register-issue-graph-handlers', () => ({
    notifyIssueGraphPipelinePhaseChange: notifyIssueGraphPipelinePhaseChangeMock,
  }));
}

async function importMain() {
  await import('./index');
  await Promise.resolve();
}

describe('main index bootstrap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    appHandlers.clear();
    windows.length = 0;
    orphanedThreads.length = 0;
    stuckThreads.length = 0;
    throwOnGetStuck = false;
    pipelineMock.listActive.mockReturnValue([]);
    processManagerMock.killStalled.mockReturnValue([]);
    processManagerMock.get.mockReturnValue(undefined);
    dialogMock.showMessageBox.mockResolvedValue({ response: 1 });
    ghGetIssueMock.mockResolvedValue(ghIssueMock);
    delete process.env.VITE_DEV_SERVER_URL;
    installMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.emit = originalProcessEmit;
    process.removeAllListeners('uncaughtException');
    for (const listener of originalUncaughtListeners) {
      process.on('uncaughtException', listener);
    }
    process.removeAllListeners('unhandledRejection');
    for (const listener of originalUnhandledRejectionListeners) {
      process.on('unhandledRejection', listener);
    }
    vi.useRealTimers();
    vi.doUnmock('electron');
  });

  it('creates the application window and starts main-process services', async () => {
    await importMain();

    expect(appMock.setName).toHaveBeenCalledWith('ShipCode');
    expect(appMock.setAboutPanelOptions).toHaveBeenCalledWith(
      expect.objectContaining({ applicationVersion: '1.2.3' }),
    );
    expect(menuMock.setApplicationMenu).toHaveBeenCalledWith({ id: 'menu' });
    expect(windows).toHaveLength(1);
    expect(splashScreenMock.create).toHaveBeenCalled();
    expect(telemetryMock.configureMainTelemetry).toHaveBeenCalledWith(settingsRecord);
    expect(automationSchedulerMock.start).toHaveBeenCalled();
    expect(reconciliationLoopMock.start).toHaveBeenCalled();
    expect(updateServiceMock.start).toHaveBeenCalled();
    expect(windows[0]?.loadFile).toHaveBeenCalledWith(expect.stringContaining('index.html'));

    windows[0]?.emit('ready-to-show');

    expect(windows[0]?.show).toHaveBeenCalled();
    expect(splashScreenMock.close).toHaveBeenCalled();
  });

  it('handles process warnings and top-level process errors', async () => {
    await importMain();

    expect(process.emit('warning', { name: 'ExperimentalWarning' } as Error)).toBe(false);

    const uncaught = process.listeners('uncaughtException').at(-1);
    const rejection = process.listeners('unhandledRejection').at(-1);
    uncaught?.(new Error('uncaught test'), 'uncaughtException');
    rejection?.(new Error('rejection test'), Promise.resolve());

    expect(logMock.error).toHaveBeenCalledWith(
      '[main] uncaught exception:',
      expect.objectContaining({ message: 'uncaught test' }),
    );
    expect(logMock.error).toHaveBeenCalledWith(
      '[main] unhandled rejection:',
      expect.objectContaining({ message: 'rejection test' }),
    );
    expect(telemetryMock.captureMainException).toHaveBeenCalledTimes(2);
  });

  it('logs telemetry init failures and keeps the CPU task gate permissive before resource monitor setup', async () => {
    telemetryMock.configureMainTelemetry.mockRejectedValueOnce(new Error('telemetry failed'));
    createPipelineMock.mockImplementationOnce(((...args: unknown[]) => {
      const deps = args[0] as { cpuTaskGate: { canStartCpuTask: () => unknown } };
      expect(deps.cpuTaskGate.canStartCpuTask()).toEqual({ allowed: true });
      return pipelineMock;
    }) as () => typeof pipelineMock);

    await importMain();
    await Promise.resolve();

    expect(logMock.warn).toHaveBeenCalledWith(
      '[telemetry] init failed:',
      expect.objectContaining({ message: 'telemetry failed' }),
    );
  });

  it('runs startup callbacks registered by the pipeline and renderer boot process', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-key';
    stuckThreads.push({ id: 'stuck-thread' });
    processManagerMock.killStalled.mockReturnValue(['proc-1', 'proc-2'] as string[]);
    processManagerMock.get.mockImplementation((id: string) =>
      id === 'proc-1'
        ? { threadId: 'stalled-thread', type: 'claude' }
        : { threadId: null, type: 'codex' },
    );

    await importMain();

    const emitterCallbacks = (
      createElectronEmitterMock.mock.calls[0] as unknown as unknown[]
    )?.[1] as {
      onPipelineTerminal: (event: { threadId: string; phase: string }) => void;
      onExecutionSlotFreed: () => void;
    };
    emitterCallbacks.onPipelineTerminal({ threadId: 'thread-1', phase: 'idle' });
    emitterCallbacks.onExecutionSlotFreed();

    expect(notifyIssueGraphPipelinePhaseChangeMock).toHaveBeenCalledWith({
      threadId: 'thread-1',
      phase: 'idle',
    });
    expect(pipelineSchedulerMock.onSlotFreed).toHaveBeenCalled();
    expect(pipelineSchedulerMock.onExecutionSlotFreed).toHaveBeenCalled();

    notifyIssueGraphPipelinePhaseChangeMock.mockImplementationOnce(() => {
      throw new Error('promotion failed');
    });
    emitterCallbacks.onPipelineTerminal({ threadId: 'thread-error', phase: 'idle' });
    expect(logMock.error).toHaveBeenCalledWith(
      '[queue] promotion error:',
      expect.objectContaining({ message: 'promotion failed' }),
    );

    const reconciliationOptions = (
      createReconciliationLoopMock.mock.calls[0] as unknown as unknown[]
    )?.[0] as {
      issueStateProvider: {
        getIssueState: (projectPath: string, issueNumber: number) => Promise<unknown>;
      };
      onReconciliationCancel: (threadId: string, reason: string) => void;
      log: (message: string) => void;
    };
    await expect(
      reconciliationOptions.issueStateProvider.getIssueState('/tmp/repo', 42),
    ).resolves.toEqual(ghIssueMock);
    reconciliationOptions.onReconciliationCancel('thread-2', 'closed upstream');
    reconciliationOptions.log('reconciled');

    const openRouterOptions = (
      createOpenRouterProviderMock.mock.calls[0] as unknown as unknown[]
    )?.[0] as {
      getApiKey: () => string | undefined;
      getSettings: () => unknown;
    };
    expect(openRouterOptions.getApiKey()).toBe('openrouter-key');
    expect(openRouterOptions.getSettings()).toBe(settingsRecord);

    vi.runOnlyPendingTimers();

    expect(splashScreenMock.update).toHaveBeenCalledWith(
      'pipeline',
      'active',
      'Promoting queued work from the last session.',
    );
    expect(pipelineSchedulerMock.drainExecutionQueue).toHaveBeenCalled();

    const headerCallback = vi.fn();
    const onHeadersReceived = windows[0]?.webContents.session.webRequest.onHeadersReceived;
    const headerHandler = onHeadersReceived.mock.calls[0]?.[0] as (
      details: { responseHeaders: Record<string, string[]> },
      callback: (result: unknown) => void,
    ) => void;
    headerHandler({ responseHeaders: { 'x-test': ['ok'] } }, headerCallback);
    expect(headerCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        responseHeaders: expect.objectContaining({
          'Content-Security-Policy': expect.arrayContaining([
            expect.stringContaining("default-src 'none'"),
          ]),
        }),
      }),
    );

    windows[0]?.webContents.emit('did-fail-load', {}, -1, 'Renderer crashed');
    expect(splashScreenMock.update).toHaveBeenCalledWith('renderer', 'error', 'Renderer crashed');

    vi.advanceTimersByTime(30_000);

    expect(transitionThreadPhaseMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ threadId: 'stuck-thread' }),
    );
    expect(transitionThreadPhaseMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ threadId: 'stalled-thread' }),
    );
  });

  it('skips live stuck threads and logs watchdog failures', async () => {
    await importMain();
    stuckThreads.push({ id: 'active-thread' });
    pipelineMock.listActive.mockReturnValue([{ threadId: 'active-thread' }]);

    vi.advanceTimersByTime(30_000);

    expect(transitionThreadPhaseMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ threadId: 'active-thread' }),
    );

    throwOnGetStuck = true;
    vi.advanceTimersByTime(30_000);

    expect(logMock.error).toHaveBeenCalledWith(
      '[watchdog] error during stuck-thread check:',
      expect.objectContaining({ message: 'watchdog database failed' }),
    );
  });

  it('marks orphaned active threads as failed during startup', async () => {
    orphanedThreads.push({ id: 'orphan-thread' });

    await importMain();

    expect(windows[0]?.webContents.send).toHaveBeenCalledWith(
      'terminal:event',
      expect.objectContaining({ message: expect.stringContaining('Pipeline interrupted') }),
    );
    expect(transitionThreadPhaseMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ threadId: 'orphan-thread', phase: 'failed' }),
    );
  });

  it('confirms closing the main window when pipelines are active', async () => {
    await importMain();
    pipelineMock.listActive.mockReturnValue([{ threadId: 'active-thread' }]);
    dialogMock.showMessageBox.mockResolvedValueOnce({ response: 0 });

    const event: { preventDefault: () => void } = { preventDefault: vi.fn() };
    const closeHandler = windows[0]?.listeners('close')[0] as (event: {
      preventDefault: () => void;
    }) => Promise<void>;
    await closeHandler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(dialogMock.showMessageBox).toHaveBeenCalledWith(
      windows[0],
      expect.objectContaining({ title: 'Pipelines still running' }),
    );
    expect(windows[0]?.close).toHaveBeenCalled();
  });

  it('lets an inactive window close without confirmation', async () => {
    await importMain();

    const event: { preventDefault: () => void } = { preventDefault: vi.fn() };
    const closeHandler = windows[0]?.listeners('close')[0] as (event: {
      preventDefault: () => void;
    }) => Promise<void>;
    await closeHandler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(dialogMock.showMessageBox).not.toHaveBeenCalled();
  });

  it('keeps the app open and restores the window when active-pipeline quit is cancelled', async () => {
    await importMain();
    pipelineMock.listActive.mockReturnValue([{ threadId: 'active-thread' }]);
    dialogMock.showMessageBox.mockResolvedValueOnce({ response: 1 });
    windows[0]?.isMinimized.mockReturnValue(true);
    windows[0]?.isVisible.mockReturnValue(false);

    const event = { preventDefault: vi.fn() };
    await appHandlers.get('before-quit')?.(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(windows[0]?.restore).toHaveBeenCalled();
    expect(windows[0]?.show).toHaveBeenCalled();
    expect(windows[0]?.focus).toHaveBeenCalled();
    expect(processManagerMock.killAllAndWait).not.toHaveBeenCalled();
  });

  it('confirms active-pipeline quit, handles kill errors, and ignores the second quit pass', async () => {
    await importMain();
    pipelineMock.listActive.mockReturnValue([{ threadId: 'active-thread' }]);
    dialogMock.showMessageBox.mockResolvedValueOnce({ response: 0 });
    processManagerMock.killAllAndWait.mockRejectedValueOnce(new Error('kill failed'));

    const event = { preventDefault: vi.fn() };
    await appHandlers.get('before-quit')?.(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(logMock.error).toHaveBeenCalledWith(
      '[main] killAllAndWait failed during quit:',
      expect.objectContaining({ message: 'kill failed' }),
    );
    expect(appMock.exit).toHaveBeenCalledWith(0);

    const secondEvent = { preventDefault: vi.fn() };
    await appHandlers.get('before-quit')?.(secondEvent);

    expect(secondEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('wires external links in the application menu', async () => {
    await importMain();

    const template = (
      menuMock.buildFromTemplate.mock.calls[0] as unknown as unknown[]
    )?.[0] as Array<{
      click?: () => void;
      submenu?: unknown[];
    }>;
    const clickableItems: Array<{ click?: () => void }> = [];
    const collect = (items: unknown[]) => {
      for (const item of items as Array<{ click?: () => void; submenu?: unknown[] }>) {
        clickableItems.push(item);
        if (item.submenu) collect(item.submenu);
      }
    };
    collect(template);
    for (const item of clickableItems) {
      item.click?.();
    }

    expect(shellMock.openExternal).toHaveBeenCalled();
  });

  it('quits on non-macOS window close and drains processes before exit', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    await importMain();

    appHandlers.get('window-all-closed')?.();

    expect(appMock.quit).toHaveBeenCalled();

    const event = { preventDefault: vi.fn() };
    await appHandlers.get('before-quit')?.(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(processManagerMock.killAllAndWait).toHaveBeenCalledWith(5000);
    expect(appMock.exit).toHaveBeenCalledWith(0);
  });

  it('loads the dev server URL and opens devtools when VITE_DEV_SERVER_URL is set', async () => {
    process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';

    await importMain();

    expect(windows[0]?.loadURL).toHaveBeenCalledWith('http://localhost:5173');
    expect(windows[0]?.webContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' });
  });
});
