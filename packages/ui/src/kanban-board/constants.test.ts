import { describe, expect, it } from 'vitest';
import { GH_STATUS_OPTION_NAME } from '@/lib/shipcode';
import { ACTIVE_STATUSES, COLUMNS, LIST_COLUMN_LABEL, PHASE_ELAPSED_STATUSES } from './constants';

describe('kanban board phase constants', () => {
  it('includes testing in the agent loop column and section list', () => {
    const agentColumn = COLUMNS.find((column) => column.key === 'agent');

    expect(agentColumn).toBeDefined();
    expect(agentColumn?.statuses).toContain('testing');

    const testingSection = agentColumn?.sections?.find((section) => section.key === 'testing');
    expect(testingSection).toEqual({
      key: 'testing',
      label: 'Testing',
      statuses: ['testing'],
      droppable: false,
    });
  });

  it('treats testing as an active elapsed phase', () => {
    expect(ACTIVE_STATUSES).toContain('testing');
    expect(PHASE_ELAPSED_STATUSES).toContain('testing');
  });

  it('groups PR review statuses under the attention column', () => {
    const humanColumn = COLUMNS.find((column) => column.key === 'human');

    expect(humanColumn?.statuses).toEqual(
      expect.arrayContaining(['needs_review', 'ready_to_merge']),
    );
    expect(humanColumn?.sections).toContainEqual({
      key: 'pr_review',
      label: 'PR Review',
      statuses: ['needs_review', 'ready_to_merge'],
      droppable: false,
    });
  });

  it('only shows elapsed timers for agent-loop phases', () => {
    expect(PHASE_ELAPSED_STATUSES).toEqual(ACTIVE_STATUSES);
    expect(PHASE_ELAPSED_STATUSES).not.toContain('approval');
    expect(PHASE_ELAPSED_STATUSES).not.toContain('clarifying');
  });

  it('derives the todo column label from the shared GH Status option name', () => {
    // Guards the DRY link: renaming the GH "Backlog" status option in
    // @shipcode/shared must propagate to the board without a stray literal here.
    const todoColumn = COLUMNS.find((column) => column.key === 'todo');

    expect(todoColumn?.label).toBe(GH_STATUS_OPTION_NAME.todo);
    expect(LIST_COLUMN_LABEL.todo).toBe(GH_STATUS_OPTION_NAME.todo);
  });
});
