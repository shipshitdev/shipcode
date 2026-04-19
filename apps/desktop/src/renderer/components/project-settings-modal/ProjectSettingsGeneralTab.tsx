import type {
  Project,
  ProjectNotificationRoutingMode,
  ProjectSetupInspection,
} from '@shipcode/shared';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shipcode/ui';

export function ProjectSettingsGeneralTab({
  project,
  urlInput,
  setUrlInput,
  setTouched,
  showInlineError,
  validationOk,
  validationReason,
  relinkPending,
  relinkError,
  onRelink,
  canSync,
  syncPending,
  syncResult,
  syncError,
  hasSavedUrl,
  inputMatchesSaved,
  onSync,
  setupInspection,
  onConfigureSetup,
  discordRouting,
  discordWebhookUrlOverride,
  telegramRouting,
  telegramChatIdOverride,
  notifyGithubUser,
  onDiscordRoutingChange,
  onDiscordWebhookChange,
  onTelegramRoutingChange,
  onTelegramChatIdChange,
  onNotifyGithubUserChange,
}: {
  project: Project;
  urlInput: string;
  setUrlInput: (value: string) => void;
  setTouched: (value: boolean) => void;
  showInlineError: boolean;
  validationOk: boolean;
  validationReason: string | null;
  relinkPending: boolean;
  relinkError: string | null;
  onRelink: () => void;
  canSync: boolean;
  syncPending: boolean;
  syncResult: { attached: number; alreadyPresent: number; failed: number; errors: string[] } | null;
  syncError: string | null;
  hasSavedUrl: boolean;
  inputMatchesSaved: boolean;
  onSync: () => void;
  setupInspection: ProjectSetupInspection | null;
  onConfigureSetup: () => void;
  discordRouting: ProjectNotificationRoutingMode;
  discordWebhookUrlOverride: string;
  telegramRouting: ProjectNotificationRoutingMode;
  telegramChatIdOverride: string;
  notifyGithubUser: string;
  onDiscordRoutingChange: (value: ProjectNotificationRoutingMode) => void;
  onDiscordWebhookChange: (value: string) => void;
  onTelegramRoutingChange: (value: ProjectNotificationRoutingMode) => void;
  onTelegramChatIdChange: (value: string) => void;
  onNotifyGithubUserChange: (value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-secondary">Name</Label>
          <div className="text-[13px] text-primary">{project.name}</div>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-secondary">Git remote</Label>
          <div className="truncate font-mono text-xs text-secondary">
            {project.gitRemote ?? '(no remote)'}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-secondary">Default branch</Label>
          <div className="font-mono text-xs text-secondary">{project.defaultBranch}</div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-secondary/30 p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-[12px] font-medium text-primary">Repository folder</div>
            <div className="text-[11px] text-muted">
              If you moved this repo on disk, relink the existing project instead of creating a
              duplicate.
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={onRelink} disabled={relinkPending}>
            {relinkPending ? 'Locating...' : 'Change folder...'}
          </Button>
        </div>
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
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="github-project-url" className="text-xs text-secondary">
          GitHub Projects board URL
        </Label>
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
        <p className="text-[11px] text-muted">
          Leave blank to open the repo Projects tab. Paste a full GitHub Projects v2 URL to link the
          Kanban <span className="font-mono">board</span> button to the real board.
        </p>
        {showInlineError && !validationOk ? (
          <p className="text-[11px] text-danger">{validationReason}</p>
        ) : null}
      </div>

      <div className="rounded-md border border-border bg-secondary/30 p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-[12px] font-medium text-primary">Project setup</div>
            <div className="text-[11px] text-muted">
              Repo-owned worktree bootstrap and verification commands stored in{' '}
              <span className="font-mono">.shipcode/setup.json</span>.
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={onConfigureSetup}>
            Configure setup...
          </Button>
        </div>
        <div className="text-[11px] text-secondary">
          Status:{' '}
          <span className="font-medium">
            {setupInspection?.status === 'configured'
              ? 'Configured'
              : setupInspection?.status === 'invalid'
                ? 'Invalid'
                : 'Missing'}
          </span>
        </div>
        <div className="mt-1 font-mono text-[11px] text-secondary break-all">
          {setupInspection?.path ?? `${project.path}/.shipcode/setup.json`}
        </div>
        {setupInspection?.error ? (
          <div className="mt-2 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-[11px] text-danger">
            {setupInspection.error}
          </div>
        ) : null}
      </div>

      <div className="rounded-md border border-border bg-secondary/30 p-3">
        <div className="mb-2 text-[12px] font-medium text-primary">Chat routing overrides</div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs text-secondary">Discord routing</Label>
            <Select
              value={discordRouting}
              onValueChange={(value) =>
                onDiscordRoutingChange(value as ProjectNotificationRoutingMode)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">Inherit global default</SelectItem>
                <SelectItem value="disabled">Disable for this project</SelectItem>
                <SelectItem value="custom">Use custom webhook</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={discordWebhookUrlOverride}
              onChange={(e) => onDiscordWebhookChange(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              disabled={discordRouting !== 'custom'}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-secondary">Telegram routing</Label>
            <Select
              value={telegramRouting}
              onValueChange={(value) =>
                onTelegramRoutingChange(value as ProjectNotificationRoutingMode)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">Inherit global default</SelectItem>
                <SelectItem value="disabled">Disable for this project</SelectItem>
                <SelectItem value="custom">Use custom chat ID</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={telegramChatIdOverride}
              onChange={(e) => onTelegramChatIdChange(e.target.value)}
              placeholder="-1001234567890"
              disabled={telegramRouting !== 'custom'}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="notify-github-user" className="text-xs text-secondary">
          Notify GitHub user on issue rewrite
        </Label>
        <Input
          id="notify-github-user"
          type="text"
          value={notifyGithubUser}
          onChange={(e) => onNotifyGithubUserChange(e.target.value)}
          placeholder="github-handle (without @)"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-[11px] text-muted">
          When an issue is rewritten, ShipCode will @mention this user in the comment. Leave blank
          to only tag the issue author.
        </p>
      </div>

      <div className="rounded-md border border-border bg-secondary/30 p-3">
        <div className="mb-2 text-[12px] font-medium text-primary">Board sync</div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
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
                    : 'Add every cached issue to the board'
              }
            >
              {syncPending ? 'Syncing...' : 'Sync existing issues to board'}
            </Button>
            {syncResult ? (
              <span className="text-[11px] text-muted">
                Attached {syncResult.attached}, already present {syncResult.alreadyPresent}
                {syncResult.failed > 0 ? `, failed ${syncResult.failed}` : ''}
              </span>
            ) : null}
          </div>

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
                  <li className="text-muted">(+{syncResult.errors.length - 5} more - see logs)</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
