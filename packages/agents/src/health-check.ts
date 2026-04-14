import { exec } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  AppSettings,
  ChatIntegrationHealth,
  CliHealth,
  DesktopAppHealth,
  DesktopAppHealthMap,
  GhAuthStatus,
  IntegrationStatus,
  OpenRouterHealth,
  OpenRouterModelCheck,
  OpenRouterModelValidation,
  ProjectOpenTarget,
  SystemHealth,
} from '@shipcode/shared';
import { OPENROUTER_API_BASE } from '@shipcode/shared';

const execAsync = promisify(exec);
const DESKTOP_APP_LABELS: Record<ProjectOpenTarget, string> = {
  cursor: 'Cursor',
  finder: 'Finder',
  terminal: 'Terminal',
  ghostty: 'Ghostty',
  vscode: 'Visual Studio Code',
};

async function checkCli(command: string, versionFlag: string = '--version'): Promise<CliHealth> {
  try {
    const whichResult = await execAsync(`which ${command}`);
    const binaryPath = whichResult.stdout.trim();

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
      const versionResult = await execAsync(`${command} ${versionFlag}`);
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

function unavailableDesktopApp(key: ProjectOpenTarget, error: string): DesktopAppHealth {
  return {
    key,
    label: DESKTOP_APP_LABELS[key],
    available: false,
    path: null,
    error,
  };
}

async function checkDesktopAppByName(
  key: ProjectOpenTarget,
  appName: string,
): Promise<DesktopAppHealth> {
  if (process.platform !== 'darwin') {
    return unavailableDesktopApp(key, 'Desktop app detection is currently macOS-only');
  }

  if (key === 'finder') {
    return {
      key,
      label: DESKTOP_APP_LABELS[key],
      available: true,
      path: '/System/Library/CoreServices/Finder.app',
      error: null,
    };
  }

  const escapedName = appName.replace(/"/g, '\\"');
  try {
    const { stdout } = await execAsync(
      `osascript -e 'POSIX path of (path to application "${escapedName}")'`,
      { timeout: 5_000 },
    );
    const path = stdout.trim();
    return {
      key,
      label: DESKTOP_APP_LABELS[key],
      available: !!path,
      path: path || null,
      error: path ? null : `${appName} is not installed`,
    };
  } catch {
    return unavailableDesktopApp(key, `${appName} is not installed`);
  }
}

export async function checkDesktopApps(): Promise<DesktopAppHealthMap> {
  const [cursor, finder, terminal, ghostty, vscode] = await Promise.all([
    checkDesktopAppByName('cursor', 'Cursor'),
    checkDesktopAppByName('finder', 'Finder'),
    checkDesktopAppByName('terminal', 'Terminal'),
    checkDesktopAppByName('ghostty', 'Ghostty'),
    checkDesktopAppByName('vscode', 'Visual Studio Code'),
  ]);

  return { cursor, finder, terminal, ghostty, vscode };
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
    const result = await execAsync(`printenv ${name}`, { timeout: 5_000 });
    const value = result.stdout.trim();
    if (value) return value;
  } catch {
    // Fall through to process.env fallback below.
  }

  const fallback = process.env[name]?.trim();
  return fallback ? fallback : null;
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
    // Try `claude auth status` first (supported in newer CLI versions)
    // execAsync resolves on exit code 0, so reaching here means authenticated
    await execAsync('claude auth status', { timeout: 10_000 });
    return true;
  } catch {
    // Command may not exist in older versions — fall back to credential file check
  }

  // Fall back to checking for credential files
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

export type OpenRouterAuthStatus =
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
): Promise<OpenRouterAuthStatus> {
  if (!apiKey) {
    return { ok: false, reason: 'missing_key', message: 'OPENROUTER_API_KEY is not set' };
  }

  // Hit /auth/key to validate credentials. OpenRouter's public docs call
  // this endpoint `GET /api/v1/auth/key`, but it's also historically been
  // reachable at `/key` — we hit the documented one.
  let keyResponse: Response;
  try {
    keyResponse = await fetch(`${OPENROUTER_API_BASE}/auth/key`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
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
      const modelsRes = await fetch(`${OPENROUTER_API_BASE}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (modelsRes.ok) {
        const body = (await modelsRes.json()) as { data?: Array<{ id: string }> };
        const exists = body?.data?.some((m) => m.id === pinnedModel) ?? false;
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

async function fetchOpenRouterCatalog(apiKey: string): Promise<Set<string> | null> {
  try {
    const modelsRes = await fetch(`${OPENROUTER_API_BASE}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!modelsRes.ok) return null;
    const body = (await modelsRes.json()) as { data?: Array<{ id: string }> };
    return new Set((body.data ?? []).map((model) => model.id));
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
    if (!catalog) {
      return { key, label, modelId, status: 'unverified', message };
    }
    return {
      key,
      label,
      modelId,
      status: catalog.has(modelId) ? 'valid' : 'invalid',
      message: catalog.has(modelId) ? null : `Model '${modelId}' is not available on OpenRouter`,
    };
  });
}

export async function checkOpenRouterHealth(settings: AppSettings): Promise<OpenRouterHealth> {
  const apiKey = await readEnvVar('OPENROUTER_API_KEY');
  const keyPresent = !!apiKey;

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
    const authStatus =
      auth.reason === 'invalid_key'
        ? 'invalid_key'
        : auth.reason === 'unreachable'
          ? 'unreachable'
          : 'missing_key';
    return {
      enabled: true,
      keyPresent: true,
      authStatus,
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
  const trimmed = modelId.trim();
  if (!trimmed) {
    return { modelId: trimmed, status: 'unverified', message: 'Model slug is required' };
  }

  const health = await checkOpenRouterHealth(settings);
  if (health.authStatus !== 'valid') {
    return {
      modelId: trimmed,
      status: 'unverified',
      message: health.message ?? 'OpenRouter is not ready; model slug was not verified',
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
    const { stdout } = await execAsync('gh --version', { timeout: 5_000 });
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
  try {
    const [result, version] = await Promise.all([
      execAsync('gh auth status 2>&1', { timeout: 10_000 }),
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
    // Check if gh is installed but not authenticated
    try {
      const [, version] = await Promise.all([execAsync('which gh'), getGhVersion()]);
      return {
        installed: true,
        authenticated: false,
        username: null,
        version,
        error: err instanceof Error ? err.message : 'gh auth check failed',
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

export async function checkSystemHealth(): Promise<SystemHealth> {
  const [claude, codex, git, gh] = await Promise.all([
    checkCli('claude', '--version'),
    checkCli('codex', '--version'),
    checkCli('git', '--version'),
    checkCli('gh', '--version'),
  ]);

  return { claude, codex, git, gh };
}

export async function checkSystemHealthWithAuth(): Promise<SystemHealth> {
  const [health, claudeAuth, codexAuth] = await Promise.all([
    checkSystemHealth(),
    checkClaudeAuth(),
    checkCodexAuth(),
  ]);

  return {
    ...health,
    claude: { ...health.claude, authenticated: health.claude.available && claudeAuth },
    codex: { ...health.codex, authenticated: health.codex.available && codexAuth },
  };
}

export async function checkIntegrationStatus(settings: AppSettings): Promise<IntegrationStatus> {
  const [system, ghAuth, openrouter, desktopApps] = await Promise.all([
    checkSystemHealthWithAuth(),
    checkGhAuth(),
    checkOpenRouterHealth(settings),
    checkDesktopApps(),
  ]);

  return {
    system,
    ghAuth,
    openrouter,
    discord: checkDiscordHealth(settings),
    telegram: checkTelegramHealth(settings),
    desktopApps,
  };
}
