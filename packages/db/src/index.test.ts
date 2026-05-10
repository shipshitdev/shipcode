import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase } from './index';

describe('database singleton lifecycle', () => {
  let dataDir: string | null = null;

  afterEach(() => {
    closeDatabase();
    if (dataDir) {
      rmSync(dataDir, { force: true, recursive: true });
      dataDir = null;
    }
  });

  it('reuses the open database and tolerates duplicate close calls', () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'shipcode-db-'));

    const first = getDatabase(dataDir);
    const second = getDatabase(dataDir);

    expect(second).toBe(first);
    closeDatabase();
    closeDatabase();
  });
});
