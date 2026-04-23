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
    <div className="space-y-3">
      <div className="text-[11px] text-muted">
        Project pipeline overrides shadow the global workflow defaults for this repo only.
      </div>

      <div className="rounded-md border border-agent/20 bg-agent/[0.04] p-3">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[13px] font-medium text-primary">Runtime Capacity</div>
            <div className="text-[11px] text-muted">
              Pipeline starts are app-wide. Execution slots are per project.
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
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
        </div>
        <div className="text-[11px] text-muted">
          Approved issues move to <span className="text-primary">Waiting For Execution</span> until
          one of this project's execution slots opens.
        </div>
      </div>

      <div className="rounded-md border border-border bg-secondary/40 p-3">
        <div className="mb-3">
          <div className="text-[13px] font-medium text-primary">Human Approval</div>
          <div className="text-[11px] text-muted">
            Override whether this project pauses for human sign-off before execution.
          </div>
        </div>
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
          <SelectTrigger className="w-[260px]">
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
      </div>

      <div className="rounded-md border border-border bg-secondary/40 p-3">
        <div className="mb-3">
          <div className="text-[13px] font-medium text-primary">PRD Quality Gate</div>
          <div className="text-[11px] text-muted">
            When enabled, incomplete PRDs block pipeline entry. When off, missing sections produce a
            warning but planning proceeds.
          </div>
        </div>
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
          <SelectTrigger className="w-[260px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__inherit__">Inherit default (Off)</SelectItem>
            <SelectItem value="true">Enabled (blocking)</SelectItem>
            <SelectItem value="false">Off (warning only)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-border bg-secondary/40 p-3">
        <div className="mb-3">
          <div className="text-[13px] font-medium text-primary">Revisions</div>
          <div className="text-[11px] text-muted">
            Override how many review-to-revise loops this project gets before approval or execution.
          </div>
        </div>
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
          <SelectTrigger className="w-[260px]">
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
      </div>

      <div className="rounded-md border border-border bg-secondary/40 p-3">
        <div className="mb-3">
          <div className="text-[13px] font-medium text-primary">Issue Overrides</div>
          <div className="text-[11px] text-muted">
            Clear every per-issue phase override for this project so issues go back to inheriting
            from project and global settings.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
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
      </div>
    </div>
  );
}
