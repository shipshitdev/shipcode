import { exec } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  AppSettings,
  ChatIntegrationHealth,
  CliHealth,
  CliProviderUsageMap,
  CliProviderUsageProvider,
  CliProviderUsageState,
  CliProviderUsageStatus,
  CliProviderUsageWindow,
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
import { normalizeReasoningModelId, OPENROUTER_API_BASE } from '@shipcode/shared';
import * as pty from 'node-pty';

const execAsync = promisify(exec);
const CLI_USAGE_TIMEOUT_MS = 20_000;
const CLI_USAGE_OUTPUT_TAIL = 8_192;
const providerUsageCache = new Map<CliProviderUsageProvider, CliProviderUsageStatus>();
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

function summarizeExecFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'usage data unavailable';
  const message = error.message.trim();
  if (!message) return 'usage data unavailable';
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
  sendOnSubstrings?: Record<string, string>;
}

interface ClaudeAuthDetails {
  accountEmail: string | null;
  loginMethod: string | null;
}

function stripAnsiCodes(text: string): string {
  const csiSource = String.raw`\\u001B\\[[0-?]*[ -/]*[@-~]`.replace(/\\\\/g, '\\');
  const oscSource = String.raw`\\u001B\\][^\\u0007]*(?:\\u0007|\\u001B\\\\)`.replace(/\\\\/g, '\\');
  const csiPattern = new RegExp(csiSource, 'g');
  const oscPattern = new RegExp(oscSource, 'g');
  return text.replace(csiPattern, '').replace(oscPattern, '').replace(/\r/g, '');
}

function normalizeForSearch(text: string): string {
  return stripAnsiCodes(text).toLowerCase().replace(/\s+/g, '');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseNumericText(raw: string): number | null {
  let text = raw.trim().replace(/[\u00A0\u202F\s]/g, '');
  if (!text) return null;

  const hasComma = text.includes(',');
  const hasDot = text.includes('.');
  if (hasComma && hasDot) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      text = text.replace(/\./g, '').replace(/,/g, '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (hasComma) {
    if (/^\d{1,3}(,\d{3})+$/.test(text)) {
      text = text.replace(/,/g, '');
    } else {
      text = text.replace(/,/g, '.');
    }
  } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, '');
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(pattern: RegExp, text: string): number | null {
  const match = pattern.exec(text);
  return match?.[1] ? parseNumericText(match[1]) : null;
}

function firstLineMatching(pattern: RegExp, text: string): string | null {
  const match = pattern.exec(text);
  return match?.[0] ?? null;
}

function percentLeftFromLine(line: string | null): number | null {
  if (!line) return null;
  const match = /([0-9]{1,3})%\s+left/i.exec(line);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

function resetStringFromLine(line: string | null): string | null {
  if (!line) return null;
  const match = /resets?\s+(.+)/i.exec(line);
  return match?.[1]?.trim() || null;
}

function toWindow(
  key: CliProviderUsageWindow['key'],
  fallbackLabel: string,
  leftPercent: number | null,
  resetDescription: string | null = null,
): CliProviderUsageWindow | null {
  if (leftPercent == null && !resetDescription) return null;
  const safeLeft = leftPercent == null ? null : Math.max(0, Math.min(100, Math.trunc(leftPercent)));
  return {
    key,
    label: fallbackLabel,
    usedPercent: safeLeft == null ? null : Math.max(0, Math.min(100, 100 - safeLeft)),
    leftPercent: safeLeft,
    resetsAt: null,
    resetDescription,
  };
}

function extractClaudePercent(compactText: string, labels: string[]): number | null {
  for (const label of labels.map((entry) => entry.toLowerCase().replace(/\s+/g, ''))) {
    const index = compactText.lastIndexOf(label);
    if (index === -1) continue;
    const slice = compactText.slice(index + label.length, index + label.length + 160);
    // Try "N% left" first (legacy), then "N% used" (v2.1+)
    const leftMatch = /([0-9]{1,3})%left/.exec(slice);
    if (leftMatch) {
      const value = Number.parseInt(leftMatch[1], 10);
      if (Number.isFinite(value)) return Math.max(0, Math.min(100, value));
    }
    const usedMatch = /([0-9]{1,3})%used/.exec(slice);
    if (usedMatch) {
      const value = Number.parseInt(usedMatch[1], 10);
      if (Number.isFinite(value)) return Math.max(0, Math.min(100, 100 - value));
    }
  }
  return null;
}

function extractClaudeReset(collapsedText: string, labels: string[]): string | null {
  for (const label of labels) {
    const labelPattern = label
      .trim()
      .split(/\s+/)
      .map((part) => escapeRegex(part))
      .join('\\s*');
    const regex = new RegExp(
      `${labelPattern}[\\s\\S]{0,120}?resets?\\s+(.{1,40}?)(?=\\s+(?:Current\\s+|Failed\\s+to\\s+load|$))`,
      'i',
    );
    const match = regex.exec(collapsedText);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

function extractClaudePercentsInOrder(compactText: string): number[] {
  // Match both "N%left" (legacy, value = left%) and "N%used" (v2.1+, value = 100 - used%)
  return [...compactText.matchAll(/([0-9]{1,3})%(left|used)/g)]
    .map((match) => {
      const raw = Number.parseInt(match[1], 10);
      if (!Number.isFinite(raw)) return null;
      const leftPercent = match[2] === 'used' ? 100 - raw : raw;
      return Math.max(0, Math.min(100, leftPercent));
    })
    .filter((value): value is number => value != null);
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
    const result = await execAsync('claude auth status', { timeout: 5_000 });
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

  return new Promise((resolve, reject) => {
    let proc: pty.IPty;
    try {
      proc = pty.spawn(command, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: process.env,
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
    const normalizedStopNeedles = stopOnSubstrings.map((value) => normalizeForSearch(value));
    const normalizedSendNeedles = Object.entries(sendOnSubstrings).map(([needle, keys]) => ({
      needle: normalizeForSearch(needle),
      keys,
    }));

    const cleanup = () => {
      clearTimeout(initialTimer);
      clearTimeout(timeoutTimer);
      clearInterval(tickTimer);
    };

    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(text);
    };

    const fail = (error: unknown) => {
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

    const initialTimer = setTimeout(() => {
      if (!initialInput) return;
      try {
        proc.write(initialInput);
      } catch {
        // Ignore write races on early exit.
      }
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
        try {
          proc.write(item.keys);
        } catch {
          // Ignore write races on exit.
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

function deriveUsageState(
  provider: CliProviderUsageProvider,
  windows: CliProviderUsageWindow[],
  creditsRemaining: number | null,
): CliProviderUsageState {
  const session = windows.find((window) => window.key === 'session') ?? null;
  const weekly = windows.find((window) => window.key === 'weekly') ?? null;
  const model = windows.find((window) => window.key === 'model') ?? null;

  if (session?.leftPercent != null && session.leftPercent <= 0) return 'blocked';
  if (provider === 'codex') {
    if (weekly?.leftPercent != null && weekly.leftPercent <= 0 && (creditsRemaining ?? 0) <= 0) {
      return 'blocked';
    }
  } else if (model?.leftPercent != null) {
    if (model.leftPercent <= 0) return 'blocked';
    if (model.leftPercent <= 15) return 'warning';
    return 'ready';
  } else if (weekly?.leftPercent != null && weekly.leftPercent <= 0) {
    return 'blocked';
  }

  const relevant = windows.filter((window) => window.leftPercent != null);
  if (relevant.some((window) => (window.leftPercent ?? 101) <= 15)) return 'warning';
  return relevant.length > 0 ? 'ready' : 'unknown';
}

export function parseCodexStatusText(
  stdout: string,
  checkedAt = new Date().toISOString(),
  version: string | null = null,
): CliProviderUsageStatus {
  // "codex --version" outputs "codex-cli X.Y.Z" — strip the binary name prefix so
  // the UI renders "vX.Y.Z" instead of "vcodex-cli X.Y.Z".
  const normalizedVersion = version ? (version.match(/\d+\.\d+[\w.-]*/)?.[0] ?? version) : null;
  const clean = stripAnsiCodes(stdout);
  const creditsRemaining = firstNumber(/Credits:\s*([0-9][0-9., ]*)/i, clean);
  const sessionLine = firstLineMatching(/5h limit[^\n]*/i, clean);
  const weeklyLine = firstLineMatching(/Weekly limit[^\n]*/i, clean);
  const windows = [
    toWindow(
      'session',
      'Session',
      percentLeftFromLine(sessionLine),
      resetStringFromLine(sessionLine),
    ),
    toWindow('weekly', 'Weekly', percentLeftFromLine(weeklyLine), resetStringFromLine(weeklyLine)),
  ].filter((window): window is CliProviderUsageWindow => window !== null);

  return {
    provider: 'codex',
    available: windows.length > 0 || creditsRemaining != null,
    stale: false,
    state: deriveUsageState('codex', windows, creditsRemaining),
    source: 'cli',
    version: normalizedVersion,
    accountEmail: null,
    loginMethod: null,
    updatedAt: checkedAt,
    checkedAt,
    message:
      windows.length > 0 || creditsRemaining != null ? null : 'Codex CLI returned no quota data',
    creditsRemaining,
    windows,
  };
}

export function parseClaudeUsageText(
  stdout: string,
  checkedAt = new Date().toISOString(),
  auth: ClaudeAuthDetails = { accountEmail: null, loginMethod: null },
  version: string | null = null,
): CliProviderUsageStatus {
  // "claude --version" outputs e.g. "2.1.92 (Claude Code)" — strip the parenthetical
  // so the UI renders "v2.1.92" instead of "v2.1.92 (Claude Code)".
  const normalizedVersion = version ? (version.match(/\d+\.\d+[\w.-]*/)?.[0] ?? version) : null;
  const clean = stripAnsiCodes(stdout);
  const collapsed = clean.replace(/\s+/g, ' ').trim();
  const compact = normalizeForSearch(clean);

  // --- Legacy format: "Current session ... N% left" ---
  const sessionLabel = ['Current session'];
  const weeklyLabel = ['Current week (all models)', 'Current week'];
  const modelLabels = [
    'Current week (Opus)',
    'Current week (Sonnet only)',
    'Current week (Sonnet)',
  ];

  let sessionPercent = extractClaudePercent(compact, sessionLabel);
  let weeklyPercent = extractClaudePercent(compact, weeklyLabel);
  let modelPercent = extractClaudePercent(compact, modelLabels);

  const hasWeeklyLabel = weeklyLabel.some((label) => compact.includes(normalizeForSearch(label)));
  const hasModelLabel = modelLabels.some((label) => compact.includes(normalizeForSearch(label)));
  if (
    sessionPercent == null ||
    (hasWeeklyLabel && weeklyPercent == null) ||
    (hasModelLabel && modelPercent == null)
  ) {
    const ordered = extractClaudePercentsInOrder(compact);
    if (sessionPercent == null && ordered[0] != null) sessionPercent = ordered[0];
    if (hasWeeklyLabel && weeklyPercent == null && ordered[1] != null) weeklyPercent = ordered[1];
    if (hasModelLabel && modelPercent == null && ordered[2] != null) modelPercent = ordered[2];
  }

  const modelLabel = compact.includes(normalizeForSearch('Current week (Sonnet'))
    ? 'Sonnet'
    : compact.includes(normalizeForSearch('Current week (Haiku'))
      ? 'Haiku'
      : 'Opus';
  let windows = [
    toWindow('session', 'Session', sessionPercent, extractClaudeReset(collapsed, sessionLabel)),
    toWindow('weekly', 'Weekly', weeklyPercent, extractClaudeReset(collapsed, weeklyLabel)),
    toWindow('model', modelLabel, modelPercent, extractClaudeReset(collapsed, modelLabels)),
  ].filter((window): window is CliProviderUsageWindow => window !== null);

  // --- New status-bar format: "N% used" (Claude Code v2.1+) ---
  if (windows.length === 0) {
    const statusBarUsed = extractStatusBarUsedPercent(clean);
    if (statusBarUsed != null) {
      windows = [toWindow('session', 'Session', 100 - statusBarUsed, null)].filter(
        (window): window is CliProviderUsageWindow => window !== null,
      );
    }
  }

  const loadFailure = /failed\s*to\s*load\s*usage\s*data/i.test(clean);
  return {
    provider: 'claude',
    available: windows.length > 0,
    stale: false,
    state: deriveUsageState('claude', windows, null),
    source: 'cli',
    version: normalizedVersion,
    accountEmail: auth.accountEmail,
    loginMethod: auth.loginMethod,
    updatedAt: checkedAt,
    checkedAt,
    message:
      windows.length > 0
        ? null
        : loadFailure
          ? 'Claude CLI failed to load usage data'
          : 'Claude CLI returned no quota data',
    creditsRemaining: null,
    windows,
  };
}

/**
 * Extract the "N% used" value from the Claude Code status bar.
 * Newer Claude Code versions (v2.1+) display usage in the bottom status bar
 * as e.g. "| 10% used" instead of the old /usage table format.
 * Returns the used percent (0–100) or null if not found.
 */
function extractStatusBarUsedPercent(cleanText: string): number | null {
  const matches = [...cleanText.matchAll(/(\d{1,3})%\s*used/gi)];
  if (matches.length === 0) return null;
  // Take the last occurrence (most likely the final status bar render)
  const lastMatch = matches[matches.length - 1];
  const value = Number.parseInt(lastMatch[1], 10);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
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
    initialDelayMs: 2_000,
    idleTimeoutMs: null,
    periodicEnterMs: 800,
    settleAfterStopMs: 2_000,
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
    initialInput: '/status\n',
    initialDelayMs: 3_000,
    idleTimeoutMs: 3_000,
    periodicEnterMs: 1_000,
    sendOnSubstrings: {
      'Do you trust the contents of this directory?': '\r\n',
      'Yes, continue': '\r\n',
      'Press enter to continue': '\r\n',
    },
  });
  return parseCodexStatusText(stdout, checkedAt, version);
}

async function checkProviderUsage(
  provider: CliProviderUsageProvider,
): Promise<CliProviderUsageStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const cli = await checkCli(provider, '--version');
    if (!cli.available || !cli.path) {
      return emptyProviderUsage(provider, checkedAt, `${provider} CLI not found in PATH`);
    }

    const parsed =
      provider === 'claude'
        ? await probeClaudeUsage(cli.version, cli.path)
        : await probeCodexUsage(cli.version, cli.path);
    providerUsageCache.set(provider, parsed);
    return parsed;
  } catch (error) {
    const cached = providerUsageCache.get(provider);
    if (cached) {
      return {
        ...cached,
        stale: true,
        checkedAt,
        message: cached.message ?? `Using cached ${provider} usage data`,
      };
    }
    return emptyProviderUsage(
      provider,
      checkedAt,
      `${provider === 'claude' ? 'Claude' : 'Codex'} CLI usage unavailable: ${summarizeExecFailure(error)}`,
    );
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
    const normalizedModelId = normalizeReasoningModelId('openrouter', modelId) ?? modelId;
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
  const trimmed = normalizeReasoningModelId('openrouter', modelId.trim()) ?? modelId.trim();
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

export async function checkCliProviderUsage(): Promise<CliProviderUsageMap> {
  const [claude, codex] = await Promise.all([
    checkProviderUsage('claude'),
    checkProviderUsage('codex'),
  ]);
  return { claude, codex };
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
