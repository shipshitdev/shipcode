// === Feature QA State ===

/**
 * Machine-readable QA contract for a feature. Declares what to test,
 * where, and what data is needed so agents can run focused verification
 * instead of a full-suite crawl.
 */
export interface FeatureQaState {
  /** Stable feature identifier (e.g. issue number or slug). */
  featureId: string;
  /** Route or surface scope the feature operates on. */
  routes: string[];
  /** Named user flows that must work for the feature to ship. */
  criticalFlows: FeatureQaCriticalFlow[];
  /** Expected UI states the feature should be able to reach. */
  expectedStates: string[];
  /** Test data or seeding assumptions required for QA. */
  testDataAssumptions: string[];
  /** Whether stable selectors exist for critical controls. */
  selectorReadiness: 'ready' | 'partial' | 'missing';
  /** Machine-checkable visual/layout assertions that must pass in a browser. */
  visualAssertions?: FeatureQaVisualAssertion[];
  /** Artifact capture policy for generated browser QA. */
  evidencePolicy?: FeatureQaEvidencePolicy;
}

export interface FeatureQaCriticalFlow {
  /** Human-readable name of the flow (e.g. "login with valid credentials"). */
  name: string;
  /** Ordered steps to exercise the flow. */
  steps: string[];
  /** What constitutes success for this flow. */
  successCriteria: string;
}

export type FeatureQaVisualAssertionKind =
  | 'top-left-of-container'
  | 'top-right-of-container'
  | 'bottom-left-of-container'
  | 'bottom-right-of-container'
  | 'visible'
  | 'not-overlapping'
  | 'above'
  | 'below'
  | 'left-of'
  | 'right-of';

export interface FeatureQaVisualAssertion {
  name: string;
  route: string;
  targetSelector: string;
  assertion: FeatureQaVisualAssertionKind;
  containerSelector?: string;
  referenceSelector?: string;
  tolerancePx?: number;
  viewport?: {
    width: number;
    height: number;
  };
}

export interface FeatureQaEvidencePolicy {
  screenshot: 'always' | 'on-failure';
  trace: 'always' | 'on-failure' | 'on-retry';
  video: 'always' | 'on-failure' | 'on-retry' | 'off';
}

/**
 * Result of a focused QA run for a single feature.
 */
export interface FeatureQaResult {
  featureId: string;
  status: 'passed' | 'failed' | 'partial';
  /** Per-flow results. */
  flowResults: FeatureQaFlowResult[];
  /** Concise human-readable summary. */
  summary: string;
  /** Optional paths to screenshots, traces, or logs. */
  evidencePaths?: string[];
  runAt: string;
}

export interface FeatureQaFlowResult {
  flowName: string;
  passed: boolean;
  /** Failure reason if not passed. */
  failureReason?: string;
  /** Optional paths to screenshots, traces, videos, or JSON evidence for this flow. */
  evidencePaths?: string[];
  /** Machine assertion results collected for this flow. */
  assertions?: FeatureQaAssertionResult[];
}

export interface FeatureQaAssertionResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  evidencePath?: string;
}

export interface PipelineModelResolvedEvent {
  threadId: string;
  phase: 'plan' | 'review' | 'revision' | 'execute' | 'verify';
  requestedModel: string;
  resolvedModel: string;
  tokensUsed?: { prompt: number; completion: number };
  costUsd?: number;
}
