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
import { create } from 'zustand';

const AGENT_ACTIVE_STATUSES = new Set<IssuePipelineStatus>([
  'planning',
  'reviewing',
  'revising',
  'executing',
  'verifying',
  'shipping',
]);
const MAX_CANONICAL_TERMINAL_EVENTS = 2000;

function dedupeTerminalEvents(events: TerminalEventRecord[]): TerminalEventRecord[] {
  return Array.from(new Map(events.map((event) => [event.id, event])).values());
}

function upsertTerminalEvents(
  previous: TerminalEventRecord[],
  incoming: TerminalEventRecord[],
): TerminalEventRecord[] {
  if (incoming.length === 0) return previous;

  const merged = [...previous];
  const indexById = new Map<string, number>();
  previous.forEach((event, index) => {
    indexById.set(event.id, index);
  });

  for (const event of incoming) {
    const existingIndex = indexById.get(event.id);
    if (existingIndex == null) {
      indexById.set(event.id, merged.length);
      merged.push(event);
      continue;
    }
    merged[existingIndex] = event;
  }

  return merged.length > MAX_CANONICAL_TERMINAL_EVENTS
    ? merged.slice(-MAX_CANONICAL_TERMINAL_EVENTS)
    : merged;
}

export type ViewMode = 'overview' | 'project' | 'activity' | 'inbox' | 'costs' | 'skills';

export type ProjectTab = 'issues' | 'git' | 'pull-requests' | 'sessions';
export type InstantPaneMode = 'replay' | 'live';
export type SettingsSection =
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

  // UI state
  viewMode: ViewMode;
  sidebarCollapsed: boolean;
  terminalVisible: boolean;
  terminalMaximized: boolean;
  settingsVisible: boolean;
  settingsSection: SettingsSection;
  issueDetailExpanded: boolean;
  issueDetailCollapsed: boolean;
  issueDetailWidth: number;
  commentComposerRequest: { issueId: string; requestId: number } | null;

  // Live data
  currentPlan: ShipCodePlan | null;
  currentReview: PlanReview | null;
  pipelinePhase: PipelinePhase;
  systemHealth: SystemHealth | null;

  // Verification & issues
  currentVerification: VerificationResult | null;
  githubIssues: GitHubIssueCacheRecord[];

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

  // Project tab
  projectTab: ProjectTab;
  activePrNumber: number | null;

  // Instant terminal sessions
  instantPaneThreadIds: string[];
  instantSplitDirection: 'horizontal' | 'vertical';
  instantPaneMetaByThread: Record<
    string,
    {
      mode: InstantPaneMode;
      title?: string | null;
      cli?: 'claude' | 'codex';
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
  selectProject: (id: string | null) => void;
  selectThread: (id: string | null) => void;
  selectIssue: (issue: GitHubIssueCacheRecord | null) => void;
  toggleSidebar: () => void;
  toggleTerminal: () => void;
  openTerminal: () => void;
  setTerminalMaximized: (maximized: boolean) => void;
  toggleSettings: () => void;
  setSettingsSection: (section: SettingsSection) => void;
  setPlan: (plan: ShipCodePlan | null) => void;
  setReview: (review: PlanReview | null) => void;
  setPipelinePhase: (phase: PipelinePhase) => void;
  setSystemHealth: (health: SystemHealth) => void;
  setVerification: (verification: VerificationResult | null) => void;
  setGithubIssues: (issues: GitHubIssueCacheRecord[]) => void;
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
  toggleIssueDetailExpanded: () => void;
  toggleIssueDetail: () => void;
  setIssueDetailWidth: (width: number) => void;
  requestCommentComposer: (issueId: string) => void;
  toggleCommandPalette: () => void;
  openCreateIssueModal: () => void;
  openEditPrdModal: (issueNumber: number, body: string, labels: string[]) => void;
  closeCreateIssueModal: () => void;
  openProjectSettingsModal: (projectId: string, initialTab?: string) => void;
  closeProjectSettingsModal: () => void;

  // Cross-project navigation
  navigateToIssue: (projectId: string, issue: GitHubIssueCacheRecord) => void;
  openCommandPalette: () => void;

  // Project tab actions
  setProjectTab: (tab: ProjectTab) => void;
  setActivePrNumber: (n: number | null) => void;

  // Instant terminal actions
  openTerminalSessions: () => void;
  addInstantPane: (
    threadId: string,
    meta?: {
      mode?: InstantPaneMode;
      title?: string | null;
      cli?: 'claude' | 'codex';
      state?: AgentState;
    },
  ) => void;
  removeInstantPane: (threadId: string) => void;
  setInstantSplitDirection: (dir: 'horizontal' | 'vertical') => void;
  setInstantPaneState: (threadId: string, state: AgentState) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  activeProjectId: null,
  activeThreadId: null,
  activeIssue: null,
  viewMode: 'overview',
  sidebarCollapsed: false,
  terminalVisible: false,
  terminalMaximized: false,
  settingsVisible: false,
  settingsSection: 'general' as SettingsSection,
  issueDetailExpanded: false,
  issueDetailCollapsed: false,
  issueDetailWidth: 480,
  commentComposerRequest: null,
  currentPlan: null,
  currentReview: null,
  pipelinePhase: 'idle',
  systemHealth: null,
  currentVerification: null,
  githubIssues: [],
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
  projectTab: 'issues' as ProjectTab,
  activePrNumber: null,
  instantPaneThreadIds: [],
  instantSplitDirection: 'horizontal',
  instantPaneMetaByThread: {},
  currentModels: {},
  canonicalTerminalStream: {},

  setViewMode: (mode) => set({ viewMode: mode }),
  openOverview: () =>
    set({
      viewMode: 'overview',
      activeIssue: null,
      issueDetailExpanded: false,
      terminalMaximized: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    }),
  openActivity: () =>
    set({
      viewMode: 'activity',
      activeIssue: null,
      issueDetailExpanded: false,
      terminalMaximized: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    }),
  openInbox: () =>
    set({
      viewMode: 'inbox',
      activeIssue: null,
      issueDetailExpanded: false,
      terminalMaximized: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    }),
  openCosts: () =>
    set({
      viewMode: 'costs',
      activeIssue: null,
      issueDetailExpanded: false,
      terminalMaximized: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    }),
  openSkills: () =>
    set({
      viewMode: 'skills',
      activeIssue: null,
      issueDetailExpanded: false,
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
      terminalMaximized: false,
      issueDetailExpanded: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
      pipelinePhase: 'idle',
      viewMode: 'project',
      projectTab: 'issues' as ProjectTab,
      githubIssues: [],
    }),
  selectThread: (id) =>
    set({
      activeThreadId: id,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
      pipelinePhase: 'idle',
      viewMode: 'project',
    }),
  selectIssue: (issue) =>
    set((s) => ({
      activeIssue: issue,
      activeThreadId: issue?.threadId ?? null,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
      pipelinePhase: 'idle',
      terminalEvents: [],
      // Console is decoupled from the detail panel: closing detail (issue=null)
      // must keep the current console pin so the user can still read output.
      // Switching to another issue re-pins the console to that thread.
      terminalThreadId: issue ? (issue.threadId ?? null) : s.terminalThreadId,
      // Keep expanded mode when switching between issues; reset when closing.
      issueDetailExpanded: issue ? s.issueDetailExpanded : false,
      terminalMaximized: issue ? s.terminalMaximized : false,
      // Auto-open terminal when the selected issue has an agent actively running
      terminalVisible:
        issue && AGENT_ACTIVE_STATUSES.has(issue.pipelineStatus) ? true : s.terminalVisible,
    })),
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
        issueDetailCollapsed: nextSettingsVisible ? true : s.issueDetailCollapsed,
      };
    }),
  setSettingsSection: (section) => set({ settingsSection: section }),
  setPlan: (plan) => set({ currentPlan: plan }),
  setReview: (review) => set({ currentReview: review }),
  setPipelinePhase: (phase) =>
    set((s) =>
      phase === 'idle'
        ? { pipelinePhase: phase }
        : {
            pipelinePhase: phase,
            // Only auto-open on the first transition INTO an active run (e.g. idle/queued → planning).
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
  logTerminalEvent: (line) => set((s) => ({ terminalEvents: [...s.terminalEvents, line] })),
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
      const trimmed = upsertTerminalEvents(prev, [record]);
      return { canonicalTerminalStream: { ...s.canonicalTerminalStream, [threadId]: trimmed } };
    }),
  appendCanonicalEvents: (threadId, events) =>
    set((s) => {
      if (events.length === 0) return s;
      const prev = s.canonicalTerminalStream[threadId] ?? [];
      const trimmed = upsertTerminalEvents(prev, events);
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
  toggleIssueDetailExpanded: () => set((s) => ({ issueDetailExpanded: !s.issueDetailExpanded })),
  toggleIssueDetail: () => set((s) => ({ issueDetailCollapsed: !s.issueDetailCollapsed })),
  setIssueDetailWidth: (width) => set({ issueDetailWidth: width }),
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
  // Cross-project navigation
  navigateToIssue: (projectId, issue) =>
    set((s) => ({
      activeProjectId: projectId,
      viewMode: 'project',
      projectTab: 'issues' as ProjectTab,
      activeIssue: issue,
      activeThreadId: issue.threadId ?? null,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
      pipelinePhase: 'idle',
      terminalEvents: [],
      terminalThreadId: issue.threadId ?? null,
      issueDetailExpanded: s.issueDetailExpanded,
      terminalMaximized: s.terminalMaximized,
      terminalVisible: AGENT_ACTIVE_STATUSES.has(issue.pipelineStatus) ? true : s.terminalVisible,
      commandPaletteOpen: false,
    })),
  openCommandPalette: () => set({ commandPaletteOpen: true }),

  // Project tab actions
  setProjectTab: (tab) => set({ projectTab: tab }),
  setActivePrNumber: (n) => set({ activePrNumber: n }),

  openTerminalSessions: () => {
    const { activeProjectId } = get();
    if (!activeProjectId) return;
    set({
      viewMode: 'project',
      projectTab: 'sessions' as ProjectTab,
      activeIssue: null,
      issueDetailExpanded: false,
      terminalMaximized: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    });
  },
  addInstantPane: (threadId, meta) =>
    set((s) => {
      const nextIds = s.instantPaneThreadIds.includes(threadId)
        ? s.instantPaneThreadIds
        : [...s.instantPaneThreadIds, threadId].slice(0, 4);
      const existingMeta = s.instantPaneMetaByThread[threadId];
      const nextMeta = {
        ...existingMeta,
        mode: meta?.mode ?? existingMeta?.mode ?? 'replay',
        title: meta?.title ?? existingMeta?.title ?? null,
        cli: meta?.cli ?? existingMeta?.cli,
        state: meta?.state ?? existingMeta?.state,
      };
      return {
        instantPaneThreadIds: nextIds,
        instantPaneMetaByThread: {
          ...s.instantPaneMetaByThread,
          [threadId]: nextMeta,
        },
      };
    }),
  removeInstantPane: (threadId) =>
    set((s) => ({
      instantPaneThreadIds: s.instantPaneThreadIds.filter((id) => id !== threadId),
      instantPaneMetaByThread: Object.fromEntries(
        Object.entries(s.instantPaneMetaByThread).filter(([id]) => id !== threadId),
      ),
    })),
  setInstantSplitDirection: (dir) => set({ instantSplitDirection: dir }),
  setInstantPaneState: (threadId, state) =>
    set((s) => {
      const existing = s.instantPaneMetaByThread[threadId];
      if (!existing) return s;
      return {
        instantPaneMetaByThread: {
          ...s.instantPaneMetaByThread,
          [threadId]: { ...existing, state },
        },
      };
    }),
}));
