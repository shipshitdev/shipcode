import { createHash } from 'node:crypto';
import type { AgentType, ReasoningEffort } from '@shipcode/shared';
import { unwrapCliResultEnvelope } from './cli-result';
import { runCliWithStdin } from './cli-stdin-runner';
import { OpenRouterClient } from './providers/openrouter-http';
import {
  mapReasoningEffortToClaudeThinkingTokens,
  mapReasoningEffortToCodex,
  normalizeOpenRouterReasoningEffort,
} from './providers/reasoning';

const AUTOMATION_FENCE_TAG = 'shipcode-automation';

export interface FormattedAutomation {
  prompt: string;
}

export type AutomationFormatProvider = Extract<AgentType, 'claude' | 'codex' | 'openrouter'>;

export interface FormatAutomationPromptOptions {
  rawPrompt: string;
  cwd: string;
  provider: AutomationFormatProvider;
  modelId?: string | null;
  reasoningEffort?: ReasoningEffort | null;
  timeoutMs?: number;
  openRouterApiKey?: string | null;
}

function rawAutomationDelimiter(rawPrompt: string): string {
  const hash = createHash('sha256').update(rawPrompt).digest('hex').slice(0, 12).toUpperCase();
  const base = `AUTOMATION_RAW_${hash}`;
  let delimiter = base;
  let suffix = 1;
  /* v8 ignore start -- deterministic hash collision guard; impractical to hit without mocking crypto */
  while (rawPrompt.includes(delimiter)) {
    delimiter = `${base}_${suffix}`;
    suffix += 1;
  }
  /* v8 ignore stop */
  return delimiter;
}

export function buildAutomationFormatPrompt(rawPrompt: string): string {
  const rawDelimiter = rawAutomationDelimiter(rawPrompt);
  return `You are an automation spec formatter.

Your job is to take a rough ShipCode automation idea, messy notes, transcript,
checklist, or prompt and rewrite it into a clear, executable automation prompt.

This automation prompt will be run later by an AI coding agent against a real
software repository. Make it precise enough that the executor can act without
guessing.

Rules:
- Preserve the user's intent and all meaningful constraints.
- Do not invent behavior, dependencies, credentials, APIs, files, or schedule details.
- Do not remove safeguards or confirmation requirements.
- If something is ambiguous, preserve the likely intent and include it under
  "## Open Questions" instead of making up an answer.
- Keep the result practical and concise. Avoid generic filler.
- Write the output as markdown only.

Use this structure:

# Automation: <clear name>

## Goal
One concise paragraph describing what this automation accomplishes.

## When To Run
Describe the trigger, schedule, event, command, or human condition that starts it.

## Inputs
List required inputs, optional inputs, environment variables, files, credentials,
APIs, or user-provided context.

## Preconditions
List anything that must be true before execution.

## Steps
Numbered execution flow. Each step must be concrete enough for Codex, Claude CLI,
OpenRouter, or another coding agent to perform without guessing.

## Decision Rules
List branching logic, priorities, fallback behavior, and what to do when data is
missing.

## Safety Rules
List anything the automation must never do, any confirmation requirements,
destructive-action limits, privacy rules, or cost controls.

## Output
Describe exactly what the automation should produce: files changed, report
format, PR, issue comment, terminal output, etc.

## Verification
Describe how the automation should prove it worked: tests, lint, screenshots,
logs, API checks, manual review notes, etc.

## Failure Handling
Describe what to do on errors, partial completion, missing permissions, rate
limits, malformed inputs, or blocked assumptions.

## Open Questions
Only include this section if something remains ambiguous.

Raw automation to format:

<<<${rawDelimiter}
${rawPrompt}
${rawDelimiter}
>>>

Output contract:
Output exactly one fenced code block with the tag \`${AUTOMATION_FENCE_TAG}\`.
Do not output anything else. The block must contain a single JSON object with
one key:

- \`prompt\`: the formatted automation markdown as a string. Escape newlines as
  \\n and quotes as \\".

Example envelope:

\`\`\`${AUTOMATION_FENCE_TAG}
{"prompt":"# Automation: daily smoke test\\n\\n## Goal\\n..."}
\`\`\`
`;
}

export async function formatAutomationPrompt(
  opts: FormatAutomationPromptOptions,
): Promise<FormattedAutomation> {
  const rawPrompt = opts.rawPrompt.trim();
  if (!rawPrompt) throw new Error('Automation prompt is empty');

  const prompt = buildAutomationFormatPrompt(rawPrompt);
  const timeout = opts.timeoutMs ?? 180_000;

  if (opts.provider === 'openrouter') {
    return formatAutomationPromptViaOpenRouter({
      prompt,
      modelId: opts.modelId,
      reasoningEffort: opts.reasoningEffort,
      timeoutMs: timeout,
      apiKey: opts.openRouterApiKey,
    });
  }

  const stdout = await runAutomationCliWithStdin(
    opts.provider,
    prompt,
    opts.cwd,
    timeout,
    opts.modelId,
    opts.reasoningEffort,
  );

  return extractFormattedAutomation(unwrapCliResultEnvelope(stdout));
}

function runAutomationCliWithStdin(
  provider: Extract<AgentType, 'claude' | 'codex'>,
  prompt: string,
  cwd: string,
  timeoutMs: number,
  modelId?: string | null,
  reasoningEffort?: ReasoningEffort | null,
): Promise<string> {
  const args =
    provider === 'claude'
      ? [
          '-p',
          ...(modelId ? ['--model', modelId] : []),
          '--output-format',
          'json',
          '--max-turns',
          '3',
          ...(() => {
            const thinkingTokens = mapReasoningEffortToClaudeThinkingTokens(
              reasoningEffort ?? undefined,
              modelId,
            );
            return thinkingTokens === null
              ? []
              : (['--max-thinking-tokens', String(thinkingTokens)] as string[]);
          })(),
          '--allowedTools',
          '',
        ]
      : [
          '-a',
          'never',
          ...(modelId ? ['-m', modelId] : []),
          '-c',
          `model_reasoning_effort=${mapReasoningEffortToCodex(
            reasoningEffort ?? undefined,
            modelId,
          )}`,
          'exec',
          '-',
          '--sandbox',
          'read-only',
        ];

  return runCliWithStdin({ cli: provider, args, input: prompt, cwd, timeoutMs });
}

async function formatAutomationPromptViaOpenRouter(options: {
  prompt: string;
  modelId?: string | null;
  reasoningEffort?: ReasoningEffort | null;
  timeoutMs: number;
  apiKey?: string | null;
}): Promise<FormattedAutomation> {
  if (!options.apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const model = options.modelId?.trim() || 'openrouter/auto';
  const client = new OpenRouterClient({ apiKey: options.apiKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const effort = normalizeOpenRouterReasoningEffort(options.reasoningEffort ?? undefined, model);
    const result = await client.chat(
      {
        model,
        messages: [
          {
            role: 'system',
            content:
              'You format automation prompts. Return only the requested fenced JSON envelope.',
          },
          { role: 'user', content: options.prompt },
        ],
        stream: true,
        include_reasoning: effort !== 'none',
        reasoning: { effort },
      },
      controller.signal,
    );

    return extractFormattedAutomation(result.content);
  } finally {
    clearTimeout(timer);
  }
}

export function extractFormattedAutomation(text: string): FormattedAutomation {
  const openTag = `\`\`\`${AUTOMATION_FENCE_TAG}`;
  const lines = text.split('\n');
  let collecting = false;
  const captured: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!collecting) {
      if (trimmed === openTag || trimmed.startsWith(`${openTag} `)) {
        collecting = true;
      }
      continue;
    }
    if (trimmed === '```') break;
    captured.push(line);
  }

  if (!captured.length) {
    throw new Error(`No \`${AUTOMATION_FENCE_TAG}\` fenced block found in AI response`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(captured.join('\n').trim());
  } catch (err) {
    throw new Error(
      `Failed to parse automation JSON inside \`${AUTOMATION_FENCE_TAG}\` block: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as Record<string, unknown>).prompt !== 'string'
  ) {
    throw new Error('Automation JSON is missing required `prompt` string key');
  }

  const prompt = (parsed as { prompt: string }).prompt.trim();
  if (!prompt) throw new Error('Formatted automation prompt is empty');

  return { prompt };
}
