import type { PhaseCliProvider, ReasoningEffort } from './agents';
import type { GhAuthStatus } from './dashboard';
import type { IntegrationDeliveryStatus, ProjectOpenTarget } from './settings';

// === CLI Health ===

export interface CliHealth {
  available: boolean;
  version: string | null;
  path: string | null;
  error: string | null;
  authenticated: boolean;
}

export type CliModelCapabilitySource = 'catalog' | 'fallback' | 'unavailable';

export interface CliModelCapabilityOption {
  value: string;
  label: string;
  description: string | null;
  defaultReasoningEffort: ReasoningEffort | null;
  supportedReasoningEfforts: ReasoningEffort[];
}

export interface CliModelCapabilities {
  provider: PhaseCliProvider;
  source: CliModelCapabilitySource;
  models: CliModelCapabilityOption[];
  error: string | null;
  checkedAt: string;
}

export type CliProviderUsageProvider = 'claude' | 'codex';
export type CliProviderUsageState = 'unknown' | 'ready' | 'warning' | 'blocked';
export type CliProviderUsageWindowKey = 'session' | 'weekly' | 'model';

export interface CliProviderUsageWindow {
  key: CliProviderUsageWindowKey;
  label: string;
  usedPercent: number | null;
  leftPercent: number | null;
  resetsAt: string | null;
  resetDescription: string | null;
}

export interface CliProviderUsageStatus {
  provider: CliProviderUsageProvider;
  available: boolean;
  stale: boolean;
  state: CliProviderUsageState;
  source: string | null;
  version: string | null;
  accountEmail: string | null;
  loginMethod: string | null;
  updatedAt: string | null;
  checkedAt: string;
  message: string | null;
  creditsRemaining: number | null;
  windows: CliProviderUsageWindow[];
}

export interface CliProviderUsageMap {
  claude: CliProviderUsageStatus;
  codex: CliProviderUsageStatus;
}

export interface WritingPrdsSkillInfo {
  projectId: string;
  projectPath: string;
  absolutePath: string;
  exists: boolean;
  usingFallback: boolean;
  openTargetPath: string;
}

// === Repo Skill Bundle Keys ===

export const REPO_SKILL_BUNDLE_KEYS = ['dev-loop'] as const;

export type RepoSkillBundleKey = (typeof REPO_SKILL_BUNDLE_KEYS)[number];

export interface RepoSkillSeedFile {
  path: string;
  status: 'written' | 'skipped';
}

export interface RepoSkillSeedResult {
  bundle: RepoSkillBundleKey;
  targetDir: string;
  files: RepoSkillSeedFile[];
}

export interface DesktopAppHealth {
  key: ProjectOpenTarget;
  label: string;
  available: boolean;
  path: string | null;
  error: string | null;
}

export interface DesktopAppHealthMap {
  cursor: DesktopAppHealth;
  finder: DesktopAppHealth;
  terminal: DesktopAppHealth;
  ghostty: DesktopAppHealth;
  vscode: DesktopAppHealth;
  t3code: DesktopAppHealth;
}

export interface SystemHealth {
  claude: CliHealth;
  codex: CliHealth;
  gemini?: CliHealth;
  cursor?: CliHealth;
  git: CliHealth;
  gh: CliHealth;
}

export type OpenRouterAuthStatus = 'missing_key' | 'valid' | 'invalid_key' | 'unreachable';

export type OpenRouterModelStatus = 'not_configured' | 'valid' | 'invalid' | 'unverified';

export interface OpenRouterModelCheck {
  key: string;
  label: string;
  modelId: string | null;
  status: OpenRouterModelStatus;
  message: string | null;
}

export interface OpenRouterHealth {
  enabled: boolean;
  keyPresent: boolean;
  authStatus: OpenRouterAuthStatus;
  message: string | null;
  label: string | null;
  modelChecks: OpenRouterModelCheck[];
}

export type ChatIntegrationValidationStatus = 'missing' | 'valid' | 'invalid';

export interface DiscordIntegrationSettings {
  enabled: boolean;
  webhookUrl: string | null;
  lastDeliveryStatus: IntegrationDeliveryStatus | null;
}

export interface TelegramIntegrationSettings {
  enabled: boolean;
  botToken: string | null;
  defaultChatId: string | null;
  lastDeliveryStatus: IntegrationDeliveryStatus | null;
}

export interface ChatIntegrationHealth {
  enabled: boolean;
  configured: boolean;
  destinationConfigured: boolean;
  validationStatus: ChatIntegrationValidationStatus;
  message: string | null;
  lastDeliveryStatus: IntegrationDeliveryStatus | null;
}

export interface IntegrationStatus {
  system: SystemHealth;
  modelCapabilities?: Record<PhaseCliProvider, CliModelCapabilities>;
  ghAuth: GhAuthStatus;
  openrouter: OpenRouterHealth;
  discord: ChatIntegrationHealth;
  telegram: ChatIntegrationHealth;
  desktopApps: DesktopAppHealthMap;
}

export interface OpenRouterModelValidation {
  modelId: string;
  status: 'valid' | 'invalid' | 'unverified';
  message: string | null;
}
