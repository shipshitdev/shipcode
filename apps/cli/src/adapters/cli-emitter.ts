import type { PipelineEmitter, PipelineEvent } from '@shipcode/pipeline';

export function createCliEmitter(): PipelineEmitter {
  return {
    emit(event: PipelineEvent) {
      const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
      switch (event.type) {
        case 'pipeline:phase':
          console.log(`[${timestamp}] Phase: ${event.phase}`);
          break;
        case 'pipeline:verification-exhausted':
          console.log(`[${timestamp}] Verification exhausted after ${event.retries} retries`);
          break;
        case 'pipeline:model-resolved': {
          // Build tokens and cost as independent segments. A provider
          // can theoretically report cost without tokens (unusual but
          // possible) — the previous nested check dropped the cost in
          // that case. CodeRabbit flagged this on the initial Tier 3.
          const parts: string[] = [];
          if (event.tokensUsed) {
            parts.push(`${event.tokensUsed.prompt}+${event.tokensUsed.completion} tok`);
          }
          if (event.costUsd != null) {
            parts.push(`$${event.costUsd.toFixed(4)}`);
          }
          const extras = parts.length > 0 ? ` (${parts.join(', ')})` : '';
          const via =
            event.requestedModel !== event.resolvedModel ? ` via ${event.requestedModel}` : '';
          console.log(
            `[${timestamp}] ${event.phase}: routed to ${event.resolvedModel}${via}${extras}`,
          );
          break;
        }
        case 'plan:parsed':
          console.log(`[${timestamp}] Plan generated: ${event.plan.objective}`);
          break;
        case 'review:parsed':
          console.log(
            `[${timestamp}] Review: ${event.review.decision} (${event.review.confidence})`,
          );
          if (event.review.findings.length > 0) {
            for (const f of event.review.findings) {
              console.log(`  [${f.severity}] ${f.description}`);
            }
          }
          break;
        case 'verification:parsed':
          console.log(`[${timestamp}] Verification: ${event.verification.result}`);
          break;
      }
    },
  };
}
