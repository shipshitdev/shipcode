// === Repo Memory Types ===

export interface MemoryFileInfo {
  name: string;
  exists: boolean;
  size?: number;
  updatedAt?: string;
}

export interface RepoMemoryStatus {
  files: MemoryFileInfo[];
  hasObsoleteContextDirectory: boolean;
}

// Back-compat aliases for the generated repo-memory tooling surface used by
// the desktop context tab and agents package.
export type ContextFileInfo = MemoryFileInfo;
