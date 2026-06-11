import type { GitHubIssue, GitHubIssueCacheRecord, TriageRule } from '@shipcode/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTriageRulesOnce, IssuePoller } from './issue-poller';

const issue = {
  number: 12,
  title: 'Ship it',
  body: null,
  labels: [],
  assignee: null,
  state: 'open',
  url: 'https://github.com/shipshitdev/shipcode/issues/12',
} satisfies GitHubIssue;

function makeGhCli(issues: GitHubIssue[] = [issue]) {
  return {
    listAllAgentIssues: vi.fn(async () => issues),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('IssuePoller', () => {
  it('polls immediately, notifies only when issues exist, and swallows failures', async () => {
    const ghCli = makeGhCli();
    const onNewIssues = vi.fn();
    const poller = new IssuePoller(ghCli as never, onNewIssues, 1_000);

    await expect(poller.pollOnce()).resolves.toEqual([issue]);
    expect(onNewIssues).toHaveBeenCalledWith([issue]);

    ghCli.listAllAgentIssues.mockResolvedValueOnce([]);
    await expect(poller.pollOnce()).resolves.toEqual([]);
    expect(onNewIssues).toHaveBeenCalledTimes(1);

    ghCli.listAllAgentIssues.mockRejectedValueOnce(new Error('gh unavailable'));
    await expect(poller.pollOnce()).resolves.toEqual([]);
    expect(onNewIssues).toHaveBeenCalledTimes(1);
  });

  it('starts, stops, and restarts when the interval changes', async () => {
    vi.useFakeTimers();
    const ghCli = makeGhCli([]);
    const onNewIssues = vi.fn();
    const poller = new IssuePoller(ghCli as never, onNewIssues, 1_000);

    poller.start();
    poller.start();
    expect(ghCli.listAllAgentIssues).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(ghCli.listAllAgentIssues).toHaveBeenCalledTimes(2);

    poller.setInterval(500);
    expect(ghCli.listAllAgentIssues).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(500);
    expect(ghCli.listAllAgentIssues).toHaveBeenCalledTimes(4);

    poller.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ghCli.listAllAgentIssues).toHaveBeenCalledTimes(4);
  });

  it('ignores stop and interval changes while stopped', async () => {
    const ghCli = makeGhCli([]);
    const onNewIssues = vi.fn();
    const poller = new IssuePoller(ghCli as never, onNewIssues, 1_000);

    poller.stop();
    poller.setInterval(250);

    expect(ghCli.listAllAgentIssues).not.toHaveBeenCalled();
  });
});

function makeRule(overrides: Partial<TriageRule> = {}): TriageRule {
  return {
    id: overrides.id ?? 'rule-1',
    projectId: overrides.projectId ?? 'project-1',
    orderIndex: overrides.orderIndex ?? 0,
    name: overrides.name ?? 'bug rule',
    enabled: overrides.enabled ?? true,
    conditions: overrides.conditions ?? {
      operator: 'any',
      items: [{ kind: 'title_contains', value: 'bug' }],
    },
    actions: overrides.actions ?? { addLabels: ['agent:claude'], removeLabels: [] },
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
  };
}

function makeRecord(overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord {
  return {
    id: overrides.id ?? 'issue-1',
    issueNumber: overrides.issueNumber ?? 7,
    title: overrides.title ?? 'Bug: crash on launch',
    labels: overrides.labels ?? [],
    rulesAppliedAt: overrides.rulesAppliedAt,
    ...overrides,
  } as GitHubIssueCacheRecord;
}

function makeTriageGhCli() {
  return {
    applyIssueLabelActions: vi.fn(async () => ({
      added: ['agent:claude'],
      removed: [],
      skipped: [],
    })),
    getIssue: vi.fn(async () => issue),
  };
}

describe('applyTriageRulesOnce', () => {
  it('skips an issue whose rules already ran (idempotence guarantee)', async () => {
    const ghCli = makeTriageGhCli();
    const markApplied = vi.fn();
    const recordFailure = vi.fn();

    const result = await applyTriageRulesOnce({
      issue: makeRecord({ rulesAppliedAt: '2026-01-02T00:00:00.000Z' }),
      rules: [makeRule()],
      ghCli,
      markApplied,
      recordFailure,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'already-applied' });
    expect(ghCli.applyIssueLabelActions).not.toHaveBeenCalled();
    expect(markApplied).not.toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('consumes a no-match issue without touching GitHub', async () => {
    const ghCli = makeTriageGhCli();
    const markApplied = vi.fn();
    const recordFailure = vi.fn();

    const result = await applyTriageRulesOnce({
      issue: makeRecord({ id: 'issue-2', title: 'Feature request' }),
      rules: [makeRule()],
      ghCli,
      markApplied,
      recordFailure,
    });

    expect(result.status).toBe('no-match');
    expect(markApplied).toHaveBeenCalledWith('issue-2');
    expect(ghCli.applyIssueLabelActions).not.toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('applies the matching rule, refreshes the issue, and marks it consumed', async () => {
    const ghCli = makeTriageGhCli();
    const markApplied = vi.fn();
    const recordFailure = vi.fn();
    const rule = makeRule();

    const result = await applyTriageRulesOnce({
      issue: makeRecord({ id: 'issue-3', issueNumber: 9 }),
      rules: [rule],
      ghCli,
      markApplied,
      recordFailure,
    });

    expect(ghCli.applyIssueLabelActions).toHaveBeenCalledWith(9, rule.actions);
    expect(ghCli.getIssue).toHaveBeenCalledWith(9);
    expect(markApplied).toHaveBeenCalledWith('issue-3');
    expect(recordFailure).not.toHaveBeenCalled();
    expect(result.status).toBe('applied');
    if (result.status === 'applied') {
      expect(result.rule).toBe(rule);
      expect(result.refreshedIssue).toBe(issue);
    }
  });

  it('records a clamped failure without throwing when the label action fails', async () => {
    const ghCli = makeTriageGhCli();
    ghCli.applyIssueLabelActions.mockRejectedValueOnce(new Error('gh: label not found'));
    const markApplied = vi.fn();
    const recordFailure = vi.fn();
    const onWarn = vi.fn();

    const result = await applyTriageRulesOnce({
      issue: makeRecord({ id: 'issue-4' }),
      rules: [makeRule()],
      ghCli,
      markApplied,
      recordFailure,
      onWarn,
    });

    expect(result.status).toBe('failed');
    expect(markApplied).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledTimes(1);
    const [failedId, reason] = recordFailure.mock.calls[0];
    expect(failedId).toBe('issue-4');
    expect(reason).toContain('label not found');
    expect(onWarn).toHaveBeenCalledTimes(1);
  });
});
