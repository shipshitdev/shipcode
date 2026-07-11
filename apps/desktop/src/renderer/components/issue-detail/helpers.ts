import type {
  ExecutorModel,
  PipelinePhase,
  PlanRecord,
  ReviewRecord,
  ShipCodePlan,
  Thread,
  VerificationRecord,
} from '@shipcode/shared';
import {
  PIPELINE_EXECUTOR_PROVIDERS,
  PIPELINE_PHASE,
  shipCodePlanSchema,
  stripAnsi,
} from '@shipcode/shared';

export { formatRelativeTime as timeAgo } from '@shipcode/shared';
export { stripAnsi };

export const ACTIVE_PHASES: PipelinePhase[] = [
  PIPELINE_PHASE.planning,
  PIPELINE_PHASE.clarifying,
  PIPELINE_PHASE.reviewing,
  PIPELINE_PHASE.revising,
  PIPELINE_PHASE.executing,
  PIPELINE_PHASE.testing,
  PIPELINE_PHASE.verifying,
  PIPELINE_PHASE.shipping,
];

export const PIPELINE_PREVIEW_PHASES = [
  { id: 'plan', label: 'Plan' },
  { id: 'clarify', label: 'Clarify' },
  { id: 'review', label: 'Review' },
  { id: 'execute', label: 'Execute' },
  { id: 'test', label: 'Test' },
  { id: 'verify', label: 'Verify' },
  { id: 'ship', label: 'Ship' },
] as const;

export const PHASE_PROVIDER_OPTIONS: Record<
  'planner' | 'reviewer' | 'executor' | 'verifier',
  ExecutorModel[]
> = {
  planner: [...PIPELINE_EXECUTOR_PROVIDERS],
  reviewer: [...PIPELINE_EXECUTOR_PROVIDERS],
  executor: [...PIPELINE_EXECUTOR_PROVIDERS],
  verifier: [...PIPELINE_EXECUTOR_PROVIDERS],
};

export type PlanStatusBadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'accent';

export function getPlanStatusPresentation(
  plan: PlanRecord,
  review?: ReviewRecord,
): {
  label: string;
  phaseStatus: PipelinePhase | 'idle';
  style: 'phase-chip' | 'badge';
  badgeVariant?: PlanStatusBadgeVariant;
} {
  switch (plan.status) {
    case 'approved':
      return {
        label: 'AI approved',
        phaseStatus: PIPELINE_PHASE.completed,
        style: 'phase-chip',
      };
    case 'approval':
      return {
        label: 'Needs approval',
        phaseStatus: PIPELINE_PHASE.reviewing,
        style: 'phase-chip',
      };
    case 'rejected':
      if (review?.decision === 'request_changes') {
        return {
          label: 'AI requested changes',
          phaseStatus: PIPELINE_PHASE.revising,
          style: 'phase-chip',
        };
      }
      return {
        label: 'AI rejected',
        phaseStatus: PIPELINE_PHASE.failed,
        style: 'phase-chip',
      };
    case 'superseded':
      return {
        label: 'Superseded',
        phaseStatus: PIPELINE_PHASE.idle,
        style: 'badge',
        badgeVariant: 'default',
      };
    case 'pending_review':
      return {
        label: 'AI reviewing',
        phaseStatus: PIPELINE_PHASE.reviewing,
        style: 'phase-chip',
      };
    default:
      return {
        label: 'Plan drafted',
        phaseStatus: PIPELINE_PHASE.planning,
        style: 'phase-chip',
      };
  }
}

export function encodePhaseOption(provider: ExecutorModel, modelId: string | null) {
  return `${provider}::${modelId ?? '__default__'}`;
}

export function decodePhaseOption(value: string): {
  provider: ExecutorModel;
  modelId: string | null;
} {
  const [providerRaw, modelIdRaw] = value.split('::');
  // Validate against the shared source of truth so a newly shipped provider
  // (e.g. PR #327 'grok') can never regress this decode into a Claude fallback.
  const provider = (PIPELINE_EXECUTOR_PROVIDERS as readonly string[]).includes(providerRaw)
    ? (providerRaw as ExecutorModel)
    : 'claude';
  return { provider, modelId: modelIdRaw === '__default__' ? null : modelIdRaw };
}

function resolveRawPlanText(raw: string): string {
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = stripAnsi(lines[i]).trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'result') {
        if (typeof parsed.result === 'string') return parsed.result;
        if (Array.isArray(parsed.result)) {
          const text = parsed.result
            .flatMap((block: { type: string; text?: string }) =>
              block.type === 'text' && typeof block.text === 'string' ? [block.text] : [],
            )
            .join('\n');
          if (text) return text;
        }
      }
    } catch {
      /* skip */
    }
  }

  const agentTexts: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed.type === 'item.completed' &&
        parsed.item?.type === 'agent_message' &&
        typeof parsed.item.text === 'string'
      ) {
        agentTexts.push(parsed.item.text);
      }
    } catch {
      /* skip */
    }
  }

  if (agentTexts.length > 0) return agentTexts.join('\n\n');
  return raw;
}

export function resolveClientSidePlan(rawOutput: string): ShipCodePlan | null {
  const text = resolveRawPlanText(rawOutput);
  const matches = Array.from(text.matchAll(/```shipcode-plan[^\n]*\n([\s\S]*?)\n```/gm));
  for (let i = matches.length - 1; i >= 0; i--) {
    try {
      return shipCodePlanSchema.parse(JSON.parse(matches[i][1].trim()));
    } catch {
      /* keep scanning older fences */
    }
  }
  return null;
}

type ZodIssue = { path: (string | number)[]; message: string };
function isZodError(e: unknown): e is { issues: ZodIssue[] } {
  return (
    e instanceof Error && 'issues' in e && Array.isArray((e as Record<string, unknown>).issues)
  );
}

export function diagnosePlanParseFailure(rawOutput: string): string {
  const text = resolveRawPlanText(rawOutput);
  const matches = Array.from(text.matchAll(/```shipcode-plan[^\n]*\n([\s\S]*?)\n```/gm));
  if (matches.length === 0) {
    return 'Plan output could not be parsed: no shipcode-plan fence found in model output.';
  }
  const match = matches[matches.length - 1];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return 'Plan output could not be parsed: fence found but content is not valid JSON.';
  }
  try {
    shipCodePlanSchema.parse(parsed);
  } catch (e) {
    const detail = isZodError(e)
      ? `${e.issues[0]?.path.join('.') ?? 'unknown'}: ${e.issues[0]?.message ?? 'invalid'}`
      : String(e).slice(0, 200);
    return `Plan output could not be parsed: schema validation failed — ${detail}`;
  }
  return 'Plan output could not be parsed. Check devtools console for the full trace.';
}

export function resolveFailingPhaseOutput({
  thread,
  latestPlanRawOutput,
  latestReviewRawOutput,
  latestVerificationRawOutput,
}: {
  thread?: { status?: string | null; failurePhase?: string | null } | null;
  latestPlanRawOutput?: string | null;
  latestReviewRawOutput?: string | null;
  latestVerificationRawOutput?: string | null;
}): string | null {
  const planOutput = latestPlanRawOutput?.trim() ? latestPlanRawOutput : null;
  const reviewOutput = latestReviewRawOutput?.trim() ? latestReviewRawOutput : null;
  const verificationOutput = latestVerificationRawOutput?.trim()
    ? latestVerificationRawOutput
    : null;

  if (!thread || thread.status !== PIPELINE_PHASE.failed) return planOutput;

  switch (thread.failurePhase) {
    case PIPELINE_PHASE.planning:
    case PIPELINE_PHASE.clarifying:
      return planOutput;
    case PIPELINE_PHASE.reviewing:
    case PIPELINE_PHASE.revising:
      return reviewOutput ?? planOutput;
    case PIPELINE_PHASE.executing:
      // Executor raw transcript not persisted; never fall back to planner
      // output here — it would render the plan JSON as the failure body.
      return null;
    case PIPELINE_PHASE.testing:
    case PIPELINE_PHASE.verifying:
      return verificationOutput ?? planOutput;
    default:
      return verificationOutput ?? reviewOutput ?? planOutput;
  }
}

export type IssueRetryAction = 'review' | 'execute' | 'verify' | 'commit_and_push' | 'plan';

export function resolveIssueRetryPresentation({
  thread,
  latestPlan,
  latestVerification,
}: {
  thread: Thread | null | undefined;
  latestPlan: PlanRecord | null | undefined;
  latestVerification: VerificationRecord | null | undefined;
}): {
  retryAction: IssueRetryAction | null;
  retryButtonLabel: string;
  retrySummary: string | null;
} {
  const failedLatestStructuredVerification =
    latestVerification?.planId === latestPlan?.id &&
    latestVerification?.result === 'failed' &&
    !!latestVerification?.structured;

  const retryAction = (() => {
    if (!thread) return null;
    if (/no code changes/i.test(thread.lastError ?? '')) return 'plan' as const;
    const structuredPlan = latestPlan?.structured ?? null;
    if (!structuredPlan) return 'plan' as const;
    if (!thread.worktreePath) return 'review' as const;
    if (latestVerification && latestVerification.planId === latestPlan?.id) {
      if (latestVerification.result === 'failed' && latestVerification.structured) {
        return 'execute' as const;
      }
      if (latestVerification.result === 'failed') return 'verify' as const;
      if (latestVerification.result === 'passed') return 'commit_and_push' as const;
    }
    return 'execute' as const;
  })();

  const retryButtonLabel =
    retryAction === 'review'
      ? 'Resume review'
      : retryAction === 'execute'
        ? 'Resume execution'
        : retryAction === 'verify'
          ? 'Resume verification'
          : retryAction === 'commit_and_push'
            ? 'Resume shipping'
            : 'Re-plan';

  const retrySummary =
    retryAction === 'review'
      ? 'Retry will resume from review using the latest structured plan.'
      : retryAction === 'execute'
        ? failedLatestStructuredVerification
          ? 'Retry will resume from execution using the current worktree and latest verification feedback.'
          : 'Retry will resume from execution using the latest structured plan.'
        : retryAction === 'verify'
          ? 'Retry will resume from verification using the current worktree.'
          : retryAction === 'commit_and_push'
            ? 'Retry will resume from commit and push using the verified worktree.'
            : retryAction === 'plan'
              ? /no code changes/i.test(thread?.lastError ?? '')
                ? 'The executor produced no file changes. Update the issue description with more detail before replanning.'
                : 'Retry will start a fresh planning pass. This resumes the workflow, not the same live planner session.'
              : null;

  return { retryAction, retryButtonLabel, retrySummary };
}

export function safeErrorMessage(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  for (const line of trimmed.split('\n').reverse()) {
    try {
      const obj = JSON.parse(line.trim()) as Record<string, unknown>;
      if (obj.type === 'result' && typeof obj.result === 'string') return obj.result.slice(0, 280);
      if (typeof obj.error === 'string') return obj.error.slice(0, 280);
      if (
        obj.type === 'result' &&
        Array.isArray(obj.errors) &&
        obj.errors.length > 0 &&
        typeof obj.errors[0] === 'string'
      ) {
        return obj.errors[0].slice(0, 280);
      }
    } catch {
      /* skip */
    }
  }
  return 'Pipeline failed in the target project/worktree. See terminal output for details.';
}

const PHASE_LABELS: Record<string, string> = {
  planning: 'Planning failed',
  clarifying: 'Clarification failed',
  reviewing: 'Review failed',
  revising: 'Revision failed',
  executing: 'Execution failed',
  testing: 'Test run failed',
  verifying: 'Verification failed',
  shipping: 'Shipping failed',
};

export function getFailurePresentation(
  raw: string | null | undefined,
  thread?: { failurePhase?: string | null; failureCount?: number } | null,
): {
  label: string;
  detail: string | null;
} {
  const text = raw?.trim() ?? '';
  const failureCount = thread?.failureCount ?? 0;
  const countSuffix = failureCount > 1 ? ` (attempt ${failureCount})` : '';

  if (
    /verification commands failed|verification command error|verification preflight failed|command failed \(\d+\):/i.test(
      text,
    )
  ) {
    return {
      label: `Target project verification failed${countSuffix}`,
      detail:
        'The failing command ran inside the issue worktree, not inside the ShipCode desktop app.',
    };
  }

  if (/no code changes/i.test(text)) {
    return {
      label: `No changes produced${countSuffix}`,
      detail:
        'The executor completed without modifying any files. Add more detail to the issue description and replan.',
    };
  }

  if (/execution failed|execution error|setup failed|worktree creation failed/i.test(text)) {
    return {
      label: `Worktree execution failed${countSuffix}`,
      detail:
        'This error came from the target project/worktree or the executor run, not from Electron itself.',
    };
  }

  const phaseLabel = thread?.failurePhase ? PHASE_LABELS[thread.failurePhase] : null;
  return {
    label: (phaseLabel ?? 'Pipeline error') + countSuffix,
    detail: null,
  };
}

// Triage-rule failures live on the issue cache record (triageFailureReason),
// independent of pipeline/thread failures. Surface them through the same
// danger styling used by getFailurePresentation rather than crashing the
// renderer (PRD triage-rules-engine NFR).
export function getTriageFailurePresentation(
  reason: string | null | undefined,
): { label: string; detail: string } | null {
  const text = reason?.trim();
  if (!text) return null;
  return {
    label: 'Triage rule failed',
    detail: stripAnsi(safeErrorMessage(text)),
  };
}

export const PRD_PROSE_CLASSES =
  'space-y-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-secondary [&_code]:rounded [&_code]:bg-tertiary [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:whitespace-pre-wrap [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-tertiary [&_pre]:p-3 [&_pre]:text-xs [&_ul]:list-disc [&_ul]:pl-5';
