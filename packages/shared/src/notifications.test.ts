import { describe, expect, it } from 'vitest';
import {
  ATTENTION_REQUIRED_NOTIFICATION_KINDS,
  filterAttentionRequiredNotifications,
  isAttentionRequiredNotification,
  isAttentionRequiredNotificationKind,
  notificationEventFlagForKind,
} from './notifications';
import type { NotificationRecord } from './types';

function makeNotification(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 'notification-1',
    threadId: 'thread-1',
    projectId: 'project-1',
    kind: 'failed',
    title: 'Title',
    body: 'Body',
    createdAt: new Date().toISOString(),
    dismissedAt: null,
    ...overrides,
  };
}

describe('notifications helpers', () => {
  it('marks only action-required kinds as attention-required', () => {
    expect(ATTENTION_REQUIRED_NOTIFICATION_KINDS).toEqual([
      'approval',
      'failed',
      'completed',
      'verification_exhausted',
      'ci_blocked',
    ]);
    expect(isAttentionRequiredNotificationKind('approval')).toBe(true);
    expect(isAttentionRequiredNotificationKind('failed')).toBe(true);
    expect(isAttentionRequiredNotificationKind('completed')).toBe(true);
    expect(isAttentionRequiredNotificationKind('verification_exhausted')).toBe(true);
    expect(isAttentionRequiredNotificationKind('ci_blocked')).toBe(true);
    expect(isAttentionRequiredNotification(makeNotification({ kind: 'failed' }))).toBe(true);
  });

  it('keeps completed notifications in attention-required lists', () => {
    const notifications = [
      makeNotification({ id: 'n1', kind: 'approval' }),
      makeNotification({ id: 'n2', kind: 'completed' }),
      makeNotification({ id: 'n3', kind: 'failed' }),
      makeNotification({ id: 'n4', kind: 'verification_exhausted' }),
      makeNotification({ id: 'n5', kind: 'ci_blocked' }),
    ];

    expect(filterAttentionRequiredNotifications(notifications).map((n) => n.id)).toEqual([
      'n1',
      'n2',
      'n3',
      'n4',
      'n5',
    ]);
  });

  it('maps notification kinds to event toggle keys', () => {
    expect(notificationEventFlagForKind('approval')).toBe('approval');
    expect(notificationEventFlagForKind('failed')).toBe('failed');
    expect(notificationEventFlagForKind('completed')).toBe('completed');
    expect(notificationEventFlagForKind('verification_exhausted')).toBe('verificationExhausted');
    expect(notificationEventFlagForKind('ci_blocked')).toBe('ciBlocked');
  });
});
