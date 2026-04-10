/**
 * Canonical design tokens for ShipCode.
 *
 * Colors: shared across desktop and web.
 * Fonts: separate stacks — desktop is code-centric (monospace), web is marketing (readable).
 * Spacing: shared values.
 *
 * CSS consumers (desktop global.css, web globals.css) duplicate these values
 * because CSS cannot import JS. When changing a value, update all three locations.
 * The TS module is the source of truth for documentation and programmatic access.
 */

export const colors = {
  bgPrimary: '#0d1117',
  bgSecondary: '#161b22',
  bgTertiary: '#21262d',
  bgHover: '#30363d',
  border: '#30363d',
  textPrimary: '#e6edf3',
  textSecondary: '#8b949e',
  textMuted: '#484f58',
  accent: '#58a6ff',
  accentHover: '#79c0ff',
  success: '#3fb950',
  warning: '#d29922',
  danger: '#f85149',
} as const;

export const fonts = {
  desktopSans: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
  desktopMono: "'SF Mono', 'Fira Code', monospace",
  webSans: "'Inter', system-ui, sans-serif",
  webMono: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
} as const;

export const spacing = {
  radius: '6px',
  titlebarHeight: '38px',
} as const;
