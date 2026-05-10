# Coverage Leftovers

Last updated: 2026-05-10

Goal: 100% lines, statements, functions, and branches for every covered package surface.

Current gate: `scripts/coverage-summary.mjs` defaults to `COVERAGE_MIN=85`.

Verification snapshot:

```text
node scripts/coverage-summary.mjs

apps/desktop: lines 98.98%, statements 98.12%, functions 98.02%, branches 91.85%
apps/docs: 100%
apps/web: 100%
packages/agents: 100%
packages/db: 100%
packages/pipeline: lines 98.95%, statements 98.51%, functions 99.15%, branches 93.49%
packages/ui: 100%
overall: lines 99.36%, statements 98.86%, functions 98.76%, branches 95.01%
```

## Already Clean

- `apps/docs`
- `apps/web`
- `packages/agents`
- `packages/db`
- `packages/ui`

## Packages Pipeline

Remaining files below 100:

```text
packages/pipeline/src/pipeline/execution-phases.ts: lines 97.33, statements 96.22, functions 96.82, branches 86.09
packages/pipeline/src/pipeline/planning-phases.ts: lines 100, statements 100, functions 100, branches 89.44
packages/pipeline/src/pipeline/runtime.ts: lines 100, statements 100, functions 100, branches 96.78
```

Notes:
- Work mostly belongs in `packages/pipeline/src/pipeline/*.test.ts`.
- Prefer covering real retry/cancel/failure paths.
- Do not preserve impossible state combinations just to satisfy branch coverage; delete dry if the state cannot occur.

## Apps Desktop

Remaining files below 100:

```text
apps/desktop/src/main/index.ts: lines 98.38, statements 95.52, functions 96.87, branches 68.11
apps/desktop/src/renderer/components/issue-detail/DiffTab.tsx: lines 87.50, statements 87.50, functions 75, branches 90
apps/desktop/src/renderer/components/project-settings-modal/shared.ts: lines 100, statements 100, functions 100, branches 75
apps/desktop/src/renderer/App.tsx: lines 86.36, statements 87.03, functions 89.13, branches 77.57
apps/desktop/src/renderer/components/UpdateBanner.tsx: lines 100, statements 92.30, functions 90.90, branches 77.77
apps/desktop/src/renderer/components/pull-requests/PullRequestDetailActions.tsx: lines 100, statements 97.14, functions 100, branches 77.77
apps/desktop/src/renderer/components/settings-panel/DeveloperSettingsSection.tsx: lines 100, statements 89.47, functions 87.50, branches 77.77
apps/desktop/src/renderer/components/IssuesPanel.tsx: lines 99.16, statements 97.61, functions 97.18, branches 79.60
apps/desktop/src/main/git-workflows.ts: lines 98.43, statements 98.57, functions 100, branches 79.62
apps/desktop/src/main/ipc/register-pr-handlers.ts: lines 100, statements 96.15, functions 100, branches 80
apps/desktop/src/main/ipc/register-quick-task-handlers.ts: lines 92, statements 92.85, functions 80, branches 87.50
apps/desktop/src/renderer/components/TerminalView.tsx: lines 97.50, statements 97.82, functions 94.11, branches 80
apps/desktop/src/renderer/components/project-settings-modal/ProjectSettingsContextTab.tsx: lines 83.33, statements 85.71, functions 80, branches 100
apps/desktop/src/preload/index.ts: lines 100, statements 96.15, functions 100, branches 81.81
apps/desktop/src/renderer/components/SkillsView.tsx: lines 96.03, statements 95.48, functions 97.50, branches 81.81
apps/desktop/src/renderer/features/automations/create-automation-modal.tsx: lines 92.10, statements 89.68, functions 82.05, branches 85.36
apps/desktop/src/renderer/components/issue-detail/PipelineTab.tsx: lines 98.93, statements 96.96, functions 97.56, branches 82.25
apps/desktop/src/renderer/features/automations/automations-view.tsx: lines 97.82, statements 96.15, functions 96.55, branches 82.85
apps/desktop/src/main/ipc/register-automation-handlers.ts: lines 100, statements 100, functions 100, branches 83.33
apps/desktop/src/renderer/components/ThreadPanelArchiveDialog.tsx: lines 100, statements 100, functions 100, branches 83.33
apps/desktop/src/renderer/components/issue-detail/IssueDetailDialogs.tsx: lines 100, statements 100, functions 100, branches 83.33
apps/desktop/src/renderer/components/CleanupModal.tsx: lines 99.03, statements 98.30, functions 100, branches 84.24
apps/desktop/src/renderer/components/onboarding/OnboardingWizard.tsx: lines 87.87, statements 87.87, functions 84.61, branches 92
apps/desktop/src/renderer/features/automations/automation-detail.tsx: lines 100, statements 88.88, functions 100, branches 85.45
apps/desktop/src/renderer/components/AssistantPanel.tsx: lines 98.03, statements 94.70, functions 94.82, branches 85.71
apps/desktop/src/renderer/components/ProjectProviderWarningPopover.tsx: lines 100, statements 100, functions 100, branches 85.71
apps/desktop/src/renderer/components/issue-detail/IssueDetailTabs.tsx: lines 100, statements 100, functions 100, branches 85.71
apps/desktop/src/renderer/components/AutomationRunDetail.tsx: lines 100, statements 94.30, functions 100, branches 85.88
apps/desktop/src/renderer/components/project-settings-modal/ProjectPhaseSettingsRow.tsx: lines 100, statements 100, functions 100, branches 86.02
apps/desktop/src/renderer/components/InboxView.tsx: lines 93.80, statements 92.91, functions 89.13, branches 86.27
apps/desktop/src/renderer/components/terminal-drawer/useTerminalDrawer.ts: lines 100, statements 98.14, functions 100, branches 86.74
apps/desktop/src/renderer/components/pull-requests/PullRequestDetailPanel.tsx: lines 92.85, statements 93.33, functions 100, branches 86.84
apps/desktop/src/renderer/components/Titlebar.tsx: lines 96.62, statements 93.69, functions 100, branches 87.07
apps/desktop/src/renderer/components/SettingsPanel.tsx: lines 100, statements 97.82, functions 95.45, branches 87.09
apps/desktop/src/renderer/components/project-settings-modal/ProjectSettingsGeneralTab.tsx: lines 100, statements 100, functions 100, branches 87.27
apps/desktop/src/renderer/components/ProjectSettingsModal.tsx: lines 97.20, statements 94.20, functions 97.34, branches 87.35
apps/desktop/src/renderer/components/NotificationToaster.tsx: lines 100, statements 100, functions 91.66, branches 87.50
apps/desktop/src/renderer/components/issue-detail/PlanWaiting.tsx: lines 100, statements 100, functions 100, branches 87.50
apps/desktop/src/renderer/components/project-settings-modal/ProjectSettingsPipelineTab.tsx: lines 100, statements 100, functions 100, branches 87.50
apps/desktop/src/renderer/components/terminal-drawer/render-terminal-event.ts: lines 96.77, statements 96.96, functions 100, branches 87.50
apps/desktop/src/renderer/features/project/code-browser.tsx: lines 91.37, statements 90.32, functions 88.46, branches 87.50
apps/desktop/src/main/ipc/register-pipeline-handlers.ts: lines 99.78, statements 99.79, functions 100, branches 87.52
apps/desktop/src/renderer/components/terminal-panes/useTerminalPane.ts: lines 100, statements 96, functions 100, branches 88
apps/desktop/src/renderer/components/terminal-transcript/TerminalTranscript.tsx: lines 100, statements 99.24, functions 96.42, branches 88.10
apps/desktop/src/renderer/hooks/useIpc.ts: lines 99.41, statements 96.98, functions 95.65, branches 88.18
apps/desktop/src/renderer/components/costs/PhaseDurationsChart.tsx: lines 100, statements 100, functions 100, branches 88.23
apps/desktop/src/renderer/components/costs/TokensByPhaseChart.tsx: lines 100, statements 100, functions 100, branches 88.88
apps/desktop/src/renderer/components/issue-detail/PlanHistoryTab.tsx: lines 90, statements 90, functions 88.88, branches 98.50
apps/desktop/src/renderer/components/issue-detail/CommentsTab.tsx: lines 100, statements 96.29, functions 100, branches 89.47
apps/desktop/src/main/resource-monitor.ts: lines 97.36, statements 97.56, functions 90, branches 96.29
apps/desktop/src/renderer/components/onboarding/StepAuthCheck.tsx: lines 100, statements 100, functions 100, branches 90.90
apps/desktop/src/main/ipc/helpers.ts: lines 100, statements 100, functions 100, branches 91.07
apps/desktop/src/main/splash-screen.ts: lines 100, statements 100, functions 91.66, branches 100
apps/desktop/src/renderer/components/issue-detail/ApprovalSection.tsx: lines 100, statements 91.66, functions 100, branches 94.44
apps/desktop/src/main/logger.service.ts: lines 92, statements 92.59, functions 100, branches 100
apps/desktop/src/renderer/telemetry.ts: lines 100, statements 100, functions 100, branches 92.85
apps/desktop/src/main/ipc/register-support-handlers.ts: lines 100, statements 97.03, functions 95.65, branches 93.06
apps/desktop/src/renderer/components/issue-detail/helpers.ts: lines 100, statements 100, functions 100, branches 93.33
apps/desktop/src/renderer/components/settings-panel/PipelineSettingsSection.tsx: lines 100, statements 100, functions 100, branches 93.43
apps/desktop/src/renderer/components/project-settings-modal/ProjectSettingsModelsTab.tsx: lines 100, statements 100, functions 100, branches 93.75
apps/desktop/src/main/notification-service.ts: lines 100, statements 100, functions 100, branches 94
apps/desktop/src/renderer/hooks/useGlobalKeyboard.ts: lines 100, statements 100, functions 100, branches 94.11
apps/desktop/src/main/ipc/register-github-handlers.ts: lines 99.64, statements 99.68, functions 98.52, branches 94.16
apps/desktop/src/main/ipc/retry-phase.ts: lines 100, statements 100, functions 100, branches 94.44
apps/desktop/src/main/ipc/register-project-handlers.ts: lines 100, statements 100, functions 100, branches 94.67
apps/desktop/src/renderer/components/IssueDetail.tsx: lines 99.77, statements 98.15, functions 99.21, branches 95.01
apps/desktop/src/renderer/components/terminal-panes/TerminalPane.tsx: lines 100, statements 100, functions 100, branches 95.16
apps/desktop/src/renderer/components/pull-requests/PullRequestsPanel.tsx: lines 100, statements 95.23, functions 100, branches 96
apps/desktop/src/renderer/components/CreateIssueModal.tsx: lines 97.85, statements 97.74, functions 95.52, branches 96.96
apps/desktop/src/renderer/components/project-settings-modal/ProjectSettingsSetupTab.tsx: lines 100, statements 100, functions 100, branches 95.83
apps/desktop/src/main/update-service.ts: lines 100, statements 100, functions 100, branches 96.15
apps/desktop/src/renderer/components/settings-panel/GeneralSettingsSection.tsx: lines 100, statements 100, functions 100, branches 96.15
apps/desktop/src/main/telemetry.ts: lines 100, statements 100, functions 100, branches 96.29
apps/desktop/src/main/ipc/prd-attachments.ts: lines 98.76, statements 98.86, functions 100, branches 96.87
apps/desktop/src/renderer/components/ProjectSidebar.tsx: lines 98.21, statements 98.44, functions 98.79, branches 96.96
apps/desktop/src/renderer/components/CommandPalette.tsx: lines 100, statements 100, functions 100, branches 97.29
apps/desktop/src/renderer/components/settings-panel/IntegrationsSettingsSection.tsx: lines 100, statements 100, functions 100, branches 97.29
apps/desktop/src/renderer/components/TerminalDrawer.tsx: lines 100, statements 100, functions 100, branches 97.50
apps/desktop/src/main/ipc/register-instant-handlers.ts: lines 100, statements 99.38, functions 100, branches 99.32
```

Notes:
- Desktop is the main remaining surface.
- Best next order: attack the lowest-branch files first, then the low-line/function files.
- Several renderer branch gaps are likely optional empty/error states. Prefer behavior tests in the nearest existing `*.test.tsx`.
- For main-process IPC gaps, keep IPC error clamping rules: renderer-facing errors stay first-line and short; full stacks only in main-process logs.

## Recommended Next Pass

1. Bring `packages/pipeline` to 100 while staying aligned with retry/cancel invariants.
2. Split desktop into focused batches:
   - branch-only renderer tabs/settings sections,
   - low-line renderer components,
   - main-process IPC handlers,
   - app bootstrap/index paths.

Before updating this doc, refresh artifacts with:

```bash
bun --filter @shipcode/ui test --coverage --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text-summary --test-timeout=30000 --pool=threads
bun --filter @shipcode/pipeline test --coverage --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text-summary --test-timeout=30000 --pool=threads
bun --filter @shipcode/desktop test --coverage --coverage.reporter=json-summary --coverage.reporter=json --coverage.reporter=text-summary --test-timeout=30000 --pool=threads
node scripts/coverage-summary.mjs
```
