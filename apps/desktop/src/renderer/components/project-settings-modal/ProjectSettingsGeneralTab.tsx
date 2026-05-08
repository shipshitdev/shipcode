import type { Project } from '@shipcode/shared';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  SettingsRow,
} from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { RefreshCw } from 'lucide-react';

export function ProjectSettingsGeneralTab({
  project,
  nameInput,
  setNameInput,
  urlInput,
  setUrlInput,
  setTouched,
  nameError,
  showInlineError,
  validationOk,
  validationReason,
  relinkPending,
  relinkError,
  onRelink,
  canSync,
  syncLocked,
  syncPending,
  syncResult,
  syncError,
  hasSavedUrl,
  inputMatchesSaved,
  onSync,
  branches,
  onSetDefaultBranch,
  setDefaultBranchPending,
  onRefreshBranches,
  refreshBranchesPending,
  onRefreshGitRemote,
  refreshGitRemotePending,
}: {
  project: Project;
  nameInput: string;
  setNameInput: (value: string) => void;
  urlInput: string;
  setUrlInput: (value: string) => void;
  setTouched: (value: boolean) => void;
  nameError: string | null;
  showInlineError: boolean;
  validationOk: boolean;
  validationReason: string | null;
  relinkPending: boolean;
  relinkError: string | null;
  onRelink: () => void;
  canSync: boolean;
  syncLocked: boolean;
  syncPending: boolean;
  syncResult: { attached: number; alreadyPresent: number; failed: number; errors: string[] } | null;
  syncError: string | null;
  hasSavedUrl: boolean;
  inputMatchesSaved: boolean;
  onSync: () => void;
  branches: string[];
  onSetDefaultBranch: (branch: string) => void;
  setDefaultBranchPending: boolean;
  onRefreshBranches: () => void;
  refreshBranchesPending: boolean;
  onRefreshGitRemote: () => void;
  refreshGitRemotePending: boolean;
}) {
  const localBranches = branches.filter((branch) => !branch.includes('/'));
  const remoteBranches = branches.filter((branch) => branch.includes('/'));
  const hasBranches = branches.length > 0;
  const branchValue =
    hasBranches && branches.includes(project.defaultBranch) ? project.defaultBranch : undefined;
  return (
    <div className="space-y-6">
      <section>
        <SettingsRow label="Name" htmlFor="project-name">
          <div className="flex w-[260px] flex-col gap-1">
            <Input
              id="project-name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder={project.name}
              className={nameError ? 'border-danger' : undefined}
              autoComplete="off"
              spellCheck={false}
            />
            {nameError ? <p className="text-[11px] text-danger">{nameError}</p> : null}
          </div>
        </SettingsRow>

        <SettingsRow label="Git remote">
          <div className="flex items-center gap-2">
            <div className="max-w-[280px] truncate font-mono text-xs text-secondary">
              {project.gitRemote ?? '(no remote)'}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Re-read origin URL from local git config"
              disabled={refreshGitRemotePending}
              onClick={onRefreshGitRemote}
            >
              <RefreshCw size={14} className={refreshGitRemotePending ? 'animate-spin' : ''} />
            </Button>
          </div>
        </SettingsRow>

        <SettingsRow label="Default branch">
          {hasBranches ? (
            <div className="flex items-center gap-2">
              <Select
                value={branchValue}
                onValueChange={onSetDefaultBranch}
                disabled={setDefaultBranchPending}
              >
                <SelectTrigger className="h-8 w-[240px] gap-1 font-mono text-xs">
                  <SelectValue placeholder={project.defaultBranch} />
                </SelectTrigger>
                <SelectContent>
                  {localBranches.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Local</SelectLabel>
                      {localBranches.map((branch) => (
                        <SelectItem key={branch} value={branch} className="font-mono text-xs">
                          {branch}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {localBranches.length > 0 && remoteBranches.length > 0 && <SelectSeparator />}
                  {remoteBranches.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Remote</SelectLabel>
                      {remoteBranches.map((branch) => (
                        <SelectItem key={branch} value={branch} className="font-mono text-xs">
                          {branch}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Refresh branches"
                disabled={refreshBranchesPending}
                onClick={onRefreshBranches}
              >
                <RefreshCw size={14} className={refreshBranchesPending ? 'animate-spin' : ''} />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="font-mono text-xs text-secondary">{project.defaultBranch}</div>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Load branches"
                disabled={refreshBranchesPending}
                onClick={onRefreshBranches}
              >
                <RefreshCw size={14} className={refreshBranchesPending ? 'animate-spin' : ''} />
              </Button>
            </div>
          )}
        </SettingsRow>
      </section>

      <section>
        <SettingsRow
          label="Repository folder"
          description="If you moved this repo on disk, relink the existing project instead of creating a duplicate."
        >
          <Button variant="secondary" size="sm" onClick={onRelink} disabled={relinkPending}>
            <LoadingButtonContent loading={relinkPending}>Change folder...</LoadingButtonContent>
          </Button>
        </SettingsRow>
        <div className="font-mono text-xs text-secondary break-all">{project.path}</div>
        {project.pathExists === false ? (
          <div className="mt-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-[11px] text-warning">
            This path is missing. ShipCode will block issue refresh, branch reads, and pipeline
            actions until you relink it.
          </div>
        ) : null}
        {relinkError ? (
          <div className="mt-2 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-[11px] text-danger">
            <span className="line-clamp-2">{relinkError}</span>
          </div>
        ) : null}
      </section>

      <section>
        <SettingsRow
          label="GitHub Projects board URL"
          htmlFor="github-project-url"
          description="Required for readiness checks, board sync, and metadata fields. Paste a full GitHub Projects v2 URL."
        >
          <div className="flex w-[320px] flex-col gap-1">
            <Input
              id="github-project-url"
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="https://github.com/orgs/your-org/projects/1"
              className={showInlineError ? 'border-danger' : undefined}
              autoComplete="off"
              spellCheck={false}
            />
            {showInlineError && !validationOk ? (
              <p className="text-[11px] text-danger">{validationReason}</p>
            ) : null}
          </div>
        </SettingsRow>
      </section>

      <section>
        <SettingsRow
          label="Board sync"
          description="Add every cached issue to the linked GitHub Projects board."
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={onSync}
            disabled={!canSync}
            title={
              !hasSavedUrl
                ? 'Save a board URL first'
                : !inputMatchesSaved
                  ? 'Save your changes before syncing'
                  : syncLocked
                    ? 'Board sync is disabled after a failed attach. Fix the repo or board config, then reopen Project Settings to retry.'
                    : 'Add every cached issue to the board'
            }
          >
            <LoadingButtonContent loading={syncPending}>
              Sync existing issues to board
            </LoadingButtonContent>
          </Button>
        </SettingsRow>
        <div className="flex flex-col gap-2">
          {syncResult ? (
            <span className="text-[11px] text-muted-foreground">
              Attached {syncResult.attached}, already present {syncResult.alreadyPresent}
              {syncResult.failed > 0 ? `, failed ${syncResult.failed}` : ''}
            </span>
          ) : null}

          {syncError ? (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-[11px] text-danger">
              <span className="line-clamp-2">{syncError}</span>
            </div>
          ) : null}

          {syncResult && syncResult.errors.length > 0 ? (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-[11px] text-warning">
              <div className="font-medium">
                {syncResult.errors.length} issue{syncResult.errors.length === 1 ? '' : 's'} failed:
              </div>
              <ul className="mt-1 space-y-0.5">
                {syncResult.errors.slice(0, 5).map((err) => (
                  <li key={err} className="line-clamp-1">
                    - {err}
                  </li>
                ))}
                {syncResult.errors.length > 5 ? (
                  <li className="text-muted-foreground">
                    (+{syncResult.errors.length - 5} more - see logs)
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
