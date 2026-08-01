import {
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

/** Body classes that hold the column-resize cursor and suppress text selection mid-drag. */
export const COL_RESIZE_BODY_CLASS_NAMES = ['cursor-col-resize', 'select-none'] as const;

export interface UseDragResizeOptions {
  /** Size the panel renders at before any drag, in px. */
  initialSize: number;
  /** Pointer axis the drag tracks: `x` for width, `y` for height. */
  axis: 'x' | 'y';
  /** Smallest size a drag may clamp to, in px. */
  min: number;
  /** Largest size a drag may clamp to, in px. Unbounded when omitted. */
  max?: number;
  /**
   * Sign applied to pointer movement. `1` grows the panel as the pointer moves
   * right/down (left- or top-anchored edge), `-1` grows it as the pointer moves
   * left/up (right- or bottom-anchored edge).
   */
  direction?: 1 | -1;
  /** Classes toggled on `<body>` for the duration of a drag. */
  bodyClassNames?: readonly string[];
  /**
   * Size the drag starts from, measured at mousedown — for panels whose rendered
   * size can diverge from state. Falls back to the current size when omitted or
   * when it yields a non-positive value.
   */
  measureStartSize?: (event: ReactMouseEvent) => number | undefined;
  /** Runs once per drag, at mousedown. */
  onDragStart?: () => void;
}

export interface UseDragResizeResult {
  size: number;
  setSize: Dispatch<SetStateAction<number>>;
  isDragging: boolean;
  handleResizeMouseDown: (event: ReactMouseEvent) => void;
}

/**
 * Drag-to-resize for a panel edge. Listeners live on `window` — which also sees
 * everything bubbling up through `document` — only while the mouse is down, and
 * are released on mouseup, on a restarted drag, and on unmount, so a drawer that
 * closes mid-drag cannot leave handlers behind.
 */
export function useDragResize(options: UseDragResizeOptions): UseDragResizeResult {
  const [size, setSize] = useState(options.initialSize);
  const [isDragging, setIsDragging] = useState(false);
  const sizeRef = useRef(size);
  const optionsRef = useRef(options);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  // Read through a ref so the mousedown handler stays stable across the
  // size updates a drag fires on every mousemove.
  useEffect(() => {
    optionsRef.current = options;
  });

  const handleResizeMouseDown = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    // A drag whose mouseup was swallowed (window blur, native drag) must
    // release its listeners before the next one attaches.
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;

    const {
      axis,
      min,
      max,
      direction = 1,
      bodyClassNames,
      measureStartSize,
      onDragStart,
    } = optionsRef.current;
    const measured = measureStartSize?.(event);
    const startSize = measured != null && measured > 0 ? measured : sizeRef.current;
    const startPosition = axis === 'x' ? event.clientX : event.clientY;

    const onMove = (moveEvent: MouseEvent) => {
      const position = axis === 'x' ? moveEvent.clientX : moveEvent.clientY;
      const next = Math.max(min, startSize + (position - startPosition) * direction);
      setSize(max == null ? next : Math.min(max, next));
    };

    const cleanupDrag = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (bodyClassNames?.length) {
        document.body.classList.remove(...bodyClassNames);
      }
      setIsDragging(false);
    };

    const onUp = () => {
      cleanupDrag();
      dragCleanupRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    if (bodyClassNames?.length) {
      document.body.classList.add(...bodyClassNames);
    }
    dragCleanupRef.current = cleanupDrag;
    onDragStart?.();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  return { size, setSize, isDragging, handleResizeMouseDown };
}
