import {
  measurePromptPayload,
  summarizePromptMaterials,
  type PromptMaterial,
  type PromptPayloadSize,
  type PromptPhase,
} from '../prompt-scope';
import {
  getPhasePromptPolicy,
  selectPhasePromptMaterials,
  type PhasePromptContextSlice,
} from './phase-prompt-policy';

export interface PhasePromptTelemetrySection {
  label: string;
  kind: PromptMaterial['kind'];
  size: PromptPayloadSize;
}

export interface PhasePromptTelemetry {
  phase: PromptPhase;
  promptSize: PromptPayloadSize;
  selectedMaterials: ReturnType<typeof summarizePromptMaterials>;
  selectedScope: {
    allowedContextSlices: readonly PhasePromptContextSlice[];
    allowedMaterialKinds: readonly PromptMaterial['kind'][];
  };
  sections: PhasePromptTelemetrySection[];
}

export function toPersistedPromptTelemetryMaterials(telemetry: PhasePromptTelemetry) {
  return {
    ...(telemetry.selectedMaterials ?? {
      count: 0,
      labels: [],
      kinds: [],
    }),
    selectedScope: telemetry.selectedScope,
    sections: telemetry.sections,
  };
}

export function measurePhasePromptTelemetry(input: {
  phase: PromptPhase;
  prompt: string;
  materials: readonly PromptMaterial[];
}): PhasePromptTelemetry {
  const selectedMaterials = selectPhasePromptMaterials(input.phase, input.materials);
  const policy = getPhasePromptPolicy(input.phase);
  return {
    phase: input.phase,
    promptSize: measurePromptPayload(input.prompt),
    selectedMaterials: summarizePromptMaterials(selectedMaterials),
    selectedScope: {
      allowedContextSlices: policy.allowedContextSlices,
      allowedMaterialKinds: policy.allowedMaterialKinds,
    },
    sections: selectedMaterials.map((material) => ({
      label: material.label,
      kind: material.kind,
      size: measurePromptPayload(material.content),
    })),
  };
}
