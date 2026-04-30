import { spawn } from 'node:child_process';
import type { GeneratorCli, ReasoningEffort } from '@shipcode/shared';
import { extractCliFailureMessage } from './cli-error';
import { shellExecEnv } from './health-check';
import {
  mapReasoningEffortToClaudeThinkingTokens,
  mapReasoningEffortToCodex,
} from './providers/reasoning';

const PRD_FENCE_TAG = 'shipcode-prd';

export interface GeneratedPrd {
  body: string;
}

export interface EnhancePrdOptions {
  /** Current draft PRD body (may be empty, the bare template, or a real draft). */
  draftBody: string;
  /** Contents of `skills/writing-prds/SKILL.md` from the target repo, or a fallback. */
  skillContent: string;
  /** Working directory (usually the project path). */
  cwd: string;
  /** Which CLI to use for PRD enhancement. Defaults to Claude. */
  cli?: GeneratorCli;
  /** Optional explicit model selection for the selected CLI. */
  modelId?: string | null;
  /** Reasoning effort / thinking budget for the selected CLI. */
  reasoningEffort?: ReasoningEffort;
  /** Request timeout in ms. Defaults to 3 minutes. */
  timeoutMs?: number;
}

function isCliResultEnvelope(value: unknown): value is { result: string } {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as { result?: unknown }).result === 'string'
  );
}

/**
 * Build the prompt fed to the AI CLI. Embeds the repo's writing-prds skill
 * verbatim, then the user's current draft, then the machine-parseable output
 * contract. The caller is expected to pipe this via stdin, NOT pass it as an
 * argv argument, because the skill content starts with YAML frontmatter
 * (`---`) that would be misread as a flag by argparse.
 */
export function buildPrdPrompt(draftBody: string, skillContent: string): string {
  return `${skillContent}

---

# Your task

A user is drafting a PRD in this repo. Their current draft is below. Refine it
to meet the skill's quality bar. Preserve the user's intent and all existing
content — you are polishing and filling in gaps, not rewriting.

Expand TBD sections if you can infer sensible content from context; if you
can't, leave them as TBD and list the ambiguity under \`## Risks & Open
Questions\`. If the draft is empty or just the template scaffold, treat this
as a blank canvas and produce a complete PRD shell with TBD placeholders.

## Current draft

${draftBody}

## Output contract

Output **exactly one** fenced code block with the tag \`${PRD_FENCE_TAG}\`. Do
not output anything else. The block must contain a single JSON object with one
key:

- \`body\`: the refined PRD markdown body as a string. Must start with the YAML
  frontmatter (\`---\\nname: ...\\n---\\n\`) and include every required section
  from the skill, in order. Escape newlines as \\n and quotes as \\".

Example envelope:

\`\`\`${PRD_FENCE_TAG}
{"body":"---\\nname: copy-issue-url\\n---\\n\\n# PRD: copy-issue-url\\n\\n## Executive Summary\\n..."}
\`\`\`
`;
}

/**
 * Run the selected CLI one-shot with the prompt piped via stdin and return a
 * parsed PRD body. Throws with a short, prompt-free error on failure.
 */
export async function enhancePrdDraft(opts: EnhancePrdOptions): Promise<GeneratedPrd> {
  const prompt = buildPrdPrompt(opts.draftBody, opts.skillContent);
  const timeout = opts.timeoutMs ?? 180_000;
  const cli = opts.cli ?? 'claude';

  const stdout = await runPrdCliWithStdin(
    cli,
    prompt,
    opts.cwd,
    timeout,
    opts.modelId,
    opts.reasoningEffort,
  );

  // `claude -p --output-format json` returns an envelope
  // `{ session_id, result, ... }`. Unwrap to `result`, with a raw-stdout
  // fallback for older CLI versions that already return plain text.
  let text = stdout;
  try {
    const envelope = JSON.parse(stdout) as unknown;
    if (isCliResultEnvelope(envelope)) {
      text = envelope.result;
    }
  } catch {
    // not a JSON envelope — use raw stdout
  }

  return extractPrd(text);
}

/**
 * Spawn the selected CLI with no prompt argv and pipe the prompt through stdin.
 *
 * Argv piping is deliberate: the prompt starts with YAML frontmatter (`---`)
 * which Claude CLI's argparser would reject as an unknown flag if passed as an
 * argument. Codex supports stdin via `exec -`, so both paths stay symmetric.
 * See `packages/agents/src/github/gh-cli.ts:117` for the same stdin pattern
 * used by `gh issue create --body-file -`.
 */
function runPrdCliWithStdin(
  cli: GeneratorCli,
  prompt: string,
  cwd: string,
  timeoutMs: number,
  modelId?: string | null,
  reasoningEffort?: ReasoningEffort,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const command = cli;
    const label = cli === 'claude' ? 'Claude CLI' : 'Codex CLI';
    const args =
      cli === 'claude'
        ? [
            '-p',
            ...(modelId ? ['--model', modelId] : []),
            '--output-format',
            'json',
            '--max-turns',
            '3',
            ...(() => {
              const thinkingTokens = mapReasoningEffortToClaudeThinkingTokens(
                reasoningEffort,
                modelId,
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
            ...(modelId ? ['-m', modelId] : []),
            '-c',
            `model_reasoning_effort=${mapReasoningEffortToCodex(reasoningEffort, modelId)}`,
            'exec',
            '-',
            '--sandbox',
            'read-only',
          ];
    const proc = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: shellExecEnv(),
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(timer);
      // ENOENT etc — surface a short message, never echo the prompt.
      reject(new Error(`${label} spawn failed: ${err.message.split('\n')[0].slice(0, 200)}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const tidy = extractCliFailureMessage(stdout, stderr);
      reject(new Error(`${label} exited ${code}: ${tidy}`));
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

/**
 * Extract and validate the `shipcode-prd` fenced block from a text blob.
 *
 * Uses line-by-line parsing instead of regex to avoid false-matching on
 * triple-backtick sequences embedded inside JSON string values. The closing
 * fence must be a standalone line of exactly ``` (trimmed). This assumes the
 * AI outputs compact JSON (newlines escaped as \n), so inner fences never
 * appear as standalone lines.
 */
export function extractPrd(text: string): GeneratedPrd {
  const openTag = `\`\`\`${PRD_FENCE_TAG}`;
  const lines = text.split('\n');
  let collecting = false;
  const captured: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!collecting) {
      // Match opening fence with optional trailing whitespace/indentation
      if (trimmed === openTag || trimmed.startsWith(`${openTag} `)) {
        collecting = true;
      }
      continue;
    }
    // Match closing fence (may be indented)
    if (trimmed === '```') break;
    captured.push(line);
  }

  if (!captured.length) {
    throw new Error(`No \`${PRD_FENCE_TAG}\` fenced block found in AI response`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(captured.join('\n').trim());
  } catch (err) {
    throw new Error(
      `Failed to parse PRD JSON inside \`${PRD_FENCE_TAG}\` block: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as Record<string, unknown>).body !== 'string'
  ) {
    throw new Error('PRD JSON is missing required `body` string key');
  }

  const body = (parsed as { body: string }).body;
  if (!body.trim()) throw new Error('PRD body is empty');

  return { body };
}
