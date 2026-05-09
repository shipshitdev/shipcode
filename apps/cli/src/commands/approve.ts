import { createPipeline } from '@shipcode/pipeline';
import { PIPELINE_PHASE } from '@shipcode/shared';
import { createCliContext } from '../context';
import { requireOnboarding } from './guard';
import { getThreadForIssueOrExit, parseIssueNumber } from './issue-helpers';

/**
 * `shipcode approve <issue-number>`
 *
 * Read thread from DB. Verify status is approval.
 * Resume execution from the saved plan.
 */
export async function approveCommand(issueNumber: string) {
  if (!requireOnboarding()) return;

  const num = parseIssueNumber(issueNumber);
  const ctx = createCliContext(process.cwd());
  const thread = getThreadForIssueOrExit(ctx, num);

  if (thread.status !== PIPELINE_PHASE.approval) {
    console.error(`Thread is in "${thread.status}" state, not "approval". Cannot approve.`);
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
