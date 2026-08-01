// @vitest-environment jsdom

import { DEFAULT_SETTINGS, type TelemetryStatus } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeneralSettingsSection } from './GeneralSettingsSection';

vi.mock('@shipcode/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipcode/ui')>();
  const selectValues = ['system', 'dark', 'light', 'dm-sans', 'serif', '12', '13', '14', '15'];

  return {
    ...actual,
    SettingsSelectRow: ({
      label,
      description,
      options,
      onValueChange,
      value,
    }: {
      label: string;
      description?: string;
      options: readonly { value: string; label: string }[];
      onValueChange: (value: string) => void;
      value: string;
    }) => (
      <div data-select-value={value}>
        <span>{label}</span>
        {description ? <span>{description}</span> : null}
        {options.map((option) => (
          <div key={option.value}>{option.label}</div>
        ))}
        {selectValues.map((next) => (
          <button key={next} type="button" onClick={() => onValueChange(next)}>
            {next}
          </button>
        ))}
      </div>
    ),
  };
});

afterEach(() => {
  cleanup();
});

function renderGeneral({
  telemetryStatus,
  settings = DEFAULT_SETTINGS,
  launchAtLoginSupported = false,
  worktreeRootError = null,
}: {
  telemetryStatus?: TelemetryStatus;
  settings?: typeof DEFAULT_SETTINGS;
  launchAtLoginSupported?: boolean;
  worktreeRootError?: string | null;
} = {}) {
  const onUpdate = vi.fn();
  const onUpdateWorktreeRoot = vi.fn();

  render(
    <GeneralSettingsSection
      settings={settings}
      telemetryStatus={telemetryStatus}
      launchAtLoginSupported={launchAtLoginSupported}
      worktreeRootError={worktreeRootError}
      onUpdate={onUpdate}
      onUpdateWorktreeRoot={onUpdateWorktreeRoot}
    />,
  );

  return { onUpdate, onUpdateWorktreeRoot };
}

function makeTelemetryStatus(overrides: Partial<TelemetryStatus> = {}): TelemetryStatus {
  return {
    enabled: true,
    initialized: true,
    envDisabled: false,
    dsnConfigured: true,
    pendingConsent: false,
    disabledReason: null,
    ...overrides,
  };
}

describe('GeneralSettingsSection', () => {
  it('updates launch at login only on supported platforms', () => {
    const { onUpdate } = renderGeneral({ launchAtLoginSupported: true });

    fireEvent.click(screen.getByRole('switch', { name: 'Launch ShipCode at login' }));
    expect(onUpdate).toHaveBeenCalledWith({ launchAtLogin: true });

    cleanup();
    renderGeneral({ launchAtLoginSupported: false });
    expect(screen.queryByRole('switch', { name: 'Launch ShipCode at login' })).toBeNull();
    expect(screen.getByText(/available in packaged macOS builds only/i)).toBeInTheDocument();
  });

  it('updates appearance controls through settings patches', () => {
    const { onUpdate } = renderGeneral();

    fireEvent.click(screen.getAllByRole('button', { name: 'dark' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'serif' })[1]);
    fireEvent.click(screen.getAllByRole('button', { name: '15' })[2]);

    expect(onUpdate).toHaveBeenCalledWith({ theme: 'dark' });
    expect(onUpdate).toHaveBeenCalledWith({ fontStyle: 'serif' });
    expect(onUpdate).toHaveBeenCalledWith({ fontSize: 15 });
  });

  it('disables telemetry when the environment disables reporting', () => {
    const { onUpdate } = renderGeneral({
      telemetryStatus: makeTelemetryStatus({
        enabled: false,
        dsnConfigured: true,
        envDisabled: true,
        initialized: false,
        disabledReason: 'disabled-by-env',
      }),
      settings: { ...DEFAULT_SETTINGS, telemetryEnabled: true },
    });

    expect(screen.getByText(/disabled by SHIPCODE_TELEMETRY_ENABLED=false/i)).toBeInTheDocument();
    expect(screen.getByText(/Current state:\s*disabled by environment/i)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Send anonymous error reports' })).toBeDisabled();

    fireEvent.click(screen.getByRole('switch', { name: 'Send anonymous error reports' }));
    expect(onUpdate).not.toHaveBeenCalledWith({ telemetryEnabled: expect.any(Boolean) });
  });

  it('renders telemetry consent states for missing DSN, enabled, disabled, and waiting', () => {
    const missingDsnStatus = makeTelemetryStatus({
      enabled: true,
      dsnConfigured: false,
      initialized: false,
      disabledReason: 'missing-dsn',
    });

    const { rerender } = render(
      <GeneralSettingsSection
        settings={{ ...DEFAULT_SETTINGS, telemetryEnabled: true }}
        telemetryStatus={missingDsnStatus}
        worktreeRootError={null}
        onUpdate={vi.fn()}
        onUpdateWorktreeRoot={vi.fn()}
      />,
    );

    expect(screen.getByText(/allowed, but no Sentry DSN is configured/i)).toBeInTheDocument();

    rerender(
      <GeneralSettingsSection
        settings={{ ...DEFAULT_SETTINGS, telemetryEnabled: true }}
        telemetryStatus={{ ...missingDsnStatus, dsnConfigured: true }}
        worktreeRootError={null}
        onUpdate={vi.fn()}
        onUpdateWorktreeRoot={vi.fn()}
      />,
    );
    expect(screen.getByText(/Current state:\s*enabled/i)).toBeInTheDocument();

    rerender(
      <GeneralSettingsSection
        settings={{ ...DEFAULT_SETTINGS, telemetryEnabled: false }}
        telemetryStatus={{ ...missingDsnStatus, dsnConfigured: true }}
        worktreeRootError={null}
        onUpdate={vi.fn()}
        onUpdateWorktreeRoot={vi.fn()}
      />,
    );
    expect(screen.getByText(/Current state:\s*disabled/i)).toBeInTheDocument();

    rerender(
      <GeneralSettingsSection
        settings={{ ...DEFAULT_SETTINGS, telemetryEnabled: null }}
        telemetryStatus={{ ...missingDsnStatus, dsnConfigured: true }}
        worktreeRootError={null}
        onUpdate={vi.fn()}
        onUpdateWorktreeRoot={vi.fn()}
      />,
    );
    expect(screen.getByText(/Current state:\s*waiting for consent/i)).toBeInTheDocument();
  });

  it('normalizes worktree, branch, add-project, and setup updates', () => {
    const { onUpdate, onUpdateWorktreeRoot } = renderGeneral({
      settings: {
        ...DEFAULT_SETTINGS,
        worktreeRoot: '/tmp/shipcode',
        worktreeBranchFormat: 'shipcode/{id}-{slug}',
        addProjectStartsIn: '~/code',
      },
      worktreeRootError: 'Relative paths are rejected.',
    });

    expect(screen.getByText('Relative paths are rejected.')).toBeInTheDocument();

    fireEvent.blur(screen.getByLabelText('Worktree root'), { target: { value: '   ' } });
    expect(onUpdateWorktreeRoot).toHaveBeenCalledWith(null);

    fireEvent.blur(screen.getByLabelText('Worktree root'), {
      target: { value: '  ~/worktrees  ' },
    });
    expect(onUpdateWorktreeRoot).toHaveBeenCalledWith('~/worktrees');

    fireEvent.blur(screen.getByLabelText('Branch format'), { target: { value: '   ' } });
    expect(onUpdate).toHaveBeenCalledWith({
      worktreeBranchFormat: DEFAULT_SETTINGS.worktreeBranchFormat,
    });

    fireEvent.blur(screen.getByLabelText('Branch format'), {
      target: { value: '  ai/{id}-{slug}  ' },
    });
    expect(onUpdate).toHaveBeenCalledWith({ worktreeBranchFormat: 'ai/{id}-{slug}' });

    fireEvent.blur(screen.getByLabelText('Start browsing in'), { target: { value: '   ' } });
    expect(onUpdate).toHaveBeenCalledWith({ addProjectStartsIn: null });

    fireEvent.blur(screen.getByLabelText('Start browsing in'), {
      target: { value: '  ~/src  ' },
    });
    expect(onUpdate).toHaveBeenCalledWith({ addProjectStartsIn: '~/src' });

    fireEvent.click(screen.getByRole('button', { name: 'Re-run Setup' }));
    expect(onUpdate).toHaveBeenCalledWith({ onboardingVersion: 0 });
  });
});
