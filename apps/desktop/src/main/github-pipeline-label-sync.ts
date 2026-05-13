import { GhCli } from '@shipcode/agents';
import {
  type IssuePipelineStatus,
  isPipelineStateLabel,
  isRealGithubIssueNumber,
  pipelineLabelForStatus,
} from '@shipcode/shared';
import log from './logger.service';

export async function syncIssuePipelineLabel(opts: {
  projectPath: string;
  issueNumber: number;
  status: IssuePipelineStatus;
}): Promise<void> {
  if (!isRealGithubIssueNumber(opts.issueNumber)) return;

  const ghCli = new GhCli(opts.projectPath);
  const targetLabel = pipelineLabelForStatus(opts.status);
  const issue = await ghCli.getIssue(opts.issueNumber);
  const currentPipelineLabels = issue.labels.filter(isPipelineStateLabel);

  for (const label of currentPipelineLabels) {
    if (label !== targetLabel) {
      await ghCli.setIssueLabelPresence(opts.issueNumber, label, false);
    }
  }
  if (targetLabel) {
    await ghCli.setIssueLabelPresence(opts.issueNumber, targetLabel, true);
  }
}

export function syncIssuePipelineLabelSoon(opts: {
  projectPath: string;
  issueNumber: number;
  status: IssuePipelineStatus;
  source: string;
}): void {
  void syncIssuePipelineLabel(opts).catch((err) => {
    log.warn(`[${opts.source}] pipeline label sync failed`, err);
  });
}
