import { truncate } from '@shipcode/shared';
import { sanitizeCliText } from '../adapters/cli-emitter';
import { createCliContext } from '../context';
import { requireOnboarding } from './guard';
import { getThreadForIssueOrExit, parseIssueNumber } from './issue-helpers';

/**
 * `shipcode logs <issue-number>`
 *
 * Read terminal_events for the thread. Stream to stdout as formatted text.
 * DB read only — historical events, not real-time.
 */
export async function logsCommand(issueNumber: string) {
  if (!requireOnboarding()) return;

  const num = parseIssueNumber(issueNumber);
  const ctx = createCliContext(process.cwd());
  const thread = getThreadForIssueOrExit(ctx, num);

  console.log(`Logs for issue #${num}: ${sanitizeCliText(thread.title)}`);
  console.log(`Status: ${sanitizeCliText(thread.status)}\n`);

  const events = ctx.terminalEvents.listByThread(thread.id);
  if (events.length === 0) {
    console.log('No terminal events recorded.');
    return;
  }

  for (const event of events) {
    const time = new Date(event.createdAt).toISOString().split('T')[1].slice(0, 8);
    const data = event.event;

    switch (data.kind) {
      case 'text':
        process.stdout.write(sanitizeCliText(data.content));
        break;
      case 'thinking':
        console.log(`[${time}] Thinking: ${truncate(sanitizeCliText(data.content), 120, '...')}`);
        break;
      case 'tool_start':
        console.log(
          `[${time}] Tool: ${sanitizeCliText(data.name)} — ${sanitizeCliText(data.summary)}`,
        );
        break;
      case 'tool_end':
        if (data.exitCode != null && data.exitCode !== 0) {
          console.log(`[${time}] Tool done: ${sanitizeCliText(data.name)} (exit ${data.exitCode})`);
        }
        break;
      case 'lifecycle':
        process.stdout.write(`[${time}] ${sanitizeCliText(data.message)}`);
        break;
      case 'raw':
        process.stdout.write(sanitizeCliText(data.content));
        break;
      case 'error':
        console.log(`[${time}] Error: ${sanitizeCliText(data.message)}`);
        break;
      case 'clarification_requested':
        console.log(`[${time}] Clarification requested: ${sanitizeCliText(data.summary)}`);
        break;
      case 'clarification_answered':
        console.log(`[${time}] Clarification answered (${data.questionCount} questions)`);
        break;
      case 'done':
        if (data.totalCostUsd != null) {
          console.log(`[${time}] Done — cost: $${data.totalCostUsd.toFixed(4)}`);
        } else {
          console.log(`[${time}] Done`);
        }
        break;
      case 'turn_start':
      case 'turn_end':
      case 'action':
        // Skip UI-specific events in CLI output
        break;
    }
  }
}
