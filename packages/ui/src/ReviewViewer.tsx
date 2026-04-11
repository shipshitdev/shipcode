import type { PlanReview, ReviewFinding } from '@shipcode/shared';
import { cn } from './lib/utils';
import { Badge } from './primitives/badge';

interface ReviewViewerProps {
  review: PlanReview | null;
}

const severityVariant = (severity: ReviewFinding['severity']) => {
  switch (severity) {
    case 'critical':
      return 'danger' as const;
    case 'major':
      return 'warning' as const;
    case 'minor':
      return 'warning' as const;
    case 'nit':
      return 'default' as const;
  }
};

const decisionVariant = (decision: string) => {
  switch (decision) {
    case 'approve':
      return 'success' as const;
    case 'request_changes':
      return 'warning' as const;
    case 'reject':
      return 'danger' as const;
    default:
      return 'default' as const;
  }
};

const severityBorderColor = (severity: ReviewFinding['severity']) => {
  switch (severity) {
    case 'critical':
      return 'border-danger';
    case 'major':
      return 'border-warning';
    case 'minor':
      return 'border-warning';
    case 'nit':
      return 'border-text-muted';
  }
};

export function ReviewViewer({ review }: ReviewViewerProps) {
  if (!review) {
    return (
      <div className="flex items-center justify-center h-full p-4 text-muted">
        <p>Waiting for review...</p>
      </div>
    );
  }

  return (
    <div className="p-4 overflow-y-auto">
      <header className="flex items-center gap-3 mb-3">
        <Badge
          variant={decisionVariant(review.decision)}
          className="uppercase text-[13px] font-bold px-3 py-1"
        >
          {review.decision.replace('_', ' ')}
        </Badge>
        <span className="text-xs text-secondary">Confidence: {review.confidence}</span>
      </header>

      <p className="mb-4 text-secondary text-[13px]">{review.summary}</p>

      {review.findings.length > 0 && (
        <section>
          <h3 className="text-[13px] font-semibold text-secondary uppercase tracking-wide mb-2">
            Findings ({review.findings.length})
          </h3>
          {review.findings.map((finding) => (
            <div
              key={finding.id}
              className={cn(
                'py-2.5 px-3 mb-2 bg-secondary rounded-md border-l-[3px]',
                severityBorderColor(finding.severity),
              )}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <Badge variant={severityVariant(finding.severity)} className="uppercase">
                  {finding.severity}
                </Badge>
                <span className="text-[11px] text-muted font-mono">{finding.id}</span>
                <Badge>{finding.category}</Badge>
              </div>
              <p className="text-[13px]">{finding.description}</p>
              {finding.filePath && (
                <code className="block mt-1 text-[11px] text-muted">{finding.filePath}</code>
              )}
              {finding.suggestion && (
                <div className="mt-1.5 p-1.5 px-2 bg-tertiary rounded text-xs">
                  <strong>Suggestion:</strong> {finding.suggestion}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {review.suggestedChanges.length > 0 && (
        <section>
          <h3 className="text-[13px] font-semibold text-secondary uppercase tracking-wide mb-2">
            Suggested Changes
          </h3>
          <ul className="list-disc pl-5">
            {review.suggestedChanges.map((change) => (
              <li key={change} className="py-0.5 text-[13px]">
                {change}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
