const features = [
  {
    title: 'Multi-model routing',
    description:
      'Claude, Codex, or OpenRouter — pick the best model for each pipeline phase. Swap providers without rewriting prompts.',
  },
  {
    title: 'Parallel pipeline scheduling',
    description:
      'Run multiple issues simultaneously with per-project concurrency caps. Queue drains automatically as slots open.',
  },
  {
    title: 'Task graph execution',
    description:
      'Complex issues decompose into a dependency graph. Tasks execute in topological order with per-node verification.',
  },
  {
    title: 'Isolated worktrees',
    description:
      'Every pipeline runs in its own git worktree. No branch conflicts, no stash juggling, no dirty state leaking between tasks.',
  },
  {
    title: 'Verification with retries',
    description:
      'Typecheck, test suite, and spec-scoped review after every execution. Failures trigger targeted auto-fixes before giving up.',
  },
  {
    title: 'Visual Kanban board',
    description:
      'Track every issue through plan → review → execute → verify in real time. See which model is running, which phase is active.',
  },
] as const;

export function Features() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center text-xl font-semibold tracking-tight text-primary sm:text-3xl">
          What you get out of the box
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-6 text-secondary">
          A full-stack pipeline engine — not another chat wrapper.
        </p>

        <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title} className="space-y-2">
              <h3 className="text-sm font-semibold text-primary">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-secondary">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
