import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

describe('SkillsView', () => {
  const invokeMock = vi.fn<(channel: string, args?: unknown) => Promise<unknown>>();

  beforeEach(() => {
    cleanup();
    invokeMock.mockReset();
    window.shipcode.invoke = invokeMock as unknown as typeof window.shipcode.invoke;

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
              content: '---\nname: planner\n---\n{{repo_context}}',
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
              content: '---\nname: planner\n---\n{{repo_context}}',
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

    expect(await screen.findByText('Other Skills')).toBeInTheDocument();
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
});
