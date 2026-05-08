/**
 * CLI providers wrapping the existing claude/codex subprocess path.
 *
 * Prompts are piped through stdin instead of passed as argv. That keeps
 * large issue bodies and YAML-frontmatter skills out of CLI argument
 * parsing while preserving the existing provider lifecycle.
 *
 * The provider also keeps the process lifecycle contained here: spawn,
 * accumulate terminal output, wait for exit, then return one result to the
 * pipeline's phase-specific completion logic.
 */

import type { ProcessManager } from '../process-manager';
import { measurePromptPayload } from '../prompt-scope';
import { StreamParser } from '../stream-parser';
import { stripAnsi } from './output-summary';
import { mapReasoningEffortToClaudeThinkingTokens, mapReasoningEffortToCodex } from './reasoning';
import {
  type AgentProvider,
  PHASE_TOOL_POLICIES,
  type ProviderPhase,
  type ProviderRequest,
  type ProviderResponse,
} from './types';

interface CliRunResult {
  rawOutput: string;
  exitCode: number;
}

interface CliCommand {
  args: string[];
  stdin?: string;
}

type ProcessManagerWithStdin = ProcessManager & {
  spawnWithStdin?: (
    type: 'claude' | 'codex',
    command: string,
    args: string[],
    cwd: string,
    input: string,
    threadId?: string,
    options?: Parameters<ProcessManager['spawn']>[5],
  ) => ReturnType<ProcessManager['spawn']>;
};

function materializeStdinArgsForLegacySpawn(args: string[], stdin?: string): string[] {
  if (stdin === undefined) return args;
  const promptFlagIndex = args.indexOf('-p');
  if (promptFlagIndex !== -1 && args[promptFlagIndex + 1] === '-') {
    return args.map((arg, index) => (index === promptFlagIndex + 1 ? stdin : arg));
  }
  if (promptFlagIndex !== -1) {
    return [...args.slice(0, promptFlagIndex + 1), stdin, ...args.slice(promptFlagIndex + 1)];
  }
  const execIndex = args.indexOf('exec');
  if (execIndex !== -1 && args[execIndex + 1] === '-') {
    return args.map((arg, index) => (index === execIndex + 1 ? stdin : arg));
  }
  return args;
}

/**
 * Spawn a CLI via ProcessManager, accumulate output, wait for exit,
 * honoring the abort signal. Shared by both Claude and Codex providers.
 */
async function runCli(
  processManager: ProcessManager,
  agentId: 'claude' | 'codex',
  args: string[],
  stdin: string | undefined,
  cwd: string,
  signal: AbortSignal,
  threadId?: string,
  workspaceRoot?: string | null,
): Promise<CliRunResult> {
  if (signal.aborted) {
    return { rawOutput: '', exitCode: 130 };
  }

  let process: ReturnType<ProcessManager['spawn']>;
  try {
    const spawnOptions = workspaceRoot !== undefined ? { workspaceRoot } : {};
    const processManagerWithStdin = processManager as ProcessManagerWithStdin;
    if (stdin !== undefined && processManagerWithStdin.spawnWithStdin) {
      process = processManagerWithStdin.spawnWithStdin(
        agentId,
        agentId,
        args,
        cwd,
        stdin,
        threadId,
        spawnOptions,
      );
    } else {
      process = processManager.spawn(
        agentId,
        agentId,
        materializeStdinArgsForLegacySpawn(args, stdin),
        cwd,
        threadId,
        spawnOptions,
      );
    }
  } catch (err) {
    // ProcessManager synthesizes an exit event for missing binaries etc.
    // but if spawn() throws synchronously, surface that as exit 127.
    return {
      rawOutput: err instanceof Error ? err.message : String(err),
      exitCode: 127,
    };
  }

  return new Promise<CliRunResult>((resolve) => {
    let rawOutput = '';
    let settled = false;

    const cleanup = () => {
      processManager.removeListener('output', outputHandler);
      processManager.removeListener('exit', exitHandler);
      signal.removeEventListener('abort', abortHandler);
    };

    const settle = (result: CliRunResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const outputHandler = (processId: string, data: string) => {
      if (processId === process.id) rawOutput += data;
    };

    const exitHandler = (processId: string, exitCode: number) => {
      if (processId !== process.id) return;
      settle({ rawOutput, exitCode });
    };

    const abortHandler = () => {
      try {
        processManager.kill(process.id);
      } catch {
        // kill may fail if process already exited; exit handler will settle.
      }
      // Don't settle here — let the subsequent exit event carry the exitCode.
      // If no exit fires within a short grace window, force-settle with 130.
      setTimeout(() => {
        if (!settled) settle({ rawOutput, exitCode: 130 });
      }, 2000);
    };

    processManager.on('output', outputHandler);
    processManager.on('exit', exitHandler);
    signal.addEventListener('abort', abortHandler, { once: true });
  });
}

/**
 * Resolve the tool policy for a phase. Explicit phaseHints override the
 * declarative defaults so callers can customize per-run.
 */
function resolveToolPolicy(req: ProviderRequest) {
  const defaults = PHASE_TOOL_POLICIES[req.phase];
  return {
    allowedTools: req.phaseHints?.allowedTools ?? defaults.allowedTools,
    disallowedTools: req.phaseHints?.disallowedTools ?? defaults.disallowedTools,
  };
}

function injectThinkingTokens(args: string[], req: ProviderRequest): void {
  const tokens = mapReasoningEffortToClaudeThinkingTokens(
    req.phaseHints?.reasoningEffort,
    req.modelHint,
  );
  if (tokens !== null) {
    args.splice(
      args.indexOf('--dangerously-skip-permissions'),
      0,
      '--max-thinking-tokens',
      String(tokens),
    );
  }
}

/** Build claude CLI args/stdin for a given phase. */
function buildClaudeCommand(req: ProviderRequest): CliCommand {
  const modelArgs = req.modelHint ? ['--model', req.modelHint] : [];
  const { allowedTools, disallowedTools } = resolveToolPolicy(req);

  switch (req.phase) {
    case 'plan':
    case 'revision':
    case 'verify': {
      const maxTurns = String(req.phaseHints?.maxTurns ?? 1);
      const args = [
        '-p',
        ...modelArgs,
        '--output-format',
        'stream-json',
        '--verbose',
        '--max-turns',
        maxTurns,
        '--dangerously-skip-permissions',
      ];
      if (disallowedTools) args.push('--disallowedTools', disallowedTools.join(','));
      if (allowedTools) args.push('--allowedTools', allowedTools.join(','));
      injectThinkingTokens(args, req);
      return { args, stdin: req.prompt };
    }
    case 'execute': {
      const execArgs = ['-p', ...modelArgs];
      if (allowedTools) execArgs.push('--allowedTools', allowedTools.join(','));
      if (disallowedTools) execArgs.push('--disallowedTools', disallowedTools.join(','));
      execArgs.push('--dangerously-skip-permissions');
      injectThinkingTokens(execArgs, req);
      return { args: execArgs, stdin: req.prompt };
    }
    case 'review': // Claude does not review in the current pipeline (codex does).
      // Kept for symmetry; always 1 turn (structural, not configurable).
      {
        const args = [
          '-p',
          ...modelArgs,
          '--output-format',
          'json',
          '--max-turns',
          '1',
          '--dangerously-skip-permissions',
        ];
        if (disallowedTools) args.push('--disallowedTools', disallowedTools.join(','));
        if (allowedTools) args.push('--allowedTools', allowedTools.join(','));
        return { args, stdin: req.prompt };
      }
  }
}

function buildClaudeArgs(req: ProviderRequest): string[] {
  return buildClaudeCommand(req).args;
}

function buildClaudeStdin(req: ProviderRequest): string {
  return buildClaudeCommand(req).stdin ?? '';
}

/**
 * Build codex CLI args for a given phase.
 *
 * codex v0.120.0 layout: top-level flags come BEFORE the `exec` subcommand,
 * and the subcommand's own flags (`--sandbox`, `--json`) go after the prompt.
 *
 *   codex [-a never] [-c model_reasoning_effort=high] exec - --sandbox <level> --json
 *
 * The prompt itself is piped through stdin. Keeping the prompt out of argv
 * avoids shell/arg length limits and keeps logs from accidentally echoing
 * full issue bodies.
 */
function buildCodexCommand(req: ProviderRequest): CliCommand {
  const defaultPolicy = PHASE_TOOL_POLICIES[req.phase];
  const sandbox = req.phaseHints?.sandbox ?? defaultPolicy.sandbox ?? 'read-only';
  const topLevelFlags: string[] = ['-a', 'never'];
  if (req.modelHint) topLevelFlags.push('-m', req.modelHint);
  // Default to high reasoning so thinking output is always visible in the terminal.
  const effort = mapReasoningEffortToCodex(req.phaseHints?.reasoningEffort, req.modelHint);
  topLevelFlags.push('-c', `model_reasoning_effort=${effort}`);
  return {
    args: [...topLevelFlags, 'exec', '-', '--sandbox', sandbox, '--json'],
    stdin: buildCodexPrompt(req),
  };
}

function buildCodexArgs(req: ProviderRequest): string[] {
  return buildCodexCommand(req).args;
}

function buildCodexStdin(req: ProviderRequest): string {
  return buildCodexCommand(req).stdin ?? '';
}

function buildCodexPrompt(req: ProviderRequest): string {
  if (req.phase === 'execute') return req.prompt;

  // Plan and revision phases need to ground their output in the real repo
  // (per plan-generation skill: walk codebase, cite real file paths, reuse
  // real helpers). The sandbox is already read-only, so file reads are safe.
  // Review and verify phases analyze provided text and stay prompt-only to
  // keep token spend predictable.
  const allowInspection = req.phase === 'plan' || req.phase === 'revision';

  const lines = [
    'ShipCode structured-output mode.',
    ...(allowInspection
      ? [
          'You may read files in the working directory to ground your output, but do not run shell commands beyond read-only inspection.',
        ]
      : [
          'Do not run shell commands, inspect files, or use tools in this phase.',
          'Use only the prompt content below.',
        ]),
    'Return only the requested fenced shipcode-* JSON block. Do not include prose or any other fenced blocks.',
    '',
    req.prompt,
  ];
  return lines.join('\n');
}

export function createClaudeCliProvider(processManager: ProcessManager): AgentProvider {
  return {
    id: 'claude-cli',
    supports: new Set<ProviderPhase>(['plan', 'review', 'revision', 'verify', 'execute']),
    async generate(req: ProviderRequest): Promise<ProviderResponse> {
      const promptTelemetry = {
        phase: req.phase,
        promptSize: measurePromptPayload(req.prompt),
        ...(req.promptMaterialSummary ? { selectedMaterials: req.promptMaterialSummary } : {}),
      };
      const command = buildClaudeCommand(req);
      const result = await runCli(
        processManager,
        'claude',
        command.args,
        command.stdin,
        req.cwd,
        req.signal,
        req.threadId,
        req.workspaceRoot,
      );
      const parser = new StreamParser();
      parser.feed(result.rawOutput);
      const usage = parser.extractUsage();
      const clarification = parser.extractClarificationRequest();
      return {
        rawOutput: StreamParser.stripSystemEvents(result.rawOutput),
        exitCode: result.exitCode,
        resolvedModel: parser.extractModel() ?? 'claude',
        promptTelemetry,
        ...(usage
          ? {
              tokensUsed: { prompt: usage.inputTokens, completion: usage.outputTokens },
              costUsd: usage.costUsd,
            }
          : {}),
        ...(clarification.success && clarification.data
          ? { clarificationRequest: clarification.data }
          : {}),
        ...(result.exitCode === 127
          ? {
              providerError: {
                kind: 'binary_missing' as const,
                message: 'claude CLI not found on PATH',
                retryable: false,
              },
            }
          : result.exitCode === 130
            ? { providerError: { kind: 'aborted' as const, message: 'aborted', retryable: false } }
            : {}),
      };
    },
    async healthCheck() {
      // Healthcheck for the CLI provider is handled by the existing
      // health-check module (checkClaudeAuth). This stub keeps the
      // provider interface uniform.
      return { ok: true };
    },
  };
}

export function createCodexCliProvider(processManager: ProcessManager): AgentProvider {
  return {
    id: 'codex-cli',
    supports: new Set<ProviderPhase>(['plan', 'review', 'revision', 'verify', 'execute']),
    async generate(req: ProviderRequest): Promise<ProviderResponse> {
      const promptTelemetry = {
        phase: req.phase,
        promptSize: measurePromptPayload(req.prompt),
        ...(req.promptMaterialSummary ? { selectedMaterials: req.promptMaterialSummary } : {}),
      };
      const command = buildCodexCommand(req);
      const result = await runCli(
        processManager,
        'codex',
        command.args,
        command.stdin,
        req.cwd,
        req.signal,
        req.threadId,
        req.workspaceRoot,
      );
      const rawOutput = stripCodexProtocol(result.rawOutput, {
        includeCommandOutput: req.phase === 'execute',
      });
      const usageParser = new StreamParser();
      usageParser.feed(result.rawOutput);
      const usage = usageParser.extractUsage();
      const outputParser = new StreamParser();
      outputParser.feed(rawOutput);
      const clarification = outputParser.extractClarificationRequest();
      const ndjsonParser = new StreamParser();
      ndjsonParser.feed(result.rawOutput);
      const resolvedModel = ndjsonParser.extractCodexModel() ?? req.modelHint ?? 'codex';
      return {
        rawOutput,
        exitCode: result.exitCode,
        resolvedModel,
        promptTelemetry,
        ...(usage
          ? {
              tokensUsed: { prompt: usage.inputTokens, completion: usage.outputTokens },
              costUsd: usage.costUsd,
            }
          : {}),
        ...(clarification.success && clarification.data
          ? { clarificationRequest: clarification.data }
          : {}),
        ...(result.exitCode === 127
          ? {
              providerError: {
                kind: 'binary_missing' as const,
                message: 'codex CLI not found on PATH',
                retryable: false,
              },
            }
          : result.exitCode === 130
            ? { providerError: { kind: 'aborted' as const, message: 'aborted', retryable: false } }
            : {}),
      };
    },
    async healthCheck() {
      return { ok: true };
    },
  };
}

/**
 * Extract human-readable text from Codex NDJSON protocol output.
 *
 * Codex `--json` mode emits one JSON object per line with types like
 * `thread.started`, `item.completed`, `turn.completed`, etc. The
 * pipeline stores `rawOutput` for display in the error panel — raw
 * NDJSON is unreadable, so we extract agent messages and command
 * output into a plain-text summary.
 */
function stripCodexProtocol(raw: string, options: { includeCommandOutput?: boolean } = {}): string {
  const includeCommandOutput = options.includeCommandOutput ?? true;
  const lines: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Not JSON — keep as-is (e.g. non-JSON stderr lines)
      lines.push(trimmed);
      continue;
    }
    const item = parsed.item as Record<string, unknown> | undefined;
    if (!item) {
      // Codex protocol events have a string `type` field (e.g. "thread.started").
      // Non-protocol JSON (plan/review/verification blocks) lacks it — keep those.
      if (typeof parsed.type !== 'string') lines.push(trimmed);
      continue;
    }
    if (item.type === 'agent_message' && typeof item.text === 'string') {
      lines.push(item.text);
    } else if (item.type === 'command_execution' && includeCommandOutput) {
      const cmd = item.command as string | undefined;
      const output =
        typeof item.aggregated_output === 'string'
          ? stripAnsi(item.aggregated_output).trimEnd()
          : undefined;
      const exitCode = item.exit_code as number | null | undefined;
      if (cmd) lines.push(`$ ${cmd}`);
      if (output) lines.push(output.trimEnd());
      if (exitCode != null && exitCode !== 0) lines.push(`[exit ${exitCode}]`);
    }
  }
  return lines.join('\n');
}

/**
 * Exported for unit testing (snapshot regression against pipeline.ts).
 *
 * @knipignore
 */
export const _internals = {
  buildClaudeArgs,
  buildClaudeStdin,
  buildCodexArgs,
  buildCodexStdin,
  buildCodexPrompt,
  materializeStdinArgsForLegacySpawn,
  stripCodexProtocol,
};
