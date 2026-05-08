// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import type { AppSettings } from '@shipcode/shared';
import { DEFAULT_SETTINGS } from '@shipcode/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectSettingsPipelineTab } from './ProjectSettingsPipelineTab';
import type { ProjectOverrideState } from './shared';

vi.mock('@shipshitdev/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shipshitdev/ui')>();

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
        {['__inherit__', 'smart_fast', 'thorough', 'true', 'false', '0', '5'].map((next) => (
          <button
            key={next}
            type="button"
            data-testid={`select-${next}`}
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
    SelectValue: () => <span />,
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

function renderPipelineTab(setOverrides: ReturnType<typeof vi.fn>, overrides = baseOverrides) {
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    pipelineSpeedProfile: 'smart_fast',
    requireApproval: true,
    revisionCount: 2,
  };

  return render(
    <ProjectSettingsPipelineTab
      settings={settings}
      overrides={overrides}
      setOverrides={setOverrides as never}
      onResetIssueOverrides={vi.fn()}
      issueOverrideResetPending={false}
      issueOverrideResetResult={null}
      issueOverrideResetError={null}
    />,
  );
}

function applyLastUpdate(setOverrides: ReturnType<typeof vi.fn>, state = baseOverrides) {
  const updater = setOverrides.mock.calls.at(-1)?.[0];
  if (typeof updater !== 'function') throw new Error('Expected setOverrides updater');
  return updater(state) as ProjectOverrideState;
}

describe('ProjectSettingsPipelineTab select overrides', () => {
  afterEach(() => {
    cleanup();
  });

  it('updates speed, approval, quality gate, and revision overrides', () => {
    const setOverrides = vi.fn();
    renderPipelineTab(setOverrides);

    fireEvent.click(screen.getAllByTestId('select-thorough')[0]);
    expect(applyLastUpdate(setOverrides)).toMatchObject({
      pipelineSpeedProfileOverride: 'thorough',
    });

    fireEvent.click(screen.getAllByTestId('select-__inherit__')[0]);
    expect(
      applyLastUpdate(setOverrides, { ...baseOverrides, pipelineSpeedProfileOverride: 'thorough' }),
    ).toMatchObject({
      pipelineSpeedProfileOverride: null,
    });

    fireEvent.click(screen.getAllByTestId('select-false')[1]);
    expect(applyLastUpdate(setOverrides)).toMatchObject({ requireApprovalOverride: false });

    fireEvent.click(screen.getAllByTestId('select-true')[2]);
    expect(applyLastUpdate(setOverrides)).toMatchObject({ prdQualityGate: true });

    fireEvent.click(screen.getAllByTestId('select-5')[3]);
    expect(applyLastUpdate(setOverrides)).toMatchObject({ revisionCountOverride: 5 });

    fireEvent.click(screen.getAllByTestId('select-__inherit__')[3]);
    expect(
      applyLastUpdate(setOverrides, { ...baseOverrides, revisionCountOverride: 5 }),
    ).toMatchObject({
      revisionCountOverride: null,
    });
  });
});
