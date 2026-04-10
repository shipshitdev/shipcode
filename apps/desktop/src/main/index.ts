// Suppress ExperimentalWarning from node:sqlite (RC module in Node v24).
// This runs before require('@shipcode/db') in CJS output (vite builds main as CJS).
const _origEmit = process.emit.bind(process)
process.emit = function (event: string, ...args: any[]) {
  if (event === 'warning' && args[0]?.name === 'ExperimentalWarning') return false
  return _origEmit(event, ...args)
} as typeof process.emit

import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { getDatabase, closeDatabase, ProjectQueries, ThreadQueries, PlanQueries, ReviewQueries, DiffQueries, SettingsQueries, VerificationQueries, GitHubIssueQueries, ActivityQueries, NotificationsQueries, DashboardQueries } from '@shipcode/db'
import {
  ProcessManager,
  createClaudeCliProvider,
  createCodexCliProvider,
  createOpenRouterProvider,
  createProviderRegistry,
} from '@shipcode/agents'
import { registerIpcHandlers } from './ipc'
import { createPipeline } from '@shipcode/pipeline'
import { createElectronEmitter } from './pipeline-bridge'
import { NotificationService } from './notification-service'

let mainWindow: BrowserWindow | null = null

const DIST = path.join(__dirname, '..')
const RENDERER_URL = process.env.VITE_DEV_SERVER_URL
const RENDERER_HTML = path.join(DIST, 'renderer', 'index.html')

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(DIST, 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Initialize database
  const dataDir = path.join(app.getPath('userData'), 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  const db = getDatabase(dataDir)

  // Initialize services
  const processManager = new ProcessManager()
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
  }

  // Notification service — reads settings, writes notifications + activity,
  // emits OS notifications and dock badges. Must be constructed before the
  // pipeline emitter because the emitter fans out to it.
  const notificationService = new NotificationService(
    mainWindow,
    queries.notifications,
    queries.settings,
    queries.activity,
  )

  // Initialize pipeline state machine
  const emitter = createElectronEmitter(mainWindow, {
    activity: queries.activity,
    threads: queries.threads,
    notifications: notificationService,
  })

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
  })

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
  })

  // Register IPC handlers
  registerIpcHandlers(ipcMain, mainWindow, queries, processManager, pipeline, notificationService)

  // Content-Security-Policy — set before any content loads.
  // Dev relaxes script-src for Vite's eval-based HMR and allows the WS connection.
  // Prod is strict: no eval, no remote origins.
  // 'unsafe-inline' is required in dev for @vitejs/plugin-react's HMR preamble.
  const scriptSrc = RENDERER_URL ? "'self' 'unsafe-eval' 'unsafe-inline'" : "'self'"
  const connectSrc = RENDERER_URL
    ? "'self' ws://localhost:5173 http://localhost:5173"
    : "'self'"
  // Dev: notify.wav resolves to http://localhost:5173/...; prod: Vite bundles to blob: URL
  const mediaSrc = RENDERER_URL ? "'self' http://localhost:5173" : "'self' blob:"
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'none'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; connect-src ${connectSrc}; img-src 'self' data: https:; font-src 'self' data:; media-src ${mediaSrc}`,
        ],
      },
    })
  })

  // Load renderer
  if (RENDERER_URL) {
    mainWindow.loadURL(RENDERER_URL)
    mainWindow.webContents.openDevTools({ mode: 'bottom' })
  } else {
    mainWindow.loadFile(RENDERER_HTML)
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    processManager.killAll()
    closeDatabase()
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
