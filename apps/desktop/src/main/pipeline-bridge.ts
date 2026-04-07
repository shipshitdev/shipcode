import type { BrowserWindow } from 'electron'
import type { PipelineEmitter, PipelineEvent } from '@shipcode/pipeline'

export function createElectronEmitter(mainWindow: BrowserWindow): PipelineEmitter {
  return {
    emit(event: PipelineEvent) {
      mainWindow.webContents.send(event.type, event)
    }
  }
}
