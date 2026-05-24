import { afterEach, describe, expect, it, vi } from 'vitest';

const listMemoryFiles = vi.hoisted(() => vi.fn());
const readMemoryFile = vi.hoisted(() => vi.fn());
const generateMemoryFiles = vi.hoisted(() => vi.fn());

vi.mock('./memory-generator', () => ({
  listMemoryFiles,
  readMemoryFile,
  generateMemoryFiles,
}));

import { generateContextFiles, listContextFiles, readContextFile } from './context-generator';

describe('context-generator compatibility wrappers', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('delegates the public context-generator API to memory-generator', async () => {
    const listed = [{ name: 'goal.md', exists: true }];
    const content = '# Goal';
    const generated = { success: true, written: ['goal.md'] };

    listMemoryFiles.mockReturnValueOnce(listed);
    readMemoryFile.mockReturnValueOnce(content);
    generateMemoryFiles.mockResolvedValueOnce(generated);

    expect(listContextFiles('/repo')).toBe(listed);
    expect(listMemoryFiles).toHaveBeenCalledWith('/repo');

    expect(readContextFile('/repo', 'goal.md')).toBe(content);
    expect(readMemoryFile).toHaveBeenCalledWith('/repo', 'goal.md');

    await expect(generateContextFiles('/repo', 'codex')).resolves.toBe(generated);
    expect(generateMemoryFiles).toHaveBeenCalledWith('/repo', 'codex');
  });
});
