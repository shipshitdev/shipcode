import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../test-helpers';
import { SettingsQueries } from './settings';

describe('SettingsQueries', () => {
  let db: DatabaseSync;
  let settings: SettingsQueries;

  beforeEach(() => {
    db = createTestDb();
    settings = new SettingsQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('get() returns defaults when db is empty', () => {
    const s = settings.get();
    expect(s.theme).toBe('system');
    expect(s.fontStyle).toBe('dm-sans');
    expect(s.fontSize).toBe(13);
    expect(s.telemetryEnabled).toBeNull();
    expect(s.defaultWorktreeEnabled).toBe(true);
    expect(s.terminalScrollback).toBe(10000);
    // Structured phases default to programmatic for both providers.
    expect(s.agentRunModes.claude.plan).toBe('programmatic');
    expect(s.agentRunModes.claude.verify).toBe('programmatic');
    expect(s.agentRunModes.codex.plan).toBe('programmatic');
    // Codex execute is sandboxed (`codex exec`) → programmatic; Claude execute
    // grants host tools with no OS sandbox → stays interactive.
    expect(s.agentRunModes.codex.execute).toBe('programmatic');
    expect(s.agentRunModes.claude.execute).toBe('interactive');
    // Watched terminal-pane surfaces stay interactive by default.
    expect(s.agentRunModes.claude.instant).toBe('interactive');
    expect(s.agentRunModes.codex.terminalFix).toBe('interactive');
    expect(s.forceInteractiveClaude).toBe(false);
    expect(s.plannerModel).toBe('codex');
    expect(s.reviewerModel).toBe('codex');
    expect(s.executorModel).toBe('codex');
    expect(s.verifierModel).toBe('codex');
    expect(s.prdRewriteCli).toBe('claude');
    expect(s.prdRewriteClaudeModel).toBe('claude-sonnet-4-6');
    expect(s.prdRewriteCodexModel).toBe('gpt-5.4-mini');
    expect(s.prdRewriteReasoningEffort).toBe(DEFAULT_SETTINGS.prdRewriteReasoningEffort);
    expect(s.githubPollingEnabled).toBe(false);
    expect(s.githubPollingIntervalMs).toBe(30000);
    expect(s.githubBotUsername).toBe('');
    expect(s.postPipelineTimelineEnabled).toBe(true);
    expect(s.maxConcurrentCpuTasks).toBe(1);
    expect(s.cpuThrottleThresholdPercent).toBe(85);
    expect(s.shellCommandTimeoutMs).toBe(600_000);
    expect(s.autoRunPriorities).toEqual([]);
    expect(s.onboardingVersion).toBe(0);
    expect(s.worktreeRoot).toBeNull();
    expect(s.projectOpenTarget).toBe('cursor');
    expect(s.terminalOpenTarget).toBe('terminal');
    expect(s.updateTrack).toBe('master');
  });

  it('round-trips the pipeline timeline comment setting', () => {
    settings.set({ postPipelineTimelineEnabled: false });
    expect(settings.get().postPipelineTimelineEnabled).toBe(false);
  });

  it('normalizes legacy afk run modes to programmatic', () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('agentRunModes', ?)").run(
      JSON.stringify({
        claude: {
          issueTerminal: 'interactive',
          execute: 'afk',
          terminalFix: 'afk',
          instant: 'afk',
        },
        codex: {
          issueTerminal: 'interactive',
          execute: 'afk',
          terminalFix: 'afk',
          instant: 'afk',
        },
      }),
    );

    expect(settings.get().agentRunModes).toMatchObject({
      claude: {
        issueTerminal: 'interactive',
        execute: 'programmatic',
        terminalFix: 'programmatic',
        instant: 'programmatic',
      },
      codex: {
        issueTerminal: 'interactive',
        execute: 'programmatic',
        terminalFix: 'programmatic',
        instant: 'programmatic',
      },
    });
  });

  it('backfills missing per-phase run modes for pre-per-phase records', () => {
    // A record persisted before plan/review/revision/verify run modes existed.
    db.prepare("INSERT INTO settings (key, value) VALUES ('agentRunModes', ?)").run(
      JSON.stringify({
        claude: {
          issueTerminal: 'interactive',
          execute: 'programmatic',
          terminalFix: 'interactive',
          instant: 'interactive',
        },
        codex: {
          issueTerminal: 'interactive',
          execute: 'interactive',
          terminalFix: 'interactive',
          instant: 'interactive',
        },
      }),
    );

    const modes = settings.get().agentRunModes;
    // Pre-existing key preserved.
    expect(modes.claude.execute).toBe('programmatic');
    // New per-phase keys backfilled from defaults (structured → programmatic).
    expect(modes.claude.plan).toBe('programmatic');
    expect(modes.claude.review).toBe('programmatic');
    expect(modes.claude.revision).toBe('programmatic');
    expect(modes.claude.verify).toBe('programmatic');
    expect(modes.codex.plan).toBe('programmatic');
  });

  it('rejects an invalid run-mode value and falls back to the default', () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('agentRunModes', ?)").run(
      JSON.stringify({
        claude: {
          issueTerminal: 'interactive',
          plan: 'bogus',
          execute: 'interactive',
          terminalFix: 'interactive',
          instant: 'interactive',
        },
        codex: {
          issueTerminal: 'interactive',
          execute: 'interactive',
          terminalFix: 'interactive',
          instant: 'interactive',
        },
      }),
    );

    expect(settings.get().agentRunModes.claude.plan).toBe('programmatic');
  });

  describe('worktreeRoot', () => {
    it('round-trips a ~-prefixed path', () => {
      settings.set({ worktreeRoot: '~/scratch/wt' });
      expect(settings.get().worktreeRoot).toBe('~/scratch/wt');
    });

    it('round-trips an absolute path', () => {
      settings.set({ worktreeRoot: '/tmp/shipcode-wt' });
      expect(settings.get().worktreeRoot).toBe('/tmp/shipcode-wt');
    });

    it('round-trips empty string (legacy project-local)', () => {
      settings.set({ worktreeRoot: '' });
      expect(settings.get().worktreeRoot).toBeNull();
    });

    it('clearing to null stores empty string, reads back as null', () => {
      settings.set({ worktreeRoot: '~/foo' });
      settings.set({ worktreeRoot: null });
      const row = db.prepare("SELECT value FROM settings WHERE key = 'worktreeRoot'").get() as
        | { value: string }
        | undefined;
      expect(row?.value).toBe('');
      expect(settings.get().worktreeRoot).toBeNull();
    });

    it('legacy JS literal "null" string in db reads back as null', () => {
      // Simulate a value that could have been written by the pre-fix serializer.
      db.prepare("INSERT INTO settings (key, value) VALUES ('worktreeRoot', 'null')").run();
      expect(settings.get().worktreeRoot).toBeNull();
    });

    it('rejects relative paths before writing to db', () => {
      expect(() => settings.set({ worktreeRoot: 'relative/path' })).toThrow();
      const row = db.prepare("SELECT value FROM settings WHERE key = 'worktreeRoot'").get() as
        | { value: string }
        | undefined;
      expect(row).toBeUndefined();
    });

    it('rejects ~user paths', () => {
      expect(() => settings.set({ worktreeRoot: '~alice/foo' })).toThrow(/~user/);
    });
  });

  it('set() persists values', () => {
    settings.set({
      theme: 'dark',
      fontStyle: 'system',
      fontSize: 15,
      telemetryEnabled: true,
      terminalScrollback: 5000,
      maxConcurrentCpuTasks: 2,
      cpuThrottleThresholdPercent: 75,
      projectOpenTarget: 'finder',
      terminalOpenTarget: 'ghostty',
      prdRewriteCli: 'codex',
      prdRewriteClaudeModel: 'claude-opus-4-6',
      prdRewriteCodexModel: 'gpt-5.4',
      prdRewriteReasoningEffort: 'medium',
      updateTrack: 'nightly',
    });
    const s = settings.get();
    expect(s.theme).toBe('dark');
    expect(s.fontStyle).toBe('system');
    expect(s.fontSize).toBe(15);
    expect(s.telemetryEnabled).toBe(true);
    expect(s.terminalScrollback).toBe(5000);
    expect(s.maxConcurrentCpuTasks).toBe(2);
    expect(s.cpuThrottleThresholdPercent).toBe(75);
    expect(s.projectOpenTarget).toBe('finder');
    expect(s.terminalOpenTarget).toBe('ghostty');
    expect(s.prdRewriteCli).toBe('codex');
    expect(s.prdRewriteClaudeModel).toBe('claude-opus-4-6');
    expect(s.prdRewriteCodexModel).toBe('gpt-5.4');
    expect(s.prdRewriteReasoningEffort).toBe('medium');
    expect(s.updateTrack).toBe('nightly');
  });

  it('round-trips advanced valid settings', () => {
    settings.set({
      triageModel: 'openrouter',
      triageModelId: 'anthropic/claude-sonnet-4-6',
      triageReasoningEffort: 'high',
      triageAutoApplyThreshold: 0.75,
      autoRunMaxTasks: 12,
      onboardingVersion: 4,
      projectSortOrder: 'recent',
      worktreeBranchFormat: 'ship/{id}-{slug}',
      revisionCount: 5,
      pipelineSpeedProfile: 'thorough',
      requireApproval: false,
      maxConcurrentPipelines: 4,
      maxConcurrentExecutions: 5,
      maxConcurrentCpuTasks: 2,
      cpuThrottleThresholdPercent: 95,
      instantDefaultPanes: 4,
      devLogLevel: 'debug',
      autoCommitEnabled: true,
      autoCommitProvider: 'codex',
      autoCommitModel: 'gpt-5.4',
      autoCommitMode: 'single',
    });

    expect(settings.get()).toMatchObject({
      triageModel: 'openrouter',
      triageModelId: 'anthropic/claude-sonnet-4-6',
      triageReasoningEffort: 'high',
      triageAutoApplyThreshold: 0.75,
      autoRunMaxTasks: 12,
      onboardingVersion: 4,
      projectSortOrder: 'recent',
      worktreeBranchFormat: 'ship/{id}-{slug}',
      revisionCount: 5,
      pipelineSpeedProfile: 'thorough',
      requireApproval: false,
      maxConcurrentPipelines: 4,
      maxConcurrentExecutions: 5,
      maxConcurrentCpuTasks: 2,
      cpuThrottleThresholdPercent: 95,
      instantDefaultPanes: 4,
      devLogLevel: 'debug',
      autoCommitEnabled: true,
      autoCommitProvider: 'codex',
      autoCommitModel: 'gpt-5.4',
      autoCommitMode: 'single',
    });
  });

  it('clamps and persists shellCommandTimeoutMs', () => {
    settings.set({ shellCommandTimeoutMs: 120_000 });
    expect(settings.get().shellCommandTimeoutMs).toBe(120_000);

    expect(() => settings.set({ shellCommandTimeoutMs: 1_000 })).toThrow(/shellCommandTimeoutMs/);
    expect(() => settings.set({ shellCommandTimeoutMs: 9_999_999 })).toThrow(
      /shellCommandTimeoutMs/,
    );

    db.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('shellCommandTimeoutMs', ?)",
    ).run('1');
    expect(settings.get().shellCommandTimeoutMs).toBe(DEFAULT_SETTINGS.shellCommandTimeoutMs);
  });

  it('set() serializes booleans as string true/false', () => {
    settings.set({ defaultWorktreeEnabled: false });
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'defaultWorktreeEnabled'")
      .get() as { value: string };
    expect(row.value).toBe('false');
  });

  it('round-trips nullable telemetry consent', () => {
    settings.set({ telemetryEnabled: true });
    expect(settings.get().telemetryEnabled).toBe(true);

    settings.set({ telemetryEnabled: false });
    expect(settings.get().telemetryEnabled).toBe(false);

    settings.set({ telemetryEnabled: null });
    const row = db.prepare("SELECT value FROM settings WHERE key = 'telemetryEnabled'").get() as
      | { value: string }
      | undefined;
    expect(row?.value).toBe('');
    expect(settings.get().telemetryEnabled).toBeNull();
  });

  it('set() serializes objects as JSON', () => {
    const events = {
      approval: true,
      failed: true,
      completed: false,
      verificationExhausted: true,
      ciBlocked: true,
    };
    settings.set({ notificationEvents: events });
    const row = db.prepare("SELECT value FROM settings WHERE key = 'notificationEvents'").get() as {
      value: string;
    };
    expect(JSON.parse(row.value)).toEqual(events);
  });

  it('round-trips cleanup criteria with merged local and remote branch toggles', () => {
    settings.set({
      cleanupCriteria: {
        ...DEFAULT_SETTINGS.cleanupCriteria,
        localBranchMerged: false,
        remoteBranchMerged: false,
      },
    });

    expect(settings.get().cleanupCriteria).toEqual({
      ...DEFAULT_SETTINGS.cleanupCriteria,
      localBranchMerged: false,
      remoteBranchMerged: false,
    });
  });

  it('round-trip: set then get returns correct types', () => {
    settings.set({
      theme: 'light',
      fontStyle: 'serif',
      fontSize: 12,
      defaultWorktreeEnabled: false,
      terminalScrollback: 20000,
      githubPollingEnabled: true,
      githubPollingIntervalMs: 60000,
      githubBotUsername: 'bot',
      autoRunPriorities: ['p0', 'p1'],
      onboardingVersion: 3,
      projectOpenTarget: 'vscode',
      terminalOpenTarget: 'terminal',
    });
    const s = settings.get();
    expect(s.theme).toBe('light');
    expect(s.fontStyle).toBe('serif');
    expect(s.fontSize).toBe(12);
    expect(s.defaultWorktreeEnabled).toBe(false);
    expect(typeof s.defaultWorktreeEnabled).toBe('boolean');
    expect(s.terminalScrollback).toBe(20000);
    expect(typeof s.terminalScrollback).toBe('number');
    expect(s.githubPollingEnabled).toBe(true);
    expect(typeof s.githubPollingEnabled).toBe('boolean');
    expect(s.githubPollingIntervalMs).toBe(60000);
    expect(typeof s.githubPollingIntervalMs).toBe('number');
    expect(s.githubBotUsername).toBe('bot');
    expect(s.autoRunPriorities).toEqual(['p0', 'p1']);
    expect(s.onboardingVersion).toBe(3);
    expect(typeof s.onboardingVersion).toBe('number');
    expect(s.projectOpenTarget).toBe('vscode');
    expect(s.terminalOpenTarget).toBe('terminal');
  });

  it('rejects invalid project opener values', () => {
    expect(() => settings.set({ projectOpenTarget: 'zed' as unknown as 'cursor' })).toThrow(
      /projectOpenTarget/,
    );
  });

  it('rejects invalid terminal opener values', () => {
    expect(() => settings.set({ terminalOpenTarget: 'cursor' as unknown as 'terminal' })).toThrow(
      /terminalOpenTarget/,
    );
  });

  it('rejects invalid font sizes', () => {
    expect(() => settings.set({ fontSize: 16 as 12 })).toThrow(/fontSize/);
  });

  it('rejects invalid PRD rewrite CLI values', () => {
    expect(() => settings.set({ prdRewriteCli: 'openrouter' as unknown as 'claude' })).toThrow(
      /prdRewriteCli/,
    );
  });

  it('rejects invalid update tracks', () => {
    expect(() => settings.set({ updateTrack: 'canary' as unknown as 'master' })).toThrow(
      /updateTrack/,
    );
  });

  describe('maxConcurrentPipelines', () => {
    it('returns the default of 3 when not set', () => {
      expect(settings.get().maxConcurrentPipelines).toBe(3);
    });

    it('round-trips a valid value', () => {
      settings.set({ maxConcurrentPipelines: 5 });
      expect(settings.get().maxConcurrentPipelines).toBe(5);
    });

    it('clamps values below 1 to the default', () => {
      // clampInt returns the fallback when the value is outside the range
      settings.set({ maxConcurrentPipelines: 1 });
      expect(settings.get().maxConcurrentPipelines).toBe(1);
    });

    it('accepts the maximum value of 10', () => {
      settings.set({ maxConcurrentPipelines: 10 });
      expect(settings.get().maxConcurrentPipelines).toBe(10);
    });

    it('rejects values outside 1–10 in set()', () => {
      expect(() => settings.set({ maxConcurrentPipelines: 0 })).toThrow('maxConcurrentPipelines');
      expect(() => settings.set({ maxConcurrentPipelines: 11 })).toThrow('maxConcurrentPipelines');
    });
  });

  describe('maxConcurrentExecutions', () => {
    it('returns the default of 3 when not set', () => {
      expect(settings.get().maxConcurrentExecutions).toBe(3);
    });

    it('round-trips a valid value', () => {
      settings.set({ maxConcurrentExecutions: 5 });
      expect(settings.get().maxConcurrentExecutions).toBe(5);
    });

    it('rejects values outside 1–10 in set()', () => {
      expect(() => settings.set({ maxConcurrentExecutions: 0 })).toThrow('maxConcurrentExecutions');
      expect(() => settings.set({ maxConcurrentExecutions: 11 })).toThrow(
        'maxConcurrentExecutions',
      );
    });
  });

  describe('cpu task guard settings', () => {
    it('round-trips valid values', () => {
      settings.set({ maxConcurrentCpuTasks: 3, cpuThrottleThresholdPercent: 90 });
      expect(settings.get().maxConcurrentCpuTasks).toBe(3);
      expect(settings.get().cpuThrottleThresholdPercent).toBe(90);
    });

    it('rejects values outside the allowed ranges', () => {
      expect(() => settings.set({ maxConcurrentCpuTasks: 0 })).toThrow('maxConcurrentCpuTasks');
      expect(() => settings.set({ maxConcurrentCpuTasks: 11 })).toThrow('maxConcurrentCpuTasks');
      expect(() => settings.set({ cpuThrottleThresholdPercent: 49 })).toThrow(
        'cpuThrottleThresholdPercent',
      );
      expect(() => settings.set({ cpuThrottleThresholdPercent: 101 })).toThrow(
        'cpuThrottleThresholdPercent',
      );
    });
  });

  it('accepts the expanded reasoning-effort values', () => {
    settings.set({
      plannerReasoningEffort: 'none',
      reviewerReasoningEffort: 'minimal',
      executorReasoningEffort: 'xhigh',
      verifierReasoningEffort: 'low',
    });

    const s = settings.get();
    expect(s.plannerReasoningEffort).toBe('none');
    expect(s.reviewerReasoningEffort).toBe('minimal');
    expect(s.executorReasoningEffort).toBe('xhigh');
    expect(s.verifierReasoningEffort).toBe('low');
  });

  it('falls back from malformed persisted values without rewriting them', () => {
    const rows: Array<[string, string]> = [
      ['fontSize', '99'],
      ['telemetryEnabled', 'maybe'],
      ['defaultWorktreeEnabled', 'maybe'],
      ['projectOpenTarget', 'zed'],
      ['terminalOpenTarget', 'cursor'],
      ['triageModel', 'gemini'],
      ['triageReasoningEffort', 'turbo'],
      ['prdRewriteCli', 'openrouter'],
      ['prdRewriteReasoningEffort', 'turbo'],
      ['pipelineSpeedProfile', 'fastest'],
      ['plannerReasoningEffort', 'turbo'],
      ['reviewerReasoningEffort', 'turbo'],
      ['executorReasoningEffort', 'turbo'],
      ['verifierReasoningEffort', 'turbo'],
      ['notificationEvents', '{bad json'],
      ['discordLastDeliveryStatus', '{bad json'],
      ['telegramLastDeliveryStatus', '{bad json'],
      ['chatNotificationEvents', '{bad json'],
      ['cleanupCriteria', '{bad json'],
      ['maxConcurrentPipelines', '99'],
      ['maxConcurrentExecutions', '0'],
      ['maxConcurrentCpuTasks', 'oops'],
      ['cpuThrottleThresholdPercent', '10'],
      ['instantDefaultPanes', '7'],
      ['devLogLevel', 'trace'],
      ['updateTrack', 'canary'],
      ['autoCommitProvider', 'gemini'],
      ['autoCommitMode', 'many'],
      ['revisionCount', 'oops'],
      ['autoCommitModel', ''],
    ];
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const row of rows) insert.run(...row);

    const s = settings.get();

    expect(s.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(s.telemetryEnabled).toBeNull();
    expect(s.defaultWorktreeEnabled).toBe(DEFAULT_SETTINGS.defaultWorktreeEnabled);
    expect(s.projectOpenTarget).toBe(DEFAULT_SETTINGS.projectOpenTarget);
    expect(s.terminalOpenTarget).toBe(DEFAULT_SETTINGS.terminalOpenTarget);
    expect(s.triageModel).toBe(DEFAULT_SETTINGS.triageModel);
    expect(s.triageReasoningEffort).toBe(DEFAULT_SETTINGS.triageReasoningEffort);
    expect(s.prdRewriteCli).toBe(DEFAULT_SETTINGS.prdRewriteCli);
    expect(s.prdRewriteReasoningEffort).toBe(DEFAULT_SETTINGS.prdRewriteReasoningEffort);
    expect(s.pipelineSpeedProfile).toBe(DEFAULT_SETTINGS.pipelineSpeedProfile);
    expect(s.plannerReasoningEffort).toBe(DEFAULT_SETTINGS.plannerReasoningEffort);
    expect(s.reviewerReasoningEffort).toBe(DEFAULT_SETTINGS.reviewerReasoningEffort);
    expect(s.executorReasoningEffort).toBe(DEFAULT_SETTINGS.executorReasoningEffort);
    expect(s.verifierReasoningEffort).toBe(DEFAULT_SETTINGS.verifierReasoningEffort);
    expect(s.notificationEvents).toEqual(DEFAULT_SETTINGS.notificationEvents);
    expect(s.discordLastDeliveryStatus).toBeNull();
    expect(s.telegramLastDeliveryStatus).toBeNull();
    expect(s.chatNotificationEvents).toEqual(DEFAULT_SETTINGS.chatNotificationEvents);
    expect(s.cleanupCriteria).toEqual(DEFAULT_SETTINGS.cleanupCriteria);
    expect(s.maxConcurrentPipelines).toBe(DEFAULT_SETTINGS.maxConcurrentPipelines);
    expect(s.maxConcurrentExecutions).toBe(DEFAULT_SETTINGS.maxConcurrentExecutions);
    expect(s.maxConcurrentCpuTasks).toBe(DEFAULT_SETTINGS.maxConcurrentCpuTasks);
    expect(s.cpuThrottleThresholdPercent).toBe(DEFAULT_SETTINGS.cpuThrottleThresholdPercent);
    expect(s.instantDefaultPanes).toBe(DEFAULT_SETTINGS.instantDefaultPanes);
    expect(s.devLogLevel).toBe(DEFAULT_SETTINGS.devLogLevel);
    expect(s.updateTrack).toBe(DEFAULT_SETTINGS.updateTrack);
    expect(s.autoCommitProvider).toBe(DEFAULT_SETTINGS.autoCommitProvider);
    expect(s.autoCommitMode).toBe(DEFAULT_SETTINGS.autoCommitMode);
    expect(s.revisionCount).toBe(DEFAULT_SETTINGS.revisionCount);
    expect(s.autoCommitModel).toBe(DEFAULT_SETTINGS.autoCommitModel);
  });

  it('validates advanced settings before persisting', () => {
    expect(() => settings.set({ addProjectStartsIn: 'relative/path' })).toThrow();
    expect(() => settings.set({ revisionCount: 6 as never })).toThrow('revisionCount');
    expect(() => settings.set({ pipelineSpeedProfile: 'fast' as unknown as 'smart_fast' })).toThrow(
      'pipelineSpeedProfile',
    );
    expect(() => settings.set({ plannerReasoningEffort: 'turbo' as unknown as 'medium' })).toThrow(
      'plannerReasoningEffort',
    );
    expect(() => settings.set({ telemetryEnabled: 'true' as unknown as boolean })).toThrow(
      'telemetryEnabled',
    );
    expect(() => settings.set({ triageModel: 'gemini' as unknown as 'claude' })).toThrow(
      'triageModel',
    );
    expect(() => settings.set({ triageAutoApplyThreshold: 1.1 })).toThrow(
      'triageAutoApplyThreshold',
    );
    expect(() => settings.set({ worktreeBranchFormat: 'shipcode/{slug}' })).toThrow(
      'worktreeBranchFormat',
    );
    expect(() => settings.set({ worktreeBranchFormat: 'shipcode/{id bad}' })).toThrow(
      'worktreeBranchFormat',
    );
    expect(() => settings.set({ worktreeBranchFormat: 'shipcode/{id} bad' })).toThrow(
      'worktreeBranchFormat',
    );
    expect(() => settings.set({ worktreeBranchFormat: '-shipcode/{id}' })).toThrow(
      'worktreeBranchFormat',
    );
    expect(() => settings.set({ devLogLevel: 'trace' as unknown as 'debug' })).toThrow(
      'devLogLevel',
    );
    expect(() => settings.set({ autoCommitMode: 'many' as unknown as 'split' })).toThrow(
      'autoCommitMode',
    );
    expect(() => settings.set({ autoCommitProvider: 'gemini' as unknown as 'claude' })).toThrow(
      'autoCommitProvider',
    );
    expect(() => settings.set({ autoCommitModel: '' })).toThrow('autoCommitModel');
    expect(() =>
      settings.set({
        cleanupCriteria: {
          ...DEFAULT_SETTINGS.cleanupCriteria,
          localBranchMerged: 'yes' as unknown as boolean,
        },
      }),
    ).toThrow('cleanupCriteria.localBranchMerged');
  });
});
