// @vitest-environment jsdom

import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '@/ConfirmDialog';

function renderIntoDom(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return {
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
      document.body.innerHTML = '';
    },
  };
}

function buttonNamed(name: string) {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === name,
  );

  if (!button) {
    throw new Error(`Button not found: ${name}`);
  }

  return button;
}

describe('ConfirmDialog', () => {
  it('confirms with cmd-enter', () => {
    const onConfirm = vi.fn();
    const view = renderIntoDom(
      <ConfirmDialog
        confirmLabel="Archive"
        onClose={vi.fn()}
        onConfirm={onConfirm}
        open
        title="Archive issue?"
      />,
    );

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Archive issue?');

    act(() => {
      dialog?.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', metaKey: true }),
      );
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    view.cleanup();
  });

  it('blocks the button and shortcut while confirmation is disabled', () => {
    const onConfirm = vi.fn();
    const view = renderIntoDom(
      <ConfirmDialog
        confirmLabel="Review board"
        disabled
        onClose={vi.fn()}
        onConfirm={onConfirm}
        open
        title="Review board?"
      />,
    );

    const dialog = document.querySelector('[role="dialog"]');
    const confirmButton = buttonNamed('Review board');
    expect(confirmButton.hasAttribute('disabled')).toBe(true);

    act(() => {
      dialog?.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', metaKey: true }),
      );
      confirmButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConfirm).not.toHaveBeenCalled();
    view.cleanup();
  });

  it('closes from the cancel action', () => {
    const onClose = vi.fn();
    const view = renderIntoDom(
      <ConfirmDialog
        confirmLabel="Continue"
        onClose={onClose}
        onConfirm={vi.fn()}
        open
        title="Continue?"
        warningText="This action changes the issue."
        warningVariant="warning"
      />,
    );

    act(() => {
      buttonNamed('Cancel').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    view.cleanup();
  });
});
