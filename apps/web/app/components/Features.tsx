const features = [
  {
    title: 'Multi-model routing',
    description:
      'Claude, Codex, or OpenRouter: pick the best model for each pipeline phase. Swap providers without rewriting prompts.',
  },
  {
    title: 'Automations and scheduling',
    description:
      'Run cron-like recurring prompts, auto-run Backlog work, and drain queued jobs through workspace and project capacity caps.',
  },
  {
    title: 'Task graph execution',
    description:
      'Complex issues can decompose into a dependency graph. Tasks execute in topological order with per-node context.',
  },
  {
    title: 'Isolated worktrees',
    description:
      'Every pipeline runs in its own git worktree. No branch conflicts, no stash juggling, no dirty state leaking between tasks.',
  },
  {
    title: 'Runtime QA with retries',
    description:
      'Typecheck, test suite, browser/runtime QA, and visual QA evidence feed the verifier before a PR ships.',
  },
  {
    title: 'Desktop control surface',
    description:
      'Track issues, PRs, worktrees, code, costs, insights, terminal output, and scheduled automations in one app.',
  },
] as const;

export function Features() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center text-xl font-semibold tracking-[-0.03em] text-primary sm:text-3xl">
          What you get out of the box
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-6 text-secondary">
          A full-stack pipeline engine, not another chat wrapper.
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
