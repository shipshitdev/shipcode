const steps = [
  {
    number: '01',
    title: 'Plan',
    description:
      'Drop a GitHub issue. The planner reads your codebase, generates a task graph, and proposes an execution strategy.',
    detail: 'Supports Claude, Codex, and OpenRouter models per phase.',
  },
  {
    number: '02',
    title: 'Review',
    description:
      'A separate reviewer LLM critiques the plan — checking for missed edge cases, security issues, and scope creep.',
    detail: 'Multi-round revision until the plan is stable.',
  },
  {
    number: '03',
    title: 'Execute',
    description:
      'Each task runs in an isolated git worktree. The agent writes code, runs tests, and self-corrects on failures.',
    detail: 'Per-node verification ensures each step meets acceptance criteria.',
  },
  {
    number: '04',
    title: 'Verify',
    description:
      'Full diff review against the original spec. Typecheck, test suite, and criteria-scoped code quality pass.',
    detail: 'Automatic retries with targeted fixes on failure.',
  },
] as const;

export function PipelineSteps() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center text-xl font-semibold tracking-[-0.03em] text-primary sm:text-3xl">
          Four phases. Zero hand-holding.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-6 text-secondary">
          Every issue goes through a full pipeline before it becomes a PR. Each phase uses a
          different model optimized for that job.
        </p>

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/[0.03] sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div
              key={step.number}
              className="flex flex-col gap-3 border-white/8 p-6 [&:not(:last-child)]:border-b sm:[&:not(:last-child)]:border-b-0 sm:[&:not(:last-child)]:border-r"
            >
              <span className="text-[11px] font-semibold tracking-[0.25em] text-muted uppercase">
                Step {step.number}
              </span>
              <h3 className="text-lg font-semibold text-primary">{step.title}</h3>
              <p className="text-sm leading-relaxed text-secondary">{step.description}</p>
              <p className="mt-auto pt-2 text-xs text-muted">{step.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
