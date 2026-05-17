import { beforeEach, describe, expect, it, vi } from 'vitest';

const onboardCommandMock = vi.fn();
const runCommandMock = vi.fn();
const startCommandMock = vi.fn();
const statusCommandMock = vi.fn();
const planCommandMock = vi.fn();
const approveCommandMock = vi.fn();
const reviewCommandMock = vi.fn();
const retryCommandMock = vi.fn();
const logsCommandMock = vi.fn();
const terminalCommandMock = vi.fn();
const terminalSummaryCommandMock = vi.fn();
const terminalCommentCommandMock = vi.fn();
const prdCommandMock = vi.fn();
const parseMock = vi.fn();

const { commandCalls, resetCommanderMock } = vi.hoisted(() => {
  const commandCalls: Array<{
    name: string;
    description?: string;
    options: Array<{ flags: string; description: string; defaultValue?: string }>;
    action?: unknown;
  }> = [];

  return {
    commandCalls,
    resetCommanderMock: () => {
      commandCalls.length = 0;
      parseMock.mockReset();
    },
  };
});

vi.mock('./commands/onboard', () => ({
  onboardCommand: onboardCommandMock,
}));

vi.mock('./commands/run', () => ({
  runCommand: runCommandMock,
}));

vi.mock('./commands/start', () => ({
  startCommand: startCommandMock,
}));

vi.mock('./commands/status', () => ({
  statusCommand: statusCommandMock,
}));

vi.mock('./commands/plan', () => ({
  planCommand: planCommandMock,
}));

vi.mock('./commands/approve', () => ({
  approveCommand: approveCommandMock,
}));

vi.mock('./commands/review', () => ({
  reviewCommand: reviewCommandMock,
}));

vi.mock('./commands/retry', () => ({
  retryCommand: retryCommandMock,
}));

vi.mock('./commands/logs', () => ({
  logsCommand: logsCommandMock,
}));

vi.mock('./commands/terminal', () => ({
  terminalCommand: terminalCommandMock,
  terminalSummaryCommand: terminalSummaryCommandMock,
  terminalCommentCommand: terminalCommentCommandMock,
}));

vi.mock('./commands/prd', () => ({
  prdCommand: prdCommandMock,
}));

vi.mock('commander', () => {
  class MockSubCommand {
    public name: string;
    public description = vi.fn((value: string) => {
      const command = commandCalls.find((entry) => entry.name === this.name);
      if (command) command.description = value;
      return this;
    });
    public action = vi.fn((handler: unknown) => {
      const command = commandCalls.find((entry) => entry.name === this.name);
      if (command) command.action = handler;
      return this;
    });
    public option = vi.fn((flags: string, description: string, defaultValue?: string) => {
      const command = commandCalls.find((entry) => entry.name === this.name);
      command?.options.push({ flags, description, defaultValue });
      return this;
    });

    constructor(name: string) {
      this.name = name;
    }
  }

  class Command {
    name = vi.fn(() => this);
    description = vi.fn(() => this);
    version = vi.fn(() => this);
    command = vi.fn((name: string) => {
      commandCalls.push({ name, options: [] });
      return new MockSubCommand(name);
    });
    parse = parseMock;
  }

  return { Command };
});

describe('CLI entrypoint', () => {
  const originalNodeVersion = process.versions.node;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    resetCommanderMock();
    Object.defineProperty(process.versions, 'node', {
      configurable: true,
      value: originalNodeVersion,
    });
  });

  it('registers all commands and parses argv on supported Node versions', async () => {
    const { runCli } = await import('./program');
    runCli();

    expect(parseMock).toHaveBeenCalledTimes(1);
    expect(commandCalls).toEqual([
      {
        name: 'onboard',
        options: [],
        description: 'Initialize ShipCode in the current project',
        action: onboardCommandMock,
      },
      {
        name: 'status',
        options: [],
        description: 'Show active pipelines and recent threads',
        action: statusCommandMock,
      },
      {
        name: 'run <issue>',
        options: [],
        description: 'Process a single GitHub issue',
        action: runCommandMock,
      },
      {
        name: 'start',
        options: [],
        description: 'Interactive mode — prompt for issue number',
        action: startCommandMock,
      },
      {
        name: 'plan <issue>',
        options: [],
        description: 'Generate and review a plan (stops at approval)',
        action: planCommandMock,
      },
      {
        name: 'approve <issue>',
        options: [],
        description: 'Approve a plan and start execution',
        action: approveCommandMock,
      },
      {
        name: 'review <issue>',
        options: [],
        description: 'Run plan + adversarial review, output findings',
        action: reviewCommandMock,
      },
      {
        name: 'retry <issue>',
        options: [],
        description: 'Resume pipeline from last checkpoint',
        action: retryCommandMock,
      },
      {
        name: 'logs <issue>',
        options: [],
        description: 'Show terminal events for an issue',
        action: logsCommandMock,
      },
      {
        name: 'terminal <issue>',
        options: [
          {
            flags: '--provider <provider>',
            description: 'claude|codex',
            defaultValue: 'claude',
          },
          { flags: '--model <model>', description: 'CLI model id', defaultValue: undefined },
        ],
        description: 'Open an official Claude/Codex interactive CLI for a GitHub issue',
        action: terminalCommandMock,
      },
      {
        name: 'terminal-summary <issue>',
        options: [],
        description: 'Show the latest interactive terminal summary for an issue',
        action: terminalSummaryCommandMock,
      },
      {
        name: 'terminal-comment <issue>',
        options: [{ flags: '--post', description: 'post the generated comment' }],
        description: 'Preview or post a GitHub comment from the latest terminal summary',
        action: terminalCommentCommandMock,
      },
      {
        name: 'prd <keywords...>',
        options: [],
        description: 'Generate or enhance a PRD from keywords',
        action: expect.any(Function),
      },
    ]);

    const prdAction = commandCalls.find((entry) => entry.name === 'prd <keywords...>')?.action;
    expect(prdAction).toBeTypeOf('function');
    (prdAction as (keywords: string[]) => void)(['ship', 'faster']);
    expect(prdCommandMock).toHaveBeenCalledWith('ship faster');
  });

  it('fails fast on unsupported Node versions', async () => {
    Object.defineProperty(process.versions, 'node', {
      configurable: true,
      value: '22.4.0',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null) => {
        throw new Error(`exit:${code ?? 0}`);
      });

    await expect(import('./index')).rejects.toThrow('exit:1');
    expect(errorSpy).toHaveBeenCalledWith(
      `ShipCode requires Node.js >= 22.5.0 (you have ${process.version}). node:sqlite is not available in older versions.`,
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
