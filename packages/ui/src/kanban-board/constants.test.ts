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
});
