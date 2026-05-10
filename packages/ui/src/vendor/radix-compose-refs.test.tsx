// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeRefs, useComposedRefs } from './radix-compose-refs';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  host?.remove();
  host = null;
});

describe('radix compose refs vendor shim', () => {
  it('writes callback and object refs and reuses callbacks for the same ref tuple', () => {
    const callbackRef = vi.fn();
    const objectRef = { current: null as HTMLDivElement | null };
    const node = document.createElement('div');

    const composed = composeRefs<HTMLDivElement>(callbackRef, objectRef, undefined);
    const cached = composeRefs<HTMLDivElement>(callbackRef, objectRef, undefined);

    expect(cached).toBe(composed);

    composed(node);
    expect(callbackRef).toHaveBeenCalledWith(node);
    expect(objectRef.current).toBe(node);

    composed(null);
    expect(callbackRef).toHaveBeenLastCalledWith(null);
    expect(objectRef.current).toBeNull();
  });

  it('keeps useComposedRefs callback identity stable while using the latest refs', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    const firstRef = vi.fn();
    const secondRef = vi.fn();
    const seenCallbacks: Array<(node: HTMLDivElement | null) => void> = [];

    function RefProbe({ callback }: { callback: (node: HTMLDivElement | null) => void }) {
      const objectRef = { current: null as HTMLDivElement | null };
      const composed = useComposedRefs<HTMLDivElement>(callback, objectRef);
      seenCallbacks.push(composed);
      return <div ref={composed}>Probe</div>;
    }

    act(() => {
      root?.render(<RefProbe callback={firstRef} />);
    });
    const node = host.querySelector('div');
    expect(firstRef).toHaveBeenCalledWith(node);

    act(() => {
      root?.render(<RefProbe callback={secondRef} />);
    });

    expect(seenCallbacks[1]).toBe(seenCallbacks[0]);
    expect(secondRef).not.toHaveBeenCalled();

    act(() => {
      seenCallbacks[1](node);
    });

    expect(secondRef).toHaveBeenCalledWith(node);
  });
});
