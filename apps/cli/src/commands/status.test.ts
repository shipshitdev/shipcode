import { beforeEach, describe, expect, it, vi } from 'vitest';

const { existsSyncMock, getDatabaseMock, listProjectsMock, listThreadsMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  getDatabaseMock: vi.fn(),
  listProjectsMock: vi.fn(),
  listThreadsMock: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: existsSyncMock,
  },
}));

vi.mock('@shipcode/db', () => ({
  getDatabase: getDatabaseMock,
  ProjectQueries: class {
    list = listProjectsMock;
  },
  ThreadQueries: class {
    list = listThreadsMock;
  },
}));

import { statusCommand } from './status';

describe('statusCommand', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    getDatabaseMock.mockReturnValue({});
  });

  it('tells the user when the database does not exist yet', async () => {
    existsSyncMock.mockReturnValueOnce(false);

    await statusCommand();

    expect(logSpy).toHaveBeenCalledWith('No ShipCode database found. Run a pipeline first.');
    expect(getDatabaseMock).not.toHaveBeenCalled();
  });

  it('reports when no projects are registered', async () => {
    existsSyncMock.mockReturnValueOnce(true);
    listProjectsMock.mockReturnValueOnce([]);

    await statusCommand();

    expect(getDatabaseMock).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('No projects registered.');
  });

  it('prints active threads when a project has work in progress', async () => {
    existsSyncMock.mockReturnValueOnce(true);
    listProjectsMock.mockReturnValueOnce([
      {
        id: 'project-1',
        name: 'ShipCode',
        path: '/tmp/shipcode',
      },
    ]);
    listThreadsMock.mockReturnValueOnce([
      { status: 'planning', title: 'Add coverage floor' },
      { status: 'completed', title: 'Ship token formatter' },
    ]);

    await statusCommand();

    expect(logSpy).toHaveBeenCalledWith('\nShipCode (/tmp/shipcode)');
    expect(logSpy).toHaveBeenCalledWith('  Active:');
    expect(logSpy).toHaveBeenCalledWith('    [planning] Add coverage floor');
    expect(logSpy).not.toHaveBeenCalledWith('  Recent:');
  });

  it('prints recent threads when there is no active work', async () => {
    existsSyncMock.mockReturnValueOnce(true);
    listProjectsMock.mockReturnValueOnce([
      {
        id: 'project-1',
        name: 'ShipCode',
        path: '/tmp/shipcode',
      },
    ]);
    listThreadsMock.mockReturnValueOnce([
      { status: 'completed', title: 'Ship token formatter' },
      { status: 'failed', title: 'Retry pipeline flow' },
    ]);

    await statusCommand();

    expect(logSpy).toHaveBeenCalledWith('  Recent:');
    expect(logSpy).toHaveBeenCalledWith('    [completed] Ship token formatter');
    expect(logSpy).toHaveBeenCalledWith('    [failed] Retry pipeline flow');
  });
});
