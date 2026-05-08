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
import { ShipCodeLogoMark } from '@/brand/ShipCodeLogoMark';
import { PipelineStatus } from '@/PipelineStatus';
import { PlanViewer } from '@/PlanViewer';
import { ReviewViewer } from '@/ReviewViewer';
import { SettingsSection } from '@/SettingsSection';
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

  it('uses noun labels for passive workflow stages', () => {
    const view = renderIntoDom(<PipelineStatus currentPhase="awaiting_approval" />);

    expect(view.container.textContent).toContain('Approval');
    expect(view.container.textContent).not.toContain('Approve');

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

  it('renders verification results, evidence, and linked issues', () => {
    const view = renderIntoDom(<VerificationViewer verification={verification} />);

    expect(view.container.textContent).toContain('Failed');
    expect(view.container.textContent).toContain('Coverage threshold enforced');
    expect(view.container.textContent).toContain('No minimum threshold configured yet.');
    expect(view.container.textContent).toContain('Coverage is below the floor in one package.');
    expect(view.container.textContent).toContain('packages/ui/src/PipelineStatus.tsx');
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
});
