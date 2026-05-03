// @vitest-environment jsdom

import type { AppSettings, IntegrationStatus } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
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
        executorReasoningEffort: 'medium',
        verifierReasoningEffort: 'high',
        prdRewriteCli: 'codex',
        prdRewriteCodexModel: 'gpt-5.4-mini',
      }),
    );
  });
});
