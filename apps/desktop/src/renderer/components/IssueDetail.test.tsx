import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IssueDetail } from './IssueDetail'
import { useAppStore } from '../stores/app-store'
import type { GitHubIssueCacheRecord, PlanRecord, Thread } from '@shipcode/shared'

const makeIssue = (overrides: Partial<GitHubIssueCacheRecord> = {}): GitHubIssueCacheRecord => ({
	id: 'issue-1',
	projectId: 'project-1',
	issueNumber: 42,
	title: 'Issue title',
	body: '## Spec body\n\n- first item',
	labels: ['agent:claude'],
	assignee: null,
	state: 'open',
	pipelineStatus: 'todo',
	threadId: null,
	claimedAt: null,
	claimedBy: null,
	lastPhaseUpdate: null,
	lastStatusLabel: null,
	executorModel: 'claude',
	fetchedAt: new Date().toISOString(),
	...overrides,
})

const makeThread = (overrides: Partial<Thread> = {}): Thread => ({
	id: 'thread-1',
	projectId: 'project-1',
	title: 'Thread title',
	prompt: 'Do the thing',
	status: 'awaiting_approval',
	worktreeBranch: null,
	worktreePath: null,
	plannerModel: 'claude',
	reviewerModel: 'codex',
	executorModel: 'claude',
	reviewRound: 0,
	verificationStatus: null,
	verificationRetries: 0,
	autonomous: false,
	baseBranch: null,
	forkPointSha: null,
	githubIssueNumber: 42,
	githubPrNumber: null,
	githubRepo: null,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	...overrides,
})

const makePlan = (overrides: Partial<PlanRecord> = {}): PlanRecord => ({
	id: 'plan-1',
	threadId: 'thread-1',
	version: 1,
	rawOutput: '',
	status: 'pending_review',
	createdAt: new Date().toISOString(),
	structured: {
		id: 'plan-1',
		threadId: 'thread-1',
		version: 1,
		objective: 'Implement issue detail controls',
		files: [{ path: 'apps/desktop/src/renderer/components/IssueDetail.tsx', action: 'modify', description: 'Update issue detail' }],
		steps: [{ order: 1, description: 'Render issue actions', files: ['apps/desktop/src/renderer/components/IssueDetail.tsx'], rationale: 'Needed for approve/reject flow' }],
		acceptanceCriteria: ['Users can approve or reject from the issue panel'],
		outOfScope: [],
		estimatedComplexity: 'medium',
		dependencies: [],
	},
	...overrides,
})

function renderWithProviders() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				refetchOnWindowFocus: false,
			},
		},
	})

	return render(
		<QueryClientProvider client={queryClient}>
			<IssueDetail />
		</QueryClientProvider>,
	)
}

describe('IssueDetail', () => {
	const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>()

	beforeEach(() => {
		cleanup()
		invokeMock.mockReset()
		window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke
		window.shipcode.on = vi.fn(() => () => {}) as unknown as typeof window.shipcode.on

		useAppStore.setState({
			activeProjectId: 'project-1',
			activeThreadId: null,
			activeIssue: makeIssue(),
			sidebarCollapsed: false,
			terminalVisible: false,
			settingsVisible: false,
			currentPlan: null,
			currentReview: null,
			pipelinePhase: 'idle',
			systemHealth: null,
			currentVerification: null,
			githubIssues: [],
			agentOutputs: {},
			commandPaletteOpen: false,
			createIssueModalOpen: false,
		})
	})

	afterEach(() => {
		cleanup()
	})

	it('renders issue body as markdown', async () => {
		invokeMock.mockResolvedValue([])

		renderWithProviders()

		expect(screen.getByText('Spec body')).toBeInTheDocument()
		expect(screen.getByText('first item')).toBeInTheDocument()
		expect(screen.getByText('Start Pipeline')).toBeInTheDocument()
	})

	it('starts pipeline from an unclaimed issue', async () => {
		invokeMock.mockImplementation(async (channel) => {
			if (channel === 'github:start-issue') return undefined
			if (channel === 'thread') return null
			return []
		})

		renderWithProviders()
		fireEvent.click(screen.getByRole('button', { name: 'Start Pipeline' }))

		await waitFor(() => {
			expect(invokeMock).toHaveBeenCalledWith('github:start-issue', {
				projectId: 'project-1',
				issueNumber: 42,
			})
		})
	})

	it('supports approve and reject actions when the thread is awaiting approval', async () => {
		const thread = makeThread()
		const plan = makePlan()

		useAppStore.setState({
			activeThreadId: thread.id,
			activeIssue: makeIssue({ threadId: thread.id, pipelineStatus: 'reviewing' }),
			pipelinePhase: 'awaiting_approval',
		})

		invokeMock.mockImplementation(async (channel, args) => {
			if (channel === 'thread:get') return thread
			if (channel === 'plan:list') return [plan]
			if (channel === 'review:list-by-plans') return {}
			if (channel === 'pipeline:approve') return undefined
			if (channel === 'pipeline:reject') return undefined
			if (channel === 'github:refresh-issues') return []
			if (channel === 'github:list-issues') return [makeIssue({ threadId: thread.id, pipelineStatus: 'reviewing' })]
			if (channel === 'thread:list') return [thread]
			return args ?? null
		})

		renderWithProviders()

		const approveButton = await screen.findByRole('button', { name: 'Approve & Execute' })
		fireEvent.click(approveButton)

		await waitFor(() => {
			expect(invokeMock).toHaveBeenCalledWith('pipeline:approve', { threadId: thread.id })
		})

		fireEvent.click(screen.getByRole('button', { name: 'Request Changes' }))
		fireEvent.change(screen.getByPlaceholderText('Describe what should change before execution...'), {
			target: { value: 'Please tighten the acceptance criteria.' },
		})
		fireEvent.click(screen.getByRole('button', { name: 'Submit Feedback' }))

		await waitFor(() => {
			expect(invokeMock).toHaveBeenCalledWith('pipeline:reject', {
				threadId: thread.id,
				feedback: 'Please tighten the acceptance criteria.',
			})
		})
	})
})
