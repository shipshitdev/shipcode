export function CtaBanner() {
  return (
    <section className="px-6 py-20">
      <div className="mx-auto max-w-3xl rounded-2xl border border-white/8 bg-white/[0.02] px-8 py-14 text-center">
        <h2 className="text-xl font-semibold tracking-[-0.03em] text-primary sm:text-3xl">
          Ship with agents, not arguments.
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-sm leading-6 text-secondary">
          Open-source. Runs locally. Your code never leaves your machine.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <a
            href="https://github.com/shipshitdev/shipcode/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#09090b] shadow-[0_0_24px_rgba(255,255,255,0.08)] transition-transform duration-200 hover:scale-[1.03]"
          >
            Download for Mac
          </a>
          <a
            href="https://github.com/shipshitdev/shipcode"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3 text-sm font-semibold text-primary transition-all duration-200 hover:bg-white/[0.08]"
          >
            Star on GitHub
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </section>
  );
}
