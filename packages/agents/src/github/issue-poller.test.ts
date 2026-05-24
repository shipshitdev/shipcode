import type { GitHubIssue } from '@shipcode/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IssuePoller } from './issue-poller';

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
