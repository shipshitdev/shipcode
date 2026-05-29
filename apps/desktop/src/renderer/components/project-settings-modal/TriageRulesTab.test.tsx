// @vitest-environment jsdom

import type { TriageRule, TriageRuleDraft } from '@shipcode/shared';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQueryClient } from '../../test/render';
import { TriageRulesTab } from './TriageRulesTab';

vi.mock('electron-log/renderer', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function fullRule(over: Partial<TriageRule> & { id: string; name: string }): TriageRule {
  return {
    id: over.id,
    projectId: over.projectId ?? 'project-1',
    orderIndex: over.orderIndex ?? 0,
    name: over.name,
    enabled: over.enabled ?? true,
    conditions: over.conditions ?? {
      operator: 'all',
      items: [{ kind: 'title_contains', value: 'bug' }],
    },
    actions: over.actions ?? { addLabels: [], removeLabels: [] },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('TriageRulesTab', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();
  let listResponse: TriageRule[];

  beforeEach(() => {
    invokeMock.mockReset();
    listResponse = [];
    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'project:list-triage-rules') return listResponse;
      if (channel === 'project:replace-triage-rules') {
        const posted = (args as { rules: TriageRuleDraft[] }).rules;
        return posted.map((draft, index) =>
          fullRule({
            id: draft.id ?? `new-${index}`,
            name: draft.name,
            enabled: draft.enabled,
            orderIndex: index,
            conditions: draft.conditions,
            actions: draft.actions,
          }),
        );
      }
      return null;
    });
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;
  });

  afterEach(() => {
    cleanup();
  });

  function render() {
    return renderWithQueryClient(<TriageRulesTab projectId="project-1" isActive />);
  }

  it('shows a loading state until rules resolve', async () => {
    let resolveList: (rules: TriageRule[]) => void = () => {};
    invokeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve as (rules: TriageRule[]) => void;
        }),
    );
    render();
    expect(screen.getByText('Loading triage rules…')).toBeInTheDocument();
    resolveList([]);
    await waitFor(() => expect(screen.getByText(/No triage rules configured/)).toBeInTheDocument());
  });

  it('renders existing rules and keeps Save disabled until edited', async () => {
    listResponse = [fullRule({ id: 'r1', name: 'Bug rule' })];
    render();
    await screen.findByDisplayValue('Bug rule');
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('adds a rule and saves the normalized draft payload', async () => {
    listResponse = [];
    render();
    await screen.findByText(/No triage rules configured/);

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByDisplayValue('New rule');

    const saveButton = screen.getByRole('button', { name: /save/i });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'project:replace-triage-rules',
        expect.objectContaining({
          projectId: 'project-1',
          rules: expect.arrayContaining([expect.objectContaining({ name: 'New rule' })]),
        }),
      ),
    );
  });

  it('reorders rules and persists the new order', async () => {
    listResponse = [
      fullRule({ id: 'a', name: 'Alpha', orderIndex: 0 }),
      fullRule({ id: 'b', name: 'Beta', orderIndex: 1 }),
    ];
    render();
    await screen.findByDisplayValue('Alpha');

    fireEvent.click(screen.getAllByRole('button', { name: 'Move rule down' })[0]);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const call = invokeMock.mock.calls.find((c) => c[0] === 'project:replace-triage-rules');
      expect(call).toBeDefined();
      const posted = (call?.[1] as { rules: TriageRuleDraft[] }).rules;
      expect(posted.map((r) => r.name)).toEqual(['Beta', 'Alpha']);
    });
  });

  it('removes a condition from a rule', async () => {
    listResponse = [
      fullRule({
        id: 'r1',
        name: 'Multi',
        conditions: {
          operator: 'all',
          items: [
            { kind: 'title_contains', value: 'bug' },
            { kind: 'label_includes', value: 'urgent' },
          ],
        },
      }),
    ];
    render();
    await screen.findByDisplayValue('Multi');

    expect(screen.getAllByRole('button', { name: 'Delete condition' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete condition' })[0]);

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Delete condition' })).toHaveLength(1),
    );
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();
  });

  it('deletes a rule and persists the remaining rules', async () => {
    listResponse = [
      fullRule({ id: 'a', name: 'Alpha', orderIndex: 0 }),
      fullRule({ id: 'b', name: 'Beta', orderIndex: 1 }),
    ];
    render();
    await screen.findByDisplayValue('Alpha');

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete rule' })[0]);
    await waitFor(() => expect(screen.queryByDisplayValue('Alpha')).not.toBeInTheDocument());
    expect(screen.getByDisplayValue('Beta')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      const call = invokeMock.mock.calls.find((c) => c[0] === 'project:replace-triage-rules');
      const posted = (call?.[1] as { rules: TriageRuleDraft[] }).rules;
      expect(posted.map((r) => r.name)).toEqual(['Beta']);
    });
  });

  // Rendering 50 rule cards (each with multiple selects/inputs) is inherently
  // heavy in jsdom; give it headroom beyond the 5s default.
  it('disables Add and warns once the rule limit is reached', async () => {
    listResponse = Array.from({ length: 50 }, (_, i) =>
      fullRule({ id: `r${i}`, name: `Rule ${i}`, orderIndex: i }),
    );
    render();
    await screen.findByText(/maximum 50 triage rules/i);
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  }, 15000);
});
