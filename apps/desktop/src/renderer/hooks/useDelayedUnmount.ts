import { useEffect, useState } from 'react';

/**
 * Delays unmount so CSS exit animations can play before the component is removed.
 * Returns `shouldRender` (keep in DOM) and `isExiting` (apply exit animation class).
 */
export function useDelayedUnmount(visible: boolean, delayMs: number) {
  const [shouldRender, setShouldRender] = useState(visible);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      setIsExiting(false);
    } else if (shouldRender) {
      setIsExiting(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
        setIsExiting(false);
      }, delayMs);
      return () => clearTimeout(timer);
    }
  }, [visible, delayMs, shouldRender]);

  return { shouldRender, isExiting };
}
