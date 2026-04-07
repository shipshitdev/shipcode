import { StreamParser, buildPlanPrompt, buildReviewPrompt, buildRevisionPrompt, buildVerificationPrompt } from '@shipcode/agents'
import type { ShipCodePlan } from '@shipcode/shared'
import { PIPELINE_MAX_RETRIES, MAX_VERIFICATION_RETRIES, MAX_REVIEW_ROUNDS } from '@shipcode/shared'
import type { PipelineContext, PipelineDeps } from './types'

export function createPipeline(deps: PipelineDeps) {
  const activePipelines = new Map<string, PipelineContext>()

  function emitPhase(threadId: string, phase: Parameters<typeof deps.threads.updateStatus>[1]) {
    deps.threads.updateStatus(threadId, phase)
    deps.emitter.emit({ type: 'pipeline:phase', threadId, phase })
  }

  async function startPlanGeneration(threadId: string, prompt: string, projectPath: string, worktreePath: string | null) {
    const context: PipelineContext = {
      threadId,
      projectPath,
      worktreePath,
      retryCount: 0,
      autonomous: false,
      reviewRound: 0,
      verificationRetries: 0,
      githubIssueNumber: null,
      githubRepo: null,
      executorModel: 'claude',
      baseBranch: '',
      forkPointSha: '',
    }
    activePipelines.set(threadId, context)

    emitPhase(threadId, 'planning')

    const cwd = worktreePath ?? projectPath
    const planPrompt = buildPlanPrompt(prompt, threadId)

    const parser = new StreamParser()
    const process = deps.processManager.spawn(
      'claude',
      'claude',
      ['-p', planPrompt, '--output-format', 'json', '--max-turns', '1'],
      cwd
    )

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

      if (exitCode !== 0) {
        parser.detectError()
        if (context.retryCount < PIPELINE_MAX_RETRIES) {
          context.retryCount++
          // Retry planning
          startPlanGeneration(threadId, prompt, projectPath, worktreePath)
        } else {
          emitPhase(threadId, 'failed')
        }
        return
      }

      // Try to extract plan
      const result = parser.extractPlan()
      if (result.success && result.data) {
        const plan = deps.plans.create(threadId, result.raw, result.data, 1)
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
        deps.plans.create(threadId, result.raw, null, 1)
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
      ? ['-q', reviewPromptText, '--reasoning-effort', 'high']
      : ['-q', reviewPromptText]
    const process = deps.processManager.spawn(
      'codex',
      'codex',
      args,
      cwd
    )

    const outputHandler = (processId: string, data: string) => {
      if (processId === process.id) parser.feed(data)
    }
    deps.processManager.on('output', outputHandler)

    const exitHandler = (processId: string, _exitCode: number) => {
      if (processId !== process.id) return
      deps.processManager.removeListener('output', outputHandler)
      deps.processManager.removeListener('exit', exitHandler)

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
        // Review couldn't be parsed — go to approval with raw output
        if (latestPlan) {
          deps.reviews.create(latestPlan.id, parser.getRawOutput(), null)
        }
        emitPhase(threadId, 'awaiting_approval')
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
      ['-p', revisionPrompt, '--output-format', 'json', '--max-turns', '1'],
      cwd
    )

    const outputHandler = (processId: string, data: string) => {
      if (processId === process.id) parser.feed(data)
    }
    deps.processManager.on('output', outputHandler)

    const exitHandler = (processId: string, _exitCode: number) => {
      if (processId !== process.id) return
      deps.processManager.removeListener('output', outputHandler)
      deps.processManager.removeListener('exit', exitHandler)

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

    const process = deps.processManager.spawn(
      'claude',
      'claude',
      ['-p', executionPrompt, '--allowedTools', 'Edit,Write,Bash,Glob,Grep,Read'],
      cwd
    )

    const exitHandler = (processId: string, exitCode: number) => {
      if (processId !== process.id) return
      deps.processManager.removeListener('exit', exitHandler)

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

    // Generate diff from fork point
    const { execSync } = await import('node:child_process')
    let diff: string
    try {
      diff = execSync(`git diff ${context.forkPointSha}..HEAD`, { cwd, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
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
      const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8' })
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
      ['-p', verificationPrompt, '--output-format', 'json', '--max-turns', '1'],
      cwd
    )

    const outputHandler = (processId: string, data: string) => {
      if (processId === process.id) parser.feed(data)
    }
    deps.processManager.on('output', outputHandler)

    const exitHandler = (processId: string, _exitCode: number) => {
      if (processId !== process.id) return
      deps.processManager.removeListener('output', outputHandler)
      deps.processManager.removeListener('exit', exitHandler)

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
    const { execSync } = await import('node:child_process')

    try {
      // Check if worktree is clean
      const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8' })
      if (status.trim()) {
        emitPhase(threadId, 'failed')
        activePipelines.delete(threadId)
        return
      }

      // Verify there are commits ahead of base
      const ahead = execSync(`git log ${context.forkPointSha}..HEAD --oneline`, { cwd, encoding: 'utf-8' })
      if (!ahead.trim()) {
        emitPhase(threadId, 'failed')
        activePipelines.delete(threadId)
        return
      }

      // Push
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8' }).trim()
      execSync(`git push origin ${branch} --set-upstream`, { cwd, encoding: 'utf-8' })

      startShipping(threadId)
    } catch {
      // Retry push once
      try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8' }).trim()
        execSync(`git push origin ${branch} --set-upstream`, { cwd, encoding: 'utf-8' })
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
    const { execSync } = await import('node:child_process')

    try {
      // Get branch name
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8' }).trim()

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
      const prOutput = execSync(
        `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --head "${branch}"`,
        { cwd, encoding: 'utf-8' }
      )

      // Extract PR number from URL
      const prMatch = prOutput.match(/\/pull\/(\d+)/)
      if (prMatch) {
        const prNumber = parseInt(prMatch[1], 10)
        deps.threads.setGithubPr(threadId, prNumber)

        // Comment on issue
        try {
          execSync(
            `gh issue comment ${context.githubIssueNumber} --body "PR #${prNumber} created by ShipCode."`,
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
    projectId: string,
    projectPath: string,
    issue: { number: number; title: string; body: string | null; labels: string[] },
    executorModel: 'claude' | 'codex'
  ) {
    const threadId = deps.threads.create(projectId, issue.body ?? issue.title, issue.title).id

    // Determine fork point
    const { execSync } = await import('node:child_process')
    let baseBranch = 'main'
    let forkPointSha = ''
    try {
      baseBranch = execSync('git symbolic-ref refs/remotes/origin/HEAD --short', { cwd: projectPath, encoding: 'utf-8' }).trim().replace('origin/', '')
    } catch {
      baseBranch = 'main'
    }
    try {
      forkPointSha = execSync(`git rev-parse ${baseBranch}`, { cwd: projectPath, encoding: 'utf-8' }).trim()
    } catch {}

    deps.threads.updateAutonomousFields(threadId, {
      autonomous: true,
      reviewRound: 0,
      executorModel,
      baseBranch,
      forkPointSha,
    })

    const prompt = `GitHub Issue #${issue.number}: ${issue.title}\n\n${issue.body ?? ''}`
    startPlanGeneration(threadId, prompt, projectPath, null)
  }

  function cancel(threadId: string) {
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
    cancel,
    getContext: (threadId: string) => activePipelines.get(threadId),
  }
}

export type Pipeline = ReturnType<typeof createPipeline>
