/**
 * Canonical design tokens — synced with DESIGN.md (repo root).
 * CSS consumers duplicate these values; update DESIGN.md + CSS when changing.
 */

export const colors = {
  bgPrimary: '#050607',
  bgSecondary: '#0c0d10',
  bgTertiary: '#131518',
  bgElevated: '#1a1c21',
  bgHover: '#20232a',
  border: 'rgba(255, 255, 255, 0.1)',
  borderStrong: 'rgba(255, 255, 255, 0.18)',
  textPrimary: '#f4f4f5',
  textSecondary: '#b4b4bc',
  textMuted: '#6b6b78',
  accent: '#fafafa',
  accentForeground: '#050607',
  accentHover: '#e4e4e7',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#3b82f6',
  agent: '#38bdf8',
  done: '#a855f7',
} as const;

export const fonts = {
  desktopSans: '"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  desktopMono: '"SF Mono", SFMono-Regular, Consolas, Menlo, monospace',
  webSans: '"Inter", system-ui, sans-serif',
  webMono: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
} as const;

export const spacing = {
  radiusSm: '2px',
  radiusMd: '6px',
  radiusLg: '8px',
  radiusXl: '10px',
  titlebarHeight: '38px',
  titlebarHeightPlus: '42px',
} as const;
