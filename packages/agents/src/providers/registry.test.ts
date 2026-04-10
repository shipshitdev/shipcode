import { describe, it, expect, vi } from 'vitest'
import { createProviderRegistry } from './registry'
import type { AgentProvider, ProviderPhase } from './types'

function makeProvider(id: AgentProvider['id'], phases: ProviderPhase[]): AgentProvider {
  return {
    id,
    supports: new Set(phases),
    generate: vi.fn(async () => ({ rawOutput: '', exitCode: 0 })),
    healthCheck: vi.fn(async () => ({ ok: true })),
  }
}

describe('createProviderRegistry', () => {
  const claude = makeProvider('claude-cli', ['plan', 'review', 'revision', 'verify', 'execute'])
  const codex = makeProvider('codex-cli', ['review', 'execute'])
  const openrouter = makeProvider('openrouter', ['plan', 'review', 'revision', 'verify'])
  const registry = createProviderRegistry({ claude, codex, openrouter })

  it('dispatches claude agent to claude-cli provider', () => {
    expect(registry.for('claude', 'plan')).toBe(claude)
    expect(registry.for('claude', 'execute')).toBe(claude)
  })

  it('dispatches codex agent to codex-cli provider', () => {
    expect(registry.for('codex', 'review')).toBe(codex)
    expect(registry.for('codex', 'execute')).toBe(codex)
  })

  it('dispatches openrouter agent to openrouter provider', () => {
    expect(registry.for('openrouter', 'plan')).toBe(openrouter)
    expect(registry.for('openrouter', 'verify')).toBe(openrouter)
  })

  it('throws if a provider does not support the requested phase', () => {
    // codex-cli does not support plan
    expect(() => registry.for('codex', 'plan')).toThrow(/does not support phase 'plan'/)
    // openrouter does not support execute in Tier 1
    expect(() => registry.for('openrouter', 'execute')).toThrow(/does not support phase 'execute'/)
  })

  it('throws for gh agent (not an LLM)', () => {
    expect(() => registry.for('gh', 'plan')).toThrow(/'gh' is not an LLM agent/)
  })

  it('all() returns a map keyed by provider id', () => {
    const all = registry.all()
    expect(all.get('claude-cli')).toBe(claude)
    expect(all.get('codex-cli')).toBe(codex)
    expect(all.get('openrouter')).toBe(openrouter)
    expect(all.size).toBe(3)
  })
})
