# Tailwind v4 + shadcn/ui Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all SCSS/BEM styling with Tailwind v4 utility classes and shadcn/ui primitives, consolidating shared components in `packages/ui`.

**Architecture:** Install Tailwind v4 via `@tailwindcss/postcss` + PostCSS in `apps/desktop` (same approach as the working `apps/web` setup — NOT `@tailwindcss/vite` which conflicts with `vite-plugin-electron` multi-build). shadcn/ui primitives copied manually into `packages/ui/src/primitives/` (NOT via `npx shadcn add` which doesn't work in monorepo shared packages). Migrate components bottom-up (primitives → domain viewers → layout). Dual-mode CSS (SCSS + Tailwind) during migration, delete all SCSS at the end.

**Tech Stack:** Tailwind CSS v4, @tailwindcss/postcss, shadcn/ui (new-york style, source-copied), class-variance-authority, tailwind-merge, clsx, lucide-react, Radix UI primitives

**CRITICAL RULES for agentic workers:**
- Do NOT create `tailwind.config.js` — Tailwind v4 is CSS-first, all config goes in `app.css` via `@theme`
- Do NOT use `@tailwindcss/vite` — use `@tailwindcss/postcss` via `postcss.config.mjs` to avoid electron multi-build interference
- Do NOT run `npx shadcn add` — copy component source files manually from shadcn/ui GitHub
- Import order during dual-mode: `app.css` BEFORE `main.scss` (SCSS reset wins, which is correct for gradual migration)

---

## File Structure

```
packages/ui/
  src/
    lib/
      utils.ts                    # cn() utility
    primitives/
      button.tsx                  # shadcn Button
      input.tsx                   # shadcn Input
      textarea.tsx                # shadcn Textarea
      switch.tsx                  # shadcn Switch
      select.tsx                  # shadcn Select
      badge.tsx                   # shadcn Badge
      card.tsx                    # shadcn Card
      table.tsx                   # shadcn Table
      alert.tsx                   # shadcn Alert
      command.tsx                 # shadcn Command (wraps cmdk)
      dialog.tsx                  # shadcn Dialog
      label.tsx                   # shadcn Label
    KanbanBoard.tsx               # MODIFY: BEM → Tailwind + Card + Badge
    PipelineStatus.tsx            # MODIFY: BEM → Tailwind
    PlanViewer.tsx                # MODIFY: BEM → Tailwind + Card + Badge
    ReviewViewer.tsx              # MODIFY: BEM → Tailwind + Card + Badge
    DiffViewer.tsx                # MODIFY: BEM → Tailwind
    VerificationViewer.tsx        # MODIFY: BEM → Tailwind + Card
    IssueCard.tsx                 # MODIFY: BEM → Tailwind + Badge
    ThreadList.tsx                # MODIFY: BEM → Tailwind + Badge
    StatusMappingEditor.tsx       # MODIFY: BEM → Table + Input + Button
    index.ts                      # MODIFY: add cn + primitive exports
  package.json                    # MODIFY: add deps
  components.json                 # CREATE: shadcn config

apps/desktop/
  src/renderer/
    styles/
      app.css                     # CREATE: Tailwind entry (@import "tailwindcss" + @theme)
      main.scss                   # DELETE (after all components migrated)
      _*.scss (22 files)          # DELETE (after all components migrated)
    main.tsx                      # MODIFY: import app.css instead of main.scss
    components/
      *.tsx (8 files)             # MODIFY: BEM → Tailwind + shadcn primitives
      onboarding/*.tsx (5 files)  # MODIFY: BEM → Tailwind + shadcn primitives
  postcss.config.mjs              # CREATE: @tailwindcss/postcss plugin
  package.json                    # MODIFY: add @tailwindcss/postcss, remove sass
```

---

### Task 1: Install Tailwind v4 + dependencies

**Files:**
- Modify: `packages/ui/package.json`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/vite.config.ts`

- [ ] **Step 1: Add dependencies to packages/ui**

```bash
cd /Users/decod3rs/www/shipshitdev/apps/shipcode
bun add -w --cwd packages/ui tailwind-merge@^3.3.0 clsx@^2.1.1 class-variance-authority@^0.7.1 lucide-react@^0.575.0 cmdk@^1.1.1 @radix-ui/react-slot@^1.2.3 @radix-ui/react-dialog@^1.1.14 @radix-ui/react-select@^2.2.5 @radix-ui/react-switch@^1.2.5 @radix-ui/react-label@^2.1.7 @radix-ui/react-alert-dialog@^1.1.14
```

Note: `cmdk` moves here from `apps/desktop` since shadcn Command wraps it.
Note: Do NOT add `tailwindcss` to `packages/ui` — it's a source-only package. Tailwind compilation happens in `apps/desktop` via PostCSS.

- [ ] **Step 2: Add PostCSS + Tailwind to apps/desktop, remove sass**

```bash
bun add -D -w --cwd apps/desktop tailwindcss@^4.2.1 @tailwindcss/postcss@^4.2.1
bun remove -w --cwd apps/desktop sass cmdk
```

Do NOT install `@tailwindcss/vite` — it conflicts with `vite-plugin-electron` multi-build.

- [ ] **Step 3: Create postcss.config.mjs in apps/desktop**

Create `apps/desktop/postcss.config.mjs` (matches the working `apps/web` setup):
```js
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
```

Do NOT modify `vite.config.ts` — Vite picks up PostCSS config automatically.
Do NOT create `tailwind.config.js` — Tailwind v4 uses `@theme` in CSS.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/package.json apps/desktop/package.json apps/desktop/postcss.config.mjs bun.lock
git commit -m "chore: install tailwind v4 via postcss, shadcn radix deps, remove sass"
```

---

### Task 2: Create cn() utility and Tailwind CSS entry point

**Files:**
- Create: `packages/ui/src/lib/utils.ts`
- Create: `apps/desktop/src/renderer/styles/app.css`
- Modify: `apps/desktop/src/renderer/main.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/package.json` (exports)

- [ ] **Step 1: Create cn() utility**

Create `packages/ui/src/lib/utils.ts`:
```ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 2: Export cn from packages/ui**

Add to `packages/ui/src/index.ts`:
```ts
export { cn } from './lib/utils'
```

Update `packages/ui/package.json` exports:
```json
"exports": {
  ".": "./src/index.ts",
  "./*": "./src/*.tsx",
  "./lib/utils": "./src/lib/utils.ts",
  "./primitives/*": "./src/primitives/*.tsx"
}
```

- [ ] **Step 3: Create Tailwind CSS entry point**

Create `apps/desktop/src/renderer/styles/app.css`:
```css
@import "tailwindcss";
@source "../../../../../packages/ui/src/**/*.tsx";

@theme {
  --color-bg-primary: #0d1117;
  --color-bg-secondary: #161b22;
  --color-bg-tertiary: #21262d;
  --color-bg-hover: #30363d;
  --color-border: #30363d;
  --color-text-primary: #e6edf3;
  --color-text-secondary: #8b949e;
  --color-text-muted: #484f58;
  --color-accent: #58a6ff;
  --color-accent-hover: #79c0ff;
  --color-success: #3fb950;
  --color-warning: #d29922;
  --color-danger: #f85149;

  --font-sans: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
  --font-mono: 'SF Mono', 'Fira Code', monospace;

  --radius-md: 6px;
  --spacing-titlebar: 38px;
  --spacing-titlebar-plus: 42px;
}

/* Legacy variable aliases — some JSX uses var(--success) etc. in inline styles.
   These bridge the gap until all inline var() references are cleaned up in Task 22. */
@layer base {
  :root {
    --bg-primary: #0d1117;
    --bg-secondary: #161b22;
    --bg-tertiary: #21262d;
    --bg-hover: #30363d;
    --border: #30363d;
    --text-primary: #e6edf3;
    --text-secondary: #8b949e;
    --text-muted: #484f58;
    --accent: #58a6ff;
    --accent-hover: #79c0ff;
    --success: #3fb950;
    --warning: #d29922;
    --danger: #f85149;
    --font-sans: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
    --font-mono: 'SF Mono', 'Fira Code', monospace;
    --radius: 6px;
    --titlebar-height: 38px;
  }
}

/* Electron-specific utilities */
@utility app-region-drag {
  -webkit-app-region: drag;
}
@utility app-region-no-drag {
  -webkit-app-region: no-drag;
}

@layer base {
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html, body, #root {
    height: 100%;
    font-family: var(--font-sans);
    background: var(--color-bg-primary);
    color: var(--color-text-primary);
    font-size: 13px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--color-bg-hover); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--color-text-muted); }
}
```

- [ ] **Step 4: Add app.css import to main.tsx (dual-mode)**

In `apps/desktop/src/renderer/main.tsx`, add BEFORE the SCSS import:
```ts
import './styles/app.css'
import './styles/main.scss'  // keep temporarily during migration
```

- [ ] **Step 5: Verify Tailwind works + validate paths**

Run `bun run dev` in `apps/desktop`. Open DevTools, temporarily add `className="bg-accent text-bg-primary p-4"` to any element. Confirm it renders with blue background and dark text.

Also verify `@source` path resolves correctly: add a test class to any `packages/ui` component (e.g., `className="text-success"` in `PipelineStatus.tsx`), confirm it renders. If not, adjust the `@source` directive (try without glob: `@source "../../../../../packages/ui/src/";`).

Finally verify `@shipcode/ui/lib/utils` resolves: create a temp import in any desktop component:
```ts
import { cn } from '@shipcode/ui/lib/utils'
console.log(cn('test'))
```
If TypeScript or bundler errors, fix the exports map in `packages/ui/package.json`.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/lib/utils.ts packages/ui/src/index.ts packages/ui/package.json apps/desktop/src/renderer/styles/app.css apps/desktop/src/renderer/main.tsx
git commit -m "feat: add Tailwind v4 entry point and cn() utility"
```

---

### Task 3: Install shadcn/ui primitives

**Files:**
- Create: `packages/ui/components.json`
- Create: `packages/ui/src/primitives/` (12 component files)

- [ ] **Step 1: Create primitives directory**

```bash
mkdir -p packages/ui/src/primitives
```

Do NOT run `npx shadcn add` — it doesn't work in monorepo shared packages. Copy component source files manually.

- [ ] **Step 2: Copy shadcn primitives manually**

For each primitive (button, input, textarea, badge, card, label), create the file in `packages/ui/src/primitives/` by copying from the shadcn/ui GitHub repo (https://github.com/shadcn-ui/ui/tree/main/packages/ui/src/components). Adjust imports so `cn` is imported from `../lib/utils` (relative, NOT from `@shipcode/ui/lib/utils`).

Start with only the primitives needed for the first migration tasks: **button, badge, alert, card, input, label**. Add the rest (textarea, switch, select, table, command, dialog) incrementally in the tasks that need them.

- [ ] **Step 3: Customize Button variants to match existing design**

Edit `packages/ui/src/primitives/button.tsx` — update the CVA variants to match the existing `.btn` styles:

```ts
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-accent text-bg-primary hover:bg-accent-hover",
        secondary: "bg-bg-tertiary text-text-primary border border-border hover:bg-bg-hover",
        ghost: "bg-transparent text-text-secondary hover:text-text-primary",
        destructive: "bg-danger text-text-primary hover:bg-danger/90",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3.5 py-1.5",
        sm: "h-7 px-2.5 text-xs",
        lg: "h-10 px-6 py-2.5 text-[15px]",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)
```

- [ ] **Step 4: Export ONLY the primitives created in this task from index.ts**

Add to `packages/ui/src/index.ts` (only the 6 primitives that exist now):
```ts
// Primitives (add more as they are created in later tasks)
export { Button, buttonVariants } from './primitives/button'
export { Input } from './primitives/input'
export { Badge, badgeVariants } from './primitives/badge'
export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './primitives/card'
export { Alert, AlertDescription, AlertTitle } from './primitives/alert'
export { Label } from './primitives/label'
```

Additional primitives (Textarea, Switch, Select, Table, Command, Dialog) are added to exports in the specific tasks that create and use them.

- [ ] **Step 5: Verify primitives compile**

```bash
cd /Users/decod3rs/www/shipshitdev/apps/shipcode
npx turbo typecheck --filter=@shipcode/ui
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/
git commit -m "feat: install shadcn/ui primitives (button, input, badge, card, dialog, etc.)"
```

---

### Task 4: Migrate HealthBanner (proof of concept)

**Files:**
- Modify: `apps/desktop/src/renderer/components/HealthBanner.tsx`
- Delete after: `apps/desktop/src/renderer/styles/_health-banner.scss`

- [ ] **Step 1: Read the current SCSS**

Read `apps/desktop/src/renderer/styles/_health-banner.scss` to understand every class being used.

- [ ] **Step 2: Rewrite HealthBanner with Tailwind + shadcn Alert**

Replace all BEM classNames with Tailwind utility classes. Use shadcn `Alert` for the banner container, shadcn `Button` for the "Re-run Setup" action.

```tsx
import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '../stores/app-store'
import type { AppSettings, SystemHealth } from '@shipcode/shared'
import { Alert, AlertDescription, Button } from '@shipcode/ui'

export function HealthBanner() {
  const queryClient = useQueryClient()
  const { systemHealth, setSystemHealth } = useAppStore()

  const { data } = useQuery<SystemHealth>({
    queryKey: ['health'],
    queryFn: () => window.shipcode.invoke('health:check'),
    staleTime: 60_000,
  })

  const resetOnboarding = useMutation({
    mutationFn: () =>
      window.shipcode.invoke('settings:set', { onboardingVersion: 0 } as Partial<AppSettings>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  useEffect(() => {
    if (data) setSystemHealth(data)
  }, [data, setSystemHealth])

  if (!systemHealth) return null

  const issues: string[] = []
  if (!systemHealth.claude.available) issues.push('Claude CLI not found')
  if (!systemHealth.codex.available) issues.push('Codex CLI not found')
  if (!systemHealth.git.available) issues.push('Git not found')
  if (systemHealth.claude.available && !systemHealth.claude.authenticated) issues.push('Claude CLI not authenticated')
  if (systemHealth.codex.available && !systemHealth.codex.authenticated) issues.push('Codex CLI not authenticated')

  if (issues.length === 0) return null

  return (
    <Alert className="flex items-center gap-2 rounded-none border-x-0 border-t-0 border-b border-[#3d2e00] bg-[#1c1208] py-2 px-4 text-warning text-xs">
      <span>!</span>
      <AlertDescription className="flex-1">
        {issues.join(' · ')}.
      </AlertDescription>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto shrink-0 border border-warning text-warning text-[11px] hover:bg-warning/15"
        onClick={() => resetOnboarding.mutate()}
        disabled={resetOnboarding.isPending}
      >
        Re-run Setup
      </Button>
    </Alert>
  )
}
```

- [ ] **Step 3: Remove SCSS partial import**

In `apps/desktop/src/renderer/styles/main.scss`, remove the line:
```scss
@use 'health-banner';
```

Delete `apps/desktop/src/renderer/styles/_health-banner.scss`.

- [ ] **Step 4: Check Electron CSP**

Check `apps/desktop/src/main/index.ts` for any Content Security Policy configuration (`session.defaultSession.webRequest`, CSP meta tags in HTML). If CSP restricts `style-src`, ensure `'unsafe-inline'` is allowed or Tailwind styles will be silently blocked. PostCSS generates static CSS at build time, so this is mainly a dev-mode concern.

- [ ] **Step 5: Visual verification**

Run `bun run dev`, confirm the health banner looks identical. Check that the "Re-run Setup" button still works.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/HealthBanner.tsx
git rm apps/desktop/src/renderer/styles/_health-banner.scss
git add apps/desktop/src/renderer/styles/main.scss
git commit -m "refactor: migrate HealthBanner from SCSS/BEM to Tailwind + shadcn Alert"
```

---

### Task 5: Migrate PipelineStatus

**Files:**
- Modify: `packages/ui/src/PipelineStatus.tsx`
- Delete after: `apps/desktop/src/renderer/styles/_pipeline-status.scss`

- [ ] **Step 1: Read _pipeline-status.scss and PipelineStatus.tsx**
- [ ] **Step 2: Replace all BEM classNames with Tailwind utilities** — use `cn()` for conditional classes (active/completed/failed states)
- [ ] **Step 3: Remove `@use 'pipeline-status'` from main.scss, delete the SCSS file**
- [ ] **Step 4: Visual verification**
- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: migrate PipelineStatus to Tailwind"
```

---

### Task 6: Migrate StatusMappingEditor

**Files:**
- Modify: `packages/ui/src/StatusMappingEditor.tsx`
- Delete after: `apps/desktop/src/renderer/styles/_status-mapping-editor.scss`

- [ ] **Step 1: Read _status-mapping-editor.scss and StatusMappingEditor.tsx**
- [ ] **Step 2: Replace with shadcn Table, Input, Button + Tailwind**
- [ ] **Step 3: Remove SCSS partial, delete file**
- [ ] **Step 4: Visual verification**
- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: migrate StatusMappingEditor to Tailwind + shadcn Table"
```

---

### Task 7: Migrate PlanViewer + PlanHistory

**Files:**
- Modify: `packages/ui/src/PlanViewer.tsx`
- Modify or create: plan history component
- Delete after: `_plan-viewer.scss`, `_plan-history.scss`

- [ ] **Step 1: Read both SCSS files and component code**
- [ ] **Step 2: Replace BEM with Tailwind + Card + Badge for containers and tags**
- [ ] **Step 3: Remove SCSS partials, delete files**
- [ ] **Step 4: Visual verification**
- [ ] **Step 5: Commit**

```bash
git commit -m "refactor: migrate PlanViewer + PlanHistory to Tailwind + shadcn Card/Badge"
```

---

### Task 8: Migrate ReviewViewer

**Files:**
- Modify: `packages/ui/src/ReviewViewer.tsx`
- Delete after: `_review-viewer.scss`

- [ ] **Step 1-5:** Same pattern as Task 7 — read SCSS, replace BEM with Tailwind + Badge for severity/decision indicators

```bash
git commit -m "refactor: migrate ReviewViewer to Tailwind + shadcn Badge"
```

---

### Task 9: Migrate DiffViewer

**Files:**
- Modify: `packages/ui/src/DiffViewer.tsx`
- Delete after: `_diff-viewer.scss`

- [ ] **Step 1-5:** Pure Tailwind, no shadcn needed. Diff line highlighting via `bg-success/15`, `bg-danger/15`.

```bash
git commit -m "refactor: migrate DiffViewer to Tailwind"
```

---

### Task 10: Migrate VerificationViewer

**Files:**
- Modify: `packages/ui/src/VerificationViewer.tsx`

- [ ] **Step 1-5:** Tailwind + Card for container.

```bash
git commit -m "refactor: migrate VerificationViewer to Tailwind + shadcn Card"
```

---

### Task 11: Migrate ThreadList + IssueCard

**Files:**
- Modify: `packages/ui/src/ThreadList.tsx`
- Modify: `packages/ui/src/IssueCard.tsx`
- Delete after: part of `_thread-panel.scss` that styles thread list items

- [ ] **Step 1-5:** Tailwind + Badge for status labels.

```bash
git commit -m "refactor: migrate ThreadList + IssueCard to Tailwind + shadcn Badge"
```

---

### Task 12: Migrate KanbanBoard

**Files:**
- Modify: `packages/ui/src/KanbanBoard.tsx`
- Delete after: `_kanban-board.scss`

- [ ] **Step 1-5:** Tailwind + Card for kanban cards + Badge for labels. Keep dnd-kit integration intact.

```bash
git commit -m "refactor: migrate KanbanBoard to Tailwind + shadcn Card/Badge"
```

---

### Task 13: Migrate Sidebar + App Layout

**Files:**
- Modify: `apps/desktop/src/renderer/components/ProjectSidebar.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Delete after: `_sidebar.scss`, `_app-layout.scss`, `_settings-toggle.scss`

- [ ] **Step 1-5:** Tailwind utilities. Use `app-region-drag` / `app-region-no-drag` custom utilities for Electron titlebar. Settings toggle button becomes inline Tailwind (it's tiny).

```bash
git commit -m "refactor: migrate Sidebar + App layout to Tailwind"
```

---

### Task 14: Migrate ThreadPanel

**Files:**
- Modify: `apps/desktop/src/renderer/components/ThreadPanel.tsx`
- Delete after: `_thread-panel.scss`

- [ ] **Step 1-5:** Tailwind + Textarea + Button from shadcn.

```bash
git commit -m "refactor: migrate ThreadPanel to Tailwind + shadcn Textarea/Button"
```

---

### Task 15: Migrate ActiveThread

**Files:**
- Modify: `apps/desktop/src/renderer/components/ActiveThread.tsx`
- Delete after: `_active-thread.scss`

- [ ] **Step 1-5:** Largest component (241 lines, 171 lines SCSS). Pure Tailwind for layout + Button.

```bash
git commit -m "refactor: migrate ActiveThread to Tailwind"
```

---

### Task 16: Migrate SettingsPanel

**Files:**
- Modify: `apps/desktop/src/renderer/components/SettingsPanel.tsx`
- Delete after: `_settings-panel.scss`

- [ ] **Step 1-5:** shadcn Switch, Input, Label, Button.

```bash
git commit -m "refactor: migrate SettingsPanel to Tailwind + shadcn Switch/Input/Label"
```

---

### Task 17: Migrate IssueDetail

**Files:**
- Modify: `apps/desktop/src/renderer/components/IssueDetail.tsx`
- Delete after: `_issue-detail.scss`

- [ ] **Step 1-5:** Tailwind + Badge + Card + Button.

```bash
git commit -m "refactor: migrate IssueDetail to Tailwind + shadcn Badge/Card"
```

---

### Task 18: Migrate TerminalDrawer

**Files:**
- Modify: `apps/desktop/src/renderer/components/TerminalDrawer.tsx`
- Delete after: `_terminal-drawer.scss`

- [ ] **Step 1-5:** Pure Tailwind (xterm.js container, minimal styling).

```bash
git commit -m "refactor: migrate TerminalDrawer to Tailwind"
```

---

### Task 19: Migrate CreateIssueModal

**Files:**
- Modify: `apps/desktop/src/renderer/components/CreateIssueModal.tsx`
- Create: `packages/ui/src/primitives/dialog.tsx` (copy from shadcn)
- Create: `packages/ui/src/primitives/textarea.tsx` (copy from shadcn)
- Add exports for Dialog + Textarea to `packages/ui/src/index.ts`

NOTE: Migrate this BEFORE CommandPalette because `_command-palette.scss` contains styles for both CommandPalette AND CreateIssueModal. Don't delete that SCSS file until both are migrated.

- [ ] **Step 1-5:** shadcn Dialog + Input + Textarea + Label + Button. Do NOT delete `_command-palette.scss` yet.

```bash
git commit -m "refactor: migrate CreateIssueModal to shadcn Dialog"
```

---

### Task 20: Migrate CommandPalette

**Files:**
- Modify: `apps/desktop/src/renderer/components/CommandPalette.tsx`
- Create: `packages/ui/src/primitives/command.tsx` (copy from shadcn)
- Add Command exports to `packages/ui/src/index.ts`
- Delete after: `_command-palette.scss` (NOW safe — both consumers migrated)

- [ ] **Step 1-5:** Replace with shadcn Command (which wraps cmdk). Use shadcn `CommandDialog`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`. NOW delete `_command-palette.scss`.

```bash
git commit -m "refactor: migrate CommandPalette to shadcn Command"
```

---

### Task 21: Migrate OnboardingWizard (all 5 components)

**Files:**
- Modify: `apps/desktop/src/renderer/components/onboarding/OnboardingWizard.tsx`
- Modify: `apps/desktop/src/renderer/components/onboarding/StepAuthCheck.tsx`
- Modify: `apps/desktop/src/renderer/components/onboarding/StepGitHubProject.tsx`
- Modify: `apps/desktop/src/renderer/components/onboarding/StepModelPrefs.tsx`
- Modify: `apps/desktop/src/renderer/components/onboarding/StepLabelMapping.tsx`
- Delete after: `_onboarding-wizard.scss`

- [ ] **Step 1: Read _onboarding-wizard.scss (283 lines)**
- [ ] **Step 2: Migrate OnboardingWizard container** — Card for wizard frame, Tailwind for layout, `app-region-drag` on outer div
- [ ] **Step 3: Migrate StepAuthCheck** — Badge (success/warning/danger variants), Button for re-check
- [ ] **Step 4: Migrate StepGitHubProject** — Input for search, Tailwind for org tabs + repo list
- [ ] **Step 5: Migrate StepModelPrefs** — shadcn Select for model dropdowns
- [ ] **Step 6: Migrate StepLabelMapping** — already wraps StatusMappingEditor (migrated in Task 6)
- [ ] **Step 7: Remove SCSS partial, delete file**
- [ ] **Step 8: Visual verification — complete the wizard flow end-to-end**
- [ ] **Step 9: Commit**

```bash
git commit -m "refactor: migrate OnboardingWizard to Tailwind + shadcn"
```

---

### Task 22: Delete all SCSS and cleanup

**Files:**
- Delete: `apps/desktop/src/renderer/styles/main.scss`
- Delete: `apps/desktop/src/renderer/styles/_*.scss` (any remaining)
- Modify: `apps/desktop/src/renderer/main.tsx` (remove SCSS import)
- Modify: `apps/desktop/package.json` (remove sass)

- [ ] **Step 1: Remove SCSS import from main.tsx**

Remove the line:
```ts
import './styles/main.scss'
```

Only `import './styles/app.css'` should remain.

- [ ] **Step 2: Delete all SCSS files**

```bash
rm apps/desktop/src/renderer/styles/main.scss
rm apps/desktop/src/renderer/styles/_*.scss
```

- [ ] **Step 3: Verify no BEM classes remain**

```bash
grep -r 'className="[^"]*__\|className="[^"]*--' apps/desktop/src/renderer/ packages/ui/src/
```

Should return zero matches.

- [ ] **Step 3b: Clean up legacy CSS variable references in JSX**

```bash
grep -rn 'var(--bg-\|var(--text-\|var(--accent\|var(--success\|var(--warning\|var(--danger\|var(--border\|var(--radius\|var(--font-\|var(--titlebar' apps/desktop/src/renderer/ packages/ui/src/
```

Replace any remaining inline `var(--legacy-name)` references with Tailwind classes or `var(--color-*)` tokens. Once all are cleaned up, remove the legacy variable aliases from `app.css`.

- [ ] **Step 4: Verify the app still runs**

```bash
cd apps/desktop && bun run dev
```

Walk through: sidebar → thread list → active thread → kanban → settings → onboarding wizard → command palette.

- [ ] **Step 5: Commit**

```bash
git rm -r apps/desktop/src/renderer/styles/main.scss
git rm apps/desktop/src/renderer/styles/_*.scss
git add apps/desktop/src/renderer/main.tsx apps/desktop/package.json
git commit -m "chore: delete all SCSS files, migration complete"
```

---

## Verification

1. **Visual parity**: Every component should look identical to the SCSS version
2. **No SCSS references**: `grep -r '\.scss' apps/desktop/src/` returns nothing
3. **No BEM classes**: `grep -r '__\|--' apps/desktop/src/renderer/components/` in className attrs returns nothing
4. **Tailwind working**: DevTools shows Tailwind utility classes being applied
5. **shadcn primitives**: Button, Input, Badge, Card, etc. render with correct variants
6. **Electron-specific**: Window dragging works (titlebar area), scrollbars styled
7. **Full flow test**: Onboarding → Main app → Kanban → Thread → Pipeline → Settings
