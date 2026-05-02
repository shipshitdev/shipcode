import { createPipeline } from '@shipcode/pipeline';
import { createCliContext } from '../context';
import { requireOnboarding } from './guard';
import { getThreadForIssueOrExit, parseIssueNumber } from './issue-helpers';

/**
 * `shipcode retry <issue-number>`
 *
 * Read thread from DB. Find last checkpoint. Resume from that phase.
 * Essentially `run` but starting from saved state instead of scratch.
 */
export async function retryCommand(issueNumber: string) {
  if (!requireOnboarding()) return;

  const num = parseIssueNumber(issueNumber);
  const ctx = createCliContext(process.cwd());
  const thread = getThreadForIssueOrExit(ctx, num);

  const checkpoint = ctx.checkpoints.getLatest(thread.id);
  if (!checkpoint) {
    console.error('No checkpoint found for this thread. Nothing to retry from.');
    process.exit(1);
  }

  console.log(`Retrying issue #${num}: ${thread.title}`);
  console.log(`Last checkpoint: ${checkpoint.phase} (${checkpoint.reason})`);
  console.log(`Resuming from ${checkpoint.phase}...\n`);

  const pipeline = createPipeline(ctx.pipelineDeps);
  pipeline.rehydrateContext(thread.id, ctx.project.path, thread.title);

  // PipelineCheckpointPhase = 'executing' | 'verifying' | 'shipping'
  switch (checkpoint.phase) {
    case 'executing': {
      const latestPlan = ctx.plans.getLatest(thread.id);
      if (!latestPlan?.structured) {
        console.error('No plan found for retry.');
        process.exit(1);
      }
      await pipeline.startExecution(thread.id, latestPlan.structured);
      break;
    }
    case 'verifying':
      await pipeline.startVerification(thread.id);
      break;
    case 'shipping':
      await pipeline.startShipping(thread.id);
      break;
    default:
      // No checkpoint matches — re-run plan generation from scratch
      await pipeline.startPlanGeneration(
        thread.id,
        thread.prompt,
        ctx.project.path,
        thread.worktreePath,
      );
  }

  console.log('\nRetry started.');
}
