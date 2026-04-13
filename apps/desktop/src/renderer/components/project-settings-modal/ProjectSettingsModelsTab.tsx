import type {
  AppSettings,
  IntegrationStatus,
  OpenRouterModelValidation,
  Project,
} from '@shipcode/shared';
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
}) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted">
        Project overrides shadow the global defaults for this repo only. Leave any field on inherit
        to keep using the global phase setting.
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
