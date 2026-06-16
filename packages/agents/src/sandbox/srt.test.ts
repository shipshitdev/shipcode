import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSandboxedClaudeExecuteCommand,
  buildSrtPolicy,
  resetSrtResolutionCache,
  resolveSrt,
} from './srt';

function tmpWorktree(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'srt-test-wt-'));
}

describe('buildSrtPolicy', () => {
  it('writes a complete-schema policy scoped to the worktree', async () => {
    const wt = tmpWorktree();
    const { policyPath, cleanup } = await buildSrtPolicy({
      worktreePath: wt,
      networkPolicy: 'anthropic-github',
      extraWritePaths: ['/data/cache', '~/scratch', 'relative/should-drop'],
    });

    const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    // srt's schema is strict — every key must be present or it fail-closes.
    expect(Object.keys(policy.network).sort()).toEqual([
      'allowLocalBinding',
      'allowUnixSockets',
      'allowedDomains',
      'deniedDomains',
    ]);
    expect(Object.keys(policy.filesystem).sort()).toEqual([
      'allowRead',
      'allowWrite',
      'denyRead',
      'denyWrite',
    ]);

    expect(policy.network.allowedDomains).toContain('api.anthropic.com');
    expect(policy.network.allowedDomains).toContain('github.com');
    // No broad wildcard — exact hosts only.
    expect(policy.network.allowedDomains).not.toContain('*.anthropic.com');
    expect(policy.network.allowLocalBinding).toBe(false);

    expect(policy.filesystem.allowWrite).toContain(wt);
    expect(policy.filesystem.allowWrite).toContain(os.tmpdir());
    // Scoped claude state paths are writable, but NOT the whole ~/.claude dir.
    expect(policy.filesystem.allowWrite).toContain('~/.claude/todos');
    expect(policy.filesystem.allowWrite).toContain('~/.claude.json');
    expect(policy.filesystem.allowWrite).not.toContain('~/.claude');
    // Persistent host-config files are write-denied (sandbox-to-host escape).
    expect(policy.filesystem.denyWrite).toContain('~/.claude/CLAUDE.md');
    expect(policy.filesystem.denyWrite).toContain('~/.claude/commands');
    // Absolute + ~-prefixed extra paths kept; relative + traversal dropped.
    expect(policy.filesystem.allowWrite).toContain('/data/cache');
    expect(policy.filesystem.allowWrite).toContain('~/scratch');
    expect(policy.filesystem.allowWrite).not.toContain('relative/should-drop');
    // Secrets are read-denied.
    expect(policy.filesystem.denyRead).toEqual(
      expect.arrayContaining(['~/.ssh', '~/.aws', '~/.gitconfig', '~/.docker']),
    );

    await cleanup();
    expect(fs.existsSync(policyPath)).toBe(false);
    fs.rmSync(wt, { recursive: true, force: true });
  });

  it('anthropic-only policy omits GitHub and npm', async () => {
    const wt = tmpWorktree();
    const { policyPath, cleanup } = await buildSrtPolicy({
      worktreePath: wt,
      networkPolicy: 'anthropic-only',
      extraWritePaths: [],
    });
    const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    expect(policy.network.allowedDomains).toContain('api.anthropic.com');
    expect(policy.network.allowedDomains).not.toContain('github.com');
    expect(policy.network.allowedDomains).not.toContain('registry.npmjs.org');
    await cleanup();
    fs.rmSync(wt, { recursive: true, force: true });
  });
});

describe('resolveSrt', () => {
  afterEach(() => resetSrtResolutionCache());

  it('resolves the bundled srt entrypoint on supported platforms', () => {
    const result = resolveSrt();
    if (process.platform === 'win32') {
      expect(result.available).toBe(false);
      return;
    }
    expect(result.available).toBe(true);
    expect(result.command).toMatch(/sandbox-runtime[\\/].*cli\.js$/);
    expect(fs.existsSync(result.command as string)).toBe(true);
  });

  it('caches the resolution', () => {
    const a = resolveSrt();
    const b = resolveSrt();
    expect(a).toBe(b);
  });
});

describe('buildSandboxedClaudeExecuteCommand', () => {
  it('wraps inner claude args as `srt -s <policy> claude ...`', async () => {
    if (process.platform === 'win32') return; // srt unsupported
    const wt = tmpWorktree();
    const built = await buildSandboxedClaudeExecuteCommand({
      worktreePath: wt,
      innerClaudeArgs: ['-p', '--output-format', 'stream-json', '--dangerously-skip-permissions'],
      networkPolicy: 'anthropic-github',
      extraWritePaths: [],
    });
    expect(built).not.toBeNull();
    if (!built) return;
    expect(built.command).toMatch(/cli\.js$/);
    expect(built.args[0]).toBe('-s');
    expect(fs.existsSync(built.args[1])).toBe(true); // policy file written
    expect(built.args[2]).toBe('claude');
    expect(built.args.slice(3)).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--dangerously-skip-permissions',
    ]);
    await built.cleanup();
    expect(fs.existsSync(built.args[1])).toBe(false);
    fs.rmSync(wt, { recursive: true, force: true });
  });
});
