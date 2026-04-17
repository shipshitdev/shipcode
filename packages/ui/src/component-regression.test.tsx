// @vitest-environment jsdom

import type { DiffRecord, StatusLabelMapping } from '@shipcode/shared';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { DiffViewer } from './DiffViewer';
import { Alert, AlertDescription, AlertTitle } from './primitives/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './primitives/card';
import { Modal } from './primitives/modal';
import { SettingsRow } from './primitives/settings-row';
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

const mappings: StatusLabelMapping = {
  todo: '',
  queued: 'status:queued',
  planning: 'status:in-progress',
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

  it('renders the status mapping editor and resets to defaults', () => {
    const onSave = vi.fn();
    const view = renderIntoDom(<StatusMappingEditor mappings={mappings} onSave={onSave} />);

    expect(view.container.textContent).toContain('GitHub Label Mapping');
    expect(view.container.textContent).toContain(
      "Labels are auto-created on GitHub if they don't exist.",
    );
    expect(view.container.querySelectorAll('tbody tr')).toHaveLength(12);

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
    expect(document.body.textContent).toContain('Settings');
    expect(document.body.textContent).toContain('Close action');
    expect(document.body.textContent).toContain('Modal content');
    expect(onClose).not.toHaveBeenCalled();
    view.cleanup();
  });
});
