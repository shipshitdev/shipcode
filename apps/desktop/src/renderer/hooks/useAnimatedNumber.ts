import { useEffect, useRef, useState } from 'react';

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Animates a number from its previous value to the target using requestAnimationFrame.
 * Respects prefers-reduced-motion — returns target instantly when enabled.
 */
export function useAnimatedNumber(target: number, duration = 600): number {
  const [displayed, setDisplayed] = useState(target);
  const prevRef = useRef(target);
  const frameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    // Respect prefers-reduced-motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayed(target);
      prevRef.current = target;
      return;
    }

    const from = prevRef.current;
    const to = target;

    if (from === to) return;

    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
    }
    startTimeRef.current = null;

    const animate = (timestamp: number) => {
      if (startTimeRef.current == null) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const current = Math.round(from + (to - from) * easeOutCubic(progress));
      setDisplayed(current);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        prevRef.current = to;
        frameRef.current = null;
      }
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration]);

  // Sync ref when target changes (for next animation start point)
  useEffect(() => {
    return () => {
      prevRef.current = target;
    };
  }, [target]);

  return displayed;
}
