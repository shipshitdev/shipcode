import type { ExecutorModel, PlanRecord, ResolvedPhaseModel } from '@shipcode/shared';

export type PhaseKey = ResolvedPhaseModel;
export type IssueDetailTab =
  | 'prd'
  | 'console'
  | 'comments'
  | 'history'
  | 'diff'
  | 'activity'
  | 'conversations';

export type PhaseSelection = {
  provider: ExecutorModel;
  modelId: string | null;
};

export type PlanRunGroup = {
  threadId: string;
  plans: PlanRecord[];
  runNumber: number;
  isCurrentRun: boolean;
};
