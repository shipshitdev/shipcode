import type { PlanReview, ReviewFinding, ShipCodePlan } from './planning';
import type { VerificationIssue } from './verification';

// === Plan DB Record ===

export type PlanStatus =
  | 'draft'
  | 'pending_review'
  | 'approval'
  | 'approved'
  | 'rejected'
  | 'superseded';

export interface PlanRecord {
  id: string;
  threadId: string;
  version: number;
  rawOutput: string;
  structured: ShipCodePlan | null;
  status: PlanStatus;
  createdAt: string;
}

// === Review DB Record ===

export interface ReviewRecord {
  id: string;
  planId: string;
  decision: PlanReview['decision'];
  confidence: PlanReview['confidence'];
  rawOutput: string;
  structured: PlanReview | null;
  createdAt: string;
}

// === Review Finding Ledger ===

export type ReviewFindingSource = 'review' | 'verification' | 'ci' | 'pr_review';
export type ReviewFindingStatus = 'open' | 'fixed' | 'ignored' | 'superseded' | 'closed';
export type ReviewFindingSeverity = ReviewFinding['severity'] | VerificationIssue['severity'];

export interface ReviewFindingRecord {
  id: string;
  projectId: string;
  threadId: string;
  planId: string | null;
  reviewId: string | null;
  verificationId: string | null;
  runId: string | null;
  phase: string;
  source: ReviewFindingSource;
  severity: ReviewFindingSeverity;
  status: ReviewFindingStatus;
  title: string;
  description: string;
  suggestion: string | null;
  filePath: string | null;
  fingerprint: string;
  sourceModel: string | null;
  commitSha: string | null;
  prNumber: number | null;
  worktreePath: string | null;
  branch: string | null;
  metadata: Record<string, unknown> | null;
  resolvedByRunId: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewFindingCreateInput {
  projectId: string;
  threadId: string;
  planId?: string | null;
  reviewId?: string | null;
  verificationId?: string | null;
  runId?: string | null;
  phase: string;
  source: ReviewFindingSource;
  severity: ReviewFindingSeverity;
  title: string;
  description: string;
  suggestion?: string | null;
  filePath?: string | null;
  fingerprint: string;
  sourceModel?: string | null;
  commitSha?: string | null;
  prNumber?: number | null;
  worktreePath?: string | null;
  branch?: string | null;
  metadata?: Record<string, unknown> | null;
}
