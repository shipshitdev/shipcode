// === Terminal Types ===

export interface ClarificationChoice {
  id: string;
  label: string;
  description: string;
  recommended?: boolean;
}

export interface ClarificationQuestion {
  id: string;
  title: string;
  prompt: string;
  description: string | null;
  choices: ClarificationChoice[];
  allowFreeform: boolean;
  freeformPlaceholder: string | null;
}

export interface ClarificationRequest {
  id: string;
  threadId: string;
  phase: 'plan' | 'revision';
  summary: string;
  questions: ClarificationQuestion[];
}

export interface ClarificationAnswer {
  questionId: string;
  selectedChoiceId: string | null;
  freeformText: string | null;
}

export interface AnsweredClarification {
  request: ClarificationRequest;
  answers: ClarificationAnswer[];
}

export type CanonicalTerminalEvent =
  | { kind: 'text'; content: string }
  | { kind: 'user_input'; content: string }
  | { kind: 'thinking'; content: string }
  | {
      kind: 'tool_start';
      name: string;
      summary: string;
      command?: string;
      filePath?: string;
      pattern?: string;
    }
  | {
      kind: 'tool_end';
      name: string;
      durationMs?: number;
      exitCode?: number;
      outputSummary?: string;
    }
  | { kind: 'turn_start'; turn: number }
  | {
      kind: 'turn_end';
      turn: number;
      tokensUsed?: { prompt: number; completion: number };
      costUsd?: number;
    }
  | { kind: 'lifecycle'; message: string }
  | { kind: 'raw'; content: string }
  | { kind: 'error'; message: string }
  | { kind: 'action'; label: string; action: 'open-issue-detail' }
  | {
      kind: 'clarification_requested';
      summary: string;
      questionCount: number;
    }
  | {
      kind: 'clarification_answered';
      questionCount: number;
    }
  | {
      kind: 'done';
      totalTokens?: { prompt: number; completion: number };
      totalCostUsd?: number;
    };

export interface TerminalEventRecord {
  id: string;
  threadId: string;
  runId?: string | null;
  event: CanonicalTerminalEvent;
  createdAt: string;
}

export type PipelineCheckpointPhase = 'executing' | 'verifying' | 'shipping';

export interface PipelineCheckpoint {
  id: string;
  threadId: string;
  projectId: string | null;
  phase: PipelineCheckpointPhase;
  reason: string;
  label: string;
  branch: string | null;
  commitSha: string;
  /** Hidden ShipCode checkpoint ref (refs/shipcode/checkpoints/<threadId>/turn/<n>); null on legacy rows or when ref capture failed. */
  refName: string | null;
  createdAt: string;
}
