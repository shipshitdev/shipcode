import { describe, expect, it } from 'vitest';
import {
  buildPullRequestFeedbackFindingInputs,
  buildReviewFindingInputs,
  buildVerificationFindingInputs,
  formatOpenFindingsForPrompt,
  formatReviewFindingsPrComment,
  REVIEW_FINDINGS_PR_COMMENT_MARKER,
} from './review-findings';

describe('review finding helpers', () => {
  it('normalizes reviewer findings into durable finding inputs', () => {
    const [finding] = buildReviewFindingInputs({
      projectId: 'project-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      reviewId: 'review-1',
      runId: 'run-1',
      sourceModel: 'codex',
      worktreePath: '/tmp/worktree',
      branch: 'shipcode/154',
      review: {
        planId: 'plan-1',
        decision: 'request_changes',
        confidence: 'high',
        summary: 'Needs changes',
        findings: [
          {
            id: 'f1',
            severity: 'major',
            category: 'correctness',
            filePath: 'src/app.ts',
            description: 'Missing error handling',
            suggestion: 'Handle failures',
          },
        ],
        suggestedChanges: [],
      },
    });

    expect(finding).toMatchObject({
      projectId: 'project-1',
      source: 'review',
      severity: 'major',
      filePath: 'src/app.ts',
      suggestion: 'Handle failures',
    });
    expect(finding.fingerprint).toHaveLength(32);
  });

  it('keeps finding fingerprints case-sensitive', () => {
    const [upper] = buildVerificationFindingInputs({
      projectId: 'project-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      verificationId: 'verification-1',
      runId: null,
      sourceModel: 'claude',
      worktreePath: '/tmp/worktree',
      branch: 'shipcode/154',
      commitSha: null,
      verification: {
        threadId: 'thread-1',
        planId: 'plan-1',
        result: 'failed',
        summary: 'Case-sensitive path',
        criteriaResults: [],
        issues: [{ severity: 'warning', filePath: 'src/Foo.ts', description: 'No coverage' }],
      },
    });
    const [lower] = buildVerificationFindingInputs({
      projectId: 'project-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      verificationId: 'verification-1',
      runId: null,
      sourceModel: 'claude',
      worktreePath: '/tmp/worktree',
      branch: 'shipcode/154',
      commitSha: null,
      verification: {
        threadId: 'thread-1',
        planId: 'plan-1',
        result: 'failed',
        summary: 'Case-sensitive path',
        criteriaResults: [],
        issues: [{ severity: 'warning', filePath: 'src/foo.ts', description: 'No coverage' }],
      },
    });

    expect(upper?.fingerprint).not.toBe(lower?.fingerprint);
  });

  it('turns verifier issues and failed criteria into execution findings', () => {
    const result = buildVerificationFindingInputs({
      projectId: 'project-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      verificationId: 'verification-1',
      runId: null,
      sourceModel: 'claude',
      worktreePath: '/tmp/worktree',
      branch: 'shipcode/154',
      commitSha: 'abc123',
      verification: {
        threadId: 'thread-1',
        planId: 'plan-1',
        result: 'failed',
        summary: 'No tests',
        criteriaResults: [{ criterion: 'Tests pass', passed: false, evidence: 'No output' }],
        issues: [{ severity: 'warning', filePath: 'src/app.ts', description: 'No coverage' }],
      },
    });

    expect(result.map((finding) => finding.title)).toEqual(['No coverage', 'Tests pass']);
    expect(result.map((finding) => finding.severity)).toEqual(['warning', 'blocker']);
  });

  it('formats open findings for executor prompts', () => {
    const prompt = formatOpenFindingsForPrompt([
      {
        id: 'finding-1',
        projectId: 'project-1',
        threadId: 'thread-1',
        planId: 'plan-1',
        reviewId: null,
        verificationId: null,
        runId: null,
        phase: 'verify',
        source: 'verification',
        severity: 'blocker',
        status: 'open',
        title: 'Build failed',
        description: 'Typecheck failed',
        suggestion: 'Fix types',
        filePath: 'src/app.ts',
        fingerprint: 'abc',
        sourceModel: 'claude',
        commitSha: null,
        prNumber: null,
        worktreePath: null,
        branch: null,
        metadata: null,
        resolvedByRunId: null,
        resolvedAt: null,
        createdAt: '2026-05-31T00:00:00.000Z',
        updatedAt: '2026-05-31T00:00:00.000Z',
      },
    ]);

    expect(prompt).toContain('<open_review_findings>');
    expect(prompt).toContain('[blocker/verification] src/app.ts: Typecheck failed');
  });

  it('bounds long finding text in executor prompts', () => {
    const prompt = formatOpenFindingsForPrompt([
      {
        id: 'finding-1',
        projectId: 'project-1',
        threadId: 'thread-1',
        planId: 'plan-1',
        reviewId: null,
        verificationId: null,
        runId: null,
        phase: 'pr_review',
        source: 'pr_review',
        severity: 'major',
        status: 'open',
        title: 'Long comment',
        description: 'd'.repeat(500),
        suggestion: 's'.repeat(500),
        filePath: 'src/app.ts',
        fingerprint: 'abc',
        sourceModel: null,
        commitSha: null,
        prNumber: 12,
        worktreePath: null,
        branch: null,
        metadata: null,
        resolvedByRunId: null,
        resolvedAt: null,
        createdAt: '2026-05-31T00:00:00.000Z',
        updatedAt: '2026-05-31T00:00:00.000Z',
      },
    ]);

    expect(prompt).toContain(`${'d'.repeat(279)}…`);
    expect(prompt).toContain(`${'s'.repeat(279)}…`);
    expect(prompt).not.toContain('d'.repeat(300));
  });

  it('normalizes CI and PR review feedback into durable finding inputs', () => {
    const result = buildPullRequestFeedbackFindingInputs({
      projectId: 'project-1',
      threadId: 'thread-1',
      planId: 'plan-1',
      runId: 'run-1',
      prNumber: 12,
      worktreePath: '/tmp/worktree',
      branch: 'shipcode/154',
      commitSha: 'abc123',
      failingChecks: [
        {
          name: 'test',
          workflowName: 'CI',
          status: 'failed',
          conclusion: 'failure',
          detailsUrl: 'https://github.com/check',
        },
      ],
      unresolvedReviewComments: [
        {
          author: 'reviewer',
          body: 'Please add a regression test',
          url: 'https://github.com/comment',
          createdAt: '2026-05-31T00:00:00Z',
          path: 'src/app.ts',
          line: 42,
        },
      ],
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      source: 'ci',
      phase: 'ci',
      severity: 'blocker',
      prNumber: 12,
      title: 'CI / test failed',
    });
    expect(result[1]).toMatchObject({
      source: 'pr_review',
      phase: 'pr_review',
      severity: 'major',
      filePath: 'src/app.ts',
    });
  });

  it('formats a marker-based PR findings comment', () => {
    const comment = formatReviewFindingsPrComment([
      {
        id: 'finding-1',
        projectId: 'project-1',
        threadId: 'thread-1',
        planId: 'plan-1',
        reviewId: null,
        verificationId: null,
        runId: null,
        phase: 'ci',
        source: 'ci',
        severity: 'blocker',
        status: 'open',
        title: 'CI failed',
        description: 'Tests failed',
        suggestion: null,
        filePath: null,
        fingerprint: 'abc',
        sourceModel: null,
        commitSha: null,
        prNumber: 12,
        worktreePath: null,
        branch: null,
        metadata: null,
        resolvedByRunId: null,
        resolvedAt: null,
        createdAt: '2026-05-31T00:00:00.000Z',
        updatedAt: '2026-05-31T00:00:00.000Z',
      },
    ]);

    expect(comment.startsWith(REVIEW_FINDINGS_PR_COMMENT_MARKER)).toBe(true);
    expect(comment).toContain('1 open ShipCode review finding remains');
    expect(comment).toContain('**blocker / ci**: CI failed');
  });
});
