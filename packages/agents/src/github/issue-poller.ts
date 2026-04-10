import type { GitHubIssue } from '@shipcode/shared';
import type { GhCli } from './gh-cli';

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
