// === Verification Types ===

export interface VerificationResult {
  threadId: string;
  planId: string;
  result: 'passed' | 'failed';
  summary: string;
  criteriaResults: CriteriaCheck[];
  issues: VerificationIssue[];
  /** Pipeline test evidence supplied to the verifier for this attempt. */
  testOutput?: string;
  /** Runtime-QA evidence supplied to the verifier for this attempt. */
  runtimeQaOutput?: string;
}

export interface CriteriaCheck {
  criterion: string;
  passed: boolean;
  evidence: string;
}

export interface VerificationIssue {
  severity: 'blocker' | 'warning';
  description: string;
  filePath?: string;
}

export interface VerificationRecord {
  id: string;
  threadId: string;
  planId: string;
  rawOutput: string;
  structured: VerificationResult | null;
  result: 'passed' | 'failed';
  retryCount: number;
  createdAt: string;
}

// === Project Failure Ledger ===

export type ProjectFailureStatus = 'in_progress' | 'resolved';

export interface ProjectFailureRecord {
  id: string;
  projectId: string;
  baseBranch: string | null;
  fingerprint: string;
  status: ProjectFailureStatus;
  ownerThreadId: string | null;
  firstSeenThreadId: string | null;
  seenThreadIds: string[];
  command: string;
  summary: string;
  outputExcerpt: string;
  implicatedFiles: string[];
  resolvedByThreadId: string | null;
  resolvedCommitSha: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// === Agent Conversation Log ===

export interface AgentConversationRecord {
  id: string;
  threadId: string;
  phase: string;
  round: number;
  speaker: string;
  role: 'prompt' | 'response';
  parentId: string | null;
  provider: string | null;
  model: string | null;
  content: string;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  createdAt: string;
}
