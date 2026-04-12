import { Card } from '@shipcode/ui';
import { ArrowRight, FileText, GitPullRequest, Play, Search, Tag } from 'lucide-react';
import { Fragment } from 'react';

const steps = [
  {
    icon: Tag,
    title: 'Label Issue',
    description: 'Tag a GitHub issue to trigger the pipeline.',
  },
  {
    icon: FileText,
    title: 'Plan',
    description: 'Opus generates a detailed implementation plan.',
  },
  {
    icon: Search,
    title: 'Review',
    description: 'Codex critiques the plan and finds blind spots.',
  },
  {
    icon: Play,
    title: 'Execute',
    description: 'Code is written in an isolated worktree.',
  },
  {
    icon: GitPullRequest,
    title: 'Ship PR',
    description: 'A pull request is created for human review.',
  },
];

export function HowItWorks() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl md:text-4xl font-bold text-center mb-16">How It Works</h2>
        <div className="flex flex-col gap-4 md:flex-row md:items-stretch md:gap-2">
          {steps.map((step, i) => (
            <Fragment key={step.title}>
              <Card className="flex flex-1 flex-col items-center p-6 text-center">
                <step.icon className="mb-3 h-8 w-8 text-accent" />
                <h3 className="mb-1 font-semibold text-primary">{step.title}</h3>
                <p className="text-sm text-secondary">{step.description}</p>
              </Card>
              {i < steps.length - 1 && (
                <div className="hidden md:flex items-center shrink-0 text-muted">
                  <ArrowRight size={16} />
                </div>
              )}
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
