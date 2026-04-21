import type { ExecutorModel, PlanRecord, ResolvedPhaseModel } from '@shipcode/shared';

export const ISSUE_DETAIL_TABS = [
  'prd',
  'comments',
  'history',
  'pipeline',
  'diff',
  'activity',
  'costs',
] as const;
export type PhaseKey = ResolvedPhaseModel;
export type IssueDetailTab = (typeof ISSUE_DETAIL_TABS)[number];

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
