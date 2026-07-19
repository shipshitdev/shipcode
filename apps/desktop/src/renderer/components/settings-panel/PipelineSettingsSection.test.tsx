// @vitest-environment jsdom

import type { AppSettings, IntegrationStatus } from '@shipcode/shared';
import { DEFAULT_SETTINGS, PIPELINE_EXECUTOR_PROVIDERS } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PipelineSettingsSection } from './PipelineSettingsSection';

afterEach(() => {
  cleanup();
});

const integrationStatus: IntegrationStatus = {
  system: {
    claude: {
      available: true,
      version: 'claude 1.0.0',
      path: '/usr/local/bin/claude',
      error: null,
      authenticated: true,
    },
    codex: {
      available: true,
      version: 'codex 0.1.0',
      path: '/usr/local/bin/codex',
      error: null,
      authenticated: true,
    },
    gemini: {
      available: true,
      version: '0.1.0',
      path: '/usr/local/bin/gemini',
      error: null,
      authenticated: true,
    },
    git: {
      available: true,
      version: 'git version 2.43.0',
      path: '/usr/bin/git',
      error: null,
      authenticated: true,
    },
    gh: {
      available: true,
      version: 'gh version 2.40.1',
      path: '/usr/local/bin/gh',
      error: null,
      authenticated: true,
    },
  },
  ghAuth: {
    installed: true,
    authenticated: true,
    username: 'decod3rs',
    version: '2.40.1',
    error: null,
    hasProjectScope: true,
  },
  openrouter: {
    enabled: true,
    keyPresent: true,
    authStatus: 'valid',
    message: null,
    label: 'shipcode-dev',
    modelChecks: [
      {
        key: 'planner',
        label: 'Planner model',
        modelId: 'openrouter/auto',
        status: 'valid',
        message: null,
      },
      {
        key: 'reviewer',
        label: 'Reviewer model',
        modelId: 'openrouter/auto',
        status: 'valid',
        message: null,
      },
      {
        key: 'executor',
        label: 'Executor model',
        modelId: 'openrouter/auto',
        status: 'valid',
        message: null,
      },
      {
        key: 'verifier',
        label: 'Verifier model',
        modelId: 'openrouter/auto',
        status: 'valid',
        message: null,
      },
    ],
  },
  discord: {
    enabled: false,
    configured: false,
    destinationConfigured: false,
    validationStatus: 'missing',
    message: 'Discord webhook URL is not configured',
    lastDeliveryStatus: null,
  },
  telegram: {
    enabled: false,
    configured: false,
    destinationConfigured: false,
    validationStatus: 'missing',
    message: 'Telegram bot token is not configured',
    lastDeliveryStatus: null,
  },
  desktopApps: {
    cursor: {
      key: 'cursor',
      label: 'Cursor',
      available: true,
      path: '/Applications/Cursor.app',
      error: null,
    },
    finder: {
      key: 'finder',
      label: 'Finder',
      available: true,
      path: '/System/Library/CoreServices/Finder.app',
      error: null,
    },
    terminal: {
      key: 'terminal',
      label: 'Terminal',
      available: true,
      path: '/System/Applications/Utilities/Terminal.app',
      error: null,
    },
    ghostty: {
      key: 'ghostty',
      label: 'Ghostty',
      available: false,
      path: null,
      error: 'Ghostty is not installed',
    },
    vscode: {
      key: 'vscode',
      label: 'Visual Studio Code',
      available: true,
      path: '/Applications/Visual Studio Code.app',
      error: null,
    },
    t3code: {
      key: 't3code',
      label: 'T3 Code',
      available: true,
      path: '/Applications/T3 Code.app',
      error: null,
    },
  },
};

describe('PipelineSettingsSection', () => {
  it('updates runtime limits and trims testing fields on blur', () => {
    const onUpdate = vi.fn();
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      requireApproval: false,
      maxConcurrentPipelines: 3,
      maxConcurrentExecutions: 2,
      testCommand: 'bun test',
      testingContext: 'Use Vitest.',
    };

    render(
      <PipelineSettingsSection
        settings={settings}
        integrationStatus={integrationStatus}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Require approval before execution' }));
    expect(onUpdate).toHaveBeenCalledWith({ requireApproval: true });
    fireEvent.click(screen.getByRole('switch', { name: 'Post formal PR reviews to GitHub' }));
    expect(onUpdate).toHaveBeenCalledWith({ postFormalPrReviewEnabled: false });
    fireEvent.click(screen.getByRole('switch', { name: 'Post pipeline timeline to GitHub' }));
    expect(onUpdate).toHaveBeenCalledWith({ postPipelineTimelineEnabled: false });

    fireEvent.change(screen.getByLabelText('Max concurrent pipelines'), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByLabelText('Max concurrent pipelines'), {
      target: { value: '8' },
    });
    fireEvent.change(screen.getByLabelText('Max concurrent executions per project'), {
      target: { value: '11' },
    });
    fireEvent.change(screen.getByLabelText('Max concurrent executions per project'), {
      target: { value: '4' },
    });

    expect(onUpdate).not.toHaveBeenCalledWith({ maxConcurrentPipelines: 0 });
    expect(onUpdate).toHaveBeenCalledWith({ maxConcurrentPipelines: 8 });
    expect(onUpdate).not.toHaveBeenCalledWith({ maxConcurrentExecutions: 11 });
    expect(onUpdate).toHaveBeenCalledWith({ maxConcurrentExecutions: 4 });

    const testingTab = screen.getByRole('tab', { name: 'Testing' });
    fireEvent.mouseDown(testingTab, { button: 0 });
    fireEvent.click(testingTab);

    fireEvent.blur(screen.getByPlaceholderText('e.g. bun run test'), {
      target: { value: '  bun run verify  ' },
    });
    fireEvent.blur(
      screen.getByPlaceholderText(
        'e.g. Tests use Vitest, colocated as *.test.ts, use vi.mock() for mocking.',
      ),
      { target: { value: '   ' } },
    );

    expect(onUpdate).toHaveBeenCalledWith({ testCommand: 'bun run verify' });
    expect(onUpdate).toHaveBeenCalledWith({ testingContext: null });
  });

  it('shows editable agent output mode controls and the Claude execute sandbox toggle', () => {
    render(
      <PipelineSettingsSection
        settings={DEFAULT_SETTINGS}
        integrationStatus={integrationStatus}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.getByText('Agent Output Mode')).toBeInTheDocument();
    expect(screen.getByText('Claude execute output')).toBeInTheDocument();
    expect(screen.getByText('Codex execute output')).toBeInTheDocument();
    // Sandbox toggle gates whether programmatic Claude execute is selectable.
    expect(screen.getByRole('switch', { name: 'Sandbox Claude execute' })).toBeInTheDocument();
    // The six run-mode selects (claude/codex × execute/terminalFix/instant) are
    // now editable, not hard-disabled. Codex execute defaults to Programmatic.
    const modeControls = screen.getAllByRole('combobox').filter((control) => {
      const text = control.textContent ?? '';
      return text.includes('Interactive CLI') || text.includes('Programmatic');
    });
    expect(modeControls.length).toBeGreaterThanOrEqual(6);
    for (const control of modeControls) {
      expect(control).not.toBeDisabled();
    }
  });

  it('reverts programmatic Claude execute to interactive when the sandbox is turned off', () => {
    const onUpdate = vi.fn();
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      claudeExecuteSandboxEnabled: true,
      agentRunModes: {
        ...DEFAULT_SETTINGS.agentRunModes,
        claude: { ...DEFAULT_SETTINGS.agentRunModes.claude, execute: 'programmatic' },
      },
    };

    render(
      <PipelineSettingsSection
        settings={settings}
        integrationStatus={integrationStatus}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Sandbox Claude execute' }));

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        claudeExecuteSandboxEnabled: false,
        agentRunModes: expect.objectContaining({
          claude: expect.objectContaining({ execute: 'interactive' }),
        }),
      }),
    );
  });

  it('labels PRD rewrite settings as shared format settings', () => {
    render(
      <PipelineSettingsSection
        settings={DEFAULT_SETTINGS}
        integrationStatus={integrationStatus}
        onUpdate={vi.fn()}
      />,
    );

    const modelsTab = screen.getByRole('tab', { name: 'Models' });
    fireEvent.mouseDown(modelsTab, { button: 0 });
    fireEvent.click(modelsTab);

    expect(screen.getByText('Format CLI')).toBeInTheDocument();
    expect(
      screen.getByText(/Powers Format in the PRD editor and automation prompt formatter/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Format model')).toBeInTheDocument();
    expect(screen.getAllByText(/PRD and automation prompt formatting/i).length).toBeGreaterThan(0);
    expect(
      screen.getByText('OpenRouter Defaults').closest('[data-slot="settings-section"]'),
    ).not.toHaveClass('rounded-md');
    expect(
      screen.getByText('Issue triage').closest('[data-slot="settings-section"]'),
    ).not.toHaveClass('rounded-md');
  }, 15_000);

  it('applies a model preset as a single settings patch', () => {
    const onUpdate = vi.fn();
    const settings: AppSettings = { ...DEFAULT_SETTINGS };

    render(
      <PipelineSettingsSection
        settings={settings}
        integrationStatus={integrationStatus}
        onUpdate={onUpdate}
      />,
    );

    const modelsTab = screen.getByRole('tab', { name: 'Models' });
    fireEvent.mouseDown(modelsTab, { button: 0 });
    fireEvent.click(modelsTab);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Apply Preset' }));
    fireEvent.click(screen.getByText('Codex'));

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        plannerModel: 'codex',
        reviewerModel: 'codex',
        executorModel: 'codex',
        verifierModel: 'codex',
        plannerReasoningEffort: 'xhigh',
        reviewerReasoningEffort: 'high',
        executorReasoningEffort: 'high',
        verifierReasoningEffort: 'high',
        prdRewriteCli: 'codex',
        prdRewriteCodexModel: 'gpt-5.6-luna',
      }),
    );
  }, 15_000);

  it('updates CPU task guard settings from runtime controls', () => {
    const onUpdate = vi.fn();

    render(
      <PipelineSettingsSection
        settings={DEFAULT_SETTINGS}
        integrationStatus={integrationStatus}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.change(screen.getByLabelText('Max concurrent CPU tasks'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByLabelText('CPU throttle threshold'), {
      target: { value: '90' },
    });

    expect(onUpdate).toHaveBeenCalledWith({ maxConcurrentCpuTasks: 2 });
    expect(onUpdate).toHaveBeenCalledWith({ cpuThrottleThresholdPercent: 90 });
  });

  it('shows Gemini in global phase provider controls', () => {
    render(
      <PipelineSettingsSection
        settings={DEFAULT_SETTINGS}
        integrationStatus={integrationStatus}
        onUpdate={vi.fn()}
      />,
    );

    const modelsTab = screen.getByRole('tab', { name: 'Models' });
    fireEvent.mouseDown(modelsTab, { button: 0 });
    fireEvent.click(modelsTab);
    expect(PIPELINE_EXECUTOR_PROVIDERS).toContain('gemini');
    expect(screen.getByText('Pipeline phases')).toBeInTheDocument();
  });
});
