import { beforeEach, describe, expect, it, vi } from 'vitest';

const { closeMock, questionMock, createInterfaceMock, runCommandMock } = vi.hoisted(() => ({
  closeMock: vi.fn(),
  questionMock: vi.fn(),
  createInterfaceMock: vi.fn(),
  runCommandMock: vi.fn(),
}));

vi.mock('node:readline', () => ({
  createInterface: createInterfaceMock,
}));

vi.mock('./run', () => ({
  runCommand: runCommandMock,
}));

import { startCommand } from './start';

describe('startCommand', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    createInterfaceMock.mockReturnValue({
      question: questionMock,
      close: closeMock,
    });
  });

  it('prompts for an issue number and forwards trimmed input to runCommand', async () => {
    questionMock.mockImplementation((_prompt: string, resolve: (answer: string) => void) => {
      resolve(' 42 ');
    });

    await startCommand();

    expect(createInterfaceMock).toHaveBeenCalledWith({
      input: process.stdin,
      output: process.stdout,
    });
    expect(questionMock).toHaveBeenCalledWith('Enter GitHub issue number: ', expect.any(Function));
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(runCommandMock).toHaveBeenCalledWith('42');
  });

  it('logs when the prompt is left empty', async () => {
    questionMock.mockImplementation((_prompt: string, resolve: (answer: string) => void) => {
      resolve('   ');
    });

    await startCommand();

    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(runCommandMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('No issue number provided.');
  });
});
