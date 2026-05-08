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
    expect(s.plannerModel).toBe('claude');
    expect(s.reviewerModel).toBe('codex');
    expect(s.prdRewriteCli).toBe('claude');
    expect(s.prdRewriteClaudeModel).toBe('claude-sonnet-4-6');
    expect(s.prdRewriteCodexModel).toBe('gpt-5.4-mini');
    expect(s.prdRewriteReasoningEffort).toBe(DEFAULT_SETTINGS.prdRewriteReasoningEffort);
    expect(s.githubPollingEnabled).toBe(false);
    expect(s.githubPollingIntervalMs).toBe(30000);
    expect(s.githubBotUsername).toBe('');
    expect(s.maxConcurrentCpuTasks).toBe(1);
    expect(s.cpuThrottleThresholdPercent).toBe(85);
    expect(s.autoRunPriorities).toEqual([]);
    expect(s.onboardingVersion).toBe(0);
    expect(s.worktreeRoot).toBeNull();
    expect(s.projectOpenTarget).toBe('cursor');
    expect(s.terminalOpenTarget).toBe('terminal');
    expect(s.updateTrack).toBe('master');
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
      awaitingApproval: true,
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
});
