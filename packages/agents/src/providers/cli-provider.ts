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

import { watch as fsWatch } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PLAN_FENCE_TAG, REVIEW_FENCE_TAG, VERIFICATION_FENCE_TAG } from '@shipcode/shared';
import { classifyPoolExhaustion, markPoolExhausted } from '../agent-sdk-pool-state';
import type { ProcessManager } from '../process-manager';
import { measurePromptPayload } from '../prompt-scope';
import { buildSandboxedClaudeExecuteCommand } from '../sandbox/srt';
import { StreamParser } from '../stream-parser';
import { awaitManagedProcess, type ManagedProcessResult } from './managed-process';
import { stripAnsi } from './output-summary';
import { mapReasoningEffortToClaudeThinkingTokens, mapReasoningEffortToCodex } from './reasoning';
import {
  type AgentProvider,
  PHASE_TOOL_POLICIES,
  type ProviderPhase,
  type ProviderRequest,
  type ProviderResponse,
} from './types';

interface CliRunResult extends ManagedProcessResult {
  /** The process manager cannot pipe stdin, so the run never started. */
  unavailable?: boolean;
}

const STDIN_SPAWN_UNAVAILABLE =
  'This process manager cannot pipe a prompt through stdin (no spawnWithStdin). ShipCode never passes a prompt as a CLI argument, so the run was not started.';
const SRT_POLICY_FAILURE =
  'srt sandbox policy setup failed. Verify sandbox settings, the worktree path, and temporary-directory permissions.';
const SRT_UNAVAILABLE =
  'srt sandbox unavailable. Install or reinstall @anthropic-ai/sandbox-runtime, or switch Claude execute to interactive.';
const SRT_SPAWN_FAILURE =
  'srt sandbox failed to start. Verify @anthropic-ai/sandbox-runtime and Claude CLI installation permissions.';

interface CliCommand {
  args: string[];
  stdin?: string;
  options?: Parameters<ProcessManager['spawn']>[5];
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

/**
 * Spawn a CLI via ProcessManager, accumulate output, wait for exit,
 * honoring the abort signal. Shared by both Claude and Codex providers.
 *
 * A prompt is ALWAYS piped through stdin. If the process manager cannot pipe
 * stdin, the run fails loudly instead of degrading to an argv prompt — the
 * Claude argparser reads `---` frontmatter (and any `--flag` inside a fenced
 * block) as unknown flags, and a failing CLI echoes the whole command line.
 * Mirrors the same guard in `stdin-cli-runner.ts`.
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
  projectPath?: string,
  options?: Parameters<ProcessManager['spawn']>[5],
  onProcessStart?: (processId: string) => void,
  // Spawn a different binary than `agentId` while keeping the process TYPE tag
  // as the agent (e.g. wrap `claude` inside the `srt` OS sandbox). The override
  // must be a ProcessManager-allowlisted command (resolved srt path).
  commandOverride?: string,
): Promise<CliRunResult> {
  if (signal.aborted) {
    return { rawOutput: '', exitCode: 130 };
  }

  const command = commandOverride ?? agentId;
  let process: ReturnType<ProcessManager['spawn']>;
  try {
    const spawnOptions = {
      ...(options ?? {}),
      ...(workspaceRoot !== undefined ? { workspaceRoot, projectPath } : {}),
    };
    if (stdin !== undefined) {
      const spawnWithStdin = (processManager as ProcessManagerWithStdin).spawnWithStdin;
      if (typeof spawnWithStdin !== 'function') {
        return { rawOutput: STDIN_SPAWN_UNAVAILABLE, exitCode: 1, unavailable: true };
      }
      process = spawnWithStdin.call(
        processManager,
        agentId,
        command,
        args,
        cwd,
        stdin,
        threadId,
        spawnOptions,
      );
    } else {
      process = processManager.spawn(agentId, command, args, cwd, threadId, spawnOptions);
    }
  } catch (err) {
    // ProcessManager synthesizes an exit event for missing binaries etc.
    // but if spawn() throws synchronously, surface that as exit 127.
    return {
      rawOutput: err instanceof Error ? err.message : String(err),
      exitCode: 127,
    };
  }
  onProcessStart?.(process.id);
  return awaitManagedProcess({ processManager, process, signal });
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
      /* v8 ignore next -- plan/revision/verify always have default disallowed tools */
      if (disallowedTools) args.push('--disallowedTools', disallowedTools.join(','));
      /* v8 ignore next -- only execute currently has default allowed tools */
      if (allowedTools) args.push('--allowedTools', allowedTools.join(','));
      injectThinkingTokens(args, req);
      return { args, stdin: req.prompt };
    }
    case 'execute': {
      const execArgs = ['-p', ...modelArgs, '--output-format', 'stream-json', '--verbose'];
      /* v8 ignore next -- execute always has default allowed tools */
      if (allowedTools) execArgs.push('--allowedTools', allowedTools.join(','));
      /* v8 ignore next -- execute normally has no disallowed tools unless explicitly configured */
      if (disallowedTools) execArgs.push('--disallowedTools', disallowedTools.join(','));
      // Safe ONLY because the execute branch in generate() always wraps this
      // command in the srt OS sandbox (buildSandboxedClaudeExecuteCommand) and
      // fails closed otherwise. Never spawn these args without that wrapper.
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
          'stream-json',
          '--verbose',
          '--max-turns',
          '1',
          '--dangerously-skip-permissions',
        ];
        /* v8 ignore next -- review has default disallowed tools */
        if (disallowedTools) args.push('--disallowedTools', disallowedTools.join(','));
        /* v8 ignore next -- review normally has no allowed tools unless explicitly configured */
        if (allowedTools) args.push('--allowedTools', allowedTools.join(','));
        return { args, stdin: req.prompt };
      }
  }
}

function buildClaudeArgs(req: ProviderRequest): string[] {
  return buildClaudeCommand(req).args;
}

function buildClaudeStdin(req: ProviderRequest): string {
  /* v8 ignore next -- all Claude phase commands carry stdin */
  return buildClaudeCommand(req).stdin ?? '';
}

function sanitizeProcessName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

const CLAUDE_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'XDG_RUNTIME_DIR',
  'ANTHROPIC_API_KEY',
] as const;

const CODEX_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'XDG_RUNTIME_DIR',
  'OPENAI_API_KEY',
] as const;

async function writeExecutePromptArtifact(req: ProviderRequest): Promise<string> {
  const runDir = path.join(req.cwd, '.shipcode', 'runs', req.threadId);
  await fs.mkdir(runDir, { recursive: true });
  const promptPath = path.join(runDir, `${req.phase}-prompt.md`);
  await fs.writeFile(promptPath, req.prompt, 'utf8');
  return promptPath;
}

function buildNativeExecutionGoal(promptArtifactPath: string): string {
  return [
    `/goal Read ${promptArtifactPath} and complete the ShipCode execution task it defines.`,
    'The goal is achieved only when every in-scope plan step and acceptance criterion is implemented,',
    'the verification permitted by the task and repository instructions has been run,',
    'and implementation-notes.md contains the reviewer-facing evidence.',
    'If a real blocker outside your authority prevents completion, document it in implementation-notes.md',
    'and report the blocker with concrete evidence instead of looping.',
  ].join(' ');
}

function withExecutionGoalContract(prompt: string): string {
  if (prompt.includes('<execution_goal>')) return prompt;
  return [
    '<execution_goal>',
    'Treat completion as a verifiable condition, not merely the end of one response.',
    'Do not finish until every in-scope plan step and acceptance criterion is implemented,',
    'the verification permitted by the task and repository instructions has been run,',
    'and implementation-notes.md contains the reviewer-facing evidence.',
    'If a real blocker outside your authority prevents completion, document it in implementation-notes.md',
    'and report the blocker with concrete evidence.',
    '</execution_goal>',
    '',
    prompt,
  ].join('\n');
}

async function buildClaudeInteractiveExecuteCommand(req: ProviderRequest): Promise<CliCommand> {
  const promptArtifactPath = await writeExecutePromptArtifact(req);
  const modelArgs = req.modelHint ? ['--model', req.modelHint] : [];
  const { allowedTools } = resolveToolPolicy(req);
  return {
    args: [
      '--permission-mode',
      'acceptEdits',
      '--tools',
      (allowedTools ?? PHASE_TOOL_POLICIES.execute.allowedTools ?? []).join(','),
      '--name',
      sanitizeProcessName(`shipcode-${req.threadId}`),
      ...modelArgs,
      buildNativeExecutionGoal(promptArtifactPath),
    ],
    options: { outputMode: 'raw' },
  };
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
  /* v8 ignore next -- all declared Codex phases have a default sandbox */
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
  /* v8 ignore next -- all Codex phase commands carry stdin */
  return buildCodexCommand(req).stdin ?? '';
}

async function buildCodexInteractiveExecuteCommand(req: ProviderRequest): Promise<CliCommand> {
  const promptArtifactPath = await writeExecutePromptArtifact(req);
  const defaultPolicy = PHASE_TOOL_POLICIES.execute;
  const sandbox = req.phaseHints?.sandbox ?? defaultPolicy.sandbox ?? 'workspace-write';
  const args = ['-s', sandbox, '-a', 'on-request', '--no-alt-screen'];
  if (req.modelHint) args.push('-m', req.modelHint);
  const effort = mapReasoningEffortToCodex(req.phaseHints?.reasoningEffort, req.modelHint);
  args.push('-c', `model_reasoning_effort=${effort}`);
  args.push(buildNativeExecutionGoal(promptArtifactPath));
  return { args, options: { outputMode: 'raw' } };
}

function buildCodexPrompt(req: ProviderRequest): string {
  // `codex exec` does not activate native `/goal` handling. Keep the
  // completion condition explicit in the prompt and let ShipCode's
  // verification/retry state machine provide cross-turn continuation.
  if (req.phase === 'execute') return withExecutionGoalContract(req.prompt);

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

/**
 * Path the agent writes its structured `shipcode-*` block to when a structured
 * phase runs interactively (no stream-json to parse). Lives in the gitignored
 * `.shipcode/runs/` scratch dir next to the prompt artifact.
 */
function phaseOutputArtifactPath(req: ProviderRequest): string {
  return path.join(req.cwd, '.shipcode', 'runs', req.threadId, `${req.phase}-output.md`);
}

async function preparePhaseOutputArtifact(req: ProviderRequest): Promise<string> {
  const outputPath = phaseOutputArtifactPath(req);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.rm(outputPath, { force: true });
  return outputPath;
}

/** The fenced tag a given structured phase is expected to emit. */
const PHASE_FENCE_TAG: Partial<Record<ProviderPhase, string>> = {
  plan: PLAN_FENCE_TAG,
  revision: PLAN_FENCE_TAG,
  review: REVIEW_FENCE_TAG,
  verify: VERIFICATION_FENCE_TAG,
};

const INTERACTIVE_STRUCTURED_PHASES: ReadonlySet<ProviderPhase> = new Set([
  'plan',
  'review',
  'revision',
  'verify',
]);

/** True when a structured phase is configured to run via the interactive CLI. */
function isInteractiveStructured(req: ProviderRequest): boolean {
  return req.phaseHints?.runMode === 'interactive' && INTERACTIVE_STRUCTURED_PHASES.has(req.phase);
}

/**
 * Instruction appended as the trailing CLI arg for interactive structured runs.
 * Imperative + last-sentence so the agent reliably (a) reads the prompt, (b)
 * writes ONLY the fenced block to the output file, (c) exits the REPL.
 */
function buildStructuredInstruction(
  promptPath: string,
  outputPath: string,
  fenceTag: string,
): string {
  return [
    `Read ${promptPath} and follow its instructions for the ShipCode task.`,
    `When you have your final answer, write ONLY the \`\`\`${fenceTag} fenced JSON block to ${outputPath} (no prose before or after it).`,
    `If you must ask a clarifying question instead, write the \`\`\`shipcode-clarification block to that same file.`,
    `After the file is written, run the command \`exit\` to end this session.`,
  ].join(' ');
}

async function buildClaudeInteractiveStructuredCommand(req: ProviderRequest): Promise<CliCommand> {
  const promptArtifactPath = await writeExecutePromptArtifact(req);
  const outputPath = await preparePhaseOutputArtifact(req);
  const modelArgs = req.modelHint ? ['--model', req.modelHint] : [];
  const fenceTag = PHASE_FENCE_TAG[req.phase] ?? PLAN_FENCE_TAG;
  // plan/revision may inspect the repo to ground their output; review/verify
  // only need to read the prompt and write the result.
  const tools =
    req.phase === 'plan' || req.phase === 'revision' ? 'Read,Write,Glob,Grep' : 'Read,Write';
  return {
    args: [
      '--permission-mode',
      'acceptEdits',
      '--tools',
      tools,
      '--name',
      sanitizeProcessName(`shipcode-${req.threadId}-${req.phase}`),
      ...modelArgs,
      buildStructuredInstruction(promptArtifactPath, outputPath, fenceTag),
    ],
    options: { outputMode: 'raw' },
  };
}

async function buildCodexInteractiveStructuredCommand(req: ProviderRequest): Promise<CliCommand> {
  const promptArtifactPath = await writeExecutePromptArtifact(req);
  const outputPath = await preparePhaseOutputArtifact(req);
  const fenceTag = PHASE_FENCE_TAG[req.phase] ?? PLAN_FENCE_TAG;
  // workspace-write is required so the agent can write the output artifact —
  // read-only would block the write. Mirrors the interactive execute posture.
  const args = ['-s', 'workspace-write', '-a', 'on-request', '--no-alt-screen'];
  if (req.modelHint) args.push('-m', req.modelHint);
  const effort = mapReasoningEffortToCodex(req.phaseHints?.reasoningEffort, req.modelHint);
  args.push('-c', `model_reasoning_effort=${effort}`);
  args.push(buildStructuredInstruction(promptArtifactPath, outputPath, fenceTag));
  return { args, options: { outputMode: 'raw' } };
}

/**
 * Read the structured output artifact after an interactive run, with a short
 * grace window for filesystem flush. Returns null if nothing is written
 * (caller falls back to the raw PTY transcript).
 */
async function readPhaseOutputArtifact(
  outputPath: string,
  signal: AbortSignal,
): Promise<string | null> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (signal.aborted) return null;
    try {
      const content = await fs.readFile(outputPath, 'utf8');
      if (content.trim()) return content;
    } catch {
      // not written yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

/**
 * Run an interactive structured command: spawn via runCli, and in parallel
 * watch for the output artifact. Once it appears, nudge the REPL to exit (the
 * agent is also told to `exit`, so this is a backstop). Completion is still the
 * process exit; the stall watchdog remains the final timeout backstop.
 */
async function runInteractiveStructured(
  processManager: ProcessManager,
  agentId: 'claude' | 'codex',
  command: CliCommand,
  req: ProviderRequest,
  outputPath: string,
  envKeys: readonly string[],
): Promise<CliRunResult> {
  let watcher: ReturnType<typeof fsWatch> | undefined;
  let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let capturedId: string | undefined;

  const tryNudgeExit = async (): Promise<void> => {
    if (finished || nudgeTimer || !capturedId) return;
    try {
      const content = await fs.readFile(outputPath, 'utf8');
      if (!content.trim()) return;
    } catch {
      return; // not written yet
    }
    const processId = capturedId;
    nudgeTimer = setTimeout(() => {
      const pm = processManager as ProcessManager & { write?: (id: string, data: string) => void };
      try {
        pm.write?.(processId, '/exit\n');
      } catch {
        // process may already be exiting
      }
    }, 600);
  };

  const composedOnStart = (processId: string) => {
    capturedId = processId;
    req.onProcessStart?.(processId);
    const dir = path.dirname(outputPath);
    const base = path.basename(outputPath);
    try {
      watcher = fsWatch(dir, { persistent: false }, (_event, filename) => {
        if (filename && filename.toString() !== base) return;
        void tryNudgeExit();
      });
    } catch {
      // directory missing briefly — the post-exit read still covers it
    }
    void tryNudgeExit();
  };

  try {
    return await runCli(
      processManager,
      agentId,
      command.args,
      command.stdin,
      req.cwd,
      req.signal,
      req.threadId,
      req.workspaceRoot,
      req.projectPath,
      { ...(command.options ?? {}), envKeyAllowlist: [...envKeys] },
      composedOnStart,
    );
  } finally {
    finished = true;
    if (nudgeTimer) clearTimeout(nudgeTimer);
    try {
      watcher?.close();
    } catch {
      // already closed
    }
  }
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
      // Interactive structured phases (plan/review/revision/verify) bridge
      // their machine-readable output through a written file artifact instead
      // of stream-json, so they avoid the rationed `claude -p` pool while
      // staying parseable downstream. rawOutput carries the artifact contents
      // (or the raw transcript as a fallback) so the pipeline's existing
      // StreamParser path needs no changes.
      if (isInteractiveStructured(req)) {
        const structuredCommand = await buildClaudeInteractiveStructuredCommand(req);
        const outputPath = phaseOutputArtifactPath(req);
        const structuredResult = await runInteractiveStructured(
          processManager,
          'claude',
          structuredCommand,
          req,
          outputPath,
          CLAUDE_ENV_KEYS,
        );
        const artifact = await readPhaseOutputArtifact(outputPath, req.signal);
        const raw = artifact ?? StreamParser.stripSystemEvents(structuredResult.rawOutput);
        const structuredParser = new StreamParser();
        structuredParser.feed(raw);
        const structuredClarification = structuredParser.extractClarificationRequest();
        const transcriptParser = new StreamParser();
        transcriptParser.feed(structuredResult.rawOutput);
        const resolvedModel = transcriptParser.extractModel() ?? structuredParser.extractModel();
        return {
          rawOutput: raw,
          exitCode: structuredResult.exitCode,
          ...(resolvedModel ? { resolvedModel } : {}),
          promptTelemetry,
          ...(structuredClarification.success && structuredClarification.data
            ? { clarificationRequest: structuredClarification.data }
            : {}),
          ...(structuredResult.exitCode === 127
            ? {
                providerError: {
                  kind: 'binary_missing' as const,
                  message: 'claude CLI not found on PATH',
                  retryable: false,
                },
              }
            : structuredResult.exitCode === 130
              ? {
                  providerError: {
                    kind: 'aborted' as const,
                    message: 'aborted',
                    retryable: false,
                  },
                }
              : {}),
        };
      }
      // `interactive` is true only when this run avoids the `claude -p` path
      // entirely (interactive subscription seat, not the programmatic path).
      const interactive = req.phaseHints?.runMode === 'interactive' && req.phase === 'execute';

      // Resolve the command. Programmatic claude EXECUTE grants host
      // Edit/Write/Bash with no built-in OS sandbox, so it is REQUIRED to run
      // inside the `srt` OS sandbox (Seatbelt/bubblewrap). If the sandbox is
      // disabled (no osSandbox hint) or unavailable (srt not resolvable), it
      // fails closed — it is never run unsandboxed. Programmatic structured
      // phases (plan/review/verify) are tool-less, so they skip this.
      let command: CliCommand;
      let commandOverride: string | undefined;
      let sandboxCleanup: (() => Promise<void>) | undefined;
      if (req.phase === 'execute' && !interactive) {
        const osSandbox = req.phaseHints?.osSandbox;
        if (osSandbox?.backend !== 'srt') {
          return {
            rawOutput:
              'Programmatic Claude execute requires the OS sandbox (srt), which is disabled. Enable claudeExecuteSandboxEnabled, switch this phase to interactive, or use codex (sandboxed via codex exec).',
            exitCode: 1,
            promptTelemetry,
            providerError: {
              kind: 'unexpected_stop',
              message: 'programmatic Claude execute requires the OS sandbox',
              retryable: false,
            },
          };
        }
        const promptArtifactPath = await writeExecutePromptArtifact(req);
        const inner = buildClaudeCommand({
          ...req,
          prompt: buildNativeExecutionGoal(promptArtifactPath),
        });
        let sandboxed: Awaited<ReturnType<typeof buildSandboxedClaudeExecuteCommand>>;
        try {
          sandboxed = await buildSandboxedClaudeExecuteCommand({
            worktreePath: req.cwd,
            innerClaudeArgs: inner.args,
            networkPolicy: osSandbox.networkPolicy,
            extraWritePaths: osSandbox.extraWritePaths,
          });
        } catch {
          // Policy errors may contain local paths or caller-controlled values.
          // Return a fixed, bounded diagnostic and never attempt an unsandboxed
          // fallback or expose the prompt/credentials through rawOutput.
          return {
            rawOutput: SRT_POLICY_FAILURE,
            exitCode: 1,
            promptTelemetry,
            providerError: {
              kind: 'unexpected_stop',
              message: SRT_POLICY_FAILURE,
              retryable: false,
            },
          };
        }
        if (!sandboxed) {
          return {
            rawOutput: SRT_UNAVAILABLE,
            exitCode: 127,
            promptTelemetry,
            providerError: {
              kind: 'binary_missing',
              message: SRT_UNAVAILABLE,
              retryable: false,
            },
          };
        }
        command = { args: sandboxed.args, stdin: inner.stdin };
        commandOverride = sandboxed.command;
        sandboxCleanup = sandboxed.cleanup;
        // Remove the policy file promptly on abort instead of waiting out
        // runCli's kill grace window. fs.rm(force) is idempotent, so the
        // finally below double-calling cleanup is harmless.
        req.signal.addEventListener('abort', () => void sandboxCleanup?.(), { once: true });
      } else {
        command = interactive
          ? await buildClaudeInteractiveExecuteCommand(req)
          : buildClaudeCommand(req);
      }

      let result: CliRunResult;
      try {
        result = await runCli(
          processManager,
          'claude',
          command.args,
          command.stdin,
          req.cwd,
          req.signal,
          req.threadId,
          req.workspaceRoot,
          req.projectPath,
          { ...(command.options ?? {}), envKeyAllowlist: [...CLAUDE_ENV_KEYS] },
          req.onProcessStart,
          commandOverride,
        );
      } finally {
        if (sandboxCleanup) await sandboxCleanup();
      }
      if (result.unavailable) {
        return {
          rawOutput: STDIN_SPAWN_UNAVAILABLE,
          exitCode: result.exitCode,
          promptTelemetry,
          providerError: {
            kind: 'unexpected_stop',
            message: STDIN_SPAWN_UNAVAILABLE,
            retryable: false,
          },
        };
      }
      if (commandOverride && result.exitCode === 127) {
        // A synchronous ProcessManager spawn error can carry arbitrary local
        // exception text. Keep the sandbox launch failure actionable without
        // forwarding prompt or secret material from that error.
        return {
          rawOutput: SRT_SPAWN_FAILURE,
          exitCode: result.exitCode,
          promptTelemetry,
          providerError: {
            kind: 'binary_missing',
            message: SRT_SPAWN_FAILURE,
            retryable: false,
          },
        };
      }
      const parser = new StreamParser();
      parser.feed(result.rawOutput);
      const usage = parser.extractUsage();
      const clarification = parser.extractClarificationRequest();
      const resolvedModel = parser.extractModel();
      // Detect Agent-SDK credit-pool exhaustion on the programmatic (`-p`)
      // path. There is no balance API, so we infer it from the failure and
      // flag it process-wide; the pipeline then falls back to interactive.
      const poolExhausted =
        !interactive && classifyPoolExhaustion(result.rawOutput, '', result.exitCode);
      if (poolExhausted) {
        markPoolExhausted('Claude Agent-SDK credit pool exhausted');
      }
      const providerError = poolExhausted
        ? {
            kind: 'agent_sdk_pool_exhausted' as const,
            message:
              'Claude Agent-SDK credit pool exhausted — switch this phase to interactive run mode.',
            retryable: false,
          }
        : result.exitCode === 127
          ? {
              kind: 'binary_missing' as const,
              message: 'claude CLI not found on PATH',
              retryable: false,
            }
          : result.exitCode === 130
            ? { kind: 'aborted' as const, message: 'aborted', retryable: false }
            : undefined;
      return {
        rawOutput: StreamParser.stripSystemEvents(result.rawOutput),
        exitCode: result.exitCode,
        ...(resolvedModel ? { resolvedModel } : {}),
        promptTelemetry,
        /* v8 ignore start -- stream parser extraction is covered directly; provider only forwards parsed metadata */
        ...(usage
          ? {
              tokensUsed: { prompt: usage.inputTokens, completion: usage.outputTokens },
              costUsd: usage.costUsd,
            }
          : {}),
        ...(clarification.success && clarification.data
          ? { clarificationRequest: clarification.data }
          : {}),
        /* v8 ignore stop */
        ...(providerError ? { providerError } : {}),
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
        selectedMaterials: req.promptMaterialSummary,
      };
      // Interactive structured phases bridge output through a written file
      // artifact (see the claude provider for the rationale). Codex has no
      // rationed pool, but this keeps run-mode behavior symmetric so a project
      // can run the whole pipeline through the interactive CLI.
      if (isInteractiveStructured(req)) {
        const structuredCommand = await buildCodexInteractiveStructuredCommand(req);
        const outputPath = phaseOutputArtifactPath(req);
        const structuredResult = await runInteractiveStructured(
          processManager,
          'codex',
          structuredCommand,
          req,
          outputPath,
          CODEX_ENV_KEYS,
        );
        const artifact = await readPhaseOutputArtifact(outputPath, req.signal);
        const raw =
          artifact ??
          stripCodexProtocol(structuredResult.rawOutput, { includeCommandOutput: false });
        const structuredParser = new StreamParser();
        structuredParser.feed(raw);
        const structuredClarification = structuredParser.extractClarificationRequest();
        return {
          rawOutput: raw,
          exitCode: structuredResult.exitCode,
          resolvedModel: req.modelHint ?? 'codex',
          promptTelemetry,
          ...(structuredClarification.success && structuredClarification.data
            ? { clarificationRequest: structuredClarification.data }
            : {}),
          ...(structuredResult.exitCode === 127
            ? {
                providerError: {
                  kind: 'binary_missing' as const,
                  message: 'codex CLI not found on PATH',
                  retryable: false,
                },
              }
            : structuredResult.exitCode === 130
              ? {
                  providerError: {
                    kind: 'aborted' as const,
                    message: 'aborted',
                    retryable: false,
                  },
                }
              : {}),
        };
      }
      const command =
        req.phase === 'execute' && req.phaseHints?.runMode === 'interactive'
          ? await buildCodexInteractiveExecuteCommand(req)
          : buildCodexCommand(req);
      const result = await runCli(
        processManager,
        'codex',
        command.args,
        command.stdin,
        req.cwd,
        req.signal,
        req.threadId,
        req.workspaceRoot,
        req.projectPath,
        { ...(command.options ?? {}), envKeyAllowlist: [...CODEX_ENV_KEYS] },
        req.onProcessStart,
      );
      if (result.unavailable) {
        return {
          rawOutput: STDIN_SPAWN_UNAVAILABLE,
          exitCode: result.exitCode,
          resolvedModel: req.modelHint ?? 'codex',
          promptTelemetry,
          providerError: {
            kind: 'unexpected_stop',
            message: STDIN_SPAWN_UNAVAILABLE,
            retryable: false,
          },
        };
      }
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
  buildNativeExecutionGoal,
  withExecutionGoalContract,
  buildClaudeInteractiveStructuredCommand,
  buildCodexInteractiveStructuredCommand,
  buildStructuredInstruction,
  phaseOutputArtifactPath,
  isInteractiveStructured,
  readPhaseOutputArtifact,
  stripCodexProtocol,
};
