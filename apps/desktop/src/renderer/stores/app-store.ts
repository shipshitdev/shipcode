import type {
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

export type ViewMode =
  | 'overview'
  | 'project'
  | 'activity'
  | 'inbox'
  | 'costs'
  | 'skills'
  | 'instant';
export type SettingsSection =
  | 'general'
  | 'integrations'
  | 'github'
  | 'notifications'
  | 'pipeline'
  | 'shortcuts'
  | 'archived';

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
  projectSetupModalOpen: boolean;
  projectSetupModalProjectId: string | null;

  // Instant fix
  instantFixModalOpen: boolean;
  instantPaneThreadIds: string[];
  instantSplitDirection: 'horizontal' | 'vertical';

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
  toggleCommandPalette: () => void;
  openCreateIssueModal: () => void;
  openEditPrdModal: (issueNumber: number, body: string, labels: string[]) => void;
  closeCreateIssueModal: () => void;
  openProjectSettingsModal: (projectId: string) => void;
  closeProjectSettingsModal: () => void;
  openProjectSetupModal: (projectId: string) => void;
  closeProjectSetupModal: () => void;

  // Instant fix actions
  openInstantFixModal: () => void;
  closeInstantFixModal: () => void;
  openInstant: () => void;
  addInstantPane: (threadId: string) => void;
  removeInstantPane: (threadId: string) => void;
  setInstantSplitDirection: (dir: 'horizontal' | 'vertical') => void;
}

export const useAppStore = create<AppState>((set) => ({
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
  projectSetupModalOpen: false,
  projectSetupModalProjectId: null,
  instantFixModalOpen: false,
  instantPaneThreadIds: [],
  instantSplitDirection: 'horizontal',
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
      terminalThreadId: issue?.threadId ?? null,
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
      const merged = [...prev, record];
      const deduped = Array.from(new Map(merged.map((entry) => [entry.id, entry])).values());
      const trimmed = deduped.length >= 2000 ? deduped.slice(-2000) : deduped;
      return { canonicalTerminalStream: { ...s.canonicalTerminalStream, [threadId]: trimmed } };
    }),
  appendCanonicalEvents: (threadId, events) =>
    set((s) => {
      const prev = s.canonicalTerminalStream[threadId] ?? [];
      const merged =
        prev.length + events.length > 2000
          ? [...prev.slice(-(2000 - events.length)), ...events]
          : [...prev, ...events];
      return { canonicalTerminalStream: { ...s.canonicalTerminalStream, [threadId]: merged } };
    }),
  hydrateCanonicalEvents: (threadId, events) =>
    set((s) => {
      const prev = s.canonicalTerminalStream[threadId] ?? [];
      const merged = [...prev, ...events].sort((a, b) =>
        a.createdAt === b.createdAt
          ? a.id.localeCompare(b.id)
          : a.createdAt.localeCompare(b.createdAt),
      );
      const deduped = Array.from(new Map(merged.map((entry) => [entry.id, entry])).values());
      const trimmed = deduped.length >= 2000 ? deduped.slice(-2000) : deduped;
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
  openProjectSettingsModal: (projectId) =>
    set({
      projectSettingsModalOpen: true,
      projectSettingsModalProjectId: projectId,
      commandPaletteOpen: false,
    }),
  closeProjectSettingsModal: () =>
    set({ projectSettingsModalOpen: false, projectSettingsModalProjectId: null }),
  openProjectSetupModal: (projectId) =>
    set({
      projectSetupModalOpen: true,
      projectSetupModalProjectId: projectId,
      commandPaletteOpen: false,
    }),
  closeProjectSetupModal: () =>
    set({ projectSetupModalOpen: false, projectSetupModalProjectId: null }),

  // Instant fix
  openInstantFixModal: () => set({ instantFixModalOpen: true, commandPaletteOpen: false }),
  closeInstantFixModal: () => set({ instantFixModalOpen: false }),
  openInstant: () =>
    set({
      viewMode: 'instant',
      activeIssue: null,
      issueDetailExpanded: false,
      terminalMaximized: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    }),
  addInstantPane: (threadId) =>
    set((s) => {
      if (s.instantPaneThreadIds.includes(threadId)) return s;
      const next = [...s.instantPaneThreadIds, threadId].slice(0, 4);
      return { instantPaneThreadIds: next };
    }),
  removeInstantPane: (threadId) =>
    set((s) => ({
      instantPaneThreadIds: s.instantPaneThreadIds.filter((id) => id !== threadId),
    })),
  setInstantSplitDirection: (dir) => set({ instantSplitDirection: dir }),
}));
