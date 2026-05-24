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

  it('returns repo graph prompt material when code-review-graph status exists', () => {
    vi.mocked(execFileSync)
      .mockReturnValueOnce('Nodes: 10\nEdges: 20\nFiles: 3\n')
      .mockReturnValueOnce('Changed files: 2\nHigh impact nodes: 1\n');

    const materials = loadCodeReviewGraphContext('/repo');

    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      'code-review-graph',
      ['status', '--repo', '/repo'],
      expect.objectContaining({ timeout: 4000 }),
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      'code-review-graph',
      ['detect-changes', '--brief', '--repo', '/repo'],
      expect.objectContaining({ timeout: 4000 }),
    );
    expect(materials).toEqual([
      expect.objectContaining({
        kind: 'repo_graph_context',
        label: 'code-review-graph/status',
        content: expect.stringContaining('Nodes: 10'),
      }),
    ]);
    expect(materials[0]?.content).toContain('Changed files: 2');
  });

  it('keeps status context when change impact lookup fails', () => {
    vi.mocked(execFileSync).mockImplementation((_, args) => {
      if (Array.isArray(args) && args.includes('detect-changes')) {
        throw new Error('no diff base');
      }
      return 'Nodes: 10\nEdges: 20\nFiles: 3\n';
    });

    const materials = loadCodeReviewGraphContext('/repo');

    expect(materials).toHaveLength(1);
    expect(materials[0]?.content).toContain('Nodes: 10');
    expect(materials[0]?.content).not.toContain('Current change impact');
  });

  it('can skip change impact and pass custom timeout/base options', () => {
    vi.mocked(execFileSync).mockReturnValueOnce('Nodes: 10\n');

    const materials = loadCodeReviewGraphContext('/repo', {
      timeoutMs: 123,
      includeChangeImpact: false,
      changeBase: 'main',
    });

    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith(
      'code-review-graph',
      ['status', '--repo', '/repo'],
      expect.objectContaining({ timeout: 123 }),
    );
    expect(materials[0]?.content).not.toContain('Current change impact');
  });

  it('adds custom change bases and truncates long graph output', () => {
    vi.mocked(execFileSync)
      .mockReturnValueOnce(`${'s'.repeat(2100)}\n`)
      .mockReturnValueOnce(`${'i'.repeat(2100)}\n`);

    const materials = loadCodeReviewGraphContext('/repo', { changeBase: 'origin/main' });

    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      'code-review-graph',
      ['detect-changes', '--brief', '--repo', '/repo', '--base', 'origin/main'],
      expect.any(Object),
    );
    expect(materials[0]?.content).toContain('... truncated ...');
  });

  it('treats empty graph output as unavailable', () => {
    vi.mocked(execFileSync).mockReturnValue('');

    expect(loadCodeReviewGraphContext('/repo')).toEqual([]);
  });

  it('silently skips projects without an available graph', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('missing graph');
    });

    expect(loadCodeReviewGraphContext('/repo')).toEqual([]);
  });
});
