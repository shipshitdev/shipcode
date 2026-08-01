// @vitest-environment jsdom

import type {
  PlanReview,
  ShipCodePlan,
  TaskGraphWithNodes,
  VerificationResult,
} from '@shipcode/shared';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppPickerSection } from '@/AppPickerSection';
import { ShipCodeLogoMark } from '@/brand/ShipCodeLogoMark';
import { LabeledModelSelect } from '@/LabeledModelSelect';
import { PipelineStatus } from '@/PipelineStatus';
import { PlanViewer } from '@/PlanViewer';
import { ReviewViewer } from '@/ReviewViewer';
import { SecureCredentialField } from '@/SecureCredentialField';
import { SettingsSection } from '@/SettingsSection';
import { SettingsSelectRow } from '@/SettingsSelectRow';
import { StartupProgress } from '@/StartupProgress';
import { TaskGraphViewer } from '@/TaskGraphViewer';
import { VerificationViewer } from '@/VerificationViewer';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderIntoDom(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return {
    container,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

const plan: ShipCodePlan = {
  id: 'plan-1',
  threadId: 'thread-1',
  version: 3,
  objective: 'Render board coverage details',
  files: [
    {
      path: 'packages/ui/src/PlanViewer.tsx',
      action: 'modify',
      description: 'Show plan state',
    },
    {
      path: 'packages/ui/src/new-file.ts',
      action: 'create',
      description: 'Create a helper',
    },
  ],
  steps: [
    {
      order: 1,
      description: 'Render sections',
      files: ['packages/ui/src/PlanViewer.tsx'],
      rationale: 'Users need to inspect plans',
    },
  ],
  acceptanceCriteria: ['A plan section renders'],
  outOfScope: ['Shipping'],
  estimatedComplexity: 'medium',
  dependencies: ['@shipcode/shared'],
};

const review: PlanReview = {
  planId: 'plan-1',
  summary: 'One issue needs changes before execution.',
  decision: 'request_changes',
  confidence: 'high',
  findings: [
    {
      id: 'R1',
      severity: 'major',
      category: 'correctness',
      description: 'Coverage threshold is missing.',
      suggestion: 'Add repo-wide enforcement.',
      filePath: 'scripts/coverage-summary.mjs',
    },
  ],
  suggestedChanges: ['Add the threshold gate'],
};

const verification: VerificationResult = {
  threadId: 'thread-1',
  planId: 'plan-1',
  result: 'failed',
  summary: 'One acceptance criterion is still failing.',
  criteriaResults: [
    {
      criterion: 'Coverage threshold enforced',
      passed: false,
      evidence: 'No minimum threshold configured yet.',
    },
  ],
  issues: [
    {
      severity: 'warning',
      description: 'Coverage is below the floor in one package.',
      filePath: 'packages/ui/src/PipelineStatus.tsx',
    },
  ],
};

const taskGraph: TaskGraphWithNodes = {
  id: 'graph-1',
  threadId: 'thread-1',
  planId: 'plan-1',
  mode: 'github-subissues',
  status: 'active',
  riskScore: 0.72,
  assessment: {
    mode: 'github-subissues',
    shouldDecompose: true,
    riskScore: 0.72,
    reasons: ['Cross-surface task: backend, frontend', '5 touched files'],
    suggestedNodeCount: 2,
    surfaces: ['backend', 'frontend'],
  },
  createdAt: '2026-04-30T00:00:00.000Z',
  updatedAt: '2026-04-30T00:00:00.000Z',
  nodes: [
    {
      id: 'node-1',
      graphId: 'graph-1',
      stableKey: 'T1',
      order: 1,
      title: 'Persist graph state',
      description: 'Write task graph rows',
      status: 'completed',
      files: ['packages/db/src/queries/task-graphs.ts'],
      acceptanceCriteria: ['Graph rows are persisted'],
      surfaces: ['database', 'backend'],
      agentRole: 'database',
      suggestedExecutorModel: 'claude',
      suggestedReasoningEffort: 'high',
      githubIssueNumber: 42,
      startedAt: '2026-04-30T00:01:00.000Z',
      completedAt: '2026-04-30T00:02:00.000Z',
      createdAt: '2026-04-30T00:00:00.000Z',
      updatedAt: '2026-04-30T00:02:00.000Z',
    },
    {
      id: 'node-2',
      graphId: 'graph-1',
      stableKey: 'T2',
      order: 2,
      title: 'Render graph status',
      description: 'Expose node progress in the renderer',
      status: 'ready',
      files: ['apps/desktop/src/renderer/components/IssueDetail.tsx'],
      acceptanceCriteria: ['Graph status is visible'],
      surfaces: ['frontend'],
      agentRole: 'frontend',
      suggestedExecutorModel: null,
      suggestedReasoningEffort: 'medium',
      githubIssueNumber: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-04-30T00:00:00.000Z',
      updatedAt: '2026-04-30T00:00:00.000Z',
    },
  ],
  edges: [
    {
      id: 'edge-1',
      graphId: 'graph-1',
      sourceNodeId: 'node-1',
      targetNodeId: 'node-2',
      edgeType: 'depends_on',
      createdAt: '2026-04-30T00:00:00.000Z',
    },
  ],
};

describe('root UI components', () => {
  it('keeps the shared ShipCode logo geometry aligned with app icons', () => {
    const html = renderToStaticMarkup(<ShipCodeLogoMark />);

    expect(html).toContain('viewBox="0 0 1024 1024"');
    expect(html).toContain('x="184" y="192" width="176" height="500"');
    expect(html).toContain('x="424" y="192" width="176" height="560"');
    expect(html).toContain('x="664" y="192" width="176" height="620"');
  });

  it('renders settings sections without card chrome', () => {
    const view = renderIntoDom(
      <SettingsSection title="Models" description="Shared phase defaults.">
        <button type="button">Apply</button>
      </SettingsSection>,
    );

    const section = view.container.querySelector('[data-slot="settings-section"]');
    expect(section?.textContent).toContain('Models');
    expect(section?.textContent).toContain('Shared phase defaults.');
    expect(section?.className).toContain('mb-8');
    expect(section?.className).not.toContain('rounded');
    expect(section?.className).not.toContain('border');
    view.cleanup();
  });

  it('renders settings sections with partial or absent header content', () => {
    const titleOnly = renderIntoDom(
      <SettingsSection title="General">
        <button type="button">Save</button>
      </SettingsSection>,
    );
    expect(titleOnly.container.querySelector('h4')?.textContent).toBe('General');
    expect(titleOnly.container.querySelector('p')).toBeNull();
    titleOnly.cleanup();

    const descriptionOnly = renderIntoDom(
      <SettingsSection description="Controls workspace defaults.">
        <button type="button">Reset</button>
      </SettingsSection>,
    );
    expect(descriptionOnly.container.querySelector('h4')).toBeNull();
    expect(descriptionOnly.container.querySelector('p')?.textContent).toBe(
      'Controls workspace defaults.',
    );
    descriptionOnly.cleanup();

    const bodyOnly = renderIntoDom(
      <SettingsSection>
        <button type="button">Apply</button>
      </SettingsSection>,
    );
    const bodyOnlySection = bodyOnly.container.querySelector('[data-slot="settings-section"]');
    expect(bodyOnlySection?.querySelector('div')).toBeNull();
    expect(bodyOnlySection?.textContent).toBe('Apply');
    bodyOnly.cleanup();
  });

  it('renders secure credential actions without exposing a persisted value', () => {
    const onClear = vi.fn();
    const view = renderIntoDom(
      <SecureCredentialField
        ariaLabel="Webhook URL"
        clearLabel="Clear webhook"
        configured={true}
        placeholder="Configured — enter a replacement"
        renderInput={({ ariaLabel, onChange, placeholder, value }) => (
          <input
            aria-label={ariaLabel}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            type="password"
          />
        )}
        saveLabel="Save webhook"
        onClear={onClear}
        onSave={vi.fn(async () => undefined)}
      />,
    );

    const input = view.container.querySelector('input');
    const saveButton = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save webhook',
    );
    const clearButton = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Clear webhook',
    );
    expect(input?.value).toBe('');
    expect(input?.placeholder).toBe('Configured — enter a replacement');
    expect(saveButton?.disabled).toBe(true);
    act(() => clearButton?.click());
    expect(onClear).toHaveBeenCalledTimes(1);
    view.cleanup();
  });

  it('connects labeled model selectors to their visible labels', () => {
    const labeledSelect = renderIntoDom(
      <LabeledModelSelect
        id="default-model"
        label="Default model"
        value="model-a"
        options={[{ value: 'model-a', label: 'Model A' }]}
        onValueChange={vi.fn()}
      />,
    );
    expect(labeledSelect.container.querySelector('label')?.htmlFor).toBe('default-model');
    expect(
      labeledSelect.container.querySelector('[data-slot="labeled-model-select"]'),
    ).not.toBeNull();
    labeledSelect.cleanup();
  });

  it('connects settings select rows to their labels and supports label-only rows', () => {
    const labelledRow = renderIntoDom(
      <SettingsSelectRow
        id="theme"
        label="Theme"
        description="Follow the system appearance."
        value="dark"
        options={[
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ]}
        onValueChange={vi.fn()}
        triggerClassName="w-[180px]"
      />,
    );
    expect(labelledRow.container.querySelector('label')?.htmlFor).toBe('theme');
    expect(labelledRow.container.textContent).toContain('Follow the system appearance.');
    const trigger = labelledRow.container.querySelector('[data-slot="settings-select-row"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.className).toContain('w-[180px]');
    labelledRow.cleanup();

    const anonymousRow = renderIntoDom(
      <SettingsSelectRow
        label="Mode"
        value="split"
        options={[{ value: 'split', label: 'Split' }]}
        onValueChange={vi.fn()}
      />,
    );
    expect(anonymousRow.container.querySelector('label')).toBeNull();
    expect(anonymousRow.container.textContent).toContain('Mode');
    anonymousRow.cleanup();
  });

  it('renders app availability, paths, and errors in app picker sections', () => {
    const appPicker = renderIntoDom(
      <AppPickerSection
        title="Project opener"
        description="Choose an app."
        label="Default app"
        selectId="default-app"
        value="finder"
        options={[
          {
            value: 'finder',
            label: 'Finder',
            available: true,
            path: '/Applications/Finder.app',
            error: null,
          },
          {
            value: 'editor',
            label: 'Editor',
            available: false,
            path: null,
            error: 'Editor is not installed',
          },
        ]}
        onValueChange={vi.fn()}
      />,
    );
    expect(appPicker.container.querySelector('label')?.htmlFor).toBe('default-app');
    expect(appPicker.container.textContent).toContain('Available');
    expect(appPicker.container.textContent).toContain('Unavailable');
    expect(appPicker.container.textContent).toContain('/Applications/Finder.app');
    expect(appPicker.container.textContent).toContain('Editor is not installed');
    expect(appPicker.container.querySelectorAll('[data-slot="app-picker-option"]')).toHaveLength(2);
    appPicker.cleanup();
  });

  it('renders active and completed phases and only emits clicks for enabled phases', () => {
    const onPhaseClick = vi.fn();
    const view = renderIntoDom(
      <PipelineStatus currentPhase="reviewing" onPhaseClick={onPhaseClick} />,
    );

    expect(view.container.textContent).toContain('Plan');
    expect(view.container.textContent).toContain('Review');
    expect(view.container.textContent).not.toContain('Execute');

    const buttons = Array.from(view.container.querySelectorAll('button'));
    const planButton = buttons.find((button) => button.textContent?.includes('Plan'));
    const clarifyButton = buttons.find((button) => button.textContent?.includes('Clarify'));
    const reviewButton = buttons.find((button) => button.textContent?.includes('Review'));
    const firstFutureButton = buttons.find((button) => button.disabled);

    if (
      !(planButton instanceof HTMLButtonElement) ||
      !(clarifyButton instanceof HTMLButtonElement) ||
      !(reviewButton instanceof HTMLButtonElement) ||
      !(firstFutureButton instanceof HTMLButtonElement)
    ) {
      throw new Error('Expected completed, active, and future pipeline phase buttons');
    }

    act(() => {
      planButton.click();
      clarifyButton.click();
      reviewButton.click();
      firstFutureButton.click();
    });

    expect(onPhaseClick).toHaveBeenCalledTimes(3);
    expect(onPhaseClick).toHaveBeenNthCalledWith(1, 'planning');
    expect(onPhaseClick).toHaveBeenNthCalledWith(2, 'clarifying');
    expect(onPhaseClick).toHaveBeenNthCalledWith(3, 'reviewing');
    view.cleanup();
  });

  it('renders startup progress with status-specific labels', () => {
    const view = renderIntoDom(
      <StartupProgress
        title="Starting ShipCode"
        subtitle="Preparing the desktop app."
        steps={[
          { id: 'bridge', label: 'Connect desktop bridge', status: 'complete' },
          {
            id: 'settings',
            label: 'Load settings',
            detail: 'Reading app preferences',
            status: 'active',
          },
          { id: 'projects', label: 'Restore workspace', status: 'pending' },
        ]}
      />,
    );

    expect(view.container.textContent).toContain('Starting ShipCode');
    expect(view.container.textContent).toContain('Connect desktop bridge');
    expect(view.container.textContent).toContain('Reading app preferences');
    expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    view.cleanup();
  });

  it('renders startup progress error and subtitle-free states', () => {
    const view = renderIntoDom(
      <StartupProgress
        title="Startup failed"
        steps={[
          { id: 'bridge', label: 'Connect bridge', status: 'error' },
          { id: 'projects', label: 'Restore projects', status: 'pending' },
        ]}
        className="startup-shell"
      />,
    );

    expect(view.container.textContent).toContain('Startup failed');
    expect(view.container.textContent).toContain('Connect bridge');
    expect(view.container.querySelector('[aria-busy="false"]')).not.toBeNull();
    expect(view.container.querySelector('.startup-shell')).not.toBeNull();
    view.cleanup();
  });

  it('uses noun labels for passive workflow stages', () => {
    const view = renderIntoDom(<PipelineStatus currentPhase="approval" />);

    expect(view.container.textContent).toContain('Approval');
    expect(view.container.textContent).not.toContain('Approve');

    view.cleanup();
  });

  it('renders completed state without a click handler', () => {
    const view = renderIntoDom(<PipelineStatus currentPhase="completed" />);

    expect(view.container.textContent).toContain('Complete');
    const buttons = Array.from(view.container.querySelectorAll('button'));
    expect(buttons.every((button) => !button.disabled)).toBe(true);

    act(() => {
      buttons[0]?.click();
      buttons.at(-1)?.click();
    });

    view.cleanup();
  });

  it('renders failed pipeline phases without marking future phases complete', () => {
    const onPhaseClick = vi.fn();
    const view = renderIntoDom(
      <PipelineStatus currentPhase="failed" onPhaseClick={onPhaseClick} />,
    );

    expect(view.container.textContent).not.toContain('Plan');

    const buttons = Array.from(view.container.querySelectorAll('button'));
    expect(buttons.every((button) => !button.disabled)).toBe(true);

    act(() => {
      buttons[0]?.click();
      buttons.at(-1)?.click();
    });

    expect(onPhaseClick).toHaveBeenCalledWith('planning');
    expect(onPhaseClick).toHaveBeenCalledWith('completed');
    view.cleanup();
  });

  it('renders plan details and the waiting state', () => {
    const waitingView = renderIntoDom(<PlanViewer plan={null} />);
    expect(waitingView.container.textContent).toContain('Waiting for plan generation');
    waitingView.cleanup();

    const planView = renderIntoDom(<PlanViewer plan={plan} />);
    expect(planView.container.textContent).toContain('Render board coverage details');
    expect(planView.container.textContent).toContain('Implementation Steps');
    expect(planView.container.textContent).toContain('Acceptance Criteria');
    expect(planView.container.textContent).toContain('Out of Scope');
    expect(planView.container.textContent).toContain('@shipcode/shared');
    planView.cleanup();
  });

  it('renders review details and suggestions', () => {
    const waitingView = renderIntoDom(<ReviewViewer review={null} />);
    expect(waitingView.container.textContent).toContain('Waiting for review');
    waitingView.cleanup();

    const reviewView = renderIntoDom(<ReviewViewer review={review} />);
    expect(reviewView.container.textContent).toContain('request changes');
    expect(reviewView.container.textContent).toContain('Coverage threshold is missing');
    expect(reviewView.container.textContent).toContain('Add the threshold gate');
    expect(reviewView.container.textContent).toContain('scripts/coverage-summary.mjs');
    reviewView.cleanup();
  });

  it('renders review decision, severity, and optional detail variants', () => {
    const variantReview = {
      ...review,
      decision: 'approve',
      findings: [
        {
          id: 'CRITICAL',
          severity: 'critical',
          category: 'security',
          description: 'Critical finding with a file.',
          filePath: 'packages/ui/src/ReviewViewer.tsx',
        },
        {
          id: 'MINOR',
          severity: 'minor',
          category: 'performance',
          description: 'Minor finding with a suggestion.',
          suggestion: 'Use the shared renderer.',
        },
        {
          id: 'NIT',
          severity: 'nit',
          category: 'design',
          description: 'Nit finding without optional fields.',
        },
      ],
      suggestedChanges: [],
    } satisfies PlanReview;

    const view = renderIntoDom(<ReviewViewer review={variantReview} />);

    expect(view.container.textContent).toContain('approve');
    expect(view.container.textContent).toContain('Critical finding with a file.');
    expect(view.container.textContent).toContain('packages/ui/src/ReviewViewer.tsx');
    expect(view.container.textContent).toContain('Use the shared renderer.');
    expect(view.container.textContent).toContain('Nit finding without optional fields.');
    expect(view.container.textContent).not.toContain('Suggested Changes');

    view.cleanup();
  });

  it('renders empty review sections without findings or suggestions', () => {
    const rejectedReview = {
      ...review,
      decision: 'reject',
      findings: [],
      suggestedChanges: [],
    } satisfies PlanReview;

    const view = renderIntoDom(<ReviewViewer review={rejectedReview} />);

    expect(view.container.textContent).toContain('reject');
    expect(view.container.textContent).not.toContain('Findings');
    expect(view.container.textContent).not.toContain('Suggested Changes');

    view.cleanup();
  });

  it('renders the defensive review decision fallback', () => {
    const malformedReview = {
      ...review,
      decision: 'needs_discussion',
      findings: [],
      suggestedChanges: [],
    } as unknown as PlanReview;

    const view = renderIntoDom(<ReviewViewer review={malformedReview} />);

    expect(view.container.textContent).toContain('needs discussion');

    view.cleanup();
  });

  it('renders verification results, evidence, and linked issues', () => {
    const view = renderIntoDom(<VerificationViewer verification={verification} />);

    expect(view.container.textContent).toContain('Failed');
    expect(view.container.textContent).toContain('Coverage threshold enforced');
    expect(view.container.textContent).toContain('No minimum threshold configured yet.');
    expect(view.container.textContent).toContain('Coverage is below the floor in one package.');
    expect(view.container.textContent).toContain('packages/ui/src/PipelineStatus.tsx');
    view.cleanup();
  });

  it('renders passed verification and optional issue variants', () => {
    const passedVerification = {
      ...verification,
      result: 'passed',
      summary: 'All acceptance criteria passed.',
      criteriaResults: [
        {
          criterion: 'Coverage threshold enforced',
          passed: true,
          evidence: 'Threshold gate passed.',
        },
      ],
      issues: [
        {
          severity: 'blocker',
          description: 'A blocker remains for display purposes.',
        },
        {
          severity: 'warning',
          description: 'Warning note.',
        },
      ],
    } satisfies VerificationResult;

    const view = renderIntoDom(<VerificationViewer verification={passedVerification} />);

    expect(view.container.textContent).toContain('Passed');
    expect(view.container.textContent).toContain('Threshold gate passed.');
    expect(view.container.textContent).toContain('blocker');
    expect(view.container.textContent).toContain('warning');
    expect(view.container.textContent).not.toContain('packages/ui/src/PipelineStatus.tsx');
    view.cleanup();
  });

  it('renders the defensive verification severity fallback', () => {
    const defensiveVerification = {
      ...verification,
      issues: [
        {
          severity: 'info',
          description: 'Informational verifier note.',
        },
      ],
    } as unknown as VerificationResult;

    const view = renderIntoDom(<VerificationViewer verification={defensiveVerification} />);

    expect(view.container.textContent).toContain('info');
    expect(view.container.textContent).toContain('Informational verifier note.');
    view.cleanup();
  });

  it('renders task graph progress and opens linked child issues', () => {
    const onOpenIssue = vi.fn();
    const view = renderIntoDom(
      <TaskGraphViewer
        graph={taskGraph}
        getIssueUrl={(issueNumber) => `https://github.com/shipcode/shipcode/issues/${issueNumber}`}
        onOpenIssue={onOpenIssue}
      />,
    );

    expect(view.container.textContent).toContain('Task Graph');
    expect(view.container.textContent).toContain('GitHub sub-issues');
    expect(view.container.textContent).toContain('1/2');
    expect(view.container.textContent).toContain('Persist graph state');
    expect(view.container.textContent).toContain('Render graph status');

    const issueButton = Array.from(view.container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('#42'),
    );
    if (!(issueButton instanceof HTMLButtonElement)) {
      throw new Error('Expected child issue button');
    }

    act(() => {
      issueButton.click();
    });

    expect(onOpenIssue).toHaveBeenCalledWith('https://github.com/shipcode/shipcode/issues/42');
    view.cleanup();
  });

  it('renders task graph optional modes, statuses, files, and disabled issue links', () => {
    const graph = {
      ...taskGraph,
      mode: 'internal',
      status: 'failed',
      riskScore: 0.2,
      assessment: {
        ...taskGraph.assessment,
        mode: 'internal',
        reasons: [],
      },
      nodes: [
        {
          ...taskGraph.nodes[0],
          id: 'node-blocked',
          order: 2,
          stableKey: 'T2',
          title: 'Blocked task',
          status: 'blocked',
          files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
          suggestedReasoningEffort: 'none',
          githubIssueNumber: 43,
        },
        {
          ...taskGraph.nodes[1],
          id: 'node-running',
          order: 1,
          stableKey: 'T1',
          title: 'Running task',
          status: 'running',
          githubIssueNumber: null,
        },
        {
          ...taskGraph.nodes[1],
          id: 'node-pending',
          order: 3,
          stableKey: 'T3',
          title: 'Pending task',
          status: 'pending',
          files: [],
          githubIssueNumber: 44,
        },
        {
          ...taskGraph.nodes[1],
          id: 'node-failed',
          order: 4,
          stableKey: 'T4',
          title: 'Failed task',
          status: 'failed',
          githubIssueNumber: null,
        },
      ],
    } satisfies TaskGraphWithNodes;

    const nullView = renderIntoDom(<TaskGraphViewer graph={null} />);
    expect(nullView.container.textContent).toBe('');
    nullView.cleanup();

    const view = renderIntoDom(
      <TaskGraphViewer
        graph={graph}
        className="graph-shell"
        getIssueUrl={(issueNumber) => (issueNumber === 43 ? null : `/issues/${issueNumber}`)}
      />,
    );

    expect(view.container.textContent).toContain('Internal');
    expect(view.container.textContent).toContain('failed');
    expect(view.container.textContent).toContain('Risk 20%');
    expect(view.container.textContent).toContain('Active');
    expect(view.container.textContent).toContain('T1');
    expect(view.container.textContent).toContain('Blocked task');
    expect(view.container.textContent).toContain('+1');
    expect(view.container.textContent).toContain('Pending task');
    expect(view.container.textContent).toContain('Failed task');
    expect(view.container.textContent).not.toContain('none');
    expect(view.container.querySelector('.graph-shell')).not.toBeNull();

    const disabledButtons = Array.from(view.container.querySelectorAll('button:disabled'));
    expect(disabledButtons.some((button) => button.textContent?.includes('#43'))).toBe(true);
    expect(disabledButtons.some((button) => button.textContent?.includes('#44'))).toBe(true);
    view.cleanup();
  });
});
