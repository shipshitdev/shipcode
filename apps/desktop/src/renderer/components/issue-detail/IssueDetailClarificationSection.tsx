import type { ClarificationAnswer, ClarificationRequest, Thread } from '@shipcode/shared';
import { Badge, Button, cn, Textarea } from '@shipshitdev/ui';
import { LoadingButtonContent } from '@shipshitdev/ui/common';
import { useMemo, useState } from 'react';

type ClarificationDraft = Record<
  string,
  {
    selectedChoiceId: string | null;
    freeformText: string;
  }
>;

function buildClarificationDraft(
  request: ClarificationRequest,
  thread: Thread | null | undefined,
): ClarificationDraft {
  return Object.fromEntries(
    request.questions.map((question) => {
      const existing = thread?.clarificationAnswers.find(
        (answer) => answer.questionId === question.id,
      );
      return [
        question.id,
        {
          selectedChoiceId:
            existing?.selectedChoiceId ??
            question.choices.find((choice) => choice.recommended)?.id ??
            null,
          freeformText: existing?.freeformText ?? '',
        },
      ];
    }),
  );
}

interface ClarificationSectionProps {
  isSubmitting: boolean;
  request: ClarificationRequest;
  thread: Thread;
  onSubmitClarification: (answers: ClarificationAnswer[]) => Promise<void>;
}

export function ClarificationSection({
  isSubmitting,
  request,
  thread,
  onSubmitClarification,
}: ClarificationSectionProps) {
  const [draft, setDraft] = useState<ClarificationDraft>(() =>
    buildClarificationDraft(request, thread),
  );
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(
    () =>
      request.questions.every((question) => {
        const answer = draft[question.id];
        const hasChoice = !!answer?.selectedChoiceId;
        const hasFreeform = !!answer?.freeformText.trim();
        return hasChoice || (question.allowFreeform && hasFreeform);
      }),
    [draft, request.questions],
  );

  const handleChoiceChange = (questionId: string, choiceId: string) => {
    setDraft((current) => ({
      ...current,
      [questionId]: {
        selectedChoiceId: choiceId,
        freeformText: current[questionId]?.freeformText ?? '',
      },
    }));
    setError(null);
  };

  const handleFreeformChange = (questionId: string, value: string) => {
    setDraft((current) => ({
      ...current,
      [questionId]: {
        selectedChoiceId: current[questionId]?.selectedChoiceId ?? null,
        freeformText: value,
      },
    }));
    setError(null);
  };

  const handleSubmit = async () => {
    setError(null);
    try {
      const answers: ClarificationAnswer[] = request.questions.map((question) => {
        const answer = draft[question.id];
        const freeformText = answer?.freeformText.trim();
        return {
          questionId: question.id,
          selectedChoiceId: answer?.selectedChoiceId ?? null,
          freeformText: freeformText ? freeformText : null,
        };
      });
      await onSubmitClarification(answers);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    }
  };

  return (
    <section className="rounded-xl border border-warning/25 bg-warning/[0.04] p-4 shadow-[0_1px_0_0_rgba(0,0,0,0.18)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-warning">
            Planner Input
          </div>
          <h4 className="text-[15px] font-semibold leading-snug text-primary">
            Answer these before planning continues
          </h4>
          <p className="mt-2 max-w-4xl text-[12px] leading-relaxed text-secondary">
            {request.summary}
          </p>
        </div>
        <Badge variant="warning" className="shrink-0 text-[10px]">
          {request.questions.length} {request.questions.length === 1 ? 'question' : 'questions'}
        </Badge>
      </div>

      <div className="mt-5 overflow-hidden rounded-lg border border-warning/15 bg-primary/20">
        {request.questions.map((question, index) => {
          const answer = draft[question.id] ?? {
            selectedChoiceId: null,
            freeformText: '',
          };

          return (
            <section
              key={question.id}
              className={cn('p-4', index > 0 && 'border-t border-warning/10')}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-warning/80">
                  Q{index + 1}
                </span>
                <h5 className="text-[13px] font-semibold text-primary/95">{question.title}</h5>
              </div>
              <p className="text-[12px] leading-relaxed text-secondary">{question.prompt}</p>
              {question.description && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  {question.description}
                </p>
              )}

              <div className="mt-3 flex flex-col gap-2">
                {question.choices.map((choice) => {
                  const selected = answer.selectedChoiceId === choice.id;
                  return (
                    <Button
                      key={choice.id}
                      type="button"
                      variant="ghost"
                      className={cn(
                        'rounded-md border px-3 py-2.5 text-left transition-colors',
                        selected
                          ? 'border-warning/45 bg-warning/[0.12]'
                          : 'border-border/70 bg-secondary/35 hover:border-warning/30 hover:bg-warning/[0.05]',
                      )}
                      onClick={() => handleChoiceChange(question.id, choice.id)}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'size-2.5 rounded-full border',
                            selected ? 'border-warning bg-warning' : 'border-border bg-transparent',
                          )}
                        />
                        <span className="text-[12px] font-medium text-primary">{choice.label}</span>
                        {choice.recommended && (
                          <Badge variant="default" className="text-[9px] uppercase">
                            Recommended
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 pl-[18px] text-[11px] leading-relaxed text-secondary">
                        {choice.description}
                      </p>
                    </Button>
                  );
                })}
              </div>

              {question.allowFreeform && (
                <div className="mt-3">
                  <Textarea
                    value={answer.freeformText}
                    onChange={(event) => handleFreeformChange(question.id, event.target.value)}
                    placeholder={question.freeformPlaceholder ?? 'Add context if needed'}
                    rows={3}
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>

      {error && <p className="mt-3 text-[11px] text-danger">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" onClick={handleSubmit} disabled={isSubmitting || !canSubmit}>
          <LoadingButtonContent loading={isSubmitting}>Resume planning</LoadingButtonContent>
        </Button>
        <p className="text-[11px] text-muted-foreground">
          ShipCode will start a fresh planning pass with these answers folded into the prompt.
        </p>
      </div>
    </section>
  );
}
