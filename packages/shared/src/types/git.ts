import type { ThreadStatus } from './pipeline-core';
import type { Project } from './project';

// === Activity Heatmap Types ===

export type HeatmapMetric = 'costUsd' | 'tokens' | 'runs' | 'prsOpened';
export type HeatmapRange = 30 | 90 | 365;
export type HeatmapScope = 'global' | 'project' | 'thread';

export interface HeatmapDayRecord {
  /** ISO date `YYYY-MM-DD` (UTC). */
  date: string;
  costUsd: number;
  tokens: number;
  runs: number;
  prsOpened: number;
}

export interface HeatmapQueryArgs {
  scope: HeatmapScope;
  rangeDays: HeatmapRange;
  projectId?: string;
  threadId?: string;
}

// === Code Browse Types ===

export type CodeEntryType = 'file' | 'dir';

export interface CodeTreeEntry {
  name: string;
  relativePath: string;
  type: CodeEntryType;
  sizeBytes: number | null;
  isModified: boolean;
}

export interface CodeFileContent {
  relativePath: string;
  content: string;
  isBinary: boolean;
  sizeBytes: number;
  truncated: boolean;
}

// === Diff Types ===

export interface DiffRecord {
  id: string;
  threadId: string;
  filePath: string;
  action: 'create' | 'modify' | 'delete' | 'rename';
  diffContent: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  createdAt: string;
}

// === Git Types ===

export interface GitState {
  branch: string;
  commitHash: string;
  isDirty: boolean;
  untrackedCount: number;
  stagedCount: number;
  modifiedCount: number;
  aheadCount: number;
  behindCount: number;
  compareRef: string | null;
  preCommitHookPath: string | null;
}

export type GitWorktreeKind = 'main' | 'shipcode';

export interface GitWorktreeSummary {
  id: string;
  kind: GitWorktreeKind;
  path: string;
  branch: string;
  commitHash: string;
  isDirty: boolean;
  untrackedCount: number;
  stagedCount: number;
  modifiedCount: number;
  aheadCount: number;
  behindCount: number;
  compareRef: string | null;
  preCommitHookPath: string | null;
  threadId: string | null;
  issueNumber: number | null;
  title: string | null;
  status: ThreadStatus | null;
}

export interface GitVisualizerData {
  project: Project;
  branches: string[];
  worktrees: GitWorktreeSummary[];
}
