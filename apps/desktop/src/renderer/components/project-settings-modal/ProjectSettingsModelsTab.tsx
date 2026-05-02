import type {
  AppSettings,
  IntegrationStatus,
  ModelConfigPresetKey,
  OpenRouterModelValidation,
  Project,
} from '@shipcode/shared';
import { MODEL_CONFIG_PRESETS } from '@shipcode/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  SettingsRow,
} from '@shipshitdev/ui';
import { ChevronDown } from 'lucide-react';
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
}) {
  return (
    <div className="space-y-6">
      <div className="text-xs text-muted">
        Project model overrides shadow the global defaults for this repo only. Leave any field on
        inherit to keep using the global phase setting.
      </div>

      <SettingsRow
        label="Model Presets"
        description="Apply explicit project overrides for Claude, Codex, or the current Hybrid layout."
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm">
              Apply Preset
              <ChevronDown size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[260px]">
            {MODEL_CONFIG_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset.key}
                onSelect={() => onApplyPreset(preset.key)}
                className="flex flex-col items-start gap-0.5"
              >
                <span>{preset.label}</span>
                <span className="text-[11px] text-muted">{preset.description}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SettingsRow>

      <div className="text-xs text-muted">
        Workflow order here is Planner → Reviewer → Executor → Verifier. Clarifying and Awaiting
        Approval are human checkpoints, so they do not have model rows.
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
