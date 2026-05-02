// @vitest-environment jsdom

import type { DiffRecord } from '@shipcode/shared';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DiffTab } from './DiffTab';

const diffs: DiffRecord[] = [
  {
    id: 'diff-1',
    threadId: 'thread-1',
    filePath: 'src/foo.ts',
    action: 'modify',
    diffContent:
      'diff --git a/src/foo.ts b/src/foo.ts\n@@ -1,2 +1,2 @@\n const stable = true;\n-console.log("old");\n+console.log("new");',
    beforeHash: '1111111',
    afterHash: '2222222',
    createdAt: new Date('2026-04-21T00:00:00.000Z').toISOString(),
  },
  {
    id: 'diff-2',
    threadId: 'thread-1',
    filePath: 'src/bar.ts',
    action: 'create',
    diffContent: '',
    beforeHash: null,
    afterHash: '3333333',
    createdAt: new Date('2026-04-21T00:00:01.000Z').toISOString(),
  },
];

afterEach(() => {
  cleanup();
});

describe('DiffTab', () => {
  it('shows the empty state before any diff exists', () => {
    render(<DiffTab diffs={[]} />);

    expect(screen.getByText('No code changes yet')).toBeInTheDocument();
    expect(
      screen.getByText('Diff will appear here after execution produces changes.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Full screen diff' })).not.toBeInTheDocument();
  });

  it('renders the inline viewer and opens and closes the fullscreen modal', async () => {
    render(<DiffTab diffs={diffs} />);

    expect(screen.getByText('Code Changes')).toBeInTheDocument();
    expect(screen.getByText('2 files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'src/foo.ts' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Full screen diff' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Code Changes')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'src/foo.ts' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'src/bar.ts' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
