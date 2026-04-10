import { create } from 'zustand'
import type { ShipCodePlan, PlanReview, PipelinePhase, SystemHealth, VerificationResult, GitHubIssueCacheRecord } from '@shipcode/shared'

interface AppState {
	// Selection
	activeProjectId: string | null
	activeThreadId: string | null
	activeIssue: GitHubIssueCacheRecord | null

	// UI state
	sidebarCollapsed: boolean
	terminalVisible: boolean
	settingsVisible: boolean

	// Live data
	currentPlan: ShipCodePlan | null
	currentReview: PlanReview | null
	pipelinePhase: PipelinePhase
	systemHealth: SystemHealth | null

	// Verification & issues
	currentVerification: VerificationResult | null
	githubIssues: GitHubIssueCacheRecord[]

	// Agent output buffers
	agentOutputs: Record<string, string[]>

	// Command palette & modals
	commandPaletteOpen: boolean
	createIssueModalOpen: boolean
	editingPrd: { issueNumber: number; body: string } | null

	// Actions
	selectProject: (id: string | null) => void
	selectThread: (id: string | null) => void
	selectIssue: (issue: GitHubIssueCacheRecord | null) => void
	toggleSidebar: () => void
	toggleTerminal: () => void
	toggleSettings: () => void
	setPlan: (plan: ShipCodePlan | null) => void
	setReview: (review: PlanReview | null) => void
	setPipelinePhase: (phase: PipelinePhase) => void
	setSystemHealth: (health: SystemHealth) => void
	setVerification: (verification: VerificationResult | null) => void
	setGithubIssues: (issues: GitHubIssueCacheRecord[]) => void
	appendAgentOutput: (processId: string, chunk: string) => void
	clearAgentOutput: (processId: string) => void
	toggleCommandPalette: () => void
	openCreateIssueModal: () => void
	openEditPrdModal: (issueNumber: number, body: string) => void
	closeCreateIssueModal: () => void
}

export const useAppStore = create<AppState>((set) => ({
	activeProjectId: null,
	activeThreadId: null,
	activeIssue: null,
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
	editingPrd: null,

	selectProject: (id) => set({ activeProjectId: id, activeThreadId: null, activeIssue: null, currentPlan: null, currentReview: null, currentVerification: null, pipelinePhase: 'idle' }),
	selectThread: (id) => set({ activeThreadId: id, currentPlan: null, currentReview: null, currentVerification: null, pipelinePhase: 'idle' }),
	selectIssue: (issue) => set({
		activeIssue: issue,
		activeThreadId: issue?.threadId ?? null,
		currentPlan: null,
		currentReview: null,
		currentVerification: null,
		pipelinePhase: 'idle',
	}),
	toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
	toggleTerminal: () => set((s) => ({ terminalVisible: !s.terminalVisible })),
	toggleSettings: () => set((s) => ({ settingsVisible: !s.settingsVisible })),
	setPlan: (plan) => set({ currentPlan: plan }),
	setReview: (review) => set({ currentReview: review }),
	setPipelinePhase: (phase) => set({ pipelinePhase: phase }),
	setVerification: (verification) => set({ currentVerification: verification }),
	setGithubIssues: (issues) => set({ githubIssues: issues }),
	setSystemHealth: (health) => set({ systemHealth: health }),
	appendAgentOutput: (processId, chunk) =>
		set((s) => ({
			agentOutputs: {
				...s.agentOutputs,
				[processId]: [...(s.agentOutputs[processId] ?? []), chunk],
			},
		})),
	clearAgentOutput: (processId) =>
		set((s) => {
			const { [processId]: _, ...rest } = s.agentOutputs
			return { agentOutputs: rest }
		}),
	toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
	openCreateIssueModal: () => set({ createIssueModalOpen: true, editingPrd: null, commandPaletteOpen: false }),
	openEditPrdModal: (issueNumber, body) => set({
		createIssueModalOpen: true,
		editingPrd: { issueNumber, body },
		commandPaletteOpen: false,
	}),
	closeCreateIssueModal: () => set({ createIssueModalOpen: false, editingPrd: null }),
}))
