import type { ProjectSetupDraft, ProjectSetupInspection, RepoSetupEnvFile } from '@shipcode/shared';
import {
  Button,
  Checkbox,
  Input,
  Label,
  LoadingButtonContent,
  SettingsRow,
  Textarea,
} from '@shipshitdev/ui';
import type { LocalEnvFile } from './setup-utils';

export function ProjectSettingsSetupTab({
  setupCommandsText,
  setSetupCommandsText,
  verifyCommandsText,
  setVerifyCommandsText,
  testingContext,
  setTestingContext,
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
            <LoadingButtonContent loading={detectPending}>Re-detect</LoadingButtonContent>
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
        <div className="mt-2 space-y-1 text-[11px] text-muted">
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
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[12px] font-medium text-primary">Env files</div>
            <div className="text-[11px] text-muted">
              Files copied from repo root into the worktree before execution.
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={addEnvFile}>
            Add env file
          </Button>
        </div>

        <div className="space-y-3">
          {envFiles.length === 0 ? (
            <div className="text-[11px] text-muted">No env files configured.</div>
          ) : null}

          {envFiles.map((file) => (
            <div
              key={file.id}
              className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[1fr_1fr_auto_auto]"
            >
              <div className="flex flex-col gap-1">
                <Label className="text-[11px] text-secondary">Source</Label>
                <Input
                  value={file.source}
                  onChange={(e) => updateEnvFile(file.id, { source: e.target.value })}
                  placeholder=".env.local"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[11px] text-secondary">Target</Label>
                <Input
                  value={file.target ?? ''}
                  onChange={(e) => updateEnvFile(file.id, { target: e.target.value || undefined })}
                  placeholder="Optional alternate target path"
                />
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-[11px] text-secondary">
                <Checkbox
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
