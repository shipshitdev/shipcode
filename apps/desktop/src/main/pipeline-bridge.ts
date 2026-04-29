import type {
  ActivityQueries,
  AutomationQueries,
  TerminalEventQueries,
  ThreadQueries,
} from '@shipcode/db';
import type { PipelineEmitter, PipelineEvent } from '@shipcode/pipeline';
import {
  type ActivityKind,
  formatResolvedModelDisplay,
  PIPELINE_PHASE,
  type PipelinePhase,
  type Thread,
} from '@shipcode/shared';
import type { BrowserWindow } from 'electron';
import type { ChatNotificationService } from './chat-notification-service';
import log, { logEvent } from './logger.service';
import type { NotificationService } from './notification-service';

interface EmitterDeps {
  activity: ActivityQueries;
  terminalEvents: TerminalEventQueries;
  threads: ThreadQueries;
  automations: AutomationQueries;
  notifications: NotificationService;
  chatNotifications: ChatNotificationService;
  onPipelineTerminal?: (event: { threadId: string; phase: PipelinePhase }) => void;
  onExecutionSlotFreed?: () => void;
}

function formatClock(isoLike: string): string {
  return new Date(isoLike).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatTimestampPrefix(isoLike: string): string {
  return `\x1b[90m[${formatClock(isoLike)}]\x1b[0m`;
}

// Phase transitions that map to human-visible activity entries.
const PHASE_ACTIVITY: Partial<
  Record<PipelinePhase, { kind: ActivityKind; title: (t: Thread) => string; subtitle?: string }>
> = {
  [PIPELINE_PHASE.planning]: {
    kind: 'pipeline_started',
    title: (t) => `${t.title} — planning started`,
    subtitle: 'Claude is drafting the plan',
  },
  [PIPELINE_PHASE.clarifying]: {
    kind: 'phase_change',
    title: (t) => `${t.title} — clarification needed`,
    subtitle: 'Waiting for your answer before planning continues',
  },
  [PIPELINE_PHASE.reviewing]: {
    kind: 'phase_change',
    title: (t) => `${t.title} — in review`,
    subtitle: 'Codex is reviewing the plan',
  },
  [PIPELINE_PHASE.revising]: {
    kind: 'phase_change',
    title: (t) => `${t.title} — revising`,
    subtitle: 'Claude is revising the plan',
  },
  [PIPELINE_PHASE.awaitingApproval]: {
    kind: 'phase_change',
    title: (t) => `${t.title} — awaiting approval`,
    subtitle: 'Needs your approval',
  },
  [PIPELINE_PHASE.executing]: {
    kind: 'phase_change',
    title: (t) => `${t.title} — executing`,
    subtitle: 'Claude is implementing',
  },
  [PIPELINE_PHASE.testing]: {
    kind: 'phase_change',
    title: (t) => `${t.title} — running tests`,
    subtitle: 'Executing test command',
  },
  [PIPELINE_PHASE.verifying]: {
    kind: 'phase_change',
    title: (t) => `${t.title} — verifying`,
    subtitle: 'Running verification',
  },
  [PIPELINE_PHASE.shipping]: {
    kind: 'phase_change',
    title: (t) => `${t.title} — shipping`,
    subtitle: 'Committing and pushing',
  },
  [PIPELINE_PHASE.completed]: {
    kind: 'pipeline_completed',
    title: (t) => `${t.title} — completed`,
    subtitle: 'PR ready',
  },
  [PIPELINE_PHASE.failed]: { kind: 'pipeline_failed', title: (t) => `${t.title} — failed` },
};

const SLOT_FREEING_PHASES = new Set<PipelinePhase>([
  PIPELINE_PHASE.clarifying,
  PIPELINE_PHASE.awaitingApproval,
  PIPELINE_PHASE.completed,
  PIPELINE_PHASE.failed,
  PIPELINE_PHASE.idle,
]);

const TERMINAL_PHASES = new Set<PipelinePhase>([
  PIPELINE_PHASE.completed,
  PIPELINE_PHASE.failed,
  PIPELINE_PHASE.idle,
]);

export function createElectronEmitter(
  mainWindow: BrowserWindow,
  deps: EmitterDeps,
): PipelineEmitter {
  function emitCanonicalTerminalEvent(
    threadId: string,
    event: import('@shipcode/shared').CanonicalTerminalEvent,
  ) {
    const record = deps.terminalEvents.create(threadId, event);
    if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      try {
        mainWindow.webContents.send('terminal:event', record);
      } catch {
        /* destroyed between check and send */
      }
    }
    return record;
  }

  function writeEventLog(event: PipelineEvent) {
    switch (event.type) {
      case 'pipeline:phase':
        logEvent('pipeline:phase', {
          threadId: event.threadId,
          phase: event.phase,
        });
        return;
      case 'pipeline:start-context':
        logEvent('pipeline:start-context', event);
        return;
      case 'pipeline:approval-gate':
        logEvent('pipeline:approval-gate', event);
        return;
      case 'pipeline:verification-exhausted':
        logEvent('pipeline:verification-exhausted', event);
        return;
      case 'pipeline:model-resolved':
        logEvent('pipeline:model-resolved', event);
        return;
      case 'plan:parsed':
        logEvent('plan:parsed', {
          threadId: event.threadId,
          objective: event.plan.objective ?? null,
          stepCount: event.plan.steps.length,
          fileCount: event.plan.files.length,
        });
        return;
      case 'review:parsed':
        logEvent('review:parsed', {
          threadId: event.threadId,
          decision: event.review.decision,
          confidence: event.review.confidence,
          findingCount: event.review.findings.length,
        });
        return;
      case 'verification:parsed':
        logEvent('verification:parsed', {
          threadId: event.threadId,
          result: event.verification.result,
          summary: event.verification.summary ?? null,
        });
        return;
      case 'skill:fallback':
        logEvent('skill:fallback', event);
        return;
      case 'terminal:event':
        logEvent('terminal:event', {
          threadId: event.threadId,
          kind: event.event.kind,
        });
        return;
      case 'pipeline:output':
        return;
    }
  }

  function invalidateDashboardImmediate() {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('dashboard:invalidate', {
      kinds: ['stats', 'activity', 'running', 'recent'],
    });
  }

  let _dashboardThrottleTimer: ReturnType<typeof setTimeout> | null = null;

  function invalidateDashboard() {
    if (_dashboardThrottleTimer !== null) return;
    _dashboardThrottleTimer = setTimeout(() => {
      _dashboardThrottleTimer = null;
      invalidateDashboardImmediate();
    }, 2000);
  }

  function writeActivity(event: PipelineEvent, thread: Thread | null) {
    if (!thread) return;

    if (event.type === 'pipeline:phase') {
      // Ignore idle as a normal phase — it is the cancel/reset state.
      if (event.phase === PIPELINE_PHASE.idle) {
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
          event.phase === PIPELINE_PHASE.reviewing
            ? 'codex'
            : event.phase === PIPELINE_PHASE.completed || event.phase === PIPELINE_PHASE.clarifying
              ? 'system'
              : 'claude',
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
        title: `${thread.title} — plan drafted`,
        subtitle: event.plan.objective ?? null,
        metadata: null,
      });
      return;
    }

    if (event.type === 'review:parsed') {
      const subtitle =
        event.review.decision === 'approve'
          ? 'AI approved the plan'
          : event.review.decision === 'request_changes'
            ? 'Revision requested by reviewer'
            : 'AI rejected the plan';
      deps.activity.create({
        threadId: thread.id,
        projectId: thread.projectId,
        kind: 'review_parsed',
        actor: 'codex',
        title: `${thread.title} — AI review complete`,
        subtitle,
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
          } catch {
            /* destroyed between check and send */
          }
        }
        return;
      }

      if (event.type === 'terminal:event') {
        try {
          writeEventLog(event);
        } catch (err) {
          log.error('[pipeline-bridge] event log write failed:', err);
        }
        try {
          emitCanonicalTerminalEvent(event.threadId, event.event);
        } catch (err) {
          log.error('[pipeline-bridge] terminal event write failed:', err);
        }
        return;
      }

      // 1. Forward to renderer (always — preserves existing behaviour).
      if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        try {
          mainWindow.webContents.send(event.type, event);
        } catch {
          /* render frame disposed during HMR */
        }
      }

      // Resolve thread once per event for shared logging/notifications.
      const thread = deps.threads.getById(event.threadId) ?? null;

      try {
        writeEventLog(event);
      } catch (err) {
        log.error('[pipeline-bridge] event log write failed:', err);
      }

      if (event.type === 'pipeline:phase') {
        try {
          const record = emitCanonicalTerminalEvent(event.threadId, {
            kind: 'lifecycle',
            message: `${formatTimestampPrefix(new Date().toISOString())} phase: \x1b[36m${event.phase}\x1b[0m`,
          });
          if (event.phase === PIPELINE_PHASE.planning) {
            logEvent('terminal:phase-persisted', {
              threadId: event.threadId,
              createdAt: record.createdAt,
            });
          }
        } catch (err) {
          log.error('[pipeline-bridge] phase terminal write failed:', err);
        }
      }

      if (event.type === 'pipeline:model-resolved') {
        try {
          const displayName = formatResolvedModelDisplay(event.requestedModel, event.resolvedModel);
          const isOpenRouter = displayName?.startsWith('OpenRouter') ?? false;
          const isCodex = displayName?.startsWith('Codex') ?? false;
          if (displayName) {
            const tokenStr =
              event.tokensUsed != null
                ? ` \x1b[2m(${event.tokensUsed.prompt}+${event.tokensUsed.completion} tok)\x1b[0m`
                : '';
            let costStr = '';
            if (event.costUsd && event.costUsd > 0) {
              costStr = ` \x1b[2m${isOpenRouter ? '$' : '~$'}${event.costUsd.toFixed(4)}\x1b[0m`;
            } else if (isCodex && event.tokensUsed) {
              const estimated =
                (event.tokensUsed.prompt * 62.5 + event.tokensUsed.completion * 375) / 1_000_000;
              costStr = ` \x1b[2m~$${estimated.toFixed(4)}\x1b[0m`;
            }
            emitCanonicalTerminalEvent(event.threadId, {
              kind: 'lifecycle',
              message: `${formatTimestampPrefix(new Date().toISOString())} \x1b[35mmodel:\x1b[0m ${displayName}${tokenStr}${costStr}`,
            });
          }
        } catch (err) {
          log.error('[pipeline-bridge] model terminal write failed:', err);
        }
      }

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
          deps.chatNotifications.fire('verification_exhausted', thread);
        } catch (err) {
          log.error('[pipeline-bridge] notification error:', err);
        }
      }

      // 4. Fire phase-based notifications.
      if (event.type === 'pipeline:phase' && thread) {
        try {
          if (event.phase === PIPELINE_PHASE.planning) {
            deps.notifications.dismissByThread(thread.id);
          }

          if (event.phase === PIPELINE_PHASE.awaitingApproval) {
            deps.notifications.fire('awaiting_approval', thread);
            deps.chatNotifications.fire('awaiting_approval', thread);
          } else if (event.phase === PIPELINE_PHASE.failed) {
            deps.notifications.fire('failed', thread);
            deps.chatNotifications.fire('failed', thread);
          } else if (event.phase === PIPELINE_PHASE.completed) {
            deps.notifications.fire('completed', thread);
            deps.chatNotifications.fire('completed', thread);
          }
        } catch (err) {
          log.error('[pipeline-bridge] notification error:', err);
        }
      }

      // 5. Promote next queued issue if a pipeline slot opened up.
      // clarifying/awaiting_approval are included: the slot becomes available
      // while the human responds, so the next queued issue can start in parallel.
      if (event.type === 'pipeline:phase' && SLOT_FREEING_PHASES.has(event.phase)) {
        try {
          deps.onPipelineTerminal?.({ threadId: event.threadId, phase: event.phase });
        } catch (err) {
          log.error('[pipeline-bridge] queue promotion error:', err);
        }
      }

      // 5b. Promote next execution-queued pipeline if a project execution slot opened.
      // Only terminal phases free an execution slot — awaiting_approval frees a
      // planning slot, not an execution slot.
      if (event.type === 'pipeline:phase' && TERMINAL_PHASES.has(event.phase)) {
        try {
          deps.onExecutionSlotFreed?.();
        } catch (err) {
          log.error('[pipeline-bridge] execution-queue promotion error:', err);
        }
      }

      // 5c. Record automation run finish on terminal phases.
      if (
        event.type === 'pipeline:phase' &&
        (event.phase === PIPELINE_PHASE.completed || event.phase === PIPELINE_PHASE.failed)
      ) {
        try {
          const thread = deps.threads.getById(event.threadId);
          if (thread?.automationId) {
            deps.automations.recordRunFinished(thread.automationId, event.phase);
          }
        } catch (err) {
          log.error('[pipeline-bridge] automation finish-record error:', err);
        }
      }

      // 6. Tell the renderer to refresh dashboard queries.
      // Terminal phases flush immediately; all other events are throttled to
      // at most once per 2 s to reduce renderer churn during EXECUTE.
      const isTerminalPhase = event.type === 'pipeline:phase' && TERMINAL_PHASES.has(event.phase);
      if (isTerminalPhase) {
        if (_dashboardThrottleTimer !== null) {
          clearTimeout(_dashboardThrottleTimer);
          _dashboardThrottleTimer = null;
        }
        invalidateDashboardImmediate();
      } else {
        invalidateDashboard();
      }
    },
  };
}
