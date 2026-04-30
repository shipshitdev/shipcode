import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCodeReviewGraphContext } from './code-review-graph-context';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

describe('loadCodeReviewGraphContext', () => {
  beforeEach(() => {
    vi.mocked(execFileSync).mockReset();
  });

  it('returns a plan-only repo graph prompt material when code-review-graph status exists', () => {
    vi.mocked(execFileSync).mockReturnValue('Nodes: 10\nEdges: 20\nFiles: 3\n');

    const materials = loadCodeReviewGraphContext('/repo');

    expect(execFileSync).toHaveBeenCalledWith(
      'uvx',
      ['code-review-graph', 'status', '--repo', '/repo'],
      expect.objectContaining({ timeout: 4000 }),
    );
    expect(materials).toEqual([
      expect.objectContaining({
        kind: 'repo_graph_context',
        label: 'code-review-graph/status',
        content: expect.stringContaining('Nodes: 10'),
      }),
    ]);
  });

  it('silently skips projects without an available graph', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('missing graph');
    });

    expect(loadCodeReviewGraphContext('/repo')).toEqual([]);
  });
});
