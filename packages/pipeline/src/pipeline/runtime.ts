import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import type { ProviderPhase, ProviderRequest } from '@shipcode/agents';
import { formatPlanComment, GhCli, loadRepoSetupContract } from '@shipcode/agents';
import type { PipelineContext, PipelineDeps, PipelineExecutorModel } from '../types';
import type { PipelineContextHelpers, PipelineRuntime } from './shared';

export function createPipelineRuntime(
  deps: PipelineDeps,
  _contextHelpers: PipelineContextHelpers,
): PipelineRuntime {
  function emitTerminalRaw(threadId: string, content: string) {
    deps.emitter.emit({ type: 'terminal:event', threadId, event: { kind: 'raw', content } });
  }

  function emitTerminalLifecycle(threadId: string, message: string) {
    deps.emitter.emit({
      type: 'terminal:event',
      threadId,
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

  async function runShellCommand(
    threadId: string,
    cwd: string,
    command: string,
    signal: AbortSignal,
  ): Promise<{ exitCode: number; output: string }> {
    return await new Promise((resolvePromise, rejectPromise) => {
      const chunks: string[] = [];
      const child = spawn(command, { cwd, shell: true, signal });

      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        chunks.push(text);
        emitTerminalRaw(threadId, text);
      };

      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', rejectPromise);
      child.on('close', (code) => {
        resolvePromise({ exitCode: code ?? 1, output: chunks.join('') });
      });
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
    );

    return lines.join('\n');
  }

  function resolveAgentForPhase(
    context: PipelineContext,
    phase: ProviderPhase,
  ): PipelineExecutorModel {
    switch (phase) {
      case 'plan':
      case 'revision':
        return context.plannerModel;
      case 'review':
        return context.reviewerModel;
      case 'verify':
        return context.verifierModel;
      case 'execute':
        if (context.executorModel) return context.executorModel;
        return 'claude';
    }
  }

  async function runProviderPhase(
    context: PipelineContext,
    phase: ProviderPhase,
    prompt: string,
    phaseHints: ProviderRequest['phaseHints'],
  ): Promise<{ rawOutput: string; exitCode: number; resolvedModel?: string }> {
    const agent = resolveAgentForPhase(context, phase);
    const provider = deps.providers.for(agent, phase);
    // When a GitHub issue is resumed, planning/review should inspect the same
    // worktree that already contains in-progress changes instead of the clean
    // project root.
    const cwd = context.worktreePath ?? context.projectPath;
    const modelHint = (() => {
      if (agent === context.executorModel && context.executorModelOverride) {
        return context.executorModelOverride;
      }
      switch (phase) {
        case 'plan':
        case 'revision':
          return context.plannerModelIdOverride;
        case 'review':
          return context.reviewerModelIdOverride;
        case 'execute':
          return context.executorModelIdOverride;
        case 'verify':
          return context.verifierModelIdOverride;
      }
    })();

    const plannerPhases: ProviderPhase[] = ['plan', 'revision', 'verify'];
    const mergedHints: ProviderRequest['phaseHints'] = plannerPhases.includes(phase)
      ? { maxTurns: deps.settings.get().plannerMaxTurns, ...phaseHints }
      : phaseHints;

    const response = await provider.generate({
      phase,
      prompt,
      cwd,
      projectPath: context.projectPath,
      signal: context.abort.signal,
      phaseHints: mergedHints,
      modelHint: modelHint ?? undefined,
      threadId: context.threadId,
      onTerminalEvent: (event) =>
        deps.emitter.emit({ type: 'terminal:event', threadId: context.threadId, event }),
    });

    if (response.resolvedModel) {
      const requestedModel = modelHint ?? agent;
      try {
        deps.threads.setResolvedModel(context.threadId, phase, response.resolvedModel);
      } catch (error) {
        console.error('[pipeline] setResolvedModel failed:', error);
      }
      if (response.tokensUsed) {
        try {
          deps.threads.addTokenUsage(
            context.threadId,
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
        threadId: context.threadId,
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
    };
  }

  function emitPhase(
    threadId: string,
    phase: Parameters<typeof deps.threads.updateStatus>[1],
    error?: string,
  ) {
    if (error !== undefined) {
      deps.threads.updateStatus(threadId, phase, error);
    } else {
      deps.threads.updateStatus(threadId, phase);
    }
    const thread = deps.threads.getById(threadId);
    if (thread?.githubIssueNumber) {
      const issue = deps.githubIssues.getByNumber(thread.projectId, thread.githubIssueNumber);
      if (issue) {
        deps.githubIssues.updatePipelineStatus(issue.id, phase === 'idle' ? 'todo' : phase);
      }
    }
    deps.emitter.emit({ type: 'pipeline:phase', threadId, phase });
  }

  async function postPlanComment(
    context: PipelineContext,
    plan: import('@shipcode/shared').ShipCodePlan,
  ): Promise<void> {
    if (!context.githubIssueNumber) return;
    try {
      const ghCli = new GhCli(context.projectPath);
      await ghCli.addIssueComment(context.githubIssueNumber, formatPlanComment(plan));
    } catch (error) {
      console.error('[pipeline] Failed to post plan comment:', error);
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
    resolveAgentForPhase,
    runProviderPhase,
    emitPhase,
    postPlanComment,
  };
}
