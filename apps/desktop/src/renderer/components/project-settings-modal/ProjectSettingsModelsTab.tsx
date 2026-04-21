import type {
  AppSettings,
  IntegrationStatus,
  ModelConfigPresetKey,
  OpenRouterModelValidation,
  Project,
} from '@shipcode/shared';
import { MODEL_CONFIG_PRESETS, resolveRevisionCount } from '@shipcode/shared';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shipcode/ui';
import type { Dispatch, SetStateAction } from 'react';
import { ProjectPhaseSettingsRow } from './ProjectPhaseSettingsRow';
import { PHASE_META, type PhaseKey, type ProjectOverrideState } from './shared';

export function ProjectSettingsModelsTab({
  settings,
  projectDraft,
  overrides,
  setOverrides,
  integrationStatus,
  modelValidation,
  setModelValidation,
  onApplyPreset,
  onResetIssueOverrides,
  issueOverrideResetPending,
  issueOverrideResetResult,
  issueOverrideResetError,
}: {
  settings: AppSettings;
  projectDraft: Project;
  overrides: ProjectOverrideState;
  setOverrides: Dispatch<SetStateAction<ProjectOverrideState>>;
  integrationStatus: IntegrationStatus | undefined;
  modelValidation: Partial<Record<PhaseKey, OpenRouterModelValidation | null>>;
  setModelValidation: Dispatch<
    SetStateAction<Partial<Record<PhaseKey, OpenRouterModelValidation | null>>>
  >;
  onApplyPreset: (preset: ModelConfigPresetKey) => void;
  onResetIssueOverrides: () => void;
  issueOverrideResetPending: boolean;
  issueOverrideResetResult: string | null;
  issueOverrideResetError: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted">
        Project overrides shadow the global defaults for this repo only. Leave any field on inherit
        to keep using the global phase setting.
      </div>
      <div className="rounded-md border border-border bg-secondary/40 p-3">
        <div className="mb-3">
          <div className="text-[13px] font-medium text-primary">Model Presets</div>
          <div className="text-[11px] text-muted">
            Apply explicit project overrides for Claude, Codex, or the current Hybrid layout.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {MODEL_CONFIG_PRESETS.map((preset) => (
            <Button
              key={preset.key}
              variant="secondary"
              size="sm"
              onClick={() => onApplyPreset(preset.key)}
            >
              {`Apply ${preset.label}`}
            </Button>
          ))}
        </div>
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
            {issueOverrideResetPending ? 'Resetting…' : 'Reset All Issue Overrides'}
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
      {PHASE_META.map((phase) => (
        <ProjectPhaseSettingsRow
          key={phase.key}
          phase={phase.key}
          label={phase.label}
          validProviders={phase.validProviders}
          settings={settings}
          projectDraft={projectDraft}
          overrides={overrides}
          setOverrides={setOverrides}
          integrationStatus={integrationStatus}
          modelValidation={modelValidation}
          setModelValidation={setModelValidation}
        />
      ))}
    </div>
  );
}
