import type {
  AgentState,
  CanonicalTerminalEvent,
  GitHubIssueCacheRecord,
  IssuePipelineStatus,
  NotificationRecord,
  PipelinePhase,
  PlanReview,
  ShipCodePlan,
  SystemHealth,
  TerminalEventRecord,
  VerificationResult,
} from '@shipcode/shared';
import { ISSUE_PIPELINE_STATUS, PIPELINE_PHASE } from '@shipcode/shared';
import { create } from 'zustand';

const AGENT_ACTIVE_STATUSES = new Set<IssuePipelineStatus>([
  ISSUE_PIPELINE_STATUS.planning,
  ISSUE_PIPELINE_STATUS.reviewing,
  ISSUE_PIPELINE_STATUS.revising,
  ISSUE_PIPELINE_STATUS.executing,
  ISSUE_PIPELINE_STATUS.verifying,
  ISSUE_PIPELINE_STATUS.shipping,
]);
const MAX_CANONICAL_TERMINAL_EVENTS = 2000;

function dedupeTerminalEvents(events: TerminalEventRecord[]): TerminalEventRecord[] {
  return Array.from(new Map(events.map((event) => [event.id, event])).values());
}

// Module-level index cache: avoids O(n) Map rebuild on every upsert call.
// Keyed by threadId → (eventId → index in the array). Reset on hydrate.
const _terminalIdIndex = new Map<string, Map<string, number>>();

function getOrCreateIndex(threadId: string, events: TerminalEventRecord[]): Map<string, number> {
  let index = _terminalIdIndex.get(threadId);
  if (!index || index.size !== events.length) {
    index = new Map(events.map((e, i) => [e.id, i]));
    _terminalIdIndex.set(threadId, index);
  }
  return index;
}

function upsertTerminalEvents(
  threadId: string,
  previous: TerminalEventRecord[],
  incoming: TerminalEventRecord[],
): TerminalEventRecord[] {
  const indexById = getOrCreateIndex(threadId, previous);
  const merged = [...previous];

  for (const event of incoming) {
    const existingIndex = indexById.get(event.id);
    if (existingIndex == null) {
      indexById.set(event.id, merged.length);
      merged.push(event);
      continue;
    }
    merged[existingIndex] = event;
  }

  if (merged.length > MAX_CANONICAL_TERMINAL_EVENTS) {
    const trimmed = merged.slice(-MAX_CANONICAL_TERMINAL_EVENTS);
    // Rebuild the index for the trimmed array
    const newIndex = new Map(trimmed.map((e, i) => [e.id, i]));
    _terminalIdIndex.set(threadId, newIndex);
    return trimmed;
  }
  return merged;
}

type ViewMode = 'overview' | 'project' | 'activity' | 'inbox' | 'costs' | 'skills' | 'automations';

export type ProjectTab = 'issues' | 'git' | 'code' | 'pull-requests' | 'terminal' | 'insights';
export type TerminalPaneMode = 'replay' | 'live';
export type AssistantCli = 'claude' | 'codex';
export interface AssistantUserMessage {
  id: string;
  threadId: string;
  content: string;
  createdAt: string;
}
export type SettingsSection =
  | 'about'
  | 'general'
  | 'integrations'
  | 'github'
  | 'notifications'
  | 'pipeline'
  | 'shortcuts'
  | 'archived'
  | 'developer'
  | 'auto-commit';

interface AppState {
  // Selection
  activeProjectId: string | null;
  activeThreadId: string | null;
  activeIssue: GitHubIssueCacheRecord | null;
  activeAutomationThreadId: string | null;
  activeAutomationDetailId: string | null;

  // UI state
  viewMode: ViewMode;
  sidebarCollapsed: boolean;
  terminalVisible: boolean;
  terminalMaximized: boolean;
  settingsVisible: boolean;
  settingsSection: SettingsSection;
  assistantVisible: boolean;
  assistantDraft: string;
  assistantQueuedPrompt: string | null;
  assistantThreadId: string | null;
  assistantCli: AssistantCli;
  assistantUserMessages: AssistantUserMessage[];
  commentComposerRequest: { issueId: string; requestId: number } | null;

  // Live data
  currentPlan: ShipCodePlan | null;
  currentReview: PlanReview | null;
  pipelinePhase: PipelinePhase;
  systemHealth: SystemHealth | null;

  // Verification & issues
  currentVerification: VerificationResult | null;
  githubIssues: GitHubIssueCacheRecord[];
  pendingCreatedIssues: GitHubIssueCacheRecord[];

  // Agent output buffers
  agentOutputs: Record<string, string[]>;

  // processId → threadId mapping (populated when agent:state 'running' fires after pipeline:phase)
  processToThread: Record<string, string>;

  // Terminal event log (phase transitions, process lifecycle — resets on thread switch)
  terminalEvents: string[];

  // Terminal per-thread tracking
  terminalThreadId: string | null;
  terminalEventsByThread: Record<string, string[]>;

  // Timestamp of last agent output chunk received, keyed by threadId
  lastActivityByThread: Record<string, number>;

  // Currently running model per thread (from pipeline:model-resolved)
  currentModels: Record<string, string>;

  // Canonical terminal event stream (normalized across all providers)
  canonicalTerminalStream: Record<string, TerminalEventRecord[]>;

  // Notifications (in-app toaster + history)
  notifications: NotificationRecord[];

  // Command palette & modals
  commandPaletteOpen: boolean;
  createIssueModalOpen: boolean;
  editingPrd: { issueNumber: number; body: string; labels: string[] } | null;
  projectSettingsModalOpen: boolean;
  projectSettingsModalProjectId: string | null;
  projectSettingsModalInitialTab: string | null;
  createAutomationModalOpen: boolean;
  editingAutomationId: string | null;
  addProjectExplorerOpen: boolean;

  // Project tab
  projectTab: ProjectTab;
  activePrNumber: number | null;
  pendingGitWorktreePath: string | null;

  // Terminal pane sessions
  terminalPaneThreadIds: string[];
  terminalSplitDirection: 'horizontal' | 'vertical';
  terminalPaneMetaByThread: Record<
    string,
    {
      mode: TerminalPaneMode;
      title?: string | null;
      cli?: 'claude' | 'codex' | 'shell';
      state?: AgentState;
    }
  >;

  // Actions
  setViewMode: (mode: ViewMode) => void;
  openOverview: () => void;
  openActivity: () => void;
  openInbox: () => void;
  openCosts: () => void;
  openSkills: () => void;
  openAutomations: () => void;
  selectProject: (id: string | null) => void;
  selectThread: (id: string | null) => void;
  selectIssue: (issue: GitHubIssueCacheRecord | null) => void;
  selectAutomationThread: (threadId: string | null) => void;
  openAutomationDetail: (automationId: string) => void;
  toggleSidebar: () => void;
  toggleTerminal: () => void;
  openTerminal: () => void;
  setTerminalMaximized: (maximized: boolean) => void;
  toggleSettings: () => void;
  setSettingsSection: (section: SettingsSection) => void;
  openAssistant: () => void;
  closeAssistant: () => void;
  setAssistantDraft: (draft: string) => void;
  queueAssistantPrompt: (prompt: string) => void;
  clearAssistantQueuedPrompt: () => void;
  setAssistantThread: (threadId: string | null) => void;
  setAssistantCli: (cli: AssistantCli) => void;
  appendAssistantUserMessage: (message: Omit<AssistantUserMessage, 'id' | 'createdAt'>) => void;
  setPlan: (plan: ShipCodePlan | null) => void;
  setReview: (review: PlanReview | null) => void;
  setPipelinePhase: (phase: PipelinePhase) => void;
  setSystemHealth: (health: SystemHealth) => void;
  setVerification: (verification: VerificationResult | null) => void;
  setGithubIssues: (issues: GitHubIssueCacheRecord[]) => void;
  addPendingCreatedIssue: (issue: GitHubIssueCacheRecord) => void;
  removePendingCreatedIssue: (id: string) => void;
  appendAgentOutput: (processId: string, chunk: string) => void;
  clearAgentOutput: (processId: string) => void;
  mapProcessToThread: (processId: string, threadId: string) => void;
  logTerminalEvent: (line: string) => void;
  setTerminalThread: (id: string | null) => void;
  logTerminalEventForThread: (threadId: string, line: string) => void;
  touchLastActivity: (threadId: string) => void;
  setCurrentModel: (threadId: string, model: string) => void;
  appendCanonicalEvent: (
    threadId: string,
    event: CanonicalTerminalEvent,
    meta?: Pick<TerminalEventRecord, 'id' | 'createdAt'>,
  ) => void;
  appendCanonicalEvents: (threadId: string, events: TerminalEventRecord[]) => void;
  hydrateCanonicalEvents: (threadId: string, events: TerminalEventRecord[]) => void;
  addNotification: (notification: NotificationRecord) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  requestCommentComposer: (issueId: string) => void;
  toggleCommandPalette: () => void;
  openCreateIssueModal: () => void;
  openEditPrdModal: (issueNumber: number, body: string, labels: string[]) => void;
  closeCreateIssueModal: () => void;
  openProjectSettingsModal: (projectId: string, initialTab?: string) => void;
  closeProjectSettingsModal: () => void;
  openCreateAutomationModal: (id?: string) => void;
  closeCreateAutomationModal: () => void;
  openAddProjectExplorer: () => void;
  closeAddProjectExplorer: () => void;

  // Cross-project navigation
  navigateToIssue: (projectId: string, issue: GitHubIssueCacheRecord) => void;
  navigateToGitWorktree: (projectId: string, worktreePath: string) => void;
  clearPendingGitWorktreePath: () => void;
  openCommandPalette: () => void;

  // Project tab actions
  setProjectTab: (tab: ProjectTab) => void;
  setActivePrNumber: (n: number | null) => void;

  // Terminal pane actions
  openTerminalTab: () => void;
  addTerminalPane: (
    threadId: string,
    meta?: {
      mode?: TerminalPaneMode;
      title?: string | null;
      cli?: 'claude' | 'codex' | 'shell';
      state?: AgentState;
    },
  ) => void;
  removeTerminalPane: (threadId: string) => void;
  setTerminalSplitDirection: (dir: 'horizontal' | 'vertical') => void;
  setTerminalPaneState: (threadId: string, state: AgentState) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  activeProjectId: null,
  activeThreadId: null,
  activeIssue: null,
  activeAutomationThreadId: null,
  activeAutomationDetailId: null,
  viewMode: 'overview',
  sidebarCollapsed: false,
  terminalVisible: false,
  terminalMaximized: false,
  settingsVisible: false,
  settingsSection: 'general' as SettingsSection,
  assistantVisible: false,
  assistantDraft: '',
  assistantQueuedPrompt: null,
  assistantThreadId: null,
  assistantCli: 'claude',
  assistantUserMessages: [],
  commentComposerRequest: null,
  currentPlan: null,
  currentReview: null,
  pipelinePhase: PIPELINE_PHASE.idle,
  systemHealth: null,
  currentVerification: null,
  githubIssues: [],
  pendingCreatedIssues: [],
  agentOutputs: {},
  processToThread: {},
  terminalEvents: [],
  terminalThreadId: null,
  terminalEventsByThread: {},
  lastActivityByThread: {},
  notifications: [],
  commandPaletteOpen: false,
  createIssueModalOpen: false,
  editingPrd: null,
  projectSettingsModalOpen: false,
  projectSettingsModalProjectId: null,
  projectSettingsModalInitialTab: null,
  createAutomationModalOpen: false,
  editingAutomationId: null,
  addProjectExplorerOpen: false,
  projectTab: 'issues' as ProjectTab,
  activePrNumber: null,
  pendingGitWorktreePath: null,
  terminalPaneThreadIds: [],
  terminalSplitDirection: 'horizontal',
  terminalPaneMetaByThread: {},
  currentModels: {},
  canonicalTerminalStream: {},

  setViewMode: (mode) => set({ viewMode: mode }),
  openOverview: () =>
    set({
      viewMode: 'overview',
      activeIssue: null,
      activeAutomationThreadId: null,
      activeAutomationDetailId: null,
      terminalMaximized: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    }),
  openActivity: () =>
    set({
      viewMode: 'activity',
      activeIssue: null,
      activeAutomationThreadId: null,
      activeAutomationDetailId: null,
      terminalMaximized: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    }),
  openInbox: () =>
    set({
      viewMode: 'inbox',
      activeIssue: null,
      activeAutomationThreadId: null,
      activeAutomationDetailId: null,
      terminalMaximized: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    }),
  openCosts: () =>
    set({
      viewMode: 'costs',
      activeIssue: null,
      activeAutomationThreadId: null,
      activeAutomationDetailId: null,
      terminalMaximized: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    }),
  openSkills: () =>
    set({
      viewMode: 'skills',
      activeIssue: null,
      activeAutomationThreadId: null,
      activeAutomationDetailId: null,
      terminalMaximized: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    }),
  openAutomations: () =>
    set({
      viewMode: 'automations',
      activeIssue: null,
      activeAutomationThreadId: null,
      activeAutomationDetailId: null,
      terminalMaximized: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    }),
  selectProject: (id) =>
    set({
      activeProjectId: id,
      activeThreadId: null,
      activeIssue: null,
      activeAutomationThreadId: null,
      activeAutomationDetailId: null,
      terminalMaximized: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
      pipelinePhase: PIPELINE_PHASE.idle,
      viewMode: 'project',
      projectTab: 'issues' as ProjectTab,
      pendingGitWorktreePath: null,
      githubIssues: [],
    }),
  selectThread: (id) =>
    set({
      activeThreadId: id,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
      pipelinePhase: PIPELINE_PHASE.idle,
      viewMode: 'project',
    }),
  selectIssue: (issue) =>
    set((s) => ({
      activeIssue: issue,
      activeAutomationThreadId: null,
      activeAutomationDetailId: null,
      activeThreadId: issue?.threadId ?? null,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
      pipelinePhase: PIPELINE_PHASE.idle,
      terminalEvents: [],
      // Console is decoupled from the detail view: closing detail (issue=null)
      // must keep the current console pin so the user can still read output.
      // Switching to another issue re-pins the console to that thread.
      terminalThreadId: issue ? (issue.threadId ?? null) : s.terminalThreadId,
      terminalMaximized: issue ? s.terminalMaximized : false,
      // Auto-open terminal when the selected issue has an agent actively running.
      terminalVisible:
        issue && AGENT_ACTIVE_STATUSES.has(issue.pipelineStatus) ? true : s.terminalVisible,
    })),
  selectAutomationThread: (threadId) =>
    set((s) => ({
      activeAutomationThreadId: threadId,
      activeAutomationDetailId: null,
      activeThreadId: threadId,
      activeIssue: null,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
      pipelinePhase: PIPELINE_PHASE.idle,
      terminalEvents: [],
      terminalThreadId: threadId ?? s.terminalThreadId,
    })),
  openAutomationDetail: (automationId) =>
    set({
      activeAutomationDetailId: automationId,
      activeAutomationThreadId: null,
      activeIssue: null,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
      terminalMaximized: false,
    }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleTerminal: () =>
    set((s) => ({
      terminalVisible: !s.terminalVisible,
      terminalMaximized: s.terminalVisible ? false : s.terminalMaximized,
    })),
  openTerminal: () => set({ terminalVisible: true, terminalMaximized: false }),
  setTerminalMaximized: (maximized) => set({ terminalMaximized: maximized }),
  toggleSettings: () =>
    set((s) => {
      const nextSettingsVisible = !s.settingsVisible;
      return {
        settingsVisible: nextSettingsVisible,
        settingsSection: 'general' as SettingsSection,
        terminalVisible: nextSettingsVisible ? false : s.terminalVisible,
        terminalMaximized: nextSettingsVisible ? false : s.terminalMaximized,
      };
    }),
  setSettingsSection: (section) => set({ settingsSection: section }),
  openAssistant: () => set({ assistantVisible: true }),
  closeAssistant: () => set({ assistantVisible: false }),
  setAssistantDraft: (draft) => set({ assistantDraft: draft }),
  queueAssistantPrompt: (prompt) =>
    set({
      assistantVisible: true,
      assistantDraft: prompt,
      assistantQueuedPrompt: prompt,
    }),
  clearAssistantQueuedPrompt: () => set({ assistantQueuedPrompt: null }),
  setAssistantThread: (threadId) => set({ assistantThreadId: threadId }),
  setAssistantCli: (cli) => set({ assistantCli: cli }),
  appendAssistantUserMessage: (message) =>
    set((s) => ({
      assistantUserMessages: [
        ...s.assistantUserMessages,
        {
          ...message,
          id: `${message.threadId}:${Date.now()}:${s.assistantUserMessages.length}`,
          createdAt: new Date().toISOString(),
        },
      ].slice(-200),
    })),
  setPlan: (plan) => set({ currentPlan: plan }),
  setReview: (review) => set({ currentReview: review }),
  setPipelinePhase: (phase) =>
    set((s) =>
      phase === PIPELINE_PHASE.idle
        ? { pipelinePhase: phase }
        : {
            pipelinePhase: phase,
            // Only auto-open on the first transition INTO an active run (e.g. idle/queued -> planning).
            // If the user closes the terminal mid-run, subsequent phase events (reviewing,
            // executing, verifying) must not reopen it.
            terminalVisible:
              AGENT_ACTIVE_STATUSES.has(phase as IssuePipelineStatus) &&
              !AGENT_ACTIVE_STATUSES.has(s.pipelinePhase as IssuePipelineStatus)
                ? true
                : s.terminalVisible,
          },
    ),
  setVerification: (verification) => set({ currentVerification: verification }),
  setGithubIssues: (issues) => set({ githubIssues: issues }),
  addPendingCreatedIssue: (issue) =>
    set((s) => ({
      pendingCreatedIssues: [
        issue,
        ...s.pendingCreatedIssues.filter((candidate) => candidate.id !== issue.id),
      ],
    })),
  removePendingCreatedIssue: (id) =>
    set((s) => ({
      pendingCreatedIssues: s.pendingCreatedIssues.filter((issue) => issue.id !== id),
    })),
  setSystemHealth: (health) => set({ systemHealth: health }),
  appendAgentOutput: (processId, chunk) =>
    set((s) => {
      const prev = s.agentOutputs[processId] ?? [];
      const next = prev.length >= 800 ? [...prev.slice(-799), chunk] : [...prev, chunk];
      return { agentOutputs: { ...s.agentOutputs, [processId]: next } };
    }),
  clearAgentOutput: (processId) =>
    set((s) => {
      const { [processId]: _, ...rest } = s.agentOutputs;
      return { agentOutputs: rest };
    }),
  mapProcessToThread: (processId, threadId) =>
    set((s) => ({ processToThread: { ...s.processToThread, [processId]: threadId } })),
  logTerminalEvent: (line) =>
    set((s) => {
      const next = [...s.terminalEvents, line];
      return { terminalEvents: next.length > 500 ? next.slice(-500) : next };
    }),
  setTerminalThread: (id) => set({ terminalThreadId: id }),
  setCurrentModel: (threadId, model) =>
    set((s) => ({ currentModels: { ...s.currentModels, [threadId]: model } })),
  logTerminalEventForThread: (threadId, line) =>
    set((s) => {
      const prev = s.terminalEventsByThread[threadId] ?? [];
      const next = prev.length >= 200 ? [...prev.slice(-199), line] : [...prev, line];
      return { terminalEventsByThread: { ...s.terminalEventsByThread, [threadId]: next } };
    }),
  appendCanonicalEvent: (threadId, event, meta) =>
    set((s) => {
      const prev = s.canonicalTerminalStream[threadId] ?? [];
      const record: TerminalEventRecord = {
        id: meta?.id ?? `${threadId}:${Date.now()}:${prev.length}`,
        threadId,
        event,
        createdAt: meta?.createdAt ?? new Date().toISOString(),
      };
      const trimmed = upsertTerminalEvents(threadId, prev, [record]);
      return { canonicalTerminalStream: { ...s.canonicalTerminalStream, [threadId]: trimmed } };
    }),
  appendCanonicalEvents: (threadId, events) =>
    set((s) => {
      if (events.length === 0) return s;
      const prev = s.canonicalTerminalStream[threadId] ?? [];
      const trimmed = upsertTerminalEvents(threadId, prev, events);
      return { canonicalTerminalStream: { ...s.canonicalTerminalStream, [threadId]: trimmed } };
    }),
  hydrateCanonicalEvents: (threadId, events) =>
    set((s) => {
      const prev = s.canonicalTerminalStream[threadId] ?? [];
      const merged = [...prev, ...events].sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.id.localeCompare(b.id)
          : a.createdAt.localeCompare(b.createdAt),
      );
      const deduped = dedupeTerminalEvents(merged);
      const trimmed =
        deduped.length >= MAX_CANONICAL_TERMINAL_EVENTS
          ? deduped.slice(-MAX_CANONICAL_TERMINAL_EVENTS)
          : deduped;
      // Reset the index cache for this thread since we rebuilt from scratch
      _terminalIdIndex.delete(threadId);
      return { canonicalTerminalStream: { ...s.canonicalTerminalStream, [threadId]: trimmed } };
    }),
  touchLastActivity: (threadId) =>
    set((s) => ({ lastActivityByThread: { ...s.lastActivityByThread, [threadId]: Date.now() } })),
  addNotification: (notification) =>
    set((s) => {
      // Replace existing record with same id (re-fired) or prepend new.
      const filtered = s.notifications.filter((n) => n.id !== notification.id);
      return { notifications: [notification, ...filtered] };
    }),
  removeNotification: (id) =>
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),
  clearNotifications: () => set({ notifications: [] }),
  requestCommentComposer: (issueId) =>
    set((s) => ({
      commentComposerRequest: {
        issueId,
        requestId: (s.commentComposerRequest?.requestId ?? 0) + 1,
      },
    })),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  openCreateIssueModal: () =>
    set({ createIssueModalOpen: true, editingPrd: null, commandPaletteOpen: false }),
  openEditPrdModal: (issueNumber, body, labels) =>
    set({
      createIssueModalOpen: true,
      editingPrd: { issueNumber, body, labels },
      commandPaletteOpen: false,
    }),
  closeCreateIssueModal: () => set({ createIssueModalOpen: false, editingPrd: null }),
  openProjectSettingsModal: (projectId, initialTab) =>
    set({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: projectId,
      projectSettingsModalInitialTab: initialTab ?? null,
      commandPaletteOpen: false,
    }),
  closeProjectSettingsModal: () =>
    set({
      projectSettingsModalOpen: false,
      projectSettingsModalProjectId: null,
      projectSettingsModalInitialTab: null,
    }),
  openCreateAutomationModal: (id) =>
    set({
      createAutomationModalOpen: true,
      editingAutomationId: id ?? null,
      commandPaletteOpen: false,
    }),
  closeCreateAutomationModal: () =>
    set({ createAutomationModalOpen: false, editingAutomationId: null }),
  openAddProjectExplorer: () => set({ addProjectExplorerOpen: true, commandPaletteOpen: false }),
  closeAddProjectExplorer: () => set({ addProjectExplorerOpen: false }),
  // Cross-project navigation
  navigateToIssue: (projectId, issue) =>
    set((s) => ({
      activeProjectId: projectId,
      activeAutomationThreadId: null,
      activeAutomationDetailId: null,
      viewMode: 'project',
      projectTab: 'issues' as ProjectTab,
      activeIssue: issue,
      activeThreadId: issue.threadId ?? null,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
      pipelinePhase: PIPELINE_PHASE.idle,
      terminalEvents: [],
      terminalThreadId: issue.threadId ?? null,
      terminalMaximized: s.terminalMaximized,
      terminalVisible: AGENT_ACTIVE_STATUSES.has(issue.pipelineStatus) ? true : s.terminalVisible,
      commandPaletteOpen: false,
    })),
  navigateToGitWorktree: (projectId, worktreePath) =>
    set({
      activeProjectId: projectId,
      activeThreadId: null,
      activeIssue: null,
      activeAutomationThreadId: null,
      activeAutomationDetailId: null,
      terminalMaximized: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
      pipelinePhase: PIPELINE_PHASE.idle,
      viewMode: 'project',
      projectTab: 'git' as ProjectTab,
      pendingGitWorktreePath: worktreePath,
      githubIssues: [],
    }),
  clearPendingGitWorktreePath: () => set({ pendingGitWorktreePath: null }),
  openCommandPalette: () => set({ commandPaletteOpen: true }),

  // Project tab actions
  setProjectTab: (tab) =>
    set({
      projectTab: tab,
      activeIssue: null,
      activeThreadId: null,
      activeAutomationThreadId: null,
      activeAutomationDetailId: null,
    }),
  setActivePrNumber: (n) => set({ activePrNumber: n }),

  openTerminalTab: () => {
    const { activeProjectId } = get();
    if (!activeProjectId) return;
    set({
      viewMode: 'project',
      projectTab: 'terminal' as ProjectTab,
      activeIssue: null,
      activeAutomationThreadId: null,
      activeAutomationDetailId: null,
      terminalMaximized: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    });
  },
  addTerminalPane: (threadId, meta) =>
    set((s) => {
      const nextIds = s.terminalPaneThreadIds.includes(threadId)
        ? s.terminalPaneThreadIds
        : [...s.terminalPaneThreadIds, threadId].slice(0, 4);
      const existingMeta = s.terminalPaneMetaByThread[threadId];
      const nextMeta = {
        ...existingMeta,
        mode: meta?.mode ?? existingMeta?.mode ?? 'replay',
        title: meta?.title ?? existingMeta?.title ?? null,
        cli: meta?.cli ?? existingMeta?.cli,
        state: meta?.state ?? existingMeta?.state,
      };
      return {
        terminalPaneThreadIds: nextIds,
        terminalPaneMetaByThread: {
          ...s.terminalPaneMetaByThread,
          [threadId]: nextMeta,
        },
      };
    }),
  removeTerminalPane: (threadId) =>
    set((s) => ({
      terminalPaneThreadIds: s.terminalPaneThreadIds.filter((id) => id !== threadId),
      terminalPaneMetaByThread: Object.fromEntries(
        Object.entries(s.terminalPaneMetaByThread).filter(([id]) => id !== threadId),
      ),
    })),
  setTerminalSplitDirection: (dir) => set({ terminalSplitDirection: dir }),
  setTerminalPaneState: (threadId, state) =>
    set((s) => {
      const existing = s.terminalPaneMetaByThread[threadId];
      if (!existing) return s;
      return {
        terminalPaneMetaByThread: {
          ...s.terminalPaneMetaByThread,
          [threadId]: { ...existing, state },
        },
      };
    }),
}));
