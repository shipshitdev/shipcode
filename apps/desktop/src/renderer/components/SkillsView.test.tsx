// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import { SkillsView } from './SkillsView';

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SkillsView />
    </QueryClientProvider>,
  );
}

function makeSkillList(content = '---\nname: planner\n---\n{{repo_context}}') {
  return [
    {
      phase: 'plan-generation',
      requiredSlots: ['repo_context'],
      bundledVersion: '1',
      bundledSchemaVersion: 1,
      projectRow: null,
      globalRow: {
        phase: 'plan-generation',
        projectId: null,
        source: 'default',
        content,
        baseVersion: '1',
        schemaVersion: 1,
        bundledVersion: '1',
        bundledSchemaVersion: 1,
        requiredSlots: ['repo_context'],
        status: 'ok',
        statusReason: null,
        updatedAt: null,
      },
      active: {
        phase: 'plan-generation',
        projectId: null,
        source: 'default',
        content,
        baseVersion: '1',
        schemaVersion: 1,
        bundledVersion: '1',
        bundledSchemaVersion: 1,
        requiredSlots: ['repo_context'],
        status: 'ok',
        statusReason: null,
        updatedAt: null,
      },
    },
  ];
}

describe('SkillsView', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    window.shipcode = {
      invoke: invokeMock as unknown as typeof window.shipcode.invoke,
      on: vi.fn(() => () => {}) as unknown as typeof window.shipcode.on,
    };

    useAppStore.setState({
      activeProjectId: 'project-1',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('surfaces writing-prds as a read-only repo skill entry', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'skills:list-for-view') {
        return makeSkillList();
      }

      if (channel === 'skills:get-writing-prds-info') {
        return {
          projectId: 'project-1',
          projectPath: '/repo',
          absolutePath: '/repo/.agents/skills/writing-prds/SKILL.md',
          exists: true,
          usingFallback: false,
          openTargetPath: '/repo/.agents/skills/writing-prds/SKILL.md',
        };
      }

      if (channel === 'skills:open-writing-prds') return undefined;

      throw new Error(`Unexpected channel: ${channel}`);
    });

    renderWithProviders();

    expect(await screen.findByText('PRD Skill')).toBeInTheDocument();
    expect(screen.getByText('writing-prds')).toBeInTheDocument();
    expect(screen.getByText('Repo file')).toBeInTheDocument();
    expect(screen.getByText('Present')).toBeInTheDocument();
    expect(screen.getByText('/repo/.agents/skills/writing-prds/SKILL.md')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open in system editor' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('skills:open-writing-prds', {
        projectId: 'project-1',
      });
    });
  });

  it('rewrites the selected skill into the editor draft without saving', async () => {
    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'skills:list-for-view') return makeSkillList();

      if (channel === 'skills:get-writing-prds-info') {
        return {
          projectId: 'project-1',
          projectPath: '/repo',
          absolutePath: '/repo/skills/writing-prds/SKILL.md',
          exists: true,
          usingFallback: false,
          openTargetPath: '/repo/skills/writing-prds/SKILL.md',
        };
      }

      if (channel === 'skills:rewrite') {
        expect(args).toMatchObject({
          projectId: null,
          contextProjectId: 'project-1',
          phase: 'plan-generation',
          instruction: 'match our Review column workflow',
        });
        return {
          content:
            '---\nname: planner\n---\nUse the Review column workflow while preserving {{repo_context}}.',
        };
      }

      throw new Error(`Unexpected channel: ${channel}`);
    });

    renderWithProviders();

    fireEvent.change(await screen.findByLabelText('Rewrite instructions'), {
      target: { value: 'match our Review column workflow' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Rewrite draft/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Skill content')).toHaveValue(
        '---\nname: planner\n---\nUse the Review column workflow while preserving {{repo_context}}.',
      );
    });
    expect(invokeMock).not.toHaveBeenCalledWith('skills:write', expect.anything());
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });
});
