import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createCliContextMock, requireOnboardingMock, getThreadByIssueMock, listByThreadMock } =
  vi.hoisted(() => ({
    createCliContextMock: vi.fn(),
    requireOnboardingMock: vi.fn(),
    getThreadByIssueMock: vi.fn(),
    listByThreadMock: vi.fn(),
  }));

vi.mock('../context', () => ({
  createCliContext: createCliContextMock,
}));

vi.mock('./guard', () => ({
  requireOnboarding: requireOnboardingMock,
}));

import { logsCommand } from './logs';

describe('logsCommand', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Error(`process.exit:${code ?? ''}`);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    requireOnboardingMock.mockReturnValue(true);
    createCliContextMock.mockReturnValue({
      project: {
        id: 'project-1',
      },
      threads: {
        getByProjectAndGithubIssue: getThreadByIssueMock,
      },
      terminalEvents: {
        listByThread: listByThreadMock,
      },
    });
    getThreadByIssueMock.mockReturnValue({
      id: 'thread-1',
      title: 'Add terminal log output',
      status: 'running',
    });
    listByThreadMock.mockReturnValue([]);
  });

  it('does not touch the database before onboarding is complete', async () => {
    requireOnboardingMock.mockReturnValueOnce(false);

    await logsCommand('42');

    expect(createCliContextMock).not.toHaveBeenCalled();
    expect(getThreadByIssueMock).not.toHaveBeenCalled();
  });

  it('exits on invalid issue numbers before looking up a thread', async () => {
    await expect(logsCommand('abc')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith('Invalid issue number:', 'abc');
    expect(getThreadByIssueMock).not.toHaveBeenCalled();
  });

  it('exits when no thread exists for the issue', async () => {
    getThreadByIssueMock.mockReturnValueOnce(null);

    await expect(logsCommand('42')).rejects.toThrow('process.exit:1');

    expect(errorSpy).toHaveBeenCalledWith('No thread found for issue #42 in this project.');
  });

  it('prints a friendly empty state when a thread has no terminal events', async () => {
    await logsCommand('42');

    expect(createCliContextMock).toHaveBeenCalledWith(process.cwd());
    expect(getThreadByIssueMock).toHaveBeenCalledWith('project-1', 42);
    expect(logSpy).toHaveBeenCalledWith('Logs for issue #42: Add terminal log output');
    expect(logSpy).toHaveBeenCalledWith('Status: running\n');
    expect(logSpy).toHaveBeenCalledWith('No terminal events recorded.');
  });

  it('strips terminal control sequences from thread metadata and stored events', async () => {
    getThreadByIssueMock.mockReturnValueOnce({
      id: 'thread-1',
      title: '\u001b[2JAdd terminal log output',
      status: 'running\u0007',
    });
    listByThreadMock.mockReturnValueOnce([
      {
        createdAt: '2026-05-08T12:00:01.000Z',
        event: { kind: 'text', content: 'plain\u001b[2J stdout\n' },
      },
      {
        createdAt: '2026-05-08T12:00:02.000Z',
        event: { kind: 'tool_start', name: 'bun\u0007 test', summary: '\u001b]8;;x\u0007running' },
      },
      {
        createdAt: '2026-05-08T12:00:03.000Z',
        event: { kind: 'error', message: 'command\rfailed' },
      },
    ]);

    await logsCommand('42');

    expect(logSpy).toHaveBeenCalledWith('Logs for issue #42: Add terminal log output');
    expect(logSpy).toHaveBeenCalledWith('Status: running\n');
    expect(writeSpy).toHaveBeenCalledWith('plain stdout\n');
    expect(logSpy).toHaveBeenCalledWith('[12:00:02] Tool: bun test — running');
    expect(logSpy).toHaveBeenCalledWith('[12:00:03] Error: commandfailed');
  });

  it('renders terminal event variants for CLI output', async () => {
    listByThreadMock.mockReturnValueOnce([
      {
        createdAt: '2026-05-08T12:00:01.000Z',
        event: { kind: 'text', content: 'plain stdout\n' },
      },
      {
        createdAt: '2026-05-08T12:00:02.000Z',
        event: { kind: 'thinking', content: 'x'.repeat(130) },
      },
      {
        createdAt: '2026-05-08T12:00:03.000Z',
        event: { kind: 'tool_start', name: 'bun test', summary: 'running tests' },
      },
      {
        createdAt: '2026-05-08T12:00:04.000Z',
        event: { kind: 'tool_end', name: 'bun test', exitCode: 1 },
      },
      {
        createdAt: '2026-05-08T12:00:04.500Z',
        event: { kind: 'tool_end', name: 'bun lint', exitCode: 0 },
      },
      {
        createdAt: '2026-05-08T12:00:05.000Z',
        event: { kind: 'lifecycle', message: 'started\n' },
      },
      {
        createdAt: '2026-05-08T12:00:06.000Z',
        event: { kind: 'raw', content: '{"type":"event"}\n' },
      },
      {
        createdAt: '2026-05-08T12:00:07.000Z',
        event: { kind: 'error', message: 'command failed' },
      },
      {
        createdAt: '2026-05-08T12:00:08.000Z',
        event: { kind: 'clarification_requested', summary: 'Need approval' },
      },
      {
        createdAt: '2026-05-08T12:00:09.000Z',
        event: { kind: 'clarification_answered', questionCount: 2 },
      },
      {
        createdAt: '2026-05-08T12:00:10.000Z',
        event: { kind: 'done', totalCostUsd: 0.12345 },
      },
      {
        createdAt: '2026-05-08T12:00:11.000Z',
        event: { kind: 'done' },
      },
      {
        createdAt: '2026-05-08T12:00:12.000Z',
        event: { kind: 'turn_start' },
      },
      {
        createdAt: '2026-05-08T12:00:13.000Z',
        event: { kind: 'turn_end' },
      },
      {
        createdAt: '2026-05-08T12:00:14.000Z',
        event: { kind: 'action', summary: 'hidden action' },
      },
    ]);

    await logsCommand('42');

    expect(writeSpy).toHaveBeenCalledWith('plain stdout\n');
    expect(writeSpy).toHaveBeenCalledWith('[12:00:05] started\n');
    expect(writeSpy).toHaveBeenCalledWith('{"type":"event"}\n');
    expect(logSpy).toHaveBeenCalledWith(`[12:00:02] Thinking: ${'x'.repeat(120)}...`);
    expect(logSpy).toHaveBeenCalledWith('[12:00:03] Tool: bun test — running tests');
    expect(logSpy).toHaveBeenCalledWith('[12:00:04] Tool done: bun test (exit 1)');
    expect(logSpy).toHaveBeenCalledWith('[12:00:07] Error: command failed');
    expect(logSpy).toHaveBeenCalledWith('[12:00:08] Clarification requested: Need approval');
    expect(logSpy).toHaveBeenCalledWith('[12:00:09] Clarification answered (2 questions)');
    expect(logSpy).toHaveBeenCalledWith('[12:00:10] Done — cost: $0.1235');
    expect(logSpy).toHaveBeenCalledWith('[12:00:11] Done');
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('hidden action'));
    expect(writeSpy).not.toHaveBeenCalledWith(expect.stringContaining('hidden action'));
  });
});
