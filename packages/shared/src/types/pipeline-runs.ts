import type { PipelinePhase } from './pipeline-core';
import type { TerminalEventRecord } from './terminal';

export type PromptTelemetryPhase = 'plan' | 'review' | 'revision' | 'verify' | 'execute';

export interface PromptTelemetryMaterialSummary {
  count: number;
  labels: string[];
  kinds: string[];
}

export interface PromptTelemetryRecord {
  id: string;
  threadId: string;
  runId?: string | null;
  phase: PromptTelemetryPhase;
  invocationId: string;
  attempt: number | null;
  provider: string | null;
  model: string | null;
  promptCharacters: number;
  promptBytes: number;
  promptLines: number;
  selectedMaterials: PromptTelemetryMaterialSummary | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  createdAt: string;
}

export interface PromptTelemetryInsert {
  threadId: string;
  runId?: string | null;
  phase: PromptTelemetryPhase;
  invocationId: string;
  attempt?: number | null;
  provider?: string | null;
  model?: string | null;
  promptCharacters: number;
  promptBytes: number;
  promptLines: number;
  selectedMaterials?: PromptTelemetryMaterialSummary | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  costUsd?: number | null;
}

// === Pipeline run + step log ===
//
// A durable pipeline run is the execution-management primitive that ties the
// existing phase log, step log, conversations, telemetry, and issue ownership
// together. Threads are user-facing history; runs are individual attempts.

export type PipelineRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'paused'
  | 'interrupted';

export interface PipelineRunRecord {
  id: string;
  threadId: string;
  projectId: string | null;
  source: string;
  triggerDetail: string | null;
  status: PipelineRunStatus;
  currentPhase: PipelinePhase | null;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  errorKind: string | null;
  context: Record<string, unknown> | null;
  retryOfRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineRunInsert {
  threadId: string;
  projectId?: string | null;
  source: string;
  triggerDetail?: string | null;
  currentPhase?: PipelinePhase | null;
  context?: Record<string, unknown> | null;
  retryOfRunId?: string | null;
}

export interface PipelineRunFinishUpdate {
  status: Exclude<PipelineRunStatus, 'queued' | 'running'>;
  currentPhase?: PipelinePhase | null;
  errorMessage?: string | null;
  errorKind?: string | null;
  context?: Record<string, unknown> | null;
}

export interface PipelineRunTimelineEntry {
  run: PipelineRunRecord;
  isCurrent: boolean;
  retryDepth: number;
  phaseTimeline: PipelinePhaseLogRecord[];
  steps: PipelineStepRecord[];
  terminalEvents: TerminalEventRecord[];
}

export type PipelineWakeRequestStatus =
  | 'pending'
  | 'claimed'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type PipelineWakeRequestKind = 'automation' | 'pipeline' | 'execution' | 'maintenance';

export interface PipelineWakeRequestRecord {
  id: string;
  kind: PipelineWakeRequestKind;
  source: string;
  reason: string;
  targetType: string;
  targetId: string;
  projectId: string | null;
  threadId: string | null;
  runId: string | null;
  idempotencyKey: string | null;
  status: PipelineWakeRequestStatus;
  scheduledAt: string;
  claimedAt: string | null;
  claimedBy: string | null;
  completedAt: string | null;
  failedAt: string | null;
  lastError: string | null;
  coalescedCount: number;
  payload: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineWakeRequestInsert {
  kind: PipelineWakeRequestKind;
  source: string;
  reason: string;
  targetType: string;
  targetId: string;
  projectId?: string | null;
  threadId?: string | null;
  runId?: string | null;
  idempotencyKey?: string | null;
  scheduledAt?: string | null;
  payload?: Record<string, unknown> | null;
}

// === Pipeline step log ===
//
// A row per provider invocation captures the lifecycle envelope around a
// single phase attempt: who ran it (provider+model), when it started/ended,
// what the outcome was (status + error kind + message), and what it cost.
// Designed to be the join key correlating `pipeline:phase`, `terminal:event`,
// `pipeline:model-resolved`, and `prompt_telemetry` rows for a given attempt.

export type PipelineStepStatus =
  | 'started'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'clarification_requested';

export type PipelineStepPhase = PromptTelemetryPhase;

export interface PipelineStepRecord {
  id: string;
  threadId: string;
  runId?: string | null;
  phase: PipelineStepPhase;
  attempt: number;
  provider: string | null;
  requestedModel: string | null;
  resolvedModel: string | null;
  status: PipelineStepStatus;
  errorKind: string | null;
  errorMessage: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

export interface PipelineStepInsert {
  threadId: string;
  runId?: string | null;
  phase: PipelineStepPhase;
  attempt: number;
  provider?: string | null;
  requestedModel?: string | null;
}

export interface PipelineStepCompletionUpdate {
  status: Exclude<PipelineStepStatus, 'started'>;
  resolvedModel?: string | null;
  errorKind?: string | null;
  errorMessage?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  costUsd?: number | null;
  /** Links this step to its conversation prompt/response pair. */
  conversationId?: string | null;
}

// === Pipeline analytics ===

export type PipelinePhaseTerminalStatus = PipelinePhase | PipelineStepStatus | 'unknown';

export interface PipelinePhaseLogRecord {
  id: string;
  threadId: string;
  runId?: string | null;
  phase: PipelinePhase;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  terminalStatus: PipelinePhaseTerminalStatus | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
}

export interface PipelinePhaseLogInsert {
  threadId: string;
  runId?: string | null;
  phase: PipelinePhase;
  startedAt?: string;
  metadata?: Record<string, unknown> | null;
}

export type SkillResolutionSource = 'project' | 'global' | 'bundled' | 'fallback' | 'unknown';

export interface SkillResolutionLogRecord {
  id: string;
  threadId: string;
  providerPhase: PromptTelemetryPhase;
  skillKey: string;
  source: SkillResolutionSource;
  baseVersion: string | null;
  fallbackUsed: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface SkillResolutionLogInsert {
  threadId: string;
  providerPhase: PromptTelemetryPhase;
  skillKey: string;
  source: SkillResolutionSource;
  baseVersion?: string | null;
  fallbackUsed?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface PipelineTimeToPrSummary {
  sampleSize: number;
  medianMs: number | null;
  p75Ms: number | null;
  p95Ms: number | null;
}

export interface PipelinePhaseDurationSummary {
  phase: PipelinePhase;
  runCount: number;
  averageMs: number;
  medianMs: number;
  p75Ms: number;
  p95Ms: number;
}

export interface PipelineTokensByPhase {
  phase: PromptTelemetryPhase;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  attemptCount: number;
}

export interface PipelinePromptByPhase {
  phase: PromptTelemetryPhase;
  promptCount: number;
  averageCharacters: number;
  averageBytes: number;
  averageLines: number;
  materialCount: number;
  materialKinds: string[];
}

export interface PipelineSlowRunSummary {
  threadId: string;
  title: string;
  projectName: string | null;
  githubPrNumber: number | null;
  durationMs: number;
  completedAt: string | null;
  bottleneckPhase: PipelinePhase | null;
  bottleneckDurationMs: number | null;
}

export interface PipelineSkillFallbackSummary {
  totalResolutions: number;
  fallbackCount: number;
  fallbackRate: number;
  parseFailureRate: number;
  retryRate: number;
  downstreamSuccessRate: number;
  score: number;
}

export interface PipelineAnalyticsOverview {
  timeToPr: PipelineTimeToPrSummary;
  averagePhaseDurations: PipelinePhaseDurationSummary[];
  slowestRecentRuns: PipelineSlowRunSummary[];
  tokensByPhase: PipelineTokensByPhase[];
  promptByPhase: PipelinePromptByPhase[];
  skillFallback: PipelineSkillFallbackSummary;
}

export interface PipelineThreadAnalytics {
  threadId: string;
  phaseTimeline: PipelinePhaseLogRecord[];
  providerAttempts: PipelineStepRecord[];
  promptTelemetry: PromptTelemetryRecord[];
  skillResolutions: SkillResolutionLogRecord[];
  tokensByPhase: PipelineTokensByPhase[];
  promptByPhase: PipelinePromptByPhase[];
  bottleneckPhase: PipelinePhase | null;
  bottleneckDurationMs: number | null;
  totalDurationMs: number | null;
  skillFallback: PipelineSkillFallbackSummary;
}
