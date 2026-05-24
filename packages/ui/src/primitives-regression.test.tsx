// @vitest-environment jsdom

import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Button } from '@/primitives/button';

function renderIntoDom(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return {
    container,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe('button primitive', () => {
  it('does not turn aria labels into native browser tooltips', () => {
    const view = renderIntoDom(<Button aria-label="Verbose action label">Icon</Button>);

    expect(view.container.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Verbose action label',
    );
    expect(view.container.querySelector('button')?.hasAttribute('title')).toBe(false);
    view.cleanup();
  });
});
