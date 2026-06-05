// === Plan Types ===

export interface ShipCodePlan {
  id: string;
  threadId: string;
  version: number;
  objective: string;
  files: PlanFileChange[];
  steps: PlanStep[];
  acceptanceCriteria: string[];
  outOfScope: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
  dependencies: string[];
}

export interface PlanStep {
  order: number;
  description: string;
  files: string[];
  rationale: string;
}

export interface PlanFileChange {
  path: string;
  action: 'create' | 'modify' | 'delete' | 'rename';
  description: string;
  fromPath?: string;
}

// === Review Types ===

export interface PlanReview {
  planId: string;
  decision: 'approve' | 'request_changes' | 'reject';
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  findings: ReviewFinding[];
  suggestedChanges: string[];
}

export interface ReviewFinding {
  id: string;
  severity: 'critical' | 'major' | 'minor' | 'nit';
  category: 'correctness' | 'security' | 'performance' | 'design' | 'missing';
  filePath?: string;
  stepOrder?: number;
  description: string;
  suggestion?: string;
}
