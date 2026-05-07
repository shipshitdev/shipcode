---
version: alpha
name: ShipCode
description: >
  Design system for ShipCode — an Electron desktop app orchestrating
  AI-driven dev pipelines on GitHub issues. Dark-first, information-dense
  UI with semantic status colors for pipeline states.

colors:
  # Primary — alias for accent, required by spec
  primary: "#fafafa"

  # Backgrounds — layered depth from deepest to elevated
  bg-primary: "#050607"
  bg-secondary: "#0c0d10"
  bg-tertiary: "#131518"
  bg-elevated: "#1a1c21"
  bg-hover: "#20232a"

  # Borders — opaque approximations of rgba(255,255,255,0.1/0.18) on #050607
  border: "#1e1f20"
  border-strong: "#2f3033"

  # Text — three-tier hierarchy
  text-primary: "#f4f4f5"
  text-secondary: "#b4b4bc"
  text-muted: "#6b6b78"

  # Accent — inverted for dark mode (white CTA on dark bg)
  accent: "#fafafa"
  accent-foreground: "#050607"
  accent-hover: "#e4e4e7"

  # Semantic status
  success: "#10b981"
  warning: "#f59e0b"
  danger: "#ef4444"
  info: "#3b82f6"

  # Domain-specific
  agent: "#38bdf8"
  done: "#a855f7"

  # Activity heatmap (GitHub-style contribution graph)
  heatmap-empty: "#151b23"
  heatmap-1: "#0e4429"
  heatmap-2: "#006d32"
  heatmap-3: "#26a641"
  heatmap-4: "#39d353"

typography:
  app-sans:
    fontFamily: '"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  app-mono:
    fontFamily: '"SF Mono", SFMono-Regular, Consolas, Menlo, monospace'
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  web-sans:
    fontFamily: '"Inter", system-ui, sans-serif'
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  web-mono:
    fontFamily: '"JetBrains Mono", "SF Mono", "Fira Code", monospace'
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  heading-xl:
    fontFamily: '"Inter", system-ui, sans-serif'
    fontSize: 2.25rem
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: -0.03em

rounded:
  sm: 4px
  md: 6px
  lg: 10px
  xl: 16px
  2xl: 20px

spacing:
  titlebar: 38px
  titlebar-plus: 42px

components:
  button-default:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    typography: "{typography.app-sans}"
    rounded: "{rounded.md}"
    height: 32px
  button-secondary:
    backgroundColor: "{colors.bg-tertiary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    height: 32px
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    height: 32px
  button-destructive:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    height: 32px
  input:
    backgroundColor: "{colors.bg-tertiary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    height: 32px
  card:
    backgroundColor: "{colors.bg-secondary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
  dialog:
    backgroundColor: "{colors.bg-primary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
  badge-default:
    backgroundColor: "{colors.bg-hover}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
  badge-success:
    backgroundColor: "{colors.bg-secondary}"
    textColor: "{colors.success}"
    rounded: "{rounded.sm}"
  badge-warning:
    backgroundColor: "{colors.bg-secondary}"
    textColor: "{colors.warning}"
    rounded: "{rounded.sm}"
  badge-danger:
    backgroundColor: "{colors.bg-secondary}"
    textColor: "{colors.danger}"
    rounded: "{rounded.sm}"
  tooltip:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
  select:
    backgroundColor: "{colors.bg-tertiary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
  phase-chip:
    backgroundColor: "{colors.bg-secondary}"
    textColor: "{colors.agent}"
    rounded: "{rounded.sm}"
  phase-chip-success:
    backgroundColor: "{colors.bg-secondary}"
    textColor: "{colors.success}"
    rounded: "{rounded.sm}"
  phase-chip-danger:
    backgroundColor: "{colors.bg-secondary}"
    textColor: "{colors.danger}"
    rounded: "{rounded.sm}"
  badge-info:
    backgroundColor: "{colors.bg-secondary}"
    textColor: "{colors.info}"
    rounded: "{rounded.sm}"
  badge-done:
    backgroundColor: "{colors.bg-secondary}"
    textColor: "{colors.done}"
    rounded: "{rounded.sm}"
  heatmap-cell:
    backgroundColor: "{colors.heatmap-empty}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.sm}"
  heatmap-cell-l1:
    backgroundColor: "{colors.heatmap-1}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
  heatmap-cell-l2:
    backgroundColor: "{colors.heatmap-2}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
  heatmap-cell-l3:
    backgroundColor: "{colors.heatmap-3}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
  heatmap-cell-l4:
    backgroundColor: "{colors.heatmap-4}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
  popover:
    backgroundColor: "{colors.bg-elevated}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
  dropdown-menu:
    backgroundColor: "{colors.bg-secondary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
  dropdown-item-hover:
    backgroundColor: "{colors.bg-hover}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
  button-default-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.md}"
    height: 32px
  table-header:
    backgroundColor: "{colors.bg-primary}"
    textColor: "{colors.text-muted}"
  table-row-hover:
    backgroundColor: "{colors.bg-hover}"
    textColor: "{colors.text-primary}"
  sidebar:
    backgroundColor: "{colors.bg-secondary}"
    textColor: "{colors.text-secondary}"
  overlay-panel:
    backgroundColor: "{colors.bg-primary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
  input-focused:
    backgroundColor: "{colors.bg-tertiary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    height: 32px
  stat-card:
    backgroundColor: "{colors.bg-secondary}"
    textColor: "{colors.primary}"
    rounded: "{rounded.lg}"
---

## Overview

ShipCode is a dark-first Electron desktop app that orchestrates AI-driven development
pipelines on GitHub issues. The design system prioritizes information density, clear
status hierarchy, and visual distinction between human actions and AI agent activity.

The visual identity is minimal and high-contrast: near-black backgrounds with white
accent CTAs, layered depth through subtle background shifts, and semantic colors that
map directly to pipeline states.

## Colors

### Background layers

Five background tones create depth without borders. From deepest to most elevated:
`bg-primary` (main canvas) → `bg-secondary` (sidebars, panels) → `bg-tertiary` (inputs,
table footers) → `bg-elevated` (popovers, dropdowns) → `bg-hover` (interactive hover).

### Accent

Dark mode inverts the typical accent pattern: `accent` is near-white (#fafafa) for
maximum contrast CTAs on dark backgrounds. `accent-foreground` matches `bg-primary`
for text on accent surfaces.

### Semantic status

Four standard status colors map to pipeline and issue states:
- **Success** (#10b981) — completed, passing, merged
- **Warning** (#f59e0b) — awaiting approval, needs attention
- **Danger** (#ef4444) — failed, errored, blocked
- **Info** (#3b82f6) — informational, neutral status

### Domain colors

- **Agent** (#38bdf8, sky-400) — AI agent activity states (planning, reviewing,
  executing, verifying). Distinct from warning/amber used for human-attention columns.
- **Done** (#a855f7, purple) — matches GitHub Projects "Done" column dot convention.

### Light theme

Light mode uses warm parchment tones (#f6f4ef family) with dark accent (#111827).
All semantic colors shift slightly for legibility on light backgrounds.

## Typography

### Desktop app

Primary face is **DM Sans** at 13px base — dense enough for data tables, readable
enough for extended use. Users can switch to system sans-serif or serif via settings.
Monospace uses **SF Mono** for code blocks, diffs, and terminal output.

Font size is user-configurable: 12px, 13px (default), 14px, 15px.

### Web / marketing

**Inter** at 16px base for marketing readability. **JetBrains Mono** for code samples.
Headings use Inter at 2.25rem/800 weight with tight letter-spacing (-0.03em).

### Scale (desktop)

| Element         | Size   |
|-----------------|--------|
| Badge           | 10px   |
| Phase chip      | 10px   |
| Table head      | 11px   |
| Tooltip         | 11px   |
| Table cell      | 12px   |
| Tab trigger     | 12px   |
| Body / button   | 13px   |
| Card title      | 14px   |

## Layout

### Border radius

Five-step scale from subtle to prominent:
- `sm` (4px) — badges, checkboxes, inline chips
- `md` (6px) — buttons, alerts, tooltips
- `lg` (10px) — inputs, selects, textareas, cards
- `xl` (16px) — dialogs, select content panels, command palette
- `2xl` (20px) — reserved for large containers

### Spacing

Follows Tailwind 4px base scale. Only custom spacing tokens are titlebar offsets
(38px for macOS traffic lights, 42px with buffer).

## Components

### Button

Four variants: default (white accent), secondary (tertiary bg), ghost (transparent),
destructive (danger red). Sizes range from xs (24px) to xl (40px) with icon-only
variants. All use `rounded-md` (6px).

### Card

`bg-secondary` with `border-border`. Used for stat cards, pipeline cards, and content
panels. Stat cards support semantic tones (agent, success, warn, danger) via
`bg-{color}/5` tinting.

### Badge

Compact status indicators at 10px text. Seven variants matching semantic colors plus
default and done. Applied at `bg-{color}/15` with `text-{color}` foreground.

### Phase chip

Pipeline phase indicator — 10px uppercase with semantic color coding. Maps to pipeline
states: planning (agent), reviewing (info), executing (agent), verifying (warning),
completed (success), failed (danger).

## Do's and Don'ts

- **Do** use semantic status colors consistently — `success` for completed/passing,
  `danger` for failed/errored, `agent` for AI activity, `warning` for human attention.
- **Do** use background layering (primary → secondary → tertiary → elevated) instead
  of heavy borders for visual hierarchy.
- **Do** use `color-mix()` with agent color for glow/shimmer effects on active pipeline
  cards.
- **Don't** use `accent` for status indication — it's reserved for primary CTAs only.
- **Don't** mix light-theme and dark-theme tokens — they're mutually exclusive sets
  switched via `data-theme` attribute.
- **Don't** add new semantic colors without updating all three CSS files (desktop, web,
  docs) and this DESIGN.md.
