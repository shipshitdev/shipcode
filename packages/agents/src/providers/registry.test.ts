import { describe, expect, it, vi } from 'vitest';
import { createProviderRegistry } from './registry';
import type { AgentProvider, ProviderPhase } from './types';

function makeProvider(id: AgentProvider['id'], phases: ProviderPhase[]): AgentProvider {
  return {
    id,
    supports: new Set(phases),
    generate: vi.fn(async () => ({ rawOutput: '', exitCode: 0 })),
    healthCheck: vi.fn(async () => ({ ok: true })),
  };
}

describe('createProviderRegistry', () => {
  const claude = makeProvider('claude-cli', ['plan', 'review', 'revision', 'verify', 'execute']);
  const codex = makeProvider('codex-cli', ['plan', 'review', 'revision', 'verify', 'execute']);
  const gemini = makeProvider('gemini-cli', ['plan', 'review', 'revision', 'verify', 'execute']);
  // Cursor is execute-only: it has no read-only mode, so it must not drive the
  // pipeline's read-only phases.
  const cursor = makeProvider('cursor-cli', ['execute']);
  const openrouter = makeProvider('openrouter', [
    'plan',
    'review',
    'revision',
    'verify',
    'execute',
  ]);
  const registry = createProviderRegistry({ claude, codex, gemini, cursor, openrouter });

  it('dispatches claude agent to claude-cli provider', () => {
    expect(registry.for('claude', 'plan')).toBe(claude);
    expect(registry.for('claude', 'execute')).toBe(claude);
  });

  it('dispatches codex agent to codex-cli provider', () => {
    expect(registry.for('codex', 'plan')).toBe(codex);
    expect(registry.for('codex', 'review')).toBe(codex);
    expect(registry.for('codex', 'revision')).toBe(codex);
    expect(registry.for('codex', 'verify')).toBe(codex);
    expect(registry.for('codex', 'execute')).toBe(codex);
  });

  it('dispatches gemini agent to gemini-cli provider', () => {
    expect(registry.for('gemini', 'plan')).toBe(gemini);
    expect(registry.for('gemini', 'review')).toBe(gemini);
    expect(registry.for('gemini', 'revision')).toBe(gemini);
    expect(registry.for('gemini', 'verify')).toBe(gemini);
    expect(registry.for('gemini', 'execute')).toBe(gemini);
  });

  it('dispatches openrouter agent to openrouter provider', () => {
    expect(registry.for('openrouter', 'plan')).toBe(openrouter);
    expect(registry.for('openrouter', 'verify')).toBe(openrouter);
    expect(registry.for('openrouter', 'execute')).toBe(openrouter);
  });

  it('dispatches cursor agent to cursor-cli provider for execute only', () => {
    expect(registry.for('cursor', 'execute')).toBe(cursor);
    expect(() => registry.for('cursor', 'plan')).toThrow(/does not support phase 'plan'/);
    expect(() => registry.for('cursor', 'review')).toThrow(/does not support phase 'review'/);
    expect(() => registry.for('cursor', 'verify')).toThrow(/does not support phase 'verify'/);
  });

  it('throws when cursor is requested but no cursor provider is registered', () => {
    const withoutCursor = createProviderRegistry({ claude, codex, gemini, openrouter });

    expect(() => withoutCursor.for('cursor', 'execute')).toThrow(
      /provider for agent 'cursor' is not registered/,
    );
    expect(withoutCursor.all().has('cursor-cli')).toBe(false);
  });

  it('throws for gh agent (not an LLM)', () => {
    expect(() => registry.for('gh', 'plan')).toThrow(/'gh' is not an LLM agent/);
  });

  it('throws for shell agent (not a provider-backed LLM)', () => {
    expect(() => registry.for('shell', 'execute')).toThrow(/'shell' is a bare terminal/);
  });

  it('throws when gemini is requested but no gemini provider is registered', () => {
    const withoutGemini = createProviderRegistry({ claude, codex, openrouter });

    expect(() => withoutGemini.for('gemini', 'plan')).toThrow(
      /provider for agent 'gemini' is not registered/,
    );
    expect(withoutGemini.all().has('gemini-cli')).toBe(false);
  });

  it('throws when the selected provider does not support the requested phase', () => {
    const planOnlyOpenRouter = makeProvider('openrouter', ['plan']);
    const limited = createProviderRegistry({
      claude,
      codex,
      openrouter: planOnlyOpenRouter,
    });

    expect(() => limited.for('openrouter', 'execute')).toThrow(/does not support phase 'execute'/);
  });

  it('all() returns a map keyed by provider id', () => {
    const all = registry.all();
    expect(all.get('claude-cli')).toBe(claude);
    expect(all.get('codex-cli')).toBe(codex);
    expect(all.get('gemini-cli')).toBe(gemini);
    expect(all.get('cursor-cli')).toBe(cursor);
    expect(all.get('openrouter')).toBe(openrouter);
    expect(all.size).toBe(5);
  });
});
