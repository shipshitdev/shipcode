import type { AppSettings } from '@shipcode/shared';
import { SettingsSection } from '@shipcode/ui';
import { SettingsRow, Switch } from '@shipshitdev/ui';

export function NotificationsSettingsSection({
  settings,
  onUpdate,
}: {
  settings: AppSettings;
  onUpdate: (patch: Partial<AppSettings>) => void;
}) {
  return (
    <>
      <h3 className="mb-5">Notifications</h3>

      <SettingsSection title="Desktop alerts">
        <SettingsRow label="Enable notifications" htmlFor="notifications-enabled">
          <Switch
            id="notifications-enabled"
            checked={settings.notificationsEnabled}
            onCheckedChange={(checked: boolean) => onUpdate({ notificationsEnabled: !!checked })}
          />
        </SettingsRow>
        <SettingsRow label="OS notifications" htmlFor="notification-os">
          <Switch
            id="notification-os"
            checked={settings.notificationOsEnabled}
            onCheckedChange={(checked: boolean) => onUpdate({ notificationOsEnabled: !!checked })}
            disabled={!settings.notificationsEnabled}
          />
        </SettingsRow>
        <SettingsRow label="Dock badge count" htmlFor="notification-badge">
          <Switch
            id="notification-badge"
            checked={settings.notificationBadgeEnabled}
            onCheckedChange={(checked: boolean) =>
              onUpdate({ notificationBadgeEnabled: !!checked })
            }
            disabled={!settings.notificationsEnabled}
          />
        </SettingsRow>
        <SettingsRow label="Play sound" htmlFor="notification-sound">
          <Switch
            id="notification-sound"
            checked={settings.notificationSoundEnabled}
            onCheckedChange={(checked: boolean) =>
              onUpdate({ notificationSoundEnabled: !!checked })
            }
            disabled={!settings.notificationsEnabled}
          />
        </SettingsRow>

        <p className="mt-4 mb-1 text-xs uppercase tracking-wide text-muted">Notify me when</p>

        <SettingsRow label="Needs approval" htmlFor="notify-awaiting-approval">
          <Switch
            id="notify-awaiting-approval"
            checked={settings.notificationEvents.awaitingApproval}
            onCheckedChange={(checked: boolean) =>
              onUpdate({
                notificationEvents: {
                  ...settings.notificationEvents,
                  awaitingApproval: !!checked,
                },
              })
            }
            disabled={!settings.notificationsEnabled}
          />
        </SettingsRow>
        <SettingsRow label="Pipeline failed" htmlFor="notify-failed">
          <Switch
            id="notify-failed"
            checked={settings.notificationEvents.failed}
            onCheckedChange={(checked: boolean) =>
              onUpdate({
                notificationEvents: { ...settings.notificationEvents, failed: !!checked },
              })
            }
            disabled={!settings.notificationsEnabled}
          />
        </SettingsRow>
        <SettingsRow label="CI blocked" htmlFor="notify-ci-blocked">
          <Switch
            id="notify-ci-blocked"
            checked={settings.notificationEvents.ciBlocked}
            onCheckedChange={(checked: boolean) =>
              onUpdate({
                notificationEvents: { ...settings.notificationEvents, ciBlocked: !!checked },
              })
            }
            disabled={!settings.notificationsEnabled}
          />
        </SettingsRow>
        <SettingsRow label="Pipeline completed" htmlFor="notify-completed">
          <Switch
            id="notify-completed"
            checked={settings.notificationEvents.completed}
            onCheckedChange={(checked: boolean) =>
              onUpdate({
                notificationEvents: { ...settings.notificationEvents, completed: !!checked },
              })
            }
            disabled={!settings.notificationsEnabled}
          />
        </SettingsRow>
        <SettingsRow label="Verification retries exhausted" htmlFor="notify-verification-exhausted">
          <Switch
            id="notify-verification-exhausted"
            checked={settings.notificationEvents.verificationExhausted}
            onCheckedChange={(checked: boolean) =>
              onUpdate({
                notificationEvents: {
                  ...settings.notificationEvents,
                  verificationExhausted: !!checked,
                },
              })
            }
            disabled={!settings.notificationsEnabled}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Chat alerts">
        <SettingsRow label="Chat: needs approval" htmlFor="chat-awaiting-approval">
          <Switch
            id="chat-awaiting-approval"
            aria-label="Chat alert: Needs approval"
            checked={settings.chatNotificationEvents.awaitingApproval}
            onCheckedChange={(checked: boolean) =>
              onUpdate({
                chatNotificationEvents: {
                  ...settings.chatNotificationEvents,
                  awaitingApproval: !!checked,
                },
              })
            }
          />
        </SettingsRow>
        <SettingsRow label="Chat: pipeline failed" htmlFor="chat-failed">
          <Switch
            id="chat-failed"
            aria-label="Chat alert: Pipeline failed"
            checked={settings.chatNotificationEvents.failed}
            onCheckedChange={(checked: boolean) =>
              onUpdate({
                chatNotificationEvents: {
                  ...settings.chatNotificationEvents,
                  failed: !!checked,
                },
              })
            }
          />
        </SettingsRow>
        <SettingsRow label="Chat: CI blocked" htmlFor="chat-ci-blocked">
          <Switch
            id="chat-ci-blocked"
            aria-label="Chat alert: CI blocked"
            checked={settings.chatNotificationEvents.ciBlocked}
            onCheckedChange={(checked: boolean) =>
              onUpdate({
                chatNotificationEvents: {
                  ...settings.chatNotificationEvents,
                  ciBlocked: !!checked,
                },
              })
            }
          />
        </SettingsRow>
        <SettingsRow label="Chat: pipeline completed" htmlFor="chat-completed">
          <Switch
            id="chat-completed"
            aria-label="Chat alert: Pipeline completed"
            checked={settings.chatNotificationEvents.completed}
            onCheckedChange={(checked: boolean) =>
              onUpdate({
                chatNotificationEvents: {
                  ...settings.chatNotificationEvents,
                  completed: !!checked,
                },
              })
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Chat: verification retries exhausted"
          htmlFor="chat-verification-exhausted"
        >
          <Switch
            id="chat-verification-exhausted"
            aria-label="Chat alert: Verification retries exhausted"
            checked={settings.chatNotificationEvents.verificationExhausted}
            onCheckedChange={(checked: boolean) =>
              onUpdate({
                chatNotificationEvents: {
                  ...settings.chatNotificationEvents,
                  verificationExhausted: !!checked,
                },
              })
            }
          />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
