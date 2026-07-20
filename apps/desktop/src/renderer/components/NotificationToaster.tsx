import type { NotificationKind, NotificationRecord } from '@shipcode/shared';
import { useEffect, useRef } from 'react';
import notifySoundUrl from '../assets/notify.wav?url';
import { useAppSettings } from '../hooks/useAppSettings';
import { useAppStore } from '../stores/app-store';
import { InAppNotification, useToastExit } from './InAppNotification';

const STICKY_KINDS: NotificationKind[] = ['approval', 'verification_exhausted', 'ci_blocked'];

const AUTO_DISMISS_MS: Partial<Record<NotificationKind, number>> = {
  failed: 4_000,
  completed: 3_000,
};

const KIND_TONE: Record<NotificationKind, 'warning' | 'danger' | 'success'> = {
  approval: 'warning',
  failed: 'danger',
  verification_exhausted: 'danger',
  ci_blocked: 'danger',
  completed: 'success',
};

function ToastRow({
  notification,
  onClick,
  onHide,
  onDismiss,
}: {
  notification: NotificationRecord;
  onClick: () => void;
  onHide: () => void;
  onDismiss: () => void;
}) {
  const sticky = STICKY_KINDS.includes(notification.kind);
  const dismissAfterMs = AUTO_DISMISS_MS[notification.kind] ?? 5_000;
  const { isExiting, triggerExit } = useToastExit(sticky ? undefined : dismissAfterMs, onHide);

  return (
    <div className={isExiting ? 'animate-toast-exit' : 'animate-toast-enter'}>
      <InAppNotification
        title={notification.title}
        description={notification.body}
        tone={KIND_TONE[notification.kind] ?? 'default'}
        onClick={onClick}
        onDismiss={() => triggerExit(onDismiss)}
      />
    </div>
  );
}

export function NotificationToaster() {
  const notifications = useAppStore((s) => s.notifications);
  const removeNotification = useAppStore((s) => s.removeNotification);
  const selectProject = useAppStore((s) => s.selectProject);
  const selectThread = useAppStore((s) => s.selectThread);
  const setViewMode = useAppStore((s) => s.setViewMode);

  const { data: settings } = useAppSettings({ enabled: notifications.length > 0 });

  const lastSeenIdsRef = useRef<Set<string> | null>(null);
  if (lastSeenIdsRef.current === null) {
    lastSeenIdsRef.current = new Set();
  }
  const lastSeenIds = lastSeenIdsRef.current;

  // Play sound when a new notification appears.
  useEffect(() => {
    if (!settings?.notificationSoundEnabled) return;
    const newOnes = notifications.filter((n) => !lastSeenIds.has(n.id));
    if (newOnes.length > 0) {
      try {
        const audio = new Audio(notifySoundUrl);
        audio.volume = 0.5;
        audio.play().catch(() => {
          // Autoplay may be blocked until first user interaction; safe to ignore.
        });
      } catch {
        // Ignore audio failures
      }
    }
    lastSeenIds.clear();
    for (const notification of notifications) {
      lastSeenIds.add(notification.id);
    }
  }, [lastSeenIds, notifications, settings?.notificationSoundEnabled]);

  const handleClick = (notification: NotificationRecord) => {
    if (notification.projectId) selectProject(notification.projectId);
    selectThread(notification.threadId);
    setViewMode('project');
    removeNotification(notification.id);
  };

  const handleHide = (id: string) => {
    removeNotification(id);
  };

  const handleDismiss = (id: string) => {
    window.shipcode.invoke('notification:dismiss', { id }).catch(() => {});
    removeNotification(id);
  };

  if (notifications.length === 0) return null;

  return (
    <div
      data-testid="notification-toaster"
      className="pointer-events-none fixed right-4 top-[calc(var(--spacing-titlebar)+0.75rem)] z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {notifications.slice(0, 5).map((n) => (
        <div key={n.id} className="pointer-events-auto">
          <ToastRow
            notification={n}
            onClick={() => handleClick(n)}
            onHide={() => handleHide(n.id)}
            onDismiss={() => handleDismiss(n.id)}
          />
        </div>
      ))}
    </div>
  );
}
