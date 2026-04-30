// @vitest-environment jsdom

import type { DiffRecord, GitWorktreeSummary, StatusLabelMapping } from '@shipcode/shared';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ActivePipelineCard } from './ActivePipelineCard';
import { DiffViewer } from './DiffViewer';
import { GitVisualizer } from './GitVisualizer';
import { LoadingButtonContent } from './LoadingButtonContent';
import { PageHeader } from './PageHeader';
import { Alert, AlertDescription, AlertTitle } from './primitives/alert';
import { Button } from './primitives/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './primitives/card';
import { Modal } from './primitives/modal';
import { OverlayPanel } from './primitives/overlay-panel';
import { SettingsRow } from './primitives/settings-row';
import { SideBySideDiffViewer } from './SideBySideDiffViewer';
import { StatusMappingEditor } from './StatusMappingEditor';

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

const mappings: StatusLabelMapping = {
  todo: '',
  queued: 'status:queued',
  planning: 'status:in-progress',
  clarifying: 'status:in-progress',
  reviewing: 'status:in-progress',
  revising: 'status:in-progress',
  awaiting_approval: 'status:in-progress',
  executing: 'status:in-progress',
  testing: '',
  verifying: 'status:in-progress',
  shipping: 'status:in-progress',
  completed: 'status:done',
  done: 'status:done',
  failed: 'status:failed',
};

describe('UI component regression coverage', () => {
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

  it('renders the status mapping editor and resets to defaults', () => {
    const onSave = vi.fn();
    const view = renderIntoDom(<StatusMappingEditor mappings={mappings} onSave={onSave} />);

    expect(view.container.textContent).toContain('GitHub Label Mapping');
    expect(view.container.textContent).toContain(
      "Labels are auto-created on GitHub if they don't exist.",
    );
    expect(view.container.querySelectorAll('tbody tr')).toHaveLength(13);

    const resetButton = view.container.querySelector(
      'button[aria-label="Reset status mapping to defaults"]',
    );
    if (!(resetButton instanceof HTMLButtonElement)) {
      throw new Error('Expected reset button');
    }

    act(() => {
      resetButton.click();
    });

    expect(onSave).toHaveBeenCalledWith({
      todo: '',
      queued: 'status:queued',
      planning: 'status:in-progress',
      clarifying: 'status:in-progress',
      reviewing: 'status:in-progress',
      revising: 'status:in-progress',
      awaiting_approval: 'status:in-progress',
      executing: 'status:in-progress',
      testing: 'status:in-progress',
      verifying: 'status:in-progress',
      shipping: 'status:in-progress',
      completed: 'status:done',
      done: 'status:done',
      failed: 'status:failed',
    });
    view.cleanup();
  });

  it('renders an overlay panel with resize affordance and width constraints', () => {
    const onResizeStart = vi.fn();
    const view = renderIntoDom(
      <div className="relative h-[320px]">
        <OverlayPanel
          width={480}
          minWidth={380}
          maxWidth={760}
          onResizeStart={onResizeStart}
          resizeHandleLabel="Resize issue detail panel"
        >
          <div>Overlay content</div>
        </OverlayPanel>
      </div>,
    );

    const panel = view.container.querySelector('[data-slot="overlay-panel"]');
    if (!(panel instanceof HTMLDivElement)) {
      throw new Error('Expected overlay panel');
    }
    expect(panel.style.width).toBe('480px');
    expect(panel.style.minWidth).toBe('380px');
    expect(panel.style.maxWidth).toBe('760px');
    expect(panel.textContent).toContain('Overlay content');

    const resizeHandle = view.container.querySelector('[data-slot="overlay-panel-resize-handle"]');
    if (!(resizeHandle instanceof HTMLButtonElement)) {
      throw new Error('Expected overlay panel resize handle');
    }
    expect(resizeHandle.getAttribute('aria-label')).toBe('Resize issue detail panel');

    act(() => {
      resizeHandle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onResizeStart).toHaveBeenCalledTimes(1);
    view.cleanup();
  });

  it('renders alert, card, settings row, and modal primitives', () => {
    const onClose = vi.fn();
    const view = renderIntoDom(
      <>
        <Alert variant="warning" data-testid="alert">
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>Coverage dropped below the floor.</AlertDescription>
        </Alert>
        <Card data-testid="card">
          <CardHeader>
            <CardTitle>ShipCode</CardTitle>
            <CardDescription>Autonomous coding pipeline</CardDescription>
          </CardHeader>
          <CardContent>Card content</CardContent>
          <CardFooter>Card footer</CardFooter>
        </Card>
        <SettingsRow label="Theme" description="Choose the renderer theme" htmlFor="theme">
          <input id="theme" defaultValue="dark" />
        </SettingsRow>
        <Button size="icon-xs" aria-label="Refresh terminal sessions">
          R
        </Button>
        <Modal
          open
          onClose={onClose}
          title="Settings"
          headerAction={<button type="button">Close action</button>}
        >
          <p>Modal content</p>
        </Modal>
      </>,
    );

    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(
      'Coverage dropped below the floor.',
    );
    expect(view.container.querySelector('[data-testid="card"]')?.textContent).toContain(
      'Autonomous coding pipeline',
    );
    expect((view.container.querySelector('#theme') as HTMLInputElement | null)?.value).toBe('dark');
    expect(
      view.container.querySelector('button[title="Refresh terminal sessions"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain('Settings');
    expect(document.body.textContent).toContain('Close action');
    expect(document.body.textContent).toContain('Modal content');
    expect(document.body.querySelector('button[title="Close"]')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
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

  it('renders active pipeline model chips without provider prefixes', () => {
    const view = renderIntoDom(
      <ActivePipelineCard
        projectName="shipcode"
        title="Candidate-to-role matching"
        phase="planning"
        startedAt={Date.now() - 5_000}
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

  it('renders approved execution waiters with waiting-for-slot copy', () => {
    const view = renderIntoDom(
      <ActivePipelineCard
        projectName="shipcode"
        title="Hold for execution capacity"
        phase="awaiting_approval"
        approvedAwaitingExecution
        startedAt={Date.now() - 5_000}
        onClick={vi.fn()}
      />,
    );

    expect(view.container.textContent).toContain('Waiting for slot');
    expect(view.container.textContent).not.toContain('awaiting approval');
    view.cleanup();
  });
});
