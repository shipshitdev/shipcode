import type { NotificationKind, NotificationRecord } from './types';

export const ATTENTION_REQUIRED_NOTIFICATION_KINDS: NotificationKind[] = [
  'awaiting_approval',
  'failed',
  'completed',
  'verification_exhausted',
  'ci_blocked',
];

export function isAttentionRequiredNotificationKind(kind: NotificationKind): boolean {
  return ATTENTION_REQUIRED_NOTIFICATION_KINDS.includes(kind);
}

export function isAttentionRequiredNotification(
  notification: Pick<NotificationRecord, 'kind'>,
): boolean {
  return isAttentionRequiredNotificationKind(notification.kind);
}

export function filterAttentionRequiredNotifications<T extends Pick<NotificationRecord, 'kind'>>(
  notifications: T[],
): T[] {
  return notifications.filter(isAttentionRequiredNotification);
}
