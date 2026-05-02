import { spawn } from 'node:child_process';
import type {
  AppSettings,
  ExecutorModel,
  GitHubIssueCacheRecord,
  ReasoningEffort,
} from '@shipcode/shared';
import { extractCliFailureMessage, formatCliSpawnFailure } from '../cli-error';
import { shellExecEnv } from '../health-check';
import { OpenRouterClient, OpenRouterError } from '../providers/openrouter-http';
import {
  mapReasoningEffortToClaudeThinkingTokens,
  mapReasoningEffortToCodex,
  normalizeOpenRouterReasoningEffort,
} from '../providers/reasoning';

const TRIAGE_FENCE_TAG = 'shipcode-issue-triage';
const TRIAGE_TIMEOUT_MS = 120_000;
const TRIAGE_LABELS = [
  'agent:claude',
  'agent:codex',
  'agent:openrouter',
  'agent:openrouter/auto',
  'agent:openrouter/free',
  'bug',
  'enhancement',
  'deferred',
  'complexity:low',
  'complexity:medium',
  'complexity:high',
  'blast:contained',
  'blast:cross-package',
  'blast:cross-app',
  'blast:infra',
] as const;

export interface IssueTriageRecommendation {
  issueNumber: number;
  confidence: number;
  suggestedAgent: 'claude' | 'codex' | 'openrouter' | null;
  suggestedLabels: string[];
  shouldStart: boolean;
  needsHuman: boolean;
  rationale: string;
}

export interface IssueTriageRunResult {
  provider: ExecutorModel;
  modelId: string | null;
  resolvedModel: string | null;
  recommendations: IssueTriageRecommendation[];
}

interface TriageEnvelope {
  issues?: unknown;
}

export async function triageGitHubIssues(opts: {
  cwd: string;
  issues: GitHubIssueCacheRecord[];
  settings: Pick<
    AppSettings,
    'triageModel' | 'triageModelId' | 'triageReasoningEffort' | 'openrouterDefaultPaidModel'
  >;
  apiKey?: string;
  createOpenRouterClient?: (apiKey: string) => OpenRouterClient;
}): Promise<IssueTriageRunResult> {
  const provider = opts.settings.triageModel;
  const modelId = opts.settings.triageModelId;
  const prompt = buildTriagePrompt(opts.issues);

  if (provider === 'openrouter') {
    const apiKey = opts.apiKey;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
    const client = opts.createOpenRouterClient?.(apiKey) ?? new OpenRouterClient({ apiKey });
    const model = modelId || opts.settings.openrouterDefaultPaidModel;
    const controller = new AbortController();
    try {
      const result = await client.chat(
        {
          model,
          messages: [
            {
              role: 'system',
              content:
                'You classify GitHub issues for an autonomous coding pipeline. Return only the requested fenced JSON block.',
            },
            { role: 'user', content: prompt },
          ],
          stream: false,
          include_reasoning: opts.settings.triageReasoningEffort !== 'none',
          reasoning: {
            effort: normalizeOpenRouterReasoningEffort(opts.settings.triageReasoningEffort, model),
          },
        },
        controller.signal,
      );
      return {
        provider,
        modelId,
        resolvedModel: result.model ?? model,
        recommendations: extractTriageRecommendations(result.content),
      };
    } catch (err) {
      if (err instanceof OpenRouterError) throw new Error(err.message);
      throw err;
    }
  }

  const text = await runCliTriage({
    provider,
    prompt,
    cwd: opts.cwd,
    modelId,
    reasoningEffort: opts.settings.triageReasoningEffort,
  });
  return {
    provider,
    modelId,
    resolvedModel: modelId ?? provider,
    recommendations: extractTriageRecommendations(text),
  };
}

export function buildTriagePrompt(issues: GitHubIssueCacheRecord[]): string {
  const compactIssues = issues.map((issue) => ({
    number: issue.issueNumber,
    title: issue.title,
    body: (issue.body ?? '').slice(0, 6000),
    labels: issue.labels,
    priority: issue.priorityRaw ?? issue.priorityRank,
  }));

  return `Review these GitHub issues for ShipCode's autonomous issue-to-PR pipeline.

Classify each issue using only this label allowlist:
${TRIAGE_LABELS.map((label) => `- ${label}`).join('\n')}

Guidance:
- Use agent:claude for broad implementation work, multi-file product work, or when local Claude Code is the best default.
- Use agent:codex for focused code edits, tests, TypeScript/React work, or when OpenAI/Codex is a good fit.
- Use agent:openrouter/auto when the issue is suitable for low-cost routing and not high-risk.
- Mark needsHuman=true when the issue lacks acceptance criteria, asks an ambiguous product decision, or conflicts with existing labels.
- Mark shouldStart=true only when the issue is specific enough to hand to the pipeline now.
- Use confidence 0..1. Be conservative; below 0.85 will not be auto-applied by default.

Issues:
${JSON.stringify(compactIssues, null, 2)}

Output exactly one fenced block:
\`\`\`${TRIAGE_FENCE_TAG}
{"issues":[{"issueNumber":123,"confidence":0.92,"suggestedAgent":"codex","suggestedLabels":["agent:codex","bug","complexity:low","blast:contained"],"shouldStart":true,"needsHuman":false,"rationale":"Specific bug with clear acceptance criteria."}]}
\`\`\`
`;
}

function runCliTriage(opts: {
  provider: Extract<ExecutorModel, 'claude' | 'codex'>;
  prompt: string;
  cwd: string;
  modelId: string | null;
  reasoningEffort: ReasoningEffort;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const label = opts.provider === 'claude' ? 'Claude CLI' : 'Codex CLI';
    const args =
      opts.provider === 'claude'
        ? [
            '-p',
            ...(opts.modelId ? ['--model', opts.modelId] : []),
            '--output-format',
            'json',
            '--max-turns',
            '1',
            ...(() => {
              const thinkingTokens = mapReasoningEffortToClaudeThinkingTokens(
                opts.reasoningEffort,
                opts.modelId,
              );
              return thinkingTokens === null
                ? []
                : (['--max-thinking-tokens', String(thinkingTokens)] as string[]);
            })(),
            '--dangerously-skip-permissions',
            '--disallowedTools',
            'Edit,Write,Bash,NotebookEdit,Read,Glob,Grep,Task,WebSearch,WebFetch',
          ]
        : [
            '-a',
            'never',
            ...(opts.modelId ? ['-m', opts.modelId] : []),
            '-c',
            `model_reasoning_effort=${mapReasoningEffortToCodex(
              opts.reasoningEffort,
              opts.modelId,
            )}`,
            'exec',
            '-',
            '--sandbox',
            'read-only',
          ];

    const proc = spawn(opts.provider, args, {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: shellExecEnv(),
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`${label} timed out after ${TRIAGE_TIMEOUT_MS}ms`));
    }, TRIAGE_TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(formatCliSpawnFailure(label, err.message)));
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${label} exited ${code}: ${extractCliFailureMessage(stdout, stderr)}`));
        return;
      }
      resolve(unwrapClaudeJson(stdout));
    });
    proc.stdin.write(opts.prompt);
    proc.stdin.end();
  });
}

function unwrapClaudeJson(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as { result?: unknown };
    if (typeof parsed.result === 'string') return parsed.result;
  } catch {
    // raw text
  }
  return stdout;
}

export function extractTriageRecommendations(text: string): IssueTriageRecommendation[] {
  const captured = extractFencedJson(text, TRIAGE_FENCE_TAG);
  let parsed: TriageEnvelope;
  try {
    parsed = JSON.parse(captured) as TriageEnvelope;
  } catch (err) {
    throw new Error(
      `Failed to parse ${TRIAGE_FENCE_TAG} JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!Array.isArray(parsed.issues)) {
    throw new Error(`Triage response must contain an issues array`);
  }
  return parsed.issues.map(normalizeRecommendation);
}

function normalizeRecommendation(value: unknown): IssueTriageRecommendation {
  const row = value as Record<string, unknown>;
  const issueNumber = Number(row.issueNumber);
  if (!Number.isInteger(issueNumber)) throw new Error('Triage issueNumber must be an integer');
  const confidence = clamp01(Number(row.confidence));
  const suggestedAgent =
    row.suggestedAgent === 'claude' ||
    row.suggestedAgent === 'codex' ||
    row.suggestedAgent === 'openrouter'
      ? row.suggestedAgent
      : null;
  const suggestedLabels = Array.isArray(row.suggestedLabels)
    ? row.suggestedLabels
        .filter((label): label is string => typeof label === 'string')
        .filter((label) => TRIAGE_LABELS.includes(label as (typeof TRIAGE_LABELS)[number]))
    : [];
  return {
    issueNumber,
    confidence,
    suggestedAgent,
    suggestedLabels: Array.from(new Set(suggestedLabels)),
    shouldStart: row.shouldStart === true,
    needsHuman: row.needsHuman === true,
    rationale: typeof row.rationale === 'string' ? row.rationale.slice(0, 500) : '',
  };
}

function extractFencedJson(text: string, tag: string): string {
  const openTag = `\`\`\`${tag}`;
  const lines = text.split('\n');
  let collecting = false;
  const captured: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!collecting) {
      if (trimmed === openTag || trimmed.startsWith(`${openTag} `)) collecting = true;
      continue;
    }
    if (trimmed === '```') break;
    captured.push(line);
  }
  if (captured.length === 0) throw new Error(`No ${tag} fenced block found in triage response`);
  return captured.join('\n').trim();
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
