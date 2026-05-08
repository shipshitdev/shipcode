import { Square } from 'lucide-react';
import { planFileActionVariant } from '@/lib/file-action';
import type { ShipCodePlan } from '@/lib/shipcode';
import { Badge } from '@/primitives/badge';

interface PlanViewerProps {
  plan: ShipCodePlan | null;
}

export function PlanViewer({ plan }: PlanViewerProps) {
  if (!plan) {
    return (
      <div className="flex items-center justify-center h-full p-4 text-muted-foreground">
        <p>Waiting for plan generation...</p>
      </div>
    );
  }

  return (
    <div className="p-4 overflow-y-auto">
      <header className="flex justify-between items-start mb-4">
        <h2 className="text-base font-semibold">{plan.objective}</h2>
        <div className="flex gap-2">
          <Badge>v{plan.version}</Badge>
          <Badge>{plan.estimatedComplexity}</Badge>
        </div>
      </header>

      <section className="mb-5">
        <h3 className="text-[13px] font-semibold text-secondary uppercase tracking-wide mb-2">
          Implementation Steps
        </h3>
        <ol className="list-none space-y-1.5">
          {plan.steps.map((step, idx) => (
            <li
              key={step.order}
              className="py-2.5 px-3 bg-secondary rounded-md border-l-[3px] border-accent"
            >
              <span className="font-bold text-accent mr-2">{idx + 1}.</span>
              <span>{step.description}</span>
              <div className="mt-1 text-xs text-secondary italic">{step.rationale}</div>
              {step.files.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {step.files.map((file) => (
                    <code
                      key={file}
                      className="px-1.5 py-px bg-tertiary rounded text-[11px] text-secondary"
                    >
                      {file}
                    </code>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-5">
        <h3 className="text-[13px] font-semibold text-secondary uppercase tracking-wide mb-2">
          File Changes
        </h3>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="text-left px-2 py-1.5 border-b border-border text-secondary">
                Action
              </th>
              <th className="text-left px-2 py-1.5 border-b border-border text-secondary">Path</th>
              <th className="text-left px-2 py-1.5 border-b border-border text-secondary">
                Description
              </th>
            </tr>
          </thead>
          <tbody>
            {plan.files.map((file) => (
              <tr key={file.path}>
                <td className="px-2 py-1.5 border-b border-border">
                  <Badge variant={planFileActionVariant(file.action)} className="uppercase">
                    {file.action}
                  </Badge>
                </td>
                <td className="px-2 py-1.5 border-b border-border">
                  <code>{file.path}</code>
                </td>
                <td className="px-2 py-1.5 border-b border-border">{file.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {plan.acceptanceCriteria.length > 0 && (
        <section className="mb-5">
          <h3 className="text-[13px] font-semibold text-secondary uppercase tracking-wide mb-2">
            Acceptance Criteria
          </h3>
          <ul className="list-none p-0">
            {plan.acceptanceCriteria.map((criteria) => (
              <li key={criteria} className="flex items-start gap-2 py-1 text-[13px]">
                <Square size={12} className="mt-1 shrink-0 text-muted-foreground" />
                <span>{criteria}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan.outOfScope.length > 0 && (
        <section className="mb-5">
          <h3 className="text-[13px] font-semibold text-secondary uppercase tracking-wide mb-2">
            Out of Scope
          </h3>
          <ul className="list-none p-0">
            {plan.outOfScope.map((item) => (
              <li
                key={item}
                className="py-1 pl-4 text-[13px] relative before:content-['—'] before:absolute before:left-0 before:text-muted-foreground"
              >
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan.dependencies.length > 0 && (
        <section className="mb-5">
          <h3 className="text-[13px] font-semibold text-secondary uppercase tracking-wide mb-2">
            Dependencies
          </h3>
          <div className="flex flex-wrap gap-1">
            {plan.dependencies.map((dep) => (
              <code key={dep} className="px-2 py-0.5 bg-tertiary rounded text-[11px]">
                {dep}
              </code>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
