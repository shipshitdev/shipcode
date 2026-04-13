import type { BrowserWindow } from 'electron';
import log from './logger.service';
import type { PipelineEmitter, PipelineEvent } from '@shipcode/pipeline';
import type { ActivityQueries, ThreadQueries } from '@shipcode/db';
import type { ActivityKind, PipelinePhase, Thread } from '@shipcode/shared';
import type { NotificationService } from './notification-service';

interface EmitterDeps {
  activity: ActivityQueries;
  threads: ThreadQueries;
  notifications: NotificationService;
  onPipelineTerminal?: () => void;
}

// Phase transitions that map to human-visible activity entries.
const PHASE_ACTIVITY: Partial<
  Record<PipelinePhase, { kind: ActivityKind; title: (t: Thread) => string; subtitle?: string }>
> = {
  planning: {
    kind: 'pipeline_started',
    title: (t) => `${t.title} — planning started`,
    subtitle: 'Claude is drafting the plan',
  },
  reviewing: {
    kind: 'phase_change',
    title: (t) => `${t.title} — in review`,
    subtitle: 'Codex is reviewing the plan',
  },
  revising: {
    kind: 'phase_change',
    title: (t) => `${t.title} — revising`,
    subtitle: 'Claude is revising the plan',
  },
  awaiting_approval: {
    kind: 'phase_change',
    title: (t) => `${t.title} — awaiting approval`,
    subtitle: 'Needs human review',
  },
  executing: {
    kind: 'phase_change',
    title: (t) => `${t.title} — executing`,
    subtitle: 'Claude is implementing',
  },
  testing: {
    kind: 'phase_change',
    title: (t) => `${t.title} — running tests`,
    subtitle: 'Executing test command',
  },
  verifying: {
    kind: 'phase_change',
    title: (t) => `${t.title} — verifying`,
    subtitle: 'Running verification',
  },
  shipping: {
    kind: 'phase_change',
    title: (t) => `${t.title} — shipping`,
    subtitle: 'Committing and pushing',
  },
  completed: {
    kind: 'pipeline_completed',
    title: (t) => `${t.title} — completed`,
    subtitle: 'PR ready',
  },
  failed: { kind: 'pipeline_failed', title: (t) => `${t.title} — failed` },
};

export function createElectronEmitter(
  mainWindow: BrowserWindow,
  deps: EmitterDeps,
): PipelineEmitter {
  function invalidateDashboard() {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('dashboard:invalidate', {
      kinds: ['stats', 'activity', 'running', 'recent'],
    });
  }

  function writeActivity(event: PipelineEvent, thread: Thread | null) {
    if (!thread) return;

    if (event.type === 'pipeline:phase') {
      // Ignore 'idle' — it's the cancel/reset state and would flood the feed.
      if (event.phase === 'idle') {
        deps.activity.create({
          threadId: thread.id,
          projectId: thread.projectId,
          kind: 'pipeline_cancelled',
          actor: 'human',
          title: `${thread.title} — cancelled`,
          subtitle: null,
          metadata: null,
        });
        return;
      }

      const meta = PHASE_ACTIVITY[event.phase];
      if (!meta) return;

      deps.activity.create({
        threadId: thread.id,
        projectId: thread.projectId,
        kind: meta.kind,
        actor:
          event.phase === 'reviewing' ? 'codex' : event.phase === 'completed' ? 'system' : 'claude',
        title: meta.title(thread),
        subtitle: meta.subtitle ?? null,
        metadata: { phase: event.phase },
      });
      return;
    }

    if (event.type === 'pipeline:verification-exhausted') {
      deps.activity.create({
        threadId: thread.id,
        projectId: thread.projectId,
        kind: 'pipeline_verification_exhausted',
        actor: 'system',
        title: `${thread.title} — verification retries exhausted`,
        subtitle: `${event.retries} retries`,
        metadata: { retries: event.retries },
      });
      return;
    }

    if (event.type === 'plan:parsed') {
      deps.activity.create({
        threadId: thread.id,
        projectId: thread.projectId,
        kind: 'plan_parsed',
        actor: 'claude',
        title: `${thread.title} — plan ready`,
        subtitle: event.plan.objective ?? null,
        metadata: null,
      });
      return;
    }

    if (event.type === 'review:parsed') {
      deps.activity.create({
        threadId: thread.id,
        projectId: thread.projectId,
        kind: 'review_parsed',
        actor: 'codex',
        title: `${thread.title} — review: ${event.review.decision}`,
        subtitle: event.review.summary ?? null,
        metadata: { decision: event.review.decision },
      });
      return;
    }

    if (event.type === 'verification:parsed') {
      deps.activity.create({
        threadId: thread.id,
        projectId: thread.projectId,
        kind: 'verification_parsed',
        actor: 'claude',
        title: `${thread.title} — verification: ${event.verification.result}`,
        subtitle: event.verification.summary ?? null,
        metadata: { result: event.verification.result },
      });
      return;
    }
  }

  return {
    emit(event: PipelineEvent) {
      if (event.type === 'pipeline:output') {
        if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
          try {
            mainWindow.webContents.send('agent:output', {
              processId: `test-${event.threadId}`,
              chunk: event.chunk,
              threadId: event.threadId,
            });
          } catch { /* destroyed between check and send */ }
        }
        return;
      }

      // 1. Forward to renderer (always — preserves existing behaviour).
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(event.type, event);
      }

      // Resolve thread once per event for shared logging/notifications.
      const thread = deps.threads.getById(event.threadId) ?? null;

      // 2. Persist to activity_log.
      try {
        writeActivity(event, thread);
      } catch (err) {
        // Swallow logging failures to avoid breaking the pipeline.
        log.error('[pipeline-bridge] activity write failed:', err);
      }

      // 3. Mark verification-exhausted for dedupe, but do not fire a
      //    notification directly for this event — the subsequent
      //    'pipeline:phase failed' would normally fire 'failed', but we
      //    intercept that branch to fire a 'verification_exhausted' kind.
      if (event.type === 'pipeline:verification-exhausted' && thread) {
        try {
          deps.notifications.markVerificationExhausted(event.threadId);
          deps.notifications.fire('verification_exhausted', thread);
        } catch (err) {
          log.error('[pipeline-bridge] notification error:', err);
        }
      }

      // 4. Fire phase-based notifications.
      if (event.type === 'pipeline:phase' && thread) {
        try {
          if (event.phase === 'planning') {
            deps.notifications.dismissByThread(thread.id);
          }

          if (event.phase === 'awaiting_approval') {
            deps.notifications.fire('awaiting_approval', thread);
          } else if (event.phase === 'failed') {
            deps.notifications.fire('failed', thread);
          } else if (event.phase === 'completed') {
            deps.notifications.fire('completed', thread);
          }
        } catch (err) {
          log.error('[pipeline-bridge] notification error:', err);
        }
      }

      // 5. Promote next queued issue if a pipeline slot opened up.
      if (
        event.type === 'pipeline:phase' &&
        (event.phase === 'completed' || event.phase === 'failed' || event.phase === 'idle')
      ) {
        try {
          deps.onPipelineTerminal?.();
        } catch (err) {
          log.error('[pipeline-bridge] queue promotion error:', err);
        }
      }

      // 6. Tell the renderer to refresh dashboard queries.
      invalidateDashboard();
    },
  };
}
