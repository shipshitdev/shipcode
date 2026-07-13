import { describe, expect, it, vi } from 'vitest';
import { resolveDefaultBranch } from './default-branch';

describe('resolveDefaultBranch', () => {
  it.each([
    {
      name: 'origin HEAD before every local branch',
      originHead: 'origin/develop\n',
      branches: { all: ['main', 'master', 'feature/test'], current: 'feature/test' },
      expected: 'develop',
    },
    {
      name: 'main before master and the current branch',
      originHead: null,
      branches: { all: ['main', 'master', 'feature/test'], current: 'feature/test' },
      expected: 'main',
    },
    {
      name: 'master before the current branch',
      originHead: null,
      branches: { all: ['master', 'feature/test'], current: 'feature/test' },
      expected: 'master',
    },
    {
      name: 'the current branch when no conventional default exists',
      originHead: null,
      branches: { all: ['feature/test'], current: 'feature/test' },
      expected: 'feature/test',
    },
    {
      name: 'main when no branch can be detected',
      originHead: null,
      branches: { all: [], current: '' },
      expected: 'main',
    },
  ])('$name', async ({ originHead, branches, expected }) => {
    const git = {
      raw: originHead
        ? vi.fn().mockResolvedValue(originHead)
        : vi.fn().mockRejectedValue(new Error('origin/HEAD missing')),
      branchLocal: vi.fn().mockResolvedValue(branches),
    };

    await expect(resolveDefaultBranch(git)).resolves.toBe(expected);
  });
});
