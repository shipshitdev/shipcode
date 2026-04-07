import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Request-response (invoke)
  invoke: <T>(channel: string, args?: unknown): Promise<T> => {
    return ipcRenderer.invoke(channel, args)
  },

  // Streaming (on/off)
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },
}

contextBridge.exposeInMainWorld('shipcode', api)
