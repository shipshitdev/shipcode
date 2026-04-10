import { create } from 'zustand';
import type {
  ShipCodePlan,
  PlanReview,
  PipelinePhase,
  SystemHealth,
  VerificationResult,
  GitHubIssueCacheRecord,
  NotificationRecord,
  IssuePipelineStatus,
} from '@shipcode/shared';

const AGENT_ACTIVE_STATUSES = new Set<IssuePipelineStatus>([
  'planning',
  'reviewing',
  'revising',
  'executing',
  'verifying',
  'shipping',
]);

export type ViewMode = 'dashboard' | 'project' | 'activity' | 'inbox' | 'costs';
export type SettingsSection = 'general' | 'github' | 'notifications' | 'pipeline' | 'archived';

interface AppState {
  // Selection
  activeProjectId: string | null;
  activeThreadId: string | null;
  activeIssue: GitHubIssueCacheRecord | null;

  // UI state
  viewMode: ViewMode;
  sidebarCollapsed: boolean;
  terminalVisible: boolean;
  settingsVisible: boolean;
  settingsSection: SettingsSection;
  issueDetailExpanded: boolean;

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

  // Terminal event log (phase transitions, process lifecycle — resets on thread switch)
  terminalEvents: string[];

  // Terminal per-thread tracking
  terminalThreadId: string | null;
  terminalEventsByThread: Record<string, string[]>;

  // Notifications (in-app toaster + history)
  notifications: NotificationRecord[];

  // Command palette & modals
  commandPaletteOpen: boolean;
  createIssueModalOpen: boolean;
  editingPrd: { issueNumber: number; body: string } | null;

  // Actions
  setViewMode: (mode: ViewMode) => void;
  openDashboard: () => void;
  openActivity: () => void;
  openInbox: () => void;
  openCosts: () => void;
  selectProject: (id: string | null) => void;
  selectThread: (id: string | null) => void;
  selectIssue: (issue: GitHubIssueCacheRecord | null) => void;
  toggleSidebar: () => void;
  toggleTerminal: () => void;
  openTerminal: () => void;
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
  logTerminalEvent: (line: string) => void;
  setTerminalThread: (id: string | null) => void;
  logTerminalEventForThread: (threadId: string, line: string) => void;
  addNotification: (notification: NotificationRecord) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  toggleIssueDetailExpanded: () => void;
  toggleCommandPalette: () => void;
  openCreateIssueModal: () => void;
  openEditPrdModal: (issueNumber: number, body: string) => void;
  closeCreateIssueModal: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  activeProjectId: null,
  activeThreadId: null,
  activeIssue: null,
  viewMode: 'dashboard',
  sidebarCollapsed: false,
  terminalVisible: false,
  settingsVisible: false,
  settingsSection: 'general' as SettingsSection,
  issueDetailExpanded: false,
  currentPlan: null,
  currentReview: null,
  pipelinePhase: 'idle',
  systemHealth: null,
  currentVerification: null,
  githubIssues: [],
  agentOutputs: {},
  terminalEvents: [],
  terminalThreadId: null,
  terminalEventsByThread: {},
  notifications: [],
  commandPaletteOpen: false,
  createIssueModalOpen: false,
  editingPrd: null,

  setViewMode: (mode) => set({ viewMode: mode }),
  openDashboard: () =>
    set({
      viewMode: 'dashboard',
      activeIssue: null,
      issueDetailExpanded: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    }),
  openActivity: () =>
    set({
      viewMode: 'activity',
      activeIssue: null,
      issueDetailExpanded: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    }),
  openInbox: () =>
    set({
      viewMode: 'inbox',
      activeIssue: null,
      issueDetailExpanded: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    }),
  openCosts: () =>
    set({
      viewMode: 'costs',
      activeIssue: null,
      issueDetailExpanded: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
    }),
  selectProject: (id) =>
    set({
      activeProjectId: id,
      activeThreadId: null,
      activeIssue: null,
      issueDetailExpanded: false,
      currentPlan: null,
      currentReview: null,
      currentVerification: null,
      pipelinePhase: 'idle',
      viewMode: 'project',
      terminalThreadId: null,
      terminalEventsByThread: {},
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
      // Auto-open terminal when the selected issue has an agent actively running
      terminalVisible:
        issue && AGENT_ACTIVE_STATUSES.has(issue.pipelineStatus) ? true : s.terminalVisible,
    })),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleTerminal: () => set((s) => ({ terminalVisible: !s.terminalVisible })),
  openTerminal: () => set({ terminalVisible: true }),
  toggleSettings: () =>
    set((s) => ({
      settingsVisible: !s.settingsVisible,
      settingsSection: 'general' as SettingsSection,
    })),
  setSettingsSection: (section) => set({ settingsSection: section }),
  setPlan: (plan) => set({ currentPlan: plan }),
  setReview: (review) => set({ currentReview: review }),
  setPipelinePhase: (phase) => set({ pipelinePhase: phase }),
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
  logTerminalEvent: (line) => set((s) => ({ terminalEvents: [...s.terminalEvents, line] })),
  setTerminalThread: (id) => set({ terminalThreadId: id }),
  logTerminalEventForThread: (threadId, line) =>
    set((s) => {
      const prev = s.terminalEventsByThread[threadId] ?? [];
      const next = prev.length >= 200 ? [...prev.slice(-199), line] : [...prev, line];
      return { terminalEventsByThread: { ...s.terminalEventsByThread, [threadId]: next } };
    }),
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
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  openCreateIssueModal: () =>
    set({ createIssueModalOpen: true, editingPrd: null, commandPaletteOpen: false }),
  openEditPrdModal: (issueNumber, body) =>
    set({
      createIssueModalOpen: true,
      editingPrd: { issueNumber, body },
      commandPaletteOpen: false,
    }),
  closeCreateIssueModal: () => set({ createIssueModalOpen: false, editingPrd: null }),
}));
