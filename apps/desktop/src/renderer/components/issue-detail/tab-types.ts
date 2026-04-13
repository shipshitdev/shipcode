import type { ExecutorModel, PlanRecord } from '@shipcode/shared';

export type PhaseKey = 'planner' | 'reviewer' | 'executor' | 'verifier';

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
