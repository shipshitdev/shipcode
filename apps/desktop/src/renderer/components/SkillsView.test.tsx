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

function mockWritingPrdsInfo(channel: string) {
  if (channel !== 'skills:get-writing-prds-info') return undefined;
  return {
    projectId: 'project-1',
    projectPath: '/repo',
    absolutePath: '/repo/skills/writing-prds/SKILL.md',
    exists: true,
    usingFallback: false,
    openTargetPath: '/repo/skills/writing-prds/SKILL.md',
  };
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

  it('validates skill content before saving and surfaces main-process validation errors', async () => {
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'skills:list-for-view') return makeSkillList();
      const writingPrdsInfo = mockWritingPrdsInfo(channel);
      if (writingPrdsInfo) return writingPrdsInfo;
      if (channel === 'skills:write') {
        return { ok: false, error: { message: 'Main process rejected this skill' } };
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });

    renderWithProviders();

    const editor = await screen.findByLabelText('Skill content');
    fireEvent.change(editor, { target: { value: 'missing frontmatter {{repo_context}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Skill must start with a YAML frontmatter block delimited by ---'),
    ).toBeInTheDocument();

    fireEvent.change(editor, { target: { value: '---\nname: planner\n---\nno slot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Missing required slot: {{repo_context}}')).toBeInTheDocument();

    fireEvent.change(editor, { target: { value: '---\nname: planner\n---\n{{repo_context}}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Main process rejected this skill')).toBeInTheDocument();
  });

  it('saves valid edits and resets non-default overrides', async () => {
    let saved = false;
    invokeMock.mockImplementation(async (channel, args) => {
      if (channel === 'skills:list-for-view') {
        return makeSkillList(
          saved
            ? '---\nname: planner\n---\nSaved {{repo_context}}'
            : '---\nname: planner\n---\nOld {{repo_context}}',
        ).map((entry) => ({
          ...entry,
          globalRow: {
            ...entry.globalRow,
            source: 'global',
          },
        }));
      }
      const writingPrdsInfo = mockWritingPrdsInfo(channel);
      if (writingPrdsInfo) return writingPrdsInfo;
      if (channel === 'skills:write') {
        expect(args).toMatchObject({
          projectId: null,
          phase: 'plan-generation',
          content: '---\nname: planner\n---\nNew {{repo_context}}',
        });
        saved = true;
        return {
          ok: true,
          row: {
            phase: 'plan-generation',
            projectId: null,
            source: 'global',
            content: '---\nname: planner\n---\nSaved {{repo_context}}',
            baseVersion: '1',
            schemaVersion: 1,
            bundledVersion: '1',
            bundledSchemaVersion: 1,
            requiredSlots: ['repo_context'],
            status: 'ok',
            statusReason: null,
            updatedAt: '2026-05-09T00:00:00.000Z',
          },
        };
      }
      if (channel === 'skills:reset') return undefined;
      throw new Error(`Unexpected channel: ${channel}`);
    });

    renderWithProviders();

    const editor = await screen.findByLabelText('Skill content');
    fireEvent.change(editor, {
      target: { value: '---\nname: planner\n---\nNew {{repo_context}}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(editor).toHaveValue('---\nname: planner\n---\nSaved {{repo_context}}');
    });
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset skill to bundled default' }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('skills:reset', {
        projectId: null,
        phase: 'plan-generation',
      });
    });
  });

  it('shows rewrite validation and transport errors without changing the saved skill', async () => {
    invokeMock.mockImplementationOnce(async (channel) => {
      if (channel === 'skills:list-for-view') return makeSkillList();
      const writingPrdsInfo = mockWritingPrdsInfo(channel);
      if (writingPrdsInfo) return writingPrdsInfo;
      throw new Error(`Unexpected channel: ${channel}`);
    });
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'skills:list-for-view') return makeSkillList();
      const writingPrdsInfo = mockWritingPrdsInfo(channel);
      if (writingPrdsInfo) return writingPrdsInfo;
      if (channel === 'skills:rewrite') {
        return { content: 'no frontmatter {{repo_context}}' };
      }
      throw new Error(`Unexpected channel: ${channel}`);
    });

    renderWithProviders();

    fireEvent.change(await screen.findByLabelText('Rewrite instructions'), {
      target: { value: 'break it' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Rewrite draft/i }));
    expect(
      await screen.findAllByText('Skill must start with a YAML frontmatter block delimited by ---'),
    ).toHaveLength(2);

    cleanup();
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'skills:list-for-view') return makeSkillList();
      const writingPrdsInfo = mockWritingPrdsInfo(channel);
      if (writingPrdsInfo) return writingPrdsInfo;
      if (channel === 'skills:rewrite') throw new Error('rewrite unavailable');
      throw new Error(`Unexpected channel: ${channel}`);
    });
    renderWithProviders();

    fireEvent.change(await screen.findByLabelText('Rewrite instructions'), {
      target: { value: 'try again' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Rewrite draft/i }));
    expect(await screen.findByText('rewrite unavailable')).toBeInTheDocument();
  });

  it('shows the PRD skill fallback copy when no project is selected', async () => {
    useAppStore.setState({ activeProjectId: null });
    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'skills:list-for-view') return makeSkillList();
      throw new Error(`Unexpected channel: ${channel}`);
    });

    renderWithProviders();

    expect(await screen.findByText('PRD Skill')).toBeInTheDocument();
    expect(screen.getByText(/Pick a project from the sidebar/)).toBeInTheDocument();
  });

  it('handles phase switching, quarantined rows, plural slot validation, and save errors', async () => {
    const [planner] = makeSkillList('---\nname: planner\n---\nPlanner {{repo_context}}');
    const reviewer = {
      ...planner,
      phase: 'adversarial-review' as const,
      requiredSlots: ['repo_context', 'review_context'],
      globalRow: {
        ...planner.globalRow,
        phase: 'adversarial-review' as const,
        content: '---\nname: reviewer\n---\nReviewer {{repo_context}} {{review_context}}',
        requiredSlots: ['repo_context', 'review_context'],
        status: 'quarantined' as const,
        statusReason: 'Missing frontmatter',
      },
      active: {
        ...planner.active,
        phase: 'adversarial-review' as const,
        content: '---\nname: reviewer\n---\nReviewer {{repo_context}} {{review_context}}',
        requiredSlots: ['repo_context', 'review_context'],
        status: 'quarantined' as const,
        statusReason: 'Missing frontmatter',
      },
    };

    invokeMock.mockImplementation(async (channel) => {
      if (channel === 'skills:list-for-view') return [planner, reviewer];
      const writingPrdsInfo = mockWritingPrdsInfo(channel);
      if (writingPrdsInfo) return writingPrdsInfo;
      if (channel === 'skills:write') throw new Error('disk is full');
      throw new Error(`Unexpected channel: ${channel}`);
    });

    renderWithProviders();

    expect(await screen.findByText('Quarantined skill overrides')).toBeInTheDocument();
    expect(screen.getAllByText('Quarantined').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('(global)')).toBeInTheDocument();
    expect(screen.getByText('Missing frontmatter')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Reviewer/i }));
    expect(await screen.findByDisplayValue(/Reviewer \{\{repo_context\}\}/)).toBeInTheDocument();

    const editor = screen.getByLabelText('Skill content');
    fireEvent.change(editor, { target: { value: '---\nname: reviewer\n---\nReviewer body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Missing required slots: {{repo_context}}, {{review_context}}'),
    ).toBeInTheDocument();

    fireEvent.change(editor, {
      target: { value: '---\nname: reviewer\n---\nReviewer {{repo_context}} {{review_context}}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('disk is full')).toBeInTheDocument();
  });
});
