import type { OpenRouterModelValidation, Project, RepoSetupContract } from '@shipcode/shared';
import type { SetStateAction } from 'react';
import {
  commandsToText,
  type LocalEnvFile,
  normalizeEnvFiles,
  runtimeQaCommandsToText,
} from './setup-utils';
import {
  type ContextGeneratorCli,
  EMPTY_OVERRIDES,
  type PhaseKey,
  type ProjectOverrideState,
  type ProjectTab,
} from './shared';

export type ProjectSyncResult = {
  attached: number;
  alreadyPresent: number;
  failed: number;
  errors: string[];
};

export type ProjectSettingsUiState = {
  activeTab: ProjectTab;
  nameInput: string;
  urlInput: string;
  touched: boolean;
  submitError: string | null;
  overrides: ProjectOverrideState;
  contextGenerating: boolean;
  contextGeneratorCli: ContextGeneratorCli;
  contextError: string | null;
  syncResult: ProjectSyncResult | null;
  syncError: string | null;
  relinkError: string | null;
  issueOverrideResetResult: string | null;
  issueOverrideResetError: string | null;
  modelValidation: Partial<Record<PhaseKey, OpenRouterModelValidation | null>>;
  notifyGithubUser: string;
  setupSaveError: string | null;
  manualSetupDetectPending: boolean;
};

type ProjectSettingsUiAction =
  | { type: 'seed-open'; activeTab: ProjectTab | null; project: Project | null | undefined }
  | { type: 'patch'; patch: Partial<ProjectSettingsUiState> }
  | { type: 'overrides'; updater: SetStateAction<ProjectOverrideState> }
  | {
      type: 'model-validation';
      updater: SetStateAction<Partial<Record<PhaseKey, OpenRouterModelValidation | null>>>;
    };

export const INITIAL_PROJECT_SETTINGS_UI_STATE: ProjectSettingsUiState = {
  activeTab: 'general',
  nameInput: '',
  urlInput: '',
  touched: false,
  submitError: null,
  overrides: EMPTY_OVERRIDES,
  contextGenerating: false,
  contextGeneratorCli: 'claude',
  contextError: null,
  syncResult: null,
  syncError: null,
  relinkError: null,
  issueOverrideResetResult: null,
  issueOverrideResetError: null,
  modelValidation: {},
  notifyGithubUser: '',
  setupSaveError: null,
  manualSetupDetectPending: false,
};

function getProjectOverrides(project: Project | null | undefined): ProjectOverrideState {
  return {
    plannerModelOverride: project?.plannerModelOverride ?? null,
    reviewerModelOverride: project?.reviewerModelOverride ?? null,
    executorModelOverride: project?.executorModelOverride ?? null,
    verifierModelOverride: project?.verifierModelOverride ?? null,
    plannerModelIdOverride: project?.plannerModelIdOverride ?? null,
    reviewerModelIdOverride: project?.reviewerModelIdOverride ?? null,
    executorModelIdOverride: project?.executorModelIdOverride ?? null,
    verifierModelIdOverride: project?.verifierModelIdOverride ?? null,
    plannerReasoningEffortOverride: project?.plannerReasoningEffortOverride ?? null,
    reviewerReasoningEffortOverride: project?.reviewerReasoningEffortOverride ?? null,
    executorReasoningEffortOverride: project?.executorReasoningEffortOverride ?? null,
    verifierReasoningEffortOverride: project?.verifierReasoningEffortOverride ?? null,
    revisionCountOverride: project?.revisionCountOverride ?? null,
    requireApprovalOverride: project?.requireApprovalOverride ?? null,
    pipelineSpeedProfileOverride: project?.pipelineSpeedProfileOverride ?? null,
    prdQualityGate: project?.prdQualityGate ?? null,
    discordRouting: project?.discordRouting ?? 'inherit',
    discordWebhookUrlOverride: project?.discordWebhookUrlOverride ?? null,
    telegramRouting: project?.telegramRouting ?? 'inherit',
    telegramChatIdOverride: project?.telegramChatIdOverride ?? null,
  };
}

export function projectSettingsUiReducer(
  state: ProjectSettingsUiState,
  action: ProjectSettingsUiAction,
): ProjectSettingsUiState {
  switch (action.type) {
    case 'seed-open':
      return {
        ...state,
        activeTab: action.activeTab ?? state.activeTab,
        urlInput: action.project?.githubProjectUrl ?? '',
        nameInput: action.project?.name ?? '',
        overrides: getProjectOverrides(action.project),
        notifyGithubUser: action.project?.notifyGithubUser ?? '',
        touched: false,
        submitError: null,
        setupSaveError: null,
        manualSetupDetectPending: false,
        syncResult: null,
        syncError: null,
        contextGenerating: false,
        contextGeneratorCli: 'claude',
        contextError: null,
        relinkError: null,
        issueOverrideResetResult: null,
        issueOverrideResetError: null,
        modelValidation: {},
      };
    case 'patch':
      return { ...state, ...action.patch };
    case 'overrides': {
      const overrides =
        typeof action.updater === 'function' ? action.updater(state.overrides) : action.updater;
      return { ...state, overrides };
    }
    case 'model-validation': {
      const modelValidation =
        typeof action.updater === 'function'
          ? action.updater(state.modelValidation)
          : action.updater;
      return { ...state, modelValidation };
    }
  }
}

export type ProjectSetupFormState = {
  setupCommandsText: string;
  verifyCommandsText: string;
  testingContext: string;
  runtimeQaServerCommand: string;
  runtimeQaReadinessUrl: string;
  runtimeQaStartupTimeoutMs: number;
  runtimeQaPortEnvVar: string;
  runtimeQaTestCommandsText: string;
  runtimeQaDiscoverAgentTests: boolean;
  setupBeforeVerify: boolean;
  envFiles: LocalEnvFile[];
};

type ProjectSetupFormAction =
  | { type: 'contract'; contract: RepoSetupContract }
  | { type: 'patch'; patch: Partial<ProjectSetupFormState> }
  | { type: 'env-files'; updater: SetStateAction<LocalEnvFile[]> };

export const INITIAL_PROJECT_SETUP_FORM_STATE: ProjectSetupFormState = {
  setupCommandsText: '',
  verifyCommandsText: '',
  testingContext: '',
  runtimeQaServerCommand: '',
  runtimeQaReadinessUrl: '',
  runtimeQaStartupTimeoutMs: 60_000,
  runtimeQaPortEnvVar: 'PORT',
  runtimeQaTestCommandsText: '',
  runtimeQaDiscoverAgentTests: true,
  setupBeforeVerify: false,
  envFiles: [],
};

function contractToSetupFormState(contract: RepoSetupContract): ProjectSetupFormState {
  return {
    setupCommandsText: commandsToText(contract.setupCommands),
    verifyCommandsText: commandsToText(contract.verifyCommands),
    testingContext: contract.testingContext ?? '',
    runtimeQaServerCommand: contract.runtimeQa?.server?.command ?? '',
    runtimeQaReadinessUrl: contract.runtimeQa?.server?.readinessUrl ?? '',
    runtimeQaStartupTimeoutMs: contract.runtimeQa?.server?.startupTimeoutMs ?? 60_000,
    runtimeQaPortEnvVar: contract.runtimeQa?.server?.portEnvVar ?? 'PORT',
    runtimeQaTestCommandsText: runtimeQaCommandsToText(contract.runtimeQa),
    runtimeQaDiscoverAgentTests: contract.runtimeQa?.discoverAgentTests ?? true,
    setupBeforeVerify: contract.setupBeforeVerify,
    envFiles: normalizeEnvFiles(contract.envFiles),
  };
}

export function projectSetupFormReducer(
  state: ProjectSetupFormState,
  action: ProjectSetupFormAction,
): ProjectSetupFormState {
  switch (action.type) {
    case 'contract':
      return contractToSetupFormState(action.contract);
    case 'patch':
      return { ...state, ...action.patch };
    case 'env-files': {
      const envFiles =
        typeof action.updater === 'function' ? action.updater(state.envFiles) : action.updater;
      return { ...state, envFiles };
    }
  }
}
