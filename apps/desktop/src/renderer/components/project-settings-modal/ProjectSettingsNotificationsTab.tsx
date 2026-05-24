import type { ProjectNotificationRoutingMode } from '@shipcode/shared';
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
} from '@shipshitdev/ui';

export function ProjectSettingsNotificationsTab({
  discordRouting,
  discordWebhookUrlOverride,
  telegramRouting,
  telegramChatIdOverride,
  notifyGithubUser,
  onDiscordRoutingChange,
  onDiscordWebhookChange,
  onTelegramRoutingChange,
  onTelegramChatIdChange,
  onNotifyGithubUserChange,
}: {
  discordRouting: ProjectNotificationRoutingMode;
  discordWebhookUrlOverride: string;
  telegramRouting: ProjectNotificationRoutingMode;
  telegramChatIdOverride: string;
  notifyGithubUser: string;
  onDiscordRoutingChange: (value: ProjectNotificationRoutingMode) => void;
  onDiscordWebhookChange: (value: string) => void;
  onTelegramRoutingChange: (value: ProjectNotificationRoutingMode) => void;
  onTelegramChatIdChange: (value: string) => void;
  onNotifyGithubUserChange: (value: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="text-xs text-muted-foreground">
        GitHub's built-in integrations forward issue events to Discord and Slack automatically. The
        routing below is for ShipCode pipeline events (plan started, execution failed, etc.) that
        don't create GitHub activity.
      </div>

      <section>
        <SettingsRow label="Discord routing">
          <Select
            value={discordRouting}
            onValueChange={(value) =>
              onDiscordRoutingChange(value as ProjectNotificationRoutingMode)
            }
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Inherit global default</SelectItem>
              <SelectItem value="disabled">Disable for this project</SelectItem>
              <SelectItem value="custom">Use custom webhook</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        {discordRouting === 'custom' ? (
          <SettingsRow label="Discord webhook URL">
            <Input
              className="w-[320px]"
              value={discordWebhookUrlOverride}
              onChange={(e) => onDiscordWebhookChange(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              autoComplete="off"
              spellCheck={false}
            />
          </SettingsRow>
        ) : null}

        <SettingsRow label="Telegram routing">
          <Select
            value={telegramRouting}
            onValueChange={(value) =>
              onTelegramRoutingChange(value as ProjectNotificationRoutingMode)
            }
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Inherit global default</SelectItem>
              <SelectItem value="disabled">Disable for this project</SelectItem>
              <SelectItem value="custom">Use custom chat ID</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        {telegramRouting === 'custom' ? (
          <SettingsRow label="Telegram chat ID">
            <Input
              className="w-[220px]"
              value={telegramChatIdOverride}
              onChange={(e) => onTelegramChatIdChange(e.target.value)}
              placeholder="-1001234567890"
              autoComplete="off"
              spellCheck={false}
            />
          </SettingsRow>
        ) : null}
      </section>

      <section>
        <SettingsRow
          label="Issue rewrite @mention"
          htmlFor="notify-github-user"
          description="Tagged on every issue rewrite alongside the issue author. Leave blank to only tag the author."
        >
          <Input
            id="notify-github-user"
            type="text"
            className="w-[220px]"
            value={notifyGithubUser}
            onChange={(e) => onNotifyGithubUserChange(e.target.value)}
            placeholder="github-handle"
            autoComplete="off"
            spellCheck={false}
          />
        </SettingsRow>
      </section>
    </div>
  );
}
