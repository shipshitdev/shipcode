const issueLines = [
  'Extend PipelineExecutorModel to include openrouter.',
  'Wire the provider registry through execute().',
  'Preserve verifier retries and settings defaults.',
];

const planItems = [
  'Update PipelineExecutorModel and settings types',
  'Add provider registry branch for OpenRouter',
  'Verify pipeline retries and UI state wiring',
];

const reviewItems = [
  {
    title: '[P1] pipeline.ts still narrows executorModel',
    body: 'Accept openrouter in the execute path or the plan can pass review and still fail before spawn.',
  },
  {
    title: '[P2] AppSettings is missing verifierModel additions',
    body: 'Initialize the new fields in every context creation site to keep verifier flow stable.',
  },
];

const terminalLines = [
  { kind: 'dim', text: '> Fetching GitHub Issue #184' },
  { kind: 'ok', text: '✓ Plan generated (3 tasks)' },
  { kind: 'warn', text: '⚠ Review found 2 blocking issues' },
  { kind: 'ok', text: '✓ Plan revised and approved' },
  { kind: 'dim', text: '> Creating worktree ~/.shipcode/worktrees/shipcode/184' },
  { kind: 'ok', text: '✓ OpenRouter provider wired' },
  { kind: 'ok', text: '✓ Typecheck passed' },
  { kind: 'ok', text: '✓ Verifier retry 1 passed' },
  { kind: 'dim', text: '> Opening draft PR...' },
  { kind: 'ok', text: '✓ PR #243 created' },
  { kind: 'strong', text: 'github.com/shipshitdev/shipcode/pull/243' },
];

export function ProductMockup() {
  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <div className="overflow-hidden rounded-[28px] border border-white/12 bg-[#111216] shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_30px_90px_rgba(0,0,0,0.55)]">
        <div className="flex items-center gap-3 border-b border-white/10 bg-black/35 px-6 py-4">
          <span className="h-3 w-3 rounded-full bg-danger" />
          <span className="h-3 w-3 rounded-full bg-warning" />
          <span className="h-3 w-3 rounded-full bg-success" />
          <div className="ml-4 rounded-full bg-white/5 px-4 py-1 font-mono text-xs tracking-[0.22em] text-muted uppercase">
            shipcode dashboard
          </div>
        </div>

        <div className="grid gap-8 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_36%),linear-gradient(180deg,#131419_0%,#0d0d10_100%)] p-8 lg:grid-cols-[390px_1fr_560px]">
          <section className="rounded-[24px] border border-white/12 bg-[#17181d] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="inline-flex rounded-full bg-blue-500/15 px-3 py-1 text-xs font-medium text-blue-300">
              issue #184
            </div>
            <h3 className="mt-6 text-3xl font-semibold tracking-tight text-primary">
              Add OpenRouter as a third pipeline executor model
            </h3>
            <div className="mt-6 space-y-3 text-base leading-7 text-secondary">
              {issueLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>

            <div className="mt-8 border-t border-white/10 pt-8">
              <div className="text-lg font-semibold text-primary">Execution rails</div>
              <ul className="mt-4 space-y-3 text-sm text-secondary">
                <li className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-agent" />
                  plan with Opus
                </li>
                <li className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-agent" />
                  review with Codex
                </li>
                <li className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-agent" />
                  execute in worktree
                </li>
                <li className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-agent" />
                  verify until green
                </li>
              </ul>
            </div>
          </section>

          <div className="space-y-8">
            <section className="rounded-[24px] border border-white/12 bg-[#17181d] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-3xl font-semibold tracking-tight text-primary">
                  Plan review loop
                </h3>
                <span className="rounded-full bg-green-500/15 px-3 py-1 text-xs font-medium text-green-300">
                  review round 2
                </span>
              </div>
              <div className="mt-6 space-y-4">
                {planItems.map((item, index) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-white/10 bg-[#111216] px-5 py-4 text-left text-lg font-medium text-primary"
                  >
                    {index + 1}. {item}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-[24px] border border-white/12 bg-[#17181d] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <h3 className="text-3xl font-semibold tracking-tight text-primary">
                Review findings
              </h3>
              <div className="mt-6 space-y-4">
                {reviewItems.map((item) => (
                  <article
                    key={item.title}
                    className="rounded-2xl border border-white/10 bg-[#111216] p-5"
                  >
                    <h4 className="text-lg font-semibold text-primary">{item.title}</h4>
                    <p className="mt-2 text-sm leading-6 text-secondary">{item.body}</p>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <section className="rounded-[24px] border border-white/12 bg-[linear-gradient(180deg,#12161b_0%,#0d1013_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="flex items-center gap-3 rounded-t-[24px] border-b border-white/10 bg-black/25 px-6 py-4">
              <span className="h-3 w-3 rounded-full bg-danger" />
              <span className="h-3 w-3 rounded-full bg-warning" />
              <span className="h-3 w-3 rounded-full bg-success" />
              <div className="ml-4 font-mono text-sm text-muted">shipcode run --thread 184</div>
            </div>
            <pre className="overflow-x-auto px-6 py-6 font-mono text-[15px] leading-8">
              {terminalLines.map((line) => (
                <div
                  key={line.text}
                  className={
                    line.kind === 'ok'
                      ? 'text-success'
                      : line.kind === 'warn'
                        ? 'text-warning'
                        : line.kind === 'strong'
                          ? 'text-primary'
                          : 'text-muted'
                  }
                >
                  {line.text}
                </div>
              ))}
            </pre>
          </section>
        </div>
      </div>

      <div
        className="mx-auto -mt-px h-28 w-[98%] scale-y-[-1] rounded-b-3xl opacity-[0.05]"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 72%)',
          maskImage: 'linear-gradient(180deg, black 0%, transparent 70%)',
        }}
      />
    </div>
  );
}
