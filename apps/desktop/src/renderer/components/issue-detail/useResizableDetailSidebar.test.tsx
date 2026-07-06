import '@testing-library/jest-dom/vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useResizableDetailSidebar } from './useResizableDetailSidebar';

afterEach(() => {
  cleanup();
  document.body.classList.remove('cursor-col-resize', 'select-none');
  vi.restoreAllMocks();
});

function mouseDownEvent(clientX: number) {
  return { preventDefault: vi.fn(), clientX } as unknown as React.MouseEvent;
}

describe('useResizableDetailSidebar', () => {
  it('cleans up active resize listeners and body classes on unmount mid-drag', () => {
    const addListenerSpy = vi.spyOn(document, 'addEventListener');
    const removeListenerSpy = vi.spyOn(document, 'removeEventListener');
    const { result, unmount } = renderHook(() => useResizableDetailSidebar());

    act(() => {
      result.current.handleDetailResizeMouseDown(mouseDownEvent(400));
    });

    const mouseMoveListener = addListenerSpy.mock.calls.find(([type]) => type === 'mousemove')?.[1];
    const mouseUpListener = addListenerSpy.mock.calls.find(([type]) => type === 'mouseup')?.[1];
    expect(mouseMoveListener).toBeDefined();
    expect(mouseUpListener).toBeDefined();
    expect(document.body).toHaveClass('cursor-col-resize', 'select-none');

    unmount();

    expect(
      removeListenerSpy.mock.calls.some(
        ([type, listener]) => type === 'mousemove' && listener === mouseMoveListener,
      ),
    ).toBe(true);
    expect(
      removeListenerSpy.mock.calls.some(
        ([type, listener]) => type === 'mouseup' && listener === mouseUpListener,
      ),
    ).toBe(true);
    expect(document.body).not.toHaveClass('cursor-col-resize', 'select-none');
  });

  it('does not leak listeners across repeated mousedown starts', () => {
    const removeListenerSpy = vi.spyOn(document, 'removeEventListener');
    const { result, unmount } = renderHook(() => useResizableDetailSidebar());

    act(() => {
      result.current.handleDetailResizeMouseDown(mouseDownEvent(400));
    });
    act(() => {
      result.current.handleDetailResizeMouseDown(mouseDownEvent(420));
    });

    // Starting a second drag tears down the first drag's listeners.
    expect(removeListenerSpy.mock.calls.some(([type]) => type === 'mousemove')).toBe(true);

    unmount();
    expect(document.body).not.toHaveClass('cursor-col-resize', 'select-none');
  });
});
