import * as pty from 'node-pty'
import { nanoid } from 'nanoid'
import { EventEmitter } from 'node:events'
import type { AgentType, AgentState } from '@crosscode/shared'

export interface ManagedProcess {
  id: string
  type: AgentType
  state: AgentState
  pty: pty.IPty
  cwd: string
  exitCode: number | null
}

interface ProcessManagerEvents {
  output: (processId: string, data: string) => void
  stateChange: (processId: string, type: AgentType, state: AgentState) => void
  exit: (processId: string, exitCode: number) => void
}

export class ProcessManager extends EventEmitter {
  private processes: Map<string, ManagedProcess> = new Map()

  spawn(
    type: AgentType,
    command: string,
    args: string[],
    cwd: string
  ): ManagedProcess {
    const id = nanoid()

    const ptyProcess = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: { ...process.env, FORCE_COLOR: '1' },
    })

    const managed: ManagedProcess = {
      id,
      type,
      state: 'starting',
      pty: ptyProcess,
      cwd,
      exitCode: null,
    }

    this.processes.set(id, managed)
    this.updateState(id, 'running')

    ptyProcess.onData((data: string) => {
      this.emit('output', id, data)
    })

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      managed.exitCode = exitCode
      this.updateState(id, 'exited')
      this.emit('exit', id, exitCode)
    })

    return managed
  }

  kill(processId: string): void {
    const process = this.processes.get(processId)
    if (process && process.state !== 'exited') {
      process.pty.kill()
      this.updateState(processId, 'exited')
    }
  }

  write(processId: string, data: string): void {
    const process = this.processes.get(processId)
    if (process && process.state === 'running') {
      process.pty.write(data)
    }
  }

  resize(processId: string, cols: number, rows: number): void {
    const process = this.processes.get(processId)
    if (process && process.state !== 'exited') {
      process.pty.resize(cols, rows)
    }
  }

  get(processId: string): ManagedProcess | undefined {
    return this.processes.get(processId)
  }

  listActive(): ManagedProcess[] {
    return Array.from(this.processes.values()).filter(
      (p) => p.state === 'running' || p.state === 'starting'
    )
  }

  killAll(): void {
    for (const [id] of this.processes) {
      this.kill(id)
    }
  }

  cleanup(processId: string): void {
    const process = this.processes.get(processId)
    if (process && process.state === 'exited') {
      this.processes.delete(processId)
    }
  }

  private updateState(processId: string, state: AgentState): void {
    const process = this.processes.get(processId)
    if (process) {
      process.state = state
      this.emit('stateChange', processId, process.type, state)
    }
  }
}
