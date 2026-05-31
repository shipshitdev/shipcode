import { describe, expect, it } from 'vitest';
import {
  buildReviewFindingInputs,
  buildVerificationFindingInputs,
  formatOpenFindingsForPrompt,
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
});
