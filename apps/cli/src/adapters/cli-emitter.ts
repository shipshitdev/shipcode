import type { PipelineEmitter, PipelineEvent } from '@shipcode/pipeline';

// biome-ignore lint/suspicious/noControlCharactersInRegex: these intentionally strip terminal controls from untrusted CLI output.
const oscSequencePattern = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: these intentionally strip terminal controls from untrusted CLI output.
const csiSequencePattern = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: this intentionally strips C0/C1 controls from untrusted CLI output.
const controlCharacterPattern = /[\u0000-\u0008\u000b-\u000e\u0010-\u001f\u007f-\u009f]/g;

export function sanitizeCliText(value: string): string {
  return value
    .replace(oscSequencePattern, '')
    .replace(csiSequencePattern, '')
    .replace(controlCharacterPattern, '');
}

export function createCliEmitter(): PipelineEmitter {
  return {
    emit(event: PipelineEvent) {
      const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
      switch (event.type) {
        case 'pipeline:phase':
          console.log(`[${timestamp}] Phase: ${event.phase}`);
          break;
        case 'pipeline:start-context':
          console.log(
            `[${timestamp}] Start: ${event.source} autonomous=${event.autonomous ? 'yes' : 'no'} requireApproval=${event.requireApproval ? 'yes' : 'no'}`,
          );
          break;
        case 'pipeline:approval-gate':
          console.log(
            `[${timestamp}] Approval gate: ${sanitizeCliText(event.outcome)} after ${sanitizeCliText(event.reviewDecision)} (${event.reasons.map(sanitizeCliText).join(', ')})`,
          );
          break;
        case 'pipeline:verification-exhausted':
          console.log(`[${timestamp}] Verification exhausted after ${event.retries} retries`);
          break;
        case 'pipeline:turn-started':
          console.log(`[${timestamp}] Turn ${event.turnNumber} started`);
          break;
        case 'pipeline:turn-completed':
          console.log(
            `[${timestamp}] Turn ${event.turnNumber} completed: ${sanitizeCliText(event.result)}`,
          );
          break;
        case 'pipeline:model-resolved': {
          // Build tokens and cost as independent segments so cost still
          // renders when a provider reports it without token totals.
          const parts: string[] = [];
          if (event.tokensUsed) {
            parts.push(`${event.tokensUsed.prompt}+${event.tokensUsed.completion} tok`);
          }
          if (event.costUsd != null) {
            parts.push(`$${event.costUsd.toFixed(4)}`);
          }
          const extras = parts.length > 0 ? ` (${parts.join(', ')})` : '';
          const via =
            event.requestedModel !== event.resolvedModel
              ? ` via ${sanitizeCliText(event.requestedModel)}`
              : '';
          console.log(
            `[${timestamp}] ${sanitizeCliText(event.phase)}: routed to ${sanitizeCliText(event.resolvedModel)}${via}${extras}`,
          );
          break;
        }
        case 'plan:parsed':
          console.log(`[${timestamp}] Plan generated: ${sanitizeCliText(event.plan.objective)}`);
          break;
        case 'review:parsed':
          console.log(
            `[${timestamp}] Review: ${sanitizeCliText(event.review.decision)} (${sanitizeCliText(event.review.confidence)})`,
          );
          if (event.review.findings.length > 0) {
            for (const f of event.review.findings) {
              console.log(`  [${sanitizeCliText(f.severity)}] ${sanitizeCliText(f.description)}`);
            }
          }
          break;
        case 'verification:parsed':
          console.log(`[${timestamp}] Verification: ${sanitizeCliText(event.verification.result)}`);
          break;
        case 'skill:fallback':
          console.log(
            `[${timestamp}] Skill fallback: ${sanitizeCliText(event.phase)} (${sanitizeCliText(event.reason)})`,
          );
          break;
        case 'workflow:warning':
          console.log(
            `[${timestamp}] WORKFLOW.md warning: ${sanitizeCliText(event.warning.message)}`,
          );
          break;
        case 'terminal:event':
        case 'pipeline:output':
          break;
        default: {
          const _exhaustive: never = event;
          throw new Error(`CLI emitter: unknown pipeline event ${JSON.stringify(_exhaustive)}`);
        }
      }
    },
  };
}
