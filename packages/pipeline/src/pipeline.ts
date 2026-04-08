import { execFileSync } from 'node:child_process'
import { StreamParser, buildPlanPrompt, buildReviewPrompt, buildRevisionPrompt, buildVerificationPrompt } from '@shipcode/agents'
import type { ShipCodePlan } from '@shipcode/shared'
import { PIPELINE_MAX_RETRIES, MAX_VERIFICATION_RETRIES, MAX_REVIEW_ROUNDS } from '@shipcode/shared'
import type { Pipeline, PipelineContext, PipelineDeps } from './types'

export function createPipeline(deps: PipelineDeps): Pipeline {
  const activePipelines = new Map<string, PipelineContext>()

  function mapPhaseToIssueStatus(phase: Parameters<typeof deps.threads.updateStatus>[1]) {
    switch (phase) {
      case 'idle':
        return 'todo' as const
      case 'awaiting_approval':
        return 'reviewing' as const
      default:
        return phase
    }
  }

  function syncIssueStatus(threadId: string, phase: Parameters<typeof deps.threads.updateStatus>[1]) {
    const thread = deps.threads.getById(threadId)
    if (!thread?.githubIssueNumber) return

    const issue = deps.githubIssues.getByNumber(thread.projectId, thread.githubIssueNumber)
    if (!issue) return
    deps.githubIssues.updatePipelineStatus(issue.id, mapPhaseToIssueStatus(phase))
  }

  function ensureContext(
    threadId: string,
    seed: Partial<PipelineContext> & Pick<PipelineContext, 'projectPath'>,
  ): PipelineContext {
    const existing = activePipelines.get(threadId)
    if (existing) {
      Object.assign(existing, seed)
      return existing
    }

    const context: PipelineContext = {
      threadId,
      projectPath: seed.projectPath,
      worktreePath: seed.worktreePath ?? null,
      retryCount: seed.retryCount ?? 0,
      autonomous: seed.autonomous ?? false,
      reviewRound: seed.reviewRound ?? 0,
      verificationRetries: seed.verificationRetries ?? 0,
      githubIssueNumber: seed.githubIssueNumber ?? null,
      githubRepo: seed.githubRepo ?? null,
      executorModel: seed.executorModel ?? 'claude',
      baseBranch: seed.baseBranch ?? '',
      forkPointSha: seed.forkPointSha ?? '',
      activeProcessId: seed.activeProcessId ?? null,
      cancelled: seed.cancelled ?? false,
      verifiedSha: seed.verifiedSha ?? null,
    }
    activePipelines.set(threadId, context)
    return context
  }

  function emitPhase(threadId: string, phase: Parameters<typeof deps.threads.updateStatus>[1]) {
    deps.threads.updateStatus(threadId, phase)
    syncIssueStatus(threadId, phase)
    deps.emitter.emit({ type: 'pipeline:phase', threadId, phase })
  }

  async function startPlanGeneration(threadId: string, prompt: string, projectPath: string, worktreePath: string | null) {
    const context = ensureContext(threadId, { projectPath, worktreePath })

    emitPhase(threadId, 'planning')

    const cwd = worktreePath ?? projectPath
    const planPrompt = buildPlanPrompt(prompt, threadId)

    const parser = new StreamParser()
    const process = deps.processManager.spawn(
      'claude',
      'claude',
      ['-p', planPrompt, '--output-format', 'json', '--max-turns', '1', '--dangerously-skip-permissions', '--disallowedTools', 'Edit,Write,Bash,NotebookEdit'],
      cwd
    )
    context.activeProcessId = process.id

    // Collect output
    const outputHandler = (processId: string, data: string) => {
      if (processId === process.id) {
        parser.feed(data)
      }
    }
    deps.processManager.on('output', outputHandler)

    // Wait for process to exit
    const exitHandler = (processId: string, exitCode: number) => {
      if (processId !== process.id) return
      deps.processManager.removeListener('output', outputHandler)
      deps.processManager.removeListener('exit', exitHandler)

      if (context.cancelled) return

      if (exitCode === 127) {
        emitPhase(threadId, 'failed')
        activePipelines.delete(threadId)
        return
      }

      if (exitCode !== 0) {
        const result = parser.extractPlan()
        if (result.success && result.data) {
          // Plan extracted despite non-zero exit — proceed normally
          const nextVersion = deps.plans.getMaxVersion(threadId) + 1
          const plan = deps.plans.create(threadId, result.raw, result.data, nextVersion)
          deps.plans.updateStatus(plan.id, 'pending_review')
          deps.emitter.emit({ type: 'plan:parsed', threadId, plan: result.data })
          if (context.autonomous) { startReview(threadId, result.data) }
          else { emitPhase(threadId, 'reviewing') }
        } else {
          parser.detectError()
          if (context.retryCount < PIPELINE_MAX_RETRIES) {
            context.retryCount++
            startPlanGeneration(threadId, prompt, projectPath, worktreePath)
          } else {
            emitPhase(threadId, 'failed')
            activePipelines.delete(threadId)
          }
        }
        return
      }

      // Try to extract plan
      const result = parser.extractPlan()
      const nextVersion = deps.plans.getMaxVersion(threadId) + 1
      if (result.success && result.data) {
        const plan = deps.plans.create(threadId, result.raw, result.data, nextVersion)
        deps.plans.updateStatus(plan.id, 'pending_review')
        deps.emitter.emit({ type: 'plan:parsed', threadId, plan: result.data })

        if (context.autonomous) {
          // Autonomous: go directly to review
          startReview(threadId, result.data)
        } else {
          emitPhase(threadId, 'reviewing')
        }
      } else {
        // Store raw output even without structured data
        deps.plans.create(threadId, result.raw, null, nextVersion)
        emitPhase(threadId, 'awaiting_approval')
      }
    }
    deps.processManager.on('exit', exitHandler)
  }

  async function startReview(threadId: string, plan: ShipCodePlan) {
    const context = activePipelines.get(threadId)
    if (!context) return

    emitPhase(threadId, 'reviewing')

    const cwd = context.worktreePath ?? context.projectPath
    const reviewPromptText = buildReviewPrompt(plan, undefined, context.autonomous)

    const parser = new StreamParser()
    const args = context.autonomous
      ? ['-q', reviewPromptText, '--sandbox', 'read-only', '-a', 'never', '--reasoning-effort', 'high']
      : ['-q', reviewPromptText, '--sandbox', 'read-only', '-a', 'never']
    const process = deps.processManager.spawn(
      'codex',
      'codex',
      args,
      cwd
    )
    context.activeProcessId = process.id

    const outputHandler = (processId: string, data: string) => {
      if (processId === process.id) parser.feed(data)
    }
    deps.processManager.on('output', outputHandler)

    const exitHandler = (processId: string, _exitCode: number) => {
      if (processId !== process.id) return
      deps.processManager.removeListener('output', outputHandler)
      deps.processManager.removeListener('exit', exitHandler)

      if (context.cancelled) return

      if (_exitCode === 127) {
        emitPhase(threadId, 'failed')
        activePipelines.delete(threadId)
        return
      }

      const result = parser.extractReview()
      const latestPlan = deps.plans.getLatest(threadId)

      if (result.success && result.data && latestPlan) {
        deps.reviews.create(latestPlan.id, result.raw, result.data)
        deps.emitter.emit({ type: 'review:parsed', threadId, review: result.data })

        if (result.data.decision === 'approve') {
          if (context.autonomous) {
            startExecution(threadId, latestPlan!.structured!)
          } else {
            emitPhase(threadId, 'awaiting_approval')
          }
        } else if (result.data.decision === 'request_changes') {
          if (context.autonomous && context.reviewRound < MAX_REVIEW_ROUNDS) {
            // Check if there are critical/major findings
            context.reviewRound++
            deps.threads.incrementReviewRound(threadId)
            const feedback = result.data.suggestedChanges.join('\n') + '\n\nFindings:\n' +
              result.data.findings.map((f: { severity: string; description: string; suggestion?: string }) => `[${f.severity}] ${f.description}${f.suggestion ? ` — ${f.suggestion}` : ''}`).join('\n')
            startRevision(threadId, latestPlan!.structured!, feedback)
          } else if (context.autonomous && context.reviewRound >= MAX_REVIEW_ROUNDS) {
            // Force-approve only if no critical/major findings remain
            const hasCriticalOrMajor = result.data.findings.some((f: { severity: string }) => f.severity === 'critical' || f.severity === 'major')
            if (hasCriticalOrMajor) {
              emitPhase(threadId, 'failed')
              activePipelines.delete(threadId)
            } else {
              startExecution(threadId, latestPlan!.structured!)
            }
          } else {
            emitPhase(threadId, 'revising')
          }
        } else {
          // reject
          emitPhase(threadId, 'failed')
          activePipelines.delete(threadId)
        }
      } else {
        // Review couldn't be parsed
        if (latestPlan) {
          deps.reviews.create(latestPlan.id, parser.getRawOutput(), null)
        }
        emitPhase(threadId, 'failed')
        activePipelines.delete(threadId)
      }
    }
    deps.processManager.on('exit', exitHandler)
  }

  async function startRevision(threadId: string, plan: ShipCodePlan, reviewFeedback: string) {
    const context = activePipelines.get(threadId)
    if (!context) return

    emitPhase(threadId, 'revising')

    const cwd = context.worktreePath ?? context.projectPath
    const revisionPrompt = buildRevisionPrompt(plan, reviewFeedback, threadId)

    const parser = new StreamParser()
    const process = deps.processManager.spawn(
      'claude',
      'claude',
      ['-p', revisionPrompt, '--output-format', 'json', '--max-turns', '1', '--dangerously-skip-permissions', '--disallowedTools', 'Edit,Write,Bash,NotebookEdit'],
      cwd
    )
    context.activeProcessId = process.id

    const outputHandler = (processId: string, data: string) => {
      if (processId === process.id) parser.feed(data)
    }
    deps.processManager.on('output', outputHandler)

    const exitHandler = (processId: string, _exitCode: number) => {
      if (processId !== process.id) return
      deps.processManager.removeListener('output', outputHandler)
      deps.processManager.removeListener('exit', exitHandler)

      if (context.cancelled) return

      const result = parser.extractPlan()
      if (result.success && result.data) {
        deps.plans.supersedeAll(threadId)
        const newPlan = deps.plans.create(threadId, result.raw, result.data, plan.version + 1)
        deps.plans.updateStatus(newPlan.id, 'pending_review')
        deps.emitter.emit({ type: 'plan:parsed', threadId, plan: result.data })
        startReview(threadId, result.data)
      } else {
        deps.plans.create(threadId, result.raw, null, plan.version + 1)
        emitPhase(threadId, 'failed')
        activePipelines.delete(threadId)
      }
    }
    deps.processManager.on('exit', exitHandler)
  }

  async function startExecution(threadId: string, plan: ShipCodePlan) {
    const context = activePipelines.get(threadId)
    if (!context) return

    emitPhase(threadId, 'executing')

    const cwd = context.worktreePath ?? context.projectPath
    const executionPrompt = `Execute this approved implementation plan:\n\n${JSON.stringify(plan, null, 2)}`

    const model = context.executorModel
    const process = deps.processManager.spawn(
      model,
      model,
      model === 'claude'
        ? ['-p', executionPrompt, '--allowedTools', 'Edit,Write,Bash,Glob,Grep,Read', '--dangerously-skip-permissions']
        : ['-q', executionPrompt, '--sandbox', 'workspace-write', '-a', 'never'],
      cwd
    )
    context.activeProcessId = process.id

    const exitHandler = (processId: string, exitCode: number) => {
      if (processId !== process.id) return
      deps.processManager.removeListener('exit', exitHandler)

      if (context.cancelled) return

      if (exitCode === 0) {
        if (context.autonomous) {
          startVerification(threadId)
        } else {
          emitPhase(threadId, 'completed')
          activePipelines.delete(threadId)
        }
      } else {
        emitPhase(threadId, 'failed')
        activePipelines.delete(threadId)
      }
    }
    deps.processManager.on('exit', exitHandler)
  }

  async function startVerification(threadId: string) {
    const context = activePipelines.get(threadId)
    if (!context) return

    emitPhase(threadId, 'verifying')

    const cwd = context.worktreePath ?? context.projectPath
    const latestPlan = deps.plans.getLatest(threadId)
    if (!latestPlan?.structured) {
      emitPhase(threadId, 'failed')
      activePipelines.delete(threadId)
      return
    }

    const plan = latestPlan.structured

    // Pin HEAD SHA for verification
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8' }).trim()
    context.verifiedSha = headSha

    // Generate diff from fork point
    let diff: string
    try {
      diff = execFileSync('git', ['diff', `${context.forkPointSha}..${headSha}`], { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }).toString()
    } catch {
      diff = ''
    }

    if (!diff.trim()) {
      // No changes — verification fails
      deps.verifications.create(threadId, latestPlan.id, 'No changes detected', null)
      emitPhase(threadId, 'failed')
      activePipelines.delete(threadId)
      return
    }

    // Check for dirty worktree
    try {
      const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8' })
      if (status.trim()) {
        deps.verifications.create(threadId, latestPlan.id, `Dirty worktree: ${status}`, null)
        if (context.verificationRetries < MAX_VERIFICATION_RETRIES) {
          context.verificationRetries++
          startExecution(threadId, plan)
          return
        }
        emitPhase(threadId, 'failed')
        activePipelines.delete(threadId)
        return
      }
    } catch {}

    const verificationPrompt = buildVerificationPrompt(plan, diff, plan.acceptanceCriteria)

    const parser = new StreamParser()
    const process = deps.processManager.spawn(
      'claude',
      'claude',
      ['-p', verificationPrompt, '--output-format', 'json', '--max-turns', '1', '--dangerously-skip-permissions', '--disallowedTools', 'Edit,Write,Bash,NotebookEdit'],
      cwd
    )
    context.activeProcessId = process.id

    const outputHandler = (processId: string, data: string) => {
      if (processId === process.id) parser.feed(data)
    }
    deps.processManager.on('output', outputHandler)

    const exitHandler = (processId: string, _exitCode: number) => {
      if (processId !== process.id) return
      deps.processManager.removeListener('output', outputHandler)
      deps.processManager.removeListener('exit', exitHandler)

      if (context.cancelled) return

      const result = parser.extractVerification()

      if (result.success && result.data) {
        deps.verifications.create(threadId, latestPlan.id, result.raw, result.data)
        deps.emitter.emit({ type: 'verification:parsed', threadId, verification: result.data })

        if (result.data.result === 'passed') {
          startCommitAndPush(threadId)
        } else if (context.verificationRetries < MAX_VERIFICATION_RETRIES) {
          context.verificationRetries++
          startExecution(threadId, plan)
        } else {
          emitPhase(threadId, 'failed')
          activePipelines.delete(threadId)
        }
      } else {
        deps.verifications.create(threadId, latestPlan.id, parser.getRawOutput(), null)
        emitPhase(threadId, 'failed')
        activePipelines.delete(threadId)
      }
    }
    deps.processManager.on('exit', exitHandler)
  }

  async function startCommitAndPush(threadId: string) {
    const context = activePipelines.get(threadId)
    if (!context) return

    const cwd = context.worktreePath ?? context.projectPath

    try {
      // Verify HEAD hasn't changed since verification
      const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf-8' }).trim()
      if (context.verifiedSha && context.verifiedSha !== currentHead) {
        emitPhase(threadId, 'failed')
        activePipelines.delete(threadId)
        return
      }

      // Check if worktree is clean
      const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf-8' })
      if (status.trim()) {
        emitPhase(threadId, 'failed')
        activePipelines.delete(threadId)
        return
      }

      // Verify there are commits ahead of base
      const ahead = execFileSync('git', ['log', context.forkPointSha + '..HEAD', '--oneline'], { cwd, encoding: 'utf-8' })
      if (!ahead.trim()) {
        emitPhase(threadId, 'failed')
        activePipelines.delete(threadId)
        return
      }

      // Push
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf-8' }).trim()
      execFileSync('git', ['push', 'origin', branch, '--set-upstream'], { cwd, encoding: 'utf-8' })

      startShipping(threadId)
    } catch {
      // Retry push once
      try {
        const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf-8' }).trim()
        execFileSync('git', ['push', 'origin', branch, '--set-upstream'], { cwd, encoding: 'utf-8' })
        startShipping(threadId)
      } catch {
        emitPhase(threadId, 'failed')
        activePipelines.delete(threadId)
      }
    }
  }

  async function startShipping(threadId: string) {
    const context = activePipelines.get(threadId)
    if (!context) return

    emitPhase(threadId, 'shipping')

    if (!context.githubIssueNumber) {
      // Non-GitHub thread — just complete
      emitPhase(threadId, 'completed')
      activePipelines.delete(threadId)
      return
    }

    const cwd = context.worktreePath ?? context.projectPath

    try {
      // Get branch name
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf-8' }).trim()

      // Build PR body
      const latestPlan = deps.plans.getLatest(threadId)
      const plan = latestPlan?.structured
      const title = plan?.objective ?? `ShipCode: Issue #${context.githubIssueNumber}`
      const body = [
        `## Summary`,
        plan?.objective ?? '',
        '',
        `Closes #${context.githubIssueNumber}`,
        '',
        `---`,
        `*Autonomous implementation by ShipCode*`,
      ].join('\n')

      // Create PR
      const prOutput = execFileSync(
        'gh',
        ['pr', 'create', '--title', title, '--body', body, '--head', branch, '--base', context.baseBranch || 'main'],
        { cwd, encoding: 'utf-8' }
      )

      // Extract PR number from URL
      const prMatch = prOutput.match(/\/pull\/(\d+)/)
      if (prMatch) {
        const prNumber = parseInt(prMatch[1], 10)
        deps.threads.setGithubPr(threadId, prNumber)

        // Comment on issue
        try {
          execFileSync(
            'gh',
            ['issue', 'comment', String(context.githubIssueNumber), '--body', 'PR #' + prNumber + ' created by ShipCode.'],
            { cwd, encoding: 'utf-8' }
          )
        } catch {}
      }

      emitPhase(threadId, 'completed')
    } catch {
      emitPhase(threadId, 'failed')
    }
    activePipelines.delete(threadId)
  }

  async function startFromGitHubIssue(
    threadId: string,
    projectPath: string,
    issue: { number: number; title: string; body: string | null; labels: string[] },
    executorModel: 'claude' | 'codex'
  ) {
    // Determine fork point
    let baseBranch = 'main'
    let forkPointSha = ''
    try {
      baseBranch = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], { cwd: projectPath, encoding: 'utf-8' }).trim().replace('origin/', '')
    } catch {
      baseBranch = 'main'
    }
    try {
      forkPointSha = execFileSync('git', ['rev-parse', baseBranch], { cwd: projectPath, encoding: 'utf-8' }).trim()
    } catch {}

    deps.threads.updateAutonomousFields(threadId, {
      autonomous: true,
      reviewRound: 0,
      executorModel,
      baseBranch,
      forkPointSha,
    })

    // Pre-create context with all autonomous fields
    ensureContext(threadId, {
      projectPath,
      worktreePath: null,
      retryCount: 0,
      autonomous: true,
      reviewRound: 0,
      verificationRetries: 0,
      githubIssueNumber: issue.number,
      githubRepo: null,
      executorModel,
      baseBranch,
      forkPointSha,
      activeProcessId: null,
      cancelled: false,
      verifiedSha: null,
    })

    const prompt = `GitHub Issue #${issue.number}: ${issue.title}\n\n${issue.body ?? ''}`
    await startPlanGeneration(threadId, prompt, projectPath, null)
  }

  function cancel(threadId: string) {
    const context = activePipelines.get(threadId)
    if (context) {
      context.cancelled = true
      if (context.activeProcessId) {
        deps.processManager.kill(context.activeProcessId)
      }
    }
    activePipelines.delete(threadId)
    emitPhase(threadId, 'idle')
  }

  return {
    startPlanGeneration,
    startReview,
    startRevision,
    startExecution,
    startVerification,
    startCommitAndPush,
    startShipping,
    startFromGitHubIssue,
    initializeContext: ensureContext,
    cancel,
    getContext: (threadId: string) => activePipelines.get(threadId),
  }
}
