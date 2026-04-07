import { watch, type FSWatcher } from 'chokidar'
import type { BrowserWindow } from 'electron'
import { FILE_WATCH_DEBOUNCE_MS, IGNORED_DIRECTORIES } from '@crosscode/shared'
import type { FileChange } from '@crosscode/shared'

export function createFileWatcher(
  watchPath: string,
  projectId: string,
  mainWindow: BrowserWindow
): FSWatcher {
  const pendingChanges: FileChange[] = []
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const watcher = watch(watchPath, {
    ignored: IGNORED_DIRECTORIES.map((dir) => `**/${dir}/**`),
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
  })

  function flushChanges() {
    if (pendingChanges.length > 0) {
      const changes = [...pendingChanges]
      pendingChanges.length = 0
      mainWindow.webContents.send('files:changed', { projectId, changes })
    }
  }

  function queueChange(change: FileChange) {
    pendingChanges.push(change)
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(flushChanges, FILE_WATCH_DEBOUNCE_MS)
  }

  watcher
    .on('add', (filePath) => queueChange({ path: filePath, type: 'add' }))
    .on('change', (filePath) => queueChange({ path: filePath, type: 'change' }))
    .on('unlink', (filePath) => queueChange({ path: filePath, type: 'unlink' }))

  return watcher
}
