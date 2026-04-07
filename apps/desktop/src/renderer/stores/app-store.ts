import { create } from 'zustand'
import type { CrossCodePlan, PlanReview, PipelinePhase, Project, Thread, SystemHealth, VerificationResult, GitHubIssueCacheRecord } from '@crosscode/shared'

interface AppState {
	// Selection
	activeProjectId: string | null
	activeThreadId: string | null

	// UI state
	sidebarCollapsed: boolean
	terminalVisible: boolean

	// Live data
	currentPlan: CrossCodePlan | null
	currentReview: PlanReview | null
	pipelinePhase: PipelinePhase
	systemHealth: SystemHealth | null

	// Verification & issues
	currentVerification: VerificationResult | null
	githubIssues: GitHubIssueCacheRecord[]
	kanbanView: boolean

	// Agent output buffers
	agentOutputs: Record<string, string[]>

	// Actions
	selectProject: (id: string | null) => void
	selectThread: (id: string | null) => void
	toggleSidebar: () => void
	toggleTerminal: () => void
	setPlan: (plan: CrossCodePlan | null) => void
	setReview: (review: PlanReview | null) => void
	setPipelinePhase: (phase: PipelinePhase) => void
	setSystemHealth: (health: SystemHealth) => void
	setVerification: (verification: VerificationResult | null) => void
	setGithubIssues: (issues: GitHubIssueCacheRecord[]) => void
	toggleKanbanView: () => void
	appendAgentOutput: (processId: string, chunk: string) => void
	clearAgentOutput: (processId: string) => void
}

export const useAppStore = create<AppState>((set) => ({
	activeProjectId: null,
	activeThreadId: null,
	sidebarCollapsed: false,
	terminalVisible: false,
	currentPlan: null,
	currentReview: null,
	pipelinePhase: 'idle',
	systemHealth: null,
	currentVerification: null,
	githubIssues: [],
	kanbanView: false,
	agentOutputs: {},

	selectProject: (id) => set({ activeProjectId: id, activeThreadId: null, currentPlan: null, currentReview: null, currentVerification: null, pipelinePhase: 'idle' }),
	selectThread: (id) => set({ activeThreadId: id, currentPlan: null, currentReview: null, currentVerification: null, pipelinePhase: 'idle' }),
	toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
	toggleTerminal: () => set((s) => ({ terminalVisible: !s.terminalVisible })),
	setPlan: (plan) => set({ currentPlan: plan }),
	setReview: (review) => set({ currentReview: review }),
	setPipelinePhase: (phase) => set({ pipelinePhase: phase }),
	setVerification: (verification) => set({ currentVerification: verification }),
	setGithubIssues: (issues) => set({ githubIssues: issues }),
	toggleKanbanView: () => set((s) => ({ kanbanView: !s.kanbanView })),
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
}))
