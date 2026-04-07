import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { getDatabase, closeDatabase, ProjectQueries, ThreadQueries, PlanQueries, ReviewQueries, DiffQueries, SettingsQueries, VerificationQueries, GitHubIssueQueries } from '@shipcode/db'
import { ProcessManager } from '@shipcode/agents'
import { registerIpcHandlers } from './ipc'
import { createPipeline } from './pipeline'

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
  }

  // Initialize pipeline state machine
  const pipeline = createPipeline({
    mainWindow,
    processManager,
    threads: queries.threads,
    plans: queries.plans,
    reviews: queries.reviews,
    verifications: queries.verifications,
    githubIssues: queries.githubIssues,
  })

  // Register IPC handlers
  registerIpcHandlers(ipcMain, mainWindow, queries, processManager, pipeline)

  // Load renderer
  if (RENDERER_URL) {
    mainWindow.loadURL(RENDERER_URL)
    mainWindow.webContents.openDevTools()
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
