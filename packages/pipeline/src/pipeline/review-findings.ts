import { createHash } from 'node:crypto';
import type {
  GitHubPrCheckSummary,
  GitHubPrReviewCommentSummary,
  PlanReview,
  ReviewFindingCreateInput,
  ReviewFindingRecord,
  VerificationResult,
} from '@shipcode/shared';

export const REVIEW_FINDINGS_PR_COMMENT_MARKER = '<!-- shipcode:review-findings -->';

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function fingerprint(parts: Array<string | number | null | undefined>): string {
  return createHash('sha256')
    .update(
      parts
        .map((part) => compact(String(part ?? '')))
        .join('\n')
        .toLowerCase(),
    )
    .digest('hex')
    .slice(0, 32);
}

export function buildReviewFindingInputs(input: {
  projectId: string;
  threadId: string;
  planId: string;
  reviewId: string;
  runId: string | null;
  sourceModel: string | null;
  worktreePath: string | null;
  branch: string | null;
  review: PlanReview;
}): ReviewFindingCreateInput[] {
  return input.review.findings.map((finding) => {
    const title = compact(finding.description).slice(0, 120) || `${finding.severity} finding`;
    return {
      projectId: input.projectId,
      threadId: input.threadId,
      planId: input.planId,
      reviewId: input.reviewId,
      runId: input.runId,
      phase: 'review',
      source: 'review',
      severity: finding.severity,
      title,
      description: finding.description,
      suggestion: finding.suggestion ?? null,
      filePath: finding.filePath ?? null,
      fingerprint: fingerprint([
        'review',
        input.threadId,
        input.planId,
        finding.category,
        finding.stepOrder,
        finding.filePath,
        finding.severity,
        finding.description,
      ]),
      sourceModel: input.sourceModel,
      worktreePath: input.worktreePath,
      branch: input.branch,
      metadata: {
        category: finding.category,
        stepOrder: finding.stepOrder ?? null,
        findingId: finding.id,
      },
    };
  });
}

export function buildVerificationFindingInputs(input: {
  projectId: string;
  threadId: string;
  planId: string;
  verificationId: string;
  runId: string | null;
  sourceModel: string | null;
  worktreePath: string | null;
  branch: string | null;
  commitSha: string | null;
  verification: VerificationResult;
}): ReviewFindingCreateInput[] {
  const issueFindings = input.verification.issues.map((issue) => {
    const title = compact(issue.description).slice(0, 120) || `${issue.severity} finding`;
    return {
      projectId: input.projectId,
      threadId: input.threadId,
      planId: input.planId,
      verificationId: input.verificationId,
      runId: input.runId,
      phase: 'verify',
      source: 'verification' as const,
      severity: issue.severity,
      title,
      description: issue.description,
      suggestion: null,
      filePath: issue.filePath ?? null,
      fingerprint: fingerprint([
        'verification-issue',
        input.threadId,
        input.planId,
        issue.filePath,
        issue.severity,
        issue.description,
      ]),
      sourceModel: input.sourceModel,
      commitSha: input.commitSha,
      worktreePath: input.worktreePath,
      branch: input.branch,
    };
  });

  const failedCriteria = input.verification.criteriaResults
    .filter((criterion) => !criterion.passed)
    .map((criterion) => ({
      projectId: input.projectId,
      threadId: input.threadId,
      planId: input.planId,
      verificationId: input.verificationId,
      runId: input.runId,
      phase: 'verify',
      source: 'verification' as const,
      severity: 'blocker' as const,
      title: compact(criterion.criterion).slice(0, 120) || 'Acceptance criterion failed',
      description: criterion.criterion,
      suggestion: criterion.evidence,
      filePath: null,
      fingerprint: fingerprint([
        'verification-criterion',
        input.threadId,
        input.planId,
        criterion.criterion,
      ]),
      sourceModel: input.sourceModel,
      commitSha: input.commitSha,
      worktreePath: input.worktreePath,
      branch: input.branch,
      metadata: { evidence: criterion.evidence },
    }));

  return [...issueFindings, ...failedCriteria];
}

export function buildPullRequestFeedbackFindingInputs(input: {
  projectId: string;
  threadId: string;
  planId: string | null;
  runId: string | null;
  prNumber: number;
  worktreePath: string | null;
  branch: string | null;
  commitSha: string | null;
  failingChecks: GitHubPrCheckSummary[];
  unresolvedReviewComments: GitHubPrReviewCommentSummary[];
}): ReviewFindingCreateInput[] {
  const ciFindings = input.failingChecks.map((check) => {
    const checkName = [check.workflowName, check.name].filter(Boolean).join(' / ');
    const title = `${checkName || 'CI check'} failed`;
    const detail = [check.conclusion, check.detailsUrl].filter(Boolean).join(' - ');
    return {
      projectId: input.projectId,
      threadId: input.threadId,
      planId: input.planId,
      runId: input.runId,
      phase: 'ci',
      source: 'ci' as const,
      severity: 'blocker' as const,
      title,
      description: detail ? `${title}: ${detail}` : title,
      suggestion: check.detailsUrl ? `Inspect CI logs: ${check.detailsUrl}` : null,
      filePath: null,
      fingerprint: fingerprint([
        'ci',
        input.threadId,
        input.prNumber,
        check.workflowName,
        check.name,
      ]),
      commitSha: input.commitSha,
      prNumber: input.prNumber,
      worktreePath: input.worktreePath,
      branch: input.branch,
      metadata: {
        workflowName: check.workflowName,
        name: check.name,
        conclusion: check.conclusion,
        detailsUrl: check.detailsUrl,
      },
    };
  });

  const reviewFindings = input.unresolvedReviewComments.map((comment) => {
    const title = compact(comment.body).slice(0, 120) || 'Unresolved PR review comment';
    return {
      projectId: input.projectId,
      threadId: input.threadId,
      planId: input.planId,
      runId: input.runId,
      phase: 'pr_review',
      source: 'pr_review' as const,
      severity: 'major' as const,
      title,
      description: comment.body,
      suggestion: comment.url ? `Resolve PR review comment: ${comment.url}` : null,
      filePath: comment.path ?? null,
      fingerprint: fingerprint([
        'pr_review',
        input.threadId,
        input.prNumber,
        comment.url,
        comment.path,
        comment.line,
        comment.body,
      ]),
      commitSha: input.commitSha,
      prNumber: input.prNumber,
      worktreePath: input.worktreePath,
      branch: input.branch,
      metadata: {
        author: comment.author,
        url: comment.url,
        createdAt: comment.createdAt,
        line: comment.line,
      },
    };
  });

  return [...ciFindings, ...reviewFindings];
}

export function formatOpenFindingsForPrompt(findings: ReviewFindingRecord[]): string {
  const actionable = findings.filter((finding) => finding.status === 'open').slice(0, 20);
  if (actionable.length === 0) return '';

  const lines = actionable.map((finding) => {
    const file = finding.filePath ? `${finding.filePath}: ` : '';
    const suggestion = finding.suggestion ? ` Fix: ${compact(finding.suggestion)}` : '';
    return `- [${finding.severity}/${finding.source}] ${file}${compact(finding.description)}${suggestion}`;
  });

  return [
    '',
    '',
    '<open_review_findings>',
    'Resolve these open reviewer/verifier findings before finishing.',
    ...lines,
    '</open_review_findings>',
  ].join('\n');
}

export function formatReviewFindingsPrComment(findings: ReviewFindingRecord[]): string {
  const open = findings.filter((finding) => finding.status === 'open');
  const resolved = findings.filter((finding) => finding.status !== 'open');
  const lines = [
    REVIEW_FINDINGS_PR_COMMENT_MARKER,
    '## ShipCode Review Findings',
    '',
    open.length === 0
      ? 'No open ShipCode review findings.'
      : `${open.length} open ShipCode review finding${open.length === 1 ? '' : 's'} ${
          open.length === 1 ? 'remains' : 'remain'
        }.`,
  ];

  if (open.length > 0) {
    lines.push('', '### Open');
    for (const finding of open.slice(0, 20)) {
      const file = finding.filePath ? ` (${finding.filePath})` : '';
      lines.push(`- **${finding.severity} / ${finding.source}**${file}: ${compact(finding.title)}`);
    }
  }

  if (resolved.length > 0) {
    lines.push('', '### Recently Resolved');
    for (const finding of resolved.slice(0, 10)) {
      lines.push(`- **${finding.status}**: ${compact(finding.title)}`);
    }
  }

  lines.push(
    '',
    '<sub>Updated by ShipCode. Local pipeline execution does not depend on this comment.</sub>',
  );
  return lines.join('\n');
}
