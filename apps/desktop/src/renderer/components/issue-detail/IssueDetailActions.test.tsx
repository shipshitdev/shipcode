// @vitest-environment jsdom

import type { ClarificationRequest, Thread } from '@shipcode/shared';
import { PIPELINE_PHASE } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildIssueDetailActions } from './IssueDetailActions';

const makeThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: 'thread-1',
  projectId: 'project-1',
  title: 'Thread title',
  prompt: 'Do the thing',
  status: 'approval',
  kind: 'pipeline',
  worktreeBranch: null,
  worktreePath: null,
  plannerModel: 'claude',
  reviewerModel: 'codex',
  executorModel: 'claude',
  verifierModel: 'claude',
  reviewRound: 0,
  clarificationRound: 0,
  clarificationRequest: null,
  clarificationAnswers: [],
  answeredClarification: null,
  verificationStatus: null,
  verificationRetries: 0,
  autonomous: false,
  baseBranch: null,
  forkPointSha: null,
  githubIssueNumber: 42,
  githubPrNumber: null,
  githubRepo: null,
  automationId: null,
  createdAt: '2026-05-09T00:00:00.000Z',
  updatedAt: '2026-05-09T00:00:00.000Z',
  plannerResolvedModel: null,
  reviewerResolvedModel: null,
  revisorResolvedModel: null,
  executorResolvedModel: null,
  verifierResolvedModel: null,
  totalTokensPrompt: 0,
  totalTokensCompletion: 0,
  totalCostUsd: 0,
  doneAt: null,
  lastError: null,
  failurePhase: null,
  failureCount: 0,
  pausedPhase: null,
  pausedAt: null,
  ...overrides,
});

const clarificationRequest: ClarificationRequest = {
  id: 'clarify-1',
  threadId: 'thread-1',
  phase: 'plan',
  summary: 'Need deployment details.',
  questions: [
    {
      id: 'q1',
      title: 'Target',
      prompt: 'Where should this deploy?',
      description: 'Pick the closest match.',
      allowFreeform: false,
      freeformPlaceholder: null,
      choices: [
        {
          id: 'prod',
          label: 'Production',
          description: 'Deploy to production.',
          recommended: true,
        },
        {
          id: 'staging',
          label: 'Staging',
          description: 'Deploy to staging.',
        },
      ],
    },
    {
      id: 'q2',
      title: 'Notes',
      prompt: 'Any extra constraints?',
      description: null,
      allowFreeform: true,
      freeformPlaceholder: 'Add constraints',
      choices: [],
    },
  ],
};

function baseProps(overrides: Partial<Parameters<typeof buildIssueDetailActions>[0]> = {}) {
  return {
    approveError: null,
    approvedAwaitingExecution: false,
    canApprove: false,
    canRerun: false,
    canStartPipeline: false,
    effectiveRevisionCount: 1,
    clarificationRequest: null,
    failingPhaseOutput: null,
    hasDiffs: true,
    hasApprovalDecision: false,
    isCompleted: false,
    isSubmitting: false,
    requireApproval: true,
    retryButtonLabel: 'Retry',
    retrySummary: null,
    showRawOutput: false,
    thread: makeThread(),
    verificationSummary: null,
    onApprove: vi.fn(),
    onCancel: vi.fn(),
    onEditPrd: vi.fn(),
    onMarkAsDone: vi.fn(),
    onReject: vi.fn(),
    onRerun: vi.fn(),
    onShowRawOutputChange: vi.fn(),
    onStartPipeline: vi.fn(),
    onSubmitClarification: vi.fn(async () => undefined),
    ...overrides,
  };
}

function renderActions(props: ReturnType<typeof baseProps>) {
  const sections = buildIssueDetailActions(props);
  render(
    <div>
      {sections.pipelineStartCard}
      {sections.clarificationSection}
      {sections.rerunSection}
      {sections.completionSection}
      {sections.approvalSection}
    </div>,
  );
}

function ActionsView({ props }: { props: ReturnType<typeof baseProps> }) {
  const sections = buildIssueDetailActions(props);
  return (
    <div>
      {sections.pipelineStartCard}
      {sections.clarificationSection}
      {sections.rerunSection}
      {sections.completionSection}
      {sections.approvalSection}
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('IssueDetailActions', () => {
  it('renders the start card for skip-review pipelines and routes start/edit actions', () => {
    const props = baseProps({
      canStartPipeline: true,
      effectiveRevisionCount: 0,
      onEditPrd: vi.fn(),
      onStartPipeline: vi.fn(),
    });

    renderActions(props);

    expect(screen.getByText(/Review is skipped for this issue/)).toBeInTheDocument();
    expect(screen.queryByText('Review')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start pipeline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(props.onStartPipeline).toHaveBeenCalledTimes(1);
    expect(props.onEditPrd).toHaveBeenCalledTimes(1);
  });

  it('renders revision start copy for automatic execution', () => {
    const props = baseProps({
      canStartPipeline: true,
      effectiveRevisionCount: 1,
      requireApproval: false,
    });

    renderActions(props);

    expect(
      screen.getByText(/ShipCode will plan, run 1 revision, and then execute automatically/),
    ).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();

    cleanup();
    renderActions(
      baseProps({
        canStartPipeline: true,
        effectiveRevisionCount: 2,
        requireApproval: true,
      }),
    );

    expect(
      screen.getByText(/ShipCode will plan, run 2 revisions, and then pause for approval/),
    ).toBeInTheDocument();

    cleanup();
    renderActions(
      baseProps({
        canStartPipeline: true,
        effectiveRevisionCount: 0,
        requireApproval: false,
      }),
    );

    expect(
      screen.getByText(/ShipCode will plan and then execute automatically/),
    ).toBeInTheDocument();
  });

  it('routes rerun actions, copies failure output, and toggles raw output', () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    const props = baseProps({
      canRerun: true,
      failingPhaseOutput: '\u001b[31mraw failure\u001b[0m',
      retrySummary: 'Verifier found two failures.',
      thread: makeThread({ status: 'failed', lastError: 'boom' }),
      onMarkAsDone: vi.fn(),
      onRerun: vi.fn(),
      onShowRawOutputChange: vi.fn(),
    });

    renderActions(props);

    fireEvent.click(screen.getByTitle('Copy to clipboard'));
    fireEvent.click(screen.getByRole('button', { name: 'Show raw output' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Issue' }));

    expect(writeText).toHaveBeenCalledWith('boom\n\n\u001b[31mraw failure\u001b[0m');
    expect(props.onShowRawOutputChange).toHaveBeenCalledWith(true);
    expect(props.onRerun).toHaveBeenCalledTimes(1);
    expect(props.onMarkAsDone).toHaveBeenCalledTimes(1);
  });

  it('renders rerun fallback and expanded raw-output states', () => {
    const props = baseProps({
      canRerun: true,
      failingPhaseOutput: null,
      retryButtonLabel: 'Resume execution',
      thread: makeThread({ status: 'failed', lastError: null }),
    });

    renderActions(props);

    expect(
      screen.getByText(/No error message captured. Check the Pipeline tab terminal output/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show raw output' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume execution' })).toBeInTheDocument();

    cleanup();
    renderActions(
      baseProps({
        canRerun: true,
        failingPhaseOutput: '\u001b[31mexpanded output\u001b[0m',
        showRawOutput: true,
        thread: makeThread({ status: 'failed', lastError: null }),
      }),
    );

    expect(screen.getByRole('button', { name: 'Hide raw output' })).toBeInTheDocument();
    expect(screen.getByText('expanded output')).toBeInTheDocument();

    cleanup();
    renderActions(
      baseProps({
        canRerun: true,
        failingPhaseOutput: 'plain pipeline failure',
        thread: makeThread({
          status: 'failed',
          failurePhase: 'executing',
          failureCount: 1,
          lastError: null,
        }),
      }),
    );

    expect(screen.getByText('Execution failed')).toBeInTheDocument();
    expect(screen.queryByText(/This error came from/)).not.toBeInTheDocument();

    cleanup();
    renderActions(
      baseProps({
        canRerun: true,
        failingPhaseOutput: 'execution failed while applying patch',
        thread: makeThread({ status: 'failed', lastError: null }),
      }),
    );

    expect(screen.getByText(/This error came from the target project/)).toBeInTheDocument();
  });

  it('renders completion details and routes Create PR and Close Issue actions', () => {
    const props = baseProps({
      canCreatePr: true,
      createPrError: 'PR failed',
      isCompleted: true,
      onCreatePr: vi.fn(),
      onMarkAsDone: vi.fn(),
      thread: makeThread({ status: 'completed', totalCostUsd: 1.23456 }),
      verificationSummary: 'x'.repeat(90),
    });

    renderActions(props);

    expect(screen.getByText('Pipeline Completed')).toBeInTheDocument();
    expect(screen.getByText('PR failed')).toBeInTheDocument();
    expect(screen.getByText('· $1.2346')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Issue' }));

    expect(props.onCreatePr).toHaveBeenCalledTimes(1);
    expect(props.onMarkAsDone).toHaveBeenCalledTimes(1);
  });

  it('renders completion fallbacks without diffs and without PR creation wiring', () => {
    const props = baseProps({
      canCreatePr: true,
      hasDiffs: false,
      isCompleted: true,
      onCreatePr: undefined,
      thread: makeThread({ status: 'completed', totalCostUsd: 0 }),
      verificationSummary: null,
    });

    renderActions(props);

    expect(screen.getByText('no code changes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create PR' })).not.toBeInTheDocument();

    cleanup();
    renderActions(
      baseProps({
        hasDiffs: true,
        isCompleted: true,
        thread: makeThread({ status: 'completed' }),
        verificationSummary: 'short verification summary',
      }),
    );

    expect(screen.getByText('short verification summary')).toBeInTheDocument();

    cleanup();
    renderActions(
      baseProps({
        hasDiffs: true,
        isCompleted: true,
        thread: makeThread({ status: 'completed' }),
        verificationSummary: null,
      }),
    );

    expect(screen.queryByText('no code changes')).not.toBeInTheDocument();
  });

  it('submits clarification answers and surfaces submit failures', async () => {
    const onSubmitClarification = vi.fn(async () => {
      throw new Error('submit failed');
    });
    const props = baseProps({
      clarificationRequest,
      onSubmitClarification,
      thread: makeThread({
        status: PIPELINE_PHASE.clarifying,
        clarificationAnswers: [
          { questionId: 'q1', selectedChoiceId: 'staging', freeformText: null },
        ],
      }),
    });

    renderActions(props);

    fireEvent.click(screen.getByRole('button', { name: /Production/ }));
    fireEvent.change(screen.getByPlaceholderText('Add constraints'), {
      target: { value: '  use canary first  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resume planning' }));

    await waitFor(() => expect(screen.getByText('submit failed')).toBeInTheDocument());
    expect(onSubmitClarification).toHaveBeenCalledWith([
      { questionId: 'q1', selectedChoiceId: 'prod', freeformText: null },
      { questionId: 'q2', selectedChoiceId: null, freeformText: 'use canary first' },
    ]);
  });

  it('uses default freeform placeholders and renders non-Error clarification submit failures', async () => {
    const onSubmitClarification = vi.fn(async () => {
      throw 'submit unavailable';
    });
    const props = baseProps({
      clarificationRequest: {
        id: 'clarify-freeform',
        threadId: 'thread-1',
        phase: 'plan' as const,
        summary: 'Need one answer.',
        questions: [
          {
            id: 'q-freeform',
            title: 'Constraint',
            prompt: 'What should ShipCode avoid?',
            description: null,
            allowFreeform: true,
            freeformPlaceholder: null,
            choices: [],
          },
        ],
      },
      onSubmitClarification,
      thread: makeThread({ status: PIPELINE_PHASE.clarifying }),
    });

    renderActions(props);

    fireEvent.change(screen.getByPlaceholderText('Add context if needed'), {
      target: { value: 'avoid migrations' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resume planning' }));

    await waitFor(() => expect(screen.getByText('submit unavailable')).toBeInTheDocument());
    expect(onSubmitClarification).toHaveBeenCalledWith([
      { questionId: 'q-freeform', selectedChoiceId: null, freeformText: 'avoid migrations' },
    ]);
  });

  it('preserves clarification draft state when the request shape changes under the same key', () => {
    const initialProps = baseProps({
      clarificationRequest: {
        id: 'clarify-dynamic',
        threadId: 'thread-1',
        phase: 'plan' as const,
        summary: 'Initial question.',
        questions: [
          {
            id: 'q1',
            title: 'First',
            prompt: 'First question?',
            description: null,
            allowFreeform: true,
            freeformPlaceholder: null,
            choices: [],
          },
        ],
      },
      thread: makeThread({ status: PIPELINE_PHASE.clarifying }),
    });
    const { rerender } = render(<ActionsView props={initialProps} />);

    expect(screen.getByText('First')).toBeInTheDocument();

    rerender(
      <ActionsView
        props={baseProps({
          clarificationRequest: {
            id: 'clarify-dynamic',
            threadId: 'thread-1',
            phase: 'plan' as const,
            summary: 'Replacement question.',
            questions: [
              {
                id: 'q2',
                title: 'Second',
                prompt: 'Second question?',
                description: null,
                allowFreeform: false,
                freeformPlaceholder: null,
                choices: [
                  {
                    id: 'choice-2',
                    label: 'Choice 2',
                    description: 'Second choice.',
                  },
                ],
              },
            ],
          },
          thread: makeThread({ status: PIPELINE_PHASE.clarifying }),
        })}
      />,
    );

    expect(screen.getByText('Second')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Choice 2/ }));
    expect(screen.getByRole('button', { name: /Choice 2/ })).toBeInTheDocument();
  });

  it('renders answered clarification choices and freeform text', () => {
    const props = baseProps({
      thread: makeThread({
        answeredClarification: {
          request: clarificationRequest,
          answers: [
            { questionId: 'q1', selectedChoiceId: 'prod', freeformText: 'ship after smoke tests' },
            { questionId: 'q2', selectedChoiceId: null, freeformText: '  keep it narrow  ' },
          ],
        },
      }),
    });

    renderActions(props);

    expect(screen.getByText('Planning resumed with your answers')).toBeInTheDocument();
    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.getByText('ship after smoke tests')).toBeInTheDocument();
    expect(screen.getByText('keep it narrow')).toBeInTheDocument();
  });

  it('renders answered clarification text when the selected choice no longer exists', () => {
    const props = baseProps({
      thread: makeThread({
        answeredClarification: {
          request: clarificationRequest,
          answers: [
            { questionId: 'q1', selectedChoiceId: 'removed-choice', freeformText: 'fallback' },
          ],
        },
      }),
    });

    renderActions(props);

    expect(screen.getByText('Planning resumed with your answers')).toBeInTheDocument();
    expect(screen.getByText('fallback')).toBeInTheDocument();
    expect(screen.queryByText('Production')).not.toBeInTheDocument();
  });

  it('renders approval waiting and approval decision sections', () => {
    const cancelProps = baseProps({
      approvedAwaitingExecution: true,
      onCancel: vi.fn(),
    });

    renderActions(cancelProps);

    expect(screen.getByText(/Approval is already confirmed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancelProps.onCancel).toHaveBeenCalledTimes(1);

    cleanup();
    renderActions(
      baseProps({
        approveError: 'approval failed',
        canApprove: true,
        hasApprovalDecision: true,
      }),
    );

    expect(screen.getByText('approval failed')).toBeInTheDocument();

    cleanup();
    renderActions(
      baseProps({
        hasApprovalDecision: true,
        thread: null,
      }),
    );

    expect(screen.getByText('Approve & Execute')).toBeInTheDocument();
  });
});
