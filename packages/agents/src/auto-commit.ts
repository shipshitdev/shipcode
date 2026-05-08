import { spawn } from 'node:child_process';
import type { ExecutorModel } from '@shipcode/shared';
import { OpenRouterClient, OpenRouterError } from './providers/openrouter-http';

export interface CommitGroup {
  files: string[];
  message: string;
}

export interface AutoCommitGenerateInput {
  provider?: ExecutorModel;
  apiKey?: string;
  model: string;
  cwd?: string;
  dirtyFiles: string[];
  diff: string;
  signal: AbortSignal;
  /** When 'single', skip splitting and produce one group covering all files. */
  mode?: 'split' | 'single';
}

export type AutoCommitGenerateResult =
  | { ok: true; groups: CommitGroup[]; fallbackUsed: boolean; modelUsed: string }
  | { ok: false; error: string };

const MAX_DIFF_CHARS = 120_000;
const MAX_DIRTY_FILES_FOR_SPLIT = 50;
const CLI_TIMEOUT_MS = 120_000;

const PROMPT_INSTRUCTIONS = `You are a senior engineer producing intent-based git commits from a working tree diff.

Output STRICT JSON, no prose, no markdown fences:
{ "groups": [ { "files": ["path/to/file"], "message": "<conventional commit subject + optional body>" } ] }

Rules:
- Use Conventional Commits ("feat:", "fix:", "chore:", "refactor:", "docs:", "test:", "build:", "ci:").
- Subject ≤ 72 chars. Body optional, separated by a blank line.
- Group files by intent. Unrelated changes go in different groups.
- Every dirty file MUST appear in exactly one group. No file may be omitted.
- No file may appear in more than one group.
- Use only file paths from the dirty list — never invent paths.
- Total length of any one message must not exceed 200 chars.`;

export async function generateCommitGroups(
  input: AutoCommitGenerateInput,
): Promise<AutoCommitGenerateResult> {
  if (input.dirtyFiles.length === 0) {
    return { ok: false, error: 'no dirty files' };
  }

  const dirtySet = new Set(input.dirtyFiles);
  const truncatedDiff =
    input.diff.length > MAX_DIFF_CHARS
      ? `${input.diff.slice(0, MAX_DIFF_CHARS)}\n[...truncated ${input.diff.length - MAX_DIFF_CHARS} chars...]`
      : input.diff;

  const forceSingle =
    input.mode === 'single' || input.dirtyFiles.length > MAX_DIRTY_FILES_FOR_SPLIT;

  if (forceSingle) {
    const message = await generateSingleMessage(input, truncatedDiff);
    if (!message.ok) return message;
    return {
      ok: true,
      groups: [{ files: [...input.dirtyFiles], message: message.message }],
      fallbackUsed: input.mode !== 'single',
      modelUsed: message.modelUsed,
    };
  }

  const userPrompt = buildSplitPrompt(input.dirtyFiles, truncatedDiff);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await generateText(input, PROMPT_INSTRUCTIONS, userPrompt);

      const parsed = parseAndValidate(result.content, dirtySet);
      if (parsed.ok) {
        return {
          ok: true,
          groups: parsed.groups,
          fallbackUsed: false,
          modelUsed: result.modelUsed,
        };
      }
      // fall through to retry
    } catch (err) {
      if (err instanceof OpenRouterError && err.kind === 'aborted') {
        return { ok: false, error: 'cancelled' };
      }
      if (attempt === 1) {
        // last attempt failed — fall through to single-commit fallback
        break;
      }
    }
  }

  // Fallback: single commit
  const single = await generateSingleMessage(input, truncatedDiff);
  if (!single.ok) return single;
  return {
    ok: true,
    groups: [{ files: [...input.dirtyFiles], message: single.message }],
    fallbackUsed: true,
    modelUsed: single.modelUsed,
  };
}

function buildSplitPrompt(dirtyFiles: string[], diff: string): string {
  return `Dirty files (${dirtyFiles.length}):\n${dirtyFiles.map((f) => `- ${f}`).join('\n')}\n\n=== UNIFIED DIFF ===\n${diff}`;
}

interface ParseSuccess {
  ok: true;
  groups: CommitGroup[];
}
interface ParseFailure {
  ok: false;
  reason: string;
}
type ParseResult = ParseSuccess | ParseFailure;

export function parseAndValidate(raw: string, dirtySet: Set<string>): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    return { ok: false, reason: `invalid JSON: ${(err as Error).message}` };
  }
  if (!parsed || typeof parsed !== 'object' || !('groups' in parsed)) {
    return { ok: false, reason: 'missing groups' };
  }
  const groups = (parsed as { groups: unknown }).groups;
  if (!Array.isArray(groups) || groups.length === 0) {
    return { ok: false, reason: 'groups empty' };
  }

  const seen = new Set<string>();
  const out: CommitGroup[] = [];
  for (const g of groups) {
    if (!g || typeof g !== 'object') return { ok: false, reason: 'group not object' };
    const files = (g as { files?: unknown }).files;
    const message = (g as { message?: unknown }).message;
    if (!Array.isArray(files) || files.length === 0) return { ok: false, reason: 'empty files' };
    if (typeof message !== 'string' || message.trim().length === 0) {
      return { ok: false, reason: 'empty message' };
    }
    if (message.length > 200) return { ok: false, reason: 'message too long' };
    for (const f of files) {
      if (typeof f !== 'string') return { ok: false, reason: 'non-string file' };
      if (!dirtySet.has(f)) return { ok: false, reason: `hallucinated file: ${f}` };
      if (seen.has(f)) return { ok: false, reason: `duplicate file: ${f}` };
      seen.add(f);
    }
    out.push({ files: [...files], message: message.trim() });
  }
  for (const f of dirtySet) {
    if (!seen.has(f)) return { ok: false, reason: `orphan file: ${f}` };
  }
  return { ok: true, groups: out };
}

/** Strip leading/trailing markdown fences if the model wrapped the JSON. */
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    const stripped = trimmed.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    return stripped.trim();
  }
  return trimmed;
}

async function generateSingleMessage(
  input: AutoCommitGenerateInput,
  diff: string,
): Promise<{ ok: true; message: string; modelUsed: string } | { ok: false; error: string }> {
  const sys =
    'Produce ONE Conventional Commits message for the entire diff. Output only the message, no fences, no JSON, no prose. Subject ≤ 72 chars. Body optional.';
  const user = `Files changed (${input.dirtyFiles.length}):\n${input.dirtyFiles.map((f) => `- ${f}`).join('\n')}\n\n=== DIFF ===\n${diff}`;
  try {
    const result = await generateText(input, sys, user);
    const message = result.content.trim();
    if (!message) {
      return {
        ok: true,
        message: `chore: update ${input.dirtyFiles.length} files`,
        modelUsed: result.modelUsed,
      };
    }
    return { ok: true, message, modelUsed: result.modelUsed };
  } catch (err) {
    if (err instanceof OpenRouterError && err.kind === 'aborted') {
      return { ok: false, error: 'cancelled' };
    }
    // Last-resort offline fallback
    return {
      ok: true,
      message: `chore: update ${input.dirtyFiles.length} files`,
      modelUsed: input.model,
    };
  }
}

async function generateText(
  input: AutoCommitGenerateInput,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ content: string; modelUsed: string }> {
  const provider = input.provider ?? 'openrouter';
  if (provider === 'openrouter') {
    if (!input.apiKey) throw new Error('OPENROUTER_API_KEY is not set');
    const client = new OpenRouterClient({ apiKey: input.apiKey });
    const result = await client.chat(
      {
        model: input.model,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      },
      input.signal,
    );
    return { content: result.content, modelUsed: result.model ?? input.model };
  }

  if (provider === 'claude') {
    return runClaudeText(input, systemPrompt, userPrompt);
  }

  if (provider === 'codex') {
    return runCodexText(input, systemPrompt, userPrompt);
  }

  throw new Error(`Auto-commit does not support ${provider}`);
}

function providerDefaultModel(provider: ExecutorModel): string {
  return provider;
}

function modelArg(input: AutoCommitGenerateInput): string | null {
  const provider = input.provider ?? 'openrouter';
  const trimmed = input.model.trim();
  if (!trimmed || trimmed === providerDefaultModel(provider)) return null;
  return trimmed;
}

function runClaudeText(
  input: AutoCommitGenerateInput,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ content: string; modelUsed: string }> {
  const selectedModel = modelArg(input);
  const args = ['-p'];
  if (selectedModel) args.push('--model', selectedModel);
  args.push('--output-format', 'text', '--max-turns', '1', '--dangerously-skip-permissions');
  return runCliText('claude', args, `${systemPrompt}\n\n${userPrompt}`, input);
}

function runCodexText(
  input: AutoCommitGenerateInput,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ content: string; modelUsed: string }> {
  const selectedModel = modelArg(input);
  const args = ['-a', 'never'];
  if (selectedModel) args.push('-m', selectedModel);
  args.push('-c', 'model_reasoning_effort=medium', 'exec', '-', '--sandbox', 'read-only');
  return runCliText(
    'codex',
    args,
    [
      'Return only the requested content. Do not inspect or modify files.',
      '',
      systemPrompt,
      '',
      userPrompt,
    ].join('\n'),
    input,
  );
}

function runCliText(
  command: 'claude' | 'codex',
  args: string[],
  prompt: string,
  input: AutoCommitGenerateInput,
): Promise<{ content: string; modelUsed: string }> {
  if (input.signal.aborted) {
    return Promise.reject(new OpenRouterError('aborted', 'aborted', false));
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: input.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal.removeEventListener('abort', abort);
      return true;
    };

    const settleSuccess = (value: { content: string; modelUsed: string }) => {
      if (settle()) resolve(value);
    };

    const settleError = (error: Error) => {
      if (settle()) reject(error);
    };

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      settleError(new Error(`${command} timed out while generating commit messages`));
    }, CLI_TIMEOUT_MS);

    const abort = () => {
      proc.kill('SIGTERM');
      settleError(new OpenRouterError('aborted', 'aborted', false));
    };

    input.signal.addEventListener('abort', abort, { once: true });
    proc.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    proc.on('error', settleError);
    proc.on('close', (code) => {
      if (code === 0) {
        settleSuccess({ content: stdout.trim(), modelUsed: modelArg(input) ?? command });
        return;
      }
      const message = stderr.trim().split('\n').filter(Boolean).slice(0, 3).join('\n');
      settleError(new Error(message || `${command} exited ${code}`));
    });
    proc.stdin.end(prompt);
  });
}
