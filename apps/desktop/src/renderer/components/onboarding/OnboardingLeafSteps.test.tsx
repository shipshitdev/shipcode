// @vitest-environment jsdom

import type { StatusLabelMapping, SystemHealth } from '@shipcode/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StepAuthCheck } from './StepAuthCheck';
import { StepLabelMapping } from './StepLabelMapping';
import { StepModelPrefs } from './StepModelPrefs';

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

  it('renders the status mapping editor wrapper and model preference warning state', () => {
    const onChange = vi.fn();
    const mappings: StatusLabelMapping = {
      todo: '',
      queued: 'status:queued',
      planning: 'status:in-progress',
      reviewing: 'status:in-progress',
      revising: 'status:in-progress',
      executing: 'status:in-progress',
      testing: '',
      verifying: 'status:in-progress',
      shipping: 'status:in-progress',
      completed: 'status:done',
      done: 'status:done',
      failed: 'status:failed',
    };

    const { container } = render(<StepLabelMapping mappings={mappings} onChange={onChange} />);

    expect(screen.getByText('Status label mapping')).toBeInTheDocument();
    expect(container.textContent).toContain('status:in-progress');

    cleanup();

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
});
