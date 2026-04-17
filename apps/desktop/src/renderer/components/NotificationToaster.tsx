import type { AppSettings, NotificationKind, NotificationRecord } from '@shipcode/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import notifySoundUrl from '../assets/notify.wav?url';
import { STABLE_APP_STATE_STALE_TIME } from '../query-stale-times';
import { useAppStore } from '../stores/app-store';
import { InAppNotification } from './InAppNotification';

const STICKY_KINDS: NotificationKind[] = [
  'awaiting_approval',
  'verification_exhausted',
  'ci_blocked',
];

const AUTO_DISMISS_MS: Partial<Record<NotificationKind, number>> = {
  failed: 4_000,
  completed: 3_000,
};

const KIND_TONE: Record<NotificationKind, 'warning' | 'danger' | 'success'> = {
  awaiting_approval: 'warning',
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

  useEffect(() => {
    if (sticky) return;
    const id = setTimeout(onHide, dismissAfterMs);
    return () => clearTimeout(id);
  }, [dismissAfterMs, sticky, onHide]);

  return (
    <InAppNotification
      title={notification.title}
      description={notification.body}
      tone={KIND_TONE[notification.kind] ?? 'default'}
      onClick={onClick}
      onDismiss={onDismiss}
    />
  );
}

export function NotificationToaster() {
  const notifications = useAppStore((s) => s.notifications);
  const removeNotification = useAppStore((s) => s.removeNotification);
  const selectProject = useAppStore((s) => s.selectProject);
  const selectThread = useAppStore((s) => s.selectThread);
  const setViewMode = useAppStore((s) => s.setViewMode);

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: () => window.shipcode.invoke<AppSettings>('settings:get'),
    enabled: notifications.length > 0,
    staleTime: STABLE_APP_STATE_STALE_TIME,
  });

  const lastSeenIdsRef = useRef<Set<string>>(new Set());

  // Play sound when a new notification appears.
  useEffect(() => {
    if (!settings?.notificationSoundEnabled) return;
    const seen = lastSeenIdsRef.current;
    const newOnes = notifications.filter((n) => !seen.has(n.id));
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
    lastSeenIdsRef.current = new Set(notifications.map((n) => n.id));
  }, [notifications, settings?.notificationSoundEnabled]);

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
