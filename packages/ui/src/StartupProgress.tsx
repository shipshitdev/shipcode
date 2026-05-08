import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StartupProgressStepStatus = 'pending' | 'active' | 'complete' | 'error';

export interface StartupProgressStep {
  id: string;
  label: ReactNode;
  detail?: ReactNode;
  status: StartupProgressStepStatus;
}

export interface StartupProgressProps {
  title: ReactNode;
  subtitle?: ReactNode;
  steps: StartupProgressStep[];
  className?: string;
}

const STATUS_CLASS: Record<StartupProgressStepStatus, string> = {
  pending: 'text-muted',
  active: 'text-agent',
  complete: 'text-success',
  error: 'text-danger',
};

function StepIcon({ status }: { status: StartupProgressStepStatus }) {
  if (status === 'complete') return <CheckCircle2 size={16} className="text-success" />;
  if (status === 'error') return <XCircle size={16} className="text-danger" />;
  if (status === 'active') return <Loader2 size={16} className="animate-spin text-agent" />;
  return <Circle size={16} className="text-muted" />;
}

export function StartupProgress({ title, subtitle, steps, className }: StartupProgressProps) {
  return (
    <section
      aria-busy={steps.some((step) => step.status === 'active')}
      className={cn(
        'flex min-h-screen w-full items-center justify-center bg-primary px-6 text-primary',
        className,
      )}
    >
      <div className="w-full max-w-md">
        <div className="mb-6">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-agent/30 bg-agent/10 text-[13px] font-semibold text-agent">
              SC
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">{title}</h1>
              {subtitle ? <p className="mt-0.5 text-[13px] text-secondary">{subtitle}</p> : null}
            </div>
          </div>
          <div className="h-px bg-border" />
        </div>

        <ol className="space-y-2">
          {steps.map((step) => (
            <li
              key={step.id}
              className="flex items-start gap-3 rounded-md border border-border bg-secondary px-3 py-2.5"
            >
              <span className="mt-0.5 shrink-0">
                <StepIcon status={step.status} />
              </span>
              <span className="min-w-0">
                <span className={cn('block text-[13px] font-medium', STATUS_CLASS[step.status])}>
                  {step.label}
                </span>
                {step.detail ? (
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted">
                    {step.detail}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
