import {
  type ActivePipelineSummary,
  type GitHubIssueCacheRecord,
  PIPELINE_PHASE,
  type PipelinePhase,
  type Thread,
} from '@shipcode/shared';

const EMPTY_STREAM: never[] = [];

export const MIN_HEIGHT = 120;
export const DEFAULT_HEIGHT = 250;
export const MINIMIZED_HEIGHT = 42;
export const FULL_HEIGHT = 9999;

export const CONSOLE_VISIBLE_STATUSES = new Set<PipelinePhase>([
  PIPELINE_PHASE.clarifying,
  PIPELINE_PHASE.approval,
  PIPELINE_PHASE.planning,
  PIPELINE_PHASE.reviewing,
  PIPELINE_PHASE.revising,
  PIPELINE_PHASE.executing,
  PIPELINE_PHASE.testing,
  PIPELINE_PHASE.verifying,
  PIPELINE_PHASE.shipping,
]);

// Map pipeline phase to a readable pending label while output is still empty.
export const PHASE_LABELS: Partial<Record<PipelinePhase, string>> = {
  [PIPELINE_PHASE.planning]: 'Thinking',
  [PIPELINE_PHASE.clarifying]: 'Waiting for clarification',
  [PIPELINE_PHASE.reviewing]: 'Reviewing',
  [PIPELINE_PHASE.revising]: 'Thinking',
  [PIPELINE_PHASE.approval]: 'Needs approval',
  [PIPELINE_PHASE.executing]: 'Working',
  [PIPELINE_PHASE.testing]: 'Running tests',
  [PIPELINE_PHASE.verifying]: 'Verifying',
  [PIPELINE_PHASE.shipping]: 'Shipping',
};

export type TerminalDrawerTarget =
  | {
      kind: 'issue';
      threadId: string;
      projectId: string;
      title: string;
      label: string;
      phase: PipelinePhase;
      issue: GitHubIssueCacheRecord;
    }
  | {
      kind: 'thread';
      threadId: string;
      projectId: string;
      title: string;
      label: string;
      phase: PipelinePhase;
      thread?: Thread;
      summary?: ActivePipelineSummary;
    };

export { EMPTY_STREAM };
