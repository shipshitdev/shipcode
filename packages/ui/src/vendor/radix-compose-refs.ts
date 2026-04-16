import * as React from 'react';

type PossibleRef<T> = React.Ref<T> | undefined;
const NULL_REF = Symbol('null-ref');
const CALLBACK = Symbol('callback');
type ComposeRefsCallback = (node: unknown | null) => void;
type ComposeRefsCacheNode = Map<unknown, ComposeRefsCacheNode | ComposeRefsCallback>;
const composeRefsCache: ComposeRefsCacheNode = new Map();

function setRef<T>(ref: PossibleRef<T>, value: T | null) {
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  if (ref != null) {
    (ref as React.MutableRefObject<T | null>).current = value;
  }
}

export function composeRefs<T>(...refs: PossibleRef<T>[]) {
  let cacheNode: ComposeRefsCacheNode = composeRefsCache;

  for (const ref of refs) {
    const key = ref ?? NULL_REF;
    let next = cacheNode.get(key);
    if (!(next instanceof Map)) {
      next = new Map();
      cacheNode.set(key, next);
    }
    cacheNode = next;
  }

  const cached = cacheNode.get(CALLBACK);
  if (typeof cached === 'function') {
    return cached as (node: T | null) => void;
  }

  const composedRef: ComposeRefsCallback = (node) => {
    refs.forEach((ref) => {
      setRef(ref, node as T | null);
    });
  };

  cacheNode.set(CALLBACK, composedRef);
  return composedRef as (node: T | null) => void;
}

export function useComposedRefs<T>(...refs: PossibleRef<T>[]) {
  const refsRef = React.useRef(refs);
  refsRef.current = refs;

  // Keep the callback ref identity stable across renders so React 19
  // does not repeatedly tear down and re-run ref setters that enqueue state.
  return React.useCallback((node: T | null) => {
    refsRef.current.forEach((ref) => {
      setRef(ref, node);
    });
  }, []);
}
