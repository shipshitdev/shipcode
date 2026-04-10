import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ProcessManager } from '@shipcode/agents'
import type { PipelineDeps } from './types'
import { createPipeline } from './pipeline'
import { PIPELINE_MAX_RETRIES, MAX_REVIEW_ROUNDS, MAX_VERIFICATION_RETRIES } from '@shipcode/shared'

const { mockExecSync } = vi.hoisted(() => ({ mockExecSync: vi.fn() }))
vi.mock('node:child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:child_process')>()
	return {
		...actual,
		execFileSync: vi.fn((command: string, args: string[] = [], options?: object) =>
			mockExecSync([command, ...args].join(' '), options)
		),
	}
})

const PLAN_JSON = JSON.stringify({
	id: 'p1',
	threadId: 't1',
	version: 1,
	objective: 'Test',
	files: [{ path: 'a.ts', action: 'modify', description: 'd' }],
	steps: [{ order: 1, description: 'd', files: ['a.ts'], rationale: 'r' }],
	acceptanceCriteria: ['works'],
	outOfScope: [],
	estimatedComplexity: 'low',
	dependencies: [],
})

const REVIEW_APPROVE_JSON = JSON.stringify({
	planId: 'p1',
	decision: 'approve',
	confidence: 'high',
	summary: 'Good',
	findings: [],
	suggestedChanges: [],
})

const REVIEW_REQUEST_CHANGES_JSON = JSON.stringify({
	planId: 'p1',
	decision: 'request_changes',
	confidence: 'high',
	summary: 'Needs work',
	findings: [{ id: 'f1', severity: 'minor', category: 'correctness', description: 'fix this', suggestion: 'do that' }],
	suggestedChanges: ['change X'],
})

const REVIEW_REQUEST_CHANGES_CRITICAL_JSON = JSON.stringify({
	planId: 'p1',
	decision: 'request_changes',
	confidence: 'high',
	summary: 'Critical issues',
	findings: [{ id: 'f1', severity: 'critical', category: 'security', description: 'security flaw' }],
	suggestedChanges: ['fix security'],
})

const REVIEW_REJECT_JSON = JSON.stringify({
	planId: 'p1',
	decision: 'reject',
	confidence: 'high',
	summary: 'Bad',
	findings: [],
	suggestedChanges: [],
})

const VERIFICATION_PASSED_JSON = JSON.stringify({
	threadId: 't1',
	planId: 'p1',
	result: 'passed',
	summary: 'OK',
	criteriaResults: [{ criterion: 'works', passed: true, evidence: 'yes' }],
	issues: [],
})

const VERIFICATION_FAILED_JSON = JSON.stringify({
	threadId: 't1',
	planId: 'p1',
	result: 'failed',
	summary: 'Not OK',
	criteriaResults: [{ criterion: 'works', passed: false, evidence: 'no' }],
	issues: [{ severity: 'blocker', description: 'broke' }],
})

/** Flush the microtask queue so async handlers (await import) settle */
const flush = () => new Promise(r => setTimeout(r, 10))

function planBlock(json: string = PLAN_JSON) {
	return '```shipcode-plan\n' + json + '\n```'
}

function reviewBlock(json: string) {
	return '```shipcode-review\n' + json + '\n```'
}

function verificationBlock(json: string) {
	return '```shipcode-verification\n' + json + '\n```'
}

function createMockDeps() {
	const emittedEvents: any[] = []
	const listeners: Record<string, Function[]> = {}
	let spawnCount = 0

	const processManager = {
		spawn: vi.fn(() => ({ id: `proc-${++spawnCount}` })),
		kill: vi.fn(),
		on: vi.fn((event: string, handler: Function) => {
			(listeners[event] ??= []).push(handler)
		}),
		removeListener: vi.fn((event: string, handler: Function) => {
			listeners[event] = (listeners[event] ?? []).filter(h => h !== handler)
		}),
	} as unknown as ProcessManager

	const trigger = (event: string, ...args: any[]) => {
		// Copy the array to avoid mutation during iteration when handlers remove themselves
		const handlers = [...(listeners[event] ?? [])]
		handlers.forEach(h => h(...args))
	}

	const latestPlan = {
		id: 'plan-1',
		threadId: 't1',
		version: 1,
		rawOutput: '',
		structured: JSON.parse(PLAN_JSON),
		status: 'pending_review',
		createdAt: '',
	}

	return {
		deps: {
			emitter: { emit: vi.fn((e: any) => emittedEvents.push(e)) },
			processManager,
			threads: {
				updateStatus: vi.fn(),
				getById: vi.fn(() => ({
					id: 't1',
					projectId: 'project-1',
					githubIssueNumber: 42,
				})),
				incrementReviewRound: vi.fn(),
				setGithubPr: vi.fn(),
				updateAutonomousFields: vi.fn(),
			},
			plans: {
				getMaxVersion: vi.fn(() => 0),
				create: vi.fn((_tid: string, raw: string, structured: any, v: number) => ({
					id: 'plan-1', threadId: _tid, version: v, rawOutput: raw, structured, status: 'draft', createdAt: '',
				})),
				updateStatus: vi.fn(),
				getLatest: vi.fn(() => latestPlan),
				supersedeAll: vi.fn(),
			},
			reviews: {
				create: vi.fn(),
			},
			verifications: {
				create: vi.fn(),
			},
			githubIssues: {
				getByNumber: vi.fn(() => null),
				updatePipelineStatus: vi.fn(),
			},
		} as unknown as PipelineDeps,
		emittedEvents,
		trigger,
		latestPlan,
	}
}

describe('createPipeline', () => {
	let mock: ReturnType<typeof createMockDeps>

	beforeEach(() => {
		mock = createMockDeps()
		mockExecSync.mockReset()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	// ─── startPlanGeneration ───────────────────────────────────────────

	describe('startPlanGeneration', () => {
		it('emits planning on start', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'planning')
			expect(mock.emittedEvents).toContainEqual({
				type: 'pipeline:phase', threadId: 't1', phase: 'planning',
			})
		})

		it('initializeContext seeds state before pipeline start', async () => {
			const pipeline = createPipeline(mock.deps)

			pipeline.initializeContext('t1', {
				projectPath: '/proj',
				worktreePath: '/proj/.shipcode/worktrees/t1',
				baseBranch: 'main',
			})

			expect(pipeline.getContext('t1')).toMatchObject({
				projectPath: '/proj',
				worktreePath: '/proj/.shipcode/worktrees/t1',
				baseBranch: 'main',
			})
		})

		it('syncs linked GitHub issue status when phases change', async () => {
			;(mock.deps.githubIssues.getByNumber as any).mockReturnValue({ id: 'issue-1' })

			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			expect(mock.deps.githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-1', 'planning')

			mock.trigger('output', 'proc-1', planBlock())
			mock.trigger('exit', 'proc-1', 0)

			expect(mock.deps.githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-1', 'reviewing')
		})

		it('passes awaiting_approval through to the linked GitHub issue status', async () => {
			;(mock.deps.githubIssues.getByNumber as any).mockReturnValue({ id: 'issue-1' })

			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			mock.trigger('output', 'proc-1', 'some random output without a plan block')
			mock.trigger('exit', 'proc-1', 0)

			expect(mock.deps.githubIssues.updatePipelineStatus).toHaveBeenCalledWith('issue-1', 'awaiting_approval')
		})

		it('exit 0 + valid plan → creates plan, emits plan:parsed, emits reviewing (manual)', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			mock.trigger('output', 'proc-1', planBlock())
			mock.trigger('exit', 'proc-1', 0)

			expect(mock.deps.plans.create).toHaveBeenCalled()
			expect(mock.deps.plans.updateStatus).toHaveBeenCalledWith('plan-1', 'pending_review')
			expect(mock.emittedEvents).toContainEqual(
				expect.objectContaining({ type: 'plan:parsed', threadId: 't1' })
			)
			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'reviewing')
		})

		it('exit 0 + valid plan + autonomous → calls startReview (spawns codex)', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			// Patch context to autonomous
			const ctx = pipeline.getContext('t1')!
			ctx.autonomous = true

			mock.trigger('output', 'proc-1', planBlock())
			mock.trigger('exit', 'proc-1', 0)

			// startReview was called → spawns a codex process
			expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(2)
			const secondCall = (mock.deps.processManager.spawn as any).mock.calls[1]
			expect(secondCall[1]).toBe('codex')
		})

		it('exit 0 + no valid plan → creates plan with null, emits awaiting_approval', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			mock.trigger('output', 'proc-1', 'some random output without a plan block')
			mock.trigger('exit', 'proc-1', 0)

			expect(mock.deps.plans.create).toHaveBeenCalledWith('t1', expect.any(String), null, 1)
			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'awaiting_approval')
		})

		it('exit non-zero → retries (spawns again)', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			mock.trigger('exit', 'proc-1', 1)

			// Should have spawned a second process (retry)
			expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(2)
		})

		it('exit non-zero 4 times → emits failed (PIPELINE_MAX_RETRIES=3)', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			// First attempt + 3 retries = 4 total failures
			for (let i = 1; i <= PIPELINE_MAX_RETRIES + 1; i++) {
				mock.trigger('exit', `proc-${i}`, 1)
			}

			expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(PIPELINE_MAX_RETRIES + 1)
			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'failed')
		})

		it('C1 regression: retry counter persists across recursive calls', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			// First failure: retryCount becomes 1
			mock.trigger('exit', 'proc-1', 1)
			expect(pipeline.getContext('t1')!.retryCount).toBe(1)

			// Second failure: retryCount becomes 2
			mock.trigger('exit', 'proc-2', 1)
			expect(pipeline.getContext('t1')!.retryCount).toBe(2)

			// Third failure: retryCount becomes 3
			mock.trigger('exit', 'proc-3', 1)
			expect(pipeline.getContext('t1')!.retryCount).toBe(3)

			// Fourth failure: exhausted → should emit failed
			mock.trigger('exit', 'proc-4', 1)
			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'failed')
		})
	})

	// ─── startReview ───────────────────────────────────────────────────

	describe('startReview', () => {
		it('no context → no-op', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startReview('t1', JSON.parse(PLAN_JSON))

			expect(mock.deps.processManager.spawn).not.toHaveBeenCalled()
		})

		it('autonomous spawns codex with --reasoning-effort high', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.autonomous = true

			await pipeline.startReview('t1', JSON.parse(PLAN_JSON))

			// proc-1 from startPlanGeneration, proc-2 from startReview
			const reviewCall = (mock.deps.processManager.spawn as any).mock.calls[1]
			expect(reviewCall[1]).toBe('codex')
			expect(reviewCall[2]).toContain('--reasoning-effort')
			expect(reviewCall[2]).toContain('high')
		})

		it('approve + autonomous → calls startExecution (emits executing)', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.autonomous = true

			await pipeline.startReview('t1', JSON.parse(PLAN_JSON))

			// proc-2 is the review process
			mock.trigger('output', 'proc-2', reviewBlock(REVIEW_APPROVE_JSON))
			mock.trigger('exit', 'proc-2', 0)

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'executing')
		})

		it('approve + manual → emits awaiting_approval', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			await pipeline.startReview('t1', JSON.parse(PLAN_JSON))

			mock.trigger('output', 'proc-2', reviewBlock(REVIEW_APPROVE_JSON))
			mock.trigger('exit', 'proc-2', 0)

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'awaiting_approval')
		})

		it('request_changes + autonomous + round < MAX_REVIEW_ROUNDS → emits revising', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.autonomous = true
			pipeline.getContext('t1')!.reviewRound = 0

			await pipeline.startReview('t1', JSON.parse(PLAN_JSON))

			mock.trigger('output', 'proc-2', reviewBlock(REVIEW_REQUEST_CHANGES_JSON))
			mock.trigger('exit', 'proc-2', 0)

			expect(mock.deps.threads.incrementReviewRound).toHaveBeenCalledWith('t1')
			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'revising')
		})

		it('request_changes + autonomous + round >= MAX_REVIEW_ROUNDS + no critical → starts execution', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.autonomous = true
			pipeline.getContext('t1')!.reviewRound = MAX_REVIEW_ROUNDS

			await pipeline.startReview('t1', JSON.parse(PLAN_JSON))

			mock.trigger('output', 'proc-2', reviewBlock(REVIEW_REQUEST_CHANGES_JSON))
			mock.trigger('exit', 'proc-2', 0)

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'executing')
		})

		it('request_changes + autonomous + round >= MAX_REVIEW_ROUNDS + has critical → emits failed', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.autonomous = true
			pipeline.getContext('t1')!.reviewRound = MAX_REVIEW_ROUNDS

			await pipeline.startReview('t1', JSON.parse(PLAN_JSON))

			mock.trigger('output', 'proc-2', reviewBlock(REVIEW_REQUEST_CHANGES_CRITICAL_JSON))
			mock.trigger('exit', 'proc-2', 0)

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'failed')
		})

		it('reject → emits failed', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			await pipeline.startReview('t1', JSON.parse(PLAN_JSON))

			mock.trigger('output', 'proc-2', reviewBlock(REVIEW_REJECT_JSON))
			mock.trigger('exit', 'proc-2', 0)

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'failed')
			expect(pipeline.getContext('t1')).toBeUndefined()
		})

		it('parse failure → emits failed', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			await pipeline.startReview('t1', JSON.parse(PLAN_JSON))

			mock.trigger('output', 'proc-2', 'some garbage that is not a review block')
			mock.trigger('exit', 'proc-2', 0)

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'failed')
		})
	})

	// ─── startRevision ─────────────────────────────────────────────────

	describe('startRevision', () => {
		it('no context → no-op', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startRevision('t1', JSON.parse(PLAN_JSON), 'feedback')

			expect(mock.deps.processManager.spawn).not.toHaveBeenCalled()
		})

		it('parse success → supersedesAll, creates plan version+1, starts review', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			await pipeline.startRevision('t1', JSON.parse(PLAN_JSON), 'feedback')

			// proc-2 is the revision process
			mock.trigger('output', 'proc-2', planBlock())
			mock.trigger('exit', 'proc-2', 0)

			expect(mock.deps.plans.supersedeAll).toHaveBeenCalledWith('t1')
			expect(mock.deps.plans.create).toHaveBeenCalledWith(
				't1', expect.any(String), expect.any(Object), 2
			)
			// Starts review → spawns proc-3
			expect(mock.deps.processManager.spawn).toHaveBeenCalledTimes(3)
		})

		it('parse failure → emits failed', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			await pipeline.startRevision('t1', JSON.parse(PLAN_JSON), 'feedback')

			mock.trigger('output', 'proc-2', 'garbage output')
			mock.trigger('exit', 'proc-2', 0)

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'failed')
			expect(pipeline.getContext('t1')).toBeUndefined()
		})
	})

	// ─── startExecution ────────────────────────────────────────────────

	describe('startExecution', () => {
		it('no context → no-op', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startExecution('t1', JSON.parse(PLAN_JSON))

			expect(mock.deps.processManager.spawn).not.toHaveBeenCalled()
		})

		it('exit 0 + autonomous → starts verification (emits verifying)', async () => {
			// Need to set up execSync for verification phase
			mockExecSync.mockImplementation((cmd: string) => {
				if (cmd.startsWith('git diff')) return 'some diff output'
				if (cmd.startsWith('git status')) return ''
				return ''
			})

			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.autonomous = true
			pipeline.getContext('t1')!.forkPointSha = 'abc123'

			await pipeline.startExecution('t1', JSON.parse(PLAN_JSON))

			// proc-2 is execution
			mock.trigger('exit', 'proc-2', 0)

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'verifying')
		})

		it('exit 0 + manual → emits completed', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			await pipeline.startExecution('t1', JSON.parse(PLAN_JSON))

			mock.trigger('exit', 'proc-2', 0)

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'completed')
			expect(pipeline.getContext('t1')).toBeUndefined()
		})

		it('exit non-zero → emits failed', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			await pipeline.startExecution('t1', JSON.parse(PLAN_JSON))

			mock.trigger('exit', 'proc-2', 1)

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'failed')
			expect(pipeline.getContext('t1')).toBeUndefined()
		})
	})

	// ─── startVerification ─────────────────────────────────────────────

	describe('startVerification', () => {
		it('no context → no-op', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startVerification('t1')

			expect(mock.deps.processManager.spawn).not.toHaveBeenCalled()
		})

		it('no structured plan → emits failed', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			;(mock.deps.plans.getLatest as any).mockReturnValue({ id: 'plan-1', structured: null })

			await pipeline.startVerification('t1')

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'failed')
			expect(pipeline.getContext('t1')).toBeUndefined()
		})

		it('no diff → creates verification, emits failed', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.forkPointSha = 'abc123'

			mockExecSync.mockImplementation((cmd: string) => {
				if (cmd.startsWith('git diff')) return ''
				return ''
			})

			await pipeline.startVerification('t1')

			expect(mock.deps.verifications.create).toHaveBeenCalledWith(
				't1', 'plan-1', 'No changes detected', null
			)
			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'failed')
		})

		it('dirty worktree + retries left → starts execution retry', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.forkPointSha = 'abc123'
			pipeline.getContext('t1')!.verificationRetries = 0

			mockExecSync.mockImplementation((cmd: string) => {
				if (cmd.startsWith('git diff')) return 'some diff'
				if (cmd.startsWith('git status')) return 'M dirty.ts'
				return ''
			})

			await pipeline.startVerification('t1')

			expect(mock.deps.verifications.create).toHaveBeenCalled()
			// Should have started execution (spawned another process)
			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'executing')
		})

		it('dirty worktree + no retries → emits failed', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.forkPointSha = 'abc123'
			pipeline.getContext('t1')!.verificationRetries = MAX_VERIFICATION_RETRIES

			mockExecSync.mockImplementation((cmd: string) => {
				if (cmd.startsWith('git diff')) return 'some diff'
				if (cmd.startsWith('git status')) return 'M dirty.ts'
				return ''
			})

			await pipeline.startVerification('t1')

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'failed')
			expect(pipeline.getContext('t1')).toBeUndefined()
		})

		it('verification passed → calls startCommitAndPush', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.forkPointSha = 'abc123'

			mockExecSync.mockImplementation((cmd: string) => {
				if (cmd.startsWith('git diff')) return 'some diff'
				if (cmd.startsWith('git status')) return ''
				if (cmd.startsWith('git log')) return 'abc123 commit'
				if (cmd.startsWith('git rev-parse')) return 'feat/branch'
				if (cmd.startsWith('git push')) return ''
				return ''
			})

			await pipeline.startVerification('t1')

			// proc-2 is verification process
			mock.trigger('output', 'proc-2', verificationBlock(VERIFICATION_PASSED_JSON))
			mock.trigger('exit', 'proc-2', 0)

			// startCommitAndPush is async — wait for it to settle
			await flush()

			expect(mock.emittedEvents).toContainEqual(
				expect.objectContaining({ type: 'verification:parsed', threadId: 't1' })
			)
			// startCommitAndPush was called — it uses execSync for git push
			expect(mockExecSync).toHaveBeenCalledWith(
				expect.stringContaining('git push'),
				expect.any(Object)
			)
		})

		it('verification failed + retries left → starts execution', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.forkPointSha = 'abc123'
			pipeline.getContext('t1')!.verificationRetries = 0

			mockExecSync.mockImplementation((cmd: string) => {
				if (cmd.startsWith('git diff')) return 'some diff'
				if (cmd.startsWith('git status')) return ''
				return ''
			})

			await pipeline.startVerification('t1')

			mock.trigger('output', 'proc-2', verificationBlock(VERIFICATION_FAILED_JSON))
			mock.trigger('exit', 'proc-2', 0)

			// startExecution is async — wait for it to settle
			await flush()

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'executing')
			expect(pipeline.getContext('t1')!.verificationRetries).toBe(1)
		})

		it('verification failed + no retries → emits failed', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.forkPointSha = 'abc123'
			pipeline.getContext('t1')!.verificationRetries = MAX_VERIFICATION_RETRIES

			mockExecSync.mockImplementation((cmd: string) => {
				if (cmd.startsWith('git diff')) return 'some diff'
				if (cmd.startsWith('git status')) return ''
				return ''
			})

			await pipeline.startVerification('t1')

			mock.trigger('output', 'proc-2', verificationBlock(VERIFICATION_FAILED_JSON))
			mock.trigger('exit', 'proc-2', 0)

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'failed')
			expect(pipeline.getContext('t1')).toBeUndefined()
		})
	})

	// ─── startCommitAndPush ────────────────────────────────────────────

	describe('startCommitAndPush', () => {
		it('no context → no-op', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startCommitAndPush('t1')

			expect(mockExecSync).not.toHaveBeenCalled()
		})

		it('dirty worktree → emits failed', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			mockExecSync.mockImplementation((cmd: string) => {
				if (cmd.startsWith('git status')) return 'M dirty.ts'
				return ''
			})

			await pipeline.startCommitAndPush('t1')

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'failed')
			expect(pipeline.getContext('t1')).toBeUndefined()
		})

		it('no commits ahead → emits failed', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.forkPointSha = 'abc123'

			mockExecSync.mockImplementation((cmd: string) => {
				if (cmd.startsWith('git status')) return ''
				if (cmd.startsWith('git log')) return ''
				return ''
			})

			await pipeline.startCommitAndPush('t1')

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'failed')
			expect(pipeline.getContext('t1')).toBeUndefined()
		})

		it('push succeeds → calls startShipping', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.forkPointSha = 'abc123'

			mockExecSync.mockImplementation((cmd: string) => {
				if (cmd.startsWith('git status')) return ''
				if (cmd.startsWith('git log')) return 'abc123 some commit'
				if (cmd.startsWith('git rev-parse')) return 'feat/branch'
				if (cmd.startsWith('git push')) return ''
				return ''
			})

			await pipeline.startCommitAndPush('t1')

			// startShipping emits 'shipping' then 'completed' (no github issue)
			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'shipping')
			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'completed')
		})

		it('push fails twice → emits failed', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.forkPointSha = 'abc123'

			mockExecSync.mockImplementation((cmd: string) => {
				if (cmd.startsWith('git status')) return ''
				if (cmd.startsWith('git log')) return 'abc123 some commit'
				if (cmd.startsWith('git rev-parse')) return 'feat/branch'
				if (cmd.startsWith('git push')) {
					throw new Error('push failed')
				}
				return ''
			})

			await pipeline.startCommitAndPush('t1')

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'failed')
			expect(pipeline.getContext('t1')).toBeUndefined()
		})
	})

	// ─── startShipping ─────────────────────────────────────────────────

	describe('startShipping', () => {
		it('no context → no-op', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startShipping('t1')

			expect(mock.deps.threads.updateStatus).not.toHaveBeenCalledWith('t1', 'shipping')
		})

		it('no GitHub issue → emits completed directly', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			await pipeline.startShipping('t1')

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'shipping')
			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'completed')
			expect(pipeline.getContext('t1')).toBeUndefined()
		})

		it('PR created + number extracted → stores via setGithubPr, emits completed', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.githubIssueNumber = 42

			mockExecSync.mockImplementation((cmd: string) => {
				if (cmd.startsWith('git rev-parse')) return 'feat/branch'
				if (cmd.startsWith('gh pr create')) return 'https://github.com/org/repo/pull/99\n'
				if (cmd.startsWith('gh issue comment')) return ''
				return ''
			})

			await pipeline.startShipping('t1')

			expect(mock.deps.threads.setGithubPr).toHaveBeenCalledWith('t1', 99)
			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'completed')
		})

		it('PR URL missing number → still completes (M6 silent skip)', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.githubIssueNumber = 42

			mockExecSync.mockImplementation((cmd: string) => {
				if (cmd.startsWith('git rev-parse')) return 'feat/branch'
				if (cmd.startsWith('gh pr create')) return 'some output without a pr url'
				return ''
			})

			await pipeline.startShipping('t1')

			expect(mock.deps.threads.setGithubPr).not.toHaveBeenCalled()
			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'completed')
		})

		it('PR creation fails → emits failed', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)
			pipeline.getContext('t1')!.githubIssueNumber = 42

			mockExecSync.mockImplementation((cmd: string) => {
				if (cmd.startsWith('git rev-parse')) throw new Error('git failed')
				return ''
			})

			await pipeline.startShipping('t1')

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'failed')
		})
	})

	// ─── startFromGitHubIssue ──────────────────────────────────────────

	describe('startFromGitHubIssue', () => {
		it('calls updateAutonomousFields', async () => {
			mockExecSync.mockImplementation((cmd: string) => {
				if (cmd.includes('symbolic-ref')) return 'origin/main'
				if (cmd.includes('rev-parse')) return 'sha123'
				return ''
			})

			const pipeline = createPipeline(mock.deps)
			const issue = { number: 7, title: 'Bug', body: 'Fix it', labels: [] }

			await pipeline.startFromGitHubIssue('t1', '/proj', issue, 'claude')

			expect(mock.deps.threads.updateAutonomousFields).toHaveBeenCalledWith('t1', {
				autonomous: true,
				reviewRound: 0,
				executorModel: 'claude',
				baseBranch: 'main',
				forkPointSha: 'sha123',
			})
		})

		it('C2 regression: after call, getContext returns context with autonomous=true and correct fields', async () => {
			mockExecSync.mockImplementation((cmd: string) => {
				if (cmd.includes('symbolic-ref')) return 'origin/develop'
				if (cmd.includes('rev-parse')) return 'forksha'
				return ''
			})

			const pipeline = createPipeline(mock.deps)
			const issue = { number: 7, title: 'Bug', body: 'Fix it', labels: [] }

			await pipeline.startFromGitHubIssue('t1', '/proj', issue, 'codex')

			const ctx = pipeline.getContext('t1')
			expect(ctx).toBeDefined()
			expect(ctx!.autonomous).toBe(true)
			expect(ctx!.githubIssueNumber).toBe(7)
			expect(ctx!.baseBranch).toBe('develop')
			expect(ctx!.forkPointSha).toBe('forksha')
			expect(ctx!.executorModel).toBe('codex')
		})

		it('defaults baseBranch to main on failure', async () => {
			mockExecSync.mockImplementation((cmd: string) => {
				if (cmd.includes('symbolic-ref')) throw new Error('no remote HEAD')
				if (cmd.includes('rev-parse')) return 'sha456'
				return ''
			})

			const pipeline = createPipeline(mock.deps)
			const issue = { number: 1, title: 'Test', body: null, labels: [] }

			await pipeline.startFromGitHubIssue('t1', '/proj', issue, 'claude')

			expect(mock.deps.threads.updateAutonomousFields).toHaveBeenCalledWith('t1', expect.objectContaining({
				baseBranch: 'main',
			}))
		})
	})

	// ─── cancel ────────────────────────────────────────────────────────

	describe('cancel', () => {
		it('emits idle, getContext returns undefined after', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', null)

			expect(pipeline.getContext('t1')).toBeDefined()

			pipeline.cancel('t1')

			expect(mock.deps.threads.updateStatus).toHaveBeenCalledWith('t1', 'idle')
			expect(pipeline.getContext('t1')).toBeUndefined()
		})
	})

	// ─── getContext ────────────────────────────────────────────────────

	describe('getContext', () => {
		it('returns context for active pipeline', async () => {
			const pipeline = createPipeline(mock.deps)
			await pipeline.startPlanGeneration('t1', 'do stuff', '/proj', '/worktree')

			const ctx = pipeline.getContext('t1')
			expect(ctx).toBeDefined()
			expect(ctx!.threadId).toBe('t1')
			expect(ctx!.projectPath).toBe('/proj')
			expect(ctx!.worktreePath).toBe('/worktree')
		})

		it('returns undefined for missing pipeline', () => {
			const pipeline = createPipeline(mock.deps)
			expect(pipeline.getContext('nonexistent')).toBeUndefined()
		})
	})
})
