import { describe, expect, it } from 'vitest';
import { ACTIVE_STATUSES, COLUMNS, PHASE_ELAPSED_STATUSES } from './constants';

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

  it('only shows elapsed timers for agent-loop phases', () => {
    expect(PHASE_ELAPSED_STATUSES).toEqual(ACTIVE_STATUSES);
    expect(PHASE_ELAPSED_STATUSES).not.toContain('awaiting_approval');
    expect(PHASE_ELAPSED_STATUSES).not.toContain('clarifying');
  });
});
