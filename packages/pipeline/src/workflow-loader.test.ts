import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _internals,
  DEFAULT_MAX_CONCURRENT_AGENTS,
  DEFAULT_MAX_TURNS,
  formatUnknownError,
  loadWorkflowPolicy,
  parseWorkflowPolicy,
  resolveWorkflowPath,
} from './workflow-loader';

const tempDirs: string[] = [];

function tempRepo(): string {
  const dir = path.join(os.tmpdir(), `shipcode-workflow-${Date.now()}-${Math.random()}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

describe('workflow-loader', () => {
  afterEach(() => {
    _internals.policyCache.clear();
    vi.useRealTimers();

    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns defaults when WORKFLOW.md is missing', () => {
    const repo = tempRepo();
    const policy = loadWorkflowPolicy(repo);

    expect(policy.path).toBeNull();
    expect(policy.promptTemplate).toBeNull();
    expect(policy.warning).toBeNull();
    expect(policy.agent.maxConcurrentAgents).toBe(DEFAULT_MAX_CONCURRENT_AGENTS);
  });

  it('evicts expired cache entries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const first = tempRepo();
    const second = tempRepo();
    loadWorkflowPolicy(first);
    loadWorkflowPolicy(second);

    expect(_internals.policyCache.size).toBe(2);

    vi.setSystemTime(new Date(Date.now() + _internals.policyCacheTtlMs + 1));
    loadWorkflowPolicy(tempRepo());

    expect(_internals.policyCache.has(first)).toBe(false);
    expect(_internals.policyCache.has(second)).toBe(false);
    expect(_internals.policyCache.size).toBe(1);
  });

  it('prefers .shipcode/WORKFLOW.md over root WORKFLOW.md', () => {
    const repo = tempRepo();
    writeFileSync(path.join(repo, 'WORKFLOW.md'), 'root');
    mkdirSync(path.join(repo, '.shipcode'), { recursive: true });
    const preferred = path.join(repo, '.shipcode', 'WORKFLOW.md');
    writeFileSync(preferred, 'preferred');

    expect(resolveWorkflowPath(repo)).toBe(preferred);
  });

  it('falls back to root WORKFLOW.md when the preferred path is missing', () => {
    const repo = tempRepo();
    const fallback = path.join(repo, 'WORKFLOW.md');
    writeFileSync(fallback, 'root');

    expect(resolveWorkflowPath(repo)).toBe(fallback);
  });

  it('loads a root WORKFLOW.md through the uncached loader path', () => {
    const repo = tempRepo();
    writeFileSync(path.join(repo, 'WORKFLOW.md'), 'Ship {{ issue.title }}');

    const policy = loadWorkflowPolicy(repo);

    expect(policy.path).toBe(path.join(repo, 'WORKFLOW.md'));
    expect(policy.promptTemplate).toBe('Ship {{ issue.title }}');
  });

  it('returns a structured warning when WORKFLOW.md cannot be read', () => {
    const repo = tempRepo();
    mkdirSync(path.join(repo, 'WORKFLOW.md'), { recursive: true });

    const policy = loadWorkflowPolicy(repo);

    expect(policy.warning?.code).toBe('workflow_file_unreadable');
    expect(policy.path).toBe(path.join(repo, 'WORKFLOW.md'));
  });

  it('parses YAML front matter and trimmed prompt body', () => {
    const policy = parseWorkflowPolicy(
      `---
agent:
  max_concurrent_agents: 2
  max_retry_backoff_ms: 45000
---

Plan {{ issue.title }} now.
`,
      '/repo/.shipcode/WORKFLOW.md',
    );

    expect(policy.warning).toBeNull();
    expect(policy.config).toMatchObject({
      agent: { max_concurrent_agents: 2, max_retry_backoff_ms: 45000 },
    });
    expect(policy.promptTemplate).toBe('Plan {{ issue.title }} now.');
    expect(policy.agent.maxConcurrentAgents).toBe(2);
    expect(policy.agent.maxRetryBackoffMs).toBe(45_000);
  });

  it('returns null promptTemplate when front matter has no body', () => {
    const policy = parseWorkflowPolicy(
      `---
agent:
  max_concurrent_agents: 2
---
`,
      '/repo/.shipcode/WORKFLOW.md',
    );

    expect(policy.promptTemplate).toBeNull();
  });

  it('reports invalid YAML parse failures as structured warnings', () => {
    const policy = parseWorkflowPolicy(
      `---
agent:
  max_concurrent_agents: [
---
body`,
      '/repo/WORKFLOW.md',
    );

    expect(policy.warning?.code).toBe('workflow_parse_error');
    expect(policy.promptTemplate).toBeNull();
  });

  it('formats non-Error thrown values', () => {
    expect(formatUnknownError('plain failure')).toBe('plain failure');
  });

  it('reports missing front matter closing delimiters as structured parse warnings', () => {
    const repo = tempRepo();
    writeFileSync(path.join(repo, 'WORKFLOW.md'), '---\nagent:\n  max_turns: 3\nbody');

    const parsed = loadWorkflowPolicy(repo);
    expect(parsed.warning?.code).toBe('workflow_parse_error');
    expect(parsed.warning?.message).toContain('closing --- delimiter');
  });

  it('reports non-map front matter as a structured warning', () => {
    const policy = parseWorkflowPolicy(
      `---
- nope
---
body`,
      '/repo/WORKFLOW.md',
    );

    expect(policy.warning?.code).toBe('workflow_front_matter_not_a_map');
    expect(policy.promptTemplate).toBeNull();
  });

  describe('max_concurrent_agents_by_state', () => {
    it('parses valid per-state caps with lowercase normalization', () => {
      const policy = parseWorkflowPolicy(
        `---
agent:
  max_concurrent_agents_by_state:
    Verify: 1
    plan: 5
    REVIEW: 2
---
body`,
        '/repo/WORKFLOW.md',
      );

      expect(policy.agent.maxConcurrentAgentsByState).toEqual({
        verify: 1,
        plan: 5,
        review: 2,
      });
    });

    it('silently ignores non-positive values', () => {
      const policy = parseWorkflowPolicy(
        `---
agent:
  max_concurrent_agents_by_state:
    verify: 0
    plan: -1
    review: 2
---
body`,
        '/repo/WORKFLOW.md',
      );

      expect(policy.agent.maxConcurrentAgentsByState).toEqual({ review: 2 });
    });

    it('silently ignores non-numeric values', () => {
      const policy = parseWorkflowPolicy(
        `---
agent:
  max_concurrent_agents_by_state:
    verify: "yes"
    plan: true
    review: 3
---
body`,
        '/repo/WORKFLOW.md',
      );

      expect(policy.agent.maxConcurrentAgentsByState).toEqual({ review: 3 });
    });

    it('returns empty map when key is absent', () => {
      const policy = parseWorkflowPolicy(
        `---
agent:
  max_concurrent_agents: 5
---
body`,
        '/repo/WORKFLOW.md',
      );

      expect(policy.agent.maxConcurrentAgentsByState).toEqual({});
    });

    it('returns empty map when value is not an object', () => {
      const policy = parseWorkflowPolicy(
        `---
agent:
  max_concurrent_agents_by_state: 42
---
body`,
        '/repo/WORKFLOW.md',
      );

      expect(policy.agent.maxConcurrentAgentsByState).toEqual({});
    });

    it('floors fractional values to integers', () => {
      const policy = parseWorkflowPolicy(
        `---
agent:
  max_concurrent_agents_by_state:
    verify: 2.9
---
body`,
        '/repo/WORKFLOW.md',
      );

      expect(policy.agent.maxConcurrentAgentsByState).toEqual({ verify: 2 });
    });
  });

  describe('max_turns', () => {
    it('parses max_turns from front matter', () => {
      const policy = parseWorkflowPolicy(
        `---
agent:
  max_turns: 5
---
body`,
        '/repo/WORKFLOW.md',
      );

      expect(policy.agent.maxTurns).toBe(5);
    });

    it('defaults to DEFAULT_MAX_TURNS when absent', () => {
      const policy = parseWorkflowPolicy(
        `---
agent:
  max_concurrent_agents: 3
---
body`,
        '/repo/WORKFLOW.md',
      );

      expect(policy.agent.maxTurns).toBe(DEFAULT_MAX_TURNS);
    });

    it('ignores non-positive values', () => {
      const policy = parseWorkflowPolicy(
        `---
agent:
  max_turns: 0
---
body`,
        '/repo/WORKFLOW.md',
      );

      expect(policy.agent.maxTurns).toBe(DEFAULT_MAX_TURNS);
    });
  });

  describe('continuation_prompt', () => {
    it('parses continuation_prompt from front matter', () => {
      const policy = parseWorkflowPolicy(
        `---
continuation_prompt: "Fix the gaps: {{ prior_failure_reason }}"
---
body`,
        '/repo/WORKFLOW.md',
      );

      expect(policy.continuationPromptTemplate).toBe('Fix the gaps: {{ prior_failure_reason }}');
    });

    it('defaults to null when absent', () => {
      const policy = parseWorkflowPolicy(
        `---
agent:
  max_concurrent_agents: 3
---
body`,
        '/repo/WORKFLOW.md',
      );

      expect(policy.continuationPromptTemplate).toBeNull();
    });

    it('defaults to null when continuation_prompt is blank or non-string', () => {
      expect(
        parseWorkflowPolicy(
          `---
continuation_prompt: "   "
---
body`,
          '/repo/WORKFLOW.md',
        ).continuationPromptTemplate,
      ).toBeNull();

      expect(
        parseWorkflowPolicy(
          `---
continuation_prompt: false
---
body`,
          '/repo/WORKFLOW.md',
        ).continuationPromptTemplate,
      ).toBeNull();
    });
  });
});
