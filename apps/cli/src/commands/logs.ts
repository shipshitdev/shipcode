import { createCliContext } from '../context';
import { requireOnboarding } from './guard';
import { parseIssueNumberOrExit } from './issue-number';

/**
 * `shipcode logs <issue-number>`
 *
 * Read terminal_events for the thread. Stream to stdout as formatted text.
 * DB read only — historical events, not real-time.
 */
export async function logsCommand(issueNumber: string) {
  if (!requireOnboarding()) return;

  const num = parseIssueNumberOrExit(issueNumber);
  const ctx = createCliContext(process.cwd());

  const thread = ctx.threads.getByProjectAndGithubIssue(ctx.project.id, num);
  if (!thread) {
    console.error(`No thread found for issue #${num} in this project.`);
    process.exit(1);
  }

  console.log(`Logs for issue #${num}: ${thread.title}`);
  console.log(`Status: ${thread.status}\n`);

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
        process.stdout.write(data.content);
        break;
      case 'thinking':
        console.log(`[${time}] Thinking: ${data.content.slice(0, 120)}...`);
        break;
      case 'tool_start':
        console.log(`[${time}] Tool: ${data.name} — ${data.summary}`);
        break;
      case 'tool_end':
        if (data.exitCode != null && data.exitCode !== 0) {
          console.log(`[${time}] Tool done: ${data.name} (exit ${data.exitCode})`);
        }
        break;
      case 'lifecycle':
        process.stdout.write(`[${time}] ${data.message}`);
        break;
      case 'raw':
        process.stdout.write(data.content);
        break;
      case 'error':
        console.log(`[${time}] Error: ${data.message}`);
        break;
      case 'clarification_requested':
        console.log(`[${time}] Clarification requested: ${data.summary}`);
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
