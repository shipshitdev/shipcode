import type { GitHubIssue, GitHubIssueCacheRecord, TriageRule } from '@shipcode/shared';
import { clampError, evaluateTriageRules } from '@shipcode/shared';
import type { GhCli, IssueLabelActionResult } from './gh-cli';

export interface ApplyTriageRulesOnceOptions {
  issue: GitHubIssueCacheRecord;
  rules: readonly TriageRule[];
  ghCli: Pick<GhCli, 'applyIssueLabelActions' | 'getIssue'>;
  markApplied: (issueId: string) => void;
  recordFailure: (issueId: string, reason: string) => void;
  onWarn?: (message: string, error: unknown) => void;
}

export type ApplyTriageRulesOnceResult =
  | { status: 'skipped'; reason: 'already-applied' }
  | { status: 'no-match' }
  | {
      status: 'applied';
      rule: TriageRule;
      actionResult: IssueLabelActionResult;
      refreshedIssue: GitHubIssue;
    }
  | { status: 'failed'; rule: TriageRule; reason: string };

export async function applyTriageRulesOnce({
  issue,
  rules,
  ghCli,
  markApplied,
  recordFailure,
  onWarn,
}: ApplyTriageRulesOnceOptions): Promise<ApplyTriageRulesOnceResult> {
  if (issue.rulesAppliedAt) {
    return { status: 'skipped', reason: 'already-applied' };
  }

  const rule = evaluateTriageRules(issue, rules);
  if (!rule) {
    markApplied(issue.id);
    return { status: 'no-match' };
  }

  try {
    const actionResult = await ghCli.applyIssueLabelActions(issue.issueNumber, rule.actions);
    const refreshedIssue = await ghCli.getIssue(issue.issueNumber);
    markApplied(issue.id);
    return { status: 'applied', rule, actionResult, refreshedIssue };
  } catch (error) {
    const reason = clampError(error);
    recordFailure(issue.id, reason);
    onWarn?.(`[triage-rules] failed to apply rule ${rule.id} to #${issue.issueNumber}`, error);
    return { status: 'failed', rule, reason };
  }
}

export class IssuePoller {
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private ghCli: GhCli,
    private onNewIssues: (issues: GitHubIssue[]) => void,
    private pollIntervalMs: number = 30_000,
  ) {}

  start(): void {
    if (this.intervalId) return;
    this.pollOnce();
    this.intervalId = setInterval(() => this.pollOnce(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async pollOnce(): Promise<GitHubIssue[]> {
    try {
      const issues = await this.ghCli.listAllAgentIssues();
      if (issues.length > 0) {
        this.onNewIssues(issues);
      }
      return issues;
    } catch {
      return [];
    }
  }

  setInterval(ms: number): void {
    this.pollIntervalMs = ms;
    if (this.intervalId) {
      this.stop();
      this.start();
    }
  }
}
