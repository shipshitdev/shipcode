import { PageHeader } from '@shipcode/ui';
import { Textarea } from '@shipshitdev/ui';

export function ConversationHome() {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-primary" data-testid="conversation-home">
      <PageHeader
        title="Conversation"
        subtitle="One issue is one agent. Pick a thread from the list."
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col items-start justify-center gap-3 px-8">
          <p className="font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
            Agent
          </p>
          <p className="max-w-md text-[15px] font-medium tracking-tight text-primary">
            Talk to Claude, Codex, or Grok on an issue.
          </p>
          <p className="max-w-md text-[12px] leading-5 text-secondary">
            Select an issue in the sidebar. ShipCode is the window around the official CLI — not a
            second harness.
          </p>
        </div>
        <div className="shrink-0 border-t border-border/70 bg-primary p-3">
          <div className="flex w-full flex-col rounded-md border border-border/80 bg-elevated/60">
            <Textarea
              disabled
              placeholder="Select an issue to start a conversation…"
              className="min-h-[76px] resize-none border-0 bg-transparent text-xs shadow-none focus-visible:ring-0"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
