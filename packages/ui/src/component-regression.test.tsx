// @vitest-environment jsdom

import type { DiffRecord, GitWorktreeSummary } from '@shipcode/shared';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ActivePipelineCard } from '@/ActivePipelineCard';
import { DiffViewer } from '@/DiffViewer';
import { GitVisualizer } from '@/GitVisualizer';
import { LoadingButtonContent } from '@/LoadingButtonContent';
import { PageHeader } from '@/PageHeader';
import { PhaseChip } from '@/PhaseChip';
import { Button } from '@/primitives/button';
import { SideBySideDiffViewer } from '@/SideBySideDiffViewer';
import { SyntaxHighlightedCode } from '@/SyntaxHighlightedCode';

function renderIntoDom(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return {
    container,
    rerender: (nextElement: ReactElement) => {
      act(() => {
        root.render(nextElement);
      });
    },
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
      document.body.innerHTML = '';
    },
  };
}

const diffRecords: DiffRecord[] = [
  {
    id: 'diff-1',
    threadId: 'thread-1',
    filePath: 'packages/ui/src/DiffViewer.tsx',
    diffContent: '@@ -1,2 +1,2 @@\n-import old\n+import fresh',
    action: 'modify',
    beforeHash: 'before-1',
    afterHash: 'after-1',
    createdAt: new Date('2026-04-16T00:00:00.000Z').toISOString(),
  },
  {
    id: 'diff-2',
    threadId: 'thread-1',
    filePath: 'packages/ui/src/new-file.ts',
    diffContent: '',
    action: 'create',
    beforeHash: null,
    afterHash: 'after-2',
    createdAt: new Date('2026-04-16T00:00:01.000Z').toISOString(),
  },
];

const sideBySideDiffRecords: DiffRecord[] = [
  {
    id: 'side-diff-1',
    threadId: 'thread-1',
    filePath: 'packages/ui/src/SideBySideDiffViewer.tsx',
    diffContent: `diff --git a/packages/ui/src/SideBySideDiffViewer.tsx b/packages/ui/src/SideBySideDiffViewer.tsx
index 1111111..2222222 100644
--- a/packages/ui/src/SideBySideDiffViewer.tsx
+++ b/packages/ui/src/SideBySideDiffViewer.tsx
@@ -1,4 +1,5 @@
 const stable = true;
-before();
-oldOnly();
+after();
+newOnly();
+addedOnly();
 return stable;`,
    action: 'modify',
    beforeHash: 'before-side-1',
    afterHash: 'after-side-1',
    createdAt: new Date('2026-04-21T00:00:00.000Z').toISOString(),
  },
  {
    id: 'side-diff-2',
    threadId: 'thread-1',
    filePath: 'packages/ui/src/empty-file.ts',
    diffContent: '',
    action: 'create',
    beforeHash: null,
    afterHash: 'after-side-2',
    createdAt: new Date('2026-04-21T00:00:01.000Z').toISOString(),
  },
];

const worktrees: GitWorktreeSummary[] = [
  {
    id: 'main:project-1',
    kind: 'main',
    path: '/repo/shipcode',
    branch: 'develop',
    commitHash: '1234567890abcdef',
    isDirty: true,
    untrackedCount: 1,
    stagedCount: 0,
    modifiedCount: 2,
    aheadCount: 1,
    behindCount: 0,
    compareRef: 'origin/develop',
    preCommitHookPath: '/repo/shipcode/.githooks/pre-commit',
    threadId: null,
    issueNumber: null,
    title: null,
    status: null,
  },
  {
    id: 'worktree:/tmp/shipcode/46',
    kind: 'shipcode',
    path: '/tmp/shipcode/46',
    branch: 'ship/46-bootstrap',
    commitHash: 'abcdef1234567890',
    isDirty: false,
    untrackedCount: 0,
    stagedCount: 0,
    modifiedCount: 0,
    aheadCount: 0,
    behindCount: 0,
    compareRef: 'develop',
    preCommitHookPath: null,
    threadId: 'thread-46',
    issueNumber: 46,
    title: 'Bootstrap visualizer',
    status: 'completed',
  },
];

describe('UI component regression coverage', () => {
  it('renders source code immediately and upgrades to highlighted tokens when available', async () => {
    const view = renderIntoDom(
      <SyntaxHighlightedCode code={'{\n  "name": "@shipcode/agents"\n}'} filePath="package.json" />,
    );

    expect(view.container.textContent).toContain('"name": "@shipcode/agents"');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    const coloredTokens = Array.from(view.container.querySelectorAll('span')).filter((span) =>
      span.getAttribute('style')?.includes('color:'),
    );

    if (coloredTokens.length > 0) {
      expect(coloredTokens.some((span) => span.textContent === '"name"')).toBe(true);
      expect(new Set(coloredTokens.map((span) => span.getAttribute('style'))).size).toBeGreaterThan(
        1,
      );
    }

    view.cleanup();
  });

  it('renders diff states, selection, and empty fallback', () => {
    const onFileSelect = vi.fn();
    const view = renderIntoDom(
      <DiffViewer
        diffs={diffRecords}
        activeFile="packages/ui/src/DiffViewer.tsx"
        onFileSelect={onFileSelect}
      />,
    );

    expect(view.container.textContent).toContain('DiffViewer.tsx');
    expect(view.container.textContent).toContain('modify');
    expect(view.container.textContent).toContain('@@ -1,2 +1,2 @@');
    expect(view.container.textContent).toContain('+import fresh');

    const newFileButton = Array.from(view.container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('new-file.ts'),
    );
    if (!(newFileButton instanceof HTMLButtonElement)) {
      throw new Error('Expected new-file tab button');
    }

    act(() => {
      newFileButton.click();
    });

    expect(onFileSelect).toHaveBeenCalledWith('packages/ui/src/new-file.ts');

    view.rerender(<DiffViewer diffs={[diffRecords[1]]} />);
    expect(view.container.textContent).toContain('No diff content available');

    view.rerender(<DiffViewer diffs={[]} />);
    expect(view.container.textContent).toContain('No changes to display');
    view.cleanup();
  });

  it('renders side-by-side diff rows, file selection, and empty fallbacks', () => {
    const view = renderIntoDom(<SideBySideDiffViewer diffs={sideBySideDiffRecords} />);

    expect(view.container.textContent).toContain('2 files changed');
    expect(view.container.textContent).toContain('@@ -1,4 +1,5 @@');
    expect(view.container.textContent).toContain('const stable = true;');
    expect(view.container.textContent).toContain('before();');
    expect(view.container.textContent).toContain('after();');
    expect(view.container.textContent).toContain('addedOnly();');
    expect(view.container.querySelectorAll('tbody tr')).toHaveLength(6);

    const emptyFileButton = Array.from(view.container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('empty-file.ts'),
    );
    if (!(emptyFileButton instanceof HTMLButtonElement)) {
      throw new Error('Expected empty file button');
    }
    expect(emptyFileButton.getAttribute('aria-label')).toBe('packages/ui/src/empty-file.ts');

    act(() => {
      emptyFileButton.click();
    });

    expect(view.container.textContent).toContain('No diff content available for this file');

    view.rerender(<SideBySideDiffViewer diffs={[]} />);
    expect(view.container.textContent).toContain('No changes to display');
    view.cleanup();
  });

  it('renders parser edge cases for side-by-side and unified diffs', () => {
    const edgeDiff: DiffRecord = {
      id: 'edge-diff',
      threadId: 'thread-1',
      filePath: 'packages/ui/src/remove-only.ts',
      diffContent: `@@ malformed hunk
contextWithoutPrefix
-removedOnly();
@@ -10 +10 @@
 same();`,
      action: 'delete',
      beforeHash: 'before-edge',
      afterHash: null,
      createdAt: new Date('2026-04-21T00:00:02.000Z').toISOString(),
    };

    const sideBySide = renderIntoDom(<SideBySideDiffViewer diffs={[edgeDiff]} />);
    expect(sideBySide.container.textContent).toContain('1 file changed');
    expect(sideBySide.container.textContent).toContain('@@ malformed hunk');
    expect(sideBySide.container.textContent).toContain('contextWithoutPrefix');
    expect(sideBySide.container.textContent).toContain('removedOnly();');
    expect(sideBySide.container.textContent).toContain('delete');
    sideBySide.cleanup();

    const blankChangedLines: DiffRecord = {
      ...edgeDiff,
      id: 'blank-changed-lines',
      filePath: 'packages/ui/src/blank-lines.ts',
      diffContent: '@@ -1 +1 @@\n-\n+',
      action: 'modify',
    };
    const blankSideBySide = renderIntoDom(<SideBySideDiffViewer diffs={[blankChangedLines]} />);
    expect(blankSideBySide.container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(blankSideBySide.container.textContent).toContain('@@ -1 +1 @@');
    blankSideBySide.cleanup();

    const unified = renderIntoDom(<DiffViewer diffs={[edgeDiff]} />);
    expect(unified.container.textContent).toContain('contextWithoutPrefix');
    expect(unified.container.textContent).toContain('removedOnly();');
    unified.cleanup();

    const chip = renderIntoDom(
      <PhaseChip status={'unknown_status' as never} label="custom_state" className="extra-chip" />,
    );
    expect(chip.container.textContent).toContain('custom state');
    expect(chip.container.querySelector('.extra-chip')).not.toBeNull();
    chip.cleanup();
  });

  it('renders the read-only git visualizer and switches worktrees', () => {
    const onSelectWorktree = vi.fn();
    const onRefresh = vi.fn();
    const view = renderIntoDom(
      <GitVisualizer
        worktrees={worktrees}
        branches={['develop', 'ship/46-bootstrap']}
        selectedWorktreePath="/repo/shipcode"
        diffs={sideBySideDiffRecords}
        onSelectWorktree={onSelectWorktree}
        onRefresh={onRefresh}
      />,
    );

    expect(view.container.textContent).toContain('Git Visualizer');
    expect(view.container.textContent).toContain('2 worktrees');
    expect(view.container.textContent).toContain('develop');
    expect(view.container.textContent).toContain('#46 Bootstrap visualizer');
    expect(view.container.textContent).toContain('2 modified, 1 untracked');
    expect(view.container.textContent).toContain('+1 ahead vs origin/develop');
    expect(view.container.textContent).toContain('pre-hook');
    expect(view.container.textContent).toContain('2 files');

    const worktreeButton = Array.from(view.container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('ship/46-bootstrap'),
    );
    if (!(worktreeButton instanceof HTMLButtonElement)) {
      throw new Error('Expected worktree button');
    }

    act(() => {
      worktreeButton.click();
    });

    expect(onSelectWorktree).toHaveBeenCalledWith('/tmp/shipcode/46');
    view.cleanup();
  });

  it('renders git visualizer empty and loading states', () => {
    const view = renderIntoDom(
      <GitVisualizer
        worktrees={[]}
        branches={['main']}
        selectedWorktreePath={null}
        diffs={[]}
        diffLoading
        loading
        onSelectWorktree={vi.fn()}
        headerActions={<Button size="xs">Inspect</Button>}
      />,
    );

    expect(view.container.textContent).toContain('0 worktrees');
    expect(view.container.textContent).toContain('1 branch');
    expect(view.container.textContent).toContain('No worktrees found.');
    expect(view.container.textContent).toContain('Loading diff');
    expect(view.container.querySelector('button[title="Refresh git visualizer"]')).toBeNull();
    view.cleanup();
  });

  it('renders git visualizer clean, staged, behind, and fallback-title states', () => {
    const onSelectWorktree = vi.fn();
    const cleanWorktree: GitWorktreeSummary = {
      id: 'clean',
      kind: 'shipcode',
      path: '/tmp/clean',
      branch: 'ship/clean',
      commitHash: '',
      isDirty: false,
      untrackedCount: 0,
      stagedCount: 0,
      modifiedCount: 0,
      aheadCount: 0,
      behindCount: 0,
      compareRef: 'main',
      preCommitHookPath: null,
      threadId: null,
      issueNumber: null,
      title: null,
      status: null,
    };
    const stagedBehindWorktree: GitWorktreeSummary = {
      id: 'staged',
      kind: 'shipcode',
      path: '/tmp/staged',
      branch: 'ship/staged',
      commitHash: 'fedcba987654321',
      isDirty: true,
      untrackedCount: 0,
      stagedCount: 2,
      modifiedCount: 0,
      aheadCount: 0,
      behindCount: 3,
      compareRef: null,
      preCommitHookPath: null,
      threadId: null,
      issueNumber: 12,
      title: null,
      status: null,
    };

    const view = renderIntoDom(
      <GitVisualizer
        worktrees={[cleanWorktree, stagedBehindWorktree]}
        branches={['ship/clean']}
        selectedWorktreePath="/tmp/missing"
        diffs={[sideBySideDiffRecords[0]]}
        onSelectWorktree={onSelectWorktree}
        headerActions={<Button size="xs">Inspect</Button>}
      />,
    );

    expect(view.container.textContent).toContain('clean');
    expect(view.container.textContent).toContain('unknown');
    expect(view.container.textContent).toContain('even with main');
    expect(view.container.textContent).toContain('2 staged');
    expect(view.container.textContent).toContain('-3 behind');
    expect(view.container.textContent).toContain('1 file');
    expect(view.container.textContent).toContain('Inspect');

    const stagedButton = Array.from(view.container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('ship/staged'),
    );
    if (!(stagedButton instanceof HTMLButtonElement)) {
      throw new Error('Expected staged worktree button');
    }
    act(() => stagedButton.click());
    expect(onSelectWorktree).toHaveBeenCalledWith('/tmp/staged');
    view.cleanup();
  });

  it('renders git visualizer singular counts, spinning refresh, and no-divergence states', () => {
    const onRefresh = vi.fn();
    const loneWorktree: GitWorktreeSummary = {
      id: 'lone',
      kind: 'shipcode',
      path: '/tmp/lone',
      branch: 'ship/lone',
      commitHash: '1122334455667788',
      isDirty: false,
      untrackedCount: 0,
      stagedCount: 0,
      modifiedCount: 0,
      aheadCount: 0,
      behindCount: 0,
      compareRef: null,
      preCommitHookPath: null,
      threadId: null,
      issueNumber: null,
      title: 'Lone branch',
      status: null,
    };
    const aheadWorktree: GitWorktreeSummary = {
      ...loneWorktree,
      id: 'ahead',
      path: '/tmp/ahead',
      branch: 'ship/ahead',
      isDirty: false,
      aheadCount: 2,
      compareRef: 'main',
      title: 'Ahead branch',
    };

    const view = renderIntoDom(
      <GitVisualizer
        worktrees={[loneWorktree, aheadWorktree]}
        branches={['ship/lone']}
        selectedWorktreePath="/tmp/lone"
        diffs={[]}
        loading
        onSelectWorktree={vi.fn()}
        onRefresh={onRefresh}
        className="git-shell"
      />,
    );

    expect(view.container.textContent).toContain('2 worktrees');
    expect(view.container.textContent).toContain('1 branch');
    expect(view.container.textContent).toContain('0 files');
    expect(view.container.textContent).toContain('ahead');
    expect(view.container.textContent).toContain('+2 ahead vs main');
    expect(view.container.textContent).not.toContain('even with');
    expect(view.container.querySelector('.git-shell')).not.toBeNull();

    const refresh = view.container.querySelector('button[title="Refresh git visualizer"]');
    if (!(refresh instanceof HTMLButtonElement)) {
      throw new Error('Expected refresh button');
    }
    expect(refresh.querySelector('.animate-spin')).not.toBeNull();
    act(() => refresh.click());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    view.cleanup();
  });

  it('renders singular worktree copy in the git visualizer header', () => {
    const loneWorktree: GitWorktreeSummary = {
      id: 'single',
      kind: 'shipcode',
      path: '/tmp/single',
      branch: 'ship/single',
      commitHash: '1122334455667788',
      isDirty: false,
      untrackedCount: 0,
      stagedCount: 0,
      modifiedCount: 0,
      aheadCount: 0,
      behindCount: 0,
      compareRef: null,
      preCommitHookPath: null,
      threadId: null,
      issueNumber: null,
      title: 'Single branch',
      status: null,
    };

    const view = renderIntoDom(
      <GitVisualizer
        worktrees={[loneWorktree]}
        branches={['main', 'ship/single']}
        selectedWorktreePath="/tmp/single"
        diffs={[]}
        onSelectWorktree={vi.fn()}
      />,
    );

    expect(view.container.textContent).toContain('1 worktree');
    expect(view.container.textContent).toContain('2 branches');
    view.cleanup();
  });

  it('renders the shared page header with subtitle and actions', () => {
    const view = renderIntoDom(
      <PageHeader
        title="Automations"
        subtitle="Scheduled tasks for autonomous maintenance."
        actions={<Button size="sm">New automation</Button>}
      />,
    );

    expect(view.container.querySelector('header')?.textContent).toContain('Automations');
    expect(view.container.textContent).toContain('Scheduled tasks for autonomous maintenance.');
    expect(view.container.textContent).toContain('New automation');
    view.cleanup();
  });

  it('renders the shared page header without optional subtitle or actions', () => {
    const view = renderIntoDom(<PageHeader title="Inbox" />);

    expect(view.container.querySelector('h1')?.textContent).toBe('Inbox');
    expect(view.container.querySelector('p')).toBeNull();
    expect(view.container.querySelector('header')?.children).toHaveLength(1);
    view.cleanup();
  });

  it('renders loading button content without collapsing the label', () => {
    const view = renderIntoDom(
      <Button>
        <LoadingButtonContent loading spinnerSize={14}>
          <span>Save</span>
        </LoadingButtonContent>
      </Button>,
    );

    expect(view.container.textContent).toContain('Save');
    expect(view.container.querySelector('.animate-spin')).not.toBeNull();
    view.cleanup();
  });

  it('renders loading button content without a spinner when idle', () => {
    const view = renderIntoDom(
      <LoadingButtonContent
        loading={false}
        className="outer-class"
        labelClassName="label-class"
        spinnerClassName="spinner-class"
      >
        Save
      </LoadingButtonContent>,
    );

    expect(view.container.textContent).toContain('Save');
    expect(view.container.querySelector('.animate-spin')).toBeNull();
    expect(view.container.querySelector('.outer-class')).not.toBeNull();
    expect(view.container.querySelector('.label-class')).not.toBeNull();
    view.cleanup();
  });

  it('renders active pipeline model chips without provider prefixes', () => {
    const startedAt = 1_700_000_000_000;
    const view = renderIntoDom(
      <ActivePipelineCard
        projectName="shipcode"
        title="Candidate-to-role matching"
        phase="planning"
        startedAt={startedAt}
        modelProvider="codex"
        model="gpt-5.4"
        reasoningEffort="high"
        onClick={vi.fn()}
      />,
    );

    expect(view.container.textContent).toContain('GPT-5.4 · high');
    expect(view.container.textContent).not.toContain('Codex / GPT-5.4');
    expect(view.container.querySelector('[title="Active model: GPT-5.4 · high"]')).not.toBeNull();
    view.cleanup();
  });

  it('opens active pipeline cards from keyboard activation', () => {
    const onClick = vi.fn();
    const view = renderIntoDom(
      <ActivePipelineCard
        projectName="shipcode"
        title="Keyboard accessible pipeline"
        phase="planning"
        startedAt={1_700_000_000_000}
        onClick={onClick}
      />,
    );

    const card = view.container.querySelector('[role="button"]');
    if (!(card instanceof HTMLDivElement)) {
      throw new Error('Expected active pipeline card button');
    }

    act(() => {
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });

    expect(onClick).toHaveBeenCalledTimes(2);
    view.cleanup();
  });

  it('cancels active pipeline cards without opening them', () => {
    const onClick = vi.fn();
    const onCancel = vi.fn();
    const view = renderIntoDom(
      <ActivePipelineCard
        projectName="shipcode"
        title="Cancelable pipeline"
        phase="executing"
        startedAt={1_700_000_000_000}
        onClick={onClick}
        onCancel={onCancel}
      />,
    );

    const cancelButton = Array.from(view.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'CANCEL',
    );
    if (!(cancelButton instanceof HTMLButtonElement)) {
      throw new Error('Expected cancel button');
    }

    act(() => {
      cancelButton.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true }),
      );
      cancelButton.click();
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('renders active pipeline issue and cancel variants', () => {
    const onCancel = vi.fn();
    const view = renderIntoDom(
      <ActivePipelineCard
        projectName="shipcode"
        title="Awaiting approval"
        phase="approval"
        issueNumber={88}
        startedAt={1_700_000_000_000}
        model="claude-sonnet-4-6"
        onClick={vi.fn()}
        onCancel={onCancel}
        className="pipeline-shell"
      />,
    );

    expect(view.container.textContent).toContain('#88');
    expect(view.container.textContent).toContain('Sonnet 4.6');
    expect(view.container.textContent).not.toContain('· high');
    expect(view.container.textContent).toContain('approval');
    expect(view.container.querySelector('.pipeline-shell')).not.toBeNull();

    const cancelButton = view.container.querySelector('button[title="Cancel pipeline"]');
    if (!(cancelButton instanceof HTMLButtonElement)) {
      throw new Error('Expected cancel button');
    }
    expect(cancelButton.className).toContain('text-warning');
    view.cleanup();

    const waitingView = renderIntoDom(
      <ActivePipelineCard
        projectName="shipcode"
        title="Approved with cancel"
        phase="approval"
        approvedAwaitingExecution
        startedAt={1_700_000_000_000}
        onClick={vi.fn()}
        onCancel={onCancel}
      />,
    );

    expect(waitingView.container.textContent).toContain('Waiting for slot');
    waitingView.cleanup();
  });

  it('renders approved execution waiters with waiting-for-slot copy', () => {
    const startedAt = 1_700_000_000_000;
    const view = renderIntoDom(
      <ActivePipelineCard
        projectName="shipcode"
        title="Hold for execution capacity"
        phase="approval"
        approvedAwaitingExecution
        startedAt={startedAt}
        onClick={vi.fn()}
      />,
    );

    expect(view.container.textContent).toContain('Waiting for slot');
    expect(view.container.textContent).not.toContain('awaiting approval');
    expect(view.container.textContent).not.toContain('5s');
    view.cleanup();
  });

  it('does not run the elapsed timer for human approval waits', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const startedAt = 1_700_000_000_000;
    const view = renderIntoDom(
      <ActivePipelineCard
        projectName="shipcode"
        title="Needs approval"
        phase="approval"
        startedAt={startedAt}
        onClick={vi.fn()}
      />,
    );

    expect(view.container.textContent).toContain('48%');
    expect(view.container.textContent).not.toContain('5s');
    expect(setIntervalSpy).not.toHaveBeenCalled();
    view.cleanup();
  });
});
