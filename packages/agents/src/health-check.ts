import { exec, execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  AppSettings,
  ChatIntegrationHealth,
  CliHealth,
  CliModelCapabilities,
  CliModelCapabilityOption,
  CliProviderUsageMap,
  CliProviderUsageProvider,
  CliProviderUsageStatus,
  GhAuthStatus,
  IntegrationStatus,
  OpenRouterAuthStatus,
  OpenRouterHealth,
  OpenRouterModelCheck,
  OpenRouterModelValidation,
  ReasoningEffort,
  SystemHealth,
} from '@shipcode/shared';
import {
  fallbackCliModelCapabilities,
  fetchWithTimeout,
  getKnownModelLabel,
  getSupportedReasoningEfforts,
  normalizeReasoningModelId,
  OPENROUTER_API_BASE,
} from '@shipcode/shared';
import * as pty from 'node-pty';
import { clearPoolExhausted, isPoolExhausted } from './agent-sdk-pool-state';
import { checkDesktopApps } from './desktop-app-health';
import {
  normalizeForSearch,
  parseClaudeUsageText,
  parseCodexStatusText,
} from './provider-usage-parsers';
import {
  __resetShellExecEnvCacheForTests,
  assertSafeEnvVarName,
  resolveCommandOnPath,
  shellExecEnv,
} from './shell-env';

export { checkDesktopApps } from './desktop-app-health';
export { parseClaudeUsageText, parseCodexStatusText } from './provider-usage-parsers';
export { shellExecEnv } from './shell-env';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const CLI_USAGE_TIMEOUT_MS = 20_000;
const CLI_USAGE_OUTPUT_TAIL = 8_192;
const SYSTEM_HEALTH_TTL_MS = 30_000;
const SYSTEM_HEALTH_WITH_AUTH_TTL_MS = 30_000;
const PROVIDER_USAGE_TTL_MS = 60_000;
const INTEGRATION_STATUS_TTL_MS = 30_000;
const CLI_MODEL_CAPABILITIES_TTL_MS = 30_000;
const CLI_MODEL_CATALOG_TIMEOUT_MS = 10_000;
const CLI_MODEL_CATALOG_MAX_BUFFER = 10_000_000;
const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

interface TimedCacheEntry<T> {
  value: T;
  cachedAtMs: number;
}

export interface CacheOptions {
  force?: boolean;
}

let systemHealthCache: TimedCacheEntry<SystemHealth> | null = null;
let systemHealthInFlight: Promise<SystemHealth> | null = null;
let systemHealthWithAuthCache: TimedCacheEntry<SystemHealth> | null = null;
let systemHealthWithAuthInFlight: Promise<SystemHealth> | null = null;
let cliModelCapabilitiesCache: TimedCacheEntry<
  Record<'claude' | 'codex' | 'gemini' | 'cursor' | 'grok', CliModelCapabilities>
> | null = null;
let cliModelCapabilitiesInFlight: Promise<
  Record<'claude' | 'codex' | 'gemini' | 'cursor' | 'grok', CliModelCapabilities>
> | null = null;
const providerUsageCache = new Map<
  CliProviderUsageProvider,
  TimedCacheEntry<CliProviderUsageStatus>
>();
const providerUsageInFlight = new Map<CliProviderUsageProvider, Promise<CliProviderUsageStatus>>();
const integrationStatusCache = new Map<string, TimedCacheEntry<IntegrationStatus>>();
const integrationStatusInFlight = new Map<string, Promise<IntegrationStatus>>();
async function checkCli(command: string, versionFlag: string = '--version'): Promise<CliHealth> {
  const env = shellExecEnv();
  try {
    const binaryPath = await resolveCommandOnPath(command, env);

    if (!binaryPath) {
      return {
        available: false,
        version: null,
        path: null,
        error: `${command} not found in PATH`,
        authenticated: false,
      };
    }

    try {
      const versionResult = await execFileAsync(binaryPath, [versionFlag], { env });
      /* v8 ignore next -- CLI version probes always produce either stdout or stderr in supported paths */
      const version = versionResult.stdout.trim() || versionResult.stderr.trim();
      return { available: true, version, path: binaryPath, error: null, authenticated: false };
    } catch {
      return {
        available: true,
        version: null,
        path: binaryPath,
        error: null,
        authenticated: false,
      };
    }
  } catch {
    return {
      available: false,
      version: null,
      path: null,
      error: `${command} not found in PATH`,
      authenticated: false,
    };
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readEnvVar(name: string): Promise<string | null> {
  try {
    assertSafeEnvVarName(name);
    const result = await execFileAsync('printenv', [name], { timeout: 5_000 });
    const value = result.stdout.trim();
    if (value) return value;
  } catch {
    // Fall through to process.env fallback below.
  }

  const fallback = process.env[name]?.trim();
  return fallback ? fallback : null;
}

function getFreshCachedValue<T>(
  entry: TimedCacheEntry<T> | null | undefined,
  ttlMs: number,
): T | null {
  if (!entry) return null;
  /* v8 ignore next -- exact ttl boundary is not semantically distinct from stale/fresh behavior */
  return Date.now() - entry.cachedAtMs < ttlMs ? entry.value : null;
}

function createTimedCacheEntry<T>(value: T): TimedCacheEntry<T> {
  return { value, cachedAtMs: Date.now() };
}

function buildIntegrationStatusCacheKey(settings: AppSettings): string {
  return JSON.stringify({
    discordEnabled: settings.discordEnabled,
    discordWebhookUrl: settings.discordWebhookUrl,
    telegramEnabled: settings.telegramEnabled,
    telegramBotToken: settings.telegramBotToken,
    telegramDefaultChatId: settings.telegramDefaultChatId,
    projectOpenTarget: settings.projectOpenTarget,
    openrouterDefaultPaidModel: settings.openrouterDefaultPaidModel,
    openrouterDefaultFreeModel: settings.openrouterDefaultFreeModel,
    openrouterExplicitFallback: settings.openrouterExplicitFallback,
    openrouterPlannerModel: settings.openrouterPlannerModel,
    openrouterReviewerModel: settings.openrouterReviewerModel,
    openrouterExecutorModel: settings.openrouterExecutorModel,
    openrouterVerifierModel: settings.openrouterVerifierModel,
  });
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value);
}

function summarizeExecFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'usage data unavailable';
  const message = error.message.trim();
  if (!message) return 'usage data unavailable';
  /* v8 ignore next -- split always returns at least one element */
  return message.split('\n')[0]?.slice(0, 200) ?? 'usage data unavailable';
}

function emptyProviderUsage(
  provider: CliProviderUsageProvider,
  checkedAt: string,
  message: string,
  stale = false,
): CliProviderUsageStatus {
  return {
    provider,
    available: false,
    stale,
    state: 'unknown',
    source: null,
    version: null,
    accountEmail: null,
    loginMethod: null,
    updatedAt: null,
    checkedAt,
    message,
    creditsRemaining: null,
    windows: [],
  };
}

interface PtyProbeOptions {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  cols?: number;
  rows?: number;
  initialInput?: string;
  initialDelayMs?: number;
  idleTimeoutMs?: number | null;
  periodicEnterMs?: number | null;
  settleAfterStopMs?: number;
  stopOnSubstrings?: string[];
  sendOnSubstrings?: Record<string, string | { keys: string; delayMs?: number }>;
}

interface ClaudeAuthDetails {
  accountEmail: string | null;
  loginMethod: string | null;
}

export function parseClaudeAuthStatusOutput(stdout: string): ClaudeAuthDetails {
  try {
    const parsed = JSON.parse(stdout) as {
      email?: unknown;
      subscriptionType?: unknown;
      authMethod?: unknown;
    };
    return {
      accountEmail: typeof parsed.email === 'string' && parsed.email.trim() ? parsed.email : null,
      loginMethod:
        typeof parsed.subscriptionType === 'string' && parsed.subscriptionType.trim()
          ? parsed.subscriptionType
          : typeof parsed.authMethod === 'string' && parsed.authMethod.trim()
            ? parsed.authMethod
            : null,
    };
  } catch {
    return { accountEmail: null, loginMethod: null };
  }
}

async function readClaudeAuthDetails(): Promise<ClaudeAuthDetails> {
  try {
    const result = await execAsync('claude auth status', { timeout: 5_000, env: shellExecEnv() });
    const stdout = `${result.stdout}${result.stderr}`.trim();
    return parseClaudeAuthStatusOutput(stdout);
  } catch {
    return { accountEmail: null, loginMethod: null };
  }
}

async function ensureProbeDir(provider: CliProviderUsageProvider): Promise<string> {
  const dir = join(homedir(), '.shipcode', 'provider-probes', provider);
  await mkdir(dir, { recursive: true });
  return dir;
}

function assertProbeDir(cwd: string): void {
  const root = join(homedir(), '.shipcode', 'provider-probes');
  if (cwd !== root && cwd.startsWith(`${root}/`)) return;
  throw new Error(`Provider usage probe cwd is outside the trusted probe directory: ${cwd}`);
}

async function ensureCodexDirTrusted(cwd: string): Promise<void> {
  const configPath = join(homedir(), '.codex', 'config.toml');
  const section = `\n[projects."${cwd}"]\ntrust_level = "trusted"\n`;
  try {
    const content = await readFile(configPath, 'utf8');
    if (content.includes(`[projects."${cwd}"]`)) return;
    await writeFile(configPath, content + section);
  } catch {
    await mkdir(join(homedir(), '.codex'), { recursive: true });
    await writeFile(configPath, section);
  }
}

async function runPtyProbe(options: PtyProbeOptions): Promise<string> {
  const {
    command,
    args,
    cwd,
    timeoutMs,
    cols = 160,
    rows = 50,
    initialInput = '',
    initialDelayMs = 400,
    idleTimeoutMs = 3_000,
    periodicEnterMs = null,
    settleAfterStopMs = 250,
    stopOnSubstrings = [],
    sendOnSubstrings = {},
  } = options;

  assertProbeDir(cwd);

  return new Promise((resolve, reject) => {
    let proc: pty.IPty;
    try {
      proc = pty.spawn(command, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: shellExecEnv(),
      });
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    let output = '';
    let lastOutputAt = Date.now();
    let lastEnterAt = Date.now();
    let stopDetectedAt: number | null = null;
    const triggeredSends = new Set<string>();
    const pendingSendTimers = new Set<NodeJS.Timeout>();
    const normalizedStopNeedles = stopOnSubstrings.map((value) => normalizeForSearch(value));
    const normalizedSendNeedles = Object.entries(sendOnSubstrings).map(([needle, spec]) => {
      const send = typeof spec === 'string' ? { keys: spec } : spec;
      return {
        needle: normalizeForSearch(needle),
        keys: send.keys,
        delayMs: send.delayMs ?? 0,
      };
    });

    const cleanup = () => {
      clearTimeout(initialTimer);
      clearTimeout(timeoutTimer);
      clearInterval(tickTimer);
      for (const timer of pendingSendTimers) clearTimeout(timer);
      pendingSendTimers.clear();
    };

    const finish = (text: string) => {
      /* v8 ignore next -- cleanup removes PTY listeners; guard handles event races */
      if (settled) return;
      settled = true;
      cleanup();
      resolve(text);
    };

    const fail = (error: unknown) => {
      /* v8 ignore next -- cleanup removes PTY listeners; guard handles event races */
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const maybeStop = () => {
      if (stopDetectedAt == null) return;
      if (Date.now() - stopDetectedAt >= settleAfterStopMs) {
        try {
          proc.kill();
        } catch {
          // Ignore best-effort PTY shutdown failures.
        }
        finish(output);
      }
    };

    const writeKeys = (keys: string) => {
      try {
        proc.write(keys);
        lastEnterAt = Date.now();
        if (keys.trim()) {
          lastOutputAt = Date.now();
        }
      } catch {
        // Ignore write races on early exit.
      }
    };

    const initialTimer = setTimeout(() => {
      /* v8 ignore next -- all current probes pass initial input */
      if (!initialInput) return;
      writeKeys(initialInput);
    }, initialDelayMs);

    const timeoutTimer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Ignore best-effort PTY shutdown failures.
      }
      if (output.trim()) {
        finish(output);
        return;
      }
      fail(new Error(`${command} usage probe timed out`));
    }, timeoutMs);

    const tickTimer = setInterval(() => {
      if (periodicEnterMs != null && Date.now() - lastEnterAt >= periodicEnterMs) {
        try {
          proc.write('\r');
        } catch {
          // Ignore write races on exit.
        }
        lastEnterAt = Date.now();
      }

      if (idleTimeoutMs != null && output && Date.now() - lastOutputAt >= idleTimeoutMs) {
        try {
          proc.kill();
        } catch {
          // Ignore best-effort PTY shutdown failures.
        }
        finish(output);
        return;
      }

      maybeStop();
    }, 50);

    proc.onData((data) => {
      output += data;
      lastOutputAt = Date.now();
      const normalizedTail = normalizeForSearch(output.slice(-CLI_USAGE_OUTPUT_TAIL));

      for (const item of normalizedSendNeedles) {
        if (triggeredSends.has(item.needle) || !normalizedTail.includes(item.needle)) continue;
        triggeredSends.add(item.needle);
        if (item.delayMs > 0) {
          const timer = setTimeout(() => {
            pendingSendTimers.delete(timer);
            /* v8 ignore next -- cleanup clears pending delayed sends before settlement */
            if (!settled) writeKeys(item.keys);
          }, item.delayMs);
          pendingSendTimers.add(timer);
        } else {
          writeKeys(item.keys);
        }
      }

      if (
        stopDetectedAt == null &&
        normalizedStopNeedles.some((needle) => normalizedTail.includes(needle))
      ) {
        stopDetectedAt = Date.now();
      }
    });

    proc.onExit(() => {
      finish(output);
    });
  });
}

async function probeClaudeUsage(
  version: string | null,
  binaryPath: string,
): Promise<CliProviderUsageStatus> {
  const checkedAt = new Date().toISOString();
  const [cwd, auth] = await Promise.all([ensureProbeDir('claude'), readClaudeAuthDetails()]);
  const stdout = await runPtyProbe({
    command: binaryPath,
    args: ['--allowed-tools', ''],
    cwd,
    timeoutMs: CLI_USAGE_TIMEOUT_MS,
    rows: 50,
    cols: 160,
    initialInput: '/usage\r',
    initialDelayMs: 1_250,
    idleTimeoutMs: null,
    periodicEnterMs: 600,
    settleAfterStopMs: 750,
    stopOnSubstrings: [
      'Current session',
      'Current week (all models)',
      'Current week (Opus)',
      'Current week (Sonnet only)',
      'Current week (Sonnet)',
      'Extra usage',
      'Failed to load usage data',
    ],
    sendOnSubstrings: {
      'Quick safety check:': '\r',
      'Yes, I trust this folder': '\r',
      'Do you trust the files in this folder?': 'y\r',
      'Do you trust the contents of this directory?': '\r',
      'Ready to code here?': '\r',
      'Press Enter to continue': '\r',
      'Show plan usage limits': '\r',
      'Show plan': '\r',
    },
  });
  return parseClaudeUsageText(stdout, checkedAt, auth, version);
}

async function probeCodexUsage(
  version: string | null,
  binaryPath: string,
): Promise<CliProviderUsageStatus> {
  const checkedAt = new Date().toISOString();
  const cwd = await ensureProbeDir('codex');
  await ensureCodexDirTrusted(cwd);
  const stdout = await runPtyProbe({
    command: binaryPath,
    args: ['-s', 'read-only', '-a', 'untrusted'],
    cwd,
    timeoutMs: Math.min(CLI_USAGE_TIMEOUT_MS, 12_000),
    rows: 70,
    cols: 220,
    initialInput: '/status\r',
    initialDelayMs: 1_750,
    idleTimeoutMs: 4_000,
    periodicEnterMs: 750,
    settleAfterStopMs: 500,
    stopOnSubstrings: ['Credits:', '5h limit', 'Weekly limit'],
    sendOnSubstrings: {
      'refresh requested': { keys: '/status\r', delayMs: 1_500 },
      'Do you trust the contents of this directory?': '\r\n',
      'Yes, continue': '\r\n',
      'Press enter to continue': '\r\n',
    },
  });
  return parseCodexStatusText(stdout, checkedAt, version);
}

async function checkProviderUsage(
  provider: CliProviderUsageProvider,
  options: CacheOptions = {},
): Promise<CliProviderUsageStatus> {
  const checkedAt = new Date().toISOString();
  const cached = getFreshCachedValue(providerUsageCache.get(provider), PROVIDER_USAGE_TTL_MS);
  if (!options.force && cached) {
    return cached;
  }

  const inFlight = providerUsageInFlight.get(provider);
  if (inFlight) {
    return inFlight;
  }

  const run = (async () => {
    try {
      const cli = await checkCli(provider, '--version');
      if (!cli.available || !cli.path) {
        return emptyProviderUsage(provider, checkedAt, `${provider} CLI not found in PATH`);
      }

      const parsed =
        provider === 'claude'
          ? await probeClaudeUsage(cli.version, cli.path)
          : await probeCodexUsage(cli.version, cli.path);
      providerUsageCache.set(provider, createTimedCacheEntry(parsed));
      return parsed;
    } catch (error) {
      const stale = providerUsageCache.get(provider)?.value;
      if (stale) {
        return {
          ...stale,
          stale: true,
          checkedAt,
          message: stale.message ?? `Using cached ${provider} usage data`,
        };
      }
      return emptyProviderUsage(
        provider,
        checkedAt,
        `${provider === 'claude' ? 'Claude' : 'Codex'} CLI usage unavailable: ${summarizeExecFailure(error)}`,
      );
    }
  })();

  providerUsageInFlight.set(provider, run);
  try {
    return await run;
  } finally {
    providerUsageInFlight.delete(provider);
  }
}
const DISCORD_WEBHOOK_RE = /^https:\/\/(?:discord(?:app)?\.com)\/api\/webhooks\/[^/\s]+\/[^/\s]+$/i;
const TELEGRAM_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{20,}$/;

function checkDiscordHealth(settings: AppSettings): ChatIntegrationHealth {
  const webhookUrl = settings.discordWebhookUrl?.trim() ?? null;
  const hasWebhook = !!webhookUrl;
  const valid = webhookUrl ? DISCORD_WEBHOOK_RE.test(webhookUrl) : false;
  return {
    enabled: settings.discordEnabled,
    configured: hasWebhook,
    destinationConfigured: hasWebhook,
    validationStatus: !hasWebhook ? 'missing' : valid ? 'valid' : 'invalid',
    message: !hasWebhook
      ? 'Discord webhook URL is not configured'
      : valid
        ? null
        : 'Discord webhook URL is invalid',
    lastDeliveryStatus: settings.discordLastDeliveryStatus,
  };
}

function checkTelegramHealth(settings: AppSettings): ChatIntegrationHealth {
  const token = settings.telegramBotToken?.trim() ?? null;
  const chatId = settings.telegramDefaultChatId?.trim() ?? null;
  const tokenValid = token ? TELEGRAM_TOKEN_RE.test(token) : false;
  return {
    enabled: settings.telegramEnabled,
    configured: !!token && !!chatId,
    destinationConfigured: !!chatId,
    validationStatus: !token || !chatId ? 'missing' : tokenValid ? 'valid' : 'invalid',
    message: !token
      ? 'Telegram bot token is not configured'
      : !chatId
        ? 'Telegram default chat ID is not configured'
        : tokenValid
          ? null
          : 'Telegram bot token is invalid',
    lastDeliveryStatus: settings.telegramLastDeliveryStatus,
  };
}

export async function checkClaudeAuth(): Promise<boolean> {
  try {
    await execAsync('claude auth status', { timeout: 10_000, env: shellExecEnv() });
    return true;
  } catch {
    // Command may not exist or not in PATH — fall back to credential file check
  }

  const credentialPath = join(homedir(), '.claude', '.credentials.json');
  return fileExists(credentialPath);
}

export async function checkCodexAuth(): Promise<boolean> {
  // Check for OPENAI_API_KEY via shell spawn (Electron Dock launch doesn't inherit shell env)
  if (await readEnvVar('OPENAI_API_KEY')) {
    return true;
  }

  // Check for Codex auth config file
  const codexAuthPath = join(homedir(), '.codex', 'auth.json');
  return fileExists(codexAuthPath);
}

export async function checkGeminiAuth(): Promise<boolean> {
  if ((await readEnvVar('GEMINI_API_KEY')) || (await readEnvVar('GOOGLE_API_KEY'))) {
    return true;
  }

  try {
    await execAsync('gemini auth status', { timeout: 10_000, env: shellExecEnv() });
    return true;
  } catch {
    return false;
  }
}

export async function checkCursorAuth(): Promise<boolean> {
  // Headless fallback: an API key authenticates without an interactive login.
  if (await readEnvVar('CURSOR_API_KEY')) {
    return true;
  }

  // Otherwise rely on the CLI's own stored credentials (`cursor-agent login`).
  try {
    await execAsync('cursor-agent status', { timeout: 10_000, env: shellExecEnv() });
    return true;
  } catch {
    return false;
  }
}

export async function checkGrokAuth(): Promise<boolean> {
  // Headless fallback: xAI's standard env var authenticates without a login.
  if (await readEnvVar('XAI_API_KEY')) {
    return true;
  }

  // Otherwise rely on the CLI's own stored credentials. Grok Build has no
  // `grok auth status` subcommand — its command surface is `grok login` /
  // `grok logout`, which read/write `~/.grok/auth.json` (mode 0600). Probing a
  // nonexistent subcommand exits non-zero and would fail closed even when the
  // user is logged in, so we check for the credential file directly, mirroring
  // `checkCodexAuth`'s `~/.codex/auth.json` check.
  const grokAuthPath = join(homedir(), '.grok', 'auth.json');
  return fileExists(grokAuthPath);
}

export type OpenRouterAuthCheckResult =
  | { ok: true; label?: string }
  | {
      ok: false;
      reason: 'missing_key' | 'invalid_key' | 'unreachable' | 'model_deprecated';
      message: string;
    };

/**
 * Validate OpenRouter API key against the live service and (optionally)
 * check whether a pinned model is still served. Non-fatal: callers treat
 * a failure as a warning, not a hard error, so pipelines configured to
 * use claude/codex still onboard cleanly.
 *
 * @param apiKey - the OPENROUTER_API_KEY env value; pass `undefined` to
 *                 signal "not set"
 * @param pinnedModel - optional model slug to validate via /models/{id}
 */
export async function checkOpenRouterAuth(
  apiKey: string | undefined,
  pinnedModel?: string | null,
): Promise<OpenRouterAuthCheckResult> {
  if (!apiKey) {
    return { ok: false, reason: 'missing_key', message: 'OPENROUTER_API_KEY is not set' };
  }

  // Hit /auth/key to validate credentials. OpenRouter's public docs call
  // this endpoint `GET /api/v1/auth/key`, but it's also historically been
  // reachable at `/key` — we hit the documented one.
  let keyResponse: Response;
  try {
    keyResponse = await fetchWithTimeout(
      `${OPENROUTER_API_BASE}/auth/key`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      },
      10_000,
    );
  } catch (err) {
    return {
      ok: false,
      reason: 'unreachable',
      message: err instanceof Error ? err.message : 'OpenRouter unreachable',
    };
  }

  if (keyResponse.status === 401 || keyResponse.status === 403) {
    return {
      ok: false,
      reason: 'invalid_key',
      message: `OpenRouter rejected API key (HTTP ${keyResponse.status})`,
    };
  }
  if (!keyResponse.ok) {
    return {
      ok: false,
      reason: 'unreachable',
      message: `OpenRouter auth check returned HTTP ${keyResponse.status}`,
    };
  }

  let label: string | undefined;
  try {
    const body = (await keyResponse.json()) as { data?: { label?: string } };
    label = body?.data?.label;
  } catch {
    // Non-fatal — auth was OK.
  }

  // Optional: verify the user's pinned model is still served. OpenRouter
  // deprecates free models occasionally, so this catches stale config
  // before the pipeline hits a 404 mid-run.
  if (pinnedModel) {
    try {
      // /models returns the whole catalog; scanning it is cheaper than
      // assuming a /models/{id} endpoint exists (it doesn't reliably).
      const modelsRes = await fetchWithTimeout(
        `${OPENROUTER_API_BASE}/models`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
        },
        10_000,
      );
      /* v8 ignore next -- non-OK catalog validation is non-fatal by design */
      if (modelsRes.ok) {
        const body = (await modelsRes.json()) as { data?: Array<{ id: string }> };
        const exists = (body.data as Array<{ id: string }>).some((m) => m.id === pinnedModel);
        if (!exists) {
          return {
            ok: false,
            reason: 'model_deprecated',
            message: `OpenRouter model '${pinnedModel}' is not available (may be deprecated)`,
          };
        }
      }
    } catch {
      // Non-fatal — key was OK, we just couldn't verify the model.
    }
  }

  return { ok: true, label };
}

function openRouterAuthStatusFromFailure(
  result: Exclude<OpenRouterAuthCheckResult, { ok: true }>,
): OpenRouterAuthStatus {
  switch (result.reason) {
    case 'missing_key':
      return 'missing_key';
    case 'invalid_key':
      return 'invalid_key';
    case 'unreachable':
      return 'unreachable';
    case 'model_deprecated':
      return 'model_deprecated';
    default: {
      const exhaustiveReason: never = result.reason;
      return exhaustiveReason;
    }
  }
}

async function fetchOpenRouterCatalog(apiKey: string): Promise<Set<string> | null> {
  try {
    const modelsRes = await fetchWithTimeout(
      `${OPENROUTER_API_BASE}/models`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      },
      10_000,
    );
    if (!modelsRes.ok) return null;
    const body = (await modelsRes.json()) as { data?: Array<{ id: string }> };
    return new Set((body.data as Array<{ id: string }>).map((model) => model.id));
  } catch {
    return null;
  }
}

function buildOpenRouterModelChecks(
  settings: AppSettings,
  catalog: Set<string> | null,
  message: string | null,
): OpenRouterModelCheck[] {
  const configured: Array<{ key: string; label: string; modelId: string | null }> = [
    {
      key: 'default_paid',
      label: 'Default paid model',
      modelId: settings.openrouterDefaultPaidModel,
    },
    {
      key: 'default_free',
      label: 'Default free model',
      modelId: settings.openrouterDefaultFreeModel,
    },
    {
      key: 'explicit_fallback',
      label: 'Explicit fallback',
      modelId: settings.openrouterExplicitFallback,
    },
    { key: 'planner', label: 'Planner default', modelId: settings.openrouterPlannerModel },
    { key: 'reviewer', label: 'Reviewer default', modelId: settings.openrouterReviewerModel },
    { key: 'executor', label: 'Executor default', modelId: settings.openrouterExecutorModel },
    { key: 'verifier', label: 'Verifier default', modelId: settings.openrouterVerifierModel },
  ];

  return configured.map(({ key, label, modelId }) => {
    if (!modelId) {
      return { key, label, modelId: null, status: 'not_configured', message: null };
    }
    const normalizedModelId = normalizeReasoningModelId('openrouter', modelId) as string;
    if (!catalog) {
      return { key, label, modelId: normalizedModelId, status: 'unverified', message };
    }
    return {
      key,
      label,
      modelId: normalizedModelId,
      status: catalog.has(normalizedModelId) ? 'valid' : 'invalid',
      message: catalog.has(normalizedModelId)
        ? null
        : `Model '${normalizedModelId}' is not available on OpenRouter`,
    };
  });
}

export async function checkOpenRouterHealth(settings: AppSettings): Promise<OpenRouterHealth> {
  const apiKey = await readEnvVar('OPENROUTER_API_KEY');

  if (!apiKey) {
    return {
      enabled: false,
      keyPresent: false,
      authStatus: 'missing_key',
      message: 'OPENROUTER_API_KEY is not set',
      label: null,
      modelChecks: buildOpenRouterModelChecks(
        settings,
        null,
        'Set OPENROUTER_API_KEY to verify configured model slugs',
      ),
    };
  }

  const auth = await checkOpenRouterAuth(apiKey);
  if (!auth.ok) {
    return {
      enabled: true,
      keyPresent: true,
      authStatus: openRouterAuthStatusFromFailure(auth),
      message: auth.message,
      label: null,
      modelChecks: buildOpenRouterModelChecks(settings, null, auth.message),
    };
  }

  const catalog = await fetchOpenRouterCatalog(apiKey);
  return {
    enabled: true,
    keyPresent: true,
    authStatus: 'valid',
    message: catalog ? null : 'Authenticated, but OpenRouter model catalog could not be fetched',
    label: auth.label ?? null,
    modelChecks: buildOpenRouterModelChecks(
      settings,
      catalog,
      'Authenticated, but model catalog could not be fetched',
    ),
  };
}

export async function validateOpenRouterModel(
  settings: AppSettings,
  modelId: string,
): Promise<OpenRouterModelValidation> {
  const trimmed = normalizeReasoningModelId('openrouter', modelId.trim()) ?? modelId.trim();
  if (!trimmed) {
    return { modelId: trimmed, status: 'unverified', message: 'Model slug is required' };
  }

  const health = await checkOpenRouterHealth(settings);
  if (health.authStatus !== 'valid') {
    return {
      modelId: trimmed,
      status: 'unverified',
      message: health.message as string,
    };
  }

  const catalog = await fetchOpenRouterCatalog((await readEnvVar('OPENROUTER_API_KEY')) as string);
  if (!catalog) {
    return {
      modelId: trimmed,
      status: 'unverified',
      message: 'OpenRouter model catalog could not be fetched',
    };
  }

  return catalog.has(trimmed)
    ? { modelId: trimmed, status: 'valid', message: null }
    : {
        modelId: trimmed,
        status: 'invalid',
        message: `Model '${trimmed}' is not available on OpenRouter`,
      };
}

async function getGhVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('gh', ['--version'], {
      timeout: 5_000,
      env: shellExecEnv(),
    });
    const match = stdout.match(/gh version (\S+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Parse the comma-separated `Token scopes:` line from `gh auth status`
 * output and check whether `project` (write) is granted. The `project`
 * scope implies `read:project`. Returns `null` if no scopes line is
 * found (old gh versions, or auth failed).
 */
export function parseGhProjectScope(output: string): boolean | null {
  const match = output.match(/Token scopes:\s*([^\n]+)/i);
  if (!match) return null;
  const scopes = match[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
  return scopes.includes('project');
}

export async function checkGhAuth(): Promise<GhAuthStatus> {
  const env = shellExecEnv();
  try {
    const [result, version] = await Promise.all([
      execFileAsync('gh', ['auth', 'status'], { timeout: 10_000, env }),
      getGhVersion(),
    ]);
    const output = result.stdout + result.stderr;
    const usernameMatch = output.match(/Logged in to github\.com.*account\s+(\S+)/);
    return {
      installed: true,
      authenticated: true,
      username: usernameMatch?.[1] ?? null,
      version,
      error: null,
      hasProjectScope: parseGhProjectScope(output),
    };
  } catch (err) {
    try {
      const [, version] = await Promise.all([resolveCommandOnPath('gh', env), getGhVersion()]);
      return {
        installed: true,
        authenticated: false,
        username: null,
        version,
        error: (err as Error).message,
        hasProjectScope: null,
      };
    } catch {
      return {
        installed: false,
        authenticated: false,
        username: null,
        version: null,
        error: 'gh not found in PATH',
        hasProjectScope: null,
      };
    }
  }
}

export async function checkSystemHealth(options: CacheOptions = {}): Promise<SystemHealth> {
  const cached = getFreshCachedValue(systemHealthCache, SYSTEM_HEALTH_TTL_MS);
  if (!options.force && cached) {
    return cached;
  }

  if (systemHealthInFlight) {
    return systemHealthInFlight;
  }

  systemHealthInFlight = (async () => {
    const [claude, codex, gemini, cursor, grok, git, gh] = await Promise.all([
      checkCli('claude', '--version'),
      checkCli('codex', '--version'),
      checkCli('gemini', '--version'),
      checkCli('cursor-agent', '--version'),
      checkCli('grok', '--version'),
      checkCli('git', '--version'),
      checkCli('gh', '--version'),
    ]);

    const result = { claude, codex, gemini, cursor, grok, git, gh };
    systemHealthCache = createTimedCacheEntry(result);
    return result;
  })();

  try {
    return await systemHealthInFlight;
  } finally {
    systemHealthInFlight = null;
  }
}

export async function checkSystemHealthWithAuth(options: CacheOptions = {}): Promise<SystemHealth> {
  const cached = getFreshCachedValue(systemHealthWithAuthCache, SYSTEM_HEALTH_WITH_AUTH_TTL_MS);
  if (!options.force && cached) {
    return cached;
  }

  if (systemHealthWithAuthInFlight) {
    return systemHealthWithAuthInFlight;
  }

  systemHealthWithAuthInFlight = (async () => {
    const [health, claudeAuth, codexAuth, geminiAuth, cursorAuth, grokAuth] = await Promise.all([
      checkSystemHealth(options),
      checkClaudeAuth(),
      checkCodexAuth(),
      checkGeminiAuth(),
      checkCursorAuth(),
      checkGrokAuth(),
    ]);

    const gemini = health.gemini;
    const cursor = health.cursor;
    const grok = health.grok;
    const result: SystemHealth = {
      ...health,
      claude: { ...health.claude, authenticated: health.claude.available && claudeAuth },
      codex: { ...health.codex, authenticated: health.codex.available && codexAuth },
      ...(gemini ? { gemini: { ...gemini, authenticated: gemini.available && geminiAuth } } : {}),
      ...(cursor ? { cursor: { ...cursor, authenticated: cursor.available && cursorAuth } } : {}),
      ...(grok ? { grok: { ...grok, authenticated: grok.available && grokAuth } } : {}),
    };
    systemHealthWithAuthCache = createTimedCacheEntry(result);
    return result;
  })();

  try {
    return await systemHealthWithAuthInFlight;
  } finally {
    systemHealthWithAuthInFlight = null;
  }
}

interface CodexDebugModelsResponse {
  models?: Array<{
    slug?: unknown;
    display_name?: unknown;
    description?: unknown;
    default_reasoning_level?: unknown;
    supported_reasoning_levels?: Array<{ effort?: unknown }> | unknown;
    visibility?: unknown;
  }>;
}

export function parseCodexDebugModels(
  stdout: string,
  checkedAt = new Date().toISOString(),
): CliModelCapabilities {
  const parsed = JSON.parse(stdout) as CodexDebugModelsResponse;
  const models = Array.isArray(parsed.models) ? parsed.models : [];
  const options: CliModelCapabilityOption[] = [];

  for (const model of models) {
    const value = typeof model.slug === 'string' ? model.slug.trim() : '';
    if (!value || model.visibility === 'hide') continue;

    const supportedRaw = Array.isArray(model.supported_reasoning_levels)
      ? model.supported_reasoning_levels
      : [];
    const supported = supportedRaw.map((entry) => entry.effort).filter(isReasoningEffort);
    const fallbackEfforts = getSupportedReasoningEfforts('codex', value);
    const defaultReasoningEffort = isReasoningEffort(model.default_reasoning_level)
      ? model.default_reasoning_level
      : (supported[0] ?? fallbackEfforts[0]);

    options.push({
      value,
      label:
        getKnownModelLabel(value) ??
        (typeof model.display_name === 'string' && model.display_name.trim()
          ? model.display_name.trim()
          : value),
      description:
        typeof model.description === 'string' && model.description.trim()
          ? model.description.trim()
          : null,
      defaultReasoningEffort,
      supportedReasoningEfforts: supported.length > 0 ? supported : [...fallbackEfforts],
    });
  }

  return {
    provider: 'codex',
    source: 'catalog',
    models: options,
    error: null,
    checkedAt,
  };
}

export async function checkCodexModelCapabilities(): Promise<CliModelCapabilities> {
  const checkedAt = new Date().toISOString();
  try {
    const { stdout } = await execAsync('codex debug models', {
      timeout: CLI_MODEL_CATALOG_TIMEOUT_MS,
      maxBuffer: CLI_MODEL_CATALOG_MAX_BUFFER,
      env: shellExecEnv(),
    });
    const capabilities = parseCodexDebugModels(stdout, checkedAt);
    if (capabilities.models.length > 0) return capabilities;
    return {
      ...fallbackCliModelCapabilities('codex', checkedAt),
      error:
        'Codex model catalog returned no selectable models; using conservative ShipCode presets.',
    };
  } catch (error) {
    return {
      ...fallbackCliModelCapabilities('codex', checkedAt),
      error: `Codex model catalog unavailable: ${summarizeExecFailure(error)}`,
    };
  }
}

export async function checkClaudeModelCapabilities(): Promise<CliModelCapabilities> {
  const checkedAt = new Date().toISOString();
  try {
    await execAsync('claude --help', {
      timeout: CLI_MODEL_CATALOG_TIMEOUT_MS,
      maxBuffer: 512_000,
      env: shellExecEnv(),
    });
    return fallbackCliModelCapabilities('claude', checkedAt);
  } catch (error) {
    return {
      provider: 'claude',
      source: 'unavailable',
      models: [],
      error: `Claude CLI unavailable: ${summarizeExecFailure(error)}`,
      checkedAt,
    };
  }
}

export async function checkGeminiModelCapabilities(): Promise<CliModelCapabilities> {
  const checkedAt = new Date().toISOString();
  try {
    await execAsync('gemini --help', {
      timeout: CLI_MODEL_CATALOG_TIMEOUT_MS,
      maxBuffer: 512_000,
      env: shellExecEnv(),
    });
    return fallbackCliModelCapabilities('gemini', checkedAt);
  } catch (error) {
    return {
      provider: 'gemini',
      source: 'unavailable',
      models: [],
      error: `Gemini CLI unavailable: ${summarizeExecFailure(error)}`,
      checkedAt,
    };
  }
}

export async function checkCursorModelCapabilities(): Promise<CliModelCapabilities> {
  const checkedAt = new Date().toISOString();
  try {
    await execAsync('cursor-agent --help', {
      timeout: CLI_MODEL_CATALOG_TIMEOUT_MS,
      maxBuffer: 512_000,
      env: shellExecEnv(),
    });
    // Cursor has no queryable model catalog; ShipCode exposes only `auto`.
    return fallbackCliModelCapabilities('cursor', checkedAt);
  } catch (error) {
    return {
      provider: 'cursor',
      source: 'unavailable',
      models: [],
      error: `Cursor CLI unavailable: ${summarizeExecFailure(error)}`,
      checkedAt,
    };
  }
}

export async function checkGrokModelCapabilities(): Promise<CliModelCapabilities> {
  const checkedAt = new Date().toISOString();
  try {
    await execAsync('grok --help', {
      timeout: CLI_MODEL_CATALOG_TIMEOUT_MS,
      maxBuffer: 512_000,
      env: shellExecEnv(),
    });
    // Grok Build has no queryable model catalog; ShipCode exposes the pinned
    // default (`grok-4.5`).
    return fallbackCliModelCapabilities('grok', checkedAt);
  } catch (error) {
    return {
      provider: 'grok',
      source: 'unavailable',
      models: [],
      error: `Grok CLI unavailable: ${summarizeExecFailure(error)}`,
      checkedAt,
    };
  }
}

export async function checkCliModelCapabilities(
  options: CacheOptions = {},
): Promise<Record<'claude' | 'codex' | 'gemini' | 'cursor' | 'grok', CliModelCapabilities>> {
  const cached = getFreshCachedValue(cliModelCapabilitiesCache, CLI_MODEL_CAPABILITIES_TTL_MS);
  if (!options.force && cached) return cached;
  if (cliModelCapabilitiesInFlight) return cliModelCapabilitiesInFlight;

  cliModelCapabilitiesInFlight = (async () => {
    const [claude, codex, gemini, cursor, grok] = await Promise.all([
      checkClaudeModelCapabilities(),
      checkCodexModelCapabilities(),
      checkGeminiModelCapabilities(),
      checkCursorModelCapabilities(),
      checkGrokModelCapabilities(),
    ]);
    const result = { claude, codex, gemini, cursor, grok };
    cliModelCapabilitiesCache = createTimedCacheEntry(result);
    return result;
  })();

  try {
    return await cliModelCapabilitiesInFlight;
  } finally {
    cliModelCapabilitiesInFlight = null;
  }
}

export async function checkCliProviderUsage(
  options: CacheOptions = {},
): Promise<CliProviderUsageMap> {
  const [claude, codex] = await Promise.all([
    checkProviderUsage('claude', options),
    checkProviderUsage('codex', options),
  ]);
  return { claude: overlayClaudePoolState(claude), codex };
}

/**
 * Agent-SDK (`claude -p`) credit-pool exhaustion is detected by failure and
 * held in process memory, not in the `/usage` panel (which never surfaces the
 * pool). Overlay the live usage status with that signal at the return boundary
 * so the existing provider-usage UI renders it — without contaminating the 60s
 * usage cache with this ephemeral state.
 */
function overlayClaudePoolState(status: CliProviderUsageStatus): CliProviderUsageStatus {
  if (!isPoolExhausted()) return status;
  return {
    ...status,
    state: 'blocked',
    message: 'Agent-SDK credit pool exhausted — claude -p falls back to interactive CLI',
  };
}

export async function checkIntegrationStatus(
  settings: AppSettings,
  options: CacheOptions = {},
): Promise<IntegrationStatus> {
  const cacheKey = buildIntegrationStatusCacheKey(settings);
  const cached = getFreshCachedValue(
    integrationStatusCache.get(cacheKey),
    INTEGRATION_STATUS_TTL_MS,
  );
  if (!options.force && cached) {
    return cached;
  }

  const inFlight = integrationStatusInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const run = (async () => {
    const [system, modelCapabilities, ghAuth, openrouter, desktopApps] = await Promise.all([
      checkSystemHealthWithAuth(options),
      checkCliModelCapabilities(options),
      checkGhAuth(),
      checkOpenRouterHealth(settings),
      checkDesktopApps(),
    ]);

    const result = {
      system,
      modelCapabilities,
      ghAuth,
      openrouter,
      discord: checkDiscordHealth(settings),
      telegram: checkTelegramHealth(settings),
      desktopApps,
    };
    integrationStatusCache.set(cacheKey, createTimedCacheEntry(result));
    return result;
  })();

  integrationStatusInFlight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    integrationStatusInFlight.delete(cacheKey);
  }
}

/**
 * @knipignore
 */
export function __resetHealthCheckCachesForTests(): void {
  __resetShellExecEnvCacheForTests();
  systemHealthCache = null;
  systemHealthInFlight = null;
  systemHealthWithAuthCache = null;
  systemHealthWithAuthInFlight = null;
  cliModelCapabilitiesCache = null;
  cliModelCapabilitiesInFlight = null;
  providerUsageCache.clear();
  providerUsageInFlight.clear();
  integrationStatusCache.clear();
  integrationStatusInFlight.clear();
  clearPoolExhausted();
}
