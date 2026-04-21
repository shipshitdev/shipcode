import { createPipeline } from '@shipcode/pipeline';
import { createCliContext } from '../context';
import { requireOnboarding } from './guard';

/**
 * `shipcode approve <issue-number>`
 *
 * Read thread from DB. Verify status is awaiting_approval.
 * Resume execution from the saved plan.
 */
export async function approveCommand(issueNumber: string) {
  if (!requireOnboarding()) return;

  const num = parseInt(issueNumber, 10);
  if (Number.isNaN(num)) {
    console.error('Invalid issue number:', issueNumber);
    process.exit(1);
  }

  const ctx = createCliContext(process.cwd());

  const thread = ctx.threads.getByProjectAndGithubIssue(ctx.project.id, num);
  if (!thread) {
    console.error(`No thread found for issue #${num} in this project.`);
    process.exit(1);
  }

  if (thread.status !== 'awaiting_approval') {
    console.error(
      `Thread is in "${thread.status}" state, not "awaiting_approval". Cannot approve.`,
    );
    process.exit(1);
  }

  const latestPlan = ctx.plans.getLatest(thread.id);
  if (!latestPlan?.structured) {
    console.error('No plan found for this thread.');
    process.exit(1);
  }

  console.log(`Approving plan for issue #${num}: ${thread.title}`);
  console.log(`Plan objective: ${latestPlan.structured.objective}`);
  console.log('Starting execution...\n');

  const pipeline = createPipeline(ctx.pipelineDeps);
  pipeline.rehydrateContext(thread.id, ctx.project.path, thread.title);
  ctx.plans.updateStatus(latestPlan.id, 'approved');
  await pipeline.startExecution(thread.id, latestPlan.structured);

  console.log('\nExecution started.');
}
