import type {
  ExecutorModel,
  PipelinePhase,
  PlanRecord,
  ReviewRecord,
  ShipCodePlan,
} from '@shipcode/shared';
import { shipCodePlanSchema } from '@shipcode/shared';

export const ACTIVE_PHASES: PipelinePhase[] = [
  'planning',
  'reviewing',
  'revising',
  'executing',
  'testing',
  'verifying',
  'shipping',
];

export const PIPELINE_PREVIEW_PHASES = [
  { id: 'plan', label: 'Plan' },
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
  planner: ['claude', 'codex', 'openrouter'],
  reviewer: ['claude', 'codex', 'openrouter'],
  executor: ['claude', 'codex', 'openrouter'],
  verifier: ['claude', 'codex', 'openrouter'],
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
        phaseStatus: 'completed',
        style: 'phase-chip',
      };
    case 'awaiting_approval':
      return {
        label: 'Awaiting approval',
        phaseStatus: 'reviewing',
        style: 'phase-chip',
      };
    case 'rejected':
      if (review?.decision === 'request_changes') {
        return {
          label: 'AI requested changes',
          phaseStatus: 'revising',
          style: 'phase-chip',
        };
      }
      return {
        label: 'AI rejected',
        phaseStatus: 'failed',
        style: 'phase-chip',
      };
    case 'superseded':
      return {
        label: 'Superseded',
        phaseStatus: 'idle',
        style: 'badge',
        badgeVariant: 'default',
      };
    case 'pending_review':
      return {
        label: 'AI reviewing',
        phaseStatus: 'reviewing',
        style: 'phase-chip',
      };
    default:
      return {
        label: 'Plan drafted',
        phaseStatus: 'planning',
        style: 'phase-chip',
      };
  }
}

export function timeAgo(input: string | number): string {
  const timestamp = typeof input === 'number' ? input : new Date(input).getTime();
  const diff = Math.max(0, Date.now() - timestamp);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function encodePhaseOption(provider: ExecutorModel, modelId: string | null) {
  return `${provider}::${modelId ?? '__default__'}`;
}

export function decodePhaseOption(value: string): {
  provider: ExecutorModel;
  modelId: string | null;
} {
  const [providerRaw, modelIdRaw] = value.split('::');
  const provider =
    providerRaw === 'claude' || providerRaw === 'codex' || providerRaw === 'openrouter'
      ? providerRaw
      : 'claude';
  return { provider, modelId: modelIdRaw === '__default__' ? null : modelIdRaw };
}

export function resolveRawPlanText(raw: string): string {
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI codes
    const line = lines[i].replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'result') {
        if (typeof parsed.result === 'string') return parsed.result;
        if (Array.isArray(parsed.result)) {
          const text = parsed.result
            .filter((block: { type: string }) => block.type === 'text')
            .map((block: { text: string }) => block.text)
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
  const match = text.match(/```shipcode-plan[^\n]*\n([\s\S]*?)\n```/m);
  if (!match) return null;
  try {
    return shipCodePlanSchema.parse(JSON.parse(match[1].trim()));
  } catch {
    return null;
  }
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

export function getFailurePresentation(raw: string | null | undefined): {
  label: string;
  detail: string | null;
} {
  const text = raw?.trim() ?? '';
  if (
    /verification commands failed|verification command error|verification preflight failed|command failed \(\d+\):/i.test(
      text,
    )
  ) {
    return {
      label: 'Target project verification failed',
      detail:
        'The failing command ran inside the issue worktree, not inside the ShipCode desktop app.',
    };
  }

  if (/execution failed|execution error|setup failed|worktree creation failed/i.test(text)) {
    return {
      label: 'Worktree execution failed',
      detail:
        'This error came from the target project/worktree or the executor run, not from Electron itself.',
    };
  }

  return {
    label: 'Pipeline error',
    detail: null,
  };
}

export const PRD_PROSE_CLASSES =
  'space-y-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-secondary [&_code]:rounded [&_code]:bg-tertiary [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:whitespace-pre-wrap [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-tertiary [&_pre]:p-3 [&_pre]:text-xs [&_ul]:list-disc [&_ul]:pl-5';
