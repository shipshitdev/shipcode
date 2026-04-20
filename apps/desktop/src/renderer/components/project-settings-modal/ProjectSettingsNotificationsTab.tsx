import type { ProjectNotificationRoutingMode } from '@shipcode/shared';
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shipcode/ui';

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
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-secondary/30 p-3">
        <div className="text-[12px] font-medium text-primary">About notifications</div>
        <p className="mt-1 text-[11px] text-muted">
          GitHub's built-in integrations forward issue events to Discord and Slack automatically.
          The routing below is for ShipCode pipeline events (plan started, execution failed, etc.)
          that don't create GitHub activity.
        </p>
      </div>

      <div className="rounded-md border border-border bg-secondary/30 p-3">
        <div className="mb-2 text-[12px] font-medium text-primary">Chat routing overrides</div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs text-secondary">Discord routing</Label>
            <Select
              value={discordRouting}
              onValueChange={(value) =>
                onDiscordRoutingChange(value as ProjectNotificationRoutingMode)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">Inherit global default</SelectItem>
                <SelectItem value="disabled">Disable for this project</SelectItem>
                <SelectItem value="custom">Use custom webhook</SelectItem>
              </SelectContent>
            </Select>
            {discordRouting === 'custom' ? (
              <Input
                value={discordWebhookUrlOverride}
                onChange={(e) => onDiscordWebhookChange(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                autoComplete="off"
                spellCheck={false}
              />
            ) : null}
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-secondary">Telegram routing</Label>
            <Select
              value={telegramRouting}
              onValueChange={(value) =>
                onTelegramRoutingChange(value as ProjectNotificationRoutingMode)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">Inherit global default</SelectItem>
                <SelectItem value="disabled">Disable for this project</SelectItem>
                <SelectItem value="custom">Use custom chat ID</SelectItem>
              </SelectContent>
            </Select>
            {telegramRouting === 'custom' ? (
              <Input
                value={telegramChatIdOverride}
                onChange={(e) => onTelegramChatIdChange(e.target.value)}
                placeholder="-1001234567890"
                autoComplete="off"
                spellCheck={false}
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="notify-github-user" className="text-xs text-secondary">
          Notify GitHub user on issue rewrite
        </Label>
        <Input
          id="notify-github-user"
          type="text"
          value={notifyGithubUser}
          onChange={(e) => onNotifyGithubUserChange(e.target.value)}
          placeholder="github-handle (without @)"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-[11px] text-muted">
          When an issue is rewritten, ShipCode will @mention this user in the comment. Leave blank
          to only tag the issue author.
        </p>
      </div>
    </div>
  );
}
