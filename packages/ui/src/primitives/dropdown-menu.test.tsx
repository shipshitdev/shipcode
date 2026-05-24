// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const outsideState = vi.hoisted(() => ({
  closestMatch: false,
  preventDefaultCalls: 0,
}));

vi.mock('@radix-ui/react-dropdown-menu', () => ({
  Root: ({ children }: { children: ReactNode }) => <div data-testid="root">{children}</div>,
  Trigger: ({ children }: { children: ReactNode }) => (
    <button type="button" data-testid="trigger">
      {children}
    </button>
  ),
  Portal: ({ children }: { children: ReactNode }) => <>{children}</>,
  Content: ({
    align,
    children,
    className,
    onPointerDownOutside,
    sideOffset,
  }: {
    align?: string;
    children?: ReactNode;
    className?: string;
    onPointerDownOutside?: (event: {
      target: { closest: (selector: string) => unknown };
      preventDefault: () => void;
    }) => void;
    sideOffset?: number;
  }) => (
    <button
      type="button"
      data-testid="content"
      data-align={align}
      data-side-offset={sideOffset}
      className={className}
      onClick={() =>
        onPointerDownOutside?.({
          target: { closest: () => (outsideState.closestMatch ? {} : null) },
          preventDefault: () => {
            outsideState.preventDefaultCalls += 1;
          },
        })
      }
    >
      {children}
    </button>
  ),
  Item: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div data-testid="item" className={className}>
      {children}
    </div>
  ),
  Separator: ({ className }: { className?: string }) => (
    <div data-testid="separator" className={className} />
  ),
  CheckboxItem: ({
    checked,
    children,
    className,
  }: {
    checked?: boolean;
    children?: ReactNode;
    className?: string;
  }) => (
    <div data-testid="checkbox" data-checked={checked} className={className}>
      {children}
    </div>
  ),
  ItemIndicator: ({ children }: { children: ReactNode }) => (
    <span data-testid="indicator">{children}</span>
  ),
}));

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

function renderIntoDom(element: ReactNode) {
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

describe('dropdown menu primitives', () => {
  it('applies defaults, class names, and nested popper outside-click guard', () => {
    const onPointerDownOutside = vi.fn();
    const view = renderIntoDom(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent className="custom-content" onPointerDownOutside={onPointerDownOutside}>
          <DropdownMenuItem className="custom-item">Item</DropdownMenuItem>
          <DropdownMenuSeparator className="custom-separator" />
          <DropdownMenuCheckboxItem checked className="custom-checkbox">
            Checked
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const getByTestId = (id: string) => {
      const element = view.container.querySelector(`[data-testid="${id}"]`);
      if (!element) throw new Error(`Missing ${id}`);
      return element as HTMLElement;
    };

    expect(getByTestId('trigger').textContent).toBe('Open');
    expect(getByTestId('content').getAttribute('data-side-offset')).toBe('4');
    expect(getByTestId('content').getAttribute('data-align')).toBe('end');
    expect(getByTestId('content').className).toContain('app-region-no-drag');
    expect(getByTestId('content').className).toContain('custom-content');
    expect(getByTestId('item').className).toContain('custom-item');
    expect(getByTestId('separator').className).toContain('custom-separator');
    expect(getByTestId('checkbox').getAttribute('data-checked')).toBe('true');
    expect(getByTestId('checkbox').className).toContain('custom-checkbox');
    expect(getByTestId('indicator')).not.toBeNull();

    outsideState.closestMatch = true;
    act(() => {
      getByTestId('content').click();
    });
    expect(outsideState.preventDefaultCalls).toBe(1);
    expect(onPointerDownOutside).toHaveBeenCalledTimes(1);

    outsideState.closestMatch = false;
    act(() => {
      getByTestId('content').click();
    });
    expect(outsideState.preventDefaultCalls).toBe(1);
    expect(onPointerDownOutside).toHaveBeenCalledTimes(2);

    view.cleanup();
  });
});
