import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_CONCURRENT_AGENTS,
  DEFAULT_MAX_TURNS,
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

  it('prefers .shipcode/WORKFLOW.md over root WORKFLOW.md', () => {
    const repo = tempRepo();
    writeFileSync(path.join(repo, 'WORKFLOW.md'), 'root');
    mkdirSync(path.join(repo, '.shipcode'), { recursive: true });
    const preferred = path.join(repo, '.shipcode', 'WORKFLOW.md');
    writeFileSync(preferred, 'preferred');

    expect(resolveWorkflowPath(repo)).toBe(preferred);
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
  });
});
