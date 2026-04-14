import type { DatabaseSync } from 'node:sqlite';
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
    expect(s.defaultWorktreeEnabled).toBe(true);
    expect(s.terminalScrollback).toBe(10000);
    expect(s.plannerModel).toBe('claude');
    expect(s.reviewerModel).toBe('codex');
    expect(s.githubPollingEnabled).toBe(false);
    expect(s.githubPollingIntervalMs).toBe(30000);
    expect(s.githubBotUsername).toBe('');
    expect(s.autoPickupEnabled).toBe(false);
    expect(s.onboardingVersion).toBe(0);
    expect(s.worktreeRoot).toBeNull();
    expect(s.projectOpenTarget).toBe('cursor');
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
      terminalScrollback: 5000,
      projectOpenTarget: 'finder',
    });
    const s = settings.get();
    expect(s.theme).toBe('dark');
    expect(s.fontStyle).toBe('system');
    expect(s.fontSize).toBe(15);
    expect(s.terminalScrollback).toBe(5000);
    expect(s.projectOpenTarget).toBe('finder');
  });

  it('set() serializes booleans as string true/false', () => {
    settings.set({ defaultWorktreeEnabled: false });
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'defaultWorktreeEnabled'")
      .get() as { value: string };
    expect(row.value).toBe('false');
  });

  it('set() serializes objects as JSON', () => {
    const mappings = { todo: 'label:todo', planning: 'label:planning' };
    settings.set({ statusLabelMappings: mappings });
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'statusLabelMappings'")
      .get() as { value: string };
    expect(JSON.parse(row.value)).toEqual(mappings);
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
      autoPickupEnabled: true,
      onboardingVersion: 3,
      projectOpenTarget: 'vscode',
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
    expect(s.autoPickupEnabled).toBe(true);
    expect(s.onboardingVersion).toBe(3);
    expect(typeof s.onboardingVersion).toBe('number');
    expect(s.projectOpenTarget).toBe('vscode');
  });

  it('rejects invalid project opener values', () => {
    expect(() => settings.set({ projectOpenTarget: 'zed' as unknown as 'cursor' })).toThrow(
      /projectOpenTarget/,
    );
  });

  it('rejects invalid font sizes', () => {
    expect(() => settings.set({ fontSize: 16 as 12 })).toThrow(/fontSize/);
  });
});
