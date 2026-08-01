import '@testing-library/jest-dom/vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COL_RESIZE_BODY_CLASS_NAMES, useDragResize } from './useDragResize';

afterEach(() => {
  cleanup();
  document.body.classList.remove(...COL_RESIZE_BODY_CLASS_NAMES);
  vi.restoreAllMocks();
});

function mouseDownEvent(position: { clientX?: number; clientY?: number; currentTarget?: unknown }) {
  return {
    preventDefault: vi.fn(),
    clientX: 0,
    clientY: 0,
    ...position,
  } as unknown as React.MouseEvent;
}

function dispatchMouseMove(position: { clientX?: number; clientY?: number }) {
  act(() => {
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 0, clientY: 0, bubbles: true, ...position }),
    );
  });
}

type ListenerSpy = { mock: { calls: unknown[][] } };

/** Listeners of `type` that were added and never removed, matched by identity. */
function liveListeners(addSpy: ListenerSpy, removeSpy: ListenerSpy, type: string) {
  const listenersOfType = (spy: ListenerSpy) =>
    spy.mock.calls.filter((call) => call[0] === type).map((call) => call[1]);
  const removed = listenersOfType(removeSpy);
  return listenersOfType(addSpy).filter((listener) => !removed.includes(listener));
}

function dispatchMouseUp() {
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
}

describe('useDragResize', () => {
  it('removes window listeners when the component unmounts mid-drag', () => {
    const addListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { result, unmount } = renderHook(() =>
      useDragResize({ initialSize: 300, axis: 'x', min: 100, max: 500 }),
    );

    act(() => {
      result.current.handleResizeMouseDown(mouseDownEvent({ clientX: 300 }));
    });

    const moveListener = addListenerSpy.mock.calls.find(([type]) => type === 'mousemove')?.[1];
    const upListener = addListenerSpy.mock.calls.find(([type]) => type === 'mouseup')?.[1];
    expect(moveListener).toBeDefined();
    expect(upListener).toBeDefined();
    expect(result.current.isDragging).toBe(true);

    // Unmount with the mouse button still down — no mouseup ever arrives.
    unmount();

    expect(
      removeListenerSpy.mock.calls.some(
        ([type, listener]) => type === 'mousemove' && listener === moveListener,
      ),
    ).toBe(true);
    expect(
      removeListenerSpy.mock.calls.some(
        ([type, listener]) => type === 'mouseup' && listener === upListener,
      ),
    ).toBe(true);
  });

  it('leaves no window listener attached after an unmount mid-drag', () => {
    const addListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { result, unmount } = renderHook(() =>
      useDragResize({ initialSize: 300, axis: 'x', min: 100, max: 500 }),
    );

    act(() => {
      result.current.handleResizeMouseDown(mouseDownEvent({ clientX: 300 }));
    });
    dispatchMouseMove({ clientX: 340 });
    expect(result.current.size).toBe(340);
    expect(liveListeners(addListenerSpy, removeListenerSpy, 'mousemove')).toHaveLength(1);

    unmount();

    expect(liveListeners(addListenerSpy, removeListenerSpy, 'mousemove')).toHaveLength(0);
    expect(liveListeners(addListenerSpy, removeListenerSpy, 'mouseup')).toHaveLength(0);
  });

  it('drops body classes when the component unmounts mid-drag', () => {
    const { result, unmount } = renderHook(() =>
      useDragResize({
        initialSize: 300,
        axis: 'x',
        min: 100,
        max: 500,
        bodyClassNames: COL_RESIZE_BODY_CLASS_NAMES,
      }),
    );

    act(() => {
      result.current.handleResizeMouseDown(mouseDownEvent({ clientX: 300 }));
    });
    expect(document.body).toHaveClass(...COL_RESIZE_BODY_CLASS_NAMES);

    unmount();

    expect(document.body).not.toHaveClass(...COL_RESIZE_BODY_CLASS_NAMES);
  });

  it('releases the previous drag when a new one starts', () => {
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { result } = renderHook(() =>
      useDragResize({ initialSize: 300, axis: 'x', min: 100, max: 500 }),
    );

    act(() => {
      result.current.handleResizeMouseDown(mouseDownEvent({ clientX: 300 }));
    });
    act(() => {
      result.current.handleResizeMouseDown(mouseDownEvent({ clientX: 320 }));
    });

    expect(removeListenerSpy.mock.calls.filter(([type]) => type === 'mousemove')).toHaveLength(1);

    // Only the second drag is live, so it alone drives the size.
    dispatchMouseMove({ clientX: 360 });
    expect(result.current.size).toBe(340);
  });

  it('detaches listeners on mouseup', () => {
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { result } = renderHook(() =>
      useDragResize({ initialSize: 300, axis: 'x', min: 100, max: 500 }),
    );

    act(() => {
      result.current.handleResizeMouseDown(mouseDownEvent({ clientX: 300 }));
    });
    dispatchMouseUp();

    expect(result.current.isDragging).toBe(false);
    expect(removeListenerSpy.mock.calls.some(([type]) => type === 'mousemove')).toBe(true);

    dispatchMouseMove({ clientX: 400 });
    expect(result.current.size).toBe(300);
  });

  it('clamps to min and max', () => {
    const { result } = renderHook(() =>
      useDragResize({ initialSize: 300, axis: 'x', min: 220, max: 400 }),
    );

    act(() => {
      result.current.handleResizeMouseDown(mouseDownEvent({ clientX: 300 }));
    });

    dispatchMouseMove({ clientX: 900 });
    expect(result.current.size).toBe(400);

    dispatchMouseMove({ clientX: 0 });
    expect(result.current.size).toBe(220);
  });

  it('leaves the size unbounded above when no max is given', () => {
    const { result } = renderHook(() => useDragResize({ initialSize: 250, axis: 'y', min: 120 }));

    act(() => {
      result.current.handleResizeMouseDown(mouseDownEvent({ clientY: 100 }));
    });
    dispatchMouseMove({ clientY: 500 });

    expect(result.current.size).toBe(650);
  });

  it('grows along the drag direction for the tracked axis', () => {
    // direction -1 on the y axis: dragging upwards grows a bottom-anchored panel.
    const { result } = renderHook(() =>
      useDragResize({ initialSize: 250, axis: 'y', direction: -1, min: 120 }),
    );

    act(() => {
      result.current.handleResizeMouseDown(mouseDownEvent({ clientY: 400 }));
    });

    dispatchMouseMove({ clientY: 350 });
    expect(result.current.size).toBe(300);

    // Horizontal movement is ignored on a vertical drag.
    dispatchMouseMove({ clientX: 999, clientY: 350 });
    expect(result.current.size).toBe(300);
  });

  it('starts from the measured size when one is supplied', () => {
    const { result } = renderHook(() =>
      useDragResize({
        initialSize: 250,
        axis: 'y',
        direction: -1,
        min: 120,
        measureStartSize: () => 480,
      }),
    );

    act(() => {
      result.current.handleResizeMouseDown(mouseDownEvent({ clientY: 400 }));
    });
    dispatchMouseMove({ clientY: 380 });

    expect(result.current.size).toBe(500);
  });

  it('falls back to the current size when the measurement is unusable', () => {
    const { result } = renderHook(() =>
      useDragResize({
        initialSize: 250,
        axis: 'y',
        direction: -1,
        min: 120,
        measureStartSize: () => 0,
      }),
    );

    act(() => {
      result.current.handleResizeMouseDown(mouseDownEvent({ clientY: 400 }));
    });
    dispatchMouseMove({ clientY: 380 });

    expect(result.current.size).toBe(270);
  });

  it('reports each drag start once and keeps the handler identity stable', () => {
    const onDragStart = vi.fn();
    const { result } = renderHook(() =>
      useDragResize({ initialSize: 300, axis: 'x', min: 100, onDragStart }),
    );
    const initialHandler = result.current.handleResizeMouseDown;

    act(() => {
      result.current.handleResizeMouseDown(mouseDownEvent({ clientX: 300 }));
    });
    dispatchMouseMove({ clientX: 360 });
    dispatchMouseUp();

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(result.current.size).toBe(360);
    expect(result.current.handleResizeMouseDown).toBe(initialHandler);
  });

  it('lets callers set the size outside a drag', () => {
    const { result } = renderHook(() =>
      useDragResize({ initialSize: 300, axis: 'x', min: 100, max: 500 }),
    );

    act(() => {
      result.current.setSize(180);
    });
    expect(result.current.size).toBe(180);

    // The next drag starts from the size the caller set.
    act(() => {
      result.current.handleResizeMouseDown(mouseDownEvent({ clientX: 300 }));
    });
    dispatchMouseMove({ clientX: 320 });

    expect(result.current.size).toBe(200);
  });
});
