import { describe, expect, it, vi } from 'vitest';
import {
  buildRuntimeQaConfig,
  commandsToText,
  normalizeEnvFiles,
  runtimeQaCommandsToText,
  textToCommands,
} from './setup-utils';

describe('project settings setup utils', () => {
  it('converts command arrays to editable text and back while dropping blank lines', () => {
    expect(commandsToText(['bun install', 'bun test'])).toBe('bun install\nbun test');
    expect(textToCommands(' bun install \\n\\n bun test  \n  ')).toEqual([
      'bun install \\n\\n bun test',
    ]);
    expect(textToCommands(' bun install \n\n bun test  \n  ')).toEqual(['bun install', 'bun test']);
  });

  it('reads runtime QA test commands from an optional config', () => {
    expect(runtimeQaCommandsToText()).toBe('');
    expect(runtimeQaCommandsToText({ testCommands: ['bun test'], discoverAgentTests: false })).toBe(
      'bun test',
    );
  });

  it('omits runtime QA config when defaults mean no explicit setup', () => {
    expect(
      buildRuntimeQaConfig({
        serverCommand: '   ',
        readinessUrl: '',
        startupTimeoutMs: 30_000,
        portEnvVar: '',
        testCommandsText: '\n',
        discoverAgentTests: true,
      }),
    ).toBeUndefined();
  });

  it('builds runtime QA server and command config with trimmed values and default port env', () => {
    expect(
      buildRuntimeQaConfig({
        serverCommand: ' bun dev ',
        readinessUrl: ' http://localhost:$PORT/health ',
        startupTimeoutMs: 45_000,
        portEnvVar: '   ',
        testCommandsText: ' bun test:e2e \n bun test:smoke ',
        discoverAgentTests: false,
      }),
    ).toEqual({
      server: {
        command: 'bun dev',
        readinessUrl: 'http://localhost:$PORT/health',
        startupTimeoutMs: 45_000,
        portEnvVar: 'PORT',
      },
      testCommands: ['bun test:e2e', 'bun test:smoke'],
      discoverAgentTests: false,
    });
  });

  it('builds command-only runtime QA config without a server block', () => {
    expect(
      buildRuntimeQaConfig({
        serverCommand: '',
        readinessUrl: '',
        startupTimeoutMs: 30_000,
        portEnvVar: 'APP_PORT',
        testCommandsText: 'bun test',
        discoverAgentTests: true,
      }),
    ).toEqual({
      testCommands: ['bun test'],
      discoverAgentTests: true,
    });
  });

  it('normalizes env files with generated local ids', () => {
    vi.spyOn(Date, 'now').mockReturnValue(123);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    expect(
      normalizeEnvFiles([
        { source: '.env.example', target: '.env', required: true },
        { source: '.env.local.example', target: '.env.local', required: false },
      ]),
    ).toEqual([
      {
        id: 'env-123-8',
        source: '.env.example',
        target: '.env',
        required: true,
      },
      {
        id: 'env-123-8',
        source: '.env.local.example',
        target: '.env.local',
        required: false,
      },
    ]);
  });
});
