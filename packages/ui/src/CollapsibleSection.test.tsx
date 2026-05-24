// @vitest-environment jsdom

import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { CollapsibleSection } from '@/CollapsibleSection';

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

describe('CollapsibleSection', () => {
  it('renders a reusable collapsed section and toggles its content', () => {
    const view = renderIntoDom(
      <CollapsibleSection title="Pipeline Runs" count={2}>
        <div>Run details</div>
      </CollapsibleSection>,
    );

    const trigger = view.container.querySelector('button');
    const content = view.container.querySelector('[data-slot="collapsible-section"] > div');

    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(content?.className).toContain('hidden');

    act(() => {
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(content?.className).not.toContain('hidden');
    expect(view.container.textContent).toContain('Run details');

    view.cleanup();
  });
});
