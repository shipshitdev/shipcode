import type { AgentType } from '@shipcode/shared';

export interface InteractiveTerminalSession {
  processId: string;
  threadId: string;
  cwd: string;
  provider: Extract<AgentType, 'claude' | 'codex'> | 'shell';
  mode: 'interactive';
  startedAt: number;
  lastEventAt: number;
  exitCode: number | null;
}

const sessions = new Map<string, InteractiveTerminalSession>();

export function registerInteractiveTerminalSession(session: InteractiveTerminalSession): void {
  sessions.set(session.threadId, session);
}

export function getInteractiveTerminalSession(threadId: string): InteractiveTerminalSession | null {
  return sessions.get(threadId) ?? null;
}

export function touchInteractiveTerminalSession(threadId: string): void {
  const session = sessions.get(threadId);
  if (!session) return;
  session.lastEventAt = Date.now();
}

export function completeInteractiveTerminalSession(threadId: string, exitCode: number): void {
  const session = sessions.get(threadId);
  if (!session) return;
  session.exitCode = exitCode;
  session.lastEventAt = Date.now();
}

export function unregisterInteractiveTerminalSession(threadId: string): void {
  sessions.delete(threadId);
}
