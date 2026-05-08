// @vitest-environment jsdom

import type { SystemHealth } from '@shipcode/shared';
import { CURRENT_ONBOARDING_VERSION } from '@shipcode/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingWizard, StepGitHubReadiness } from './OnboardingWizard';
import { StepAuthCheck } from './StepAuthCheck';
import { StepModelPrefs } from './StepModelPrefs';

function renderWithQueryClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function createAuthResult({
  claudeAuthenticated,
  codexAuthenticated,
}: {
  claudeAuthenticated: boolean;
  codexAuthenticated: boolean;
}) {
  return {
    claude: {
      available: true,
      authenticated: claudeAuthenticated,
      version: '1.0.0',
      path: '/usr/local/bin/claude',
      error: null,
    },
    codex: {
      available: true,
      authenticated: codexAuthenticated,
      version: '1.0.0',
      path: '/usr/local/bin/codex',
      error: null,
    },
    git: {
      available: true,
      authenticated: false,
      version: '2.0.0',
      path: '/usr/bin/git',
      error: null,
    },
    gh: {
      available: true,
      authenticated: false,
      version: '2.0.0',
      path: '/usr/local/bin/gh',
      error: null,
    },
    ghAuth: {
      installed: true,
      authenticated: true,
      username: 'decod3rs',
      version: '2.0.0',
      error: null,
      hasProjectScope: true,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.shipcode = {
    invoke: vi.fn(async () => null) as unknown as typeof window.shipcode.invoke,
    on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
  };
});

afterEach(() => {
  cleanup();
});

describe('onboarding leaf steps', () => {
  it('renders the auth checklist and authentication commands for zero authenticated agents', () => {
    const authResult: SystemHealth & {
      ghAuth: {
        installed: boolean;
        authenticated: boolean;
        username: string | null;
        version: string | null;
        error: string | null;
        hasProjectScope: boolean;
      };
    } = {
      claude: {
        available: true,
        authenticated: false,
        version: '1.0.0',
        path: '/usr/local/bin/claude',
        error: null,
      },
      codex: {
        available: false,
        authenticated: false,
        version: null,
        path: null,
        error: 'missing',
      },
      git: {
        available: true,
        authenticated: false,
        version: '2.0.0',
        path: '/usr/bin/git',
        error: null,
      },
      gh: {
        available: true,
        authenticated: false,
        version: '2.0.0',
        path: '/usr/local/bin/gh',
        error: null,
      },
      ghAuth: {
        installed: false,
        authenticated: false,
        username: null,
        version: null,
        error: null,
        hasProjectScope: false,
      },
    };

    const onRecheck = vi.fn();

    render(<StepAuthCheck authResult={authResult} onRecheck={onRecheck} isChecking={false} />);

    expect(screen.getByText('Connect your AI agents')).toBeInTheDocument();
    expect(screen.getByText('Claude CLI')).toBeInTheDocument();
    expect(screen.getAllByText('Not authenticated').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not installed').length).toBeGreaterThan(1);
    expect(screen.getByText('claude login')).toBeInTheDocument();
    expect(screen.getByText('codex login')).toBeInTheDocument();
    expect(screen.getByText('gh auth login')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it('shows the single-agent warning and checking state in auth check', () => {
    const authResult = {
      claude: {
        available: true,
        authenticated: true,
        version: '1.0.0',
        path: '/usr/local/bin/claude',
        error: null,
      },
      codex: {
        available: true,
        authenticated: false,
        version: '1.0.0',
        path: '/usr/local/bin/codex',
        error: null,
      },
      git: {
        available: true,
        authenticated: false,
        version: '2.0.0',
        path: '/usr/bin/git',
        error: null,
      },
      gh: {
        available: true,
        authenticated: false,
        version: '2.0.0',
        path: '/usr/local/bin/gh',
        error: null,
      },
      ghAuth: {
        installed: true,
        authenticated: true,
        username: 'decod3rs',
        version: '2.0.0',
        error: null,
        hasProjectScope: true,
      },
    };

    render(<StepAuthCheck authResult={authResult} onRecheck={vi.fn()} isChecking={true} />);

    expect(screen.getByText(/single-agent mode/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-check' })).toBeDisabled();
    expect(screen.getByText('@decod3rs')).toBeInTheDocument();
  });

  it('renders auth progress while the initial auth result is still loading', () => {
    render(<StepAuthCheck authResult={null} onRecheck={vi.fn()} isChecking={true} />);

    expect(screen.getByText('Checking login state')).toBeInTheDocument();
    expect(screen.getByText('Check Claude CLI login')).toBeInTheDocument();
    expect(screen.getByText('Check Codex CLI login')).toBeInTheDocument();
    expect(screen.getByText('Check GitHub CLI login')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Re-check' })).toBeDisabled();
  });

  it('renders the model preference warning state', () => {
    render(
      <StepModelPrefs
        plannerModel="claude"
        reviewerModel="codex"
        onChange={vi.fn()}
        singleAgentMode
      />,
    );

    expect(screen.getByText('Model preferences')).toBeInTheDocument();
    expect(
      screen.getByText(/Review will be skipped during pipeline execution/i),
    ).toBeInTheDocument();
  });

  it('renders explicit GitHub readiness requirements', () => {
    render(<StepGitHubReadiness />);

    expect(screen.getByText('GitHub readiness')).toBeInTheDocument();
    expect(screen.getByText('shipcode:* only')).toBeInTheDocument();
    expect(screen.getByText('Feature')).toBeInTheDocument();
    expect(screen.getByText('P0, P1, P2, P3')).toBeInTheDocument();
    expect(screen.getByText(/Area or Component field/)).toBeInTheDocument();
  });

  it('keeps onboarding on auth until at least one AI agent is authenticated and supports re-check', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'onboarding:check-auth') {
        return createAuthResult({ claudeAuthenticated: false, codexAuthenticated: false });
      }
      return null;
    });
    window.shipcode.invoke = invoke as unknown as typeof window.shipcode.invoke;

    renderWithQueryClient(<OnboardingWizard onComplete={vi.fn()} />);

    await screen.findByText('claude login');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));

    await waitFor(() => {
      expect(
        invoke.mock.calls.filter(([channel]) => channel === 'onboarding:check-auth'),
      ).toHaveLength(2);
    });
    expect(screen.getByText('codex login')).toBeInTheDocument();
  });

  it('advances through onboarding and persists model defaults on finish', async () => {
    const onComplete = vi.fn();
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'onboarding:check-auth') {
        return createAuthResult({ claudeAuthenticated: true, codexAuthenticated: true });
      }
      if (channel === 'settings:set') return undefined;
      return null;
    });
    window.shipcode.invoke = invoke as unknown as typeof window.shipcode.invoke;

    renderWithQueryClient(<OnboardingWizard onComplete={onComplete} />);

    await screen.findAllByText('Authenticated');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Model preferences')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('GitHub readiness')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Finish Setup' }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('settings:set', {
        plannerModel: 'claude',
        reviewerModel: 'codex',
        onboardingVersion: CURRENT_ONBOARDING_VERSION,
      });
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
