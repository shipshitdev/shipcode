import type { ProjectSetupDraft, ProjectSetupInspection, RepoSetupEnvFile } from '@shipcode/shared';
import { Button, Checkbox, Input, Label, SettingsRow, Textarea } from '@shipshitdev/ui';
import { RefreshCw } from 'lucide-react';
import type { LocalEnvFile } from './setup-utils';

function projectSettingsSetupTab({
  setupCommandsText,
  setSetupCommandsText,
  verifyCommandsText,
  setVerifyCommandsText,
  testingContext,
  setTestingContext,
  runtimeQaServerCommand,
  setRuntimeQaServerCommand,
  runtimeQaReadinessUrl,
  setRuntimeQaReadinessUrl,
  runtimeQaStartupTimeoutMs,
  setRuntimeQaStartupTimeoutMs,
  runtimeQaPortEnvVar,
  setRuntimeQaPortEnvVar,
  runtimeQaTestCommandsText,
  setRuntimeQaTestCommandsText,
  runtimeQaDiscoverAgentTests,
  setRuntimeQaDiscoverAgentTests,
  setupBeforeVerify,
  setSetupBeforeVerify,
  envFiles,
  addEnvFile,
  updateEnvFile,
  removeEnvFile,
  detectedProfiles,
  inspection,
  projectPath,
  pathExists,
  submitError,
  onRedetect,
  onApplyDetectedProfile,
  detectPending,
}: {
  setupCommandsText: string;
  setSetupCommandsText: (value: string) => void;
  verifyCommandsText: string;
  setVerifyCommandsText: (value: string) => void;
  testingContext: string;
  setTestingContext: (value: string) => void;
  runtimeQaServerCommand: string;
  setRuntimeQaServerCommand: (value: string) => void;
  runtimeQaReadinessUrl: string;
  setRuntimeQaReadinessUrl: (value: string) => void;
  runtimeQaStartupTimeoutMs: number;
  setRuntimeQaStartupTimeoutMs: (value: number) => void;
  runtimeQaPortEnvVar: string;
  setRuntimeQaPortEnvVar: (value: string) => void;
  runtimeQaTestCommandsText: string;
  setRuntimeQaTestCommandsText: (value: string) => void;
  runtimeQaDiscoverAgentTests: boolean;
  setRuntimeQaDiscoverAgentTests: (value: boolean) => void;
  setupBeforeVerify: boolean;
  setSetupBeforeVerify: (value: boolean) => void;
  envFiles: LocalEnvFile[];
  addEnvFile: () => void;
  updateEnvFile: (id: string, patch: Partial<RepoSetupEnvFile>) => void;
  removeEnvFile: (id: string) => void;
  detectedProfiles: ProjectSetupDraft['profiles'];
  inspection: ProjectSetupInspection | null;
  projectPath: string;
  pathExists: boolean;
  submitError: string | null;
  onRedetect: () => void;
  onApplyDetectedProfile: (profile: ProjectSetupDraft['profiles'][number]) => void;
  detectPending: boolean;
}) {
  if (!pathExists) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
        This project's repository folder is missing. Relink it in the General tab before configuring
        setup.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {inspection?.status === 'invalid' ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          Existing setup file is invalid: {inspection.error}
        </div>
      ) : null}

      {inspection?.status === 'missing' ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          This project has no repo setup contract yet. ShipCode will keep using global fallback
          testing settings until you save one.
        </div>
      ) : null}

      <section>
        <SettingsRow
          label="Detected project profiles"
          description="Click a detected profile to fill the commands below with that suggested setup. Nothing is saved until you click Save."
        >
          <Button variant="secondary" size="sm" onClick={onRedetect} disabled={detectPending}>
            <RefreshCw size={14} className={detectPending ? 'animate-spin' : ''} />
            Re-detect
          </Button>
        </SettingsRow>
        <div className="mt-3 flex flex-wrap gap-2">
          {detectedProfiles.map((profile: ProjectSetupDraft['profiles'][number]) => (
            <Button
              key={`${profile.kind}:${profile.evidence.join('|')}`}
              type="button"
              variant="pill"
              size="xs"
              onClick={() => onApplyDetectedProfile(profile)}
              className={
                profile.recommended
                  ? 'h-auto rounded-sm border-border-strong bg-accent/10 px-2 py-1 text-primary'
                  : 'h-auto rounded-sm bg-hover px-2 py-1 text-primary'
              }
            >
              {profile.label}
              {profile.recommended ? ' recommended' : ''}
            </Button>
          ))}
        </div>
        <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          {detectedProfiles.map((profile: ProjectSetupDraft['profiles'][number]) => (
            <div key={`${profile.kind}:evidence`}>
              {profile.label}: {profile.evidence.join(', ')}
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="setup-commands" className="text-xs text-secondary">
            Setup commands
          </Label>
          <Textarea
            id="setup-commands"
            value={setupCommandsText}
            onChange={(e) => setSetupCommandsText(e.target.value)}
            placeholder="One shell command per line"
            rows={6}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="verify-commands" className="text-xs text-secondary">
            Verify commands
          </Label>
          <Textarea
            id="verify-commands"
            value={verifyCommandsText}
            onChange={(e) => setVerifyCommandsText(e.target.value)}
            placeholder="One shell command per line"
            rows={6}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="testing-context" className="text-xs text-secondary">
          Testing context
        </Label>
        <Textarea
          id="testing-context"
          value={testingContext}
          onChange={(e) => setTestingContext(e.target.value)}
          placeholder="Explain the repo's test conventions, frameworks, and any caveats."
          rows={4}
        />
      </div>

      <div className="rounded-md border border-border bg-secondary/30 p-3">
        <div className="mb-3">
          <div className="text-[12px] font-medium text-primary">Runtime QA</div>
          <div className="text-[11px] text-muted-foreground">
            Commands ShipCode runs inside the feature worktree so browser and human QA target the
            implementation under review.
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-1">
            <Label htmlFor="runtime-qa-server-command" className="text-[11px] text-secondary">
              Start command
            </Label>
            <Input
              id="runtime-qa-server-command"
              value={runtimeQaServerCommand}
              onChange={(e) => setRuntimeQaServerCommand(e.target.value)}
              placeholder="bun run dev --host 127.0.0.1 --port $PORT"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="runtime-qa-readiness-url" className="text-[11px] text-secondary">
              Readiness URL
            </Label>
            <Input
              id="runtime-qa-readiness-url"
              value={runtimeQaReadinessUrl}
              onChange={(e) => setRuntimeQaReadinessUrl(e.target.value)}
              placeholder="http://127.0.0.1:$PORT"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="runtime-qa-test-commands" className="text-[11px] text-secondary">
              Runtime test commands
            </Label>
            <Textarea
              id="runtime-qa-test-commands"
              value={runtimeQaTestCommandsText}
              onChange={(e) => setRuntimeQaTestCommandsText(e.target.value)}
              placeholder="One browser or E2E command per line"
              rows={4}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1">
            <div className="flex flex-col gap-1">
              <Label htmlFor="runtime-qa-timeout" className="text-[11px] text-secondary">
                Startup timeout ms
              </Label>
              <Input
                id="runtime-qa-timeout"
                type="number"
                min={1000}
                value={runtimeQaStartupTimeoutMs}
                onChange={(e) =>
                  setRuntimeQaStartupTimeoutMs(Math.max(1000, Number(e.target.value) || 60_000))
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="runtime-qa-port-env" className="text-[11px] text-secondary">
                Port env var
              </Label>
              <Input
                id="runtime-qa-port-env"
                value={runtimeQaPortEnvVar}
                onChange={(e) => setRuntimeQaPortEnvVar(e.target.value)}
                placeholder="PORT"
              />
            </div>
            <label
              htmlFor="project-runtime-qa-discover-agent-tests"
              className="flex items-center gap-2 text-[11px] text-secondary"
            >
              <Checkbox
                id="project-runtime-qa-discover-agent-tests"
                checked={runtimeQaDiscoverAgentTests}
                onCheckedChange={(checked) => setRuntimeQaDiscoverAgentTests(checked === true)}
              />
              Discover agent runtime tests
            </label>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-secondary/30 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[12px] font-medium text-primary">Env files</div>
            <div className="text-[11px] text-muted-foreground">
              Files copied from repo root into the worktree before execution.
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={addEnvFile}>
            Add env file
          </Button>
        </div>

        <div className="space-y-3">
          {envFiles.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">No env files configured.</div>
          ) : null}

          {envFiles.map((file) => (
            <div
              key={file.id}
              className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[1fr_1fr_auto_auto]"
            >
              <div className="flex flex-col gap-1">
                <Label
                  htmlFor={`env-file-source-${file.id}`}
                  className="text-[11px] text-secondary"
                >
                  Source
                </Label>
                <Input
                  id={`env-file-source-${file.id}`}
                  value={file.source}
                  onChange={(e) => updateEnvFile(file.id, { source: e.target.value })}
                  placeholder=".env.local"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label
                  htmlFor={`env-file-target-${file.id}`}
                  className="text-[11px] text-secondary"
                >
                  Target
                </Label>
                <Input
                  id={`env-file-target-${file.id}`}
                  value={file.target ?? ''}
                  onChange={(e) => updateEnvFile(file.id, { target: e.target.value || undefined })}
                  placeholder="Optional alternate target path"
                />
              </div>
              <label
                htmlFor={`env-file-required-${file.id}`}
                className="flex items-center gap-2 self-end pb-2 text-[11px] text-secondary"
              >
                <Checkbox
                  id={`env-file-required-${file.id}`}
                  checked={file.required}
                  onCheckedChange={(checked) =>
                    updateEnvFile(file.id, { required: checked === true })
                  }
                />
                Required
              </label>
              <Button
                variant="ghost"
                size="sm"
                className="self-end"
                onClick={() => removeEnvFile(file.id)}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      </div>

      <SettingsRow
        label="Setup before verification"
        htmlFor="setup-before-verify"
        description="Rerun setup commands before verification commands."
      >
        <Checkbox
          id="setup-before-verify"
          checked={setupBeforeVerify}
          onCheckedChange={(checked) => setSetupBeforeVerify(checked === true)}
        />
      </SettingsRow>

      <SettingsRow
        label="Target file"
        description="Setup is stored in the repo, not in ShipCode's database."
      >
        <div className="max-w-[360px] truncate font-mono text-[11px] text-secondary">
          {inspection?.path ?? `${projectPath}/.shipcode/setup.json`}
        </div>
      </SettingsRow>

      {submitError ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
          {submitError}
        </div>
      ) : null}
    </div>
  );
}

export function ProjectSettingsSetupTab(props: Parameters<typeof projectSettingsSetupTab>[0]) {
  return projectSettingsSetupTab(props);
}
