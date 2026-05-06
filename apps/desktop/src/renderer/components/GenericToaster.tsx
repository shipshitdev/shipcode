import { useCallback, useEffect, useState } from 'react';
import { type ToastRecord, toastTone, useToastStore } from '../stores/toast-store';
import { InAppNotification } from './InAppNotification';

function ToastRow({ toast, onHide }: { toast: ToastRecord; onHide: () => void }) {
  const [isExiting, setIsExiting] = useState(false);

  const triggerExit = useCallback(() => {
    setIsExiting(true);
    setTimeout(onHide, 220);
  }, [onHide]);

  useEffect(() => {
    const id = setTimeout(triggerExit, 4000);
    return () => clearTimeout(id);
  }, [triggerExit]);

  return (
    <div className={isExiting ? 'animate-toast-exit' : 'animate-toast-enter'}>
      <InAppNotification
        title={toast.title}
        description={toast.body}
        tone={toastTone(toast.kind)}
        onDismiss={triggerExit}
      />
    </div>
  );
}

export function GenericToaster() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed left-1/2 top-[calc(var(--spacing-titlebar)+0.75rem)] z-[60] flex w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-2">
      {toasts.slice(0, 3).map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastRow toast={t} onHide={() => removeToast(t.id)} />
        </div>
      ))}
    </div>
  );
}
