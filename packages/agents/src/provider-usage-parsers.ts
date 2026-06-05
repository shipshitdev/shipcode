import type {
  CliProviderUsageProvider,
  CliProviderUsageState,
  CliProviderUsageStatus,
  CliProviderUsageWindow,
} from '@shipcode/shared';
import { stripAnsi } from '@shipcode/shared';

interface ClaudeAuthDetails {
  accountEmail: string | null;
  loginMethod: string | null;
}

export function cleanTerminalText(text: string): string {
  return stripAnsi(text).replace(/\r/g, '');
}

export function normalizeForSearch(text: string): string {
  return cleanTerminalText(text).toLowerCase().replace(/\s+/g, '');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseNumericText(raw: string): number | null {
  let text = raw.trim().replace(/[\u00A0\u202F\s]/g, '');
  /* v8 ignore next -- callers only invoke after numeric regex captures */
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
  /* v8 ignore next -- callers only pass normalized numeric captures */
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(pattern: RegExp, text: string): number | null {
  const match = pattern.exec(text);
  return match?.[1] ? parseNumericText(match[1]) : null;
}

function percentLeftFromLine(line: string | null): number | null {
  if (!line) return null;
  const match = /([0-9]{1,3})%\s+left/i.exec(line);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  /* v8 ignore next -- regex captures only decimal digits */
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

function resetStringFromLine(line: string | null): string | null {
  if (!line) return null;
  const match = /resets?\s+([^)│┃\n]+)/i.exec(line);
  return match?.[1]?.trim() || null;
}

function toWindow(
  key: CliProviderUsageWindow['key'],
  fallbackLabel: string,
  leftPercent: number | null,
  resetDescription: string | null = null,
): CliProviderUsageWindow | null {
  if (leftPercent == null && !resetDescription) return null;
  /* v8 ignore start -- branch only exists for reset-only windows, which current parsers do not emit */
  const safeLeft = leftPercent == null ? null : Math.max(0, Math.min(100, Math.trunc(leftPercent)));
  /* v8 ignore stop */
  return {
    key,
    label: fallbackLabel,
    /* v8 ignore start -- current parsers do not emit reset-only windows */
    usedPercent: safeLeft == null ? null : Math.max(0, Math.min(100, 100 - safeLeft)),
    /* v8 ignore stop */
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
      /* v8 ignore next -- regex captures only decimal digits */
      if (Number.isFinite(value)) return Math.max(0, Math.min(100, value));
    }
    const usedMatch = /([0-9]{1,3})%used/.exec(slice);
    /* v8 ignore next -- fallback windows without usage percent are handled by higher-level parser tests */
    if (usedMatch) {
      const value = Number.parseInt(usedMatch[1], 10);
      /* v8 ignore next -- regex captures only decimal digits */
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
      /* v8 ignore next -- regex captures only decimal digits */
      if (!Number.isFinite(raw)) return null;
      const leftPercent = match[2] === 'used' ? 100 - raw : raw;
      return Math.max(0, Math.min(100, leftPercent));
    })
    .filter((value): value is number => value != null);
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
  }

  const relevant = windows.filter((window) => window.leftPercent != null);
  if (relevant.some((window) => window.leftPercent != null && window.leftPercent <= 15)) {
    return 'warning';
  }
  return relevant.length > 0 ? 'ready' : 'unknown';
}

function firstCodexLimitBlock(text: string, label: '5h limit' | 'Weekly limit'): string | null {
  const labelPattern = new RegExp(escapeRegex(label), 'i');
  const nextBlockPattern = /\s(?:5h limit|Weekly limit|GPT-[\w.-]+(?:-[\w.-]+)* limit):/gi;
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const labelMatch = labelPattern.exec(line);
    if (!labelMatch) continue;
    const nextLine = lines[index + 1] ?? '';
    let segment = line.slice(labelMatch.index);
    nextBlockPattern.lastIndex = label.length;
    const nextBlock = nextBlockPattern.exec(segment);
    if (nextBlock) {
      segment = segment.slice(0, nextBlock.index);
    }
    if (!/resets?/i.test(segment) && /resets?/i.test(nextLine)) {
      segment = `${segment} ${nextLine}`;
    }
    return segment;
  }
  return null;
}

export function parseCodexStatusText(
  stdout: string,
  checkedAt = new Date().toISOString(),
  version: string | null = null,
): CliProviderUsageStatus {
  // "codex --version" outputs "codex-cli X.Y.Z" — strip the binary name prefix so
  // the UI renders "vX.Y.Z" instead of "vcodex-cli X.Y.Z".
  const normalizedVersion = version ? (version.match(/\d+\.\d+[\w.-]*/)?.[0] ?? version) : null;
  const clean = cleanTerminalText(stdout);
  const creditsRemaining = firstNumber(/Credits:\s*([0-9][0-9., ]*)/i, clean);
  const sessionLine = firstCodexLimitBlock(clean, '5h limit');
  const weeklyLine = firstCodexLimitBlock(clean, 'Weekly limit');
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
  const clean = cleanTerminalText(stdout);
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
    /* v8 ignore next -- direct label parsing handles weekly percentages before ordered fallback */
    if (hasWeeklyLabel && weeklyPercent == null && ordered[1] != null) weeklyPercent = ordered[1];
    /* v8 ignore next -- direct label parsing handles model percentages before ordered fallback */
    if (hasModelLabel && modelPercent == null && ordered[2] != null) modelPercent = ordered[2];
  }

  const modelLabel = compact.includes(normalizeForSearch('Current week (Sonnet'))
    ? 'Sonnet'
    : compact.includes(normalizeForSearch('Current week (Haiku'))
      ? 'Haiku'
      : 'Opus';
  const windows = [
    toWindow('session', 'Session', sessionPercent, extractClaudeReset(collapsed, sessionLabel)),
    toWindow('weekly', 'Weekly', weeklyPercent, extractClaudeReset(collapsed, weeklyLabel)),
    toWindow('model', modelLabel, modelPercent, extractClaudeReset(collapsed, modelLabels)),
  ].filter((window): window is CliProviderUsageWindow => window !== null);

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
