// @vitest-environment jsdom

import {
  type AppSettings,
  DEFAULT_SETTINGS,
  type OpenRouterModelValidation,
  type Project,
} from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectPhaseSettingsRow } from './ProjectPhaseSettingsRow';
import type { ProjectOverrideState } from './shared';

vi.mock('@shipshitdev/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipshitdev/ui')>();
  const selectValues = ['__inherit__', 'claude', 'codex', 'openrouter', 'custom/model', 'high'];

  return {
    ...actual,
    Select: ({
      children,
      onValueChange,
      value,
    }: {
      children: ReactNode;
      onValueChange: (value: string) => void;
      value: string;
    }) => (
      <div data-select-value={value}>
        {children}
        {selectValues.map((next) => (
          <button
            key={next}
            type="button"
            data-testid={`select-${value}-${next}`}
            onClick={() => onValueChange(next)}
          >
            select {next}
          </button>
        ))}
      </div>
    ),
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children }: { children: ReactNode; value: string }) => <div>{children}</div>,
    SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectValue: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  };
});

const baseOverrides: ProjectOverrideState = {
  plannerModelOverride: null,
  reviewerModelOverride: null,
  executorModelOverride: null,
  verifierModelOverride: null,
  plannerModelIdOverride: null,
  reviewerModelIdOverride: null,
  executorModelIdOverride: null,
  verifierModelIdOverride: null,
  plannerReasoningEffortOverride: null,
  reviewerReasoningEffortOverride: null,
  executorReasoningEffortOverride: null,
  verifierReasoningEffortOverride: null,
  pipelineSpeedProfileOverride: null,
  revisionCountOverride: null,
  requireApprovalOverride: null,
  prdQualityGate: null,
  discordRouting: 'inherit',
  discordWebhookUrlOverride: null,
  telegramRouting: 'inherit',
  telegramChatIdOverride: null,
};

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Project',
    path: '/tmp/project',
    gitRemote: 'https://github.com/acme/repo.git',
    githubRepoId: null,
    githubRepoFullName: null,
    starterIssueNumber: null,
    starterIssueCreatedAt: null,
    githubProjectUrl: null,
    githubStatusMapping: null,
    plannerModelOverride: null,
    reviewerModelOverride: null,
    executorModelOverride: null,
    verifierModelOverride: null,
    plannerModelIdOverride: null,
    reviewerModelIdOverride: null,
    executorModelIdOverride: null,
    verifierModelIdOverride: null,
    plannerReasoningEffortOverride: null,
    reviewerReasoningEffortOverride: null,
    executorReasoningEffortOverride: null,
    verifierReasoningEffortOverride: null,
    revisionCountOverride: null,
    discordRouting: 'inherit',
    discordWebhookUrlOverride: null,
    telegramRouting: 'inherit',
    telegramChatIdOverride: null,
    defaultBranch: 'main',
    pinned: false,
    archived: false,
    hidden: false,
    notifyGithubUser: null,
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-09T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

function renderRow({
  settings = DEFAULT_SETTINGS,
  overrides = baseOverrides,
  projectDraft = makeProject(),
  setOverrides = vi.fn(),
  setModelValidation = vi.fn(),
  integrationStatus = undefined,
  modelValidation = {},
}: {
  settings?: AppSettings;
  overrides?: ProjectOverrideState;
  projectDraft?: Project;
  setOverrides?: ReturnType<typeof vi.fn>;
  setModelValidation?: ReturnType<typeof vi.fn>;
  integrationStatus?: Parameters<typeof ProjectPhaseSettingsRow>[0]['integrationStatus'];
  modelValidation?: Parameters<typeof ProjectPhaseSettingsRow>[0]['modelValidation'];
} = {}) {
  render(
    <ProjectPhaseSettingsRow
      phase="planner"
      label="Planner"
      validProviders={['claude', 'codex', 'openrouter']}
      settings={settings}
      projectDraft={projectDraft}
      overrides={overrides}
      setOverrides={setOverrides as unknown as Dispatch<SetStateAction<ProjectOverrideState>>}
      integrationStatus={integrationStatus}
      modelValidation={modelValidation}
      setModelValidation={
        setModelValidation as unknown as Dispatch<
          SetStateAction<Partial<Record<string, OpenRouterModelValidation | null>>>
        >
      }
    />,
  );
  return { setModelValidation, setOverrides };
}

function applyUpdater<T>(mock: ReturnType<typeof vi.fn>, state: T): T {
  const updater = mock.mock.calls.at(-1)?.[0];
  if (typeof updater !== 'function') throw new Error('Expected updater function');
  return updater(state) as T;
}

describe('ProjectPhaseSettingsRow callback coverage', () => {
  it('updates provider, model id, effort, and validation state through select callbacks', () => {
    const setOverrides = vi.fn();
    const setModelValidation = vi.fn();
    renderRow({ setOverrides, setModelValidation });

    fireEvent.click(screen.getAllByTestId('select-__inherit__-openrouter')[0]);
    expect(applyUpdater(setOverrides, baseOverrides)).toMatchObject({
      plannerModelOverride: 'openrouter',
      plannerModelIdOverride: null,
      plannerReasoningEffortOverride: null,
    });
    expect(applyUpdater(setModelValidation, { planner: { status: 'invalid' } })).toEqual({
      planner: null,
    });

    fireEvent.click(screen.getAllByTestId('select-__inherit__-custom/model')[1]);
    expect(
      applyUpdater(setOverrides, {
        ...baseOverrides,
        plannerReasoningEffortOverride: 'high',
      }),
    ).toMatchObject({
      plannerModelIdOverride: 'custom/model',
      plannerReasoningEffortOverride: 'high',
    });

    fireEvent.click(screen.getAllByTestId('select-__inherit__-high')[2]);
    expect(applyUpdater(setOverrides, baseOverrides)).toMatchObject({
      plannerReasoningEffortOverride: 'high',
    });
  });

  it('clears a custom OpenRouter slug without validating an empty value', () => {
    const invoke = vi.fn();
    window.shipcode = {
      invoke: invoke as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };
    const setOverrides = vi.fn();
    const setModelValidation = vi.fn();
    renderRow({
      overrides: {
        ...baseOverrides,
        plannerModelOverride: 'openrouter',
        plannerModelIdOverride: 'custom/model',
      },
      setOverrides,
      setModelValidation,
    });

    fireEvent.change(screen.getByLabelText('Custom OpenRouter slug'), {
      target: { value: '   ' },
    });
    fireEvent.blur(screen.getByLabelText('Custom OpenRouter slug'));

    expect(applyUpdater(setOverrides, baseOverrides)).toMatchObject({
      plannerModelIdOverride: null,
    });
    expect(applyUpdater(setModelValidation, { planner: { status: 'invalid' } })).toEqual({
      planner: null,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('resets validation on model changes and validates custom OpenRouter slugs', async () => {
    const invoke = vi.fn(async () => ({ status: 'valid', message: 'ready' }));
    window.shipcode = {
      invoke: invoke as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };
    const setOverrides = vi.fn();
    const setModelValidation = vi.fn();
    renderRow({
      overrides: {
        ...baseOverrides,
        plannerModelOverride: 'openrouter',
        plannerModelIdOverride: 'custom/model',
        plannerReasoningEffortOverride: 'high',
      },
      setOverrides,
      setModelValidation,
    });

    fireEvent.click(screen.getByTestId('select-custom/model-__inherit__'));
    expect(
      applyUpdater(setOverrides, {
        ...baseOverrides,
        plannerReasoningEffortOverride: 'high',
      }),
    ).toMatchObject({
      plannerModelIdOverride: null,
      plannerReasoningEffortOverride: 'high',
    });
    expect(applyUpdater(setModelValidation, { planner: { status: 'invalid' } })).toEqual({
      planner: null,
    });

    fireEvent.change(screen.getByLabelText('Custom OpenRouter slug'), {
      target: { value: '  anthropic/claude-sonnet  ' },
    });
    fireEvent.blur(screen.getByLabelText('Custom OpenRouter slug'));

    expect(applyUpdater(setOverrides, baseOverrides)).toMatchObject({
      plannerModelIdOverride: 'anthropic/claude-sonnet',
    });
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('integrations:validate-openrouter-model', {
        modelId: 'anthropic/claude-sonnet',
      });
    });
    expect(applyUpdater(setModelValidation, {})).toEqual({
      planner: { status: 'valid', message: 'ready' },
    });
  });

  it('renders provider, CLI, effort, and validation warnings', () => {
    renderRow({
      settings: {
        ...DEFAULT_SETTINGS,
        plannerModel: 'codex',
        plannerReasoningEffort: 'xhigh',
      },
      projectDraft: makeProject({
        plannerModelOverride: 'codex',
        plannerReasoningEffortOverride: 'xhigh',
      }),
      overrides: {
        ...baseOverrides,
        plannerModelOverride: 'openrouter',
        plannerModelIdOverride: 'missing/model',
        plannerReasoningEffortOverride: 'xhigh',
      },
      integrationStatus: {
        openrouter: {
          authStatus: 'missing_key',
          message: 'OpenRouter key missing',
        },
        system: {
          claude: { available: true },
          codex: { available: false, authenticated: false, error: 'Codex missing' },
        },
      } as never,
      modelValidation: {
        planner: { modelId: 'test-model', status: 'invalid', message: 'Model unavailable' },
      },
    });

    expect(screen.getByText('OpenRouter key missing')).toBeInTheDocument();
    expect(screen.getByText('Model unavailable')).toBeInTheDocument();
    expect(screen.getByText(/may remap unsupported effort levels/i)).toBeInTheDocument();
  });
});
