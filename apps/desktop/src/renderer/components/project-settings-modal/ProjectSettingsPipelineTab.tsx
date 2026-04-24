import type { AppSettings, Project } from '@shipcode/shared';
import { resolveRequireApproval, resolveRevisionCount } from '@shipcode/shared';
import {
  Button,
  LoadingButtonContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
} from '@shipshitdev/ui';
import type { Dispatch, SetStateAction } from 'react';
import type { ProjectOverrideState } from './shared';

export function ProjectSettingsPipelineTab({
  settings,
  overrides,
  setOverrides,
  onResetIssueOverrides,
  issueOverrideResetPending,
  issueOverrideResetResult,
  issueOverrideResetError,
}: {
  settings: AppSettings;
  overrides: ProjectOverrideState;
  setOverrides: Dispatch<SetStateAction<ProjectOverrideState>>;
  onResetIssueOverrides: () => void;
  issueOverrideResetPending: boolean;
  issueOverrideResetResult: string | null;
  issueOverrideResetError: string | null;
}) {
  return (
    <div className="space-y-6">
      <div className="text-xs text-muted">
        Project pipeline overrides shadow the global workflow defaults for this repo only.
      </div>

      <section>
        <SettingsRow
          label="Runtime Capacity"
          description="Pipeline starts are app-wide. Execution slots are per project."
        >
          <div className="flex flex-wrap justify-end gap-1.5">
            <div className="rounded-full border border-border/70 bg-secondary/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary">
              {settings.maxConcurrentPipelines} pipeline
              {settings.maxConcurrentPipelines === 1 ? '' : 's'}
            </div>
            <div className="rounded-full border border-agent/30 bg-agent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-agent">
              {settings.maxConcurrentExecutions} execution slot
              {settings.maxConcurrentExecutions === 1 ? '' : 's'}
              /project
            </div>
          </div>
        </SettingsRow>
        <div className="mt-2 text-xs text-muted">
          Approved issues move to <span className="text-primary">Waiting For Execution</span> until
          one of this project's execution slots opens.
        </div>
      </section>

      <section>
        <SettingsRow
          label="Human Approval"
          description="Override whether this project pauses for human sign-off before execution."
        >
          <Select
            value={
              overrides.requireApprovalOverride == null
                ? '__inherit__'
                : overrides.requireApprovalOverride
                  ? 'true'
                  : 'false'
            }
            onValueChange={(value) =>
              setOverrides((current) => ({
                ...current,
                requireApprovalOverride: value === '__inherit__' ? null : value === 'true',
              }))
            }
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__inherit__">
                {`Inherit app default (${resolveRequireApproval(settings, null) ? 'Required' : 'Off'})`}
              </SelectItem>
              <SelectItem value="true">Required</SelectItem>
              <SelectItem value="false">Off</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          label="PRD Quality Gate"
          description="When enabled, incomplete PRDs block pipeline entry. When off, missing sections only warn."
        >
          <Select
            value={
              overrides.prdQualityGate == null
                ? '__inherit__'
                : overrides.prdQualityGate
                  ? 'true'
                  : 'false'
            }
            onValueChange={(value) =>
              setOverrides((current) => ({
                ...current,
                prdQualityGate: value === '__inherit__' ? null : value === 'true',
              }))
            }
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__inherit__">Inherit default (Off)</SelectItem>
              <SelectItem value="true">Enabled (blocking)</SelectItem>
              <SelectItem value="false">Off (warning only)</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          label="Revisions"
          description="Override how many review-to-revise loops this project gets before approval or execution."
        >
          <Select
            value={
              overrides.revisionCountOverride == null
                ? '__inherit__'
                : String(overrides.revisionCountOverride)
            }
            onValueChange={(value) =>
              setOverrides((current) => ({
                ...current,
                revisionCountOverride:
                  value === '__inherit__'
                    ? null
                    : (Number.parseInt(value, 10) as Project['revisionCountOverride']),
              }))
            }
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__inherit__">
                {`Inherit app default (${resolveRevisionCount(settings, null)})`}
              </SelectItem>
              <SelectItem value="0">0 · Skip review</SelectItem>
              <SelectItem value="1">1 revision</SelectItem>
              <SelectItem value="2">2 revisions</SelectItem>
              <SelectItem value="3">3 revisions</SelectItem>
              <SelectItem value="4">4 revisions</SelectItem>
              <SelectItem value="5">5 revisions</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </section>

      <section>
        <SettingsRow
          label="Issue Overrides"
          description="Clear every per-issue phase override for this project so issues inherit from project and global settings."
        >
          <Button
            variant="destructive"
            size="sm"
            onClick={onResetIssueOverrides}
            disabled={issueOverrideResetPending}
          >
            <LoadingButtonContent loading={issueOverrideResetPending}>
              Reset All Issue Overrides
            </LoadingButtonContent>
          </Button>
        </SettingsRow>
        {issueOverrideResetResult ? (
          <div className="mt-3 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[11px] text-success">
            {issueOverrideResetResult}
          </div>
        ) : null}
        {issueOverrideResetError ? (
          <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger">
            {issueOverrideResetError}
          </div>
        ) : null}
      </section>
    </div>
  );
}
