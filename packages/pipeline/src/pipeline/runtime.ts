import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  formatPlanComment,
  GhCli,
  isPoolExhausted,
  loadRepoSetupContract,
  measurePhasePromptTelemetry,
  type PromptMaterial,
  type ProviderPhase,
  type ProviderRequest,
  toPersistedPromptTelemetryMaterials,
} from '@shipcode/agents/source';
import {
  type AppSettings,
  isPipelineStateLabel,
  isRealGithubIssueNumber,
  macroColumnForStatus,
  type ProviderRunMode,
  pipelineLabelForStatus,
} from '@shipcode/shared';
import {
  formatTaskGraphChecklist,
  formatTaskNodeIssueBody,
  TASK_GRAPH_COMMENT_MARKER,
  type TaskGraphWithNodes,
} from '@shipcode/shared/source';
import { GhSyncQueue, type GhSyncWriteOpts } from '../gh-sync-queue';
import { syncThreadAndIssuePhase } from '../phase-sync';
import type {
  OrchestratorState,
  PhasePayload,
  PipelineContext,
  PipelineDeps,
  PipelineExecutorModel,
  ProviderPhaseDeltas,
} from '../types';
import type { PipelineContextHelpers, PipelineRuntime } from './shared';

const execFileAsync = promisify(execFile);

/**
 * Resolve the configured run mode (interactive vs programmatic) for a given
 * agent + pipeline phase from settings. Every provider phase now carries its
 * own selectable run mode (defaults to interactive so phases avoid the
 * rationed `claude -p` Agent-SDK credit pool); programmatic remains opt-in.
 */
function getAgentPhaseRunMode(
  settings: AppSettings,
  agent: 'claude' | 'codex',
  phase: ProviderPhase,
): ProviderRunMode {
  return settings.agentRunModes[agent][phase];
}

/**
 * Build a fallback install command when a frozen-lockfile install fails
 * because of lockfile drift or a manifest/lockfile mismatch. Returns
 * null when the failure signature doesn't match a known fallback case
 * — the original error stands.
 */
export function buildFrozenInstallFallback(command: string, output: string): string | null {
  const trimmed = command.trim();
  // bun install --frozen-lockfile
  if (/^bun\s+install\s+.*--frozen-lockfile/.test(trimmed)) {
    if (/lockfile|resolution|min[- ]release[- ]age|version mismatch/i.test(output)) {
      return trimmed.replace(/\s*--frozen-lockfile/, '');
    }
    return null;
  }
  // pnpm install --frozen-lockfile
  if (/^pnpm\s+install\s+.*--frozen-lockfile/.test(trimmed)) {
    if (/ERR_PNPM|lockfile|resolution|specifiers in/i.test(output)) {
      return trimmed.replace(/\s*--frozen-lockfile/, '');
    }
    return null;
  }
  // yarn install --frozen-lockfile
  if (/^yarn\s+install\s+.*--frozen-lockfile/.test(trimmed)) {
    if (/lockfile|resolution|YN0028|frozen/i.test(output)) {
      return trimmed.replace(/\s*--frozen-lockfile/, '');
    }
    return null;
  }
  // npm ci → npm install
  if (/^npm\s+ci(\s|$)/.test(trimmed)) {
    if (/EUSAGE|package-lock|lockfile|ELOCK/i.test(output)) {
      return trimmed.replace(/^npm\s+ci/, 'npm install');
    }
    return null;
  }
  return null;
}
const TRUSTED_LOGIN_SHELLS = new Set([
  '/bin/bash',
  '/bin/zsh',
  '/usr/bin/bash',
  '/usr/bin/zsh',
  '/usr/local/bin/bash',
  '/usr/local/bin/zsh',
  '/opt/homebrew/bin/bash',
  '/opt/homebrew/bin/zsh',
]);

export function resolveSetupShell(
  shellExists: (path: string) => boolean = existsSync,
  preferred = process.env.SHELL,
): { command: string; args: (setupCommand: string) => string[] } {
  if (preferred && TRUSTED_LOGIN_SHELLS.has(preferred) && shellExists(preferred)) {
    return { command: preferred, args: (setupCommand) => ['-ilc', setupCommand] };
  }
  for (const shell of ['/bin/zsh', '/bin/bash']) {
    if (shellExists(shell))
      return { command: shell, args: (setupCommand) => ['-ilc', setupCommand] };
  }
  return { command: '/bin/sh', args: (setupCommand) => ['-c', setupCommand] };
}

/**
 * Read the orchestrator-side GitHub token via `gh auth token`. Spawns
 * from the desktop process — the credential never reaches the worktree
 * filesystem or the agent transcript. Returns null when `gh` is not
 * authenticated.
 *
 * Symphony §10.5: orchestrator owns the credential. We currently
 * piggyback on `gh` because ShipCode does not yet have first-class
 * per-project credential storage; swap this to read from project
 * settings when that lands (#75 follow-up).
 */
async function readGhAuthToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token']);
    const token = stdout.trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export function createPipelineRuntime(
  deps: PipelineDeps,
  _contextHelpers: PipelineContextHelpers,
): PipelineRuntime {
  // Late-initialized after performGhSync is defined below.
  let ghSyncQueue: GhSyncQueue;

  function getCurrentRunIdForThread(threadId: string): string | null {
    const activeRunId = _contextHelpers.activePipelines?.get(threadId)?.runId ?? null;
    if (activeRunId) return activeRunId;
    try {
      return deps.pipelineRuns?.getCurrentForThread(threadId)?.id ?? null;
    } catch {
      return null;
    }
  }

  function emitTerminalRaw(threadId: string, content: string) {
    const runId = getCurrentRunIdForThread(threadId);
    deps.emitter.emit({
      type: 'terminal:event',
      threadId,
      ...(runId ? { runId } : {}),
      event: { kind: 'raw', content },
    });
  }

  function emitTerminalLifecycle(threadId: string, message: string) {
    const runId = getCurrentRunIdForThread(threadId);
    deps.emitter.emit({
      type: 'terminal:event',
      threadId,
      ...(runId ? { runId } : {}),
      event: { kind: 'lifecycle', message },
    });
  }

  function ensurePathInsideRoot(root: string, targetPath: string, label: string): string {
    const resolvedRoot = resolve(root);
    const resolvedTarget = resolve(targetPath);
    if (resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + sep)) {
      return resolvedTarget;
    }
    throw new Error(`${label} escapes the project root`);
  }

  function ensureRepoSetupContract(context: PipelineContext) {
    if (context.repoSetupLoaded) return context.repoSetupContract;
    context.repoSetupContract = loadRepoSetupContract(context.projectPath);
    context.repoSetupLoaded = true;
    return context.repoSetupContract;
  }

  const SHELL_COMMAND_TIMEOUT_FALLBACK_MS = 10 * 60 * 1000;

  function resolveShellTimeoutMs(context?: PipelineContext): number {
    const override = context?.repoSetupContract?.contract.shellCommandTimeoutMs;
    if (typeof override === 'number' && override > 0) return override;
    const fromSettings = deps.settings.get().shellCommandTimeoutMs;
    if (typeof fromSettings === 'number' && fromSettings > 0) return fromSettings;
    return SHELL_COMMAND_TIMEOUT_FALLBACK_MS;
  }

  async function runShellCommand(
    threadId: string,
    cwd: string,
    command: string,
    signal: AbortSignal,
    options?: { extraEnv?: Record<string, string>; timeoutMs?: number },
  ): Promise<{ exitCode: number; output: string }> {
    const timeoutMs = options?.timeoutMs ?? resolveShellTimeoutMs();
    return await new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      const chunks: string[] = [];
      const shell = resolveSetupShell();
      const managed = deps.processManager.spawnWithStdin(
        'shell',
        shell.command,
        shell.args(command),
        cwd,
        '',
        threadId,
        {
          detached: true,
          extraEnv: options?.extraEnv,
        },
      );

      const cleanup = () => {
        clearTimeout(timer);
        deps.processManager.removeListener('output', onOutput);
        deps.processManager.removeListener('exit', onExit);
        signal.removeEventListener('abort', onAbort);
      };

      const rejectOnce = (error: Error) => {
        settled = true;
        cleanup();
        rejectPromise(error);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        emitTerminalRaw(
          threadId,
          `\r\n[shipcode] Command timed out after ${Math.round(timeoutMs / 60_000)}m — killing process.\r\n`,
        );
        deps.processManager.kill(managed.id);
        setTimeout(() => {
          try {
            const proc = deps.processManager.get(managed.id);
            if (proc && proc.state !== 'exited') deps.processManager.kill(managed.id, 'SIGKILL');
          } catch {}
        }, 5_000);
        rejectOnce(
          new Error(
            `Command timed out after ${Math.round(timeoutMs / 60_000)} minutes: ${command}`,
          ),
        );
      }, timeoutMs);

      const onOutput = (processId: string, chunk: string) => {
        if (processId !== managed.id) return;
        chunks.push(chunk);
        emitTerminalRaw(threadId, chunk);
      };

      const onExit = (processId: string, exitCode: number) => {
        if (processId !== managed.id || settled) return;
        settled = true;
        const output = chunks.join('');
        cleanup();
        resolvePromise({ exitCode, output });
      };

      const onAbort = () => {
        if (settled) return;
        deps.processManager.kill(managed.id);
        rejectOnce(new Error(`Command aborted: ${command}`));
      };

      deps.processManager.on('output', onOutput);
      deps.processManager.on('exit', onExit);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  async function prepareWorktree(
    context: PipelineContext,
    stage: 'execute' | 'verify',
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const loaded = ensureRepoSetupContract(context);
    if (!loaded || !context.worktreePath) return { ok: true };

    const { contract, path: contractPath } = loaded;
    const shouldRunSetup =
      stage === 'execute' || (stage === 'verify' && contract.setupBeforeVerify);
    if (!shouldRunSetup && contract.envFiles.length === 0) return { ok: true };

    emitTerminalLifecycle(
      context.threadId,
      `[setup] Using repo setup contract ${contractPath}\r\n`,
    );

    for (const envFile of contract.envFiles) {
      try {
        const sourcePath = ensurePathInsideRoot(
          context.projectPath,
          resolve(context.projectPath, envFile.source),
          `env file source "${envFile.source}"`,
        );
        const targetRelative = envFile.target ?? envFile.source;
        const targetPath = ensurePathInsideRoot(
          context.worktreePath,
          resolve(context.worktreePath, targetRelative),
          `env file target "${targetRelative}"`,
        );

        if (!existsSync(sourcePath)) {
          if (envFile.required) {
            return { ok: false, error: `required env file missing: ${envFile.source}` };
          }
          emitTerminalLifecycle(
            context.threadId,
            `[setup] Optional env file missing, skipping ${envFile.source}\r\n`,
          );
          continue;
        }

        mkdirSync(dirname(targetPath), { recursive: true });
        copyFileSync(sourcePath, targetPath);
        emitTerminalLifecycle(
          context.threadId,
          `[setup] Copied ${envFile.source} -> ${targetRelative}\r\n`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
      }
    }

    if (!shouldRunSetup) return { ok: true };

    for (const command of contract.setupCommands) {
      emitTerminalLifecycle(context.threadId, `[setup] $ ${command}\r\n`);
      try {
        const result = await runShellCommand(
          context.threadId,
          context.worktreePath,
          command,
          context.abort.signal,
        );
        if (result.exitCode !== 0) {
          const snippet = result.output.trim().split('\n').slice(-3).join(' ').slice(0, 300);
          // Retry a frozen-lockfile install without the freeze flag when
          // the failure looks like lockfile drift / resolution mismatch.
          // Repo-owned lockfiles drift quickly and a hard-fail blocks the
          // whole pipeline; falling back to a normal install matches what
          // a human would do.
          const fallback = buildFrozenInstallFallback(command, result.output);
          if (fallback) {
            emitTerminalLifecycle(
              context.threadId,
              `[setup] frozen install failed — retrying without --frozen-lockfile: $ ${fallback}\r\n`,
            );
            try {
              const retry = await runShellCommand(
                context.threadId,
                context.worktreePath,
                fallback,
                context.abort.signal,
              );
              if (retry.exitCode === 0) continue;
              const retrySnippet = retry.output
                .trim()
                .split('\n')
                .slice(-3)
                .join(' ')
                .slice(0, 300);
              return {
                ok: false,
                error: `command failed after fallback (${retry.exitCode}): ${fallback}${retrySnippet ? ` — ${retrySnippet}` : ''}`,
              };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              return {
                ok: false,
                error: `command error during fallback: ${fallback} — ${message}`,
              };
            }
          }
          return {
            ok: false,
            error: `command failed (${result.exitCode}): ${command}${snippet ? ` — ${snippet}` : ''}`,
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: `command error: ${command} — ${message}` };
      }
    }

    return { ok: true };
  }

  function getTestingContext(context: PipelineContext): string | null {
    const loaded = ensureRepoSetupContract(context);
    return loaded?.contract.testingContext ?? deps.settings.get().testingContext;
  }

  function getVerifyCommands(context: PipelineContext): string[] {
    const loaded = ensureRepoSetupContract(context);
    if (loaded && loaded.contract.verifyCommands.length > 0) {
      return loaded.contract.verifyCommands;
    }
    const testCommand = deps.settings.get().testCommand?.trim();
    return testCommand ? [testCommand] : [];
  }

  function buildRepoSetupPlannerNote(context: PipelineContext): string {
    const loaded = ensureRepoSetupContract(context);
    if (!loaded) return '';

    const bits: string[] = [];
    if (loaded.contract.setupCommands.length > 0) {
      bits.push(
        `Setup commands: ${loaded.contract.setupCommands.map((command) => `\`${command}\``).join(', ')}`,
      );
    }
    if (loaded.contract.verifyCommands.length > 0) {
      bits.push(
        `Verification commands: ${loaded.contract.verifyCommands
          .map((command) => `\`${command}\``)
          .join(', ')}`,
      );
    }
    if (loaded.contract.envFiles.length > 0) {
      bits.push(
        `Env files propagated into the worktree: ${loaded.contract.envFiles
          .map((file) => `\`${file.source}\`${file.required ? '' : ' (optional)'}`)
          .join(', ')}`,
      );
    }
    if (bits.length === 0) return '';

    return `\n\n<!-- auto-injected: repo setup contract -->\nNote: This repo defines a setup contract in \`.shipcode/setup.json\`.\n${bits.join('\n')}`;
  }

  function formatStabilizationFeedback(inputs: {
    prNumber: number;
    prUrl: string | null;
    failingChecks: Array<{
      name: string;
      conclusion: string | null;
      detailsUrl: string | null;
      workflowName: string | null;
    }>;
    unresolvedReviewComments: Array<{
      author: string | null;
      body: string;
      url: string;
      path: string | null;
      line: number | null;
    }>;
  }): string {
    const lines = [
      '',
      '',
      '<stabilization_feedback>',
      `Continue work on linked draft PR #${inputs.prNumber}. Resolve the remaining GitHub feedback without expanding scope.`,
    ];

    if (inputs.prUrl) {
      lines.push(`PR URL: ${inputs.prUrl}`);
    }

    if (inputs.failingChecks.length > 0) {
      lines.push('', 'Failing checks:');
      for (const check of inputs.failingChecks.slice(0, 10)) {
        const summary = [check.workflowName, check.name].filter(Boolean).join(' / ');
        const detail = [check.conclusion, check.detailsUrl].filter(Boolean).join(' — ');
        lines.push(`- ${summary}${detail ? ` — ${detail}` : ''}`);
      }
    }

    if (inputs.unresolvedReviewComments.length > 0) {
      lines.push('', 'Unresolved review comments:');
      for (const comment of inputs.unresolvedReviewComments.slice(0, 10)) {
        const location = [comment.path, comment.line ? `:${comment.line}` : null]
          .filter(Boolean)
          .join('');
        const header = [comment.author, location].filter(Boolean).join(' — ');
        const body =
          comment.body.length > 600 ? `${comment.body.slice(0, 600).trimEnd()}…` : comment.body;
        lines.push(
          `- ${header || 'Review comment'}: ${body.replace(/\s+/g, ' ')}${comment.url ? ` (${comment.url})` : ''}`,
        );
      }
    }

    lines.push(
      '',
      'Apply the minimal follow-up changes, rerun the required verification, and leave the branch ready for another push.',
      '</stabilization_feedback>',
      '',
      '<debugging_methodology>',
      '<scope_constraint>',
      'These steps apply ONLY to diagnosing the failing check.',
      'Do not expand beyond the files touched in the original execution.',
      'Do not redesign, refactor, or improve code outside the failure path.',
      '</scope_constraint>',
      '',
      '1. READ the full error output — not just the last line.',
      '2. REPRODUCE the failure in isolation before changing anything.',
      '3. HYPOTHESIZE explicitly before each change — state what you believe is wrong and why.',
      '4. LOCALIZE — narrow the failure to the smallest scope. Is it your code or existing code?',
      '5. FIX the root cause, not the symptom. Suppressing errors or changing test expectations is not a fix.',
      '6. GUARD — write or update a test that fails without the fix and passes with it.',
      '</debugging_methodology>',
    );

    return lines.join('\n');
  }

  function formatTestFixFeedback(testOutput: string, attempt: number): string {
    const lines = [
      '',
      '',
      '<test_fix_feedback>',
      `The build/test command failed on attempt ${attempt}. Your only goal in this pass is to fix these failing tests. Do NOT re-execute the full plan or add new features.`,
      '',
      'Failing test output:',
      '<test_output>',
      testOutput.trim().slice(-8192),
      '</test_output>',
      '</test_fix_feedback>',
      '',
      '<debugging_methodology>',
      '<scope_constraint>',
      'These steps apply ONLY to diagnosing the failing tests.',
      'Do not expand beyond the files directly implicated by the test failures.',
      'Do not redesign, refactor, or improve code outside the failure path.',
      '</scope_constraint>',
      '',
      '1. READ the full test output — not just the last line.',
      '2. IDENTIFY the exact assertion or compilation error that caused failure.',
      '3. HYPOTHESIZE explicitly before each change — state what you believe is wrong and why.',
      '4. LOCALIZE — narrow the failure to the smallest scope. Is it your code or existing code?',
      '5. FIX the root cause, not the symptom. Suppressing errors or changing test expectations is not a fix.',
      '6. VERIFY by re-reading the test expectations after the fix.',
      '</debugging_methodology>',
    ];
    return lines.join('\n');
  }

  function resolveAgentForPhase(
    input: Pick<
      OrchestratorState,
      'plannerModel' | 'reviewerModel' | 'verifierModel' | 'executorModel'
    >,
    phase: ProviderPhase,
  ): PipelineExecutorModel {
    switch (phase) {
      case 'plan':
      case 'revision':
        return input.plannerModel;
      case 'review':
        return input.reviewerModel;
      case 'verify':
        return input.verifierModel;
      case 'execute':
        if (input.executorModel) return input.executorModel;
        return 'claude';
    }
  }

  /**
   * Pure provider-phase execution. Reads only the frozen `PhasePayload` snapshot
   * — never the mutable `PipelineContext` — and returns the context mutations it
   * would have made (`deltas`) for the orchestrator to apply. The
   * `runProviderPhase` wrapper builds the payload (via `buildPhasePayload`) and
   * applies the deltas.
   */
  async function runProviderPhaseCore(
    input: PhasePayload,
    prompt: string,
    promptMaterials: PromptMaterial[],
    phaseHints: ProviderRequest['phaseHints'],
    lifecycle?: { onProcessStart?: (processId: string) => void },
  ): Promise<{
    rawOutput: string;
    exitCode: number;
    resolvedModel?: string;
    promptTelemetry?: import('@shipcode/agents/source').PhasePromptTelemetry;
    clarificationRequest?: import('@shipcode/shared').ClarificationRequest;
    deltas: ProviderPhaseDeltas;
  }> {
    // PhasePayload pre-resolves the phase's agent + model-id override (identical
    // logic to the old internal `resolveAgentForPhase` + `modelHint` IIFE).
    const phase = input.phase;
    const agent = input.model;
    const modelHint = input.modelIdOverride;
    const provider = deps.providers.for(agent, phase);
    // When a GitHub issue is resumed, planning/review should inspect the same
    // worktree that already contains in-progress changes instead of the clean
    // project root.
    const cwd = input.worktreePath ?? input.projectPath;

    // Structured phases parse machine-readable fenced JSON and cap turns at 1.
    const structuredPhases: ProviderPhase[] = ['plan', 'review', 'revision', 'verify'];
    const configuredRunMode: ProviderRunMode | undefined =
      agent === 'claude' || agent === 'codex'
        ? getAgentPhaseRunMode(deps.settings.get(), agent, phase)
        : undefined;
    // Auto-fallback: when the rationed `claude -p` Agent-SDK credit pool is
    // exhausted, route programmatic claude phases through the interactive CLI
    // (which is unaffected by the pool) instead of failing. Codex has no such
    // pool, so it is never rerouted here.
    const effectiveRunMode: ProviderRunMode | undefined =
      agent === 'claude' && configuredRunMode === 'programmatic' && isPoolExhausted()
        ? 'interactive'
        : configuredRunMode;
    const mergedHints: ProviderRequest['phaseHints'] = {
      ...(structuredPhases.includes(phase) ? { maxTurns: 1 } : {}),
      ...phaseHints,
      ...(effectiveRunMode ? { runMode: effectiveRunMode } : {}),
    };

    // Lifecycle envelope: start a pipeline_step_log row before generation so
    // a crashed run still leaves a 'started' breadcrumb. The completion path
    // below flips it to completed/failed/aborted with tokens + cost.
    const stepRow = (() => {
      try {
        return (
          deps.pipelineSteps?.start({
            threadId: input.threadId,
            runId: input.runId,
            phase,
            attempt: input.promptTelemetryCount + 1,
            provider: provider.id,
            requestedModel: modelHint ?? agent,
          }) ?? null
        );
      } catch (error) {
        console.error('[pipeline] pipeline step start failed:', error);
        return null;
      }
    })();

    // Conversation log: write the prompt row before calling the provider.
    // The response row is written after we get output (or on failure).
    const promptConvRow = (() => {
      try {
        return (
          deps.agentConversations?.insert({
            threadId: input.threadId,
            runId: input.runId,
            phase,
            round: input.promptTelemetryCount,
            speaker: 'pipeline',
            role: 'prompt',
            provider: provider.id,
            model: modelHint ?? null,
            content: prompt,
          }) ?? null
        );
      } catch (error) {
        console.error('[pipeline] conversation prompt insert failed:', error);
        return null;
      }
    })();

    let response: Awaited<ReturnType<typeof provider.generate>>;
    try {
      // Defense in depth: only assert workspace shape when running inside a
      // worktree. Plan/review for issues that haven't materialized a
      // worktree yet still spawn at the project root and skip the check.
      const workspaceRoot = input.worktreePath ? deps.settings.get().worktreeRoot : undefined;
      response = await provider.generate({
        phase,
        prompt,
        cwd,
        projectPath: input.projectPath,
        signal: input.abort,
        phaseHints: mergedHints,
        promptMaterialSummary: input.promptMaterialSummary,
        modelHint: modelHint ?? undefined,
        threadId: input.threadId,
        onProcessStart: lifecycle?.onProcessStart,
        ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
        githubGraphql: {
          // Token read happens at tool-call time, not now — captures
          // rotation during a long-running pipeline.
          getToken: () => readGhAuthToken(),
          getDefaultRepo: async () => {
            try {
              const { githubRepoFullName } = await new GhCli(input.projectPath).getRepoMetadata();
              const [owner, repo] = githubRepoFullName.split('/');
              if (!owner || !repo) return null;
              return { owner, repo };
            } catch {
              return null;
            }
          },
        },
        onTerminalEvent: (event) =>
          deps.emitter.emit({
            type: 'terminal:event',
            threadId: input.threadId,
            ...(input.runId ? { runId: input.runId } : {}),
            event,
          }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted = input.abort.aborted || /abort/i.test(message);

      // Conversation log: write synthetic error response row.
      try {
        deps.agentConversations?.insert({
          threadId: input.threadId,
          runId: input.runId,
          phase,
          round: input.promptTelemetryCount,
          speaker: 'pipeline',
          role: 'response',
          parentId: promptConvRow?.id ?? null,
          content: `[error] ${message.slice(0, 2000)}`,
        });
      } catch (convError) {
        console.error('[pipeline] conversation error-response insert failed:', convError);
      }

      if (stepRow && deps.pipelineSteps) {
        try {
          deps.pipelineSteps.complete(stepRow.id, {
            status: aborted ? 'aborted' : 'failed',
            errorKind: aborted ? 'aborted' : 'unknown',
            errorMessage: message.slice(0, 500),
            conversationId: promptConvRow?.id ?? null,
          });
        } catch (logError) {
          console.error('[pipeline] pipeline step complete (throw path) failed:', logError);
        }
      }
      throw error;
    }

    // Conversation log: write the provider response row.
    try {
      deps.agentConversations?.insert({
        threadId: input.threadId,
        runId: input.runId,
        phase,
        round: input.promptTelemetryCount,
        speaker: provider.id,
        role: 'response',
        parentId: promptConvRow?.id ?? null,
        provider: provider.id,
        model: response.resolvedModel ?? modelHint ?? null,
        content: response.rawOutput,
        tokensIn: response.tokensUsed?.prompt ?? null,
        tokensOut: response.tokensUsed?.completion ?? null,
        costUsd: response.costUsd ?? null,
      });
    } catch (convError) {
      console.error('[pipeline] conversation response insert failed:', convError);
    }

    if (stepRow && deps.pipelineSteps) {
      try {
        if (response.exitCode === 0) {
          deps.pipelineSteps.complete(stepRow.id, {
            status: 'completed',
            resolvedModel: response.resolvedModel ?? null,
            promptTokens: response.tokensUsed?.prompt ?? null,
            completionTokens: response.tokensUsed?.completion ?? null,
            costUsd: response.costUsd ?? null,
            conversationId: promptConvRow?.id ?? null,
          });
        } else {
          const kind = response.providerError?.kind;
          const status = kind === 'aborted' ? 'aborted' : 'failed';
          deps.pipelineSteps.complete(stepRow.id, {
            status,
            resolvedModel: response.resolvedModel ?? null,
            errorKind: kind ?? 'unknown',
            errorMessage: response.providerError?.message?.slice(0, 500) ?? null,
            promptTokens: response.tokensUsed?.prompt ?? null,
            completionTokens: response.tokensUsed?.completion ?? null,
            costUsd: response.costUsd ?? null,
            conversationId: promptConvRow?.id ?? null,
          });
        }
      } catch (logError) {
        console.error('[pipeline] pipeline step complete failed:', logError);
      }
    }

    const promptTelemetry = measurePhasePromptTelemetry({
      phase,
      prompt,
      materials: promptMaterials,
    });
    // Mutation delta, applied to context by the caller. The "+ 1" reproduces
    // the old post-push `promptTelemetry.length` (count at snapshot time, plus
    // this very entry) used for invocationId/attempt.
    const deltas: ProviderPhaseDeltas = { promptTelemetry, diagnosticEntry: null };
    const nextAttempt = input.promptTelemetryCount + 1;
    try {
      deps.promptTelemetry?.create({
        threadId: input.threadId,
        runId: input.runId,
        phase,
        invocationId: `${input.threadId}:${phase}:${nextAttempt}`,
        attempt: nextAttempt,
        provider: provider.id,
        model: response.resolvedModel ?? modelHint ?? agent,
        promptCharacters: promptTelemetry.promptSize.characters,
        promptBytes: promptTelemetry.promptSize.bytes,
        promptLines: promptTelemetry.promptSize.lines,
        selectedMaterials: toPersistedPromptTelemetryMaterials(promptTelemetry) as NonNullable<
          Parameters<NonNullable<PipelineDeps['promptTelemetry']>['create']>[0]['selectedMaterials']
        >,
        promptTokens: response.tokensUsed?.prompt ?? null,
        completionTokens: response.tokensUsed?.completion ?? null,
        costUsd: response.costUsd ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deltas.diagnosticEntry = { phase, message, nonFatal: true };
      console.error('[pipeline] prompt telemetry persistence failed:', error);
    }

    if (response.resolvedModel) {
      const requestedModel = modelHint ?? agent;
      try {
        deps.threads.setResolvedModel(input.threadId, phase, response.resolvedModel);
      } catch (error) {
        console.error('[pipeline] setResolvedModel failed:', error);
      }
      if (response.tokensUsed) {
        try {
          deps.threads.addTokenUsage(
            input.threadId,
            response.tokensUsed.prompt,
            response.tokensUsed.completion,
            response.costUsd ?? 0,
          );
        } catch (error) {
          console.error('[pipeline] addTokenUsage failed:', error);
        }
      }
      deps.emitter.emit({
        type: 'pipeline:model-resolved',
        threadId: input.threadId,
        ...(input.runId ? { runId: input.runId } : {}),
        phase,
        requestedModel,
        resolvedModel: response.resolvedModel,
        ...(response.tokensUsed ? { tokensUsed: response.tokensUsed } : {}),
        ...(response.costUsd != null ? { costUsd: response.costUsd } : {}),
      });
    }

    return {
      rawOutput: response.rawOutput,
      exitCode: response.exitCode,
      resolvedModel: response.resolvedModel,
      promptTelemetry,
      clarificationRequest: response.clarificationRequest,
      deltas,
    };
  }

  /**
   * Orchestrator seam: run the pure core against the caller-built frozen
   * `PhasePayload`, then apply the returned mutation deltas back to context. The
   * caller builds the payload (capturing `promptTelemetryCount`) immediately
   * before this call with no intervening telemetry push, so the count stays
   * consistent with the push below.
   */
  async function runProviderPhase(
    context: PipelineContext,
    payload: PhasePayload,
    prompt: string,
    promptMaterials: PromptMaterial[],
    phaseHints: ProviderRequest['phaseHints'],
  ): Promise<{
    rawOutput: string;
    exitCode: number;
    resolvedModel?: string;
    promptTelemetry?: import('@shipcode/agents/source').PhasePromptTelemetry;
    clarificationRequest?: import('@shipcode/shared').ClarificationRequest;
  }> {
    let phaseProcessId: string | null = null;
    try {
      const { deltas, ...response } = await runProviderPhaseCore(
        payload,
        prompt,
        promptMaterials,
        phaseHints,
        {
          onProcessStart: (processId) => {
            phaseProcessId = processId;
            context.activeProcessId = processId;
          },
        },
      );
      context.promptTelemetry.push(deltas.promptTelemetry);
      if (deltas.diagnosticEntry !== null) {
        context.promptTelemetryDiagnostics.push(deltas.diagnosticEntry);
      }
      return response;
    } finally {
      if (phaseProcessId !== null && context.activeProcessId === phaseProcessId) {
        context.activeProcessId = null;
      }
    }
  }

  /** Perform the actual GH write for a single state snapshot. */
  async function performGhSync(opts: GhSyncWriteOpts): Promise<void> {
    const ghCli = new GhCli(opts.projectPath);

    // 1. Write GH Projects v2 Status field when configured.
    if (opts.projectUrl && opts.statusMapping) {
      const macroCol = macroColumnForStatus(opts.pipelineStatus);
      const ghStatusName =
        macroCol === 'todo'
          ? opts.statusMapping.todo?.name
          : macroCol === 'in_progress'
            ? opts.statusMapping.inProgress?.name
            : macroCol === 'human_review'
              ? opts.statusMapping.humanReview?.name
              : opts.statusMapping.done?.name;
      if (ghStatusName) {
        try {
          await ghCli.setIssueProjectMetadata({
            issueNumber: opts.issueNumber,
            projectUrl: opts.projectUrl,
            metadata: { status: ghStatusName },
          });
        } catch (err) {
          console.warn('[gh-status-sync] setIssueProjectMetadata failed', err);
        }
      }
    }

    // 2. Toggle pipeline labels on every state update — remove stale, set current.
    const targetLabel = pipelineLabelForStatus(opts.pipelineStatus);
    try {
      const issue = await ghCli.getIssue(opts.issueNumber);
      const currentPipelineLabels = issue.labels.filter(isPipelineStateLabel);
      for (const old of currentPipelineLabels) {
        if (old !== targetLabel) {
          await ghCli.setIssueLabelPresence(opts.issueNumber, old, false);
        }
      }
      if (targetLabel) {
        await ghCli.setIssueLabelPresence(opts.issueNumber, targetLabel, true);
      }
    } catch (err) {
      console.warn('[gh-status-sync] pipeline label sync failed', err);
    }
  }

  // Initialize the serializer now that performGhSync is defined.
  ghSyncQueue = new GhSyncQueue(performGhSync, (err) => {
    console.warn('[gh-status-sync] queued write failed', err);
  });

  function inferRunSource(context: PipelineContext): string {
    if (isRealGithubIssueNumber(context.githubIssueNumber)) return 'github:resume';
    return context.autonomous ? 'automation:resume' : 'pipeline:resume';
  }

  function ensureRunForContext(
    context: PipelineContext,
    phase: Parameters<typeof deps.threads.updateStatus>[1],
  ): string | null {
    if (!deps.pipelineRuns) return context.runId;
    if (context.runId) return context.runId;

    try {
      const current = deps.pipelineRuns.getCurrentForThread(context.threadId);
      if (current) {
        context.runId = current.id;
        return current.id;
      }
      const retryOfRunId = deps.pipelineRuns.listByThread(context.threadId)[0]?.id ?? null;

      const run = deps.pipelineRuns.create({
        threadId: context.threadId,
        projectId: context.projectId,
        source: inferRunSource(context),
        triggerDetail: isRealGithubIssueNumber(context.githubIssueNumber)
          ? `issue:${context.githubIssueNumber}`
          : context.githubIssueTitle,
        currentPhase: phase,
        context: {
          githubIssueNumber: context.githubIssueNumber,
          githubIssueTitle: context.githubIssueTitle,
          worktreePath: context.worktreePath,
          executorModel: context.executorModel,
        },
        retryOfRunId,
      });
      context.runId = run.id;
      return run.id;
    } catch (runError) {
      console.error(`[pipeline] run creation failed for thread ${context.threadId}:`, runError);
      return null;
    }
  }

  function mapPhaseToRunStatus(
    phase: Parameters<typeof deps.threads.updateStatus>[1],
  ): 'succeeded' | 'failed' | 'paused' | null {
    switch (phase) {
      case 'completed':
        return 'succeeded';
      case 'failed':
        return 'failed';
      case 'paused':
        return 'paused';
      default:
        return null;
    }
  }

  function isExecutionOwnershipPhase(phase: Parameters<typeof deps.threads.updateStatus>[1]) {
    return (
      phase === 'executing' || phase === 'testing' || phase === 'verifying' || phase === 'shipping'
    );
  }

  function claimExecutionIfNeeded(context: PipelineContext, runId: string): void {
    if (!deps.pipelineRuns || !isRealGithubIssueNumber(context.githubIssueNumber)) return;
    if (!context.projectId) return;

    try {
      const issue = deps.githubIssues.getByNumber(context.projectId, context.githubIssueNumber);
      if (!issue) return;
      if (issue.executionRunId && issue.executionRunId !== runId) {
        console.warn(
          `[pipeline] issue execution lock already held for thread ${context.threadId}, run ${runId}`,
        );
        return;
      }
      const claimed = deps.pipelineRuns.claimIssueExecution({
        issueId: issue.id,
        runId,
        owner: context.executorModel,
      });
      if (!claimed) {
        console.warn(
          `[pipeline] issue execution lock already held for thread ${context.threadId}, run ${runId}`,
        );
      }
    } catch (lockError) {
      console.error(
        `[pipeline] execution lock claim failed for thread ${context.threadId}:`,
        lockError,
      );
    }
  }

  function syncRunForPhase(
    threadId: string,
    phase: Parameters<typeof deps.threads.updateStatus>[1],
    error?: string,
  ): string | null {
    if (!deps.pipelineRuns) return null;

    const context = _contextHelpers.activePipelines.get(threadId);
    let runId = context ? ensureRunForContext(context, phase) : null;

    try {
      if (!runId) {
        runId = deps.pipelineRuns.getCurrentForThread(threadId)?.id ?? null;
      }
      if (!runId) return null;

      const terminalStatus = mapPhaseToRunStatus(phase);
      if (terminalStatus) {
        deps.pipelineRuns.finish(runId, {
          status: terminalStatus,
          currentPhase: phase,
          errorKind: error ? 'phase_error' : null,
          errorMessage: error ?? null,
        });
        return runId;
      }

      deps.pipelineRuns.start(runId, phase);
      deps.pipelineRuns.setPhase(runId, phase);

      if (context && isExecutionOwnershipPhase(phase)) {
        claimExecutionIfNeeded(context, runId);
      }

      return runId;
    } catch (runError) {
      console.error(`[pipeline] run sync failed for thread ${threadId}:`, runError);
      return runId;
    }
  }

  function emitPhase(
    threadId: string,
    phase: Parameters<typeof deps.threads.updateStatus>[1],
    error?: string,
  ) {
    const runId = syncRunForPhase(threadId, phase, error);
    try {
      if (runId) {
        deps.phaseLogs?.transition(threadId, phase, error ?? null, runId);
      } else {
        deps.phaseLogs?.transition(threadId, phase, error ?? null);
      }
    } catch (logError) {
      console.error(`[pipeline] phase log transition failed for thread ${threadId}:`, logError);
    }
    syncThreadAndIssuePhase(deps.threads, deps.githubIssues, threadId, phase, error, {
      getProject: (pid) => deps.projects.getById(pid),
      syncToGithub: async (opts) => {
        // Route through the serializer — collapses rapid phase transitions
        // into the latest desired state per issue.
        ghSyncQueue.enqueue(opts);
      },
    });
    deps.emitter.emit({ type: 'pipeline:phase', threadId, phase, ...(runId ? { runId } : {}) });
  }

  async function postPlanComment(
    context: PipelineContext,
    plan: import('@shipcode/shared').ShipCodePlan,
  ): Promise<void> {
    if (!isRealGithubIssueNumber(context.githubIssueNumber)) return;
    try {
      const ghCli = new GhCli(context.projectPath);
      await ghCli.addIssueComment(context.githubIssueNumber, formatPlanComment(plan));
    } catch (error) {
      console.error('[pipeline] Failed to post plan comment:', error);
    }
  }

  async function postTaskGraphComment(
    context: PipelineContext,
    graph: TaskGraphWithNodes,
  ): Promise<void> {
    if (!isRealGithubIssueNumber(context.githubIssueNumber)) return;
    try {
      const ghCli = new GhCli(context.projectPath);
      const graphForComment = await ensureTaskNodeIssues(context, ghCli, graph);
      await syncTaskNodeIssueStatuses(context, ghCli, graphForComment);
      await ghCli.upsertIssueCommentByMarker(
        context.githubIssueNumber,
        TASK_GRAPH_COMMENT_MARKER,
        formatTaskGraphChecklist(graphForComment),
      );
    } catch (error) {
      console.error('[pipeline] Failed to post task graph comment:', error);
    }
  }

  async function ensureTaskNodeIssues(
    context: PipelineContext,
    ghCli: GhCli,
    graph: TaskGraphWithNodes,
  ): Promise<TaskGraphWithNodes> {
    if (
      graph.mode !== 'github-subissues' ||
      !deps.taskGraphs ||
      !isRealGithubIssueNumber(context.githubIssueNumber)
    ) {
      return graph;
    }

    let latestGraph = graph;
    const parentIssueNumber = context.githubIssueNumber;
    for (const node of graph.nodes) {
      if (node.githubIssueNumber !== null) continue;
      const issue = await ghCli.createIssue({
        title: `[${node.stableKey}] ${node.title}`,
        body: formatTaskNodeIssueBody({
          parentIssueNumber,
          graph: latestGraph,
          node,
        }),
      });
      latestGraph = deps.taskGraphs.updateNodeGithubIssueNumber(node.id, issue.number);
    }

    return latestGraph;
  }

  async function syncTaskNodeIssueStatuses(
    context: PipelineContext,
    ghCli: GhCli,
    graph: TaskGraphWithNodes,
  ): Promise<void> {
    if (graph.mode !== 'github-subissues' || !isRealGithubIssueNumber(context.githubIssueNumber)) {
      return;
    }

    for (const node of graph.nodes) {
      if (!isRealGithubIssueNumber(node.githubIssueNumber)) continue;
      try {
        if (node.status === 'completed') {
          await ghCli.closeIssue(node.githubIssueNumber);
        } else {
          await ghCli.reopenIssue(node.githubIssueNumber);
        }
      } catch (error) {
        console.error('[pipeline] Failed to sync task issue open state:', error);
      }
    }
  }

  return {
    emitTerminalRaw,
    emitTerminalLifecycle,
    ensureRepoSetupContract,
    runShellCommand,
    prepareWorktree,
    getTestingContext,
    getVerifyCommands,
    buildRepoSetupPlannerNote,
    formatStabilizationFeedback,
    formatTestFixFeedback,
    resolveAgentForPhase,
    runProviderPhase,
    runProviderPhaseCore,
    emitPhase,
    postPlanComment,
    postTaskGraphComment,
  };
}
