import { ProductMockup } from './ProductMockup';

export function Hero() {
  return (
    <section className="px-6 pt-[12vh] pb-16 text-center md:pt-[14vh]">
      <div className="mx-auto max-w-5xl">
        <div className="animate-fade-in-up">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium tracking-[0.18em] text-secondary uppercase">
            ShipCode
            <span className="text-muted">Issue to PR</span>
          </div>
          <h1 className="mx-auto mt-8 max-w-4xl text-5xl font-semibold tracking-[-0.05em] text-primary md:text-7xl">
            GitHub issues to merged code.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-secondary md:text-xl">
            Plan with Opus, review with Codex, execute in an isolated worktree, and keep verifying
            until the pull request is ready to land.
          </p>
        </div>

        <div
          className="animate-fade-in-up mt-10 flex flex-col items-center gap-5"
          style={{ animationDelay: '120ms', animationFillMode: 'both' }}
        >
          <div className="flex flex-wrap items-center justify-center gap-4">
            <a
              href="https://github.com/shipshitdev/shipcode"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#09090b] shadow-[0_0_24px_rgba(255,255,255,0.08)] transition-transform duration-200 hover:scale-[1.03]"
            >
              View on GitHub
              <span aria-hidden="true">↗</span>
            </a>
            <a
              href="/docs/getting-started"
              className="text-sm text-muted underline decoration-white/25 underline-offset-4 transition-colors duration-200 hover:text-secondary"
            >
              Read the docs
            </a>
          </div>
          <p className="text-sm text-muted">Planning. Review loops. Worktrees. Verifier retries.</p>
        </div>

        <div
          className="animate-screenshot-in mt-12"
          style={{ animationDelay: '200ms', animationFillMode: 'both' }}
        >
          <ProductMockup />
        </div>
      </div>
    </section>
  );
}
