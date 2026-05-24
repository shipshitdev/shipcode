import type { VerificationResult } from '@/lib/shipcode';
import { cn } from '@/lib/utils';
import { Badge } from '@/primitives/badge';

interface VerificationViewerProps {
  verification: VerificationResult;
}

export function VerificationViewer({ verification }: VerificationViewerProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center">
        <Badge variant={verification.result === 'passed' ? 'success' : 'danger'}>
          {verification.result === 'passed' ? '\u2713 Passed' : '\u2717 Failed'}
        </Badge>
      </div>

      <p className="text-sm text-secondary">{verification.summary}</p>

      {verification.criteriaResults.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-primary">Acceptance Criteria</h4>
          <ul className="space-y-2">
            {verification.criteriaResults.map((cr) => (
              <li
                key={cr.criterion}
                className={cn(
                  'flex gap-2 rounded-md border p-2 text-sm',
                  cr.passed ? 'border-success/30 bg-success/5' : 'border-danger/30 bg-danger/5',
                )}
              >
                <span
                  className={cn(
                    'shrink-0 font-mono text-sm',
                    cr.passed ? 'text-success' : 'text-danger',
                  )}
                >
                  {cr.passed ? '\u2713' : '\u2717'}
                </span>
                <div className="min-w-0">
                  <div className="text-primary">{cr.criterion}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{cr.evidence}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {verification.issues.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-primary">
            Issues ({verification.issues.length})
          </h4>
          <ul className="space-y-1.5">
            {verification.issues.map((issue) => (
              <li
                key={`${issue.severity}:${issue.description}`}
                className="flex items-start gap-2 text-sm text-primary"
              >
                <Badge
                  variant={
                    issue.severity === 'blocker'
                      ? 'danger'
                      : issue.severity === 'warning'
                        ? 'warning'
                        : 'default'
                  }
                  className="shrink-0"
                >
                  {issue.severity}
                </Badge>
                <span>{issue.description}</span>
                {issue.filePath && (
                  <code className="text-xs text-muted-foreground bg-tertiary px-1.5 py-0.5 rounded shrink-0">
                    {issue.filePath}
                  </code>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
