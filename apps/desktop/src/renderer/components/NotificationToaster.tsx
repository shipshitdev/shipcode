import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AppSettings, NotificationKind, NotificationRecord } from '@shipcode/shared';
import { Button, X } from '@shipcode/ui';
import { useAppStore } from '../stores/app-store';
import notifySoundUrl from '../assets/notify.wav?url';

const STICKY_KINDS: NotificationKind[] = [
  'awaiting_approval',
  'verification_exhausted',
  'ci_blocked',
];
const AUTO_DISMISS_MS = 8_000;

const KIND_TONE: Record<NotificationKind, string> = {
  awaiting_approval: 'border-amber-500/40 bg-amber-500/10',
  failed: 'border-danger/40 bg-danger/10',
  verification_exhausted: 'border-danger/40 bg-danger/10',
  ci_blocked: 'border-danger/40 bg-danger/10',
  completed: 'border-success/40 bg-success/10',
};

function ToastRow({
  notification,
  onClick,
  onDismiss,
}: {
  notification: NotificationRecord;
  onClick: () => void;
  onDismiss: () => void;
}) {
  const sticky = STICKY_KINDS.includes(notification.kind);

  useEffect(() => {
    if (sticky) return;
    const id = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [sticky, onDismiss]);

  return (
    <div
      className={`group flex items-start gap-2 rounded-xl border px-3 py-2.5 shadow-lg backdrop-blur-sm ${
        KIND_TONE[notification.kind] ?? 'border-border bg-elevated'
      }`}
    >
      <Button
        variant="ghost"
        onClick={onClick}
        className="h-auto flex-1 justify-start whitespace-normal px-0 py-0 text-left font-normal"
      >
        <div className="flex flex-col items-start gap-0.5">
          <div className="text-[12px] font-semibold text-primary">{notification.title}</div>
          <div className="text-[11px] text-secondary">{notification.body}</div>
        </div>
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDismiss}
        className="text-muted"
        title="Dismiss"
      >
        <X size={14} />
      </Button>
    </div>
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
    window.shipcode.invoke('notification:dismiss', { id: notification.id }).catch(() => {});
    removeNotification(notification.id);
  };

  const handleDismiss = (id: string) => {
    window.shipcode.invoke('notification:dismiss', { id }).catch(() => {});
    removeNotification(id);
  };

  if (notifications.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
      {notifications.slice(0, 5).map((n) => (
        <div key={n.id} className="pointer-events-auto">
          <ToastRow
            notification={n}
            onClick={() => handleClick(n)}
            onDismiss={() => handleDismiss(n.id)}
          />
        </div>
      ))}
    </div>
  );
}
